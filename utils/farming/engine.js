const { pool } = require("../db");
const crops = require("../../data/farming/crops");
const livestock = require("../../data/farming/livestock");
const config = require("../../data/farming/config");
const weather = require("./weather");
const seasonControl = require("./seasonControl");
const { recordProgress: recordContractProgress } = require("../contracts");

async function recordFarmContractProgress(guildId, userId, metric, amount) {
  await recordContractProgress({ guildId, userId, metric, amount }).catch(() => {});
}

function getCurrentSeason(guildId = null, now = Date.now()) {
  return seasonControl.getCurrentSeason(guildId, now);
}


function getFieldSize(level) {
  return Math.max(3, Number(level || 1) + 2);
}

function getTotalPlots(fieldOrLevel) {
  const level = typeof fieldOrLevel === "number" ? fieldOrLevel : Number(fieldOrLevel?.level || 1);
  const size = getFieldSize(level);
  return size * size;
}

function getUsablePlots(field) {
  const total = getTotalPlots(field);
  const multiplier = weather.getUsablePlotMultiplier(field);
  return Math.max(1, Math.floor(total * multiplier));
}

function getTaskDurationMs(field, taskKey, baseMs = 60000) {
  const scale = getTotalPlots(field) / 9;
  let duration = Math.max(baseMs, Math.round(baseMs * scale));

  if (taskKey === "cultivate" && field?.fieldCondition?.requiresCultivation) {
    duration = Math.round(duration * 1.15);
  }

  return duration;
}

function getScaledYieldRange(crop, field) {
  const [min, max] = crop?.yield || [1, 1];
  const plotScale = getUsablePlots(field) / 9;
  const yieldMult = weather.getYieldMultiplier(field);
  const scaledMin = Math.max(1, Math.round(min * plotScale * yieldMult));
  const scaledMax = Math.max(scaledMin, Math.round(max * plotScale * yieldMult));
  return [scaledMin, scaledMax];
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

async function ensureFarmStoreItem(guildId, item) {
  await pool.query(
    `INSERT INTO store_items (guild_id, item_id, name, description, price, kind, stackable, enabled, meta, sort_order)
     VALUES ($1,$2,$3,$4,0,'produce',true,true,$5::jsonb,9500)
     ON CONFLICT (guild_id, item_id)
     DO UPDATE SET
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       kind = 'produce',
       enabled = true`,
    [guildId, item.itemId || item.id, item.name, `${item.name} produced by your farm.`, JSON.stringify({ farming: true })]
  );
}

async function addFarmItemToInventory(guildId, userId, item, qty = 1) {
  const amount = Math.max(0, Math.floor(Number(qty) || 0));
  if (amount <= 0) return;
  await ensureFarmStoreItem(guildId, item);
  await pool.query(
    `INSERT INTO user_inventory (guild_id, user_id, item_id, qty, uses_remaining, meta, updated_at)
     VALUES ($1,$2,$3,$4,0,'{}'::jsonb,NOW())
     ON CONFLICT (guild_id, user_id, item_id)
     DO UPDATE SET
       qty = user_inventory.qty + EXCLUDED.qty,
       updated_at = NOW()`,
    [guildId, userId, item.itemId || item.id, amount]
  );
}

async function addProduceToInventory(guildId, userId, crop) {
  await ensureCropStoreItem(guildId, crop);
  await addFarmItemToInventory(guildId, userId, { itemId: crop.id, name: crop.name }, 1);
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

function getLivestockTypes() {
  return Object.values(livestock);
}

function getLivestockType(typeId) {
  return livestock[typeId] || null;
}

function isBarn(field) {
  return field?.kind === "barn";
}

function getBarnCapacity(barn) {
  const type = getLivestockType(barn?.livestockType);
  if (!type) return 0;
  return Math.max(1, Number(type.capacityBase || 1) + (Math.max(1, Number(barn?.level || 1)) - 1) * 2);
}

function getBarnUpgradeCost(currentLevel) {
  return Math.round(getUpgradeCost(currentLevel) * 1.15);
}

function getBarnDemolitionCost(barn) {
  const level = Math.max(1, Number(barn?.level || 1));
  const base = Number(config.BARN_DEMOLITION_BASE_COST || 120000);
  const perLevel = Number(config.BARN_DEMOLITION_LEVEL_MULTIPLIER || 35000);
  return Math.round(base + (level - 1) * perLevel);
}

function getBarnReadyAt(barn) {
  const type = getLivestockType(barn?.livestockType);
  if (!type || !barn?.lastCollectedAt) return null;
  return Number(barn.lastCollectedAt) + Number(type.productionHours || 6) * 60 * 60 * 1000;
}

function getBarnProductionInfo(barn, now = Date.now()) {
  const type = getLivestockType(barn?.livestockType);
  if (!type) return { readyCycles: 0, readyAt: null };
  const cycleMs = Math.max(1, Number(type.productionHours || 6) * 60 * 60 * 1000);
  const lastCollectedAt = Number(barn.lastCollectedAt || barn.stockedAt || now);
  const elapsed = Math.max(0, now - lastCollectedAt);
  const readyCycles = Math.min(3, Math.floor(elapsed / cycleMs));
  return {
    readyCycles,
    readyAt: lastCollectedAt + cycleMs,
    cycleMs,
  };
}

async function convertFieldToBarn(guildId, userId, farm, fieldIndex, livestockType) {
  const field = farm.fields?.[fieldIndex];
  const type = getLivestockType(livestockType);
  if (!field) return { ok: false, reasonText: "That field does not exist." };
  if (!type) return { ok: false, reasonText: "Unknown livestock type." };
  if (isBarn(field)) return { ok: false, reasonText: "That plot is already a barn." };
  if ((field.level || 1) < Number(type.levelRequired || 1)) {
    return { ok: false, reasonText: `This livestock needs a level ${type.levelRequired} field.` };
  }
  if (field.cropId || field.state === "growing" || field.state === "ready" || field.task?.key) {
    return { ok: false, reasonText: "The field must be empty before converting it." };
  }
  if (!field.cultivated || field.fieldCondition?.requiresCultivation) {
    return { ok: false, reasonText: "Clean up and cultivate the field before converting it." };
  }

  const now = Date.now();
  farm.fields[fieldIndex] = {
    kind: "barn",
    level: field.level || 1,
    livestockType,
    animalCount: Math.max(1, Number(type.capacityBase || 1)),
    stockedAt: now,
    lastCollectedAt: now,
  };

  await saveFarm(guildId, userId, farm);
  return { ok: true, barn: farm.fields[fieldIndex], type };
}

async function collectBarnProducts(guildId, userId, farm, fieldIndex) {
  const barn = farm.fields?.[fieldIndex];
  const type = getLivestockType(barn?.livestockType);
  if (!isBarn(barn) || !type) return { ok: false, reasonText: "That barn does not exist." };

  const production = getBarnProductionInfo(barn);
  if (production.readyCycles <= 0) {
    return { ok: false, reasonText: "That barn is not ready to collect yet." };
  }

  const [min, max] = [Number(type.output?.min || 1), Number(type.output?.max || 1)];
  let qty = 0;
  const animalScale = Math.max(1, Number(barn.animalCount || 1)) / Math.max(1, Number(type.capacityBase || 1));
  for (let i = 0; i < production.readyCycles; i += 1) {
    qty += Math.max(1, Math.round(randInt(min, max) * animalScale));
  }

  barn.lastCollectedAt = Number(barn.lastCollectedAt || Date.now()) + production.readyCycles * production.cycleMs;
  await addFarmItemToInventory(guildId, userId, type.output, qty);
  await saveFarm(guildId, userId, farm);
  await recordFarmContractProgress(guildId, userId, "farm_crops_harvested", qty);
  return { ok: true, qty, itemName: type.output.name, cycles: production.readyCycles };
}

async function slaughterBarn(guildId, userId, farm, fieldIndex) {
  const barn = farm.fields?.[fieldIndex];
  const type = getLivestockType(barn?.livestockType);
  if (!isBarn(barn) || !type) return { ok: false, reasonText: "That barn does not exist." };
  const animals = Math.max(0, Math.floor(Number(barn.animalCount || 0)));
  if (animals <= 0) return { ok: false, reasonText: "There are no animals in this barn." };

  const slaughter = type.slaughter;
  const min = Number(slaughter?.minPerAnimal || 1);
  const max = Number(slaughter?.maxPerAnimal || min);
  let qty = 0;
  for (let i = 0; i < animals; i += 1) qty += randInt(min, max);

  barn.animalCount = 0;
  barn.lastCollectedAt = null;
  await addFarmItemToInventory(guildId, userId, slaughter, qty);
  await saveFarm(guildId, userId, farm);
  await recordFarmContractProgress(guildId, userId, "farm_crops_harvested", qty);
  return { ok: true, qty, itemName: slaughter.name, animals };
}

async function restockBarn(guildId, userId, farm, fieldIndex) {
  const barn = farm.fields?.[fieldIndex];
  const type = getLivestockType(barn?.livestockType);
  if (!isBarn(barn) || !type) return { ok: false, reasonText: "That barn does not exist." };
  const capacity = getBarnCapacity(barn);
  if (Number(barn.animalCount || 0) >= capacity) return { ok: false, reasonText: "That barn is already stocked." };

  barn.animalCount = capacity;
  barn.stockedAt = Date.now();
  barn.lastCollectedAt = Date.now();
  await saveFarm(guildId, userId, farm);
  return { ok: true, type, capacity };
}

async function demolishBarn(guildId, userId, farm, fieldIndex) {
  const barn = farm.fields?.[fieldIndex];
  if (!isBarn(barn)) return { ok: false, reasonText: "That barn does not exist." };

  farm.fields[fieldIndex] = {
    level: barn.level || 1,
    cropId: null,
    state: "empty",
    cultivated: false,
    plantedAt: null,
    readyAt: null,
  };

  await saveFarm(guildId, userId, farm);
  return { ok: true, field: farm.fields[fieldIndex] };
}

async function ensureFarm(guildId, userId) {
  await ensureTable();
  await seasonControl.ensureSeasonStateLoaded(guildId);

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
  const nextLevel = Number(currentLevel || 1) + 1;
  return Number(config.UPGRADE_COSTS?.[nextLevel] || 0);
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
  const currentSeason = getCurrentSeason(guildId);

  for (const field of farm.fields || []) {
    if (isBarn(field)) continue;
    updateFieldRuntime(field);

    if (field.cropId && !isCropValidForSeason(field.cropId, currentSeason)) {
      field.cropId = null;
      field.state = "spoiled";
      field.cultivated = false;
      field.plantedAt = null;
      field.readyAt = null;
      field.cropWeatherEffect = null;
      changed = true;
    }
  }

  if (changed) await saveFarm(guildId, userId, farm);
  return farm;
}

async function applySeasonRolloverToAllFarms(guildId) {
  await ensureTable();
  await seasonControl.ensureSeasonStateLoaded(guildId);

  const res = await pool.query(`SELECT user_id, data FROM farms WHERE guild_id=$1`, [guildId]);
  let changedCount = 0;

  for (const row of res.rows) {
    const farm = row.data || { fields: [] };
    if (!Array.isArray(farm.fields) || !farm.fields.length) continue;
    const before = JSON.stringify(farm);
    await applySeasonRollover(guildId, row.user_id, farm);
    if (JSON.stringify(farm) !== before) changedCount += 1;
  }

  return { changedCount, season: getCurrentSeason(guildId) };
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
  weather.clearCultivationWeather(field);

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
  if (!isCropValidForSeason(cropId, getCurrentSeason(guildId))) {
    return { ok: false, reasonText: "That crop cannot be planted in the current season." };
  }

  const now = Date.now();
  field.cropId = cropId;
  field.state = "growing";
  field.plantedAt = now;
  field.readyAt = now + crop.growthHours * 60 * 60 * 1000;
  field.cultivated = true;
  const weatherState = await weather.ensureDailyWeatherState(guildId);
  weather.maybeApplyActiveEventToField(field, weatherState);

  await saveFarm(guildId, userId, farm);
  await recordFarmContractProgress(guildId, userId, "farm_fields_planted", 1);
  return { ok: true, field };
}

function rollYield(crop, field = null) {
  const [min, max] = field ? getScaledYieldRange(crop, field) : (crop.yield || [1, 1]);
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

  const qty = rollYield(crop, field);
  for (let i = 0; i < qty; i++) {
    await addProduceToInventory(guildId, userId, crop);
  }

  const hasFieldDamage = Boolean(field.fieldCondition?.requiresCultivation);
  weather.clearHarvestWeather(field);

  if (crop.regrow && isCropValidForSeason(field.cropId) && !hasFieldDamage) {
    const now = Date.now();
    field.state = "growing";
    field.plantedAt = now;
    field.readyAt = now + (crop.regrowHours || crop.growthHours) * 60 * 60 * 1000;
  } else {
    const leavesDebris =
      Math.random() < (crop.debrisChance ?? config.NON_REGROW_DEBRIS_CHANCE_AFTER_HARVEST ?? 0.35);

    field.cropId = null;
    field.state = "empty";
    field.plantedAt = null;
    field.readyAt = null;
    field.cultivated = !leavesDebris && !hasFieldDamage;
  }

  await saveFarm(guildId, userId, farm);
  await recordFarmContractProgress(guildId, userId, "farm_crops_harvested", qty);
  return { ok: true, qty, cropName: crop.name };
}

function isFieldTaskActive(field) {
  if (isBarn(field)) return false;
  return Boolean(field?.task?.key && field?.task?.endsAt && Date.now() < Number(field.task.endsAt));
}

function getFieldTask(field) {
  return field?.task || null;
}

async function startFieldTask(guildId, userId, farm, fieldIndex, taskKey, durationMs, extra = {}) {
  const field = farm.fields?.[fieldIndex];
  if (!field) return { ok: false, reasonText: "That field does not exist." };

  if (isFieldTaskActive(field)) {
    return { ok: false, reasonText: "This field is already busy with another task." };
  }

  if (taskKey === "cultivate") {
    const forceResetCrop = Boolean(extra.forceResetCrop);
    if (!forceResetCrop && (field.cropId || field.state === "growing" || field.state === "ready")) {
      return { ok: false, reasonText: "That field is not empty." };
    }
  }

  if (taskKey === "seed") {
    const cropId = extra.cropId || null;
    if (field.state !== "empty" || !field.cultivated) {
      return { ok: false, reasonText: "That field must be empty and cultivated before seeding." };
    }
    if (field.fieldCondition?.requiresCultivation) {
      return { ok: false, reasonText: "This field is damaged. Cultivate it before planting again." };
    }
    if (!cropId) return { ok: false, reasonText: "Choose a crop before seeding." };
    const crop = crops[cropId];
    if (!crop) return { ok: false, reasonText: "Unknown crop." };
    if (crop.level > field.level) {
      return { ok: false, reasonText: "That field is not a high enough level for this crop." };
    }
    if (!isCropValidForSeason(cropId, getCurrentSeason(guildId))) {
      return { ok: false, reasonText: "That crop cannot be planted in the current season." };
    }
  }

  if (taskKey === "harvest") {
    updateFieldRuntime(field);
    if (field.state !== "ready" || !field.cropId) {
      return { ok: false, reasonText: "That field is not ready to harvest." };
    }
  }

  const now = Date.now();
  field.task = {
    key: taskKey,
    startedAt: now,
    endsAt: now + durationMs,
    ...extra,
  };

  await saveFarm(guildId, userId, farm);

  return {
    ok: true,
    task: field.task,
  };
}

async function clearFieldTask(guildId, userId, farm, fieldIndex) {
  const field = farm.fields?.[fieldIndex];
  if (!field?.task) return { ok: false };
  field.task = null;
  await saveFarm(guildId, userId, farm);
  return { ok: true };
}

async function completeFieldTask(guildId, userId, farm, fieldIndex, extra = {}) {
  const field = farm.fields?.[fieldIndex];
  if (!field) return { ok: false, reasonText: "That field does not exist." };

  if (!field.task?.key) {
    return { ok: false, reasonText: "This field has no active task." };
  }

  const taskMeta = { ...(field.task || {}), ...(extra || {}) };
  const taskKey = taskMeta.key;
  field.task = null;

  const failAndSave = async (reasonText) => {
    await saveFarm(guildId, userId, farm);
    return { ok: false, reasonText, clearedTask: taskKey };
  };

  if (taskKey === "cultivate") {
    field.cropId = null;
    field.cultivated = true;
    field.state = "empty";
    field.plantedAt = null;
    field.readyAt = null;
    weather.clearCultivationWeather(field);
    await saveFarm(guildId, userId, farm);
    return {
      ok: true,
      completedTask: taskKey,
      resetCrop: Boolean(taskMeta.forceResetCrop),
    };
  }

  if (taskKey === "seed") {
    const cropId = extra.cropId;
    const crop = crops[cropId];
    if (!crop) return failAndSave("Unknown crop.");
    if (crop.level > field.level) {
      return failAndSave("That field is not a high enough level for this crop.");
    }
    if (!field.cultivated) {
      return failAndSave("Cultivate the field first.");
    }
    if (field.state !== "empty") {
      return failAndSave("That field is not ready to be planted.");
    }
    if (!isCropValidForSeason(cropId, getCurrentSeason(guildId))) {
      return failAndSave("That crop cannot be planted in the current season.");
    }

    const now = Date.now();
    field.cropId = cropId;
    field.state = "growing";
    field.plantedAt = now;
    field.readyAt = now + crop.growthHours * 60 * 60 * 1000;
    field.cultivated = true;
    const weatherState = await weather.ensureDailyWeatherState(guildId);
    weather.maybeApplyActiveEventToField(field, weatherState, now);

    await saveFarm(guildId, userId, farm);
    await recordFarmContractProgress(guildId, userId, "farm_fields_planted", 1);
    return { ok: true, completedTask: taskKey };
  }

  if (taskKey === "harvest") {
    updateFieldRuntime(field);

    if (field.state !== "ready" || !field.cropId) {
      return failAndSave("That field is not ready to harvest.");
    }

    const crop = crops[field.cropId];
    if (!crop) return failAndSave("Unknown crop.");

    const qty = rollYield(crop, field);
    for (let i = 0; i < qty; i++) {
      await addProduceToInventory(guildId, userId, crop);
    }

    const hasFieldDamage = Boolean(field.fieldCondition?.requiresCultivation);
    weather.clearHarvestWeather(field);

    if (crop.regrow && isCropValidForSeason(field.cropId, getCurrentSeason(guildId)) && !hasFieldDamage) {
      const now = Date.now();
      field.state = "growing";
      field.plantedAt = now;
      field.readyAt = now + (crop.regrowHours || crop.growthHours) * 60 * 60 * 1000;
    } else {
      const leavesDebris =
        Math.random() < (crop.debrisChance ?? config.NON_REGROW_DEBRIS_CHANCE_AFTER_HARVEST ?? 0.35);

      field.cropId = null;
      field.state = "empty";
      field.plantedAt = null;
      field.readyAt = null;
      field.cultivated = !leavesDebris && !hasFieldDamage;
    }

    await saveFarm(guildId, userId, farm);
    await recordFarmContractProgress(guildId, userId, "farm_crops_harvested", qty);
    return { ok: true, completedTask: taskKey, qty, cropName: crop.name };
  }

  await saveFarm(guildId, userId, farm);
  return { ok: true, completedTask: taskKey };
}

async function applyFieldTaskRollovers(guildId, userId, farm) {
  let changed = false;
  const completions = [];

  for (let i = 0; i < (farm.fields || []).length; i++) {
    const field = farm.fields[i];
    if (isBarn(field)) continue;
    if (!field?.task?.key || !field.task.endsAt) continue;

    if (Date.now() >= Number(field.task.endsAt)) {
      const taskMeta = { ...(field.task || {}) };
      const result = await completeFieldTask(guildId, userId, farm, i, taskMeta);

      if (result.ok) {
        completions.push({ fieldIndex: i, ...result });
        changed = true;
      }
    }
  }

  if (changed) {
    await saveFarm(guildId, userId, farm);
  }

  return completions;
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
  applySeasonRolloverToAllFarms,
  buyField,
  cultivateField,
  upgradeField,
  plantCrop,
  harvestField,
  canRegrow,
  isFieldTaskActive,
  getFieldTask,
  startFieldTask,
  clearFieldTask,
  completeFieldTask,
  applyFieldTaskRollovers,
  getFieldSize,
  getTotalPlots,
  getUsablePlots,
  getTaskDurationMs,
  getScaledYieldRange,
  getLivestockTypes,
  getLivestockType,
  isBarn,
  getBarnCapacity,
  getBarnUpgradeCost,
  getBarnDemolitionCost,
  getBarnReadyAt,
  getBarnProductionInfo,
  convertFieldToBarn,
  collectBarnProducts,
  slaughterBarn,
  restockBarn,
  demolishBarn,
};
