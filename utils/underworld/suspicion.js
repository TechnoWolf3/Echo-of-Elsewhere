const { pool } = require("../db");
const config = require("../../data/underworld/config");

const suspicionConfig = config.UNDERWORLD_SUSPICION || {};
const maxSuspicion = Number(suspicionConfig.max || config.MAX_SUSPICION || 100);

function clamp(value, min = 0, max = maxSuspicion) {
  return Math.min(max, Math.max(min, Number(value || 0)));
}

function getSuspicionBand(score) {
  const value = clamp(score);
  if (value <= 19) return { id: "quiet", label: "Quiet", min: 0, max: 19 };
  if (value <= 39) return { id: "watched", label: "Watched", min: 20, max: 39 };
  if (value <= 59) return { id: "noticed", label: "Noticed", min: 40, max: 59 };
  if (value <= 79) return { id: "hot", label: "Hot", min: 60, max: 79 };
  return { id: "burned", label: "Burned", min: 80, max: 100 };
}

async function ensureUnderworldUserSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS underworld_users (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      suspicion NUMERIC NOT NULL DEFAULT 0,
      last_activity_at TIMESTAMPTZ,
      last_decay_at TIMESTAMPTZ,
      last_reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, user_id)
    )
  `);
}

async function ensureRow(guildId, userId) {
  await ensureUnderworldUserSchema();
  await pool.query(
    `INSERT INTO underworld_users (guild_id, user_id, suspicion, last_decay_at)
     VALUES ($1, $2, 0, NOW())
     ON CONFLICT (guild_id, user_id) DO NOTHING`,
    [String(guildId), String(userId)]
  );
}

function calculateDecayedSuspicion(row, now = new Date()) {
  const decay = suspicionConfig.decay || {};
  const current = clamp(row?.suspicion);
  if (!decay.enabled) return { suspicion: current, decayed: 0, lastDecayAt: now };

  const graceMs = Number(decay.graceHours || 0) * 60 * 60 * 1000;
  const amountPerHour = Number(decay.amountPerHour || 0);
  const min = Number(decay.min || 0);
  const lastActivityAt = row?.last_activity_at ? new Date(row.last_activity_at) : null;
  const lastDecayAt = row?.last_decay_at ? new Date(row.last_decay_at) : null;
  const decayStartsAt = lastActivityAt ? new Date(lastActivityAt.getTime() + graceMs) : lastDecayAt;
  const from = new Date(Math.max(Number(decayStartsAt || 0), Number(lastDecayAt || 0)));
  const elapsedHours = Math.floor(Math.max(0, now.getTime() - from.getTime()) / (60 * 60 * 1000));
  if (!elapsedHours || amountPerHour <= 0) {
    return { suspicion: current, decayed: 0, lastDecayAt: lastDecayAt || now };
  }

  const decayed = Math.min(current, elapsedHours * amountPerHour);
  return {
    suspicion: clamp(current - decayed, min, maxSuspicion),
    decayed,
    lastDecayAt: new Date(from.getTime() + elapsedHours * 60 * 60 * 1000),
  };
}

async function decayUnderworldSuspicion(guildId, userId) {
  await ensureRow(guildId, userId);
  const res = await pool.query(
    `SELECT suspicion, last_activity_at, last_decay_at
     FROM underworld_users
     WHERE guild_id=$1 AND user_id=$2`,
    [String(guildId), String(userId)]
  );
  const row = res.rows?.[0] || {};
  const next = calculateDecayedSuspicion(row);
  if (Number(next.decayed || 0) > 0) {
    await pool.query(
      `UPDATE underworld_users
       SET suspicion=$3, last_decay_at=$4, updated_at=NOW()
       WHERE guild_id=$1 AND user_id=$2`,
      [String(guildId), String(userId), next.suspicion, next.lastDecayAt]
    );
  }
  return next.suspicion;
}

async function getUnderworldSuspicion(guildId, userId) {
  const suspicion = await decayUnderworldSuspicion(guildId, userId);
  return {
    suspicion,
    band: getSuspicionBand(suspicion),
  };
}

async function setUnderworldSuspicion(guildId, userId, amount, reason = null, { recordActivity = false } = {}) {
  await ensureRow(guildId, userId);
  const value = clamp(amount);
  await pool.query(
    `UPDATE underworld_users
     SET suspicion=$3,
         last_reason=$4,
         last_decay_at=NOW(),
         last_activity_at=CASE WHEN $5 THEN NOW() ELSE last_activity_at END,
         updated_at=NOW()
     WHERE guild_id=$1 AND user_id=$2`,
    [String(guildId), String(userId), value, reason, Boolean(recordActivity)]
  );
  return value;
}

async function addUnderworldSuspicion(guildId, userId, amount, reason = null, { recordActivity = true } = {}) {
  const current = await decayUnderworldSuspicion(guildId, userId);
  return setUnderworldSuspicion(guildId, userId, current + Number(amount || 0), reason, { recordActivity });
}

async function recordUnderworldActivity(guildId, userId, reason = null) {
  await ensureRow(guildId, userId);
  await pool.query(
    `UPDATE underworld_users
     SET last_activity_at=NOW(), last_reason=$3, updated_at=NOW()
     WHERE guild_id=$1 AND user_id=$2`,
    [String(guildId), String(userId), reason]
  );
}

module.exports = {
  ensureUnderworldUserSchema,
  getUnderworldSuspicion,
  addUnderworldSuspicion,
  setUnderworldSuspicion,
  decayUnderworldSuspicion,
  recordUnderworldActivity,
  getSuspicionBand,
  clampSuspicion: clamp,
};
