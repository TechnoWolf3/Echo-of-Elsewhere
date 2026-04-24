const { pool } = require("../db");
const buildings = require("../../data/underworld/buildings");
const { OPERATIONS, EVENTS } = require("../../data/underworld/operations");
const upgrades = require("../../data/underworld/upgrades");
const config = require("../../data/underworld/config");
const { tryDebitBank, creditBank, creditUser, addServerBank } = require("../economy");
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

async function finalizeCompletedRun(guildId, userId, state, building) {
  const run = building.activeRun;
  if (!run || run.status !== "running" || run.pendingEvent) return;
  if (Date.now() < Number(run.readyAt || 0)) return;
  if (Number(run.nextEventIndex || 0) < Number(run.eventQueue?.length || 0)) {
    run.pendingEvent = nextPendingEvent(run);
    return;
  }
  run.status = "awaiting_distribution";
  await saveState(guildId, userId, state);
}

async function resolveMissedEvent(guildId, userId, state, building) {
  const run = building.activeRun;
  const pending = run?.pendingEvent;
  if (!pending?.eventId) return;
  const event = EVENTS[pending.eventId];
  if (!event) {
    run.pendingEvent = null;
    run.nextEventIndex = Number(run.nextEventIndex || 0) + 1;
    await saveState(guildId, userId, state);
    return;
  }

  applyEventDelta(run, event.ignored || {});
  run.eventLog = run.eventLog || [];
  run.eventLog.push({
    eventId: pending.eventId,
    resolution: "ignored",
    resolvedAt: Date.now(),
  });
  run.pendingEvent = null;
  run.nextEventIndex = Number(run.nextEventIndex || 0) + 1;
  await saveState(guildId, userId, state);
}

async function applyRuntime(guildId, userId, state) {
  const now = Date.now();
  let changed = false;

  for (const building of state.buildings || []) {
    if (applySuspicionDecay(building, now)) {
      changed = true;
    }

    if (building.conversion?.completeAt && now >= Number(building.conversion.completeAt)) {
      building.operationType = building.conversion.targetOperationId;
      building.convertedAt = building.conversion.completeAt;
      building.setupInvestment = Number(building.setupInvestment || 0) + Number(building.conversion.cost || 0);
      building.conversion = null;
      changed = true;
    }

    let safety = 0;
    while (building.activeRun && safety < 8) {
      safety += 1;
      const run = building.activeRun;

      if (run.pendingEvent?.deadlineAt && now >= Number(run.pendingEvent.deadlineAt)) {
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
        changed = true;
        continue;
      }

      if (
        run.status === "running" &&
        !run.pendingEvent &&
        Number(run.nextEventIndex || 0) < Number(run.eventQueue?.length || 0)
      ) {
        const nextAt = Number(run.eventSchedule?.[run.nextEventIndex] || 0);
        if (nextAt && now >= nextAt) {
          run.pendingEvent = {
            eventId: run.eventQueue[run.nextEventIndex],
            openedAt: now,
            deadlineAt: now + config.EVENT_WINDOW_MS,
          };
          changed = true;
          continue;
        }
      }

      if (
        run.status === "running" &&
        now >= Number(run.readyAt || 0) &&
        !run.pendingEvent &&
        Number(run.nextEventIndex || 0) >= Number(run.eventQueue?.length || 0)
      ) {
        run.status = "awaiting_distribution";
        changed = true;
      }
      break;
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

async function startConversion(guildId, userId, state, buildingIndex, operationId) {
  const building = state.buildings?.[buildingIndex];
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

async function dismantleOperation(guildId, userId, state, buildingIndex, { emergency = false } = {}) {
  const building = state.buildings?.[buildingIndex];
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

async function startRun(guildId, userId, state, buildingIndex) {
  const building = state.buildings?.[buildingIndex];
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

async function resolveEventChoice(guildId, userId, state, buildingIndex, choiceId) {
  const building = state.buildings?.[buildingIndex];
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

async function chooseDistribution(guildId, userId, state, buildingIndex, modeId) {
  const building = state.buildings?.[buildingIndex];
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

  const securityReduction = getUpgradeLevelBonus("security", building.upgrades?.security, "raidChanceReduction");
  const efficiencyReduction = getUpgradeLevelBonus("efficiency", building.upgrades?.efficiency, "suspicionReduction");

  let gross = Math.round(
    Number(run.batchCost || 0) *
    Number(run.grossMultiplier || 1) *
    clamp(Number(run.outputMultiplier || 1), 0.4, 3) *
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
    building.storage = building.storage || { stock: 0, sellLockedUntil: null };
    building.storage.stock = Number(building.storage.stock || 0) + Math.max(1, Math.round(Number(run.batchCost || 0) / 90000));
    building.storage.sellLockedUntil = Date.now() + 60 * 60 * 1000;
  }

  await saveState(guildId, userId, state);

  if (gross > 0) {
    await creditUser(guildId, userId, gross, "underworld_operation_payout", {
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
