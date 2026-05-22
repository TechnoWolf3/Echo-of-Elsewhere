const crypto = require("node:crypto");
const { EmbedBuilder } = require("discord.js");
const { pool } = require("../db");
const { COMMUNITY_SYSTEM, DEFAULT_SETTINGS } = require("../../data/community/config");
const { randomLevelUpLine } = require("../../data/community/levelUpLines");
const { getLevelProgress, levelFromTotalXp } = require("./levelMath");
const { formatDuration } = require("./renderLevelProfile");
const standingService = require("./standing");

let schemaReady = false;

function db() {
  return pool && typeof pool.query === "function" ? pool : null;
}

function intInRange(min, max) {
  const lo = Math.ceil(Number(min) || 0);
  const hi = Math.floor(Number(max) || lo);
  const low = Math.min(lo, hi);
  const high = Math.max(lo, hi);
  return low + Math.floor(Math.random() * (high - low + 1));
}

function normalizeIdArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return [];
}

function mapSettings(row = {}) {
  return {
    enabled: row.enabled ?? DEFAULT_SETTINGS.enabled,
    levelupChannelId: row.levelup_channel_id ?? DEFAULT_SETTINGS.levelupChannelId,
    announceLevelups: row.announce_levelups ?? DEFAULT_SETTINGS.announceLevelups,
    chatXpMin: Number(row.chat_xp_min ?? DEFAULT_SETTINGS.chatXpMin),
    chatXpMax: Number(row.chat_xp_max ?? DEFAULT_SETTINGS.chatXpMax),
    chatXpCooldownSeconds: Number(row.chat_xp_cooldown_seconds ?? DEFAULT_SETTINGS.chatXpCooldownSeconds),
    minMessageLength: Number(row.min_message_length ?? DEFAULT_SETTINGS.minMessageLength),
    voiceXpMin: Number(row.voice_xp_min ?? DEFAULT_SETTINGS.voiceXpMin),
    voiceXpMax: Number(row.voice_xp_max ?? DEFAULT_SETTINGS.voiceXpMax),
    voiceXpIntervalSeconds: Number(row.voice_xp_interval_seconds ?? DEFAULT_SETTINGS.voiceXpIntervalSeconds),
    ignoredTextChannelIds: normalizeIdArray(row.ignored_text_channel_ids),
    ignoredVoiceChannelIds: normalizeIdArray(row.ignored_voice_channel_ids),
    ignoredRoleIds: normalizeIdArray(row.ignored_role_ids),
  };
}

async function ensureSchema() {
  const database = db();
  if (!database || schemaReady) return Boolean(database);

  await database.query(`
    CREATE TABLE IF NOT EXISTS community_settings (
      guild_id TEXT PRIMARY KEY,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      levelup_channel_id TEXT NULL,
      announce_levelups BOOLEAN NOT NULL DEFAULT TRUE,
      chat_xp_min INT NOT NULL DEFAULT 15,
      chat_xp_max INT NOT NULL DEFAULT 25,
      chat_xp_cooldown_seconds INT NOT NULL DEFAULT 60,
      min_message_length INT NOT NULL DEFAULT 5,
      voice_xp_min INT NOT NULL DEFAULT 8,
      voice_xp_max INT NOT NULL DEFAULT 15,
      voice_xp_interval_seconds INT NOT NULL DEFAULT 300,
      ignored_text_channel_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      ignored_voice_channel_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      ignored_role_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS community_levels (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      total_xp BIGINT NOT NULL DEFAULT 0,
      level BIGINT NOT NULL DEFAULT 1,
      message_count BIGINT NOT NULL DEFAULT 0,
      voice_seconds BIGINT NOT NULL DEFAULT 0,
      voice_xp BIGINT NOT NULL DEFAULT 0,
      chat_xp BIGINT NOT NULL DEFAULT 0,
      level_ups_count BIGINT NOT NULL DEFAULT 0,
      last_message_xp_at TIMESTAMPTZ NULL,
      last_message_hash TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS community_voice_active (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_awarded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      eligible_seconds_accumulated BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS community_activity_events (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      user_id TEXT NULL,
      source TEXT NOT NULL,
      xp BIGINT NOT NULL DEFAULT 0,
      message_count BIGINT NOT NULL DEFAULT 0,
      voice_seconds BIGINT NOT NULL DEFAULT 0,
      level_from BIGINT NULL,
      level_to BIGINT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS community_level_up_events (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      level BIGINT NOT NULL,
      announced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, user_id, level)
    );

    CREATE INDEX IF NOT EXISTS idx_community_levels_rank
      ON community_levels (guild_id, total_xp DESC, level DESC);
    CREATE INDEX IF NOT EXISTS idx_community_events_week
      ON community_activity_events (guild_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_community_events_user_week
      ON community_activity_events (guild_id, user_id, created_at DESC);
  `);

  schemaReady = true;
  return true;
}

async function getSettings(guildId) {
  await ensureSchema();
  const database = db();
  if (!database) return { ...DEFAULT_SETTINGS };

  const res = await database.query(
    `INSERT INTO community_settings (guild_id)
     VALUES ($1)
     ON CONFLICT (guild_id) DO UPDATE SET guild_id = EXCLUDED.guild_id
     RETURNING *`,
    [String(guildId)]
  );
  return mapSettings(res.rows?.[0]);
}

async function getOrCreateLevelRow(guildId, userId) {
  await ensureSchema();
  const database = db();
  if (!database) return null;

  const res = await database.query(
    `INSERT INTO community_levels (guild_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT (guild_id, user_id) DO UPDATE SET updated_at = community_levels.updated_at
     RETURNING *`,
    [String(guildId), String(userId)]
  );
  return res.rows?.[0] ?? null;
}

function makeMessageSignature(content) {
  const normalized = String(content || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  if (!normalized) return null;
  return crypto.createHash("sha1").update(normalized).digest("hex");
}

function hasIgnoredRole(member, settings) {
  const ignored = new Set(settings.ignoredRoleIds.map(String));
  if (!ignored.size || !member?.roles?.cache) return false;
  return member.roles.cache.some((role) => ignored.has(String(role.id)));
}

function isTextMessageEligible(message, settings, currentRow) {
  if (!message?.guild || message.author?.bot) return false;
  if (!settings.enabled) return false;
  if (settings.ignoredTextChannelIds.includes(String(message.channelId))) return false;
  if (hasIgnoredRole(message.member, settings)) return false;
  const content = String(message.content || "").trim();
  if (content.length < settings.minMessageLength) return false;

  const signature = makeMessageSignature(content);
  if (!signature || signature === currentRow?.last_message_hash) return false;

  const cooldownMs = Math.max(0, settings.chatXpCooldownSeconds) * 1000;
  if (currentRow?.last_message_xp_at) {
    const lastMs = new Date(currentRow.last_message_xp_at).getTime();
    if (Number.isFinite(lastMs) && Date.now() - lastMs < cooldownMs) return false;
  }

  return true;
}

async function recordActivityEvent({ guildId, userId, source, xp = 0, messageCount = 0, voiceSeconds = 0, levelFrom = null, levelTo = null }) {
  const database = db();
  if (!database) return;
  await database.query(
    `INSERT INTO community_activity_events
       (guild_id, user_id, source, xp, message_count, voice_seconds, level_from, level_to)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      String(guildId),
      userId ? String(userId) : null,
      String(source),
      Math.floor(Number(xp) || 0),
      Math.floor(Number(messageCount) || 0),
      Math.floor(Number(voiceSeconds) || 0),
      levelFrom == null ? null : Math.floor(Number(levelFrom)),
      levelTo == null ? null : Math.floor(Number(levelTo)),
    ]
  );
}

async function addXp({ guildId, userId, amount, source, messageCount = 0, voiceSeconds = 0 }) {
  await ensureSchema();
  const database = db();
  if (!database) return null;

  const xp = Math.max(0, Math.floor(Number(amount) || 0));
  if (xp <= 0) return null;

  const before = await getOrCreateLevelRow(guildId, userId);
  const oldLevel = Number(before?.level || levelFromTotalXp(before?.total_xp || 0));
  const nextTotalXp = Number(before?.total_xp || 0) + xp;
  const newLevel = levelFromTotalXp(nextTotalXp);

  const chatXpAdd = source === "chat" ? xp : 0;
  const voiceXpAdd = source === "voice" ? xp : 0;

  const res = await database.query(
    `UPDATE community_levels
     SET total_xp = total_xp + $3,
         level = $4,
         message_count = message_count + $5,
         voice_seconds = voice_seconds + $6,
         chat_xp = chat_xp + $7,
         voice_xp = voice_xp + $8,
         level_ups_count = level_ups_count + $9,
         updated_at = NOW()
     WHERE guild_id = $1 AND user_id = $2
     RETURNING *`,
    [
      String(guildId),
      String(userId),
      xp,
      newLevel,
      Math.max(0, Math.floor(Number(messageCount) || 0)),
      Math.max(0, Math.floor(Number(voiceSeconds) || 0)),
      chatXpAdd,
      voiceXpAdd,
      Math.max(0, newLevel - oldLevel),
    ]
  );

  await recordActivityEvent({
    guildId,
    userId,
    source,
    xp,
    messageCount,
    voiceSeconds,
    levelFrom: oldLevel,
    levelTo: newLevel,
  });

  return {
    row: res.rows?.[0] ?? null,
    xp,
    oldLevel,
    newLevel,
    leveledUp: newLevel > oldLevel,
  };
}

async function updateMessageCooldown(guildId, userId, signature) {
  const database = db();
  if (!database) return;
  await database.query(
    `UPDATE community_levels
     SET last_message_xp_at = NOW(), last_message_hash = $3, updated_at = NOW()
     WHERE guild_id = $1 AND user_id = $2`,
    [String(guildId), String(userId), signature]
  );
}

async function markLevelUp(guildId, userId, level) {
  const database = db();
  if (!database) return false;
  const res = await database.query(
    `INSERT INTO community_level_up_events (guild_id, user_id, level)
     VALUES ($1,$2,$3)
     ON CONFLICT (guild_id, user_id, level) DO NOTHING`,
    [String(guildId), String(userId), Math.floor(Number(level) || 1)]
  );
  return res.rowCount > 0;
}

async function findLevelUpChannel(guild, fallbackChannel, settings) {
  if (settings.levelupChannelId) {
    const configured = await guild.channels.fetch(settings.levelupChannelId).catch(() => null);
    if (configured?.isTextBased?.()) return configured;
  }
  if (fallbackChannel?.isTextBased?.()) return fallbackChannel;
  return guild.channels.cache.find((channel) => channel?.isTextBased?.() && channel.permissionsFor(guild.members.me)?.has("SendMessages")) || null;
}

async function announceLevelUp({ guild, channel, userId, level, settings }) {
  const isNew = await markLevelUp(guild.id, userId, level);
  if (!isNew) return;

  await recordActivityEvent({
    guildId: guild.id,
    userId,
    source: "level_up",
    xp: 0,
    levelFrom: level - 1,
    levelTo: level,
  });
  await standingService.adjustStanding({
    guildId: guild.id,
    userId,
    amount: 2,
    source: "community_level_up",
    reason: "community_milestone_contribution",
    metadata: { level },
  }).catch(() => {});

  if (!settings.announceLevelups) return;

  const target = await findLevelUpChannel(guild, channel, settings);
  if (!target) return;

  const embed = new EmbedBuilder()
    .setColor(COMMUNITY_SYSTEM.color)
    .setTitle("Resonance Increased")
    .setDescription([`<@${userId}> reached **Level ${level.toLocaleString("en-AU")}**.`, randomLevelUpLine()].join("\n"))
    .setFooter({ text: COMMUNITY_SYSTEM.name })
    .setTimestamp();

  await target.send({ content: `<@${userId}>`, embeds: [embed] }).catch(() => {});
}

async function handleMessageXp(message) {
  try {
    if (!message?.guild || message.author?.bot) return null;
    await ensureSchema();
    const settings = await getSettings(message.guild.id);
    const row = await getOrCreateLevelRow(message.guild.id, message.author.id);
    if (!isTextMessageEligible(message, settings, row)) return null;

    const signature = makeMessageSignature(message.content);
    const xp = intInRange(settings.chatXpMin, settings.chatXpMax);
    const result = await addXp({
      guildId: message.guild.id,
      userId: message.author.id,
      amount: xp,
      source: "chat",
      messageCount: 1,
    });
    await updateMessageCooldown(message.guild.id, message.author.id, signature);

    if (result?.leveledUp) {
      await announceLevelUp({
        guild: message.guild,
        channel: message.channel,
        userId: message.author.id,
        level: result.newLevel,
        settings,
      });
    }
    return result;
  } catch (error) {
    console.error("[community] message XP failed:", error);
    return null;
  }
}

async function getRank(guildId, userId) {
  await ensureSchema();
  const database = db();
  if (!database) return null;
  const res = await database.query(
    `SELECT rank
     FROM (
       SELECT user_id, RANK() OVER (ORDER BY total_xp DESC, user_id ASC)::int AS rank
       FROM community_levels
       WHERE guild_id = $1 AND total_xp > 0
     ) ranked
     WHERE user_id = $2`,
    [String(guildId), String(userId)]
  );
  return res.rows?.[0]?.rank ?? null;
}

async function getWeeklyXpForUser(guildId, userId) {
  await ensureSchema();
  const database = db();
  if (!database) return 0;
  const res = await database.query(
    `SELECT COALESCE(SUM(xp), 0)::bigint AS xp
     FROM community_activity_events
     WHERE guild_id=$1 AND user_id=$2 AND created_at >= NOW() - INTERVAL '7 days'`,
    [String(guildId), String(userId)]
  );
  return Number(res.rows?.[0]?.xp || 0);
}

async function getLevelProfile({ guild, user }) {
  await ensureSchema();
  const member = await guild.members.fetch(user.id).catch(() => null);
  const row = await getOrCreateLevelRow(guild.id, user.id);
  const totalXp = Number(row?.total_xp || 0);
  const progress = getLevelProgress(totalXp);
  const [rank, weeklyXp] = await Promise.all([
    getRank(guild.id, user.id),
    getWeeklyXpForUser(guild.id, user.id),
  ]);

  return {
    guildId: guild.id,
    userId: user.id,
    user,
    member,
    displayName: member?.displayName || user.globalName || user.username,
    avatarUrl: member?.displayAvatarURL({ extension: "png", size: 256 }) || user.displayAvatarURL({ extension: "png", size: 256 }),
    progress,
    rank,
    weeklyXp,
    messageCount: Number(row?.message_count || 0),
    voiceSeconds: Number(row?.voice_seconds || 0),
    voiceXp: Number(row?.voice_xp || 0),
    chatXp: Number(row?.chat_xp || 0),
    levelUpsCount: Number(row?.level_ups_count || 0),
  };
}

async function getTopResonance(guildId, limit = 3) {
  await ensureSchema();
  const database = db();
  if (!database) return [];
  const res = await database.query(
    `SELECT user_id, total_xp, level
     FROM community_levels
     WHERE guild_id=$1 AND total_xp > 0
     ORDER BY level DESC, total_xp DESC, user_id ASC
     LIMIT $2`,
    [String(guildId), Math.max(1, Math.floor(Number(limit) || 3))]
  );
  return res.rows || [];
}

async function getWeeklyTop(guildId, limit = 3) {
  await ensureSchema();
  const database = db();
  if (!database) return [];
  const res = await database.query(
    `SELECT user_id, COALESCE(SUM(xp), 0)::bigint AS weekly_xp
     FROM community_activity_events
     WHERE guild_id=$1
       AND user_id IS NOT NULL
       AND created_at >= NOW() - INTERVAL '7 days'
     GROUP BY user_id
     HAVING COALESCE(SUM(xp), 0) > 0
     ORDER BY weekly_xp DESC, user_id ASC
     LIMIT $2`,
    [String(guildId), Math.max(1, Math.floor(Number(limit) || 3))]
  );
  return res.rows || [];
}

async function getWeeklyPulse(guildId) {
  await ensureSchema();
  const database = db();
  if (!database) return { messages: 0, voiceSeconds: 0, levelUps: 0 };
  const res = await database.query(
    `SELECT
       COALESCE(SUM(message_count), 0)::bigint AS messages,
       COALESCE(SUM(voice_seconds), 0)::bigint AS voice_seconds,
       COALESCE(SUM(CASE WHEN source = 'level_up' THEN 1 ELSE 0 END), 0)::bigint AS level_ups
     FROM community_activity_events
     WHERE guild_id=$1 AND created_at >= NOW() - INTERVAL '7 days'`,
    [String(guildId)]
  );
  return {
    messages: Number(res.rows?.[0]?.messages || 0),
    voiceSeconds: Number(res.rows?.[0]?.voice_seconds || 0),
    levelUps: Number(res.rows?.[0]?.level_ups || 0),
  };
}

async function getCommunityOverview(guild) {
  const [topResonance, weeklyTop, pulse] = await Promise.all([
    getTopResonance(guild.id, 3),
    getWeeklyTop(guild.id, 3),
    getWeeklyPulse(guild.id),
  ]);

  return { topResonance, weeklyTop, pulse };
}

function formatDurationShort(seconds) {
  return formatDuration(seconds);
}

module.exports = {
  ensureSchema,
  getSettings,
  getOrCreateLevelRow,
  addXp,
  handleMessageXp,
  announceLevelUp,
  getLevelProfile,
  getCommunityOverview,
  getWeeklyPulse,
  formatDurationShort,
  hasIgnoredRole,
  intInRange,
};
