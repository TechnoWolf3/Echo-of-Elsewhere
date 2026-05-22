const { pool } = require("../db");
const { STANDING_CONFIG, STANDING_TIERS } = require("../../data/community/standingConfig");

let schemaReady = false;

function db() {
  return pool && typeof pool.query === "function" ? pool : null;
}

function dateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function clampStanding(value) {
  return Math.max(STANDING_CONFIG.min, Math.min(STANDING_CONFIG.max, Math.floor(Number(value) || 0)));
}

function getStandingTier(standing) {
  const value = clampStanding(standing);
  return STANDING_TIERS.find((tier) => value >= tier.min && value <= tier.max) || STANDING_TIERS[3];
}

function getStandingBonuses(standing) {
  const tier = getStandingTier(standing);
  const bonuses = {
    legalJobPayoutPct: 0,
    legalJobXpPct: 0,
    crimePayoutPct: 0,
    crimeXpPct: 0,
    legalPenaltyPct: 0,
    display: [],
  };
  if (tier.id === "helpful_local") bonuses.legalJobPayoutPct = 1;
  if (tier.id === "respected_citizen") {
    bonuses.legalJobPayoutPct = 3;
    bonuses.legalJobXpPct = 2;
  }
  if (tier.id === "golden_child") {
    bonuses.legalJobPayoutPct = 5;
    bonuses.legalJobXpPct = 3;
    bonuses.display.push("Community reward chance coming soon.");
  }
  if (tier.id === "bit_suspicious") {
    bonuses.crimePayoutPct = 1;
    bonuses.legalPenaltyPct = 1;
  }
  if (tier.id === "known_menace") {
    bonuses.crimePayoutPct = 3;
    bonuses.crimeXpPct = 2;
    bonuses.legalPenaltyPct = 3;
  }
  if (tier.id === "walking_crime_scene") {
    bonuses.crimePayoutPct = 5;
    bonuses.crimeXpPct = 3;
    bonuses.legalPenaltyPct = 5;
    bonuses.display.push("Higher police attention coming soon.");
  }
  return bonuses;
}

async function ensureSchema() {
  const database = db();
  if (!database || schemaReady) return Boolean(database);
  await database.query(`
    CREATE TABLE IF NOT EXISTS user_standing (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      standing INTEGER NOT NULL DEFAULT 0,
      total_positive INTEGER NOT NULL DEFAULT 0,
      total_negative INTEGER NOT NULL DEFAULT 0,
      last_decay_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS user_standing_daily_limits (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      date_key TEXT NOT NULL,
      positive_gain_today INTEGER NOT NULL DEFAULT 0,
      negative_loss_today INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, user_id, date_key)
    );
  `);
  schemaReady = true;
  return true;
}

async function getOrCreateStanding(guildId, userId) {
  await ensureSchema();
  const database = db();
  if (!database) return null;
  const res = await database.query(
    `INSERT INTO user_standing (guild_id, user_id, last_decay_at)
     VALUES ($1,$2,NOW())
     ON CONFLICT (guild_id, user_id) DO UPDATE SET updated_at=user_standing.updated_at
     RETURNING *`,
    [String(guildId), String(userId)]
  );
  return res.rows?.[0] || null;
}

async function applyStandingDecay(guildId, userId) {
  await ensureSchema();
  const database = db();
  if (!database || !STANDING_CONFIG.enabled || !STANDING_CONFIG.decayEnabled) return getOrCreateStanding(guildId, userId);
  const row = await getOrCreateStanding(guildId, userId);
  if (!row) return null;
  const standing = clampStanding(row.standing);
  const last = row.last_decay_at ? new Date(row.last_decay_at).getTime() : Date.now();
  const elapsedDays = Math.floor((Date.now() - last) / 86_400_000);
  if (elapsedDays <= 0 || standing === 0) return row;
  const delta = Math.min(Math.abs(standing), elapsedDays * STANDING_CONFIG.decayAmountPerDay);
  const next = standing > 0 ? standing - delta : standing + delta;
  const res = await database.query(
    `UPDATE user_standing
     SET standing=$3, last_decay_at=NOW(), updated_at=NOW()
     WHERE guild_id=$1 AND user_id=$2
     RETURNING *`,
    [String(guildId), String(userId), clampStanding(next)]
  );
  return res.rows?.[0] || row;
}

async function getStanding(guildId, userId) {
  return applyStandingDecay(guildId, userId);
}

async function adjustStanding({ guildId, userId, amount, source = "unknown", reason = null, metadata = {} }) {
  await ensureSchema();
  const database = db();
  if (!database || !STANDING_CONFIG.enabled || !guildId || !userId || metadata?.bot) {
    return { ok: false, reason: "disabled_or_invalid" };
  }
  const requested = Math.floor(Number(amount) || 0);
  if (requested === 0) return { ok: false, reason: "no_change" };

  const beforeRow = await applyStandingDecay(guildId, userId);
  const oldStanding = clampStanding(beforeRow?.standing || 0);
  const oldTier = getStandingTier(oldStanding);
  const today = dateKey();

  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const limitRes = await client.query(
      `INSERT INTO user_standing_daily_limits (guild_id, user_id, date_key)
       VALUES ($1,$2,$3)
       ON CONFLICT (guild_id, user_id, date_key) DO UPDATE SET date_key=EXCLUDED.date_key
       RETURNING *`,
      [String(guildId), String(userId), today]
    );
    const limits = limitRes.rows?.[0] || {};
    let applied = requested;
    if (requested > 0) {
      const left = Math.max(0, STANDING_CONFIG.positiveDailyCap - Number(limits.positive_gain_today || 0));
      applied = Math.min(requested, left);
    } else {
      const left = Math.max(0, STANDING_CONFIG.negativeDailyCap - Number(limits.negative_loss_today || 0));
      applied = -Math.min(Math.abs(requested), left);
    }

    if (applied === 0) {
      await client.query("ROLLBACK");
      return { ok: true, capped: true, oldStanding, newStanding: oldStanding, tier: oldTier, source, reason };
    }

    const newStanding = clampStanding(oldStanding + applied);
    const update = await client.query(
      `UPDATE user_standing
       SET standing=$3,
           total_positive=total_positive+$4,
           total_negative=total_negative+$5,
           updated_at=NOW()
       WHERE guild_id=$1 AND user_id=$2
       RETURNING *`,
      [
        String(guildId),
        String(userId),
        newStanding,
        applied > 0 ? applied : 0,
        applied < 0 ? Math.abs(applied) : 0,
      ]
    );
    await client.query(
      `UPDATE user_standing_daily_limits
       SET positive_gain_today=positive_gain_today+$4,
           negative_loss_today=negative_loss_today+$5
       WHERE guild_id=$1 AND user_id=$2 AND date_key=$3`,
      [String(guildId), String(userId), today, applied > 0 ? applied : 0, applied < 0 ? Math.abs(applied) : 0]
    );
    await client.query("COMMIT");
    const newTier = getStandingTier(newStanding);
    return {
      ok: true,
      row: update.rows?.[0] || null,
      requested,
      applied,
      oldStanding,
      newStanding,
      oldTier,
      tier: newTier,
      tierChanged: oldTier.id !== newTier.id,
      source,
      reason,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    return { ok: false, reason: "db_error", error: error?.message || String(error) };
  } finally {
    client.release();
  }
}

function applyLegalJobModifiers(amount, xp, standing, extraPct = {}) {
  const bonuses = getStandingBonuses(standing);
  const payoutPct = Number(extraPct.bondPayoutPct || 0) + Number(bonuses.legalJobPayoutPct || 0) - Number(bonuses.legalPenaltyPct || 0);
  const xpPct = Number(extraPct.bondXpPct || 0) + Number(bonuses.legalJobXpPct || 0);
  return {
    amount: Math.max(0, Math.floor(Number(amount || 0) * (1 + payoutPct / 100))),
    xp: Math.max(0, Math.floor(Number(xp || 0) * (1 + xpPct / 100))),
    payoutPct,
    xpPct,
    standingBonuses: bonuses,
  };
}

function applyCrimePayoutModifier(amount, standing) {
  const bonuses = getStandingBonuses(standing);
  const pct = Number(bonuses.crimePayoutPct || 0);
  return {
    amount: Math.max(0, Math.floor(Number(amount || 0) * (1 + pct / 100))),
    pct,
    standingBonuses: bonuses,
  };
}

module.exports = {
  ensureSchema,
  getStanding,
  getStandingTier,
  getStandingBonuses,
  adjustStanding,
  applyStandingDecay,
  applyLegalJobModifiers,
  applyCrimePayoutModifier,
  clampStanding,
};
