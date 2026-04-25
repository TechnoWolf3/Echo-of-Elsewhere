const { pool } = require("../db");
const buildings = require("../../data/underworld/buildings");
const { OPERATIONS, EVENTS } = require("../../data/underworld/operations");
const upgrades = require("../../data/underworld/upgrades");
const config = require("../../data/underworld/config");
const { tryDebitBank, creditBank, addServerBank } = require("../economy");
const { setJail } = require("../jail");

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
  return { buildings: [] };
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
  const goodsPool = Array.isArray(config.STORAGE_GOODS) ? config.STORAGE_GOODS : [];
  const items = [];
  let totalValue = 0;

  for (let i = 0; i < units; i += 1) {
    const goods = weightedPick(goodsPool) || { name: "Fenced goods", valueMin: 25000, valueMax: 50000 };
    const value = randInt(Number(goods.valueMin || 25000), Number(goods.valueMax || 50000));
    const existing = items.find((entry) => entry.name === goods.name);
    if (existing) {
      existing.quantity += 1;
      existing.value += value;
    } else {
      items.push({ name: goods.name, quantity: 1, value });
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
    sellReadyAt: Date.now() + Number(config.STORAGE_SELL_LOCK_MS || 60 * 60 * 1000),
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
    run.status = "cooling_off";
    building.storage = {
      stock: Number(run.storageGoods.units || 0),
      sellLockedUntil: Number(run.storageGoods.sellReadyAt || now),
      goods: run.storageGoods.items || [],
      totalValue: Number(run.storageGoods.totalValue || 0),
    };
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
    building.storage = {
      stock: Number(run.storageGoods.units || 0),
      sellLockedUntil: Number(run.storageGoods.sellReadyAt || now),
      goods: run.storageGoods.items || [],
      totalValue: Number(run.storageGoods.totalValue || 0),
    };
    return true;
  }
  if (now < Number(goods.sellReadyAt || 0)) return false;
  run.status = "awaiting_distribution";
  building.storage = {
    stock: Number(goods.units || 0),
    sellLockedUntil: null,
    goods: goods.items || [],
    totalValue: Number(goods.totalValue || 0),
  };
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
  run.status = "cooling_off";
  building.storage = {
    stock: Number(run.storageGoods.units || 0),
    sellLockedUntil: Number(run.storageGoods.sellReadyAt || now),
    goods: run.storageGoods.items || [],
    totalValue: Number(run.storageGoods.totalValue || 0),
  };
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
  if (building.activeRun) return { ok: false, reasonText: "This building already has an active operation." };

  const operation = getOperationDefinition(building.operationType);
  if (!operation) return { ok: false, reasonText: "Unknown operation type." };

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

async function chooseDistribution(guildId, userId, state, buildingRef, modeId, options = {}) {
  const { building, buildingIndex } = resolveBuilding(state, buildingRef);
  const run = building?.activeRun;
  const operation = getOperationDefinition(building?.operationType);
  const mode = config.DISTRIBUTION_MODES[modeId];
  if (!building || !run || !operation) {
    return { ok: false, reasonText: "That operation cannot be resolved right now." };
  }
  if (run.status !== "awaiting_distribution") {
    return { ok: false, reasonText: "This run is not ready for distribution yet." };
  }
  if (!mode) return { ok: false, reasonText: "Unknown distribution mode." };
  if (operation.storageEnabled) {
    const goods = run.storageGoods;
    if (!goods || Number(goods.units || 0) <= 0 || Number(goods.totalValue || 0) <= 0) {
      return { ok: false, reasonText: "There are no cooled-off goods ready to sell yet." };
    }
    if (Number(goods.sellReadyAt || 0) > Date.now()) {
      return { ok: false, reasonText: `The goods are still cooling off until <t:${Math.floor(Number(goods.sellReadyAt) / 1000)}:R>.` };
    }
  }

  const securityReduction = getUpgradeLevelBonus("security", building.upgrades?.security, "raidChanceReduction");
  const efficiencyReduction = getUpgradeLevelBonus("efficiency", building.upgrades?.efficiency, "suspicionReduction");

  const grossBase = operation.storageEnabled && run.storageGoods
    ? Number(run.storageGoods.totalValue || 0)
    : Number(run.batchCost || 0) *
      Number(run.grossMultiplier || 1) *
      clamp(Number(run.outputMultiplier || 1), 0.4, 3);

  let gross = Math.round(
    grossBase *
    (Number(mode.payoutMultiplier || 1) + Number(run.payoutMultiplierBonus || 0))
  );

  const suspicionBefore = getBuildingSuspicion(building);
  let suspicionGain = Number(operation.baseSuspicionGain || 0) + Number(mode.suspicionDelta || 0) + Number(run.suspicionBonus || 0) - Number(efficiencyReduction || 0);
  suspicionGain = Math.max(-config.CLEAN_RUN_SUSPICION_REDUCTION, suspicionGain);

  let raidChance = Number(operation.baseRaidChance || 0)
    + Number(mode.raidChanceDelta || 0)
    + Number(run.raidChanceBonus || 0)
    + suspicionBefore / 170
    + Number(getBuildingDefinition(building.buildingId)?.baseRisk || 0) / 220
    - Number(securityReduction || 0);
  raidChance = clamp(raidChance, 0.02, 0.92);

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
    batchCost: run.batchCost,
    storageGoods: operation.storageEnabled ? run.storageGoods : null,
  };

  if (raidOutcomeId === "full_bust") {
    state.buildings.splice(buildingIndex, 1);
    await saveState(guildId, userId, state);
    await setJail(guildId, userId, config.FULL_BUST_JAIL_MINUTES);
    return {
      ok: true,
      payout: 0,
      distribution: mode,
      raidOutcome,
      buildingLost: true,
      jailedMinutes: config.FULL_BUST_JAIL_MINUTES,
    };
  }

  building.activeRun = null;
  if (operation.storageEnabled) {
    building.storage = { stock: 0, sellLockedUntil: null, goods: [], totalValue: 0 };
  }

  await saveState(guildId, userId, state);

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
    buildingLost: false,
  };
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
};
