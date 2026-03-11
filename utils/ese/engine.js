const { pool } = require("../db");
const { creditUser } = require("../economy");
const config = require("../../data/ese/config");
const companies = require("../../data/ese/companies");
const dividendConfig = require("../../data/ese/dividends");
const newsTemplates = require("../../data/ese/newsTemplates");
const rumorTemplates = require("../../data/ese/rumors");

let schemaReady = false;

function clamp(num, min, max) {
  return Math.max(min, Math.min(max, num));
}

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function pick(arr, fallback = null) {
  if (!Array.isArray(arr) || !arr.length) return fallback;
  return arr[Math.floor(Math.random() * arr.length)];
}

function formatTemplate(template, data) {
  return String(template || "")
    .replaceAll("{symbol}", data.symbol || "")
    .replaceAll("{name}", data.name || "")
    .replaceAll("{sector}", data.sector || "");
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

async function getMeta(key, fallback = null) {
  const res = await pool.query(
    `SELECT value FROM ese_market_meta WHERE key = $1`,
    [key]
  );
  return res.rows?.[0]?.value ?? fallback;
}

async function setMeta(key, value) {
  await pool.query(
    `
    INSERT INTO ese_market_meta (key, value)
    VALUES ($1, $2::jsonb)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `,
    [key, JSON.stringify(value)]
  );
}

async function addNews(kind, symbol, headline) {
  await pool.query(
    `
    INSERT INTO ese_news (kind, symbol, headline)
    VALUES ($1, $2, $3)
    `,
    [kind, symbol || null, headline]
  );
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

    CREATE TABLE IF NOT EXISTS ese_news (
      id BIGSERIAL PRIMARY KEY,
      kind TEXT NOT NULL,
      symbol TEXT NULL,
      headline TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_ese_news_created
    ON ese_news (created_at DESC);

    CREATE TABLE IF NOT EXISTS ese_dividend_payouts (
      id BIGSERIAL PRIMARY KEY,
      payout_key TEXT NOT NULL UNIQUE,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      shares NUMERIC(18,4) NOT NULL,
      payout_rate NUMERIC(18,6) NOT NULL,
      payout_total BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

      await client.query(
        `
        INSERT INTO ese_market_meta (key, value)
        VALUES ('tick_counter', '{"count":0}'::jsonb)
        ON CONFLICT (key) DO NOTHING
        `
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
  const row = await getMeta("market_state", { name: "Stable Session" });
  return row?.name || "Stable Session";
}

async function setMarketStateName(name) {
  await ensureSchema();
  await setMeta("market_state", { name, updatedAt: Date.now() });
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

async function getLatestNews(limit = 5) {
  await ensureSchema();

  const res = await pool.query(
    `
    SELECT id, kind, symbol, headline, created_at AS "createdAt"
    FROM ese_news
    ORDER BY created_at DESC
    LIMIT $1
    `,
    [Math.max(1, Number(limit || 5))]
  );

  return res.rows || [];
}

async function rebuildRumorBoard() {
  const snapshot = await getSnapshot();
  const { topGainer, topLoser } = getTopMovers(snapshot);

  const poolList = snapshot.companies || [];
  const randomPick =
    poolList.length > 0
      ? poolList[Math.floor(Math.random() * poolList.length)]
      : null;

  const rumors = [];

  if (topGainer) {
    rumors.push({
      symbol: topGainer.symbol,
      tone: "bullish",
      text: formatTemplate(pick(rumorTemplates.bullish), topGainer),
    });
  }

  if (topLoser) {
    rumors.push({
      symbol: topLoser.symbol,
      tone: "bearish",
      text: formatTemplate(pick(rumorTemplates.bearish), topLoser),
    });
  }

  if (randomPick) {
    let tone = "neutral";
    if (Number(randomPick.sentiment) > 0.01) tone = "bullish";
    if (Number(randomPick.sentiment) < -0.01) tone = "bearish";

    rumors.push({
      symbol: randomPick.symbol,
      tone,
      text: formatTemplate(pick(rumorTemplates[tone]), randomPick),
    });
  }

  await setMeta("rumor_board", {
    updatedAt: Date.now(),
    items: rumors.slice(0, 3),
  });

  return rumors.slice(0, 3);
}

async function getRumorBoard() {
  await ensureSchema();

  const cached = await getMeta("rumor_board", null);
  const maxAge = Number(config.tickIntervalMinutes || 10) * 60 * 1000 * 2;

  if (
    cached &&
    Array.isArray(cached.items) &&
    cached.updatedAt &&
    Date.now() - Number(cached.updatedAt) < maxAge
  ) {
    return cached.items;
  }

  return rebuildRumorBoard();
}

async function processDividends(companiesForTick, tickCount) {
  const announcements = [];

  for (const company of companiesForTick) {
    const rule = dividendConfig[company.symbol];
    if (!rule?.enabled) continue;

    const intervalTicks = Number(rule.intervalTicks || 0);
    const payoutRate = Number(rule.payoutRate || 0);
    const minShares = Number(rule.minShares || 1);

    if (!intervalTicks || !payoutRate) continue;
    if (tickCount % intervalTicks !== 0) continue;

    const holdingsRes = await pool.query(
      `
      SELECT guild_id, user_id, shares
      FROM ese_portfolios
      WHERE symbol = $1 AND shares >= $2
      `,
      [company.symbol, minShares]
    );

    let totalPaid = 0;

    for (const row of holdingsRes.rows) {
      const shares = Number(row.shares || 0);
      const payout = Math.round(shares * Number(company.price) * payoutRate);
      if (payout <= 0) continue;

      const payoutKey = `${tickCount}:${row.guild_id}:${row.user_id}:${company.symbol}`;

      const insert = await pool.query(
        `
        INSERT INTO ese_dividend_payouts (
          payout_key, guild_id, user_id, symbol, shares, payout_rate, payout_total
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (payout_key) DO NOTHING
        RETURNING id
        `,
        [
          payoutKey,
          row.guild_id,
          row.user_id,
          company.symbol,
          shares,
          payoutRate,
          payout,
        ]
      );

      if (!insert.rows?.length) continue;

      await creditUser(
        row.guild_id,
        row.user_id,
        payout,
        "ese_dividend",
        {
          symbol: company.symbol,
          shares,
          payoutRate,
          price: Number(company.price),
          tickCount,
        }
      );

      totalPaid += payout;
    }

    if (totalPaid > 0) {
      const template = pick(newsTemplates.dividends);
      const headline = formatTemplate(template, company);
      await addNews("dividend", company.symbol, headline);

      announcements.push({
        symbol: company.symbol,
        headline,
        totalPaid,
      });
    }
  }

  return announcements;
}

async function tickMarket(activity = {}) {
  await ensureSchema();

  let marketState = await getMarketStateName();
  if (Math.random() < 0.18) {
    marketState = pickMarketState();
    await setMarketStateName(marketState);

    const stateLine = pick(
      newsTemplates.marketStates?.[marketState],
      `The exchange has shifted into ${marketState}.`
    );
    await addNews("market_state", null, stateLine);
  }

  const tickMeta = (await getMeta("tick_counter", { count: 0 })) || { count: 0 };
  const tickCount = Number(tickMeta.count || 0) + 1;
  await setMeta("tick_counter", { count: tickCount });

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
  const updatedCompanies = [];

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

      const move = {
        symbol: company.symbol,
        name: company.name,
        sector: company.sector,
        oldPrice,
        newPrice,
        percent: Number((((newPrice - oldPrice) / oldPrice) * 100).toFixed(2)),
      };

      moves.push(move);
      updatedCompanies.push({
        ...company,
        price: newPrice,
        high,
        low,
        volume,
        sentiment,
        dayChangePercent,
      });
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  const breakingThreshold = Number(config.breakingNewsThreshold || 5);

const strongMoves = moves.filter(
  (m) => Math.abs(Number(m.percent || 0)) >= breakingThreshold
);

const newsLines = [];

for (const move of strongMoves.slice(0, 2)) {
  const bucket =
    move.percent >= 0
      ? newsTemplates.bullish?.[move.sector] || newsTemplates.bullish.default
      : newsTemplates.bearish?.[move.sector] || newsTemplates.bearish.default;

  const headline = formatTemplate(pick(bucket), move);

  await pool.query(
    `
    UPDATE ese_companies
    SET last_headline = $2,
        updated_at = NOW()
    WHERE symbol = $1
    `,
    [move.symbol, headline]
  );

  await addNews("move", move.symbol, headline);

  newsLines.push({
    symbol: move.symbol,
    headline,
    percent: Number(move.percent || 0),
    newPrice: Number(move.newPrice || 0),
  });
}

  const dividendAnnouncements = await processDividends(updatedCompanies, tickCount);
  await rebuildRumorBoard();

  return {
    state: await getSnapshot(),
    moves,
    newsLines,
    dividendAnnouncements,
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

function getDividendRule(symbol) {
  return dividendConfig[String(symbol).toUpperCase()] || { enabled: false };
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
  getLatestNews,
  getRumorBoard,
  getDividendRule,
  getTradeCooldownMs,
  getTradeFeeRate,
  getUserHolding,
  getUserPortfolio,
  getTradeCooldown,
  applyBuy,
  applySell,
};