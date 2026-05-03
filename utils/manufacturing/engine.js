const { pool } = require("../db");
const crops = require("../../data/farming/crops");
const config = require("../../data/manufacturing/config");
const recipes = require("../../data/manufacturing/recipes");
const materials = require("../../data/manufacturing/materials");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getFactoryTypes() {
  return config.FACTORY_TYPES;
}

function getRecipe(recipeId) {
  return recipes.find((recipe) => recipe.id === recipeId) || null;
}

function getRecipesForFactory(factoryType, plotLevel = 1) {
  return recipes
    .filter((recipe) => recipe.factoryType === factoryType && recipe.unlockLevel <= Number(plotLevel || 1))
    .sort((a, b) => a.unlockLevel - b.unlockLevel || a.name.localeCompare(b.name));
}

function getMaterial(materialId) {
  return materials[materialId] || null;
}

function newPlot() {
  return {
    level: 1,
    factoryType: null,
    inputStorage: {},
    outputStorage: {},
    productionSlots: [],
    pendingImports: [],
    contractStats: {
      completed: 0,
      earnings: 0,
    },
  };
}

function getNextPlotCost(plotCount) {
  return Math.floor(config.PLOT_BASE_COST * Math.pow(config.PLOT_COST_MULTIPLIER, Math.max(0, plotCount)));
}

function getUpgradeCost(currentLevel) {
  const nextLevel = Number(currentLevel || 1) + 1;
  return Number(config.UPGRADE_COSTS?.[nextLevel] || 0);
}

function getProductionSlotCount(level) {
  const numericLevel = Number(level || 1);
  if (numericLevel >= 8) return 4;
  if (numericLevel >= 5) return 3;
  if (numericLevel >= 3) return 2;
  return 1;
}

function getStorageCapacity(level) {
  return 18 + (Math.max(1, Number(level || 1)) - 1) * 8;
}

function sumStorage(storage = {}) {
  return Object.values(storage).reduce((sum, qty) => sum + Number(qty || 0), 0);
}

function getItemQty(storage = {}, itemId) {
  return Number(storage[itemId] || 0);
}

function addToStorage(storage = {}, itemId, amount) {
  const next = { ...storage };
  next[itemId] = getItemQty(next, itemId) + Number(amount || 0);
  if (next[itemId] <= 0) delete next[itemId];
  return next;
}

function getReservedOutputCount(plot) {
  return (plot.productionSlots || []).reduce((sum, slot) => {
    if (!slot?.recipeId || slot.completedAt) return sum;
    const recipe = getRecipe(slot.recipeId);
    if (!recipe) return sum;
    const bonus = slot.event?.handled ? 1 : 0;
    return sum + Number(recipe.output.amount || 0) + bonus;
  }, 0);
}

function getPendingImportCount(plot) {
  return (plot.pendingImports || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
}

function getOpenSlotIndex(plot) {
  const slots = getNormalizedSlots(plot);
  const maxSlots = getProductionSlotCount(plot.level);
  for (let index = 0; index < maxSlots; index += 1) {
    if (!slots[index]) return index;
  }
  return -1;
}

function getNormalizedSlots(plot) {
  const maxSlots = getProductionSlotCount(plot.level);
  const slots = Array.isArray(plot.productionSlots) ? clone(plot.productionSlots) : [];
  while (slots.length < maxSlots) slots.push(null);
  return slots.slice(0, maxSlots);
}

function normalizePlot(plot) {
  const nextPlot = plot && typeof plot === "object" ? plot : newPlot();
  nextPlot.level = Math.max(1, Number(nextPlot.level || 1));
  nextPlot.factoryType = nextPlot.factoryType || null;
  nextPlot.inputStorage = nextPlot.inputStorage && typeof nextPlot.inputStorage === "object" ? nextPlot.inputStorage : {};
  nextPlot.outputStorage = nextPlot.outputStorage && typeof nextPlot.outputStorage === "object" ? nextPlot.outputStorage : {};
  nextPlot.pendingImports = Array.isArray(nextPlot.pendingImports) ? nextPlot.pendingImports : [];
  nextPlot.productionSlots = getNormalizedSlots(nextPlot);
  nextPlot.contractStats = nextPlot.contractStats && typeof nextPlot.contractStats === "object"
    ? nextPlot.contractStats
    : { completed: 0, earnings: 0 };
  return nextPlot;
}

function normalizeState(state) {
  const nextState = state && typeof state === "object" ? state : {};
  nextState.plots = Array.isArray(nextState.plots) ? nextState.plots.map(normalizePlot) : [];
  nextState.contractBoard = nextState.contractBoard && typeof nextState.contractBoard === "object"
    ? nextState.contractBoard
    : { generatedAt: 0, offers: [] };
  return nextState;
}

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS manufacturing_plants (
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
    `SELECT data FROM manufacturing_plants WHERE guild_id=$1 AND user_id=$2`,
    [guildId, userId]
  );

  if (!res.rowCount) {
    const state = normalizeState({ plots: [] });
    await pool.query(
      `INSERT INTO manufacturing_plants (guild_id, user_id, data) VALUES ($1,$2,$3::jsonb)`,
      [guildId, userId, JSON.stringify(state)]
    );
    return state;
  }

  return normalizeState(res.rows[0].data || {});
}

async function saveState(guildId, userId, state) {
  const normalized = normalizeState(state);
  await ensureTable();
  await pool.query(
    `INSERT INTO manufacturing_plants (guild_id, user_id, data)
     VALUES ($1,$2,$3::jsonb)
     ON CONFLICT (guild_id, user_id)
     DO UPDATE SET data = EXCLUDED.data`,
    [guildId, userId, JSON.stringify(normalized)]
  );
  return normalized;
}

async function buyPlot(guildId, userId, state) {
  const nextState = normalizeState(state);
  if (nextState.plots.length >= config.MAX_PLOTS) {
    return { ok: false, reasonText: "You already own the maximum number of factory plots." };
  }

  nextState.plots.push(newPlot());
  await saveState(guildId, userId, nextState);
  return { ok: true, state: nextState };
}

async function upgradePlot(guildId, userId, state, plotIndex) {
  const nextState = normalizeState(state);
  const plot = nextState.plots?.[plotIndex];
  if (!plot) return { ok: false, reasonText: "That factory plot does not exist." };
  if (plot.level >= config.MAX_PLOT_LEVEL) return { ok: false, reasonText: "This factory plot is already max level." };

  const hasActiveSlots = getNormalizedSlots(plot).some((slot) => slot?.recipeId && !slot.completedAt);
  if (hasActiveSlots || (plot.pendingImports || []).length > 0) {
    return { ok: false, reasonText: "Wait for production and imports to finish before upgrading." };
  }

  plot.level += 1;
  plot.productionSlots = getNormalizedSlots(plot);
  await saveState(guildId, userId, nextState);
  return { ok: true, plot };
}

async function assignFactoryType(guildId, userId, state, plotIndex, factoryType) {
  const nextState = normalizeState(state);
  const plot = nextState.plots?.[plotIndex];
  if (!plot) return { ok: false, reasonText: "That factory plot does not exist." };
  if (!config.FACTORY_TYPES[factoryType]) return { ok: false, reasonText: "Unknown factory type." };

  plot.factoryType = factoryType;
  plot.productionSlots = getNormalizedSlots(plot);
  await saveState(guildId, userId, nextState);
  return { ok: true, plot, changed: false };
}

async function changeFactoryType(guildId, userId, state, plotIndex, factoryType) {
  const nextState = normalizeState(state);
  const plot = nextState.plots?.[plotIndex];
  if (!plot) return { ok: false, reasonText: "That factory plot does not exist." };
  if (!config.FACTORY_TYPES[factoryType]) return { ok: false, reasonText: "Unknown factory type." };
  if (!plot.factoryType) return assignFactoryType(guildId, userId, nextState, plotIndex, factoryType);
  if (plot.factoryType === factoryType) {
    return { ok: false, reasonText: "This plot is already assigned to that factory type." };
  }

  const retainRate = Number(config.FACTORY_CHANGE_RETAIN_RATE || 0.65);
  for (const [key, qty] of Object.entries(plot.inputStorage || {})) {
    const kept = Math.floor(Number(qty || 0) * retainRate);
    if (kept > 0) plot.inputStorage[key] = kept;
    else delete plot.inputStorage[key];
  }
  for (const [key, qty] of Object.entries(plot.outputStorage || {})) {
    const kept = Math.floor(Number(qty || 0) * retainRate);
    if (kept > 0) plot.outputStorage[key] = kept;
    else delete plot.outputStorage[key];
  }

  plot.pendingImports = [];
  plot.productionSlots = getNormalizedSlots(plot).map(() => null);
  plot.factoryType = factoryType;

  await saveState(guildId, userId, nextState);
  return { ok: true, plot, changed: true, retainRate };
}

function canFitInput(plot, amount) {
  const used = sumStorage(plot.inputStorage) + getPendingImportCount(plot);
  return used + Number(amount || 0) <= getStorageCapacity(plot.level);
}

function canFitOutput(plot, amount) {
  const used = sumStorage(plot.outputStorage) + getReservedOutputCount(plot);
  return used + Number(amount || 0) <= getStorageCapacity(plot.level);
}

function getAvailableCraftingQty(plot, itemId) {
  return getItemQty(plot.inputStorage, itemId) + getItemQty(plot.outputStorage, itemId);
}

function consumeCraftingQty(plot, itemId, amount) {
  let remaining = Number(amount || 0);
  const inputOwned = getItemQty(plot.inputStorage, itemId);
  const takeInput = Math.min(inputOwned, remaining);
  if (takeInput > 0) {
    plot.inputStorage = addToStorage(plot.inputStorage, itemId, -takeInput);
    remaining -= takeInput;
  }

  if (remaining > 0) {
    const outputOwned = getItemQty(plot.outputStorage, itemId);
    const takeOutput = Math.min(outputOwned, remaining);
    if (takeOutput > 0) {
      plot.outputStorage = addToStorage(plot.outputStorage, itemId, -takeOutput);
      remaining -= takeOutput;
    }
  }

  return remaining <= 0;
}

async function consumeFarmInventory(guildId, userId, itemId, amount) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await client.query(
      `
      SELECT ui.qty
      FROM user_inventory ui
      JOIN store_items si
        ON si.guild_id = ui.guild_id
       AND si.item_id = ui.item_id
      WHERE ui.guild_id=$1
        AND ui.user_id=$2
        AND ui.item_id=$3
        AND COALESCE((si.meta->>'farming')::boolean, false) = true
      FOR UPDATE
      `,
      [guildId, userId, itemId]
    );

    const owned = Number(res.rows?.[0]?.qty || 0);
    if (owned < amount) {
      await client.query("ROLLBACK");
      return { ok: false, reasonText: "You do not have enough farm produce to import." };
    }

    await client.query(
      `
      UPDATE user_inventory
      SET qty = qty - $4,
          updated_at = NOW()
      WHERE guild_id=$1 AND user_id=$2 AND item_id=$3
      `,
      [guildId, userId, itemId, amount]
    );

    await client.query(
      `
      DELETE FROM user_inventory
      WHERE guild_id=$1 AND user_id=$2 AND item_id=$3 AND qty <= 0
      `,
      [guildId, userId, itemId]
    );

    await client.query("COMMIT");
    return { ok: true };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function listFarmImportCandidates(guildId, userId, plot = null) {
  const res = await pool.query(
    `
    SELECT ui.item_id, ui.qty, si.name
    FROM user_inventory ui
    JOIN store_items si
      ON si.guild_id = ui.guild_id
     AND si.item_id = ui.item_id
    WHERE ui.guild_id = $1
      AND ui.user_id = $2
      AND ui.qty > 0
      AND COALESCE((si.meta->>'farming')::boolean, false) = true
    ORDER BY si.name ASC
    `,
    [guildId, userId]
  );

  const recipeInputs = new Set();
  if (plot?.factoryType) {
    for (const recipe of getRecipesForFactory(plot.factoryType, plot.level)) {
      for (const input of recipe.inputs || []) recipeInputs.add(input.itemId);
    }
  }

  return res.rows
    .map((row) => ({
      itemId: row.item_id,
      name: row.name || crops[row.item_id]?.name || row.item_id,
      qty: Number(row.qty || 0),
      relevant: recipeInputs.size ? recipeInputs.has(row.item_id) : true,
    }))
    .filter((item) => item.qty > 0)
    .sort((a, b) => Number(b.relevant) - Number(a.relevant) || a.name.localeCompare(b.name));
}

async function startImport(guildId, userId, state, plotIndex, itemId, amount) {
  const nextState = normalizeState(state);
  const plot = nextState.plots?.[plotIndex];
  if (!plot) return { ok: false, reasonText: "That factory plot does not exist." };
  if (!plot.factoryType) return { ok: false, reasonText: "Assign a factory type before importing materials." };

  const importAmount = Math.max(1, Number(amount || 0));
  if (!canFitInput(plot, importAmount)) {
    return { ok: false, reasonText: "That plot does not have enough input storage space." };
  }

  const consume = await consumeFarmInventory(guildId, userId, itemId, importAmount);
  if (!consume.ok) return consume;

  const now = Date.now();
  const importRun = {
    id: `import:${plotIndex}:${itemId}:${now}`,
    itemId,
    amount: importAmount,
    startedAt: now,
    arrivesAt: now + (config.IMPORT_BASE_TIME_SECONDS + (config.IMPORT_PER_ITEM_SECONDS * importAmount)) * 1000,
  };

  plot.pendingImports.push(importRun);
  await saveState(guildId, userId, nextState);
  return { ok: true, importRun };
}

function getEventForFactory(factoryType, startedAt) {
  const list = config.EVENT_TYPES[factoryType] || [];
  if (!list.length) return null;
  const index = Math.abs(Math.floor(Number(startedAt || Date.now()) / 1000)) % list.length;
  return list[index];
}

async function startProduction(guildId, userId, state, plotIndex, recipeId) {
  const nextState = normalizeState(state);
  const plot = nextState.plots?.[plotIndex];
  if (!plot) return { ok: false, reasonText: "That factory plot does not exist." };
  if (!plot.factoryType) return { ok: false, reasonText: "Assign a factory type before starting production." };

  const recipe = getRecipe(recipeId);
  if (!recipe || recipe.factoryType !== plot.factoryType) {
    return { ok: false, reasonText: "That recipe is not available for this factory." };
  }
  if (recipe.unlockLevel > plot.level) {
    return { ok: false, reasonText: "This plot needs a higher level to run that recipe." };
  }

  for (const input of recipe.inputs || []) {
    if (getAvailableCraftingQty(plot, input.itemId) < Number(input.amount || 0)) {
      return { ok: false, reasonText: "That plot does not have the required input materials." };
    }
  }

  const outputAmount = Number(recipe.output?.amount || 0);
  if (!canFitOutput(plot, outputAmount + 1)) {
    return { ok: false, reasonText: "That plot does not have enough output storage for another run." };
  }

  const slotIndex = getOpenSlotIndex(plot);
  if (slotIndex === -1) return { ok: false, reasonText: "All production slots are currently busy." };

  for (const input of recipe.inputs || []) {
    consumeCraftingQty(plot, input.itemId, Number(input.amount || 0));
  }

  const now = Date.now();
  const eventTemplate = getEventForFactory(plot.factoryType, now);
  plot.productionSlots = getNormalizedSlots(plot);
  plot.productionSlots[slotIndex] = {
    recipeId,
    startedAt: now,
    endsAt: now + Number(recipe.baseTimeSeconds || 0) * 1000,
    eventAt: now + Math.floor((Number(recipe.baseTimeSeconds || 0) * 1000) / 2),
    event: eventTemplate
      ? {
          ...eventTemplate,
          handled: false,
          bonusOutput: 1,
        }
      : null,
  };

  await saveState(guildId, userId, nextState);
  return { ok: true, slotIndex, slot: plot.productionSlots[slotIndex], recipe };
}

function getOutputItemName(itemId) {
  const recipe = recipes.find((entry) => entry.output?.itemId === itemId);
  if (recipe) return recipe.name;
  if (materials[itemId]) return materials[itemId].name;
  if (crops[itemId]) return crops[itemId].name;
  return itemId;
}

async function ensureManufacturedStoreItem(guildId, recipe) {
  if (!recipe?.output?.itemId) return;
  await pool.query(
    `INSERT INTO store_items (guild_id, item_id, name, description, price, kind, stackable, enabled, meta, sort_order, sell_enabled, sell_price)
     VALUES ($1,$2,$3,$4,0,'manufactured',true,true,$5::jsonb,9600,false,0)
     ON CONFLICT (guild_id, item_id)
     DO UPDATE SET
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       kind = 'manufactured',
       enabled = true,
       meta = EXCLUDED.meta,
       sell_enabled = false,
       sell_price = 0`,
    [
      guildId,
      recipe.output.itemId,
      recipe.name,
      recipe.description || `${recipe.name} finished in your manufacturing enterprise.`,
      JSON.stringify({
        manufacturing: true,
        factoryType: recipe.factoryType,
        marketEnabled: Boolean(recipe.marketEnabled),
        contractEnabled: Boolean(recipe.contractEnabled),
        recipeId: recipe.id,
      }),
    ]
  );
}

function refreshContractBoard(state) {
  const nextState = normalizeState(state);
  const now = Date.now();
  const board = nextState.contractBoard || { generatedAt: 0, offers: [] };
  const expired = !board.generatedAt || (now - Number(board.generatedAt || 0)) >= config.CONTRACT_REFRESH_MS;
  if (!expired && Array.isArray(board.offers) && board.offers.length) return nextState;

  const offerPool = recipes.filter((recipe) => recipe.contractEnabled);
  const offers = [];
  for (let index = 0; index < Math.min(config.CONTRACT_COUNT, offerPool.length); index += 1) {
    const recipe = offerPool[(Math.floor(now / 1000) + index) % offerPool.length];
    const qty = 2 + ((Math.floor(now / 60000) + index) % 4);
    offers.push({
      id: `contract:${recipe.id}:${index}`,
      recipeId: recipe.id,
      itemId: recipe.output.itemId,
      name: recipe.name,
      qty,
      payout: Math.floor(Number(recipe.baseValue || 0) * qty * 1.2),
      expiresAt: now + config.CONTRACT_REFRESH_MS,
    });
  }

  nextState.contractBoard = {
    generatedAt: now,
    offers,
  };
  return nextState;
}

async function applyRuntimeRollovers(guildId, userId, state) {
  const nextState = normalizeState(state);
  let changed = false;
  const completions = [];
  const imports = [];

  for (const plot of nextState.plots) {
    for (const pendingImport of [...(plot.pendingImports || [])]) {
      if (Date.now() >= Number(pendingImport.arrivesAt || 0)) {
        plot.inputStorage = addToStorage(plot.inputStorage, pendingImport.itemId, Number(pendingImport.amount || 0));
        plot.pendingImports = (plot.pendingImports || []).filter((entry) => entry.id !== pendingImport.id);
        imports.push({ itemId: pendingImport.itemId, amount: Number(pendingImport.amount || 0) });
        changed = true;
      }
    }

    plot.productionSlots = getNormalizedSlots(plot);
    for (let slotIndex = 0; slotIndex < plot.productionSlots.length; slotIndex += 1) {
      const slot = plot.productionSlots[slotIndex];
      if (!slot?.recipeId) continue;
      if (Date.now() < Number(slot.endsAt || 0)) continue;

      const recipe = getRecipe(slot.recipeId);
      if (!recipe) {
        plot.productionSlots[slotIndex] = null;
        changed = true;
        continue;
      }

      const bonus = slot.event?.handled ? Number(slot.event.bonusOutput || 0) : 0;
      plot.outputStorage = addToStorage(plot.outputStorage, recipe.output.itemId, Number(recipe.output.amount || 0) + bonus);
      await ensureManufacturedStoreItem(guildId, recipe);
      plot.productionSlots[slotIndex] = null;
      completions.push({
        plotFactoryType: plot.factoryType,
        recipeId: recipe.id,
        recipeName: recipe.name,
        outputItemId: recipe.output.itemId,
        amount: Number(recipe.output.amount || 0) + bonus,
      });
      changed = true;
    }
  }

  refreshContractBoard(nextState);

  if (changed) await saveState(guildId, userId, nextState);
  return { state: nextState, changed, completions, imports };
}

function getAggregatedOutput(state) {
  const nextState = normalizeState(state);
  const totals = {};
  for (const plot of nextState.plots) {
    for (const [itemId, qty] of Object.entries(plot.outputStorage || {})) {
      totals[itemId] = (totals[itemId] || 0) + Number(qty || 0);
    }
  }

  return Object.entries(totals)
    .map(([itemId, qty]) => ({ itemId, qty, name: getOutputItemName(itemId) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function takeFromOutputStorage(state, itemId, amount) {
  let remaining = Number(amount || 0);
  for (const plot of state.plots || []) {
    const owned = getItemQty(plot.outputStorage, itemId);
    if (owned <= 0) continue;
    const used = Math.min(owned, remaining);
    plot.outputStorage = addToStorage(plot.outputStorage, itemId, -used);
    remaining -= used;
    if (remaining <= 0) break;
  }
  return remaining <= 0;
}

async function handleFactoryEvent(guildId, userId, state, plotIndex, slotIndex) {
  const nextState = normalizeState(state);
  const plot = nextState.plots?.[plotIndex];
  if (!plot) return { ok: false, reasonText: "That factory plot does not exist." };
  plot.productionSlots = getNormalizedSlots(plot);
  const slot = plot.productionSlots?.[slotIndex];
  if (!slot?.event) return { ok: false, reasonText: "There is no active factory event on that slot." };
  if (slot.event.handled) return { ok: false, reasonText: "That factory event has already been handled." };
  slot.event.handled = true;
  await saveState(guildId, userId, nextState);
  return { ok: true, event: slot.event };
}

module.exports = {
  ensureState,
  saveState,
  getFactoryTypes,
  getRecipe,
  getRecipesForFactory,
  getMaterial,
  getNextPlotCost,
  getUpgradeCost,
  getProductionSlotCount,
  getStorageCapacity,
  getOutputItemName,
  getAggregatedOutput,
  getItemQty,
  sumStorage,
  buyPlot,
  upgradePlot,
  assignFactoryType,
  changeFactoryType,
  listFarmImportCandidates,
  startImport,
  startProduction,
  applyRuntimeRollovers,
  handleFactoryEvent,
  refreshContractBoard,
  takeFromOutputStorage,
};
