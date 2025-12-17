// utils/crimeHeat.js
const { pool } = require("./db");

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

async function getCrimeHeat(guildId, userId) {
  const res = await pool.query(
    `SELECT heat, expires_at FROM crime_heat WHERE guild_id=$1 AND user_id=$2`,
    [guildId, userId]
  );

  if (res.rowCount === 0) return 0;

  const row = res.rows[0];
  const expires = new Date(row.expires_at);
  if (Number.isNaN(expires.getTime()) || Date.now() >= expires.getTime()) {
    // Expired: clean it up
    await pool.query(`DELETE FROM crime_heat WHERE guild_id=$1 AND user_id=$2`, [guildId, userId]);
    return 0;
  }

  return clamp(Number(row.heat) || 0, 0, 100);
}

async function setCrimeHeat(guildId, userId, heat, minutesToLive) {
  const h = clamp(Number(heat) || 0, 0, 100);
  const ttlMs = Math.max(1, Number(minutesToLive) || 1) * 60 * 1000;
  const expiresAt = new Date(Date.now() + ttlMs);

  await pool.query(
    `INSERT INTO crime_heat (guild_id, user_id, heat, expires_at)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (guild_id, user_id)
     DO UPDATE SET heat=EXCLUDED.heat, expires_at=EXCLUDED.expires_at`,
    [guildId, userId, h, expiresAt]
  );

  return { heat: h, expiresAt };
}

async function clearCrimeHeat(guildId, userId) {
  await pool.query(`DELETE FROM crime_heat WHERE guild_id=$1 AND user_id=$2`, [guildId, userId]);
}

function heatTTLMinutesForOutcome(outcome, { identified = false } = {}) {
  // “Linger”: minors short, major longer.
  // Store Robbery is S1, so these are modest but noticeable.
  let ttl =
    outcome === "clean" ? 8 :
    outcome === "spotted" ? 15 :
    outcome === "partial" ? 20 :
    outcome === "busted" ? 40 :
    outcome === "busted_hard" ? 75 :
    10;

  if (identified) ttl += 10; // left evidence → sticks around longer
  return ttl;
}

module.exports = {
  getCrimeHeat,
  setCrimeHeat,
  clearCrimeHeat,
  heatTTLMinutesForOutcome,
};
