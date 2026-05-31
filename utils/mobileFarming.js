const appLinking = require("./appLinking");
const economy = require("./economy");
const farming = require("./farming/engine");
const machineEngine = require("./farming/machineEngine");
const farmWeather = require("./farming/weather");
const market = require("./farming/market");
const seasonControl = require("./farming/seasonControl");
const farmConfig = require("../data/farming/config");
const crops = require("../data/farming/crops");
const fertilisers = require("../data/farming/fertilisers");
const livestock = require("../data/farming/livestock");
const animalHusbandry = require("../data/farming/animalHusbandry");
const machineCatalog = require("../data/farming/machines");
const marketConfig = require("../data/farming/marketConfig");

function bad(message, statusCode = 400) {
  return { ok: false, statusCode, message };
}

function requireDiscordContext(ctx) {
  const guildId = String(ctx?.guildId || "").trim();
  const userId = String(ctx?.discordUserId || "").trim();
  if (!guildId || !userId) {
    return bad("Link Discord before using Farming.");
  }
  return { ok: true, guildId, userId };
}

function positiveQty(value) {
  const qty = Math.floor(Number(value || 1));
  return Math.max(1, Math.min(999, Number.isFinite(qty) ? qty : 1));
}

function fieldIndexValue(value) {
  const n = Math.floor(Number(value));
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

function money(value) {
  return `$${Math.max(0, Number(value || 0)).toLocaleString()}`;
}

function machineMetadata(machine) {
  const speedMultiplier = Number(machine?.taskSpeedMult || 1);
  return {
    id: machine.id,
    name: machine.name,
    category: machine.type || "other",
    tier: Number(machine.tier || 1),
    horsepower: machine.horsepower ?? null,
    requiredHorsepower: machine.minHorsepower ?? null,
    buyPrice: Number(machine.buyPrice || 0),
    rentPrice: Number(machine.rentPrice || 0),
    sellPrice: machineEngine.getSellValue(machine),
    speedBonus: Math.max(0, Math.round((1 - speedMultiplier) * 100)),
    speedMultiplier,
    tasks: Array.isArray(machine.requiredFor) ? machine.requiredFor : [],
  };
}

function machineList() {
  return Object.values(machineCatalog).map(machineMetadata);
}

function normalizeSeasons(crop) {
  const raw = crop?.seasons || crop?.validSeasons || crop?.plantingSeasons || crop?.allowedSeasons || [];
  return Array.isArray(raw)
    ? raw.map((season) => String(season || "").toLowerCase()).filter(Boolean)
    : [];
}

function cropList() {
  return Object.values(crops).map((crop) => {
    const seasons = normalizeSeasons(crop);
    return {
      id: crop.id,
      name: crop.name,
      level: Number(crop.level || 1),
      growthHours: Number(crop.growthHours || 0),
      regrowHours: crop.regrowHours == null ? null : Number(crop.regrowHours),
      yield: Array.isArray(crop.yield) ? crop.yield.map((value) => Number(value || 0)) : [0, 0],
      seasons,
      validSeasons: seasons,
      plantingSeasons: seasons,
      allowedSeasons: seasons,
      regrow: Boolean(crop.regrow),
      debrisChance: Number(crop.debrisChance ?? 0),
      family: farming.getCropFamily(crop.id),
    };
  });
}

function groupMachinesByType() {
  const grouped = {};
  for (const machine of machineList()) {
    const type = machine.category || "other";
    if (!grouped[type]) grouped[type] = [];
    grouped[type].push(machine);
  }
  return grouped;
}

function weatherDayKey(state) {
  const numericDay = Number(state?.dayKey);
  if (Number.isFinite(numericDay) && numericDay > 0) {
    return new Date(numericDay * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }
  return state?.dayKey ? String(state.dayKey) : null;
}

function formatWeather(state, now = Date.now()) {
  const channel = farmWeather.buildWeatherChannel(state, now);
  const activeNow = farmWeather.isEventActive(state, now);
  return {
    dayKey: weatherDayKey(state),
    rawDayKey: state?.dayKey || null,
    season: state?.season || null,
    baseWeather: state?.baseWeather || "clear",
    headline: channel.headline || "Clear skies",
    forecast: channel.forecast || "Stable conditions across the farms.",
    impact: channel.impact || "No active crop or field modifiers.",
    activeNow,
    eventName: channel.eventName || state?.event?.name || null,
    event: state?.event || null,
    rolledAt: state?.rolledAt || null,
    report: channel.report || null,
  };
}

function formatSeason(summary) {
  return {
    current: summary?.season || null,
    next: summary?.nextSeason || null,
    nextSeasonAt: summary?.nextWeekStartUtcMs || null,
    weekStartAt: summary?.weekStartUtcMs || null,
    manualOffsetWeeks: Number(summary?.manualOffsetWeeks || 0),
    lastAdvancedAt: summary?.lastAdvancedAt || null,
  };
}

const RESTORABLE_MACHINE_TASKS = new Set(["cultivate", "harvest"]);

async function repairFarmMachineTaskState(guildId, userId, farm, machines) {
  if (!farm || !machines) return { repaired: false, repairs: [] };
  if (!Array.isArray(farm.fields)) farm.fields = [];
  if (!Array.isArray(machines.activeTasks)) machines.activeTasks = [];

  const now = Date.now();
  let farmChanged = false;
  let machinesChanged = false;
  const repairs = [];
  const keptTasks = [];

  for (const machineTask of machines.activeTasks) {
    const index = fieldIndexValue(machineTask?.fieldIndex);
    const taskKey = String(machineTask?.taskKey || machineTask?.key || "").trim();
    const endsAt = Number(machineTask?.endsAt || 0);
    const startedAt = Number(machineTask?.startedAt || 0) || now;
    const field = index === null ? null : farm.fields[index];

    if (!taskKey || index === null || !field) {
      machinesChanged = true;
      repairs.push({ type: "released_invalid_machine_task", fieldIndex: index, taskKey: taskKey || null });
      continue;
    }

    if (!endsAt || endsAt <= now) {
      machinesChanged = true;
      repairs.push({ type: "released_expired_machine_task", fieldIndex: index, taskKey });
      continue;
    }

    const fieldTask = field.task || null;
    if (fieldTask?.key) {
      if (fieldTask.key === taskKey) {
        keptTasks.push(machineTask);
      } else {
        machinesChanged = true;
        repairs.push({
          type: "released_mismatched_machine_task",
          fieldIndex: index,
          taskKey,
          fieldTaskKey: fieldTask.key,
        });
      }
      continue;
    }

    if (!RESTORABLE_MACHINE_TASKS.has(taskKey)) {
      machinesChanged = true;
      repairs.push({ type: "released_unrestorable_machine_task", fieldIndex: index, taskKey });
      continue;
    }

    field.task = {
      key: taskKey,
      startedAt,
      endsAt,
    };
    farmChanged = true;
    keptTasks.push(machineTask);
    repairs.push({ type: "restored_field_task_from_machine", fieldIndex: index, taskKey });
  }

  if (machinesChanged) {
    machines.activeTasks = keptTasks;
    await machineEngine.saveMachineState(guildId, userId, machines);
  }
  if (farmChanged) {
    await farming.saveFarm(guildId, userId, farm);
  }

  return { repaired: farmChanged || machinesChanged, repairs };
}

async function loadNormalizedState(ctx, message = "Farm state loaded.") {
  const auth = requireDiscordContext(ctx);
  if (!auth.ok) return auth;
  const { guildId, userId } = auth;

  await economy.ensureUser(guildId, userId);
  const weatherState = await farmWeather.ensureDailyWeatherState(guildId);
  const farm = await farming.ensureFarm(guildId, userId);
  const machines = await machineEngine.ensureMachineState(guildId, userId);
  await repairFarmMachineTaskState(guildId, userId, farm, machines);

  const sellableInventory = await market.getSellableFarmItems(guildId, userId);
  const profile = await appLinking.buildProfileSnapshot(ctx.profileId);
  const nextFieldCost = Array.isArray(farm.fields) && farm.fields.length < farmConfig.MAX_FIELDS
    ? farming.getNextFieldCost(farm.fields.length)
    : null;
  const seasonSummary = seasonControl.getSeasonStateSummary(guildId);

  return {
    ok: true,
    body: {
      farm,
      machines,
      weather: formatWeather(weatherState),
      farmWeather: {
        data: weatherState,
        channel: farmWeather.buildWeatherChannel(weatherState),
      },
      season: formatSeason(seasonSummary),
      sellableInventory,
      nextFieldCost,
      profile,
      message,
    },
  };
}

async function withFarm(ctx) {
  const auth = requireDiscordContext(ctx);
  if (!auth.ok) return auth;
  await economy.ensureUser(auth.guildId, auth.userId);
  await farmWeather.ensureDailyWeatherState(auth.guildId);
  const farm = await farming.ensureFarm(auth.guildId, auth.userId);
  const machines = await machineEngine.ensureMachineState(auth.guildId, auth.userId);
  await repairFarmMachineTaskState(auth.guildId, auth.userId, farm, machines);
  return { ok: true, ...auth, farm };
}

async function chargeBank(guildId, userId, amount, type, meta, shortfallMessage) {
  const debit = await economy.tryDebitBank(guildId, userId, amount, type, meta);
  if (!debit.ok) {
    return bad(shortfallMessage || `You need ${money(amount)} in your bank.`);
  }
  return { ok: true };
}

async function refundBank(guildId, userId, amount, type, meta) {
  await economy.creditBank(guildId, userId, amount, type, meta).catch((error) => {
    console.warn("[FARM][API] bank refund failed:", error?.message || error);
  });
}

async function addToServerBank(guildId, userId, amount, type, meta) {
  await economy.addServerBank(guildId, amount, type, {
    enterprise: "farming",
    userId,
    ...meta,
  }).catch((error) => {
    console.warn("[FARM][API] server bank deposit failed:", error?.message || error);
  });
}

async function startFieldTask(ctx, fieldIndex, taskKey, extra = {}, message = "Field task started.") {
  const state = await withFarm(ctx);
  if (!state.ok) return state;
  const { guildId, userId, farm } = state;
  const index = fieldIndexValue(fieldIndex);
  if (index === null) return bad("Invalid field index.");

  const field = farm.fields?.[index];
  const baseTaskMs = farming.getTaskDurationMs(field, taskKey, 60_000);
  const speedMult = await machineEngine.getBestTaskSpeedMultiplier(guildId, userId, taskKey);
  const taskMs = Math.max(15_000, Math.round(baseTaskMs * speedMult));
  const reservation = await machineEngine.reserveMachinesForTask(guildId, userId, index, taskKey, taskMs);
  if (!reservation.ok) return bad(reservation.reasonText || "No suitable machine is available.");

  const result = await farming.startFieldTask(guildId, userId, farm, index, taskKey, taskMs, extra);
  if (!result.ok) {
    await machineEngine.releaseMachinesForTask(guildId, userId, index, taskKey);
    return bad(result.reasonText || "That field task could not be started.");
  }

  const persistedFarm = await farming.ensureFarm(guildId, userId);
  const persistedTask = persistedFarm.fields?.[index]?.task || null;
  if (!persistedTask || persistedTask.key !== taskKey) {
    await machineEngine.releaseMachinesForTask(guildId, userId, index, taskKey);
    return bad("Field task did not persist. No farming action was started.", 500);
  }

  const persistedMachines = await machineEngine.ensureMachineState(guildId, userId);
  const persistedReservation = (persistedMachines.activeTasks || []).find((task) => {
    return Number(task.fieldIndex) === Number(index)
      && task.taskKey === taskKey
      && Array.isArray(task.machineIds)
      && task.machineIds.length > 0;
  });
  if (!persistedReservation) {
    await farming.clearFieldTask(guildId, userId, persistedFarm, index).catch(() => {});
    return bad("Machine reservation did not persist. No farming action was started.", 500);
  }

  const endsAt = result.task?.endsAt ? new Date(Number(result.task.endsAt)).toISOString() : null;
  const snapshot = await loadNormalizedState(ctx, endsAt ? `${message} Ready at ${endsAt}.` : message);
  if (snapshot.ok) {
    snapshot.body.startedTask = {
      fieldIndex: index,
      fieldNumber: index + 1,
      task: persistedTask,
      machineIds: persistedReservation.machineIds,
    };
  }
  return snapshot;
}

async function overview(ctx) {
  return loadNormalizedState(ctx, "Farm state loaded.");
}

async function config(ctx) {
  const auth = requireDiscordContext(ctx);
  if (!auth.ok) return auth;
  await farmWeather.ensureDailyWeatherState(auth.guildId);
  await seasonControl.ensureSeasonStateLoaded(auth.guildId);

  const marketPrices = {};
  for (const [itemId, cfg] of Object.entries(marketConfig)) {
    marketPrices[itemId] = {
      itemId,
      basePrice: Number(cfg.basePrice || 0),
      seasonalRanges: cfg.seasonalRanges || {},
      currentPrice: market.getPrice(itemId, auth.guildId),
    };
  }

  return {
    ok: true,
    body: {
      fieldCosts: {
        base: farmConfig.FIELD_BASE_COST,
        multiplier: farmConfig.FIELD_COST_MULTIPLIER,
        maxFields: farmConfig.MAX_FIELDS,
        maxFieldLevel: farmConfig.MAX_FIELD_LEVEL,
        upgradeCosts: farmConfig.UPGRADE_COSTS,
        fieldUpgradeDurationMs: farmConfig.FIELD_UPGRADE_DURATION_MS,
      },
      barn: {
        demolitionBaseCost: farmConfig.BARN_DEMOLITION_BASE_COST,
        demolitionLevelMultiplier: farmConfig.BARN_DEMOLITION_LEVEL_MULTIPLIER,
        upgradeDurationMs: farmConfig.BARN_UPGRADE_DURATION_MS,
        capacityLevelMultipliers: farmConfig.BARN_CAPACITY_LEVEL_MULTIPLIERS,
      },
      crops: cropList(),
      seasons: farmConfig.SEASONS,
      fertilisers,
      livestock,
      husbandryItems: animalHusbandry,
      machineCategories: groupMachinesByType(),
      machines: machineList(),
      marketPrices,
      season: seasonControl.getSeasonStateSummary(auth.guildId),
    },
  };
}

async function buyField(ctx) {
  const state = await withFarm(ctx);
  if (!state.ok) return state;
  const { guildId, userId, farm } = state;
  const cost = farming.getNextFieldCost((farm.fields || []).length);
  const debit = await chargeBank(guildId, userId, cost, "farming_field_purchase", { fieldCount: (farm.fields || []).length }, `You need ${money(cost)} in your bank to buy another field.`);
  if (!debit.ok) return debit;

  const result = await farming.buyField(guildId, userId, farm);
  if (result?.ok === false) {
    await refundBank(guildId, userId, cost, "farming_field_purchase_refund", { reason: result.reasonText });
    return bad(result.reasonText || "Could not buy field.");
  }

  await addToServerBank(guildId, userId, cost, "farming_field_purchase_bank", { action: "buy_field" });
  return loadNormalizedState(ctx, `Field purchased for ${money(cost)}.`);
}

async function restField(ctx, fieldIndex) {
  const state = await withFarm(ctx);
  if (!state.ok) return state;
  const index = fieldIndexValue(fieldIndex);
  if (index === null) return bad("Invalid field index.");
  const result = await farming.restField(state.guildId, state.userId, state.farm, index);
  if (!result.ok) return bad(result.reasonText || "Could not rest field.");
  return loadNormalizedState(ctx, `Field rested. Soil health moved from ${result.before}% to ${result.after}%.`);
}

async function upgradeField(ctx, fieldIndex) {
  const state = await withFarm(ctx);
  if (!state.ok) return state;
  const index = fieldIndexValue(fieldIndex);
  if (index === null) return bad("Invalid field index.");
  const field = state.farm.fields?.[index];
  const cost = farming.getUpgradeCost(field?.level || 1);
  if (!cost) return bad("That field cannot be upgraded further.");

  const debit = await chargeBank(state.guildId, state.userId, cost, "farming_field_upgrade", { fieldIndex: index }, `You need ${money(cost)} in your bank to upgrade that field.`);
  if (!debit.ok) return debit;

  const result = await farming.upgradeField(state.guildId, state.userId, state.farm, index);
  if (!result.ok) {
    await refundBank(state.guildId, state.userId, cost, "farming_field_upgrade_refund", { fieldIndex: index, reason: result.reasonText });
    return bad(result.reasonText || "Could not upgrade field.");
  }

  await addToServerBank(state.guildId, state.userId, cost, "farming_field_upgrade_bank", { action: "upgrade_field", fieldIndex: index });
  return loadNormalizedState(ctx, `Field upgrade started for ${money(cost)}.`);
}

async function convertBarn(ctx, fieldIndex, livestockType) {
  const state = await withFarm(ctx);
  if (!state.ok) return state;
  const index = fieldIndexValue(fieldIndex);
  if (index === null) return bad("Invalid field index.");
  const type = farming.getLivestockType(String(livestockType || ""));
  if (!type) return bad("Unknown livestock type.");
  const cost = Number(type.convertCost || 0);

  const debit = await chargeBank(state.guildId, state.userId, cost, "farming_barn_conversion", { fieldIndex: index, livestockType: type.id }, `You need ${money(cost)} in your bank to convert that field.`);
  if (!debit.ok) return debit;

  const result = await farming.convertFieldToBarn(state.guildId, state.userId, state.farm, index, type.id);
  if (!result.ok) {
    await refundBank(state.guildId, state.userId, cost, "farming_barn_conversion_refund", { fieldIndex: index, livestockType: type.id, reason: result.reasonText });
    return bad(result.reasonText || "Could not convert field to barn.");
  }

  await addToServerBank(state.guildId, state.userId, cost, "farming_barn_conversion_bank", { action: "convert_barn", fieldIndex: index, livestockType: type.id });
  return loadNormalizedState(ctx, `${type.name} built for ${money(cost)}.`);
}

async function barnAction(ctx, fieldIndex, action, body = {}) {
  const state = await withFarm(ctx);
  if (!state.ok) return state;
  const index = fieldIndexValue(fieldIndex);
  if (index === null) return bad("Invalid field index.");
  const { guildId, userId, farm } = state;

  if (action === "collect") {
    const result = await farming.collectBarnProducts(guildId, userId, farm, index);
    if (!result.ok) return bad(result.reasonText || "Could not collect barn products.");
    return loadNormalizedState(ctx, `Collected ${result.qty} ${result.itemName}.`);
  }

  if (action === "slaughter") {
    const result = await farming.slaughterBarn(guildId, userId, farm, index);
    if (!result.ok) return bad(result.reasonText || "Could not process livestock.");
    return loadNormalizedState(ctx, `Processed ${result.animals} animals into ${result.qty} ${result.itemName}.`);
  }

  if (action === "slaughter-elderly") {
    const result = await farming.slaughterElderlyBarn(guildId, userId, farm, index);
    if (!result.ok) return bad(result.reasonText || "Could not process elderly livestock.");
    return loadNormalizedState(ctx, `Processed ${result.animals} elderly animals into ${result.qty} ${result.itemName}.`);
  }

  if (action === "breed") {
    const result = await farming.breedBarnAnimals(guildId, userId, farm, index, String(body.itemId || ""));
    if (!result.ok) return bad(result.reasonText || "Could not breed livestock.");
    return loadNormalizedState(ctx, `Breeding successful. ${result.qty} young ${result.type.animalName || "animals"} added.`);
  }

  if (action === "restock") {
    const barn = farm.fields?.[index];
    const type = farming.getLivestockType(barn?.livestockType);
    if (!type) return bad("That barn does not exist.");
    const cost = Math.max(1, Math.floor(Number(type.convertCost || 0) * 0.35));
    const debit = await chargeBank(guildId, userId, cost, "farming_barn_restock", { fieldIndex: index, livestockType: type.id }, `You need ${money(cost)} in your bank to restock that barn.`);
    if (!debit.ok) return debit;
    const result = await farming.restockBarn(guildId, userId, farm, index);
    if (!result.ok) {
      await refundBank(guildId, userId, cost, "farming_barn_restock_refund", { fieldIndex: index, reason: result.reasonText });
      return bad(result.reasonText || "Could not restock barn.");
    }
    await addToServerBank(guildId, userId, cost, "farming_barn_restock_bank", { action: "restock_barn", fieldIndex: index });
    return loadNormalizedState(ctx, `Barn restocked for ${money(cost)}.`);
  }

  if (action === "upgrade") {
    const cost = farming.getBarnUpgradeCost(farm.fields?.[index]);
    if (!cost) return bad("That barn cannot be upgraded further.");
    const debit = await chargeBank(guildId, userId, cost, "farming_barn_upgrade", { fieldIndex: index }, `You need ${money(cost)} in your bank to upgrade that barn.`);
    if (!debit.ok) return debit;
    const result = await farming.startBarnUpgrade(guildId, userId, farm, index);
    if (!result.ok) {
      await refundBank(guildId, userId, cost, "farming_barn_upgrade_refund", { fieldIndex: index, reason: result.reasonText });
      return bad(result.reasonText || "Could not upgrade barn.");
    }
    await addToServerBank(guildId, userId, cost, "farming_barn_upgrade_bank", { action: "upgrade_barn", fieldIndex: index });
    return loadNormalizedState(ctx, `Barn upgrade started for ${money(cost)}.`);
  }

  if (action === "demolish") {
    const cost = farming.getBarnDemolitionCost(farm.fields?.[index]);
    const debit = await chargeBank(guildId, userId, cost, "farming_barn_demolition", { fieldIndex: index }, `You need ${money(cost)} in your bank to demolish that barn.`);
    if (!debit.ok) return debit;
    const result = await farming.demolishBarn(guildId, userId, farm, index);
    if (!result.ok) {
      await refundBank(guildId, userId, cost, "farming_barn_demolition_refund", { fieldIndex: index, reason: result.reasonText });
      return bad(result.reasonText || "Could not demolish barn.");
    }
    await addToServerBank(guildId, userId, cost, "farming_barn_demolition_bank", { action: "demolish_barn", fieldIndex: index });
    return loadNormalizedState(ctx, `Barn demolished for ${money(cost)}.`);
  }

  return bad("Unknown barn action.", 404);
}

async function buyFertiliser(ctx, fertiliserId, qtyInput) {
  const state = await withFarm(ctx);
  if (!state.ok) return state;
  const fertiliser = farming.getFertiliser(String(fertiliserId || ""));
  if (!fertiliser) return bad("Unknown fertiliser.");
  const qty = positiveQty(qtyInput);
  const total = Number(fertiliser.price || 0) * qty;
  const debit = await chargeBank(state.guildId, state.userId, total, "farming_fertiliser_purchase", { fertiliserId: fertiliser.id, qty }, `You need ${money(total)} in your bank to buy that fertiliser.`);
  if (!debit.ok) return debit;
  const result = await farming.buyFertiliser(state.guildId, state.userId, state.farm, fertiliser.id, qty);
  if (!result.ok) {
    await refundBank(state.guildId, state.userId, total, "farming_fertiliser_refund", { fertiliserId: fertiliser.id, qty, reason: result.reasonText });
    return bad(result.reasonText || "Could not buy fertiliser.");
  }
  await addToServerBank(state.guildId, state.userId, total, "farming_fertiliser_purchase_bank", { action: "buy_fertiliser", fertiliserId: fertiliser.id, qty });
  return loadNormalizedState(ctx, `Bought ${qty} x ${fertiliser.name} for ${money(total)}.`);
}

async function buyHusbandry(ctx, itemId, qtyInput) {
  const state = await withFarm(ctx);
  if (!state.ok) return state;
  const item = farming.getAnimalHusbandryItem(String(itemId || ""));
  if (!item) return bad("Unknown animal husbandry item.");
  const qty = positiveQty(qtyInput);
  const total = Number(item.price || 0) * qty;
  const debit = await chargeBank(state.guildId, state.userId, total, "farming_husbandry_purchase", { itemId: item.id, qty }, `You need ${money(total)} in your bank to buy that husbandry item.`);
  if (!debit.ok) return debit;
  const result = await farming.buyAnimalHusbandryItem(state.guildId, state.userId, state.farm, item.id, qty);
  if (!result.ok) {
    await refundBank(state.guildId, state.userId, total, "farming_husbandry_refund", { itemId: item.id, qty, reason: result.reasonText });
    return bad(result.reasonText || "Could not buy husbandry item.");
  }
  await addToServerBank(state.guildId, state.userId, total, "farming_husbandry_purchase_bank", { action: "buy_husbandry", itemId: item.id, qty });
  return loadNormalizedState(ctx, `Bought ${qty} x ${item.name} for ${money(total)}.`);
}

async function store(ctx) {
  const result = await loadNormalizedState(ctx, "Farm store loaded.");
  if (!result.ok) return result;
  return {
    ok: true,
    body: {
      ...result.body,
      store: {
        fertilisers: farming.listFertilisers(),
        husbandryItems: farming.listAnimalHusbandryItems(),
      },
    },
  };
}

async function machines(ctx) {
  const result = await loadNormalizedState(ctx, "Machine shed loaded.");
  if (!result.ok) return result;
  return {
    ok: true,
    body: {
      ...result.body,
      machineCatalog: Object.values(machineCatalog),
      machines: machineList(),
      machineCategories: groupMachinesByType(),
    },
  };
}

async function machineAction(ctx, action, machineId) {
  const auth = requireDiscordContext(ctx);
  if (!auth.ok) return auth;
  await loadNormalizedState(ctx, "Farm state normalized.");
  const id = String(machineId || "");
  const handlers = {
    buy: machineEngine.buyMachine,
    rent: machineEngine.rentMachine,
    sell: machineEngine.sellMachine,
  };
  const handler = handlers[action];
  if (!handler) return bad("Unknown machine action.", 404);
  const result = await handler(auth.guildId, auth.userId, id);
  if (!result.ok) return bad(result.reasonText || "Machine action failed.");
  const verb = action === "buy" ? "Bought" : action === "rent" ? "Rented" : "Sold";
  const suffix = result.sellValue ? ` for ${money(result.sellValue)}` : "";
  return loadNormalizedState(ctx, `${verb} ${result.machine?.name || "machine"}${suffix}.`);
}

async function marketView(ctx) {
  return loadNormalizedState(ctx, "Farm market loaded.");
}

async function sellMarketItem(ctx, itemId) {
  const auth = requireDiscordContext(ctx);
  if (!auth.ok) return auth;
  await loadNormalizedState(ctx, "Farm state normalized.");
  const result = await market.sellCrop(auth.guildId, auth.userId, String(itemId || ""));
  if (!result.ok) return bad(result.reasonText || "Could not sell that farm item.");
  return loadNormalizedState(ctx, `Sold ${result.qty} ${result.name} for ${money(result.totalValue)}.`);
}

module.exports = {
  overview,
  config,
  buyField,
  cultivateField: (ctx, fieldIndex) => startFieldTask(ctx, fieldIndex, "cultivate", {}, "Cultivation started."),
  restField,
  plantField: (ctx, fieldIndex, cropId) => startFieldTask(ctx, fieldIndex, "seed", { cropId: String(cropId || "") }, "Planting started."),
  harvestField: (ctx, fieldIndex) => startFieldTask(ctx, fieldIndex, "harvest", {}, "Harvest started."),
  fertiliseField: (ctx, fieldIndex, fertiliserId) => startFieldTask(ctx, fieldIndex, "fertilise", { fertiliserId: String(fertiliserId || "") }, "Fertilising started."),
  upgradeField,
  convertBarn,
  barnAction,
  store,
  buyFertiliser,
  buyHusbandry,
  machines,
  machineAction,
  marketView,
  sellMarketItem,
};
