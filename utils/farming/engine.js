const { pool } = require("../db");
const crops = require("../../data/farming/crops");
const config = require("../../data/farming/config");

function getCurrentSeason(now = Date.now()) {
  const index = Math.floor(now / config.SEASON_LENGTH_MS) % config.SEASONS.length;
  return config.SEASONS[index];
}

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS farms (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      PRIMARY KEY (guild_id, user_id)
    )
  `);
}

async function ensureCropStoreItem(guildId, crop) {
  await pool.query(
    `INSERT INTO store_items (guild_id, item_id, name, description, price, kind, stackable, enabled, meta, sort_order)
     VALUES ($1,$2,$3,$4,0,'produce',true,true,$5::jsonb,9500)
     ON CONFLICT (guild_id, item_id)
     DO UPDATE SET
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       kind = 'produce',
       enabled = true`,
    [guildId, crop.id, crop.name, `${crop.name} harvested from your farm.`, JSON.stringify({ farming: true })]
  );
}

async function addProduceToInventory(guildId, userId, crop) {
  await ensureCropStoreItem(guildId, crop);
  await pool.query(
    `INSERT INTO user_inventory (guild_id, user_id, item_id, qty, uses_remaining, meta, updated_at)
     VALUES ($1,$2,$3,1,0,'{}'::jsonb,NOW())
     ON CONFLICT (guild_id, user_id, item_id)
     DO UPDATE SET
       qty = user_inventory.qty + 1,
       updated_at = NOW()`,
    [guildId, userId, crop.id]
  );
}

function newField() {
  return {
    level: 1,
    cropId: null,
    state: "empty", // empty, growing, ready, spoiled
    cultivated: true,
    plantedAt: null,
    readyAt: null,
  };
}

async function ensureFarm(guildId, userId) {
  await ensureTable();

  const res = await pool.query(
    `SELECT data FROM farms WHERE guild_id=$1 AND user_id=$2`,
    [guildId, userId]
  );

  if (!res.rowCount) {
    const data = { fields: [] };
    await pool.query(
      `INSERT INTO farms (guild_id, user_id, data) VALUES ($1,$2,$3::jsonb)`,
      [guildId, userId, JSON.stringify(data)]
    );
    return data;
  }

  const data = res.rows[0].data || { fields: [] };
  if (!Array.isArray(data.fields)) data.fields = [];
  return data;
}

async function saveFarm(guildId, userId, data) {
  await ensureTable();
  await pool.query(
    `INSERT INTO farms (guild_id, user_id, data)
     VALUES ($1,$2,$3::jsonb)
     ON CONFLICT (guild_id, user_id)
     DO UPDATE SET data = EXCLUDED.data`,
    [guildId, userId, JSON.stringify(data)]
  );
  return data;
}

function getNextFieldCost(fieldCount) {
  return Math.floor(config.FIELD_BASE_COST * Math.pow(config.FIELD_COST_MULTIPLIER, Math.max(0, fieldCount)));
}

function getUpgradeCost(currentLevel) {
  return config.UPGRADE_COSTS[currentLevel] || 0;
}

function getAvailableCrops(fieldLevel) {
  return Object.entries(crops)
    .map(([key, value]) => ({ key, ...value }))
    .filter((crop) => crop.level <= fieldLevel)
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
}

function isCropValidForSeason(cropId, season = getCurrentSeason()) {
  const crop = crops[cropId];
  if (!crop) return false;
  return Array.isArray(crop.seasons) && crop.seasons.includes(season);
}

function isReady(field) {
  return field && field.readyAt && Date.now() >= Number(field.readyAt);
}

function canRegrow(field) {
  if (!field?.cropId) return false;
  return Boolean(crops[field.cropId]?.regrow);
}

function updateFieldRuntime(field) {
  if (!field) return field;
  if (field.state === "growing" && isReady(field)) {
    field.state = "ready";
  }
  return field;
}

async function applySeasonRollover(guildId, userId, farm) {
  let changed = false;

  for (const field of farm.fields || []) {
    updateFieldRuntime(field);

    if (field.cropId && !isCropValidForSeason(field.cropId)) {
      field.cropId = null;
      field.state = "spoiled";
      field.cultivated = false;
      field.plantedAt = null;
      field.readyAt = null;
      changed = true;
    }
  }

  if (changed) await saveFarm(guildId, userId, farm);
  return farm;
}

async function buyField(guildId, userId, farm) {
  if (!Array.isArray(farm.fields)) farm.fields = [];
  if (farm.fields.length >= config.MAX_FIELDS) {
    return { ok: false, reasonText: "You already own the maximum number of fields." };
  }

  farm.fields.push(newField());
  await saveFarm(guildId, userId, farm);
  return farm;
}

async function cultivateField(guildId, userId, farm, fieldIndex) {
  const field = farm.fields?.[fieldIndex];
  if (!field) return { ok: false, reasonText: "That field does not exist." };
  if (field.cropId || field.state === "growing" || field.state === "ready") {
    return { ok: false, reasonText: "That field is not empty." };
  }

  field.cultivated = true;
  field.state = "empty";

  await saveFarm(guildId, userId, farm);
  return { ok: true };
}

async function upgradeField(guildId, userId, farm, fieldIndex) {
  const field = farm.fields?.[fieldIndex];
  if (!field) return { ok: false, reasonText: "That field does not exist." };
  if (field.level >= config.MAX_FIELD_LEVEL) return { ok: false, reasonText: "This field is already max level." };
  if (field.cropId || field.state === "growing" || field.state === "ready") {
    return { ok: false, reasonText: "The field must be empty before upgrading." };
  }
  if (!field.cultivated) return { ok: false, reasonText: "Cultivate the field before upgrading it." };

  field.level += 1;
  await saveFarm(guildId, userId, farm);
  return { ok: true, field };
}

async function plantCrop(guildId, userId, farm, fieldIndex, cropId) {
  const field = farm.fields?.[fieldIndex];
  const crop = crops[cropId];

  if (!field) return { ok: false, reasonText: "That field does not exist." };
  if (!crop) return { ok: false, reasonText: "That crop does not exist." };
  if (crop.level > field.level) {
    return { ok: false, reasonText: "That field is not a high enough level for this crop." };
  }
  if (!field.cultivated) return { ok: false, reasonText: "Cultivate the field first." };
  if (field.state !== "empty" && field.state !== "spoiled") {
    return { ok: false, reasonText: "That field is not ready to be planted." };
  }
  if (!isCropValidForSeason(cropId)) {
    return { ok: false, reasonText: "That crop cannot be planted in the current season." };
  }

  const now = Date.now();
  field.cropId = cropId;
  field.state = "growing";
  field.plantedAt = now;
  field.readyAt = now + crop.growthHours * 60 * 60 * 1000;
  field.cultivated = true;

  await saveFarm(guildId, userId, farm);
  return { ok: true, field };
}

function rollYield(crop) {
  const [min, max] = crop.yield || [1, 1];
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function harvestField(guildId, userId, farm, fieldIndex) {
  const field = farm.fields?.[fieldIndex];
  if (!field) return { ok: false, reasonText: "That field does not exist." };

  updateFieldRuntime(field);

  if (field.state !== "ready" || !field.cropId) {
    return { ok: false, reasonText: "That field is not ready to harvest." };
  }

  const crop = crops[field.cropId];
  if (!crop) return { ok: false, reasonText: "Unknown crop." };

  const qty = rollYield(crop);
  for (let i = 0; i < qty; i++) {
    await addProduceToInventory(guildId, userId, crop);
  }

  if (crop.regrow && isCropValidForSeason(field.cropId)) {
    const now = Date.now();
    field.state = "growing";
    field.plantedAt = now;
    field.readyAt = now + (crop.regrowHours || crop.growthhours) * 60 * 60 * 1000;
  } else {
    const leavesDebris =
      Math.random() < (crop.debrisChance ?? config.NON_REGROW_DEBRIS_CHANCE_AFTER_HARVEST ?? 0.35);

    field.cropId = null;
    field.state = "empty";
    field.plantedAt = null;
    field.readyAt = null;
    field.cultivated = !leavesDebris;
  }

  await saveFarm(guildId, userId, farm);
  return { ok: true, qty, cropName: crop.name };
}

module.exports = {
  ensureFarm,
  saveFarm,
  getCurrentSeason,
  getNextFieldCost,
  getUpgradeCost,
  getAvailableCrops,
  isCropValidForSeason,
  applySeasonRollover,
  buyField,
  cultivateField,
  upgradeField,
  plantCrop,
  harvestField,
  canRegrow,
};