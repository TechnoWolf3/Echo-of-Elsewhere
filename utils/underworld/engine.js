const { pool } = require("../db");
const buildings = require("../../data/underworld/buildings");
const { OPERATIONS, EVENTS } = require("../../data/underworld/operations");
const upgrades = require("../../data/underworld/upgrades");
const config = require("../../data/underworld/config");
const storageGoodsConfig = require("../../data/underworld/storageGoods");
const { tryDebitBank, creditBank, addServerBank } = require("../economy");
const { setJail } = require("../jail");
const sharedSuspicion = require("./suspicion");
const underworldInventory = require("./inventory");

const BUILDING_MAP = Object.fromEntries(buildings.map((entry) => [entry.id, entry]));
const OPERATION_MAP = Object.fromEntries(OPERATIONS.map((entry) => [entry.id, entry]));

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function randInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function chooseMany(list, count) {
  const poolList = [...list];
  const chosen = [];
  while (poolList.length && chosen.length < count) {
    const index = randInt(0, poolList.length - 1);
    chosen.push(poolList.splice(index, 1)[0]);
  }
  while (chosen.length < count && list.length) {
    chosen.push(list[randInt(0, list.length - 1)]);
  }
  return chosen;
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function getBuildingDefinition(buildingId) {
  return BUILDING_MAP[buildingId] || null;
}

function getOperationDefinition(operationId) {
  return OPERATION_MAP[operationId] || null;
}

function resolveBuilding(state, buildingRef) {
  const list = Array.isArray(state?.buildings) ? state.buildings : [];
  const numericRef = typeof buildingRef === "number"
    ? buildingRef
    : (/^\d+$/.test(String(buildingRef || "")) ? Number(buildingRef) : null);

  if (Number.isInteger(numericRef)) {
    const building = list[numericRef] || null;
    return { building, buildingIndex: building ? numericRef : -1 };
  }

  const targetId = String(buildingRef || "");
  const buildingIndex = list.findIndex((entry) => String(entry?.id) === targetId);
  return {
    building: buildingIndex >= 0 ? list[buildingIndex] : null,
    buildingIndex,
  };
}

function getUpgradeLevelBonus(upgradeId, level, field) {
  const def = upgrades[upgradeId];
  if (!def) return field == null ? 0 : null;
  const hit = def.levels.find((entry) => entry.level === Number(level || 0));
  if (!hit) return field == null ? 0 : null;
  if (field == null) return hit;
  return Number(hit[field] || 0);
}

function newState() {
  return {
    buildings: [],
    smuggling: {
      inventory: {},
      vehicles: [],
      runs: [],
      history: [],
    },
  };
}

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS underworld_state (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      PRIMARY KEY (guild_id, user_id)
    )
  `);
}

async function ensureState(guildId, userId) {
  await ensureTable();
  const res = await pool.query(
    `SELECT data FROM underworld_state WHERE guild_id=$1 AND user_id=$2`,
    [guildId, userId]
  );

  if (!res.rowCount) {
    const data = newState();
    await pool.query(
      `INSERT INTO underworld_state (guild_id, user_id, data) VALUES ($1,$2,$3::jsonb)`,
      [guildId, userId, JSON.stringify(data)]
    );
    return data;
  }

  const data = res.rows[0]?.data || newState();
  if (!Array.isArray(data.buildings)) data.buildings = [];
  data.smuggling = data.smuggling || {};
  data.smuggling.inventory = data.smuggling.inventory || {};
  data.smuggling.vehicles = Array.isArray(data.smuggling.vehicles) ? data.smuggling.vehicles : [];
  data.smuggling.runs = Array.isArray(data.smuggling.runs) ? data.smuggling.runs : [];
  data.smuggling.history = Array.isArray(data.smuggling.history) ? data.smuggling.history : [];
  return data;
}

async function saveState(guildId, userId, state) {
  await ensureTable();
  await pool.query(
    `INSERT INTO underworld_state (guild_id, user_id, data)
     VALUES ($1,$2,$3::jsonb)
     ON CONFLICT (guild_id, user_id)
     DO UPDATE SET data = EXCLUDED.data`,
    [guildId, userId, JSON.stringify(state)]
  );
  return state;
}

function getBuildingSuspicion(building) {
  return clamp(Number(building?.suspicion || 0), 0, config.MAX_SUSPICION);
}

function getEventCountForBuilding(building) {
  const tier = Number(getBuildingDefinition(building.buildingId)?.tier || 1);
  return tier >= 3 ? 3 : 2;
}

function getBuildingStatus(building) {
  if (building.conversion?.completeAt && Date.now() < Number(building.conversion.completeAt)) return "converting";
  if (building.activeRun?.pendingEvent) return "event";
  if (building.activeRun?.status === "cooling_off") return "cooling_off";
  if (building.activeRun?.status === "awaiting_distribution") return "distribution";
  if (building.activeRun?.status === "running") return "running";
  if (building.operationType) return "ready";
  return "empty";
}

function getOperationRunDurationMs(building, operation) {
  const buildingDef = getBuildingDefinition(building.buildingId);
  const efficiencyBonus = getUpgradeLevelBonus("efficiency", building.upgrades?.efficiency, "suspicionReduction");
  const efficiencyMult = clamp(1 - efficiencyBonus * 0.01, 0.82, 1);
  return Math.round(operation.baseDurationMs * (buildingDef?.durationMultiplier || 1) * efficiencyMult);
}

function getOperationRunCost(building, operation) {
  const buildingDef = getBuildingDefinition(building.buildingId);
  return Math.round(operation.baseRunCost * (buildingDef?.sizeMultiplier || 1));
}

function getBaseGrossMultiplier(building, operation) {
  const equipmentBonus = getUpgradeLevelBonus("equipment", building.upgrades?.equipment, "outputMultiplier");
  return Number(operation.baseGrossMultiplier || 1.5) + Number(equipmentBonus || 0);
}

function buildEventSchedule(startedAt, durationMs, count) {
  const schedule = [];
  const minRatio = 0.28;
  const maxRatio = 0.82;
  for (let index = 0; index < count; index += 1) {
    const ratio = count === 1
      ? 0.55
      : minRatio + ((maxRatio - minRatio) * index) / (count - 1);
    schedule.push(Math.round(startedAt + durationMs * ratio));
  }
  return schedule;
}

function weightedPick(entries = []) {
  const usable = entries.filter((entry) => Number(entry.weight || 0) > 0);
  const total = usable.reduce((sum, entry) => sum + Number(entry.weight || 0), 0);
  if (!usable.length || total <= 0) return entries[0] || null;

  let roll = Math.random() * total;
  for (const entry of usable) {
    roll -= Number(entry.weight || 0);
    if (roll <= 0) return entry;
  }
  return usable[usable.length - 1];
}

function generateStorageGoods(building, run, operation) {
  const buildingDef = getBuildingDefinition(building.buildingId);
  const capacity = Math.max(1, Number(buildingDef?.capacity || 100));
  const maxUnits = Math.max(3, Math.floor(capacity / 8));
  const minUnits = Math.max(2, Math.floor(capacity / 14));
  const units = randInt(minUnits, maxUnits);
  const goodsPool = Array.isArray(storageGoodsConfig.items) ? storageGoodsConfig.items : [];
  const defaults = storageGoodsConfig.defaults || {};
  const items = [];
  let totalValue = 0;
  const defaultCoolOffMs = Number(defaults.coolOffMs || Number(defaults.coolOffMinutes || 60) * 60 * 1000);
  let sellReadyAt = Date.now() + defaultCoolOffMs;

  for (let i = 0; i < units; i += 1) {
    const goods = weightedPick(goodsPool) || {
      id: "fenced_goods",
      name: "Fenced goods",
      rarity: "common",
      valueMin: defaults.fallbackValueMin || 25000,
      valueMax: defaults.fallbackValueMax || 50000,
    };
    const value = randInt(Number(goods.valueMin || defaults.fallbackValueMin || 25000), Number(goods.valueMax || defaults.fallbackValueMax || 50000));
    const itemCoolOffMs = Number(goods.coolOffMs || Number(goods.coolOffMinutes || 0) * 60 * 1000);
    if (itemCoolOffMs > 0) {
      sellReadyAt = Math.max(sellReadyAt, Date.now() + itemCoolOffMs);
    }
    const existing = items.find((entry) => entry.id === goods.id);
    if (existing) {
      existing.quantity += 1;
      existing.value += value;
    } else {
      items.push({ id: goods.id, name: goods.name, rarity: goods.rarity || "common", quantity: 1, value });
    }
    totalValue += value;
  }

  const outputValue = Math.round(
    totalValue *
    Number(run.grossMultiplier || operation.baseGrossMultiplier || 1) *
    clamp(Number(run.outputMultiplier || 1), 0.4, 3)
  );

  return {
    units,
    items,
    baseValue: totalValue,
    totalValue: Math.max(Number(run.batchCost || 0), outputValue),
    generatedAt: Date.now(),
    sellReadyAt,
  };
}

function getStateSummary(state) {
  const list = Array.isArray(state?.buildings) ? state.buildings : [];
  return list.reduce(
    (acc, building) => {
      acc.total += 1;
      acc.suspicion += getBuildingSuspicion(building);
      const status = getBuildingStatus(building);
      if (status === "running") acc.running += 1;
      if (status === "event") acc.events += 1;
      if (status === "distribution") acc.distribution += 1;
      if (status === "converting") acc.converting += 1;
      return acc;
    },
    { total: 0, running: 0, events: 0, distribution: 0, converting: 0, suspicion: 0 }
  );
}

function applySuspicionDecay(building, now) {
  const beforeSuspicion = Number(building.suspicion || 0);
  const beforeTick = Number(building.suspicionTickAt || 0);
  if (!beforeTick) {
    building.suspicionTickAt = now;
    return true;
  }
  const previousTick = Number(building.suspicionTickAt || now);
  const elapsedHours = Math.max(0, (now - previousTick) / (60 * 60 * 1000));
  if (elapsedHours < 5 / 60) {
    return false;
  }
  if (!elapsedHours) {
    building.suspicionTickAt = now;
    return beforeTick !== Number(building.suspicionTickAt || 0);
  }

  let delta = -elapsedHours * config.SUSPICION_DECAY_PER_HOUR;
  if (building.operationType === "storage_house") {
    delta += elapsedHours * config.STORAGE_PASSIVE_SUSPICION_PER_HOUR;
  }

  building.suspicion = clamp(getBuildingSuspicion(building) + delta, 0, config.MAX_SUSPICION);
  building.suspicionTickAt = now;
  return beforeSuspicion !== Number(building.suspicion || 0) || beforeTick !== Number(building.suspicionTickAt || 0);
}

async function completeConversion(guildId, userId, state, building) {
  const conversion = building.conversion;
  if (!conversion) return;
  building.operationType = conversion.targetOperationId;
  building.convertedAt = conversion.completeAt;
  building.setupInvestment = Number(building.setupInvestment || 0) + Number(conversion.cost || 0);
  building.conversion = null;
  await saveState(guildId, userId, state);
}

function applyEventDelta(run, delta = {}) {
  run.outputMultiplier = Number(run.outputMultiplier || 1) + Number(delta.outputMultiplierDelta || 0);
  run.payoutMultiplierBonus = Number(run.payoutMultiplierBonus || 0) + Number(delta.payoutMultiplierDelta || 0);
  run.raidChanceBonus = Number(run.raidChanceBonus || 0) + Number(delta.raidChanceDelta || 0);
  run.suspicionBonus = Number(run.suspicionBonus || 0) + Number(delta.suspicionDelta || 0);
}

function mergeStoredGoods(existingGoods = [], newGoods = []) {
  const merged = Array.isArray(existingGoods) ? existingGoods.map((entry) => ({ ...entry })) : [];
  for (const goods of Array.isArray(newGoods) ? newGoods : []) {
    const hit = merged.find((entry) => entry.id === goods.id);
    if (hit) {
      hit.quantity = Number(hit.quantity || 0) + Number(goods.quantity || 0);
      hit.value = Number(hit.value || 0) + Number(goods.value || 0);
    } else {
      merged.push({ ...goods });
    }
  }
  return merged;
}

function addGoodsToStorage(building, storageGoods, now = Date.now()) {
  const current = building.storage || {};
  const currentStock = Number(current.stock || 0);
  const addedStock = Number(storageGoods?.units || 0);
  const currentLockedUntil = Number(current.sellLockedUntil || 0);
  const nextLockedUntil = Number(storageGoods?.sellReadyAt || now);
  const latestLock = Math.max(currentLockedUntil, nextLockedUntil) || null;
  building.storage = {
    stock: currentStock + addedStock,
    generatedAt: nextLockedUntil >= currentLockedUntil
      ? Number(storageGoods?.generatedAt || now)
      : Number(current.generatedAt || storageGoods?.generatedAt || now),
    sellLockedUntil: latestLock,
    goods: mergeStoredGoods(current.goods, storageGoods?.items),
    totalValue: Number(current.totalValue || 0) + Number(storageGoods?.totalValue || 0),
  };
  return building.storage;
}

function nextPendingEvent(run) {
  const eventId = run.eventQueue?.[run.nextEventIndex];
  if (!eventId) return null;
  const event = EVENTS[eventId];
  if (!event) return null;
  return {
    eventId,
    openedAt: Date.now(),
    deadlineAt: Date.now() + config.EVENT_WINDOW_MS,
  };
}

function applyConversionRollover(building, now) {
  if (!building.conversion?.completeAt || now < Number(building.conversion.completeAt)) {
    return false;
  }

  building.operationType = building.conversion.targetOperationId;
  building.convertedAt = building.conversion.completeAt;
  building.setupInvestment = Number(building.setupInvestment || 0) + Number(building.conversion.cost || 0);
  building.conversion = null;
  return true;
}

function applyPendingEventExpiry(run, now) {
  if (!run?.pendingEvent?.deadlineAt || now < Number(run.pendingEvent.deadlineAt)) {
    return false;
  }

  const event = EVENTS[run.pendingEvent.eventId];
  applyEventDelta(run, event?.ignored || {});
  run.eventLog = run.eventLog || [];
  run.eventLog.push({
    eventId: run.pendingEvent.eventId,
    resolution: "ignored",
    resolvedAt: now,
  });
  run.pendingEvent = null;
  run.nextEventIndex = Number(run.nextEventIndex || 0) + 1;
  return true;
}

function openDueEvent(run, now) {
  if (
    run?.status !== "running" ||
    run.pendingEvent ||
    Number(run.nextEventIndex || 0) >= Number(run.eventQueue?.length || 0)
  ) {
    return false;
  }

  const nextAt = Number(run.eventSchedule?.[run.nextEventIndex] || 0);
  if (!nextAt || now < nextAt) {
    return false;
  }

  run.pendingEvent = {
    eventId: run.eventQueue[run.nextEventIndex],
    openedAt: now,
    deadlineAt: now + config.EVENT_WINDOW_MS,
  };
  return true;
}

function finalizeCompletedRun(building, now) {
  const run = building.activeRun;
  if (!run || run.status !== "running" || run.pendingEvent) return false;
  if (now < Number(run.readyAt || 0)) return false;
  if (Number(run.nextEventIndex || 0) < Number(run.eventQueue?.length || 0)) {
    run.pendingEvent = nextPendingEvent(run);
    return Boolean(run.pendingEvent);
  }

  const operation = getOperationDefinition(run.operationId || building.operationType);
  if (operation?.storageEnabled) {
    run.storageGoods = run.storageGoods || generateStorageGoods(building, run, operation);
    addGoodsToStorage(building, run.storageGoods, now);
    building.runCooldownUntil = now + Number(config.STORAGE_RUN_COOLDOWN_MS || 15 * 60 * 1000);
    building.activeRun = null;
    return true;
  }

  run.status = "awaiting_distribution";
  return true;
}

function applyStorageCoolingOff(building, now) {
  const run = building.activeRun;
  if (!run || run.status !== "cooling_off") return false;
  const goods = run.storageGoods;
  if (!goods || Number(goods.units || 0) <= 0 || Number(goods.totalValue || 0) <= 0) {
    const operation = getOperationDefinition(run.operationId || building.operationType);
    if (!operation?.storageEnabled) return false;
    run.storageGoods = generateStorageGoods(building, run, operation);
    addGoodsToStorage(building, run.storageGoods, now);
    building.runCooldownUntil = Math.max(
      Number(building.runCooldownUntil || 0),
      Number(run.storageGoods.generatedAt || now) + Number(config.STORAGE_RUN_COOLDOWN_MS || 15 * 60 * 1000)
    );
    building.activeRun = null;
    return true;
  }
  addGoodsToStorage(building, goods, now);
  building.runCooldownUntil = Math.max(
    Number(building.runCooldownUntil || 0),
    Number(goods.generatedAt || now) + Number(config.STORAGE_RUN_COOLDOWN_MS || 15 * 60 * 1000)
  );
  building.activeRun = null;
  return true;
}

function repairStorageDistribution(building, now) {
  const run = building.activeRun;
  if (!run || run.status !== "awaiting_distribution") return false;
  const operation = getOperationDefinition(run.operationId || building.operationType);
  if (!operation?.storageEnabled) return false;
  if (run.storageGoods && Number(run.storageGoods.units || 0) > 0 && Number(run.storageGoods.totalValue || 0) > 0) {
    return false;
  }

  run.storageGoods = generateStorageGoods(building, run, operation);
  addGoodsToStorage(building, run.storageGoods, now);
  building.runCooldownUntil = Math.max(
    Number(building.runCooldownUntil || 0),
    Number(run.storageGoods.generatedAt || now) + Number(config.STORAGE_RUN_COOLDOWN_MS || 15 * 60 * 1000)
  );
  building.activeRun = null;
  return true;
}

function applyRunRuntime(building, now) {
  let changed = false;
  let safety = 0;

  while (building.activeRun && safety < 8) {
    safety += 1;
    const run = building.activeRun;

    if (applyPendingEventExpiry(run, now)) {
      changed = true;
      continue;
    }

    if (openDueEvent(run, now)) {
      changed = true;
      continue;
    }

    if (applyStorageCoolingOff(building, now)) {
      changed = true;
      continue;
    }

    if (repairStorageDistribution(building, now)) {
      changed = true;
      continue;
    }

    if (finalizeCompletedRun(building, now)) {
      changed = true;
      continue;
    }

    break;
  }

  return changed;
}

function applyBuildingRuntime(building, now) {
  let changed = false;

  if (applySuspicionDecay(building, now)) {
    changed = true;
  }

  if (applyConversionRollover(building, now)) {
    changed = true;
  }

  if (applyRunRuntime(building, now)) {
    changed = true;
  }

  return changed;
}

async function applyRuntime(guildId, userId, state) {
  const now = Date.now();
  let changed = false;

  for (const building of state.buildings || []) {
    if (applyBuildingRuntime(building, now)) {
      changed = true;
    }
  }

  if (changed) {
    await saveState(guildId, userId, state);
  }

  return state;
}

async function purchaseBuilding(guildId, userId, state, buildingId) {
  const def = getBuildingDefinition(buildingId);
  if (!def) return { ok: false, reasonText: "Unknown building type." };
  if ((state.buildings || []).length >= config.MAX_BUILDINGS) {
    return { ok: false, reasonText: "You cannot manage any more buildings right now." };
  }

  const debit = await tryDebitBank(guildId, userId, def.purchaseCost, "underworld_building_purchase", {
    enterprise: "underworld",
    buildingId,
  });

  if (!debit.ok) {
    return { ok: false, reasonText: `You need $${def.purchaseCost.toLocaleString()} in your bank.` };
  }

  await addServerBank(guildId, def.purchaseCost, "underworld_building_purchase_bank", {
    enterprise: "underworld",
    buildingId,
    userId,
  });

  const building = {
    id: makeId("uwb"),
    buildingId,
    purchasedAt: Date.now(),
    suspicion: 0,
    suspicionTickAt: Date.now(),
    operationType: null,
    conversion: null,
    activeRun: null,
    setupInvestment: 0,
    upgrades: { security: 0, equipment: 0, efficiency: 0 },
    storage: { stock: 0, sellLockedUntil: null },
  };

  state.buildings.push(building);
  await saveState(guildId, userId, state);
  await sharedSuspicion.recordUnderworldActivity(guildId, userId, "underworld_building_purchase").catch(() => {});
  return { ok: true, building, definition: def };
}

async function startConversion(guildId, userId, state, buildingRef, operationId) {
  const { building } = resolveBuilding(state, buildingRef);
  const operation = getOperationDefinition(operationId);
  if (!building) return { ok: false, reasonText: "That building does not exist." };
  if (!operation) return { ok: false, reasonText: "Unknown operation type." };
  if (building.conversion) return { ok: false, reasonText: "This building is already being converted." };
  if (building.operationType) return { ok: false, reasonText: "Dismantle the current setup before converting again." };

  const debit = await tryDebitBank(guildId, userId, operation.conversionCost, "underworld_conversion", {
    enterprise: "underworld",
    operationId,
    buildingId: building.buildingId,
  });
  if (!debit.ok) {
    return { ok: false, reasonText: `You need $${operation.conversionCost.toLocaleString()} in your bank.` };
  }

  await addServerBank(guildId, operation.conversionCost, "underworld_conversion_bank", {
    enterprise: "underworld",
    operationId,
    buildingId: building.buildingId,
    userId,
  });

  const startedAt = Date.now();
  building.conversion = {
    targetOperationId: operationId,
    cost: operation.conversionCost,
    startedAt,
    completeAt: startedAt + operation.conversionHours * 60 * 60 * 1000,
  };
  await saveState(guildId, userId, state);
  await sharedSuspicion.addUnderworldSuspicion(guildId, userId, 1, "underworld_conversion_started").catch(() => {});
  return { ok: true, building, operation };
}

async function dismantleOperation(guildId, userId, state, buildingRef, { emergency = false } = {}) {
  const { building } = resolveBuilding(state, buildingRef);
  if (!building) return { ok: false, reasonText: "That building does not exist." };
  if (!building.operationType && !building.conversion) {
    return { ok: false, reasonText: "There is nothing installed here to dismantle." };
  }

  const rate = emergency ? config.EMERGENCY_LIQUIDATION_RETURN_RATE : config.LIQUIDATION_RETURN_RATE;
  const suspicionScalar = clamp(
    1 - (getBuildingSuspicion(building) / config.MAX_SUSPICION) * 0.8,
    config.LIQUIDATION_MIN_SUSPICION_SCALAR,
    1
  );
  const invested = Number(building.setupInvestment || 0) + Number(building.conversion?.cost || 0);
  const refund = Math.max(0, Math.round(invested * rate * suspicionScalar));

  building.operationType = null;
  building.conversion = null;
  building.activeRun = null;
  building.setupInvestment = 0;
  building.storage = { stock: 0, sellLockedUntil: null };
  building.suspicion = clamp(getBuildingSuspicion(building) * (emergency ? 0.85 : 0.65), 0, config.MAX_SUSPICION);

  await saveState(guildId, userId, state);
  await sharedSuspicion.recordUnderworldActivity(guildId, userId, emergency ? "underworld_emergency_dismantle" : "underworld_dismantle").catch(() => {});

  if (refund > 0) {
    await creditBank(guildId, userId, refund, "underworld_liquidation_refund", {
      enterprise: "underworld",
      emergency,
      buildingId: building.buildingId,
    });
  }

  return { ok: true, refund };
}

async function startRun(guildId, userId, state, buildingRef) {
  const { building } = resolveBuilding(state, buildingRef);
  if (!building) return { ok: false, reasonText: "That building does not exist." };
  if (building.conversion?.completeAt && Date.now() < Number(building.conversion.completeAt)) {
    return { ok: false, reasonText: "The conversion is still underway." };
  }
  if (!building.operationType) return { ok: false, reasonText: "Convert this building into an operation first." };
  const operation = getOperationDefinition(building.operationType);
  if (!operation) return { ok: false, reasonText: "Unknown operation type." };
  if (building.activeRun) return { ok: false, reasonText: "This building already has an active operation." };
  if (Date.now() < Number(building.runCooldownUntil || 0)) {
    return {
      ok: false,
      reasonText: `This building needs a short reset before the next run. Try again <t:${Math.floor(Number(building.runCooldownUntil) / 1000)}:R>.`,
    };
  }
  if (operation.storageEnabled) {
    const buildingDef = getBuildingDefinition(building.buildingId);
    const capacity = Math.max(1, Number(buildingDef?.capacity || 100));
    if (Number(building.storage?.stock || 0) >= capacity) {
      return { ok: false, reasonText: "Storage is full. Sell some goods before starting another run." };
    }
  }

  const batchCost = getOperationRunCost(building, operation);
  const debit = await tryDebitBank(guildId, userId, batchCost, "underworld_operation_start", {
    enterprise: "underworld",
    operationId: operation.id,
    buildingId: building.buildingId,
  });
  if (!debit.ok) {
    return { ok: false, reasonText: `You need $${batchCost.toLocaleString()} in your bank to start a run.` };
  }

  await addServerBank(guildId, batchCost, "underworld_operation_start_bank", {
    enterprise: "underworld",
    operationId: operation.id,
    buildingId: building.buildingId,
    userId,
  });

  const startedAt = Date.now();
  const durationMs = getOperationRunDurationMs(building, operation);
  const eventCount = getEventCountForBuilding(building);

  building.activeRun = {
    operationId: operation.id,
    status: "running",
    startedAt,
    readyAt: startedAt + durationMs,
    batchCost,
    grossMultiplier: getBaseGrossMultiplier(building, operation),
    outputMultiplier: 1,
    payoutMultiplierBonus: 0,
    raidChanceBonus: 0,
    suspicionBonus: 0,
    eventQueue: chooseMany(operation.eventPool || [], eventCount),
    eventSchedule: buildEventSchedule(startedAt, durationMs, eventCount),
    nextEventIndex: 0,
    eventLog: [],
    pendingEvent: null,
  };

  await saveState(guildId, userId, state);
  await sharedSuspicion.addUnderworldSuspicion(guildId, userId, Math.max(1, Math.round(Number(operation.baseSuspicionGain || 0) * 0.25)), "underworld_operation_started").catch(() => {});
  return { ok: true, building, operation };
}

async function resolveEventChoice(guildId, userId, state, buildingRef, choiceId) {
  const { building } = resolveBuilding(state, buildingRef);
  const run = building?.activeRun;
  const pending = run?.pendingEvent;
  const event = pending?.eventId ? EVENTS[pending.eventId] : null;
  if (!building || !run || !pending || !event) {
    return { ok: false, reasonText: "There is no active event waiting here." };
  }

  const choice = (event.choices || []).find((entry) => entry.id === choiceId);
  if (!choice) return { ok: false, reasonText: "That response is no longer available." };

  const cost = Math.max(0, Number(choice.costFlat || 0) + Math.round(Number(choice.costPct || 0) * Number(run.batchCost || 0)));
  if (cost > 0) {
    const debit = await tryDebitBank(guildId, userId, cost, "underworld_event_cost", {
      enterprise: "underworld",
      eventId: event.id,
      choiceId,
      buildingId: building.buildingId,
    });
    if (!debit.ok) {
      return { ok: false, reasonText: `You need $${cost.toLocaleString()} in your bank for that move.` };
    }

    await addServerBank(guildId, cost, "underworld_event_cost_bank", {
      enterprise: "underworld",
      eventId: event.id,
      choiceId,
      buildingId: building.buildingId,
      userId,
    });
  }

  applyEventDelta(run, choice);
  if (choice.suspicionDelta && choice.suspicionDelta < 0) {
    building.suspicion = clamp(getBuildingSuspicion(building) + Number(choice.suspicionDelta || 0), 0, config.MAX_SUSPICION);
    building.suspicionTickAt = Date.now();
  }
  if (choice.suspicionDelta) {
    await sharedSuspicion.addUnderworldSuspicion(guildId, userId, Number(choice.suspicionDelta || 0), "underworld_event_choice").catch(() => {});
  } else {
    await sharedSuspicion.recordUnderworldActivity(guildId, userId, "underworld_event_choice").catch(() => {});
  }
  run.eventLog = run.eventLog || [];
  run.eventLog.push({
    eventId: event.id,
    resolution: choiceId,
    resolvedAt: Date.now(),
  });
  run.pendingEvent = null;
  run.nextEventIndex = Number(run.nextEventIndex || 0) + 1;

  await saveState(guildId, userId, state);
  await applyRuntime(guildId, userId, state);
  return { ok: true, choice, cost, event };
}

function rollRaidOutcome(raidChance, suspicion) {
  const roll = Math.random();
  const fullBustChance = suspicion >= 70 ? raidChance * 0.18 : suspicion >= 55 ? raidChance * 0.1 : 0;
  const majorChance = raidChance * 0.32;

  if (roll < fullBustChance) return "full_bust";
  if (roll < fullBustChance + majorChance) return "major";
  if (roll < raidChance) return "minor";
  return null;
}

function getStorageEarlySaleRisk(run, now = Date.now()) {
  const goods = run?.storageGoods || run;
  if (!goods) return null;
  const generatedAt = Number(goods.generatedAt || now);
  const sellReadyAt = Number(goods.sellReadyAt || goods.sellLockedUntil || now);
  if (!sellReadyAt || now >= sellReadyAt) {
    return {
      early: false,
      remainingRatio: 0,
      payoutMultiplier: 1,
      suspicionGain: 0,
      raidChanceBonus: 0,
      reportChance: 0,
    };
  }

  const totalMs = Math.max(1, sellReadyAt - generatedAt);
  const remainingRatio = clamp((sellReadyAt - now) / totalMs, 0, 1);
  const cfg = config.STORAGE_EARLY_SALE || {};
  return {
    early: true,
    remainingRatio,
    payoutMultiplier: clamp(1 - remainingRatio * Number(cfg.maxPayoutPenalty || 0.24), 0.5, 1),
    suspicionGain: Math.ceil(remainingRatio * Number(cfg.maxSuspicionGain || 14)),
    raidChanceBonus: remainingRatio * Number(cfg.maxRaidChanceBonus || 0.12),
    reportChance: remainingRatio * Number(cfg.stolenReportChance || 0.18),
  };
}

async function chooseDistribution(guildId, userId, state, buildingRef, modeId, options = {}) {
  const { building, buildingIndex } = resolveBuilding(state, buildingRef);
  const run = building?.activeRun;
  const operation = getOperationDefinition(building?.operationType);
  const mode = config.DISTRIBUTION_MODES[modeId];
  if (!building || !operation) {
    return { ok: false, reasonText: "That operation cannot be resolved right now." };
  }
  const hasStoredGoods = operation.storageEnabled && Number(building.storage?.stock || 0) > 0 && Number(building.storage?.totalValue || 0) > 0;
  const isStorageEarlySale = operation?.storageEnabled && run?.status === "cooling_off";
  if (run?.status !== "awaiting_distribution" && !isStorageEarlySale) {
    if (!hasStoredGoods) {
      return { ok: false, reasonText: "This run is not ready for distribution yet." };
    }
  }
  if (!mode) return { ok: false, reasonText: "Unknown distribution mode." };
  if (operation.storageEnabled) {
    const goods = run?.storageGoods || building.storage;
    if (!hasStoredGoods && (!goods || Number(goods.units || 0) <= 0 || Number(goods.totalValue || 0) <= 0)) {
      return { ok: false, reasonText: "There are no cooled-off goods ready to sell yet." };
    }
  }

  const securityReduction = getUpgradeLevelBonus("security", building.upgrades?.security, "raidChanceReduction");
  const efficiencyReduction = getUpgradeLevelBonus("efficiency", building.upgrades?.efficiency, "suspicionReduction");

  const grossBase = operation.storageEnabled && run?.storageGoods
    ? Number(run.storageGoods.totalValue || 0)
    : operation.storageEnabled && hasStoredGoods
      ? Number(building.storage.totalValue || 0)
    : Number(run.batchCost || 0) *
      Number(run.grossMultiplier || 1) *
      clamp(Number(run.outputMultiplier || 1), 0.4, 3);

  const saleGoods = operation.storageEnabled ? (run?.storageGoods || building.storage) : null;
  const earlySale = operation.storageEnabled ? getStorageEarlySaleRisk(saleGoods) : null;

  let gross = Math.round(
    grossBase *
    (Number(mode.payoutMultiplier || 1) + Number(run?.payoutMultiplierBonus || 0)) *
    Number(earlySale?.payoutMultiplier || 1)
  );

  const sharedInfo = await sharedSuspicion.getUnderworldSuspicion(guildId, userId).catch(() => ({ suspicion: 0 }));
  const suspicionBefore = Math.max(getBuildingSuspicion(building), Number(sharedInfo.suspicion || 0));
  let suspicionGain = Number(operation.baseSuspicionGain || 0) + Number(mode.suspicionDelta || 0) + Number(run?.suspicionBonus || 0) - Number(efficiencyReduction || 0);
  suspicionGain += Number(earlySale?.suspicionGain || 0);
  suspicionGain = Math.max(-config.CLEAN_RUN_SUSPICION_REDUCTION, suspicionGain);

  let raidChance = Number(operation.baseRaidChance || 0)
    + Number(mode.raidChanceDelta || 0)
    + Number(run?.raidChanceBonus || 0)
    + Number(earlySale?.raidChanceBonus || 0)
    + suspicionBefore / 170
    + Number(getBuildingDefinition(building.buildingId)?.baseRisk || 0) / 220
    - Number(securityReduction || 0);
  raidChance = clamp(raidChance, 0.02, 0.92);

  let stolenReport = null;
  if (earlySale?.early && Math.random() < Number(earlySale.reportChance || 0)) {
    const cfg = config.STORAGE_EARLY_SALE || {};
    stolenReport = {
      name: "Reported Stolen",
      suspicionDelta: Number(cfg.stolenReportSuspicion || 8),
      payoutPenalty: Number(cfg.stolenReportPayoutPenalty || 0.15),
    };
    suspicionGain += stolenReport.suspicionDelta;
    gross = Math.round(gross * clamp(1 - stolenReport.payoutPenalty, 0.4, 1));
  }

  const raidOutcomeId = rollRaidOutcome(raidChance, suspicionBefore + suspicionGain);
  const raidOutcome = raidOutcomeId ? config.RAID_OUTCOMES[raidOutcomeId] : null;

  if (raidOutcome) {
    gross = Math.round(gross * Number(raidOutcome.payoutMultiplier || 0));
    suspicionGain += Number(raidOutcome.suspicionDelta || 0);
  } else {
    suspicionGain -= config.CLEAN_RUN_SUSPICION_REDUCTION;
  }

  building.suspicion = clamp(suspicionBefore + suspicionGain, 0, config.MAX_SUSPICION);
  building.suspicionTickAt = Date.now();
  building.lastRunAt = Date.now();
  building.lastDistributionMode = modeId;
  building.lastOutcome = {
    completedAt: Date.now(),
    distributionMode: modeId,
    raidOutcome: raidOutcomeId,
    payout: gross,
    batchCost: run?.batchCost || 0,
    storageGoods: operation.storageEnabled ? (run?.storageGoods || building.storage) : null,
    earlySale: earlySale?.early ? earlySale : null,
    stolenReport,
  };

  if (raidOutcomeId === "full_bust") {
    state.buildings.splice(buildingIndex, 1);
    await saveState(guildId, userId, state);
    await sharedSuspicion.addUnderworldSuspicion(guildId, userId, suspicionGain, "underworld_full_bust").catch(() => {});
    await setJail(guildId, userId, config.FULL_BUST_JAIL_MINUTES);
    return {
      ok: true,
      payout: 0,
      distribution: mode,
      raidOutcome,
      buildingLost: true,
      jailedMinutes: config.FULL_BUST_JAIL_MINUTES,
      earlySale,
      stolenReport,
    };
  }

  if (run) building.activeRun = null;
  if (operation.storageEnabled) {
    building.storage = { stock: 0, sellLockedUntil: null, goods: [], totalValue: 0 };
  }

  await saveState(guildId, userId, state);
  await sharedSuspicion.addUnderworldSuspicion(guildId, userId, suspicionGain, `underworld_distribution_${raidOutcomeId || "clean"}`).catch(() => {});

  if (gross > 0 && typeof options.payoutFn === "function") {
    await options.payoutFn(gross, {
      enterprise: "underworld",
      operationId: operation.id,
      distribution: modeId,
      raidOutcome: raidOutcomeId || "clean",
      buildingId: building.buildingId,
    });
  }

  return {
    ok: true,
    payout: gross,
    distribution: mode,
    raidOutcome,
    earlySale,
    stolenReport,
    buildingLost: false,
  };
}

async function storeRunForSmuggling(guildId, userId, state, buildingRef) {
  const { building } = resolveBuilding(state, buildingRef);
  const run = building?.activeRun;
  const operation = getOperationDefinition(building?.operationType);
  if (!building || !run || run.status !== "awaiting_distribution" || !operation) {
    return { ok: false, reasonText: "This operation does not have a finished batch ready to store." };
  }
  if (!["meth_lab", "cocaine_lab"].includes(operation.id)) {
    return { ok: false, reasonText: "Only lab product can be moved into smuggling storage right now." };
  }

  const productId = operation.id === "meth_lab" ? "meth" : "cocaine";
  const divisor = operation.id === "meth_lab" ? 52000 : 68000;
  const outputMultiplier = clamp(Number(run.outputMultiplier || 1), 0.4, 3);
  const producedUnits = Math.max(1, Math.floor((Number(run.batchCost || 0) * Number(run.grossMultiplier || 1) * outputMultiplier) / divisor));
  underworldInventory.addProduct(state, productId, producedUnits);

  const suspicionGain = Math.max(2, Math.ceil(Number(operation.baseSuspicionGain || 0) * 0.45 + Number(run.suspicionBonus || 0)));
  building.suspicion = clamp(getBuildingSuspicion(building) + suspicionGain, 0, config.MAX_SUSPICION);
  building.suspicionTickAt = Date.now();
  building.activeRun = null;
  building.lastRunAt = Date.now();
  building.lastOutcome = {
    completedAt: Date.now(),
    distributionMode: "stored_for_smuggling",
    payout: 0,
    productId,
    producedUnits,
  };

  await saveState(guildId, userId, state);
  await sharedSuspicion.addUnderworldSuspicion(guildId, userId, suspicionGain, "underworld_store_for_smuggling").catch(() => {});
  return { ok: true, productId, producedUnits, operation };
}

module.exports = {
  buildings,
  operations: OPERATIONS,
  upgrades,
  config,
  EVENTS,
  ensureState,
  saveState,
  applyRuntime,
  getBuildingDefinition,
  getOperationDefinition,
  resolveBuilding,
  getStateSummary,
  getBuildingSuspicion,
  getBuildingStatus,
  getOperationRunCost,
  getOperationRunDurationMs,
  purchaseBuilding,
  startConversion,
  dismantleOperation,
  startRun,
  resolveEventChoice,
  chooseDistribution,
  storeRunForSmuggling,
};
