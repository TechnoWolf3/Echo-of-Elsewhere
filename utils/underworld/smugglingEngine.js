const products = require("../../data/underworld/products");
const vehicles = require("../../data/underworld/smugglingVehicles");
const events = require("../../data/underworld/smugglingEvents");
const config = require("../../data/underworld/config");
const inventory = require("./inventory");
const suspicion = require("./suspicion");
const economy = require("../economy");
const { setJail } = require("../jail");

const cfg = config.SMUGGLING || {};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value || 0)));
}

function randInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function ensureSmugglingState(state) {
  state.smuggling = state.smuggling || {};
  state.smuggling.inventory = state.smuggling.inventory || {};
  state.smuggling.vehicles = Array.isArray(state.smuggling.vehicles) ? state.smuggling.vehicles : [];
  state.smuggling.runs = Array.isArray(state.smuggling.runs) ? state.smuggling.runs : [];
  state.smuggling.history = Array.isArray(state.smuggling.history) ? state.smuggling.history : [];
  return state.smuggling;
}

function getVehicleDefinition(typeId) {
  return vehicles[typeId] || null;
}

function getOwnedVehicle(state, vehicleId) {
  return ensureSmugglingState(state).vehicles.find((vehicle) => String(vehicle.id) === String(vehicleId)) || null;
}

function getActiveRun(state) {
  return ensureSmugglingState(state).runs.find((run) => run.status === "active" || run.status === "event") || null;
}

function getCompletedUnclaimedRun(state) {
  return ensureSmugglingState(state).runs.find((run) => run.status === "ready_to_claim") || null;
}

function getVehicleScrapValue(vehicle) {
  const chump = Number(cfg.scrap?.chumpChangeMin || 1000);
  const price = Number(vehicle.purchasePrice || getVehicleDefinition(vehicle.vehicleType)?.price || 0);
  const condition = clamp(Number(vehicle.durabilityCurrent || 0) / 100, 0, 1);
  return Math.max(chump, Math.floor(price * Number(cfg.scrap?.immediateValueRate || 0.8) * condition));
}

function getRepairCost(vehicle) {
  const def = getVehicleDefinition(vehicle.vehicleType);
  if (!def) return 0;
  const missing = Math.max(0, Number(vehicle.durabilityMax || 0) - Number(vehicle.durabilityCurrent || 0));
  if (missing <= 0) return 0;
  const missingRatio = missing / Math.max(1, Number(vehicle.durabilityMax || 100));
  return Math.max(1000, Math.ceil(Number(vehicle.purchasePrice || def.price || 0) * Number(cfg.repair?.baseRepairCostRate || 0.12) * missingRatio));
}

function deliveryCountForAmount(amount) {
  const parcelSize = Math.max(1, Number(cfg.parcelSize || 25));
  return clamp(Math.ceil(Number(amount || 0) / parcelSize), 1, Number(cfg.maxDeliveriesPerRun || 6));
}

function calculateRunEstimate({ productId, sourceType, cargoAmount, vehicle, suspicionScore = 0 }) {
  const product = products[productId];
  const def = getVehicleDefinition(vehicle?.vehicleType || vehicle?.id || vehicle?.typeId);
  const amount = Math.max(1, Math.floor(Number(cargoAmount || 0)));
  const deliveries = deliveryCountForAmount(amount);
  const sellValue = sourceType === "purchased" ? product.purchasedSellValue : product.producedSellValue;
  const upfrontCost = sourceType === "purchased" ? amount * Number(product.purchasedCost || 0) : 0;
  const estimatedPayout = amount * Number(sellValue || 0);
  const durability = Number(vehicle?.durabilityCurrent ?? def?.durability ?? 100);
  const speedMultiplier = 1 / Math.max(0.25, Number(def?.speed || 1));
  const durabilityPenalty = durability < 25 ? 1.45 : durability < 50 ? 1.25 : 1;
  const suspicionPenalty = suspicionScore >= 80 ? 1.25 : suspicionScore >= 60 ? 1.15 : 1;
  const durationMinutes = clamp(
    Math.ceil((Number(cfg.baseMinutes || 8) + deliveries * Number(cfg.minutesPerDelivery || 4)) * speedMultiplier * durabilityPenalty * suspicionPenalty),
    5,
    30
  );
  const baseSuspicion = amount * Number(product.baseSuspicionPerUnit || 0.1) * Number(def?.heatProfile || 1);
  const suspicionGain = clamp(Math.ceil(baseSuspicion), 2, 30);
  const durabilityRisk = durability < 25 ? 0.22 : durability < 50 ? 0.12 : 0;
  const risk = clamp(
    0.06 +
      amount / Math.max(1, Number(def?.capacity || 1)) * 0.12 +
      deliveries * 0.035 +
      suspicionScore / 260 +
      Number(product.baseRisk || 1) * 0.04 +
      Number(def?.heatProfile || 1) * 0.04 -
      Number(def?.stealth || 1) * 0.035 +
      durabilityRisk,
    0.03,
    0.82
  );
  const riskBand = risk >= 0.55 ? "Extreme" : risk >= 0.38 ? "High" : risk >= 0.22 ? "Medium" : "Low";
  return {
    product,
    vehicleDefinition: def,
    cargoAmount: amount,
    deliveries,
    upfrontCost,
    estimatedPayout,
    estimatedProfit: estimatedPayout - upfrontCost,
    durationMinutes,
    suspicionGain,
    risk,
    riskBand,
  };
}

async function purchaseVehicle(guildId, userId, state, vehicleType) {
  const def = getVehicleDefinition(vehicleType);
  if (!def) return { ok: false, reasonText: "Unknown vehicle type." };
  const smuggling = ensureSmugglingState(state);
  const debit = await economy.tryDebitBank(guildId, userId, Number(def.price || 0), "underworld_smuggling_vehicle_purchase", { vehicleType });
  if (!debit.ok) return { ok: false, reasonText: `You need $${Number(def.price || 0).toLocaleString()} in your bank.` };
  await economy.addServerBank(guildId, Number(def.price || 0), "underworld_smuggling_vehicle_purchase_bank", { userId, vehicleType });
  const vehicle = {
    id: makeId("uwv"),
    vehicleType,
    nickname: def.label,
    purchasePrice: Number(def.price || 0),
    durabilityCurrent: Number(def.durability || 100),
    durabilityMax: Number(def.durability || 100),
    repairCount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  smuggling.vehicles.push(vehicle);
  await suspicion.recordUnderworldActivity(guildId, userId, "smuggling_vehicle_purchase");
  return { ok: true, vehicle, definition: def };
}

async function repairVehicle(guildId, userId, state, vehicleId) {
  const vehicle = getOwnedVehicle(state, vehicleId);
  if (!vehicle) return { ok: false, reasonText: "That vehicle is not in your garage." };
  const cost = getRepairCost(vehicle);
  if (cost <= 0) return { ok: false, reasonText: "That vehicle is already as repaired as it can get." };
  const debit = await economy.tryDebitBank(guildId, userId, cost, "underworld_smuggling_vehicle_repair", { vehicleId, vehicleType: vehicle.vehicleType });
  if (!debit.ok) return { ok: false, reasonText: `You need $${cost.toLocaleString()} in your bank for the repair.` };
  await economy.addServerBank(guildId, cost, "underworld_smuggling_vehicle_repair_bank", { userId, vehicleId, vehicleType: vehicle.vehicleType });
  const loss = Number(cfg.repair?.maxDurabilityLossPerRepair || 10);
  const minMax = Number(cfg.repair?.minMaxDurability || 5);
  vehicle.repairCount = Number(vehicle.repairCount || 0) + 1;
  vehicle.durabilityMax = Math.max(minMax, Number(vehicle.durabilityMax || 100) - loss);
  vehicle.durabilityCurrent = vehicle.durabilityMax;
  vehicle.updatedAt = Date.now();
  await suspicion.recordUnderworldActivity(guildId, userId, "smuggling_vehicle_repair");
  return { ok: true, vehicle, cost };
}

async function scrapVehicle(guildId, userId, state, vehicleId) {
  const smuggling = ensureSmugglingState(state);
  const index = smuggling.vehicles.findIndex((vehicle) => String(vehicle.id) === String(vehicleId));
  if (index < 0) return { ok: false, reasonText: "That vehicle is not in your garage." };
  const active = getActiveRun(state);
  if (active && String(active.vehicleId) === String(vehicleId)) {
    return { ok: false, reasonText: "That vehicle is currently on a route." };
  }
  const [vehicle] = smuggling.vehicles.splice(index, 1);
  const value = getVehicleScrapValue(vehicle);
  await economy.creditBank(guildId, userId, value, "underworld_smuggling_vehicle_scrap", { vehicleId, vehicleType: vehicle.vehicleType });
  await suspicion.recordUnderworldActivity(guildId, userId, "smuggling_vehicle_scrap");
  return { ok: true, vehicle, value };
}

async function startRun(guildId, userId, state, { productId, sourceType, vehicleId, cargoAmount }) {
  const product = products[productId];
  const vehicle = getOwnedVehicle(state, vehicleId);
  const def = getVehicleDefinition(vehicle?.vehicleType);
  if (!product) return { ok: false, reasonText: "Unknown cargo type." };
  if (!vehicle || !def) return { ok: false, reasonText: "Choose a vehicle from your garage first." };
  if (getActiveRun(state) || getCompletedUnclaimedRun(state)) return { ok: false, reasonText: "Finish your current smuggling run before starting another." };
  const amount = Math.max(1, Math.floor(Number(cargoAmount || 0)));
  if (amount > Number(def.capacity || 0)) return { ok: false, reasonText: `${def.label} can only carry ${Number(def.capacity || 0)} units.` };

  const suspicionInfo = await suspicion.getUnderworldSuspicion(guildId, userId);
  const estimate = calculateRunEstimate({ productId, sourceType, cargoAmount: amount, vehicle, suspicionScore: suspicionInfo.suspicion });
  if (sourceType === "produced") {
    const removed = inventory.removeProduct(state, productId, amount);
    if (!removed.ok) return { ok: false, reasonText: `You only have ${removed.available.toLocaleString()} ${product.unitLabel} in storage.` };
  } else {
    const debit = await economy.tryDebitBank(guildId, userId, estimate.upfrontCost, "underworld_smuggling_product_purchase", { productId, amount });
    if (!debit.ok) return { ok: false, reasonText: `You need $${estimate.upfrontCost.toLocaleString()} in your bank to buy that cargo.` };
    await economy.addServerBank(guildId, estimate.upfrontCost, "underworld_smuggling_product_purchase_bank", { userId, productId, amount });
  }

  const startedAt = Date.now();
  const eventIds = Object.keys(events);
  const shouldEvent = Math.random() < Number(cfg.eventChance || 0.45);
  const eventAt = shouldEvent ? startedAt + Math.floor(estimate.durationMinutes * 60 * 1000 * 0.45) : null;
  const eventId = shouldEvent ? eventIds[randInt(0, eventIds.length - 1)] : null;
  const run = {
    id: makeId("uwr"),
    status: "active",
    productId,
    sourceType,
    cargoAmount: amount,
    cargoRemaining: amount,
    vehicleId,
    deliveriesTotal: estimate.deliveries,
    deliveriesCompleted: 0,
    startedAt,
    endsAt: startedAt + estimate.durationMinutes * 60 * 1000,
    eventState: eventId ? { eventId, opensAt: eventAt, deadlineAt: null, resolved: false, choiceId: null } : null,
    risk: { base: estimate.risk, current: estimate.risk, suspicionGain: estimate.suspicionGain, payoutMultiplier: 1, damageDelta: 0, durationMultiplier: 1 },
    result: null,
    createdAt: startedAt,
    updatedAt: startedAt,
  };
  ensureSmugglingState(state).runs.push(run);
  await suspicion.addUnderworldSuspicion(guildId, userId, Math.max(1, Math.ceil(estimate.suspicionGain * 0.35)), "smuggling_run_started");
  return { ok: true, run, estimate, product, vehicle, definition: def };
}

async function openDueEvent(guildId, userId, state) {
  const run = getActiveRun(state);
  if (!run || !run.eventState || run.eventState.resolved) return null;
  if (!run.eventState.deadlineAt && Date.now() >= Number(run.eventState.opensAt || 0)) {
    run.status = "event";
    run.eventState.deadlineAt = Date.now() + Number(cfg.eventWindowSeconds || 75) * 1000;
    run.updatedAt = Date.now();
    return events[run.eventState.eventId] || null;
  }
  if (run.eventState.deadlineAt && Date.now() >= Number(run.eventState.deadlineAt || 0)) {
    const event = events[run.eventState.eventId];
    applyEventOutcome(run, event?.ignored || {}, "ignored");
    run.status = "active";
    return null;
  }
  return run.status === "event" ? events[run.eventState.eventId] || null : null;
}

function applyEventOutcome(run, outcome = {}, choiceId = "ignored") {
  run.risk.current = clamp(Number(run.risk.current || 0) + Number(outcome.riskDelta || 0), 0.01, 0.9);
  run.risk.payoutMultiplier = clamp(Number(run.risk.payoutMultiplier || 1) * Number(outcome.payoutMultiplier || 1), 0.5, 1.6);
  run.risk.suspicionGain = clamp(Number(run.risk.suspicionGain || 0) + Number(outcome.suspicionDelta || 0), 0, 60);
  run.risk.damageDelta = Number(run.risk.damageDelta || 0) + Number(outcome.damageDelta || 0);
  run.risk.durationMultiplier = clamp(Number(run.risk.durationMultiplier || 1) * Number(outcome.durationMultiplier || 1), 0.75, 1.5);
  if (outcome.durationMultiplier) {
    const remaining = Math.max(0, Number(run.endsAt || Date.now()) - Date.now());
    run.endsAt = Date.now() + Math.ceil(remaining * Number(outcome.durationMultiplier || 1));
  }
  if (run.eventState) {
    run.eventState.resolved = true;
    run.eventState.choiceId = choiceId;
    run.eventState.resolvedAt = Date.now();
  }
  run.status = "active";
  run.updatedAt = Date.now();
}

async function resolveEventChoice(guildId, userId, state, choiceId) {
  const run = getActiveRun(state);
  const event = run?.eventState?.eventId ? events[run.eventState.eventId] : null;
  if (!run || run.status !== "event" || !event) return { ok: false, reasonText: "There is no live smuggling event right now." };
  const choice = (event.options || []).find((entry) => entry.id === choiceId);
  if (!choice) return { ok: false, reasonText: "That route choice is not available anymore." };
  const cost = Number(choice.costFlat || 0);
  if (cost > 0) {
    const debit = await economy.tryDebitBank(guildId, userId, cost, "underworld_smuggling_event_cost", { eventId: event.id, choiceId });
    if (!debit.ok) return { ok: false, reasonText: `You need $${cost.toLocaleString()} in your bank for that move.` };
    await economy.addServerBank(guildId, cost, "underworld_smuggling_event_cost_bank", { userId, eventId: event.id, choiceId });
  }
  applyEventOutcome(run, choice, choiceId);
  if (choice.suspicionDelta) {
    await suspicion.addUnderworldSuspicion(guildId, userId, Number(choice.suspicionDelta || 0), "smuggling_event_choice");
  } else {
    await suspicion.recordUnderworldActivity(guildId, userId, "smuggling_event_choice");
  }
  return { ok: true, run, event, choice, cost };
}

function rollRunOutcome(run, vehicle) {
  const risk = clamp(Number(run.risk?.current || 0), 0.01, 0.9);
  const durability = Number(vehicle?.durabilityCurrent || 100);
  const breakdownChance = durability < 25 ? 0.18 : durability < 50 ? 0.09 : 0.025;
  const roll = Math.random();
  if (roll < risk * 0.22) return "bust";
  if (roll < risk * 0.55) return "partial_loss";
  if (Math.random() < breakdownChance) return "partial_loss";
  if (roll < risk * 0.82) return "messy_success";
  return "clean_success";
}

async function finalizeRun(guildId, userId, state, runId, { payoutFn } = {}) {
  const smuggling = ensureSmugglingState(state);
  const run = smuggling.runs.find((entry) => String(entry.id) === String(runId));
  if (!run) return { ok: false, reasonText: "That run no longer exists." };
  if (run.status === "completed") return { ok: false, reasonText: "That run has already been paid out." };
  if (run.status === "event") return { ok: false, reasonText: "Resolve or ignore the live route event first." };
  if (Date.now() < Number(run.endsAt || 0)) return { ok: false, reasonText: "That route is still moving." };

  const vehicle = getOwnedVehicle(state, run.vehicleId);
  const vehicleDef = getVehicleDefinition(vehicle?.vehicleType);
  const product = products[run.productId];
  if (!vehicle || !vehicleDef || !product) return { ok: false, reasonText: "Run data is missing its vehicle or cargo definition." };

  const outcome = rollRunOutcome(run, vehicle);
  let cargoLost = 0;
  let payout = 0;
  let damage = randInt(2, 5) + Number(run.risk?.damageDelta || 0);
  let suspicionGain = Number(run.risk?.suspicionGain || 0);
  let jailedMinutes = 0;
  const sellValue = run.sourceType === "purchased" ? product.purchasedSellValue : product.producedSellValue;

  if (outcome === "clean_success") {
    payout = Math.round(Number(run.cargoRemaining || 0) * sellValue * Number(run.risk?.payoutMultiplier || 1));
    suspicionGain = Math.max(1, suspicionGain - 2);
  } else if (outcome === "messy_success") {
    payout = Math.round(Number(run.cargoRemaining || 0) * sellValue * Number(run.risk?.payoutMultiplier || 1));
    damage += randInt(3, 7);
    suspicionGain += randInt(3, 8);
  } else if (outcome === "partial_loss") {
    cargoLost = randInt(Math.ceil(Number(run.cargoAmount || 1) * 0.15), Math.ceil(Number(run.cargoAmount || 1) * 0.45));
    const delivered = Math.max(0, Number(run.cargoRemaining || 0) - cargoLost);
    payout = Math.round(delivered * sellValue * Number(run.risk?.payoutMultiplier || 1));
    damage += randInt(6, 13);
    suspicionGain += randInt(5, 12);
  } else {
    cargoLost = Number(run.cargoRemaining || 0);
    payout = 0;
    damage += randInt(12, 30);
    suspicionGain += randInt(15, 30);
    const updatedSuspicion = await suspicion.getUnderworldSuspicion(guildId, userId);
    const jailChance = clamp(0.18 + updatedSuspicion.suspicion / 240 + Number(run.risk?.current || 0) * 0.22, 0.15, 0.72);
    if (Math.random() < jailChance) {
      jailedMinutes = randInt(35, 70);
      await setJail(guildId, userId, jailedMinutes, { effects: { underworldSmuggling: true } });
    }
  }

  vehicle.durabilityCurrent = clamp(Math.floor(Number(vehicle.durabilityCurrent || 0) - Math.max(0, damage)), 0, Number(vehicle.durabilityMax || 100));
  vehicle.updatedAt = Date.now();
  await suspicion.addUnderworldSuspicion(guildId, userId, suspicionGain, `smuggling_${outcome}`);
  if (payout > 0 && typeof payoutFn === "function") {
    await payoutFn(payout, { enterprise: "underworld", feature: "smuggling", runId: run.id, productId: run.productId, outcome });
  }

  run.status = "completed";
  run.deliveriesCompleted = Number(run.deliveriesTotal || 0);
  run.cargoRemaining = Math.max(0, Number(run.cargoRemaining || 0) - cargoLost);
  run.result = { outcome, payout, cargoLost, damage: Math.max(0, damage), suspicionGain, jailedMinutes, completedAt: Date.now() };
  run.updatedAt = Date.now();
  smuggling.history.push(run.result);
  if (smuggling.history.length > 25) smuggling.history = smuggling.history.slice(-25);
  return { ok: true, run, vehicle, product, outcome, payout, cargoLost, damage: Math.max(0, damage), suspicionGain, jailedMinutes };
}

function cleanupCompletedRuns(state) {
  const smuggling = ensureSmugglingState(state);
  smuggling.runs = smuggling.runs.filter((run) => run.status !== "completed");
}

module.exports = {
  products,
  vehicles,
  events,
  ensureSmugglingState,
  getVehicleDefinition,
  getOwnedVehicle,
  getActiveRun,
  getCompletedUnclaimedRun,
  getVehicleScrapValue,
  getRepairCost,
  calculateRunEstimate,
  purchaseVehicle,
  repairVehicle,
  scrapVehicle,
  startRun,
  openDueEvent,
  resolveEventChoice,
  finalizeRun,
  cleanupCompletedRuns,
};
