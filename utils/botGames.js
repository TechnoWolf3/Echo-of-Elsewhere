const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require("discord.js");

const config = require("../data/botgames/config");
const { loadEvents } = require("../data/botgames");
const economy = require("./economy"); // expects getBalance/add/remove

// One active event at a time (first in best dressed)
let activeEvent = null;

// Timers so we can clear/rebuild on restart
const scheduledTimeouts = new Set();

function dbg(...args) {
  if (config.debug) console.log("[BOTGAMES]", ...args);
}

function clearTimers() {
  for (const t of scheduledTimeouts) clearTimeout(t);
  scheduledTimeouts.clear();
}

function nowBrisbane() {
  const offsetMs = (config.tzOffsetHours || 10) * 60 * 60 * 1000;
  const d = new Date(Date.now() + offsetMs);
  // treat shifted date as "UTC" getters
  return {
    date: d,
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    dow: d.getUTCDay(), // 0 Sun .. 6 Sat
    ymd: d.toISOString().slice(0, 10),
  };
}

function brisbaneToUtcMs(year, month, day, hour, minute, second) {
  const offset = config.tzOffsetHours || 10;
  return Date.UTC(year, month - 1, day, hour - offset, minute, second, 0);
}

function randomTimeInWindow(ymdParts, window) {
  const { year, month, day } = ymdParts;
  const start = window.startHour;
  const end = window.endHour;

  const hour = start + Math.floor(Math.random() * Math.max(1, end - start));
  const minute = Math.floor(Math.random() * 60);
  const second = Math.floor(Math.random() * 60);

  const utcMs = brisbaneToUtcMs(year, month, day, hour, minute, second);
  return { hour, minute, second, utcMs };
}

function pickWeighted(events) {
  const total = events.reduce((sum, e) => sum + (e.weight || 1), 0);
  let roll = Math.random() * total;
  for (const e of events) {
    roll -= e.weight || 1;
    if (roll <= 0) return e;
  }
  return events[0];
}

async function ensureTables(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS bot_games_schedule (
      guild_id TEXT NOT NULL,
      day TEXT NOT NULL, -- YYYY-MM-DD (Brisbane)
      slot INTEGER NOT NULL, -- 1 or 2
      scheduled_at TIMESTAMPTZ NOT NULL,
      fired BOOLEAN NOT NULL DEFAULT FALSE,
      fired_at TIMESTAMPTZ,
      PRIMARY KEY (guild_id, day, slot)
    );
  `);
}

async function getOrCreateTodayPlan(db, guildId) {
  const bn = nowBrisbane();
  const day = bn.ymd;

  const existing = await db.query(
    `SELECT day, slot, scheduled_at, fired FROM bot_games_schedule
     WHERE guild_id=$1 AND day=$2
     ORDER BY slot ASC`,
    [guildId, day]
  );

  if (existing.rows.length) {
    return { day, rows: existing.rows };
  }

  // Roll the day
  const weekend = bn.dow === 0 || bn.dow === 6;
  const chances = weekend ? config.chancesWeekend : config.chancesWeekday;

  const r = Math.random();
  let count = 0;
  if (r < chances.none) count = 0;
  else if (r < chances.none + chances.one) count = 1;
  else count = 2;

  dbg(`Daily roll for ${day} (${weekend ? "weekend" : "weekday"}):`, count);

  const ymdParts = { year: bn.year, month: bn.month, day: bn.day };

  const inserts = [];
  if (count === 1) {
    const t = randomTimeInWindow(ymdParts, config.windows.oneEvent);
    inserts.push({ slot: 1, scheduled_at: new Date(t.utcMs) });
    dbg(`Planned 1 event at ${t.hour.toString().padStart(2,"0")}:${t.minute.toString().padStart(2,"0")}`);
  } else if (count === 2) {
    const t1 = randomTimeInWindow(ymdParts, config.windows.twoEventMorning);
    const t2 = randomTimeInWindow(ymdParts, config.windows.twoEventAfternoon);
    inserts.push({ slot: 1, scheduled_at: new Date(t1.utcMs) });
    inserts.push({ slot: 2, scheduled_at: new Date(t2.utcMs) });
    dbg(`Planned 2 events at ${t1.hour.toString().padStart(2,"0")}:${t1.minute.toString().padStart(2,"0")} and ${t2.hour.toString().padStart(2,"0")}:${t2.minute.toString().padStart(2,"0")}`);
  }

  for (const row of inserts) {
    await db.query(
      `INSERT INTO bot_games_schedule (guild_id, day, slot, scheduled_at)
       VALUES ($1,$2,$3,$4)`,
      [guildId, day, row.slot, row.scheduled_at]
    );
  }

  const rows = inserts.map((r) => ({
    day,
    slot: r.slot,
    scheduled_at: r.scheduled_at,
    fired: false,
  }));

  return { day, rows };
}

async function scheduleUpcoming(client) {
  if (!config.enabled) return;
  const guild = client.guilds.cache.first();
  if (!guild) return;

  const db = client.db;
  if (!db?.query) {
    console.warn("[BOTGAMES] client.db not found; bot games scheduler disabled.");
    return;
  }

  await ensureTables(db);

  // Always ensure today's plan exists (or load it)
  const plan = await getOrCreateTodayPlan(db, guild.id);

  // Load any unfired rows for today whose scheduled time is still in the future
  const res = await db.query(
    `SELECT day, slot, scheduled_at
     FROM bot_games_schedule
     WHERE guild_id=$1 AND day=$2 AND fired=FALSE
     ORDER BY slot ASC`,
    [guild.id, plan.day]
  );

  const now = Date.now();
  for (const row of res.rows) {
    const when = new Date(row.scheduled_at).getTime();
    if (when <= now) {
      // If bot was offline and missed it, don't fire late (especially past 10PM).
      dbg(`Missed slot ${row.slot} for ${row.day}, marking fired without spawning.`);
      await db.query(
        `UPDATE bot_games_schedule SET fired=TRUE, fired_at=NOW()
         WHERE guild_id=$1 AND day=$2 AND slot=$3`,
        [guild.id, row.day, row.slot]
      );
      continue;
    }

    const delay = when - now;
    const t = setTimeout(() => spawnAtSlot(client, row.day, row.slot), delay);
    scheduledTimeouts.add(t);

    dbg(`Scheduled slot ${row.slot} for ${row.day} in ${(delay/1000/60).toFixed(1)} min`);
  }

  // Also schedule a rebuild just after next midnight Brisbane
  scheduleNextMidnightRebuild(client);
}

function scheduleNextMidnightRebuild(client) {
  const bn = nowBrisbane();
  // next midnight in Brisbane = tomorrow 00:00:05
  const nextDay = new Date(Date.UTC(bn.year, bn.month - 1, bn.day, 0, 0, 0, 0) + 24*60*60*1000);
  // nextDay is in "shifted UTC"; convert back to real UTC by subtracting offset
  const offsetMs = (config.tzOffsetHours || 10) * 60 * 60 * 1000;
  const nextMidnightUtcMs = nextDay.getTime() - offsetMs + 5000; // +5s buffer

  const delay = Math.max(10_000, nextMidnightUtcMs - Date.now());
  const t = setTimeout(async () => {
    clearTimers();
    await scheduleUpcoming(client);
  }, delay);

  scheduledTimeouts.add(t);
  dbg(`Next midnight rebuild in ${(delay/1000/60).toFixed(1)} min`);
}

async function spawnAtSlot(client, day, slot) {
  const guild = client.guilds.cache.first();
  if (!guild) return;

  const db = client.db;
  if (!db?.query) return;

  // If an event is currently active, delay a bit (but don't go past 10PM AEST)
  if (activeEvent) {
    dbg("Active event exists; delaying spawn 10 minutes.");
    const delayMs = 10 * 60 * 1000;
    const t = setTimeout(() => spawnAtSlot(client, day, slot), delayMs);
    scheduledTimeouts.add(t);
    return;
  }

  // Mark fired first to prevent double firing on restarts
  await db.query(
    `UPDATE bot_games_schedule
     SET fired=TRUE, fired_at=NOW()
     WHERE guild_id=$1 AND day=$2 AND slot=$3 AND fired=FALSE`,
    [guild.id, day, slot]
  );

  const channel = await guild.channels.fetch(config.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    console.warn("[BOTGAMES] channelId is missing/invalid or not text-based:", config.channelId);
    return;
  }

  const events = loadEvents();
  if (!events.length) return;

  const chosen = pickWeighted(events);
  const instance = chosen.create();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("botgames_play")
      .setLabel("Play")
      .setStyle(ButtonStyle.Success)
  );

  const msg = await channel.send({
    content: `<@&${config.roleId}>`,
    embeds: [
      {
        title: instance.title,
        description: instance.description,
        color: 0x5865f2,
      },
    ],
    components: [row],
  });

  activeEvent = {
    eventId: chosen.id,
    bet: instance.bet ?? 0,
    messageId: msg.id,
    channelId: msg.channel.id,
    expiresAt: Date.now() + (config.expireMinutes || 10) * 60 * 1000,
  };

  // Auto-expire if nobody claims
  const expireTimer = setTimeout(async () => {
    if (!activeEvent) return;
    if (activeEvent.messageId !== msg.id) return;

    activeEvent = null;
    await msg.edit({
      embeds: [
        {
          title: "⌛ Bot Game expired",
          description: "No one claimed it in time. Next one will pop up later 👀",
          color: 0x2b2d31,
        },
      ],
      components: [],
    }).catch(() => {});
  }, (config.expireMinutes || 10) * 60 * 1000);

  scheduledTimeouts.add(expireTimer);
}

async function handleInteraction(interaction) {
  if (!interaction.isButton()) return;
  if (interaction.customId !== "botgames_play") return;

  if (!activeEvent) {
    return interaction.reply({
      content: "Too slow — that Bot Game is no longer available.",
      flags: MessageFlags.Ephemeral,
    });
  }

  if (Date.now() > activeEvent.expiresAt) {
    activeEvent = null;
    return interaction.reply({
      content: "Too slow — that Bot Game expired.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const bet = Number(activeEvent.bet || 0);
  const userId = interaction.user.id;

  if (bet > 0) {
    const bal = await economy.getBalance(userId);
    if (bal < bet) {
      return interaction.reply({
        content: `You need **$${bet.toLocaleString()}** to play this one.`,
        flags: MessageFlags.Ephemeral,
      });
    }
    await economy.remove(userId, bet);
  }

  // Double or Nothing (50/50)
  const win = Math.random() < 0.5;

  if (win && bet > 0) {
    await economy.add(userId, bet * 2);
  }

  const resultEmbed = {
    title: win ? "💰 You Won!" : "💀 You Lost!",
    description:
      bet > 0
        ? win
          ? `${interaction.user} doubled **$${bet.toLocaleString()}**!`
          : `${interaction.user} lost **$${bet.toLocaleString()}**.`
        : win
          ? `${interaction.user} won!`
          : `${interaction.user} lost!`,
    color: win ? 0x57f287 : 0xed4245,
  };

  activeEvent = null;

  return interaction.update({
    embeds: [resultEmbed],
    components: [],
  });
}

// Backwards compatible name (your index.js likely calls startScheduler)
async function init(client) {
  clearTimers();
  await scheduleUpcoming(client);
}

async function startScheduler(client) {
  return init(client);
}

module.exports = { init, startScheduler, handleInteraction };
