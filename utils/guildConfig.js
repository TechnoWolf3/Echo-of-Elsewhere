const { EmbedBuilder, MessageFlags, PermissionFlagsBits } = require("discord.js");
const { pool } = require("./db");

const VALID_KEYS = new Set([
  "bot_channel_id",
  "feature_hub_channel_id",
  "powerball_channel_id",
  "ese_news_channel_id",
  "bot_master_role_id",
]);

const CHANNEL_KEYS = new Set([
  "bot_channel_id",
  "feature_hub_channel_id",
  "powerball_channel_id",
  "ese_news_channel_id",
]);

function normalizeKey(key) {
  const map = {
    botChannel: "bot_channel_id",
    featureHubChannel: "feature_hub_channel_id",
    powerballChannel: "powerball_channel_id",
    eseNewsChannel: "ese_news_channel_id",
    botMasterRole: "bot_master_role_id",
  };
  return map[key] || key;
}

function cleanId(value) {
  const id = String(value || "").replace(/[^0-9]/g, "");
  return id || null;
}

async function ensureSchema() {
  if (!pool?.query) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT PRIMARY KEY,
      bot_channel_id TEXT NULL,
      feature_hub_channel_id TEXT NULL,
      powerball_channel_id TEXT NULL,
      ese_news_channel_id TEXT NULL,
      bot_master_role_id TEXT NULL,
      cleared_settings JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS bot_channel_id TEXT NULL`);
  await pool.query(`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS feature_hub_channel_id TEXT NULL`);
  await pool.query(`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS powerball_channel_id TEXT NULL`);
  await pool.query(`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS ese_news_channel_id TEXT NULL`);
  await pool.query(`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS bot_master_role_id TEXT NULL`);
  await pool.query(`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS cleared_settings JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await pool.query(`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await pool.query(`ALTER TABLE guild_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
}

async function getGuildConfig(guildId) {
  if (!guildId || !pool?.query) return null;
  await ensureSchema();
  const res = await pool.query(`SELECT * FROM guild_settings WHERE guild_id=$1`, [String(guildId)]);
  return res.rows?.[0] || null;
}

function clearedSet(row) {
  const raw = row?.cleared_settings;
  if (Array.isArray(raw)) return new Set(raw.map(String));
  return new Set();
}

async function setGuildConfigValue(guildId, key, value) {
  const normalized = normalizeKey(key);
  if (!VALID_KEYS.has(normalized)) throw new Error(`Invalid guild config key: ${key}`);
  await ensureSchema();

  const id = cleanId(value);
  await pool.query(
    `
    INSERT INTO guild_settings (guild_id, ${normalized}, cleared_settings, created_at, updated_at)
    VALUES ($1, $2, '[]'::jsonb, NOW(), NOW())
    ON CONFLICT (guild_id)
    DO UPDATE SET
      ${normalized}=EXCLUDED.${normalized},
      cleared_settings=(
        SELECT COALESCE(jsonb_agg(item), '[]'::jsonb)
        FROM jsonb_array_elements_text(guild_settings.cleared_settings) AS item
        WHERE item <> $3
      ),
      updated_at=NOW()
    `,
    [String(guildId), id, normalized]
  );
  return getGuildConfig(guildId);
}

async function clearGuildConfigValue(guildId, key) {
  const normalized = normalizeKey(key);
  if (!VALID_KEYS.has(normalized)) throw new Error(`Invalid guild config key: ${key}`);
  await ensureSchema();

  await pool.query(
    `
    INSERT INTO guild_settings (guild_id, ${normalized}, cleared_settings, created_at, updated_at)
    VALUES ($1, NULL, jsonb_build_array($2::text), NOW(), NOW())
    ON CONFLICT (guild_id)
    DO UPDATE SET
      ${normalized}=NULL,
      cleared_settings=(
        SELECT COALESCE(jsonb_agg(DISTINCT item), '[]'::jsonb)
        FROM (
          SELECT jsonb_array_elements_text(guild_settings.cleared_settings) AS item
          UNION ALL
          SELECT $2::text AS item
        ) s
      ),
      updated_at=NOW()
    `,
    [String(guildId), normalized]
  );
  return getGuildConfig(guildId);
}

async function getConfigValue(guildId, key) {
  const normalized = normalizeKey(key);
  const row = await getGuildConfig(guildId);
  if (row?.[normalized]) return String(row[normalized]);
  if (row && clearedSet(row).has(normalized)) return null;
  return null;
}

async function getBotMasterRoleId(guildId) {
  return getConfigValue(guildId, "bot_master_role_id");
}

async function getConfiguredBotMasterRoleId(guildId) {
  const row = await getGuildConfig(guildId);
  return row?.bot_master_role_id ? String(row.bot_master_role_id) : null;
}

async function isBotMaster(member) {
  if (!member?.guild?.id) return false;
  const roleId = await getBotMasterRoleId(member.guild.id);
  return Boolean(roleId && member.roles?.cache?.has?.(roleId));
}

function isAdministrator(member) {
  return Boolean(member?.permissions?.has?.(PermissionFlagsBits.Administrator));
}

async function canManageConfigure(member, settingKey) {
  if (!member?.guild?.id) return false;
  const normalized = normalizeKey(settingKey);
  if (normalized === "bot_master_role_id") {
    const configured = await getConfiguredBotMasterRoleId(member.guild.id);
    if (!configured) return isAdministrator(member);
    return member.roles?.cache?.has?.(configured) === true;
  }
  return isAdministrator(member);
}

function missingConfigEmbed(requiredKeys = []) {
  const labels = requiredKeys.map((key) => {
    const normalized = normalizeKey(key);
    if (normalized === "bot_channel_id") return "Bot Channel";
    if (normalized === "feature_hub_channel_id") return "Feature Hub Channel";
    if (normalized === "powerball_channel_id") return "Powerball Channel";
    if (normalized === "ese_news_channel_id") return "ESE News Channel";
    if (normalized === "bot_master_role_id") return "Bot Master Role";
    return normalized;
  });

  const embed = new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle("Echo is not configured yet")
    .setDescription([
      "Echo has not been configured for this server yet.",
      "Please ask an Administrator to run `/configure` to set the basic bot channels.",
      "For advanced/admin features, a Bot Master role must also be configured.",
    ].join("\n"))
    .setTimestamp();

  if (labels.length) {
    embed.addFields({ name: "Missing", value: labels.map((label) => `• ${label}`).join("\n") });
  }
  return embed;
}

async function requireConfigured(interaction, requiredKeys = []) {
  const guildId = interaction?.guildId || interaction?.guild?.id;
  if (!guildId) return { ok: false, missing: requiredKeys };

  const missing = [];
  for (const key of requiredKeys) {
    const normalized = normalizeKey(key);
    const value = normalized === "bot_master_role_id"
      ? await getBotMasterRoleId(guildId)
      : await getConfigValue(guildId, normalized);
    if (!value) missing.push(normalized);
  }

  if (!missing.length) return { ok: true };

  const payload = { embeds: [missingConfigEmbed(missing)], flags: MessageFlags.Ephemeral };
  try {
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
    else await interaction.reply(payload);
  } catch (_) {}
  return { ok: false, missing };
}

async function resolveGuildTextChannel(client, guildId, key) {
  const channelId = await getConfigValue(guildId, key);
  if (!channelId) return null;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return null;
  return channel;
}

module.exports = {
  VALID_KEYS,
  CHANNEL_KEYS,
  ensureSchema,
  getGuildConfig,
  setGuildConfigValue,
  clearGuildConfigValue,
  getConfigValue,
  getBotMasterRoleId,
  getConfiguredBotMasterRoleId,
  isBotMaster,
  isAdministrator,
  canManageConfigure,
  requireConfigured,
  missingConfigEmbed,
  resolveGuildTextChannel,
};
