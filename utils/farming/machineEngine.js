const { pool } = require("../db");
const machines = require("../../data/farming/machines");
const TASK_REQUIREMENTS = {
  cultivate: ["tractor", "cultivator"],
  seed: ["tractor", "seeder"],
  fertilise: ["tractor", "sprayer"],
  harvest: ["harvester"],
};

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
  return Number(state?.rented?.[machineId]?.qty || 0);
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

  const balRes = await pool.query(
    `SELECT balance FROM user_balances WHERE guild_id=$1 AND user_id=$2`,
    [guildId, userId]
  );
  const balance = Number(balRes.rows[0]?.balance || 0);

  if (balance < machine.buyPrice) {
    return { ok: false, reasonText: `You need $${machine.buyPrice.toLocaleString()} to buy this machine.` };
  }

  await pool.query(
    `UPDATE user_balances SET balance = balance - $1 WHERE guild_id=$2 AND user_id=$3`,
    [machine.buyPrice, guildId, userId]
  );

  state.owned[machineId] = getOwnedCount(state, machineId) + 1;
  await saveMachineState(guildId, userId, state);

  return { ok: true, machine };
}

function cleanupFinishedTasks(state) {
  const now = Date.now();
  state.activeTasks = (state.activeTasks || []).filter(t => t.endsAt > now);
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

async function reserveMachinesForTask(guildId, userId, fieldIndex, taskKey, durationMs) {
  const state = await ensureMachineState(guildId, userId);

  cleanupFinishedTasks(state);

  const requiredTypes = TASK_REQUIREMENTS[taskKey] || [];
  const chosenMachines = [];

  for (const type of requiredTypes) {
    const available = getAvailableMachinesByType(state, type);

    if (available.length === 0) {
      return {
        ok: false,
        reasonText: `You need a free ${type} for ${taskKey}.`,
      };
    }

    const selected = available[0];
    chosenMachines.push(selected);
  }

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
  getMachinesForTask,
  getAvailableCountForMachine,
  hasMachineForTask,
  cleanupFinishedTasks,
  getAvailableMachinesByType,
  reserveMachinesForTask,
};