// utils/grindFatigue.js

function clamp(n, min, max) {
  const x = Math.floor(Number(n));
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
}

function randInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

// ✅ 5 minutes max fatigue
const MAX_FATIGUE_MS = 5 * 60 * 1000;

async function ensureRow(db, guildId, userId) {
  await db.query(
    `INSERT INTO grind_fatigue (guild_id, user_id, fatigue_ms, locked_until, updated_at)
     VALUES ($1,$2,0,NULL,NOW())
     ON CONFLICT (guild_id, user_id) DO NOTHING`,
    [guildId, userId]
  );
}

async function canGrind(db, guildId, userId) {
  await ensureRow(db, guildId, userId);
  const res = await db.query(
    `SELECT locked_until FROM grind_fatigue WHERE guild_id=$1 AND user_id=$2`,
    [guildId, userId]
  );

  const row = res.rows[0];
  if (!row?.locked_until) return { ok: true };

  const until = new Date(row.locked_until).getTime();
  if (!Number.isFinite(until) || until <= Date.now()) return { ok: true };

  return { ok: false, lockedUntil: new Date(until) };
}

async function tickFatigue(db, guildId, userId) {
  await ensureRow(db, guildId, userId);

  const res = await db.query(
    `SELECT fatigue_ms, locked_until, updated_at
     FROM grind_fatigue
     WHERE guild_id=$1 AND user_id=$2`,
    [guildId, userId]
  );

  const row = res.rows[0];
  const now = Date.now();

  const lockedUntil = row.locked_until ? new Date(row.locked_until).getTime() : 0;
  if (lockedUntil && lockedUntil > now) {
    return { locked: true, lockedUntil: new Date(lockedUntil), fatigueMs: Number(row.fatigue_ms || 0) };
  }

  const last = row.updated_at ? new Date(row.updated_at).getTime() : now;
  const delta = Math.max(0, now - last);

  let fatigue = Number(row.fatigue_ms || 0) + delta;

  if (fatigue >= MAX_FATIGUE_MS) {
    const lockSec = randInt(10 * 60, 15 * 60); // ✅ 10–15 min lock
    const until = new Date(now + lockSec * 1000);

    await db.query(
      `UPDATE grind_fatigue
       SET fatigue_ms=0, locked_until=$3, updated_at=NOW()
       WHERE guild_id=$1 AND user_id=$2`,
      [guildId, userId, until.toISOString()]
    );

    return { locked: true, lockedUntil: until, fatigueMs: MAX_FATIGUE_MS };
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
  return { pct, bar };
}

module.exports = {
  MAX_FATIGUE_MS,
  canGrind,
  tickFatigue,
  fatigueBar,
};
