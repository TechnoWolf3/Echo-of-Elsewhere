const { pool } = require("../db");
const { BOND_CONFIG, BOND_LEVELS } = require("../../data/community/bondsConfig");

let schemaReady = false;

function db() {
  return pool && typeof pool.query === "function" ? pool : null;
}

function sortPair(userA, userB) {
  const ids = [String(userA), String(userB)].sort();
  return { userA: ids[0], userB: ids[1] };
}

function dateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function clampLevel(level) {
  return Math.max(0, Math.min(BOND_CONFIG.maxLevel, Math.floor(Number(level) || 0)));
}

function getBondLevelInfo(levelOrXp) {
  const value = Number(levelOrXp) || 0;
  const fromXp = value > BOND_CONFIG.maxLevel;
  const level = fromXp ? levelFromXp(value) : clampLevel(value);
  const current = BOND_LEVELS.find((entry) => entry.level === level) || BOND_LEVELS[0];
  const next = BOND_LEVELS.find((entry) => entry.level === level + 1) || null;
  const xp = fromXp ? value : current.xp;
  return {
    ...current,
    xp,
    next,
    isMax: !next,
    progressXp: next ? Math.max(0, xp - current.xp) : current.xp,
    neededXp: next ? Math.max(1, next.xp - current.xp) : current.xp,
    nextXp: next?.xp || current.xp,
  };
}

function levelFromXp(xp) {
  const total = Math.max(0, Math.floor(Number(xp) || 0));
  let level = 0;
  for (const entry of BOND_LEVELS) {
    if (total >= entry.xp) level = entry.level;
  }
  return clampLevel(level);
}

function getBondBonuses(level) {
  const lvl = clampLevel(level);
  const bonuses = {
    jobPayoutPct: 0,
    jobXpPct: 0,
    casinoProfitPct: 0,
    display: [],
  };
  if (lvl >= 2) bonuses.jobPayoutPct = 1;
  if (lvl >= 3) bonuses.casinoProfitPct = 1;
  if (lvl >= 4) bonuses.jobPayoutPct = 3;
  if (lvl >= 5) bonuses.display.push("Team Save chance coming soon.");
  if (lvl >= 6) bonuses.jobXpPct = 3;
  if (lvl >= 7) bonuses.casinoProfitPct = 3;
  if (lvl >= 8) bonuses.display.push("Cooldown reduction coming soon.");
  if (lvl >= 9) bonuses.display.push("Shared luck coming soon.");
  if (lvl >= 10) {
    bonuses.jobPayoutPct = 8;
    bonuses.jobXpPct = 5;
    bonuses.casinoProfitPct = 5;
  }
  bonuses.jobPayoutPct = Math.min(bonuses.jobPayoutPct, BOND_CONFIG.maxBonuses.jobPayoutPct);
  bonuses.jobXpPct = Math.min(bonuses.jobXpPct, BOND_CONFIG.maxBonuses.jobXpPct);
  bonuses.casinoProfitPct = Math.min(bonuses.casinoProfitPct, BOND_CONFIG.maxBonuses.casinoProfitPct);
  return bonuses;
}

async function ensureSchema() {
  const database = db();
  if (!database || schemaReady) return Boolean(database);
  await database.query(`
    CREATE TABLE IF NOT EXISTS user_bonds (
      guild_id TEXT NOT NULL,
      user_a TEXT NOT NULL,
      user_b TEXT NOT NULL,
      xp INTEGER NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 0,
      total_activities INTEGER NOT NULL DEFAULT 0,
      casino_activities INTEGER NOT NULL DEFAULT 0,
      job_activities INTEGER NOT NULL DEFAULT 0,
      game_activities INTEGER NOT NULL DEFAULT 0,
      community_activities INTEGER NOT NULL DEFAULT 0,
      last_activity_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, user_a, user_b)
    );

    CREATE TABLE IF NOT EXISTS user_bond_daily_limits (
      guild_id TEXT NOT NULL,
      user_a TEXT NOT NULL,
      user_b TEXT NOT NULL,
      date_key TEXT NOT NULL,
      total_xp_today INTEGER NOT NULL DEFAULT 0,
      casino_xp_today INTEGER NOT NULL DEFAULT 0,
      job_xp_today INTEGER NOT NULL DEFAULT 0,
      game_xp_today INTEGER NOT NULL DEFAULT 0,
      community_xp_today INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, user_a, user_b, date_key)
    );
  `);
  schemaReady = true;
  return true;
}

async function getBondBetweenUsers(guildId, userA, userB) {
  await ensureSchema();
  const database = db();
  if (!database || String(userA) === String(userB)) return null;
  const pair = sortPair(userA, userB);
  const res = await database.query(
    `SELECT * FROM user_bonds WHERE guild_id=$1 AND user_a=$2 AND user_b=$3`,
    [String(guildId), pair.userA, pair.userB]
  );
  return res.rows?.[0] || null;
}

async function getTopBondsForUser(guildId, userId, limit = 5) {
  await ensureSchema();
  const database = db();
  if (!database) return [];
  const res = await database.query(
    `SELECT *,
       CASE WHEN user_a=$2 THEN user_b ELSE user_a END AS other_user_id
     FROM user_bonds
     WHERE guild_id=$1 AND (user_a=$2 OR user_b=$2) AND xp > 0
     ORDER BY level DESC, xp DESC, updated_at DESC
     LIMIT $3`,
    [String(guildId), String(userId), Math.max(1, Math.min(10, Math.floor(Number(limit) || 5)))]
  );
  return res.rows || [];
}

function normalizeUsers(userIds) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(userIds) ? userIds : []) {
    const id = typeof raw === "object" ? raw?.id : raw;
    if (!id || raw?.bot) continue;
    const key = String(id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function pairsFor(userIds) {
  const ids = normalizeUsers(userIds);
  const pairs = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      pairs.push(sortPair(ids[i], ids[j]));
    }
  }
  return pairs;
}

function capColumn(activityType) {
  if (activityType === "casino") return "casino_xp_today";
  if (activityType === "job") return "job_xp_today";
  if (activityType === "game") return "game_xp_today";
  if (activityType === "community") return "community_xp_today";
  return null;
}

function activityColumn(activityType) {
  if (activityType === "casino") return "casino_activities";
  if (activityType === "job") return "job_activities";
  if (activityType === "game") return "game_activities";
  if (activityType === "community") return "community_activities";
  return null;
}

async function awardBondXp({ guildId, userIds, amount, source = "unknown", activityType = "community", reason = null, metadata = {} }) {
  await ensureSchema();
  const database = db();
  if (!database || !BOND_CONFIG.enabled || !guildId) return { ok: false, reason: "disabled_or_no_db", results: [] };

  const baseAmount = Math.max(0, Math.floor(Number(amount) || 0));
  if (baseAmount <= 0) return { ok: false, reason: "no_xp", results: [] };
  if (activityType === "casino") {
    const stake = Number(metadata?.stake || metadata?.bet || metadata?.buyIn || 0);
    if (stake > 0 && stake < BOND_CONFIG.casinoMinimumStake) {
      return { ok: false, reason: "casino_stake_too_low", results: [] };
    }
  }

  const pairs = pairsFor(userIds);
  if (!pairs.length) return { ok: false, reason: "not_enough_users", results: [] };

  const today = dateKey();
  const results = [];
  for (const pair of pairs) {
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const limitRes = await client.query(
        `INSERT INTO user_bond_daily_limits (guild_id, user_a, user_b, date_key)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (guild_id, user_a, user_b, date_key) DO UPDATE SET date_key=EXCLUDED.date_key
         RETURNING *`,
        [String(guildId), pair.userA, pair.userB, today]
      );
      const limits = limitRes.rows?.[0] || {};
      const typeCol = capColumn(activityType);
      const typeCap = Number(BOND_CONFIG.dailyCaps[activityType] || BOND_CONFIG.dailyCaps.total);
      const totalLeft = Math.max(0, Number(BOND_CONFIG.dailyCaps.total) - Number(limits.total_xp_today || 0));
      const typeLeft = typeCol ? Math.max(0, typeCap - Number(limits[typeCol] || 0)) : totalLeft;
      let award = Math.min(baseAmount, totalLeft, typeLeft);

      if (Number(limits.total_xp_today || 0) === 0) {
        award = Math.min(
          award + BOND_CONFIG.xp.firstSharedActivityDailyBonus,
          Number(BOND_CONFIG.dailyCaps.total),
          typeCol ? typeCap : Number(BOND_CONFIG.dailyCaps.total)
        );
      }

      if (award <= 0) {
        await client.query("ROLLBACK");
        results.push({ ...pair, awarded: 0, capped: true });
        continue;
      }

      const current = await client.query(
        `INSERT INTO user_bonds (guild_id, user_a, user_b)
         VALUES ($1,$2,$3)
         ON CONFLICT (guild_id, user_a, user_b) DO UPDATE SET updated_at=user_bonds.updated_at
         RETURNING xp, level`,
        [String(guildId), pair.userA, pair.userB]
      );
      const oldLevel = Number(current.rows?.[0]?.level || 0);
      const newXp = Number(current.rows?.[0]?.xp || 0) + award;
      const newLevel = levelFromXp(newXp);
      const actCol = activityColumn(activityType);
      await client.query(
        `UPDATE user_bonds
         SET xp=$4,
             level=$5,
             total_activities=total_activities+1,
             casino_activities=casino_activities+$6,
             job_activities=job_activities+$7,
             game_activities=game_activities+$8,
             community_activities=community_activities+$9,
             last_activity_at=NOW(),
             updated_at=NOW()
         WHERE guild_id=$1 AND user_a=$2 AND user_b=$3`,
        [
          String(guildId),
          pair.userA,
          pair.userB,
          newXp,
          newLevel,
          actCol === "casino_activities" ? 1 : 0,
          actCol === "job_activities" ? 1 : 0,
          actCol === "game_activities" ? 1 : 0,
          actCol === "community_activities" ? 1 : 0,
        ]
      );
      await client.query(
        `UPDATE user_bond_daily_limits
         SET total_xp_today=total_xp_today+$5,
             casino_xp_today=casino_xp_today+$6,
             job_xp_today=job_xp_today+$7,
             game_xp_today=game_xp_today+$8,
             community_xp_today=community_xp_today+$9
         WHERE guild_id=$1 AND user_a=$2 AND user_b=$3 AND date_key=$4`,
        [
          String(guildId),
          pair.userA,
          pair.userB,
          today,
          award,
          activityType === "casino" ? award : 0,
          activityType === "job" ? award : 0,
          activityType === "game" ? award : 0,
          activityType === "community" ? award : 0,
        ]
      );
      await client.query("COMMIT");
      results.push({ ...pair, awarded: award, oldLevel, newLevel, leveledUp: newLevel > oldLevel, source, reason });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      results.push({ ...pair, awarded: 0, error: error?.message || String(error) });
    } finally {
      client.release();
    }
  }
  return { ok: true, results };
}

async function getBestBondBonusForGroup(guildId, userIds, context = {}) {
  const ids = normalizeUsers(userIds);
  const userId = String(context.userId || ids[0] || "");
  if (!guildId || !userId || ids.length < 2) return { level: 0, bonuses: getBondBonuses(0), bond: null };
  let best = null;
  for (const otherId of ids) {
    if (otherId === userId) continue;
    const bond = await getBondBetweenUsers(guildId, userId, otherId);
    if (!bond) continue;
    if (!best || Number(bond.level || 0) > Number(best.level || 0) || Number(bond.xp || 0) > Number(best.xp || 0)) {
      best = bond;
    }
  }
  const level = Number(best?.level || 0);
  return { level, bonuses: getBondBonuses(level), bond: best };
}

module.exports = {
  ensureSchema,
  sortPair,
  getBondLevelInfo,
  getBondBonuses,
  getBondBetweenUsers,
  getTopBondsForUser,
  getBestBondBonusForGroup,
  awardBondXp,
  levelFromXp,
};
