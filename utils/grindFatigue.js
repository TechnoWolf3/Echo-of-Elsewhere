// utils/grindFatigue.js
// Shared fatigue across all Grind jobs.
//
// UPDATED RULES (session-based with optional overtime):
// - You can grind for 5 minutes total (100% fatigue).
// - At 100% fatigue you should REST. Modules may prompt the user to end the shift
//   or "push on" (overtime). This util no longer auto-locks at 100%.
// - A lockout (10–15 minutes by default) is applied explicitly via applyGrindLock().
//   e.g. when the player ends at/over 100% or suffers an injury/collapse.
// - While NOT grinding, fatigue recovers linearly: 100% -> 0% in 15 minutes.
//   (So 50% -> 0% in ~7.5 minutes, etc.)
//
// Implementation notes:
// - We store fatigue_ms as "work-time accumulated" toward MAX_FATIGUE_MS.
const { renderProgressBar } = require("./progressBar");
// - While grinding: fatigue_ms += real elapsed time.
// - While idle: fatigue_ms -= real elapsed time * (MAX_FATIGUE_MS / RECOVERY_MS).
// - We treat long gaps between ticks as idle recovery (to avoid insta-fatigue from stale updated_at).

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

// ✅ 15 minutes to recover from 100% -> 0%
const RECOVERY_MS = 15 * 60 * 1000;

// If we haven't ticked in a while, assume idle recovery rather than active grinding.
const ACTIVE_TICK_WINDOW_MS = 45 * 1000; // 45s

const RECOVERY_RATE = MAX_FATIGUE_MS / RECOVERY_MS; // fatigue-ms recovered per 1ms real time

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

function applyRecovery(fatigueMs, deltaMs) {
  const f = Number(fatigueMs || 0);
  const d = Math.max(0, Number(deltaMs || 0));
  if (d <= 0 || f <= 0) return Math.max(0, f);

  const recovered = d * RECOVERY_RATE;
  // Keep as integer milliseconds (DB column is bigint)
  return Math.max(0, Math.round(f - recovered));
}

async function canGrind(db, guildId, userId) {
  await ensureRow(db, guildId, userId);

  const res = await db.query(
    `SELECT fatigue_ms, locked_until, updated_at FROM grind_fatigue WHERE guild_id=$1 AND user_id=$2`,
    [guildId, userId]
  );

  const row = res.rows[0] || {};
  const now = Date.now();

  const untilMs = row.locked_until ? new Date(row.locked_until).getTime() : 0;
  if (untilMs && Number.isFinite(untilMs)) {
    if (untilMs > now) {
      return { ok: false, lockedUntil: new Date(untilMs), fatigueMs: Number(row.fatigue_ms || 0) };
    }
    await clearIfExpiredLock(db, guildId, userId, untilMs);
  }

  // Apply idle recovery since last update
  const lastMs = row.updated_at ? new Date(row.updated_at).getTime() : now;
  const delta = Math.max(0, now - (Number.isFinite(lastMs) ? lastMs : now));

  const current = Number(row.fatigue_ms || 0);
  const next = applyRecovery(current, delta);

  // Persist recovery so the value is correct across restarts
  if (Math.abs(next - current) >= 1) {
    await db.query(
      `UPDATE grind_fatigue SET fatigue_ms=$3, updated_at=NOW() WHERE guild_id=$1 AND user_id=$2`,
      [guildId, userId, Math.round(next)]
    );
  } else {
    await db.query(
      `UPDATE grind_fatigue SET updated_at=NOW() WHERE guild_id=$1 AND user_id=$2`,
      [guildId, userId]
    );
  }

  // Starting a new Grind shift is blocked if you're at/above 100% fatigue.
  if (next >= MAX_FATIGUE_MS) {
    return { ok: false, lockedUntil: null, fatigueMs: next, maxMs: MAX_FATIGUE_MS, exhausted: true };
  }

  return { ok: true, fatigueMs: next, maxMs: MAX_FATIGUE_MS, exhausted: false };
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
    await clearIfExpiredLock(db, guildId, userId, lockedUntilMs);
  }

  const lastMs = row.updated_at ? new Date(row.updated_at).getTime() : now;
  const delta = Math.max(0, now - (Number.isFinite(lastMs) ? lastMs : now));

  let fatigue = Number(row.fatigue_ms || 0);

  // If ticks are frequent, treat as active grind time. Otherwise, treat as idle recovery.
  if (delta <= ACTIVE_TICK_WINDOW_MS) {
    fatigue += delta;
  } else {
    fatigue = applyRecovery(fatigue, delta);
  }

  // Keep as integer milliseconds (DB column is bigint)
  fatigue = Math.round(fatigue);

  // NOTE: We do NOT auto-lock at 100% fatigue anymore.
  // Modules should prompt at 100% and call applyGrindLock() when appropriate.

  await db.query(
    `UPDATE grind_fatigue
     SET fatigue_ms=$3, locked_until=NULL, updated_at=NOW()
     WHERE guild_id=$1 AND user_id=$2`,
    [guildId, userId, fatigue]
  );

  return {
    locked: false,
    fatigueMs: fatigue,
    maxMs: MAX_FATIGUE_MS,
    exhausted: fatigue >= MAX_FATIGUE_MS,
  };
}

async function applyGrindLock(db, guildId, userId, { minSeconds = 10 * 60, maxSeconds = 15 * 60 } = {}) {
  await ensureRow(db, guildId, userId);

  const now = Date.now();
  const lockSec = randInt(minSeconds, maxSeconds);
  const until = new Date(now + lockSec * 1000);

  await db.query(
    `UPDATE grind_fatigue
     SET fatigue_ms=0, locked_until=$3, updated_at=NOW()
     WHERE guild_id=$1 AND user_id=$2`,
    [guildId, userId, until.toISOString()]
  );

  return { lockedUntil: until };
}

function fatigueBar(fatigueMs, length = 16) {
  const pct = clamp((Number(fatigueMs || 0) / MAX_FATIGUE_MS) * 100, 0, 100);
  const bar = renderProgressBar(pct, 100, { length });
  return { pct: Math.round(pct), bar };
}

module.exports = {
  MAX_FATIGUE_MS,
  RECOVERY_MS,
  canGrind,
  tickFatigue,
  applyGrindLock,
  fatigueBar,
};
