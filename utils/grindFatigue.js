// utils/grindFatigue.js
// Shared fatigue across all Grind jobs.
// Rules:
// - You can grind for 5 minutes total (100% fatigue).
// - At 100% fatigue, ALL grind jobs lock for 10–15 minutes.
// - Fatigue only increases while you're actively grinding (i.e., while tickFatigue is being called regularly).

function clamp(n, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
}

function randInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

// ✅ 5 minutes to reach 100% fatigue
const MAX_FATIGUE_MS = 5 * 60 * 1000;

// If we haven't ticked fatigue in a while, we assume the player is not actively grinding,
// so we do NOT count that time towards fatigue.
const ACTIVE_TICK_WINDOW_MS = 30 * 1000; // 30s

async function ensureRow(db, guildId, userId) {
  await db.query(
    `INSERT INTO grind_fatigue (guild_id, user_id, fatigue_ms, locked_until, updated_at)
     VALUES ($1,$2,0,NULL,NOW())
     ON CONFLICT (guild_id, user_id) DO NOTHING`,
    [guildId, userId]
  );
}

async function clearIfExpiredLock(db, guildId, userId, lockedUntilMs) {
  if (!lockedUntilMs) return;
  if (lockedUntilMs <= Date.now()) {
    await db.query(
      `UPDATE grind_fatigue
       SET locked_until=NULL, updated_at=NOW()
       WHERE guild_id=$1 AND user_id=$2`,
      [guildId, userId]
    );
  }
}

async function canGrind(db, guildId, userId) {
  await ensureRow(db, guildId, userId);

  const res = await db.query(
    `SELECT fatigue_ms, locked_until FROM grind_fatigue WHERE guild_id=$1 AND user_id=$2`,
    [guildId, userId]
  );

  const row = res.rows[0];
  if (!row?.locked_until) return { ok: true, fatigueMs: Number(row?.fatigue_ms || 0) };

  const untilMs = new Date(row.locked_until).getTime();
  if (!Number.isFinite(untilMs)) return { ok: true, fatigueMs: Number(row?.fatigue_ms || 0) };

  if (untilMs <= Date.now()) {
    await clearIfExpiredLock(db, guildId, userId, untilMs);
    return { ok: true, fatigueMs: Number(row?.fatigue_ms || 0) };
  }

  return { ok: false, lockedUntil: new Date(untilMs), fatigueMs: Number(row?.fatigue_ms || 0) };
}

async function tickFatigue(db, guildId, userId) {
  await ensureRow(db, guildId, userId);

  const res = await db.query(
    `SELECT fatigue_ms, locked_until, updated_at
     FROM grind_fatigue
     WHERE guild_id=$1 AND user_id=$2`,
    [guildId, userId]
  );

  const row = res.rows[0] || {};
  const now = Date.now();

  const lockedUntilMs = row.locked_until ? new Date(row.locked_until).getTime() : 0;
  if (lockedUntilMs && Number.isFinite(lockedUntilMs)) {
    if (lockedUntilMs > now) {
      return { locked: true, lockedUntil: new Date(lockedUntilMs), fatigueMs: Number(row.fatigue_ms || 0), maxMs: MAX_FATIGUE_MS };
    }
    // lock expired -> clear
    await clearIfExpiredLock(db, guildId, userId, lockedUntilMs);
  }

  const lastMs = row.updated_at ? new Date(row.updated_at).getTime() : now;
  let delta = Math.max(0, now - (Number.isFinite(lastMs) ? lastMs : now));

  // Only count time if this job is being actively ticked.
  if (delta > ACTIVE_TICK_WINDOW_MS) {
    delta = 0;
  }

  let fatigue = Number(row.fatigue_ms || 0) + delta;

  if (fatigue >= MAX_FATIGUE_MS) {
    // ✅ 10–15 minute lockout
    const lockSec = randInt(10 * 60, 15 * 60);
    const until = new Date(now + lockSec * 1000);

    await db.query(
      `UPDATE grind_fatigue
       SET fatigue_ms=0, locked_until=$3, updated_at=NOW()
       WHERE guild_id=$1 AND user_id=$2`,
      [guildId, userId, until.toISOString()]
    );

    return { locked: true, lockedUntil: until, fatigueMs: MAX_FATIGUE_MS, maxMs: MAX_FATIGUE_MS };
  }

  await db.query(
    `UPDATE grind_fatigue
     SET fatigue_ms=$3, locked_until=NULL, updated_at=NOW()
     WHERE guild_id=$1 AND user_id=$2`,
    [guildId, userId, fatigue]
  );

  return { locked: false, fatigueMs: fatigue, maxMs: MAX_FATIGUE_MS };
}

function fatigueBar(fatigueMs) {
  const pct = clamp((Number(fatigueMs || 0) / MAX_FATIGUE_MS) * 100, 0, 100);
  const blocks = 10;
  const filled = Math.round((pct / 100) * blocks);
  const bar = "█".repeat(filled) + "░".repeat(blocks - filled);
  return { pct: Math.round(pct), bar };
}

module.exports = {
  MAX_FATIGUE_MS,
  canGrind,
  tickFatigue,
  fatigueBar,
};
