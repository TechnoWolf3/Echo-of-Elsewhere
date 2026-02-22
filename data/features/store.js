// data/features/store.js
/**
 * Simple DB-backed storage for persistent message references.
 * Keeps the hub alive across Railway restarts.
 */
async function ensureTable(db) {
  if (!db) throw new Error("DB pool missing on client.db");

  await db.query(`
    CREATE TABLE IF NOT EXISTS persistent_messages (
      guild_id TEXT NOT NULL,
      key TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, key)
    );
  `);
}

async function get(db, guildId, key) {
  const res = await db.query(
    `SELECT guild_id, key, channel_id, message_id FROM persistent_messages WHERE guild_id = $1 AND key = $2`,
    [guildId, key]
  );
  return res.rows?.[0] ?? null;
}

async function set(db, guildId, key, channelId, messageId) {
  await db.query(
    `
    INSERT INTO persistent_messages (guild_id, key, channel_id, message_id)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (guild_id, key)
    DO UPDATE SET channel_id = EXCLUDED.channel_id, message_id = EXCLUDED.message_id, updated_at = NOW()
    `,
    [guildId, key, channelId, messageId]
  );
}

module.exports = { ensureTable, get, set };
