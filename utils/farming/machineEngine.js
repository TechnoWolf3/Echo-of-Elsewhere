const { pool } = require("../db");
const machines = require("../../data/farming/machines");

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

module.exports = {
  ensureMachineState,
  saveMachineState,
  listMachines,
  getMachine,
  getOwnedCount,
  getRentedCount,
  buyMachine,
};