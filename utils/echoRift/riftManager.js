// utils/echoRift/riftManager.js
// Daily Echo Rift: one entrant, multi-step choices, theatrical outcome.

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");

const { pool } = require("../db");
const economy = require("../economy");
const jail = require("../jail");
const { buildScenario } = require("./riftScenarios");
const T = require("./riftTextPools");

// ----------------------------
// Config
// ----------------------------

const CONFIG = {
  channelId: "1449217901306581074",
  chosenRoleId: "1476440178687082567",

  // Rift window: once/day at a random time in Sydney.
  // Default: between 10:00 and 22:00 Sydney.
  spawnWindow: { startHour: 10, endHour: 22 },

  // Rift stays open for 1 hour if nobody enters.
  openMs: 60 * 60_000,

  // CHANCE MODE:
  // If you want rifts to only happen some days, set chanceModeEnabled=true and chancePerDay=0.7.
  // If you want guaranteed daily rifts, leave chanceModeEnabled=false.
  chanceModeEnabled: false,
  chancePerDay: 0.7,

  // Echo's Chosen
  chosenDurationMs: 48 * 60 * 60_000,
  chosenWealthTickMs: 4 * 60 * 60_000,
  chosenWealthAmount: 20_000,

  // Ultra-rare wallet wipe: percent of wallet.
  ultraRareWipePct: 0.20,
};

// ----------------------------
// In-memory active state
// ----------------------------

let active = null; // { guildId, channelId, messageId, riftId, expiresAt, claimedBy, hiddenTier, step, depth, riskScore, scenario, timers }

// ----------------------------
// Time helpers (Sydney)
// ----------------------------

const SYD_TZ = "Australia/Sydney";

function zonedParts(timeZone) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const obj = {};
  for (const p of parts) {
    if (p.type !== "literal") obj[p.type] = p.value;
  }
  return {
    year: Number(obj.year),
    month: Number(obj.month),
    day: Number(obj.day),
    hour: Number(obj.hour),
    minute: Number(obj.minute),
    second: Number(obj.second),
  };
}

function zonedDateToUtcMs({ year, month, day, hour, minute, second }) {
  // Treat the provided parts as if they are in the target TZ.
  // We approximate by creating a Date from those parts in UTC and then
  // shifting by the offset between UTC and the TZ at that moment.
  // This is good enough for scheduling within a day.
  const approxUtc = Date.UTC(year, month - 1, day, hour, minute, second || 0);

  // Find actual UTC time that formats to those same parts.
  // We do a small iterative correction.
  let guess = approxUtc;
  for (let i = 0; i < 3; i++) {
    const p = new Intl.DateTimeFormat("en-US", {
      timeZone: SYD_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(new Date(guess));

    const got = {};
    for (const x of p) if (x.type !== "literal") got[x.type] = x.value;

    const gotMs = Date.UTC(
      Number(got.year),
      Number(got.month) - 1,
      Number(got.day),
      Number(got.hour),
      Number(got.minute),
      Number(got.second)
    );

    const targetMs = Date.UTC(year, month - 1, day, hour, minute, second || 0);
    const delta = targetMs - gotMs;
    guess += delta;
    if (Math.abs(delta) < 1000) break;
  }

  return guess;
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomRiftTier() {
  // Weight towards lower tiers.
  const roll = Math.random();
  if (roll < 0.55) return 1;
  if (roll < 0.85) return 2;
  if (roll < 0.97) return 3;
  return 4;
}

function tierDepth(tier) {
  return tier === 1 ? 2 : tier === 2 ? 3 : tier === 3 ? 4 : 5;
}

function fmtRelTs(ms) {
  return `<t:${Math.floor(ms / 1000)}:R>`;
}

// ----------------------------
// DB helpers
// ----------------------------

async function upsertActiveToDb() {
  if (!active) return;
  await pool.query(
    `INSERT INTO echo_rift_state (
      guild_id, channel_id, message_id, rift_id, expires_at,
      claimed_by, hidden_tier, step, depth, risk_score, state, updated_at
    ) VALUES ($1,$2,$3,$4,to_timestamp($5/1000.0),$6,$7,$8,$9,$10,$11,NOW())
    ON CONFLICT (guild_id)
    DO UPDATE SET
      channel_id=EXCLUDED.channel_id,
      message_id=EXCLUDED.message_id,
      rift_id=EXCLUDED.rift_id,
      expires_at=EXCLUDED.expires_at,
      claimed_by=EXCLUDED.claimed_by,
      hidden_tier=EXCLUDED.hidden_tier,
      step=EXCLUDED.step,
      depth=EXCLUDED.depth,
      risk_score=EXCLUDED.risk_score,
      state=EXCLUDED.state,
      updated_at=NOW()`,
    [
      String(active.guildId),
      String(active.channelId),
      String(active.messageId),
      String(active.riftId),
      Number(active.expiresAt),
      active.claimedBy ? String(active.claimedBy) : null,
      Number(active.hiddenTier || 1),
      Number(active.step || 0),
      Number(active.depth || 2),
      Number(active.riskScore || 0),
      active.state ? JSON.stringify(active.state) : "{}",
    ]
  );
}

async function clearActiveFromDb(guildId) {
  await pool.query(`DELETE FROM echo_rift_state WHERE guild_id=$1`, [String(guildId)]);
}

async function loadActiveFromDb(client) {
  const guild = client.guilds.cache.first();
  if (!guild) return null;

  const res = await pool.query(
    `SELECT * FROM echo_rift_state WHERE guild_id=$1 LIMIT 1`,
    [String(guild.id)]
  );
  const row = res.rows?.[0];
  if (!row) return null;

  const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  if (!expiresAt || expiresAt <= Date.now()) {
    await clearActiveFromDb(guild.id);
    return null;
  }

  return {
    guildId: guild.id,
    channelId: row.channel_id,
    messageId: row.message_id,
    riftId: row.rift_id,
    expiresAt,
    claimedBy: row.claimed_by,
    hiddenTier: Number(row.hidden_tier || 1),
    step: Number(row.step || 0),
    depth: Number(row.depth || tierDepth(Number(row.hidden_tier || 1))),
    riskScore: Number(row.risk_score || 0),
    state: row.state || {},
  };
}

async function getActiveCurse(guildId, userId) {
  const res = await pool.query(
    `SELECT kind, value, expires_at
     FROM echo_user_curses
     WHERE guild_id=$1 AND user_id=$2
     LIMIT 1`,
    [String(guildId), String(userId)]
  );

  const row = res.rows?.[0];
  if (!row) return null;

  const exp = row.expires_at ? new Date(row.expires_at).getTime() : null;
  if (exp && exp <= Date.now()) {
    await pool.query(`DELETE FROM echo_user_curses WHERE guild_id=$1 AND user_id=$2`, [String(guildId), String(userId)]);
    return null;
  }

  return {
    kind: String(row.kind),
    value: Number(row.value || 0),
    expiresAt: exp,
  };
}

async function setCurse(guildId, userId, kind, value, expiresAtMs) {
  const exp = expiresAtMs ? new Date(expiresAtMs) : null;
  await pool.query(
    `INSERT INTO echo_user_curses (guild_id, user_id, kind, value, expires_at)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (guild_id, user_id)
     DO UPDATE SET kind=EXCLUDED.kind, value=EXCLUDED.value, expires_at=EXCLUDED.expires_at, created_at=NOW()`,
    [String(guildId), String(userId), String(kind), Number(value || 0), exp]
  );
}

async function addBloodTaxPenalty(guildId, userId, addAmount) {
  const curse = await getActiveCurse(guildId, userId);
  const current = curse && curse.kind === "blood_tax" ? Number(curse.value || 0) : 0;
  // Blood tax doesn't expire until paid.
  await setCurse(guildId, userId, "blood_tax", current + Number(addAmount || 0), null);
}

async function clearCurse(guildId, userId) {
  await pool.query(`DELETE FROM echo_user_curses WHERE guild_id=$1 AND user_id=$2`, [String(guildId), String(userId)]);
}

async function getActiveChosen(guildId, userId) {
  const res = await pool.query(
    `SELECT perk, expires_at, last_tick_at
     FROM echo_chosen
     WHERE guild_id=$1 AND user_id=$2 AND expires_at > NOW()
     LIMIT 1`,
    [String(guildId), String(userId)]
  );
  const row = res.rows?.[0];
  if (!row) return null;
  return {
    perk: String(row.perk),
    expiresAt: new Date(row.expires_at).getTime(),
    lastTickAt: row.last_tick_at ? new Date(row.last_tick_at).getTime() : Date.now(),
  };
}

async function setChosen(guildId, userId, perk, expiresAtMs) {
  await pool.query(
    `INSERT INTO echo_chosen (guild_id, user_id, perk, expires_at, last_tick_at)
     VALUES ($1,$2,$3,$4,NOW())
     ON CONFLICT (guild_id, user_id)
     DO UPDATE SET perk=EXCLUDED.perk, expires_at=EXCLUDED.expires_at, last_tick_at=NOW(), created_at=NOW()`,
    [String(guildId), String(userId), String(perk), new Date(expiresAtMs)]
  );
}

async function deleteChosen(guildId, userId) {
  await pool.query(`DELETE FROM echo_chosen WHERE guild_id=$1 AND user_id=$2`, [String(guildId), String(userId)]);
}

// ----------------------------
// Rendering
// ----------------------------

function buildSpawnEmbed({ expiresAt, hiddenTier }) {
  const vibe = T.pick(T.SPAWN_LINES[hiddenTier] || T.SPAWN_LINES[1]);

  return new EmbedBuilder()
    .setTitle("🕳️ The Echo Rift")
    .setDescription(
      `${vibe}\n\n` +
      `⏳ **Collapses** ${fmtRelTs(expiresAt)}\n` +
      `Only **one** soul may enter.`
    );
}

function buildSpawnComponents(riftId) {
  const enterText = T.pick(T.ENTER_BUTTON_LINES);
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`rift:${riftId}:enter`)
        .setLabel(enterText)
        .setStyle(ButtonStyle.Primary)
    ),
  ];
}

function buildStepEmbed({ step, depth, prompt, narration, claimedBy }) {
  const title = `🕳️ The Echo Rift — Step ${step}/${depth}`;
  const desc = `${prompt}\n\n*${narration}*\n\n` + (claimedBy ? `**Entrant:** <@${claimedBy}>` : "");
  return new EmbedBuilder().setTitle(title).setDescription(desc);
}

function buildChoiceComponents(riftId, step) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`rift:${riftId}:choose:${step}:1`).setLabel("Option I").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`rift:${riftId}:choose:${step}:2`).setLabel("Option II").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`rift:${riftId}:choose:${step}:3`).setLabel("Option III").setStyle(ButtonStyle.Secondary)
    ),
  ];
}

function buildOutcomeEmbed({ claimedBy, outcomeTitle, outcomeBody }) {
  return new EmbedBuilder()
    .setTitle(outcomeTitle)
    .setDescription(`${outcomeBody}\n\n**Entrant:** <@${claimedBy}>`);
}

// ----------------------------
// Outcome logic
// ----------------------------

function rollOutcome(hiddenTier, riskScore) {
  // Base chances by tier (blessing / nothing / curse)
  const base = {
    1: { bless: 0.50, none: 0.30, curse: 0.20 },
    2: { bless: 0.45, none: 0.25, curse: 0.30 },
    3: { bless: 0.40, none: 0.15, curse: 0.45 },
    4: { bless: 0.35, none: 0.05, curse: 0.60 },
  }[hiddenTier] || { bless: 0.45, none: 0.25, curse: 0.30 };

  // Risk tilts towards curse; low/negative risk tilts blessing.
  const tilt = Math.max(-4, Math.min(6, Number(riskScore || 0)));

  let bless = base.bless - tilt * 0.02;
  let curse = base.curse + tilt * 0.03;
  let none = base.none;

  // clamp + normalize
  bless = Math.max(0.05, Math.min(0.80, bless));
  curse = Math.max(0.05, Math.min(0.85, curse));
  none = Math.max(0.02, Math.min(0.60, none));

  const sum = bless + curse + none;
  bless /= sum; curse /= sum; none /= sum;

  const r = Math.random();
  if (r < bless) return "blessing";
  if (r < bless + none) return "nothing";
  return "curse";
}

function blessingReward(hiddenTier, riskScore) {
  // Reward scales with tier + risk.
  const baseMin = [0, 5_000, 10_000, 25_000, 75_000][hiddenTier] || 10_000;
  const baseMax = [0, 12_000, 30_000, 70_000, 140_000][hiddenTier] || 25_000;

  const risk = Math.max(0, Number(riskScore || 0));
  const extra = risk * (hiddenTier >= 3 ? 2_000 : 1_000);
  const amt = randInt(baseMin, baseMax) + extra;
  return Math.max(1_000, Math.floor(amt / 100) * 100);
}

function rollChosenChance(hiddenTier) {
  // Low odds, increases slightly with tier.
  const p = hiddenTier === 4 ? 0.03 : hiddenTier === 3 ? 0.01 : hiddenTier === 2 ? 0.005 : 0.002;
  return Math.random() < p;
}

function pickChosenPerk() {
  // Exactly ONE perk at a time.
  const perks = [
    "wealth",          // +$20,000 every 4h
    "double_casino",   // doubles select casino payouts
    "tax_shield",      // (future hook) reduce taxes
    "cop_blind_eye",   // (future hook) flavour / crime integration
  ];
  return perks[Math.floor(Math.random() * perks.length)];
}

async function applyCurse(client, guildId, userId, hiddenTier, riskScore) {
  // Choose one curse. No stacking.
  const curseRoll = Math.random();

  // Ultra rare wipe only possible at high tier + high risk.
  const allowWipe = hiddenTier === 4 && Number(riskScore || 0) >= 8;
  if (allowWipe && curseRoll < 0.01) {
    const bal = await economy.getBalance(guildId, userId);
    const wipe = Math.floor(bal * CONFIG.ultraRareWipePct);
    if (wipe > 0) {
      await economy.tryDebitUser(guildId, userId, wipe, "echo_rift_wipe", { pct: CONFIG.ultraRareWipePct });
    }
    return { kind: "wipe", text: `lose **${Math.floor(CONFIG.ultraRareWipePct * 100)}%** of your wallet.` };
  }

  // Weighted selection
  const options = [
    { kind: "jail", w: 3 },
    { kind: "blood_tax", w: 3 },
    { kind: "games_fee", w: 2 },
    { kind: "rift_tax", w: 2 },
    { kind: "wallet_drain", w: 2 },
  ];
  const total = options.reduce((a, o) => a + o.w, 0);
  let roll = Math.random() * total;
  let chosen = options[0].kind;
  for (const o of options) {
    roll -= o.w;
    if (roll <= 0) { chosen = o.kind; break; }
  }

  if (chosen === "jail") {
    const mins = hiddenTier === 1 ? randInt(5, 12) : hiddenTier === 2 ? randInt(10, 20) : hiddenTier === 3 ? randInt(15, 35) : randInt(25, 60);
    await jail.setJail(guildId, userId, mins);
    await setCurse(guildId, userId, "jail", mins, Date.now() + mins * 60_000);
    return { kind: "jail", text: `are **jailed** for ${mins} minutes.` };
  }

  if (chosen === "blood_tax") {
    const amt = hiddenTier === 1 ? randInt(5_000, 12_000) : hiddenTier === 2 ? randInt(10_000, 25_000) : hiddenTier === 3 ? randInt(20_000, 45_000) : randInt(35_000, 75_000);
    await setCurse(guildId, userId, "blood_tax", amt, null);
    return { kind: "blood_tax", text: `owe a **Blood Tax** of **$${amt.toLocaleString()}** before using /games.` };
  }

  if (chosen === "games_fee") {
    const amt = hiddenTier === 1 ? randInt(3_000, 8_000) : hiddenTier === 2 ? randInt(7_000, 15_000) : hiddenTier === 3 ? randInt(12_000, 25_000) : randInt(20_000, 40_000);
    await setCurse(guildId, userId, "games_fee", amt, Date.now() + 2 * 60 * 60_000);
    return { kind: "games_fee", text: `must pay **$${amt.toLocaleString()}** in fees before using /games.` };
  }

  if (chosen === "rift_tax") {
    const pct = hiddenTier === 1 ? 10 : hiddenTier === 2 ? 15 : hiddenTier === 3 ? 20 : 25;
    await setCurse(guildId, userId, "rift_tax", pct, Date.now() + 60 * 60_000);
    return { kind: "rift_tax", text: `are cursed with a **${pct}%** tax for 1 hour.` };
  }

  // wallet drain
  const bal = await economy.getBalance(guildId, userId);
  const pct = hiddenTier === 1 ? 0.10 : hiddenTier === 2 ? 0.15 : hiddenTier === 3 ? 0.20 : 0.25;
  const amt = Math.floor(bal * pct);
  if (amt > 0) {
    await economy.tryDebitUser(guildId, userId, amt, "echo_rift_drain", { pct });
  }
  await setCurse(guildId, userId, "wallet_drain", amt, Date.now() + 10 * 60_000);
  return { kind: "wallet_drain", text: `lose **$${amt.toLocaleString()}** to the void.` };
}

// ----------------------------
// Scheduler + recovery
// ----------------------------

function scheduleTimeout(fn, ms) {
  return setTimeout(fn, Math.max(0, ms));
}

async function planNextSpawnUtcMs() {
  const nowP = zonedParts(SYD_TZ);

  // Decide if we spawn today.
  if (CONFIG.chanceModeEnabled) {
    if (Math.random() > Number(CONFIG.chancePerDay || 0.7)) {
      // schedule for tomorrow
      const tomorrowUtcMs = zonedDateToUtcMs({
        year: nowP.year,
        month: nowP.month,
        day: nowP.day + 1,
        hour: CONFIG.spawnWindow.startHour,
        minute: 0,
        second: 0,
      });
      // Randomize within window tomorrow.
      const endUtcMs = zonedDateToUtcMs({
        year: nowP.year,
        month: nowP.month,
        day: nowP.day + 1,
        hour: CONFIG.spawnWindow.endHour,
        minute: 0,
        second: 0,
      });
      return randInt(tomorrowUtcMs, endUtcMs);
    }
  }

  const startUtcMs = zonedDateToUtcMs({
    year: nowP.year,
    month: nowP.month,
    day: nowP.day,
    hour: CONFIG.spawnWindow.startHour,
    minute: 0,
    second: 0,
  });
  const endUtcMs = zonedDateToUtcMs({
    year: nowP.year,
    month: nowP.month,
    day: nowP.day,
    hour: CONFIG.spawnWindow.endHour,
    minute: 0,
    second: 0,
  });

  const now = Date.now();
  let target = randInt(startUtcMs, endUtcMs);

  // If window already passed, schedule for tomorrow.
  if (now > endUtcMs) {
    const tStart = zonedDateToUtcMs({
      year: nowP.year,
      month: nowP.month,
      day: nowP.day + 1,
      hour: CONFIG.spawnWindow.startHour,
      minute: 0,
      second: 0,
    });
    const tEnd = zonedDateToUtcMs({
      year: nowP.year,
      month: nowP.month,
      day: nowP.day + 1,
      hour: CONFIG.spawnWindow.endHour,
      minute: 0,
      second: 0,
    });
    target = randInt(tStart, tEnd);
  }

  // If target already passed (early in day but random landed behind), bump a bit.
  if (target <= now + 30_000) {
    target = Math.min(endUtcMs, now + randInt(60_000, 10 * 60_000));
  }

  return target;
}

async function spawnRift(client) {
  const guild = client.guilds.cache.first();
  if (!guild) return;

  // If active already exists, don't double-spawn.
  if (active && active.expiresAt > Date.now()) return;

  const channel = await client.channels.fetch(CONFIG.channelId).catch(() => null);
  if (!channel) {
    console.warn("[ECHO-RIFT] channel not found:", CONFIG.channelId);
    return;
  }

  const hiddenTier = randomRiftTier();
  const depth = tierDepth(hiddenTier);
  const riftId = `r${Date.now().toString(36)}${Math.floor(Math.random() * 9999).toString(36)}`;
  const expiresAt = Date.now() + CONFIG.openMs;

  const embed = buildSpawnEmbed({ expiresAt, hiddenTier });
  const components = buildSpawnComponents(riftId);

  const msg = await channel.send({ embeds: [embed], components }).catch(() => null);
  if (!msg) return;

  active = {
    guildId: guild.id,
    channelId: channel.id,
    messageId: msg.id,
    riftId,
    expiresAt,
    claimedBy: null,
    hiddenTier,
    step: 0,
    depth,
    riskScore: 0,
    state: {},
    timers: {},
  };

  await upsertActiveToDb();

  // Expire if unclaimed.
  if (active.timers.expire) clearTimeout(active.timers.expire);
  active.timers.expire = scheduleTimeout(() => expireRift(client, "unclaimed"), expiresAt - Date.now());
}

async function expireRift(client, reason) {
  if (!active) return;

  const guildId = active.guildId;
  const channel = await client.channels.fetch(active.channelId).catch(() => null);
  const msg = channel ? await channel.messages.fetch(active.messageId).catch(() => null) : null;

  if (msg) {
    const embed = new EmbedBuilder()
      .setTitle("🕳️ The Echo Rift — Collapsed")
      .setDescription(T.pick(T.EXPIRED_LINES));

    await msg.edit({ embeds: [embed], components: [] }).catch(() => {});
  }

  try { await clearActiveFromDb(guildId); } catch {}

  active = null;
}

async function resumeFromDb(client) {
  const saved = await loadActiveFromDb(client);
  if (!saved) return;

  active = {
    ...saved,
    timers: {},
  };

  // Re-arm expiry
  active.timers.expire = scheduleTimeout(() => expireRift(client, "unclaimed"), active.expiresAt - Date.now());
}

async function scheduleDailySpawn(client) {
  const target = await planNextSpawnUtcMs();
  const delay = target - Date.now();

  setTimeout(async () => {
    try {
      await spawnRift(client);
    } catch (e) {
      console.warn("[ECHO-RIFT] spawn failed:", e?.message || e);
    }

    // Schedule the next day after a short delay so we don't pile up timeouts.
    setTimeout(() => {
      scheduleDailySpawn(client).catch(() => {});
    }, 60_000);
  }, Math.max(5_000, delay));
}

// ----------------------------
// Echo's Chosen processing
// ----------------------------

async function processChosenTick(client) {
  const guild = client.guilds.cache.first();
  if (!guild) return;

  const now = Date.now();

  // Expire roles
  const res = await pool.query(
    `SELECT user_id, perk, expires_at, last_tick_at
     FROM echo_chosen
     WHERE guild_id=$1`,
    [String(guild.id)]
  );

  for (const row of res.rows || []) {
    const userId = String(row.user_id);
    const perk = String(row.perk);
    const expiresAt = new Date(row.expires_at).getTime();
    const lastTickAt = row.last_tick_at ? new Date(row.last_tick_at).getTime() : now;

    const member = await guild.members.fetch(userId).catch(() => null);

    if (expiresAt <= now) {
      if (member && member.roles.cache.has(CONFIG.chosenRoleId)) {
        await member.roles.remove(CONFIG.chosenRoleId, "Echo's Chosen expired").catch(() => {});
      }
      await deleteChosen(guild.id, userId).catch(() => {});
      continue;
    }

    if (member && !member.roles.cache.has(CONFIG.chosenRoleId)) {
      // Role got removed manually; re-add so timing is consistent.
      const me = guild.members.me;
      if (me?.permissions?.has?.("ManageRoles")) {
        await member.roles.add(CONFIG.chosenRoleId, "Echo's Chosen active").catch(() => {});
      }
    }

    // Wealth tick
    if (perk === "wealth") {
      const due = (now - lastTickAt) >= CONFIG.chosenWealthTickMs;
      if (due) {
        await economy.creditUser(guild.id, userId, CONFIG.chosenWealthAmount, "echo_chosen_wealth", {
          tick: "4h",
        }).catch(() => {});

        await pool.query(
          `UPDATE echo_chosen SET last_tick_at = NOW() WHERE guild_id=$1 AND user_id=$2`,
          [String(guild.id), String(userId)]
        ).catch(() => {});
      }
    }
  }
}

// ----------------------------
// Interaction handler
// ----------------------------

async function handleInteraction(interaction) {
  if (!interaction.isButton()) return false;
  if (!interaction.customId?.startsWith("rift:")) return false;

  // Ack quickly
  try { await interaction.deferUpdate(); } catch {}

  if (!active) {
    try {
      await interaction.followUp({ content: "That Rift is no longer active.", flags: MessageFlags.Ephemeral });
    } catch {}
    return true;
  }

  if (interaction.message?.id !== active.messageId) {
    try {
      await interaction.followUp({ content: "That Rift is no longer active.", flags: MessageFlags.Ephemeral });
    } catch {}
    return true;
  }

  if (Date.now() > active.expiresAt) {
    await expireRift(interaction.client, "expired");
    try {
      await interaction.followUp({ content: T.pick(T.EXPIRED_LINES), flags: MessageFlags.Ephemeral });
    } catch {}
    return true;
  }

  const parts = String(interaction.customId).split(":");
  const riftId = parts[1];
  const action = parts[2];

  if (riftId !== active.riftId) {
    try {
      await interaction.followUp({ content: "That Rift is no longer active.", flags: MessageFlags.Ephemeral });
    } catch {}
    return true;
  }

  // Only one entrant can claim.
  if (action === "enter") {
    // If already claimed by someone else
    if (active.claimedBy && active.claimedBy !== interaction.user.id) {
      await interaction.followUp({ content: T.pick(T.CLAIMED_BY_OTHER_LINES), flags: MessageFlags.Ephemeral }).catch(() => {});
      return true;
    }

    // Jail guard (manual — we already deferredUpdate)
    const jailedUntil = await jail.getJailRelease(active.guildId, interaction.user.id);
    if (jailedUntil) {
      const ts = Math.floor(jailedUntil.getTime() / 1000);
      await interaction.followUp({
        content: `⛓️ You are jailed and will be released <t:${ts}:R>.`,
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return true;
    }

    // Active curse guard
    const curse = await getActiveCurse(active.guildId, interaction.user.id);
    if (curse) {
      if (curse.kind === "blood_tax") {
        const base = T.pick(T.BLOOD_TAX_REJECT_LINES);
        const extra = T.pick(T.BLOOD_TAX_PENALTY_LINES);
        const add = Math.max(1000, Math.floor((curse.value || 0) * 0.10));
        await addBloodTaxPenalty(active.guildId, interaction.user.id, add);
        await interaction.followUp({
          content: `${base}\n${extra} **+$${add.toLocaleString()}** added to your Blood Tax.`,
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
        return true;
      }

      await interaction.followUp({ content: T.pick(T.ACTIVE_CURSE_DENY_LINES), flags: MessageFlags.Ephemeral }).catch(() => {});
      return true;
    }

    // Echo's Chosen guard
    const chosen = await getActiveChosen(active.guildId, interaction.user.id);
    if (chosen) {
      await interaction.followUp({ content: T.pick(T.CHOSEN_DENY_LINES), flags: MessageFlags.Ephemeral }).catch(() => {});
      return true;
    }

    active.claimedBy = interaction.user.id;
    active.step = 1;
    active.riskScore = 0;

    // Build first scenario
    const s = buildScenario(active.step, active.depth);
    active.state = {
      prompt: s.prompt,
      narration: s.narration,
      options: s.options,
    };

    await upsertActiveToDb();

    const embed = buildStepEmbed({
      step: active.step,
      depth: active.depth,
      prompt: s.prompt,
      narration: s.narration,
      claimedBy: active.claimedBy,
    });

    const comp = buildChoiceComponents(active.riftId, active.step);

    await interaction.editReply({ embeds: [embed], components: comp }).catch(() => {});
    return true;
  }

  // From here, must be claimed.
  if (!active.claimedBy) {
    await interaction.followUp({ content: "You need to enter the Rift first.", flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }

  if (interaction.user.id !== active.claimedBy) {
    await interaction.followUp({ content: "This Rift is already claimed.", flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }

  if (action === "choose") {
    const step = Number(parts[3] || 0);
    const choiceIdx = Number(parts[4] || 0);

    if (step !== active.step) {
      await interaction.followUp({ content: "That choice is no longer valid.", flags: MessageFlags.Ephemeral }).catch(() => {});
      return true;
    }

    const option = active.state?.options?.[choiceIdx - 1];
    if (!option) {
      await interaction.followUp({ content: "Invalid choice.", flags: MessageFlags.Ephemeral }).catch(() => {});
      return true;
    }

    // Apply risk
    active.riskScore += Number(option.riskDelta || 0);

    // Progress
    if (active.step >= active.depth) {
      // Final outcome
      const outcome = rollOutcome(active.hiddenTier, active.riskScore);

      if (outcome === "nothing") {
        const embed = buildOutcomeEmbed({
          claimedBy: active.claimedBy,
          outcomeTitle: "🕳️ The Rift Falls Silent",
          outcomeBody: T.pick(T.NOTHING_LINES),
        });
        await interaction.editReply({ embeds: [embed], components: [] }).catch(() => {});
        await clearActiveFromDb(active.guildId).catch(() => {});
        active = null;
        return true;
      }

      if (outcome === "blessing") {
        const reward = blessingReward(active.hiddenTier, active.riskScore);
        await economy.creditUser(active.guildId, active.claimedBy, reward, "echo_rift_blessing", {
          tier: active.hiddenTier,
          risk: active.riskScore,
        }).catch(() => {});

        let body = T.pick(T.BLESSING_LINES).replace("{reward}", `$${reward.toLocaleString()}`);

        // Echo's Chosen roll
        if (rollChosenChance(active.hiddenTier)) {
          const perk = pickChosenPerk();
          const exp = Date.now() + CONFIG.chosenDurationMs;

          // Assign role + persist
          const guild = interaction.guild;
          const member = guild ? await guild.members.fetch(active.claimedBy).catch(() => null) : null;
          if (member) {
            const me = guild.members.me;
            if (me?.permissions?.has?.("ManageRoles")) {
              await member.roles.add(CONFIG.chosenRoleId, "Echo's Chosen").catch(() => {});
            }
          }
          await setChosen(active.guildId, active.claimedBy, perk, exp).catch(() => {});

          body += `\n\n🌟 **Echo’s Chosen** — for **48 hours**.\nPerk: **${perk.replace(/_/g, " ")}**.`;
        }

        const embed = buildOutcomeEmbed({
          claimedBy: active.claimedBy,
          outcomeTitle: "🕳️ Echo’s Judgement — Blessing",
          outcomeBody: body,
        });

        await interaction.editReply({ embeds: [embed], components: [] }).catch(() => {});
        await clearActiveFromDb(active.guildId).catch(() => {});
        active = null;
        return true;
      }

      // Curse
      const c = await applyCurse(interaction.client, active.guildId, active.claimedBy, active.hiddenTier, active.riskScore);
      const curseLine = T.pick(T.CURSE_LINES).replace("{curse}", c.text);

      const embed = buildOutcomeEmbed({
        claimedBy: active.claimedBy,
        outcomeTitle: "🕳️ Echo’s Judgement — Curse",
        outcomeBody: curseLine,
      });

      await interaction.editReply({ embeds: [embed], components: [] }).catch(() => {});
      await clearActiveFromDb(active.guildId).catch(() => {});
      active = null;
      return true;
    }

    // Next step
    active.step += 1;
    const s = buildScenario(active.step, active.depth);
    active.state = {
      prompt: s.prompt,
      narration: s.narration,
      options: s.options,
    };

    await upsertActiveToDb();

    const embed = buildStepEmbed({
      step: active.step,
      depth: active.depth,
      prompt: s.prompt,
      narration: s.narration,
      claimedBy: active.claimedBy,
    });

    const comp = buildChoiceComponents(active.riftId, active.step);

    await interaction.editReply({ embeds: [embed], components: comp }).catch(() => {});
    return true;
  }

  return true;
}

// ----------------------------
// Public API
// ----------------------------

async function startScheduler(client) {
  // Recover active rift after restart
  try {
    await resumeFromDb(client);
  } catch (e) {
    console.warn("[ECHO-RIFT] resumeFromDb failed:", e?.message || e);
  }

  // Start daily spawn loop
  scheduleDailySpawn(client).catch(() => {});

  // Process Echo's Chosen ticks + expiry
  setInterval(() => {
    processChosenTick(client).catch(() => {});
  }, 5 * 60_000);
}

module.exports = {
  startScheduler,
  handleInteraction,

  // exported for testing/tweaks
  _CONFIG: CONFIG,
};
