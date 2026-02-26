// utils/echoRift.js
// Echo Rift: daily random event with multi-step choices, blessings/curses, and rare Echo's Chosen.
// Restart-safe (DB-backed, no collectors).

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');

const { pool } = require('./db');
const economy = require('./economy');
const jail = require('./jail');
const echoCurses = require('./echoCurses');

// ====== CONFIG ======
// NOTE: channel/role IDs are hard-coded here for now.
// If you ever want them in .env, I can refactor in 2 minutes.
const RIFT_CHANNEL_ID = '1449217901306581074';
const CHOSEN_ROLE_ID = '1476440178687082567';

const CONFIG = {
  spawnWindow: { startHour: 10, endHour: 22 },

  // Toggle chance vs guaranteed:
  chanceModeEnabled: false, // guaranteed daily
  // chanceModeEnabled: true,
  chancePerDay: 0.7,

  openMs: 60 * 60_000,

  chosenDurationMs: 48 * 60 * 60_000,
  chosenTickMs: 4 * 60 * 60_000,
  chosenWealthTickAmount: 20_000,
};

let _loopTimer = null;
let _chosenTimer = null;

// ====== FLAVOUR POOLS ======
const SPAWN_LINES = [
  'A tear opens where reality forgot to stitch itself closed.',
  'The air bends. The silence feels... expectant.',
  'You feel it before you see it - a Rift, hungry for attention.',
  'Something unseen scratches at the edge of your world.',
  'A crack of dark light ripples across the channel like a blink.',
  'Echo is nearby. You can feel the weight of it.',
];

const ENTER_DENY_CHOSEN = [
  "You've proven your worth. Echo asks that you rest.",
  "Echo's Chosen do not gamble with divinity twice.",
  'Your blessing still hums. Come back when it fades.',
  'The Rift turns away from you - not fear... refusal.',
  'Not now. Echo\'s mark is still fresh.',
];

const ENTER_DENY_TAX = [
  'You try to step forward, but the debt around your throat tightens.',
  "Echo laughs. 'Pay what you owe before you reach for more.'",
  'The Rift rejects you. The smell of unpaid tribute lingers.',
  'You reach out - and the Rift slaps your hand away.',
];

const BLESSING_LINES = [
  "Echo's gaze lingers... and the Rift purrs approval.",
  'The darkness folds into something like a smile.',
  'For once, you chose well. The Rift rewards audacity.',
  'Echo speaks without words: Accepted.',
];

const NOTHING_LINES = [
  "You shout loud... but there's no Echo.",
  'The Rift stares back, unimpressed, then stills.',
  'Silence. Like you were never here.',
  'Nothing happens. That might be worse.',
];

const CURSE_LINES = [
  'Your actions have angered Echo - and the Rift bites back.',
  'Echo disapproves. Reality agrees.',
  'You feel the judgement before you understand it.',
  "Echo's patience breaks. So do you.",
];

const SCENARIOS = [
  {
    prompt: 'Three doors stand in the Rift. None have handles. All feel warm.',
    options: ['Press the left door', 'Whisper to the center', 'Kick the right door'],
    risk: [0, 1, 2],
  },
  {
    prompt: 'A coin floats, rotating slowly. It has no faces.',
    options: ['Bite it', 'Flip it', 'Swallow it'],
    risk: [0, 1, 2],
  },
  {
    prompt: "A shadow offers a hand. You cannot see what it's holding.",
    options: ['Shake the hand', 'Refuse politely', 'Take what it holds'],
    risk: [1, 0, 2],
  },
  {
    prompt: 'You hear your name spoken backwards - by your own voice.',
    options: ['Answer it', 'Laugh at it', 'Beg it to stop'],
    risk: [1, 0, 2],
  },
  {
    prompt: 'A candle burns underwater. The flame looks thirsty.',
    options: ['Blow it out', 'Drink from it', 'Let it burn'],
    risk: [1, 2, 0],
  },
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function fmtMoney(n) {
  const v = Math.max(0, Math.floor(Number(n) || 0));
  return `$${v.toLocaleString('en-AU')}`;
}

// ====== SYDNEY TIME HELPERS ======
function sydneyParts(ms = Date.now()) {
  const dtf = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(dtf.formatToParts(new Date(ms)).map(p => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function sydneyLocalToUtcMs({ year, month, day, hour, minute, second }) {
  // Approx inversion using Intl formatting.
  const desiredAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const probe = new Date(desiredAsUtc);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Australia/Sydney',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p = Object.fromEntries(fmt.formatToParts(probe).map(x => [x.type, x.value]));
  const observedAsUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  const delta = observedAsUtc - desiredAsUtc;
  return desiredAsUtc - delta;
}

function randomTimeInWindowForDay(parts) {
  const { startHour, endHour } = CONFIG.spawnWindow;
  const start = sydneyLocalToUtcMs({ year: parts.year, month: parts.month, day: parts.day, hour: startHour, minute: 0, second: 0 });
  const end = sydneyLocalToUtcMs({ year: parts.year, month: parts.month, day: parts.day, hour: endHour, minute: 0, second: 0 });
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  return lo + Math.floor(Math.random() * Math.max(1, hi - lo));
}

async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS echo_rift_schedule (
      guild_id TEXT PRIMARY KEY,
      next_spawn_at TIMESTAMPTZ,
      chance_mode BOOLEAN NOT NULL DEFAULT FALSE,
      chance_per_day DOUBLE PRECISION NOT NULL DEFAULT 1.0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS echo_rifts (
      guild_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      entered_user_id TEXT NULL,
      tier INT NULL,
      step INT NOT NULL DEFAULT 0,
      max_steps INT NOT NULL DEFAULT 0,
      risk INT NOT NULL DEFAULT 0,
      state JSONB NOT NULL DEFAULT '{}'::jsonb,
      PRIMARY KEY (guild_id, message_id)
    );
    CREATE INDEX IF NOT EXISTS idx_echo_rifts_active ON echo_rifts (guild_id, expires_at);

    CREATE TABLE IF NOT EXISTS echo_chosen (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      perk TEXT NOT NULL,
      next_tick_at TIMESTAMPTZ NULL,
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_echo_chosen_expires ON echo_chosen (expires_at);
  `);
}

async function getSchedule(guildId) {
  await ensureTables();
  const res = await pool.query('SELECT * FROM echo_rift_schedule WHERE guild_id=$1', [String(guildId)]);
  return res.rows[0] || null;
}

async function setSchedule(guildId, { nextSpawnAt, chanceMode, chancePerDay } = {}) {
  await ensureTables();
  await pool.query(
    `INSERT INTO echo_rift_schedule (guild_id, next_spawn_at, chance_mode, chance_per_day, updated_at)
     VALUES ($1,$2,$3,$4,NOW())
     ON CONFLICT (guild_id)
     DO UPDATE SET next_spawn_at=EXCLUDED.next_spawn_at, chance_mode=EXCLUDED.chance_mode, chance_per_day=EXCLUDED.chance_per_day, updated_at=NOW()`,
    [
      String(guildId),
      nextSpawnAt ? new Date(nextSpawnAt) : null,
      typeof chanceMode === 'boolean' ? chanceMode : CONFIG.chanceModeEnabled,
      typeof chancePerDay === 'number' ? chancePerDay : CONFIG.chancePerDay,
    ]
  );
}

async function getActiveRift(guildId) {
  await ensureTables();
  const res = await pool.query(
    `SELECT * FROM echo_rifts
     WHERE guild_id=$1 AND expires_at > NOW()
     ORDER BY created_at DESC
     LIMIT 1`,
    [String(guildId)]
  );
  return res.rows[0] || null;
}

async function insertRift(guildId, messageId, channelId, expiresAt) {
  await ensureTables();
  await pool.query(
    `INSERT INTO echo_rifts (guild_id, message_id, channel_id, expires_at)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (guild_id, message_id) DO NOTHING`,
    [String(guildId), String(messageId), String(channelId), new Date(expiresAt)]
  );
}

async function updateRift(guildId, messageId, patch) {
  await ensureTables();
  const fields = [];
  const vals = [String(guildId), String(messageId)];
  let i = 3;
  for (const [k, v] of Object.entries(patch || {})) {
    fields.push(`${k}=$${i++}`);
    vals.push(v);
  }
  if (!fields.length) return;
  await pool.query(`UPDATE echo_rifts SET ${fields.join(', ')} WHERE guild_id=$1 AND message_id=$2`, vals);
}

async function deleteRift(guildId, messageId) {
  await ensureTables();
  await pool.query('DELETE FROM echo_rifts WHERE guild_id=$1 AND message_id=$2', [String(guildId), String(messageId)]);
}

function buildSpawnEmbed(expiresAtMs) {
  const unix = Math.floor(expiresAtMs / 1000);
  return new EmbedBuilder()
    .setTitle('🕳️ The Echo Rift')
    .setDescription([
      pick(SPAWN_LINES),
      '',
      `It will collapse <t:${unix}:R>.`,
      '_Only one soul may enter._',
    ].join('\n'));
}

function buildEnterRow(disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('rift:enter')
      .setLabel('Enter the Rift')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🕳️')
      .setDisabled(disabled)
  );
}

function buildScenarioEmbed({ userId, step, maxSteps, prompt, lastResult }) {
  const head = `**<@${userId}> has entered the Rift.**`;
  const prog = `Step **${Math.min(step + 1, maxSteps)} / ${maxSteps}**`;
  const bits = [head, prog, ''];
  if (lastResult) {
    bits.push(`_${lastResult}_`);
    bits.push('');
  }
  bits.push(prompt);
  return new EmbedBuilder().setTitle('🕳️ The Echo Rift').setDescription(bits.join('\n'));
}

function buildChoiceRow(step, options) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`rift:choice:${step}:0`).setStyle(ButtonStyle.Secondary).setLabel(options[0]),
    new ButtonBuilder().setCustomId(`rift:choice:${step}:1`).setStyle(ButtonStyle.Secondary).setLabel(options[1]),
    new ButtonBuilder().setCustomId(`rift:choice:${step}:2`).setStyle(ButtonStyle.Secondary).setLabel(options[2])
  );
}

function buildFinalEmbed({ userId, outcomeText, resultLine }) {
  return new EmbedBuilder()
    .setTitle('🕳️ The Echo Rift')
    .setDescription([
      `**<@${userId}> stands at the edge of consequence.**`,
      '',
      `_${outcomeText}_`,
      '',
      resultLine,
    ].join('\n'));
}

function rollTier() {
  const r = Math.random();
  if (r < 0.55) return 1;
  if (r < 0.85) return 2;
  if (r < 0.97) return 3;
  return 4;
}

function resolveOutcome(tier, risk) {
  const baseCurse = [0, 0.20, 0.30, 0.45, 0.60][tier];
  const baseNothing = [0, 0.30, 0.22, 0.15, 0.08][tier];
  const curse = Math.min(0.90, baseCurse + (risk * 0.08));
  const nothing = Math.max(0.02, baseNothing - (risk * 0.03));
  const bless = Math.max(0.02, 1 - curse - nothing);
  const r = Math.random();
  if (r < bless) return 'blessing';
  if (r < bless + nothing) return 'nothing';
  return 'curse';
}

function blessingAmount(tier, risk) {
  const base = [0, 6_000, 15_000, 35_000, 75_000][tier];
  const variance = [0, 6_000, 12_000, 25_000, 60_000][tier];
  const safeBonus = Math.max(0, 2 - risk) * 2_500;
  return Math.max(1000, base + safeBonus + Math.floor(Math.random() * variance));
}

function cursePick(tier) {
  const r = Math.random();
  if (tier === 4 && r < 0.02) return 'wallet_wipe';
  if (r < 0.40) return 'blood_tax';
  if (r < 0.75) return 'jail';
  return 'fees_lock';
}

function bloodTaxAmount(tier) {
  const base = [0, 12_000, 28_000, 55_000, 90_000][tier];
  return base + Math.floor(Math.random() * base * 0.5);
}

function feesLockAmount(tier) {
  const base = [0, 6_000, 14_000, 30_000, 60_000][tier];
  return base + Math.floor(Math.random() * base * 0.4);
}

function jailMinutes(tier) {
  const base = [0, 8, 20, 45, 90][tier];
  return base + Math.floor(Math.random() * base);
}

async function grantChosen(guild, userId) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return { ok: false, reason: 'member_not_found' };
  if (member.roles.cache.has(CHOSEN_ROLE_ID)) return { ok: false, reason: 'already_chosen' };

  const perkPool = ['wealth', 'casino_double', 'blind_eye'];
  const perk = perkPool[Math.floor(Math.random() * perkPool.length)];
  const expiresAt = new Date(Date.now() + CONFIG.chosenDurationMs);
  const nextTickAt = perk === 'wealth' ? new Date(Date.now() + CONFIG.chosenTickMs) : null;

  await pool.query(
    `INSERT INTO echo_chosen (guild_id, user_id, expires_at, perk, next_tick_at)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (guild_id, user_id)
     DO UPDATE SET expires_at=EXCLUDED.expires_at, perk=EXCLUDED.perk, next_tick_at=EXCLUDED.next_tick_at`,
    [guild.id, String(userId), expiresAt, perk, nextTickAt]
  );

  await member.roles.add(CHOSEN_ROLE_ID, "Echo's Chosen").catch(() => {});
  return { ok: true, perk, expiresAt };
}

async function sweepChosen(client) {
  await ensureTables();
  const res = await pool.query('SELECT guild_id, user_id, expires_at FROM echo_chosen');
  for (const row of res.rows) {
    if (new Date(row.expires_at) > new Date()) continue;
    const guild = client.guilds.cache.get(row.guild_id);
    if (!guild) continue;
    const member = await guild.members.fetch(row.user_id).catch(() => null);
    if (member?.roles?.cache?.has(CHOSEN_ROLE_ID)) {
      await member.roles.remove(CHOSEN_ROLE_ID, "Echo's Chosen expired").catch(() => {});
    }
    await pool.query('DELETE FROM echo_chosen WHERE guild_id=$1 AND user_id=$2', [row.guild_id, row.user_id]);
  }
}

async function tickChosenWealth() {
  await ensureTables();
  const res = await pool.query(
    `SELECT guild_id, user_id FROM echo_chosen
     WHERE perk='wealth' AND next_tick_at IS NOT NULL AND next_tick_at <= NOW()`
  );
  for (const row of res.rows) {
    await economy.creditUser(row.guild_id, row.user_id, CONFIG.chosenWealthTickAmount, 'echo_chosen_wealth', { perk: 'wealth' }).catch(() => {});
    const next = new Date(Date.now() + CONFIG.chosenTickMs);
    await pool.query('UPDATE echo_chosen SET next_tick_at=$3 WHERE guild_id=$1 AND user_id=$2', [row.guild_id, row.user_id, next]);
  }
}

async function computeNextSpawnAt() {
  const nowMs = Date.now();
  const today = sydneyParts(nowMs);
  const todayEnd = sydneyLocalToUtcMs({ year: today.year, month: today.month, day: today.day, hour: CONFIG.spawnWindow.endHour, minute: 0, second: 0 });
  if (nowMs < todayEnd - 60_000) {
    const t = randomTimeInWindowForDay(today);
    if (t > nowMs + 10_000) return t;
  }
  const tomorrow = sydneyParts(nowMs + 24 * 60 * 60_000);
  return randomTimeInWindowForDay(tomorrow);
}

async function scheduleNext(client, guildId) {
  const sched = await getSchedule(guildId);
  const chanceMode = sched ? !!sched.chance_mode : CONFIG.chanceModeEnabled;
  const chancePerDay = sched ? Number(sched.chance_per_day || 1) : CONFIG.chancePerDay;
  const nextAt = await computeNextSpawnAt();
  await setSchedule(guildId, { nextSpawnAt: nextAt, chanceMode, chancePerDay });
}

async function spawnIfDue(client) {
  for (const guild of client.guilds.cache.values()) {
    const sched = await getSchedule(guild.id);
    if (!sched?.next_spawn_at) {
      await scheduleNext(client, guild.id);
      continue;
    }

    if (new Date(sched.next_spawn_at).getTime() > Date.now()) continue;

    const chanceMode = !!sched.chance_mode;
    const chancePerDay = Math.max(0, Math.min(1, Number(sched.chance_per_day || 1)));
    const shouldSpawn = !chanceMode || Math.random() < chancePerDay;

    if (shouldSpawn) {
      await spawnRift(client, guild.id).catch(e => console.error('[RIFT] spawn failed:', e));
    }
    await scheduleNext(client, guild.id);
  }
}

async function spawnRift(client, guildId, { channelId = RIFT_CHANNEL_ID } = {}) {
  const existing = await getActiveRift(guildId);
  if (existing) return { ok: false, reason: 'already_active' };

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return { ok: false, reason: 'channel_not_found' };

  const expiresAt = Date.now() + CONFIG.openMs;
  const msg = await channel.send({ embeds: [buildSpawnEmbed(expiresAt)], components: [buildEnterRow(false)] });
  await insertRift(guildId, msg.id, channelId, expiresAt);
  return { ok: true, messageId: msg.id, expiresAt };
}

async function collapseExpired(client) {
  await ensureTables();
  const res = await pool.query(
    `SELECT guild_id, message_id, channel_id, entered_user_id
     FROM echo_rifts
     WHERE expires_at <= NOW()`
  );
  for (const row of res.rows) {
    const channel = await client.channels.fetch(row.channel_id).catch(() => null);
    if (channel) {
      const msg = await channel.messages.fetch(row.message_id).catch(() => null);
      if (msg) {
        const e = new EmbedBuilder()
          .setTitle('🕳️ The Echo Rift')
          .setDescription(row.entered_user_id
            ? `The Rift has closed. It remembers <@${row.entered_user_id}>.`
            : 'The Rift collapses unclaimed. React faster next time.');
        await msg.edit({ embeds: [e], components: [buildEnterRow(true)] }).catch(() => {});
      }
    }
    await deleteRift(row.guild_id, row.message_id);
  }
}

async function handleInteraction(interaction) {
  const cid = String(interaction.customId || '');
  if (!cid.startsWith('rift:')) return false;
  if (!interaction.inGuild?.() || !interaction.guildId) return false;

  const guildId = interaction.guildId;
  const userId = interaction.user.id;

  if (interaction.isButton?.()) {
    try {
      if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();
    } catch {}
  }

  const messageId = interaction.message?.id;
  if (!messageId) return true;

  const r = await pool.query('SELECT * FROM echo_rifts WHERE guild_id=$1 AND message_id=$2', [guildId, messageId]);
  const rift = r.rows[0];

  if (!rift) {
    try { await interaction.followUp({ content: 'The Rift has already collapsed.', flags: MessageFlags.Ephemeral }); } catch {}
    return true;
  }

  if (new Date(rift.expires_at).getTime() <= Date.now()) {
    try { await interaction.followUp({ content: 'Too slow. The Rift is gone.', flags: MessageFlags.Ephemeral }); } catch {}
    return true;
  }

  if (cid === 'rift:enter') {
    if (rift.entered_user_id) {
      try { await interaction.followUp({ content: `Someone already entered: <@${rift.entered_user_id}>`, flags: MessageFlags.Ephemeral }); } catch {}
      return true;
    }

    const member = await interaction.guild.members.fetch(userId).catch(() => null);
    if (member?.roles?.cache?.has(CHOSEN_ROLE_ID)) {
      try { await interaction.followUp({ content: pick(ENTER_DENY_CHOSEN), flags: MessageFlags.Ephemeral }); } catch {}
      return true;
    }

    const tax = await echoCurses.getCurse(guildId, userId, 'blood_tax');
    if (tax) {
      const extra = Math.ceil(tax.amount * 0.10);
      await echoCurses.setCurse(guildId, userId, 'blood_tax', { amount: tax.amount + extra, expiresAt: tax.expiresAt });
      try {
        await interaction.followUp({
          content: `${pick(ENTER_DENY_TAX)}\nEcho adds ${fmtMoney(extra)} to your debt for the audacity.`,
          flags: MessageFlags.Ephemeral,
        });
      } catch {}
      return true;
    }

    const tier = rollTier();
    const maxSteps = tier + 1;
    const first = SCENARIOS[Math.floor(Math.random() * SCENARIOS.length)];
    const state = { lastResult: null, scenarios: [first] };

    await updateRift(guildId, messageId, {
      entered_user_id: userId,
      tier,
      step: 0,
      max_steps: maxSteps,
      risk: 0,
      state: JSON.stringify(state),
    });

    await interaction.message.edit({
      embeds: [buildScenarioEmbed({ userId, step: 0, maxSteps, prompt: first.prompt, lastResult: null })],
      components: [buildChoiceRow(0, first.options)],
    }).catch(() => {});

    return true;
  }

  if (cid.startsWith('rift:choice:')) {
    if (rift.entered_user_id !== userId) {
      try { await interaction.followUp({ content: 'This Rift is not yours.', flags: MessageFlags.Ephemeral }); } catch {}
      return true;
    }

    const parts = cid.split(':');
    const step = Number(parts[2] || 0);
    const opt = Number(parts[3] || 0);
    if (!Number.isFinite(step) || !Number.isFinite(opt) || opt < 0 || opt > 2) return true;
    if (step !== Number(rift.step || 0)) {
      try { await interaction.followUp({ content: 'The Rift ignores that choice. (stale)', flags: MessageFlags.Ephemeral }); } catch {}
      return true;
    }

    const tier = Number(rift.tier || 1);
    const maxSteps = Number(rift.max_steps || (tier + 1));
    const state = (() => {
      try { return typeof rift.state === 'object' ? rift.state : JSON.parse(rift.state || '{}'); } catch { return {}; }
    })();
    const scenarios = Array.isArray(state.scenarios) ? state.scenarios : [];
    const curScenario = scenarios[step] || SCENARIOS[0];
    const addedRisk = Number((curScenario.risk || [1, 1, 1])[opt] ?? 1);
    const newRisk = Number(rift.risk || 0) + addedRisk;

    const responseLines = [
      'The Rift shivers.',
      'Something unseen exhales.',
      'Echo tilts its head.',
      'The air tastes metallic.',
      'Reality creaks.',
    ];
    const lastResult = `${pick(responseLines)} (${['left', 'center', 'right'][opt] || 'choice'})`;
    const nextStep = step + 1;

    if (nextStep >= maxSteps) {
      const outcome = resolveOutcome(tier, newRisk);
      let resultLine = '';
      let outcomeText = '';

      if (outcome === 'blessing') {
        outcomeText = pick(BLESSING_LINES);
        const amt = blessingAmount(tier, newRisk);
        await economy.creditUser(guildId, userId, amt, 'echo_rift_blessing', { tier, risk: newRisk }).catch(() => {});
        resultLine = `🟢 Blessing: Echo has blessed you with ${fmtMoney(amt)}.`;

        if (Math.random() < 0.03) {
          const grant = await grantChosen(interaction.guild, userId);
          if (grant.ok) {
            resultLine += `\n\n🌟 Echo's Chosen - for 48 hours. (Perk: ${grant.perk})`;
          }
        }
      } else if (outcome === 'nothing') {
        outcomeText = pick(NOTHING_LINES);
        resultLine = '🟡 Nothing: The Rift gives you nothing but a lesson.';
      } else {
        outcomeText = pick(CURSE_LINES);
        const c = cursePick(tier);

        if (c === 'wallet_wipe') {
          const bal = await economy.getBalance(guildId, userId).catch(() => 0);
          const wipe = Math.floor(Number(bal || 0) * 0.20);
          if (wipe > 0) {
            await economy.tryDebitUser(guildId, userId, wipe, 'echo_rift_wallet_wipe', { tier, risk: newRisk }).catch(() => {});
          }
          resultLine = `🔴 Curse: Echo consumes 20% of your wallet (${fmtMoney(wipe)}).`;
        } else if (c === 'blood_tax') {
          const amt = bloodTaxAmount(tier);
          await echoCurses.setCurse(guildId, userId, 'blood_tax', { amount: amt, expiresAt: null });
          resultLine = `🔴 Curse: A Blood Tax of ${fmtMoney(amt)} binds you.`;
        } else if (c === 'fees_lock') {
          const amt = feesLockAmount(tier);
          await echoCurses.setCurse(guildId, userId, 'fees_lock', { amount: amt, expiresAt: null });
          resultLine = `🔴 Curse: Fees of ${fmtMoney(amt)} block you from /games until paid.`;
        } else {
          const mins = jailMinutes(tier);
          await jail.setJail(guildId, userId, mins, 'Echo Rift').catch(() => {});
          resultLine = `🔴 Curse: You are jailed for ${mins} minutes.`;
        }
      }

      await updateRift(guildId, messageId, {
        step: nextStep,
        risk: newRisk,
        state: JSON.stringify({ ...state, lastResult }),
      });

      await interaction.message.edit({
        embeds: [buildFinalEmbed({ userId, outcomeText, resultLine })],
        components: [buildEnterRow(true)],
      }).catch(() => {});

      return true;
    }

    const nextScenario = SCENARIOS[Math.floor(Math.random() * SCENARIOS.length)];
    const newState = { ...state, lastResult, scenarios: [...scenarios, nextScenario] };

    await updateRift(guildId, messageId, {
      step: nextStep,
      risk: newRisk,
      state: JSON.stringify(newState),
    });

    await interaction.message.edit({
      embeds: [buildScenarioEmbed({ userId, step: nextStep, maxSteps, prompt: nextScenario.prompt, lastResult })],
      components: [buildChoiceRow(nextStep, nextScenario.options)],
    }).catch(() => {});

    return true;
  }

  return true;
}

async function debugStatus(guildId) {
  const active = await getActiveRift(guildId);
  const sched = await getSchedule(guildId);
  return { active, sched };
}

async function debugClearActive(client, guildId) {
  const active = await getActiveRift(guildId);
  if (!active) return { ok: true, cleared: false };

  const channel = await client.channels.fetch(active.channel_id).catch(() => null);
  if (channel) {
    const msg = await channel.messages.fetch(active.message_id).catch(() => null);
    if (msg) {
      const e = new EmbedBuilder().setTitle('🕳️ The Echo Rift').setDescription("Echo snaps its fingers. The Rift collapses.");
      await msg.edit({ embeds: [e], components: [buildEnterRow(true)] }).catch(() => {});
    }
  }

  await deleteRift(guildId, active.message_id);
  return { ok: true, cleared: true };
}

async function startScheduler(client) {
  await ensureTables();

  for (const g of client.guilds.cache.values()) {
    const sched = await getSchedule(g.id);
    if (!sched?.next_spawn_at) await scheduleNext(client, g.id);
  }

  const loop = async () => {
    try {
      await spawnIfDue(client);
      await collapseExpired(client);
      await sweepChosen(client);
    } catch (e) {
      console.error('[RIFT] loop failed:', e);
    } finally {
      _loopTimer = setTimeout(loop, 30_000);
      _loopTimer.unref?.();
    }
  };
  loop();

  const chosen = async () => {
    try {
      await tickChosenWealth();
    } catch (e) {
      console.error('[RIFT] chosen tick failed:', e);
    } finally {
      _chosenTimer = setTimeout(chosen, 5 * 60_000);
      _chosenTimer.unref?.();
    }
  };
  chosen();
}

module.exports = {
  startScheduler,
  handleInteraction,
  spawnRift,
  debugStatus,
  debugClearActive,
  CONFIG,
  RIFT_CHANNEL_ID,
  CHOSEN_ROLE_ID,
  setSchedule,
  getSchedule,
};
