const { pool } = require("../db");
const config = require("../../data/ese/config");
const companies = require("../../data/ese/companies");

let schemaReady = false;

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
  const netPressure =
    Number(company.buyPressure || 0) - Number(company.sellPressure || 0);
  return clamp(netPressure / 1000, -0.025, 0.025);
}

function getNoise(company, stateName) {
  let multi = Number(company.volatility || 0.03);
  if (stateName === "Volatile Session") multi *= 1.6;
  if (stateName === "Speculation Frenzy" && company.sector === "Tech") {
    multi *= 1.8;
  }
  return rand(-multi, multi);
}

function getTopMovers(state) {
  const sorted = [...(state?.companies || [])].sort(
    (a, b) =>
      Number(b.dayChangePercent || 0) - Number(a.dayChangePercent || 0)
  );

  return {
    topGainer: sorted[0] || null,
    topLoser: sorted[sorted.length - 1] || null,
  };
}

async function ensureSchema() {
  if (schemaReady) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ese_market_meta (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ese_companies (
      symbol TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sector TEXT NOT NULL,
      price NUMERIC(18,2) NOT NULL,
      open NUMERIC(18,2) NOT NULL,
      previous_close NUMERIC(18,2) NOT NULL,
      high NUMERIC(18,2) NOT NULL,
      low NUMERIC(18,2) NOT NULL,
      volatility NUMERIC(10,6) NOT NULL DEFAULT 0.03,
      dividend BOOLEAN NOT NULL DEFAULT FALSE,
      sentiment NUMERIC(10,6) NOT NULL DEFAULT 0,
      volume BIGINT NOT NULL DEFAULT 0,
      day_change_percent NUMERIC(10,2) NOT NULL DEFAULT 0,
      buy_pressure NUMERIC(18,2) NOT NULL DEFAULT 0,
      sell_pressure NUMERIC(18,2) NOT NULL DEFAULT 0,
      last_headline TEXT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ese_history (
      id BIGSERIAL PRIMARY KEY,
      symbol TEXT NOT NULL,
      ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      price NUMERIC(18,2) NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_ese_history_symbol_ts
    ON ese_history (symbol, ts DESC);

    CREATE TABLE IF NOT EXISTS ese_portfolios (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      shares NUMERIC(18,4) NOT NULL DEFAULT 0,
      avg_price NUMERIC(18,6) NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, user_id, symbol)
    );

    CREATE INDEX IF NOT EXISTS idx_ese_portfolios_user
    ON ese_portfolios (guild_id, user_id);

    CREATE TABLE IF NOT EXISTS ese_trade_cooldowns (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );
  `);

  const countRes = await pool.query(`SELECT COUNT(*)::int AS count FROM ese_companies`);
  const count = Number(countRes.rows?.[0]?.count || 0);

  if (count === 0) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      for (const c of companies) {
        const base = Number(c.price || 1);

        await client.query(
          `
          INSERT INTO ese_companies (
            symbol, name, sector, price, open, previous_close, high, low,
            volatility, dividend, sentiment, volume, day_change_percent,
            buy_pressure, sell_pressure, last_headline
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,0,0,0,0,NULL)
          `,
          [
            c.symbol,
            c.name,
            c.sector,
            base,
            base,
            base,
            base,
            base,
            Number(c.volatility || 0.03),
            Boolean(c.dividend),
          ]
        );

        const now = Date.now();
        const seedPoints = 12;

        for (let i = seedPoints; i >= 1; i--) {
          const seedPrice = Math.max(
            0.1,
            Number((base * (1 + rand(-0.015, 0.015))).toFixed(2))
          );
          const ts = new Date(now - i * 10 * 60 * 1000);

          await client.query(
            `INSERT INTO ese_history (symbol, ts, price) VALUES ($1, $2, $3)`,
            [c.symbol, ts, seedPrice]
          );
        }

        await client.query(
          `INSERT INTO ese_history (symbol, ts, price) VALUES ($1, NOW(), $2)`,
          [c.symbol, base]
        );
      }

      await client.query(
        `
        INSERT INTO ese_market_meta (key, value)
        VALUES ('market_state', $1::jsonb)
        ON CONFLICT (key) DO NOTHING
        `,
        [JSON.stringify({ name: "Stable Session", updatedAt: Date.now() })]
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } else {
    for (const c of companies) {
      await pool.query(
        `
        INSERT INTO ese_companies (
          symbol, name, sector, price, open, previous_close, high, low,
          volatility, dividend, sentiment, volume, day_change_percent,
          buy_pressure, sell_pressure, last_headline
        )
        VALUES ($1,$2,$3,$4,$4,$4,$4,$4,$5,$6,0,0,0,0,0,NULL)
        ON CONFLICT (symbol) DO UPDATE SET
          name = EXCLUDED.name,
          sector = EXCLUDED.sector,
          volatility = EXCLUDED.volatility,
          dividend = EXCLUDED.dividend
        `,
        [
          c.symbol,
          c.name,
          c.sector,
          Number(c.price || 1),
          Number(c.volatility || 0.03),
          Boolean(c.dividend),
        ]
      );
    }
  }

  schemaReady = true;
}

async function getMarketStateName() {
  await ensureSchema();

  const res = await pool.query(
    `SELECT value FROM ese_market_meta WHERE key = 'market_state'`
  );

  const row = res.rows?.[0];
  return row?.value?.name || "Stable Session";
}

async function setMarketStateName(name) {
  await ensureSchema();

  await pool.query(
    `
    INSERT INTO ese_market_meta (key, value)
    VALUES ('market_state', $1::jsonb)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `,
    [JSON.stringify({ name, updatedAt: Date.now() })]
  );
}

function normalizeCompanyRow(row) {
  return {
    ...row,
    price: Number(row.price),
    open: Number(row.open),
    previousClose: Number(row.previousClose),
    high: Number(row.high),
    low: Number(row.low),
    volatility: Number(row.volatility),
    dividend: Boolean(row.dividend),
    sentiment: Number(row.sentiment),
    volume: Number(row.volume),
    dayChangePercent: Number(row.dayChangePercent),
    buyPressure: Number(row.buyPressure),
    sellPressure: Number(row.sellPressure),
  };
}

async function getSnapshot() {
  await ensureSchema();

  const [companiesRes, marketState] = await Promise.all([
    pool.query(`
      SELECT
        symbol,
        name,
        sector,
        price,
        open,
        previous_close AS "previousClose",
        high,
        low,
        volatility,
        dividend,
        sentiment,
        volume,
        day_change_percent AS "dayChangePercent",
        buy_pressure AS "buyPressure",
        sell_pressure AS "sellPressure",
        last_headline AS "lastHeadline"
      FROM ese_companies
      ORDER BY symbol
    `),
    getMarketStateName(),
  ]);

  return {
    marketState,
    companies: companiesRes.rows.map(normalizeCompanyRow),
  };
}

async function getCompany(symbol) {
  await ensureSchema();

  const res = await pool.query(
    `
    SELECT
      symbol,
      name,
      sector,
      price,
      open,
      previous_close AS "previousClose",
      high,
      low,
      volatility,
      dividend,
      sentiment,
      volume,
      day_change_percent AS "dayChangePercent",
      buy_pressure AS "buyPressure",
      sell_pressure AS "sellPressure",
      last_headline AS "lastHeadline"
    FROM ese_companies
    WHERE symbol = $1
    `,
    [String(symbol).toUpperCase()]
  );

  return res.rows?.[0] ? normalizeCompanyRow(res.rows[0]) : null;
}

async function getCompanyHistory(symbol, points = 48) {
  await ensureSchema();

  const res = await pool.query(
    `
    SELECT ts, price
    FROM ese_history
    WHERE symbol = $1
    ORDER BY ts DESC
    LIMIT $2
    `,
    [String(symbol).toUpperCase(), Math.max(2, Number(points || 48))]
  );

  return res.rows
    .reverse()
    .map((row) => ({
      ts: row.ts,
      price: Number(row.price),
    }));
}

async function recordTradePressure(symbol, side, amount) {
  await ensureSchema();

  const safeAmount = Math.max(1, Number(amount || 0));
  const field = side === "sell" ? "sell_pressure" : "buy_pressure";

  const res = await pool.query(
    `
    UPDATE ese_companies
    SET ${field} = ${field} + $2,
        updated_at = NOW()
    WHERE symbol = $1
    RETURNING
      symbol, name, sector, price, open,
      previous_close AS "previousClose",
      high, low, volatility, dividend, sentiment, volume,
      day_change_percent AS "dayChangePercent",
      buy_pressure AS "buyPressure",
      sell_pressure AS "sellPressure",
      last_headline AS "lastHeadline"
    `,
    [String(symbol).toUpperCase(), safeAmount]
  );

  return res.rows?.[0] ? normalizeCompanyRow(res.rows[0]) : null;
}

async function tickMarket(activity = {}) {
  await ensureSchema();

  let marketState = await getMarketStateName();
  if (Math.random() < 0.18) {
    marketState = pickMarketState();
    await setMarketStateName(marketState);
  }

  const companiesRes = await pool.query(`
    SELECT
      symbol,
      name,
      sector,
      price,
      open,
      previous_close AS "previousClose",
      high,
      low,
      volatility,
      dividend,
      sentiment,
      volume,
      day_change_percent AS "dayChangePercent",
      buy_pressure AS "buyPressure",
      sell_pressure AS "sellPressure",
      last_headline AS "lastHeadline"
    FROM ese_companies
    ORDER BY symbol
  `);

  const client = await pool.connect();
  const moves = [];

  try {
    await client.query("BEGIN");

    for (const raw of companiesRes.rows) {
      const company = normalizeCompanyRow(raw);

      const marketBias = getMarketBias(marketState);
      const sectorBias = getSectorBias(company, activity);
      const pressureBias = getPressureBias(company);
      const noise = getNoise(company, marketState);

      const totalMove = clamp(
        marketBias +
          sectorBias +
          pressureBias +
          noise +
          Number(company.sentiment || 0),
        -0.18,
        0.18
      );

      const oldPrice = Number(company.price || 1);
      const newPrice = Math.max(
        0.1,
        Number((oldPrice * (1 + totalMove)).toFixed(2))
      );

      const high = Math.max(Number(company.high || newPrice), newPrice);
      const low = Math.min(Number(company.low || newPrice), newPrice);
      const dayChangePercent = Number(
        (
          (((newPrice - Number(company.open || oldPrice)) /
            Number(company.open || oldPrice)) *
            100) || 0
        ).toFixed(2)
      );

      const volume = Math.max(
        0,
        Math.round(
          Number(company.volume || 0) +
            Math.abs(company.buyPressure || 0) +
            Math.abs(company.sellPressure || 0) +
            rand(25, 150)
        )
      );

      const sentiment = clamp(
        Number(company.sentiment || 0) + rand(-0.004, 0.004),
        -0.03,
        0.03
      );

      await client.query(
        `
        UPDATE ese_companies
        SET
          price = $2,
          high = $3,
          low = $4,
          volume = $5,
          sentiment = $6,
          day_change_percent = $7,
          buy_pressure = 0,
          sell_pressure = 0,
          updated_at = NOW()
        WHERE symbol = $1
        `,
        [
          company.symbol,
          newPrice,
          high,
          low,
          volume,
          sentiment,
          dayChangePercent,
        ]
      );

      await client.query(
        `INSERT INTO ese_history (symbol, ts, price) VALUES ($1, NOW(), $2)`,
        [company.symbol, newPrice]
      );

      await client.query(
        `
        DELETE FROM ese_history
        WHERE symbol = $1
          AND id NOT IN (
            SELECT id FROM ese_history
            WHERE symbol = $1
            ORDER BY ts DESC
            LIMIT 1008
          )
        `,
        [company.symbol]
      );

      moves.push({
        symbol: company.symbol,
        oldPrice,
        newPrice,
        percent: Number((((newPrice - oldPrice) / oldPrice) * 100).toFixed(2)),
      });
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return {
    state: await getSnapshot(),
    moves,
  };
}

async function getUserHolding(guildId, userId, symbol) {
  await ensureSchema();

  const res = await pool.query(
    `
    SELECT symbol, shares, avg_price AS "avgPrice"
    FROM ese_portfolios
    WHERE guild_id = $1 AND user_id = $2 AND symbol = $3
    `,
    [String(guildId), String(userId), String(symbol).toUpperCase()]
  );

  const row = res.rows?.[0];
  if (!row) return null;

  return {
    symbol: row.symbol,
    shares: Number(row.shares),
    avgPrice: Number(row.avgPrice),
  };
}

async function getUserPortfolio(guildId, userId) {
  await ensureSchema();

  const [holdingsRes, snapshot] = await Promise.all([
    pool.query(
      `
      SELECT symbol, shares, avg_price AS "avgPrice"
      FROM ese_portfolios
      WHERE guild_id = $1 AND user_id = $2
      ORDER BY symbol
      `,
      [String(guildId), String(userId)]
    ),
    getSnapshot(),
  ]);

  const companyMap = new Map(snapshot.companies.map((c) => [c.symbol, c]));
  const holdings = holdingsRes.rows.map((row) => {
    const company = companyMap.get(row.symbol);
    const shares = Number(row.shares);
    const avgPrice = Number(row.avgPrice);
    const currentPrice = Number(company?.price || 0);
    const marketValue = Number((shares * currentPrice).toFixed(2));
    const costBasis = Number((shares * avgPrice).toFixed(2));
    const unrealized = Number((marketValue - costBasis).toFixed(2));

    return {
      symbol: row.symbol,
      shares,
      avgPrice,
      currentPrice,
      marketValue,
      costBasis,
      unrealized,
      companyName: company?.name || row.symbol,
    };
  });

  const totalValue = holdings.reduce((a, h) => a + h.marketValue, 0);
  const totalCost = holdings.reduce((a, h) => a + h.costBasis, 0);

  return {
    holdings,
    summary: {
      totalValue: Number(totalValue.toFixed(2)),
      totalCost: Number(totalCost.toFixed(2)),
      unrealized: Number((totalValue - totalCost).toFixed(2)),
    },
  };
}

async function getTradeCooldown(guildId, userId) {
  await ensureSchema();

  const res = await pool.query(
    `
    SELECT expires_at
    FROM ese_trade_cooldowns
    WHERE guild_id = $1 AND user_id = $2
    `,
    [String(guildId), String(userId)]
  );

  const row = res.rows?.[0];
  if (!row?.expires_at) return null;

  const expiresAt = new Date(row.expires_at).getTime();
  if (expiresAt <= Date.now()) return null;

  return expiresAt;
}

async function setTradeCooldown(guildId, userId) {
  await ensureSchema();

  const expiresAt = new Date(Date.now() + getTradeCooldownMs());

  await pool.query(
    `
    INSERT INTO ese_trade_cooldowns (guild_id, user_id, expires_at)
    VALUES ($1, $2, $3)
    ON CONFLICT (guild_id, user_id)
    DO UPDATE SET expires_at = EXCLUDED.expires_at
    `,
    [String(guildId), String(userId), expiresAt]
  );

  return expiresAt.getTime();
}

async function applyBuy(guildId, userId, symbol, shares, executedPrice) {
  await ensureSchema();

  const safeShares = Number(shares);
  const safePrice = Number(executedPrice);

  const existing = await getUserHolding(guildId, userId, symbol);

  if (!existing) {
    await pool.query(
      `
      INSERT INTO ese_portfolios (guild_id, user_id, symbol, shares, avg_price)
      VALUES ($1, $2, $3, $4, $5)
      `,
      [
        String(guildId),
        String(userId),
        String(symbol).toUpperCase(),
        safeShares,
        safePrice,
      ]
    );
  } else {
    const totalShares = Number(existing.shares) + safeShares;
    const totalCost =
      Number(existing.shares) * Number(existing.avgPrice) +
      safeShares * safePrice;
    const avgPrice = totalCost / totalShares;

    await pool.query(
      `
      UPDATE ese_portfolios
      SET shares = $4,
          avg_price = $5,
          updated_at = NOW()
      WHERE guild_id = $1 AND user_id = $2 AND symbol = $3
      `,
      [
        String(guildId),
        String(userId),
        String(symbol).toUpperCase(),
        totalShares,
        avgPrice,
      ]
    );
  }

  await recordTradePressure(symbol, "buy", safeShares * safePrice);
  await setTradeCooldown(guildId, userId);
}

async function applySell(guildId, userId, symbol, shares, executedPrice) {
  await ensureSchema();

  const safeShares = Number(shares);
  const holding = await getUserHolding(guildId, userId, symbol);

  if (!holding || Number(holding.shares) < safeShares) {
    throw new Error("INSUFFICIENT_SHARES");
  }

  const remaining = Number(holding.shares) - safeShares;

  if (remaining <= 0.0001) {
    await pool.query(
      `
      DELETE FROM ese_portfolios
      WHERE guild_id = $1 AND user_id = $2 AND symbol = $3
      `,
      [String(guildId), String(userId), String(symbol).toUpperCase()]
    );
  } else {
    await pool.query(
      `
      UPDATE ese_portfolios
      SET shares = $4,
          updated_at = NOW()
      WHERE guild_id = $1 AND user_id = $2 AND symbol = $3
      `,
      [
        String(guildId),
        String(userId),
        String(symbol).toUpperCase(),
        remaining,
      ]
    );
  }

  await recordTradePressure(symbol, "sell", safeShares * Number(executedPrice));
  await setTradeCooldown(guildId, userId);
}

function getTradeCooldownMs() {
  return Number(config.tradeCooldownSeconds || 15) * 1000;
}

function getTradeFeeRate() {
  return Number(config.tradeFee || 0.02);
}

module.exports = {
  ensureSchema,
  getSnapshot,
  getCompany,
  getTopMovers,
  getCompanyHistory,
  tickMarket,
  recordTradePressure,
  getTradeCooldownMs,
  getTradeFeeRate,
  getUserHolding,
  getUserPortfolio,
  getTradeCooldown,
  applyBuy,
  applySell,
};