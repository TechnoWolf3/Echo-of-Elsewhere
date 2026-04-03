const { pool } = require("../db");
const crops = require("../../data/farming/crops");
const config = require("../../data/farming/config");

function getCurrentSeason() {
  const index = Math.floor(Date.now() / config.SEASON_LENGTH_MS) % 4;
  return config.SEASONS[index];
}

async function ensureFarm(guildId, userId) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS farms (
      guild_id TEXT,
      user_id TEXT,
      data JSONB,
      PRIMARY KEY (guild_id, user_id)
    )
  `);

  const res = await pool.query(
    `SELECT data FROM farms WHERE guild_id=$1 AND user_id=$2`,
    [guildId, userId]
  );

  if (res.rowCount === 0) {
    const data = { fields: [] };

    await pool.query(
      `INSERT INTO farms (guild_id, user_id, data)
       VALUES ($1,$2,$3)`,
      [guildId, userId, JSON.stringify(data)]
    );

    return data;
  }

  return res.rows[0].data;
}

async function saveFarm(guildId, userId, data) {
  await pool.query(
    `UPDATE farms SET data=$1 WHERE guild_id=$2 AND user_id=$3`,
    [JSON.stringify(data), guildId, userId]
  );
}

function getAvailableCrops(fieldLevel) {
  return Object.entries(crops)
    .filter(([_, c]) => c.level <= fieldLevel)
    .map(([id, c]) => ({ id, ...c }));
}

function isCropValidForSeason(cropId) {
  const crop = crops[cropId];
  const season = getCurrentSeason();
  return crop.seasons.includes(season);
}

module.exports = {
  ensureFarm,
  saveFarm,
  getAvailableCrops,
  getCurrentSeason,
  isCropValidForSeason,
};