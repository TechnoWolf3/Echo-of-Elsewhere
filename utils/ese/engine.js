const fs = require("fs");
const path = require("path");

const config = require("../../data/ese/config");
const companies = require("../../data/ese/companies");

const RUNTIME_DIR = path.join(__dirname, "../../data/ese/runtime");
const STATE_FILE = path.join(RUNTIME_DIR, "marketState.json");

function ensureRuntimeDir() {
  if (!fs.existsSync(RUNTIME_DIR)) {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  }
}

function cloneCompanies() {
  return companies.map((c) => ({
    symbol: c.symbol,
    name: c.name,
    sector: c.sector,
    price: Number(c.price || 1),
    open: Number(c.price || 1),
    previousClose: Number(c.price || 1),
    high: Number(c.price || 1),
    low: Number(c.price || 1),
    volatility: Number(c.volatility || 0.03),
    dividend: Boolean(c.dividend),
    sentiment: 0,
    volume: 0,
    dayChangePercent: 0,
    history: [
      {
        ts: Date.now(),
        price: Number(c.price || 1),
      },
    ],
    buyPressure: 0,
    sellPressure: 0,
    lastHeadline: null,
  }));
}

function buildDefaultState() {
  return {
    createdAt: Date.now(),
    updatedAt: Date.now(),
    marketState: "Stable Session",
    lastDividendAt: 0,
    companies: cloneCompanies(),
  };
}

function saveState(state) {
  ensureRuntimeDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

function loadState() {
  ensureRuntimeDir();

  if (!fs.existsSync(STATE_FILE)) {
    const state = buildDefaultState();
    saveState(state);
    return state;
  }

  try {
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);

    if (!parsed || !Array.isArray(parsed.companies)) {
      const state = buildDefaultState();
      saveState(state);
      return state;
    }

    return parsed;
  } catch (err) {
    console.error("[ESE] Failed to load market state, rebuilding:", err);
    const state = buildDefaultState();
    saveState(state);
    return state;
  }
}

function getCompany(state, symbol) {
  return state.companies.find(
    (c) => c.symbol.toUpperCase() === String(symbol).toUpperCase()
  );
}

function clamp(num, min, max) {
  return Math.max(min, Math.min(max, num));
}

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function pickMarketState() {
  const roll = Math.random();

  if (roll < 0.45) return "Stable Session";
  if (roll < 0.62) return "Bull Run";
  if (roll < 0.77) return "Bear Pressure";
  if (roll < 0.88) return "Volatile Session";
  if (roll < 0.95) return "Speculation Frenzy";
  return "Flight to Safety";
}

function getMarketBias(stateName) {
  switch (stateName) {
    case "Bull Run":
      return 0.012;
    case "Bear Pressure":
      return -0.012;
    case "Volatile Session":
      return rand(-0.02, 0.02);
    case "Speculation Frenzy":
      return 0.006;
    case "Flight to Safety":
      return -0.008;
    case "Stable Session":
    default:
      return rand(-0.004, 0.004);
  }
}

function getSectorBias(company, activity = {}) {
  const casinoNet = Number(activity.casinoNet || 0);
  const transportJobs = Number(activity.transportJobs || 0);
  const shopSpend = Number(activity.shopSpend || 0);
  const grindJobs = Number(activity.grindJobs || 0);
  const crimeActivity = Number(activity.crimeActivity || 0);

  switch (company.sector) {
    case "Casino":
      return clamp(casinoNet / 500000, -0.03, 0.03);
    case "Transport":
      return clamp(transportJobs / 5000, -0.02, 0.025);
    case "Retail":
      return clamp(shopSpend / 250000, -0.02, 0.025);
    case "Resources":
      return clamp(grindJobs / 5000, -0.02, 0.025);
    case "Crime":
    case "Vice":
      return clamp(crimeActivity / 5000, -0.025, 0.03);
    case "Public Services":
      return casinoNet < 0 ? 0.005 : -0.002;
    case "Luxury":
      return clamp(shopSpend / 400000, -0.015, 0.02);
    case "Energy":
      return clamp(transportJobs / 6000, -0.015, 0.02);
    case "Tech":
      return rand(-0.01, 0.015);
    default:
      return 0;
  }
}

function getPressureBias(company) {
  const netPressure = Number(company.buyPressure || 0) - Number(company.sellPressure || 0);
  return clamp(netPressure / 1000, -0.025, 0.025);
}

function getNoise(company, stateName) {
  let multi = company.volatility || 0.03;
  if (stateName === "Volatile Session") multi *= 1.6;
  if (stateName === "Speculation Frenzy" && company.sector === "Tech") multi *= 1.8;
  return rand(-multi, multi);
}

function updateCompany(company, stateName, activity = {}) {
  const marketBias = getMarketBias(stateName);
  const sectorBias = getSectorBias(company, activity);
  const pressureBias = getPressureBias(company);
  const noise = getNoise(company, stateName);

  const totalMove = clamp(
    marketBias + sectorBias + pressureBias + noise + Number(company.sentiment || 0),
    -0.18,
    0.18
  );

  const oldPrice = Number(company.price || 1);
  const newPrice = Math.max(0.1, Number((oldPrice * (1 + totalMove)).toFixed(2)));

  company.price = newPrice;
  company.high = Math.max(Number(company.high || newPrice), newPrice);
  company.low = Math.min(Number(company.low || newPrice), newPrice);
  company.dayChangePercent = Number(
    ((((newPrice - Number(company.open || oldPrice)) / Number(company.open || oldPrice)) * 100) || 0).toFixed(2)
  );

  company.volume = Math.max(
    0,
    Math.round(Number(company.volume || 0) + Math.abs(company.buyPressure || 0) + Math.abs(company.sellPressure || 0) + rand(25, 150))
  );

  company.history = Array.isArray(company.history) ? company.history : [];
  company.history.push({
    ts: Date.now(),
    price: newPrice,
  });

  if (company.history.length > 1008) {
    company.history = company.history.slice(-1008);
  }

  company.buyPressure = 0;
  company.sellPressure = 0;

  company.sentiment = clamp(Number(company.sentiment || 0) + rand(-0.004, 0.004), -0.03, 0.03);

  return {
    symbol: company.symbol,
    oldPrice,
    newPrice,
    percent: Number((((newPrice - oldPrice) / oldPrice) * 100).toFixed(2)),
  };
}

function tickMarket(activity = {}) {
  const state = loadState();

  if (Math.random() < 0.18) {
    state.marketState = pickMarketState();
  }

  const moves = state.companies.map((company) =>
    updateCompany(company, state.marketState, activity)
  );

  state.updatedAt = Date.now();
  saveState(state);

  return {
    state,
    moves,
  };
}

function recordTradePressure(symbol, side, amount) {
  const state = loadState();
  const company = getCompany(state, symbol);
  if (!company) return null;

  const safeAmount = Math.max(1, Number(amount || 0));

  if (side === "buy") {
    company.buyPressure = Number(company.buyPressure || 0) + safeAmount;
  } else if (side === "sell") {
    company.sellPressure = Number(company.sellPressure || 0) + safeAmount;
  }

  state.updatedAt = Date.now();
  saveState(state);
  return company;
}

function getSnapshot() {
  return loadState();
}

function getTopMovers(state = null) {
  const snap = state || loadState();
  const sorted = [...snap.companies].sort(
    (a, b) => Number(b.dayChangePercent || 0) - Number(a.dayChangePercent || 0)
  );

  return {
    topGainer: sorted[0] || null,
    topLoser: sorted[sorted.length - 1] || null,
  };
}

function getCompanyHistory(symbol, points = 24) {
  const state = loadState();
  const company = getCompany(state, symbol);
  if (!company) return [];

  const history = Array.isArray(company.history) ? company.history : [];
  return history.slice(-Math.max(2, points));
}

function getTradeCooldownMs() {
  return Number(config.tradeCooldownSeconds || 15) * 1000;
}

function getTradeFeeRate() {
  return Number(config.tradeFee || 0.02);
}

module.exports = {
  loadState,
  saveState,
  getSnapshot,
  getCompany,
  getTopMovers,
  getCompanyHistory,
  tickMarket,
  recordTradePressure,
  getTradeCooldownMs,
  getTradeFeeRate,
  buildDefaultState,
};