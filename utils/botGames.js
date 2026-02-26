const fs = require("fs");
const path = require("path");
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require("discord.js");

const config = require("../data/botgames/config");
const { loadEvents } = require("../data/botgames");
const economy = require("./economy");

// ----------------------------
// Economy wrappers (guild-safe)
// ----------------------------
async function econGetBalance(guildId, userId) {
  if (typeof economy.getBalance !== "function") throw new Error("economy.getBalance missing");
  if (economy.getBalance.length >= 2) return economy.getBalance(guildId, userId);
  return economy.getBalance(userId);
}

async function econAdd(guildId, userId, amount) {
  if (typeof economy.add !== "function") throw new Error("economy.add missing");
  if (economy.add.length >= 3) return economy.add(guildId, userId, amount);
  return economy.add(userId, amount);
}

async function econRemove(guildId, userId, amount) {
  if (typeof economy.remove !== "function") throw new Error("economy.remove missing");
  if (economy.remove.length >= 3) return economy.remove(guildId, userId, amount);
  return economy.remove(userId, amount);
}

// ----------------------------
// Timezone helpers (Brisbane)
// ----------------------------
function brisbaneParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-AU", {
    timeZone: config.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "short"
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map(p => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: parts.weekday // Mon, Tue...
  };
}

function dateKeyBrisbane(d = new Date()) {
  const p = brisbaneParts(d);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function isWeekendBrisbane(d = new Date()) {
  const wd = brisbaneParts(d).weekday;
  return wd === "Sat" || wd === "Sun";
}

function parseHHMM(hhmm) {
  const [h, m] = hhmm.split(":").map(n => parseInt(n, 10));
  return { h, m };
}

// Convert Brisbane local date/time -> UTC timestamp (ms)
// Avoids external libs; robust enough for Brisbane (no DST).
function brisbaneToUtcMs(year, month, day, hour, minute) {
  // Brisbane is always UTC+10.
  const utcMs = Date.UTC(year, month - 1, day, hour - 10, minute, 0, 0);
  return utcMs;
}

function randomTimeInWindow(dateParts, startHHMM, endHHMM) {
  const s = parseHHMM(startHHMM);
  const e = parseHHMM(endHHMM);

  const startMin = s.h * 60 + s.m;
  const endMin = e.h * 60 + e.m;

  const pick = startMin + Math.floor(Math.random() * Math.max(1, (endMin - startMin + 1)));
  const h = Math.floor(pick / 60);
  const m = pick % 60;

  return brisbaneToUtcMs(dateParts.year, dateParts.month, dateParts.day, h, m);
}

// ----------------------------
// DB persistence (schedule)
// ----------------------------
async function ensureScheduleTable(db) {
  // This table is only scheduler metadata. If its shape drifts between versions,
  // it’s safest to rebuild it automatically rather than crash the whole bot.
  try {
    await db.query(`SELECT day_key, planned_times, spawned_count FROM bot_games_schedule LIMIT 1`);
  } catch (e) {
    // 42P01 = undefined_table, 42703 = undefined_column
    const code = e?.code;
    if (code === "42P01" || code === "42703") {
      try { await db.query(`DROP TABLE IF EXISTS bot_games_schedule`); } catch {}
    } else {
      // Unknown failure: rethrow so we can see it in logs
      throw e;
    }
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS bot_games_schedule (
      guild_id TEXT PRIMARY KEY,
      day_key TEXT NOT NULL,
      planned_times JSONB NOT NULL DEFAULT '[]'::jsonb,
      spawned_count INT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Migration safety for older variants that might exist
  await db.query(`ALTER TABLE bot_games_schedule ADD COLUMN IF NOT EXISTS day_key TEXT`);
  await db.query(`ALTER TABLE bot_games_schedule ADD COLUMN IF NOT EXISTS planned_times JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await db.query(`ALTER TABLE bot_games_schedule ADD COLUMN IF NOT EXISTS spawned_count INT NOT NULL DEFAULT 0`);
  await db.query(`ALTER TABLE bot_games_schedule ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
}

async function readSchedule(db, guildId) {
  const res = await db.query(
    `SELECT guild_id, day_key, planned_times, spawned_count FROM bot_games_schedule WHERE guild_id=$1`,
    [guildId]
  );
  return res.rows[0] || null;
}

async function upsertSchedule(db, { guildId, dayKey, plannedTimes, spawnedCount }) {
  await db.query(
    `
    INSERT INTO bot_games_schedule (guild_id, day_key, planned_times, spawned_count, updated_at)
    VALUES ($1, $2, $3::jsonb, $4, NOW())
    ON CONFLICT (guild_id)
    DO UPDATE SET day_key=EXCLUDED.day_key, planned_times=EXCLUDED.planned_times, spawned_count=EXCLUDED.spawned_count, updated_at=NOW()
    `,
    [guildId, dayKey, JSON.stringify(plannedTimes), spawnedCount]
  );
}

// ----------------------------
// Event loading + selection
// ----------------------------
function pickWeighted(events) {
  const total = events.reduce((sum, e) => sum + (e.weight || 1), 0);
  let roll = Math.random() * total;
  for (const e of events) {
    roll -= (e.weight || 1);
    if (roll <= 0) return e;
  }
  return events[0];
}

// ----------------------------
// Active in-memory event state
// ----------------------------
let active = null; 


function unixFromMs(ms) {
  return Math.floor(ms / 1000);
}

function disableComponentsFromMessage(message) {
  const rows = message.components ?? [];
  return rows.map((row) => {
    const r = ActionRowBuilder.from(row);
    r.components = r.components.map((c) => {
      const b = ButtonBuilder.from(c);
      b.setDisabled(true);
      return b;
    });
    return r;
  });
}

// active = { messageId, channelId, guildId, eventId, claimedBy, expiresAt, state, eventMod }

function buildOneClickPayload(eventMod, state) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`botgames:${eventMod.id}:play`)
      .setLabel("Play")
      .setStyle(ButtonStyle.Success)
  );

  return {
    embeds: [{
      title: state.title || eventMod.name || "Bot Game",
      description: state.description || "First to click Play claims it.",
    }],
    components: [row]
  };


// schedule expiry (unclaimed)
if (active.expiryTimer) clearTimeout(active.expiryTimer);
active.expiryTimer = setTimeout(() => {
  expireActiveEvent(client, "unclaimed");
}, Math.max(0, active.expiresAt - Date.now()));

}

// Unified renderer: supports render() or legacy create/run
function renderEvent(eventMod, state, claimed) {
  if (typeof eventMod.render === "function") {
    return eventMod.render(state, { isClaimed: !!claimed });
  }
  // Legacy
  return buildOneClickPayload(eventMod, state);
}

async function spawnEvent(client, guild) {
  if (!config.enabled) return;
  if (active) return; // only one active at a time

  const channel = await guild.channels.fetch(config.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    console.warn(`[BOTGAMES] Channel ${config.channelId} not found or not text-based in guild ${guild.id}`);
    return;
  }

  const events = loadEvents();
  if (!events.length) return;

  const eventMod = pickWeighted(events);
  const state = eventMod.create();

  const payload = renderEvent(eventMod, state, false);

  const msg = await channel.send({
    content: `<@&${config.roleId}>`,
    ...payload
  });

  active = {
    guildId: guild.id,
    channelId: channel.id,
    messageId: msg.id,
    eventId: eventMod.id,
    eventMod,
    state,
    claimedBy: null,
    expiresAt: Date.now() + UNCLAIMED_EXPIRE_MS,
    claimedExpiresAt: null,
    expiryTimer: null,
  };

  if (config.debug) {
    console.log(`[BOTGAMES] Spawned ${eventMod.id} in #${channel.id} (msg ${msg.id})`);
  }
}


async function expireActiveEvent(client, mode) {
  if (!active) return;
  try {
    const channel = await client.channels.fetch(active.channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return;

    const msg = await channel.messages.fetch(active.messageId).catch(() => null);
    if (!msg) return;

    const eventName = active.eventMod?.name || "Bot Game";
    const expiresAtMs = mode === "claimed" ? (active.claimedExpiresAt || Date.now()) : active.expiresAt;
    const expiresUnix = unixFromMs(expiresAtMs);

    let description;
    if (mode === "unclaimed") {
      description = `**${eventName}** expired — react faster next time.

Expired: <t:${expiresUnix}:R>`;
    } else {
      const who = active.claimedBy ? `<@${active.claimedBy}>` : "Someone";
      description = `**${eventName}** was claimed by ${who} but expired before it was finished.

Expired: <t:${expiresUnix}:R>`;
    }

    await msg.edit({
      embeds: [{
        title: "⏱️ Game Expired",
        description,
      }],
      components: disableComponentsFromMessage(msg),
    });
  } catch (e) {
    console.error("[BOTGAMES] expireActiveEvent failed:", e);
  } finally {
    try { if (active?.expiryTimer) clearTimeout(active.expiryTimer); } catch {}
    active = null;
  }
}


function makeCtx(interaction) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;

  const ctx = {
    interaction,
    guildId,
    userId,
    economy,
    econGetBalance,
    econAdd,
    econRemove,
    // Render helper for multi-step events
    render: () => renderEvent(active.eventMod, active.state, true),
  };
  return ctx;
}

// ----------------------------
// Daily planning
// ----------------------------
function rollEventsToday() {
  const odds = isWeekendBrisbane() ? config.weekendOdds : config.weekdayOdds;
  const r = Math.random();
  if (r < odds.none) return 0;
  if (r < odds.none + odds.one) return 1;
  return 2;
}

async function planToday(db, guildId) {
  const nowKey = dateKeyBrisbane();
  const existing = await readSchedule(db, guildId);

  if (existing && existing.day_key === nowKey) {
    return existing;
  }

  const parts = brisbaneParts();
  const count = rollEventsToday();

  const planned = [];
  if (count === 1) {
    planned.push(randomTimeInWindow(parts, config.windows.oneEvent.start, config.windows.oneEvent.end));
  } else if (count === 2) {
    planned.push(randomTimeInWindow(parts, config.windows.twoEvent1.start, config.windows.twoEvent1.end));
    planned.push(randomTimeInWindow(parts, config.windows.twoEvent2.start, config.windows.twoEvent2.end));
    planned.sort((a, b) => a - b);
  }

  const row = {
    guild_id: guildId,
    day_key: nowKey,
    planned_times: planned,
    spawned_count: 0
  };

  await upsertSchedule(db, {
    guildId,
    dayKey: nowKey,
    plannedTimes: planned,
    spawnedCount: 0
  });

  if (config.debug) {
    console.log(`[BOTGAMES] Planned ${planned.length} event(s) for ${nowKey}: ${planned.map(t => new Date(t).toISOString()).join(", ")}`);
  }

  return row;
}

function scheduleTimers(client, guild, plannedTimes, alreadySpawned) {
  const now = Date.now();

  plannedTimes.forEach((t, idx) => {
    if (idx < alreadySpawned) return; // already done
    const delay = t - now;
    if (delay <= 0) return; // missed window; will be handled next init tick

    setTimeout(async () => {
      try {
        // Double-check cutoff (never after 10PM Brisbane)
        const p = brisbaneParts(new Date());
        if (p.hour > 22 || (p.hour === 22 && p.minute > 0)) return;

        await spawnEvent(client, guild);

        // increment spawned_count
        const db = client.db;
        const cur = await readSchedule(db, guild.id);
        if (cur && cur.day_key === dateKeyBrisbane()) {
          await upsertSchedule(db, {
            guildId: guild.id,
            dayKey: cur.day_key,
            plannedTimes: cur.planned_times,
            spawnedCount: (cur.spawned_count || 0) + 1
          });
        }
      } catch (e) {
        console.warn(`[BOTGAMES] spawn timer failed: ${e?.message || e}`);
      }
    }, delay);
  });
}

// Ensure we re-plan after midnight Brisbane.
// We'll set a timer to the next midnight.
function msUntilNextMidnightBrisbane() {
  const p = brisbaneParts();
  // next midnight local
  const nextDay = new Date(brisbaneToUtcMs(p.year, p.month, p.day, 0, 0) + 24 * 60 * 60_000);
  // nextDay is at 00:00 Brisbane tomorrow (in UTC ms)
  return nextDay.getTime() - Date.now();
}

async function init(client) {
  if (!config.enabled) return;
  if (!client?.db?.query) {
    console.warn("[BOTGAMES] client.db not found - bot games disabled");
    return;
  }

  const guild = client.guilds.cache.first();
  if (!guild) return;

  const db = client.db;
  await ensureScheduleTable(db);

  // Plan + schedule for today
  const row = await planToday(db, guild.id);
  const plannedTimes = Array.isArray(row.planned_times) ? row.planned_times : (row.planned_times || []);
  scheduleTimers(client, guild, plannedTimes, row.spawned_count || 0);

  // Re-init at next midnight Brisbane
  const delay = msUntilNextMidnightBrisbane();
  setTimeout(() => {
    init(client).catch(e => console.warn(`[BOTGAMES] midnight re-init failed: ${e?.message || e}`));
  }, Math.max(60_000, delay)); // at least 60s
}

// Back-compat alias
function startScheduler(client) {
  return init(client);
}

// ----------------------------
// Interaction handler
// ----------------------------
async function handleInteraction(interaction) {
  if (!interaction.isButton()) return false;
  if (!interaction.customId?.startsWith("botgames:")) return false;

  // Blood Tax blocks participating in random events until paid
  if (await echoCurses.guardBloodTaxComponent(interaction, { contextLabel: "this event" })) return true;

  // Ack immediately to avoid Discord 3s interaction timeout
  try { await interaction.deferUpdate(); } catch {}

  if (!active) {
    await interaction.reply({ content: "That event is no longer active.", flags: MessageFlags.Ephemeral });
    return true;
  }

  if (interaction.message?.id !== active.messageId) {
    await interaction.reply({ content: "That event is no longer active.", flags: MessageFlags.Ephemeral });
    return true;
  }

  if (Date.now() > active.expiresAt) {
    active = null;
    await interaction.reply({ content: "Too slow — event expired.", flags: MessageFlags.Ephemeral });
    return true;
  }

  const [, eventId, action] = interaction.customId.split(":");
  if (eventId !== active.eventId) {
    await interaction.reply({ content: "That event is no longer active.", flags: MessageFlags.Ephemeral });
    return true;
  }

  try {
    // Claim logic
    if (!active.claimedBy) {
      // Only allow claim on play action
      if (action !== "play") {
        await interaction.reply({ content: "You need to claim the event first.", flags: MessageFlags.Ephemeral });
    return true;
      }
      
active.claimedBy = interaction.user.id;
active.claimedExpiresAt = Date.now() + CLAIMED_EXPIRE_MS;

// reschedule expiry (claimed)
if (active.expiryTimer) clearTimeout(active.expiryTimer);
active.expiryTimer = setTimeout(() => {
  expireActiveEvent(interaction.client, "claimed");
}, Math.max(0, active.claimedExpiresAt - Date.now()));


      // If the event supports multi-step, re-render claimed state
      if (typeof active.eventMod.render === "function") {
        const payload = renderEvent(active.eventMod, active.state, true);
        return interaction.editReply(payload);
      }

      // Legacy one-shot: run immediately
      if (typeof active.eventMod.run === "function") {
        const ctx = makeCtx(interaction);
        const eventMod = active.eventMod;
        const state = active.state;
        active = null; // prevent double-claims
        return eventMod.run(ctx, state);
      }}

    // From here, event is claimed. Only claimer can act.
    if (interaction.user.id !== active.claimedBy) {
      await interaction.reply({ content: "This event has already been claimed.", flags: MessageFlags.Ephemeral });
    return true;
    }

    const ctx = makeCtx(interaction);

    // Multi-step events
    if (typeof active.eventMod.onAction === "function") {
      await active.eventMod.onAction(ctx, active.state, action);

      // If the event ended (we removed buttons), clear active
      // We can detect by checking if message components are empty in the update, but we don't get that back here.
      // Simple rule: clear on cashout or bust (handled by event) by setting ctx.end().
      // For now, event will end by updating components: [] — we’ll clear on those actions.
      if (action === "cashout" || action === "continue") {
        // continue might not end; keep active unless it busts.
        // We'll keep active unless the message got cleared; best-effort: if bust it likely cleared.
      }
      // If action was cashout, end it.
      if (action === "cashout") active = null;
      return;
    }

    // Legacy one-shot events
    if (typeof active.eventMod.run === "function") {
      const state = active.state;

      // Clear active to prevent further interaction
      const eventMod = active.eventMod;
      active = null;

      return eventMod.run(ctx, state);
    }

    await interaction.reply({ content: "This event is not configured correctly.", flags: MessageFlags.Ephemeral });
    return true;
  } catch (e) {
    console.warn(`[BOTGAMES] interaction failed: ${e?.message || e}`);
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: "Something went wrong running that game.", flags: MessageFlags.Ephemeral });
      } else {
        await interaction.reply({ content: "Something went wrong running that game.", flags: MessageFlags.Ephemeral });
      }
    } catch {}
  }
  return true;
}

module.exports = { init, startScheduler, handleInteraction };
