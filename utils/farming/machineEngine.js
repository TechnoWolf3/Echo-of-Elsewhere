const { pool } = require("../db");
const { tryDebitBank } = require("../economy");
const machines = require("../../data/farming/machines");
const TASK_REQUIREMENTS = {
  cultivate: ["tractor", "cultivator"],
  seed: ["tractor", "seeder"],
  fertilise: ["tractor", "sprayer"],
  harvest: ["harvester"],
};

const RENTAL_DURATION_MS = 24 * 60 * 60 * 1000;
const SELL_VALUE_RATE = 0.6;

async function ensureMachineTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS farm_machines (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      PRIMARY KEY (guild_id, user_id)
    )
  `);
}

function defaultMachineState() {
  return {
    owned: {},
    rented: {},
    activeTasks: [],
  };
}

async function ensureMachineState(guildId, userId) {
  await ensureMachineTable();

  const res = await pool.query(
    `SELECT data FROM farm_machines WHERE guild_id=$1 AND user_id=$2`,
    [guildId, userId]
  );

  if (!res.rowCount) {
    const data = defaultMachineState();
    await pool.query(
      `INSERT INTO farm_machines (guild_id, user_id, data)
       VALUES ($1,$2,$3::jsonb)`,
      [guildId, userId, JSON.stringify(data)]
    );
    return data;
  }

  const data = res.rows[0].data || defaultMachineState();
  if (!data.owned) data.owned = {};
  if (!data.rented) data.rented = {};
  if (!data.activeTasks) data.activeTasks = [];
  const rentalsChanged = cleanupExpiredRentals(data);
  const tasksChanged = cleanupFinishedTasks(data);
  const changed = rentalsChanged || tasksChanged;
  if (changed) await saveMachineState(guildId, userId, data);
  return data;
}

async function saveMachineState(guildId, userId, data) {
  await ensureMachineTable();
  await pool.query(
    `INSERT INTO farm_machines (guild_id, user_id, data)
     VALUES ($1,$2,$3::jsonb)
     ON CONFLICT (guild_id, user_id)
     DO UPDATE SET data = EXCLUDED.data`,
    [guildId, userId, JSON.stringify(data)]
  );
  return data;
}

function listMachines() {
  return Object.values(machines).sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    return a.name.localeCompare(b.name);
  });
}

function getMachine(machineId) {
  return machines[machineId] || null;
}

function getOwnedCount(state, machineId) {
  return Number(state?.owned?.[machineId] || 0);
}

function getRentedCount(state, machineId) {
  const entry = state?.rented?.[machineId];
  if (!entry) return 0;

  const now = Date.now();
  if (Array.isArray(entry.leases)) {
    return entry.leases.filter((lease) => Number(lease.expiresAt || 0) > now).length;
  }

  if (entry.expiresAt && Number(entry.expiresAt) <= now) return 0;
  return Number(entry.qty || 0);
}

function getMachinesForTask(taskKey) {
  return Object.values(machines).filter(
    (m) => Array.isArray(m.requiredFor) && m.requiredFor.includes(taskKey)
  );
}

function getAvailableCountForMachine(state, machineId) {
  return getOwnedCount(state, machineId) + getRentedCount(state, machineId);
}

async function hasMachineForTask(guildId, userId, taskKey) {
  const state = await ensureMachineState(guildId, userId);
  const candidates = getMachinesForTask(taskKey);

  for (const machine of candidates) {
    if (getAvailableCountForMachine(state, machine.id) > 0) {
      return {
        ok: true,
        machine,
        state,
      };
    }
  }

  return {
    ok: false,
    reasonText: `You need suitable machinery for ${taskKey}. Check the Machine Shed.`,
    state,
  };
}

async function buyMachine(guildId, userId, machineId) {
  const machine = getMachine(machineId);
  if (!machine) return { ok: false, reasonText: "Unknown machine." };

  const state = await ensureMachineState(guildId, userId);
  const debit = await tryDebitBank(guildId, userId, machine.buyPrice, "farm_machine_buy", { machineId });
  if (!debit.ok) return { ok: false, reasonText: `You need $${machine.buyPrice.toLocaleString()} in your bank to buy this machine.` };

  state.owned[machineId] = getOwnedCount(state, machineId) + 1;
  await saveMachineState(guildId, userId, state);

  return { ok: true, machine };
}

async function rentMachine(guildId, userId, machineId) {
  const machine = getMachine(machineId);
  if (!machine) return { ok: false, reasonText: "Unknown machine." };

  const state = await ensureMachineState(guildId, userId);

  const debit = await pool.query(
    `UPDATE user_balances
     SET balance = balance - $1
     WHERE guild_id=$2 AND user_id=$3 AND balance >= $1
     RETURNING balance`,
    [machine.rentPrice, guildId, userId]
  );

  if (debit.rowCount === 0) {
    return { ok: false, reasonText: `You need $${machine.rentPrice.toLocaleString()} to rent this machine.` };
  }

  const now = Date.now();
  const current = state.rented[machineId] || {};
  const leases = Array.isArray(current.leases)
    ? current.leases.filter((lease) => Number(lease.expiresAt || 0) > now)
    : [];

  if (!leases.length && Number(current.qty || 0) > 0 && (!current.expiresAt || Number(current.expiresAt) > now)) {
    const qty = Number(current.qty || 0);
    for (let i = 0; i < qty; i++) {
      leases.push({
        rentedAt: now,
        expiresAt: Number(current.expiresAt || now + RENTAL_DURATION_MS),
      });
    }
  }

  leases.push({
    rentedAt: now,
    expiresAt: now + RENTAL_DURATION_MS,
  });

  state.rented[machineId] = { leases };
  await saveMachineState(guildId, userId, state);

  await logMachineTransaction(guildId, userId, -machine.rentPrice, "farm_machine_rent", { machineId });

  return { ok: true, machine, expiresAt: now + RENTAL_DURATION_MS };
}

async function sellMachine(guildId, userId, machineId) {
  const machine = getMachine(machineId);
  if (!machine) return { ok: false, reasonText: "Unknown machine." };

  const state = await ensureMachineState(guildId, userId);
  const owned = getOwnedCount(state, machineId);
  if (owned <= 0) {
    return { ok: false, reasonText: "You do not own that machine." };
  }

  const occupied = getOccupiedCountForMachine(state, machineId);
  const freeOwned = owned - occupied;
  if (freeOwned <= 0) {
    return { ok: false, reasonText: "That machine is currently busy. Wait for active field tasks to finish before selling it." };
  }

  const sellValue = getSellValue(machine);
  state.owned[machineId] = owned - 1;
  if (state.owned[machineId] <= 0) delete state.owned[machineId];
  await saveMachineState(guildId, userId, state);

  await pool.query(
    `UPDATE user_balances
     SET balance = balance + $1
     WHERE guild_id=$2 AND user_id=$3`,
    [sellValue, guildId, userId]
  );
  await logMachineTransaction(guildId, userId, sellValue, "farm_machine_sell", { machineId });

  return { ok: true, machine, sellValue };
}

function cleanupFinishedTasks(state) {
  const now = Date.now();
  const before = (state.activeTasks || []).length;
  state.activeTasks = (state.activeTasks || []).filter(t => t.endsAt > now);
  return state.activeTasks.length !== before;
}

function cleanupExpiredRentals(state) {
  const now = Date.now();
  let changed = false;
  if (!state.rented) state.rented = {};

  for (const [machineId, entry] of Object.entries(state.rented)) {
    if (!entry) {
      delete state.rented[machineId];
      changed = true;
      continue;
    }

    if (Array.isArray(entry.leases)) {
      const kept = entry.leases.filter((lease) => Number(lease.expiresAt || 0) > now);
      if (kept.length !== entry.leases.length) changed = true;
      if (kept.length) state.rented[machineId] = { leases: kept };
      else delete state.rented[machineId];
      continue;
    }

    if (entry.expiresAt && Number(entry.expiresAt) <= now) {
      delete state.rented[machineId];
      changed = true;
    }
  }

  return changed;
}

function getOccupiedMachineIds(state) {
  const occupied = new Set();

  for (const task of state.activeTasks || []) {
    for (const id of task.machineIds || []) {
      occupied.add(id);
    }
  }

  return occupied;
}

function getOccupiedCountForMachine(state, machineId) {
  return (state.activeTasks || []).reduce((count, task) => {
    return count + (task.machineIds || []).filter((id) => id === machineId).length;
  }, 0);
}

function getSellValue(machine) {
  return Math.floor(Number(machine?.buyPrice || 0) * SELL_VALUE_RATE);
}

async function logMachineTransaction(guildId, userId, amount, type, meta = {}) {
  try {
    await pool.query(
      `INSERT INTO transactions (guild_id, user_id, amount, type, meta)
       VALUES ($1, $2, $3, $4, $5)`,
      [guildId, userId, amount, type, meta]
    );
  } catch (e) {
    console.warn("[FARM][MACHINES] transaction log failed:", e?.message || e);
  }
}

function getAvailableMachinesByType(state, type) {
  const occupied = getOccupiedMachineIds(state);
  const allMachines = Object.values(machines);

  const results = [];

  for (const m of allMachines) {
    if (m.type !== type) continue;

    const total =
      getOwnedCount(state, m.id) +
      getRentedCount(state, m.id);

    let free = total;

    if (occupied.has(m.id)) {
      // subtract how many are currently used
      const used = (state.activeTasks || []).reduce((count, t) => {
        return count + t.machineIds.filter(id => id === m.id).length;
      }, 0);

      free = total - used;
    }

    for (let i = 0; i < free; i++) {
      results.push(m.id);
    }
  }

  return results;
}

function canTractorRunImplement(tractor, implement) {
  if (!implement) return true;
  if (implement.type === "harvester") return true; // harvesters are self-powered in current logic
  if (!implement.minHorsepower) return true;
  if (!tractor?.horsepower) return false;

  return Number(tractor.horsepower) >= Number(implement.minHorsepower);
}

function getAvailableMachineObjectsByType(state, type) {
  const ids = getAvailableMachinesByType(state, type);
  return ids.map((id) => machines[id]).filter(Boolean);
}

function findCompatibleMachineSet(state, taskKey) {
  const requiredTypes = TASK_REQUIREMENTS[taskKey] || [];

  // harvest only needs a harvester, so no tractor compatibility needed
  if (requiredTypes.length === 1) {
    const onlyType = requiredTypes[0];
    const available = getAvailableMachinesByType(state, onlyType);
    if (!available.length) return null;
    return [available.map((id) => machines[id]).filter(Boolean).sort(speedSort)[0].id];
  }

  const needsTractor = requiredTypes.includes("tractor");
  if (!needsTractor) {
    const chosen = [];

    for (const type of requiredTypes) {
      const available = getAvailableMachinesByType(state, type);
      if (!available.length) return null;
      chosen.push(available.map((id) => machines[id]).filter(Boolean).sort(speedSort)[0].id);
    }

    return chosen;
  }

  const tractorOptions = getAvailableMachineObjectsByType(state, "tractor");
  const implementType = requiredTypes.find((t) => t !== "tractor");
  const implementOptions = getAvailableMachineObjectsByType(state, implementType);

  if (!tractorOptions.length || !implementOptions.length) return null;

  let best = null;
  let bestMult = Infinity;
  for (const tractor of tractorOptions) {
    for (const implement of implementOptions) {
      if (canTractorRunImplement(tractor, implement)) {
        const mult = getMachineSetSpeedMultiplier([tractor.id, implement.id]);
        if (mult < bestMult) {
          bestMult = mult;
          best = [tractor.id, implement.id];
        }
      }
    }
  }
  if (best) return best;

  return {
    incompatible: true,
    implementType,
    tractorOptions,
    implementOptions,
  };
}

function speedSort(a, b) {
  return Number(a?.taskSpeedMult || 1) - Number(b?.taskSpeedMult || 1);
}

function getMachineSetSpeedMultiplier(machineIds = []) {
  const values = (machineIds || [])
    .map((id) => Number(machines[id]?.taskSpeedMult || 1))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (!values.length) return 1;
  return Math.max(0.35, values.reduce((product, value) => product * value, 1));
}

async function getBestTaskSpeedMultiplier(guildId, userId, taskKey) {
  const state = await ensureMachineState(guildId, userId);
  const compatibleSet = findCompatibleMachineSet(state, taskKey);
  if (!Array.isArray(compatibleSet)) return 1;
  return getMachineSetSpeedMultiplier(compatibleSet);
}

async function reserveMachinesForTask(guildId, userId, fieldIndex, taskKey, durationMs) {
  const state = await ensureMachineState(guildId, userId);

  const tasksChanged = cleanupFinishedTasks(state);
  const rentalsChanged = cleanupExpiredRentals(state);
  const cleaned = tasksChanged || rentalsChanged;
  if (cleaned) await saveMachineState(guildId, userId, state);

  const requiredTypes = TASK_REQUIREMENTS[taskKey] || [];
  const compatibleSet = findCompatibleMachineSet(state, taskKey);

  if (!compatibleSet) {
    const missingType = requiredTypes.find((type) => getAvailableMachinesByType(state, type).length === 0);
    return {
      ok: false,
      reasonText: `You need a free ${missingType || "machine"} for ${taskKey}.`,
    };
  }

  if (compatibleSet.incompatible) {
    const bestTractorHp = Math.max(
      0,
      ...compatibleSet.tractorOptions.map((t) => Number(t.horsepower || 0))
    );
    const lowestRequiredHp = Math.min(
      ...compatibleSet.implementOptions.map((m) => Number(m.minHorsepower || 0))
    );

    return {
      ok: false,
      reasonText: `Your free tractors are not powerful enough for your available ${compatibleSet.implementType}s. Best available tractor: ${bestTractorHp} HP. Lowest requirement: ${lowestRequiredHp} HP.`,
    };
  }

  const chosenMachines = compatibleSet;

  const now = Date.now();

  state.activeTasks.push({
    fieldIndex,
    taskKey,
    machineIds: chosenMachines,
    startedAt: now,
    endsAt: now + durationMs,
  });

  await saveMachineState(guildId, userId, state);

  return {
    ok: true,
    machineIds: chosenMachines,
    speedMult: getMachineSetSpeedMultiplier(chosenMachines),
    endsAt: now + durationMs,
  };
}

module.exports = {
  ensureMachineState,
  saveMachineState,
  listMachines,
  getMachine,
  getOwnedCount,
  getRentedCount,
  buyMachine,
  rentMachine,
  sellMachine,
  getMachinesForTask,
  getAvailableCountForMachine,
  hasMachineForTask,
  cleanupFinishedTasks,
  cleanupExpiredRentals,
  getAvailableMachinesByType,
  getOccupiedCountForMachine,
  getSellValue,
  RENTAL_DURATION_MS,
  SELL_VALUE_RATE,
  reserveMachinesForTask,
  getBestTaskSpeedMultiplier,
  getMachineSetSpeedMultiplier,
  canTractorRunImplement,
  findCompatibleMachineSet,
};
