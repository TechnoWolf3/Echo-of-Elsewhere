const { pool } = require('../db');
const config = require('../../data/farming/config');

const DEFAULT_TIME_ZONE = config.SEASON_TIMEZONE || 'Australia/Brisbane';
const DEFAULT_EPOCH = config.SEASON_EPOCH_MONDAY || '2026-01-05T00:00:00+10:00';
const stateCache = new Map();

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS farm_season_control (
      guild_id TEXT NOT NULL,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      PRIMARY KEY (guild_id)
    )
  `);
}

function getCalendarParts(now = Date.now(), timeZone = DEFAULT_TIME_ZONE) {
  const date = now instanceof Date ? now : new Date(now);
  const formatter = new Intl.DateTimeFormat('en-AU', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  });

  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: parts.weekday,
  };
}

function getWeekdayIndex(weekday) {
  const normalized = String(weekday || '').toLowerCase();
  const map = {
    sun: 0,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6,
  };
  return map[normalized] ?? 1;
}

function getBrisbaneMidnightUtcMs(now = Date.now(), timeZone = DEFAULT_TIME_ZONE) {
  const { year, month, day } = getCalendarParts(now, timeZone);
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00+10:00`;
  return new Date(iso).getTime();
}

function getWeekStartUtcMs(now = Date.now(), timeZone = DEFAULT_TIME_ZONE) {
  const { weekday } = getCalendarParts(now, timeZone);
  const weekdayIndex = getWeekdayIndex(weekday);
  const daysSinceMonday = weekdayIndex === 0 ? 6 : weekdayIndex - 1;
  const midnightUtcMs = getBrisbaneMidnightUtcMs(now, timeZone);
  return midnightUtcMs - daysSinceMonday * 24 * 60 * 60 * 1000;
}

function getBaseWeekIndex(now = Date.now()) {
  const epochWeekStartUtcMs = getWeekStartUtcMs(new Date(DEFAULT_EPOCH), DEFAULT_TIME_ZONE);
  const currentWeekStartUtcMs = getWeekStartUtcMs(now, DEFAULT_TIME_ZONE);
  const diffMs = currentWeekStartUtcMs - epochWeekStartUtcMs;
  return Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
}

function normalizeSeasonIndex(index) {
  const seasonCount = config.SEASONS.length || 1;
  return ((index % seasonCount) + seasonCount) % seasonCount;
}

function getCachedState(guildId) {
  const key = String(guildId || 'global');
  return stateCache.get(key) || { manualOffsetWeeks: 0, loaded: false };
}

async function getStoredState(guildId) {
  await ensureTable();
  const key = String(guildId || 'global');
  const res = await pool.query(`SELECT data FROM farm_season_control WHERE guild_id=$1`, [key]);
  return res.rowCount ? (res.rows[0].data || {}) : {};
}

async function saveStoredState(guildId, data) {
  await ensureTable();
  const key = String(guildId || 'global');
  await pool.query(
    `INSERT INTO farm_season_control (guild_id, data)
     VALUES ($1,$2::jsonb)
     ON CONFLICT (guild_id)
     DO UPDATE SET data = EXCLUDED.data`,
    [key, JSON.stringify(data)]
  );
  return data;
}

async function ensureSeasonStateLoaded(guildId) {
  const key = String(guildId || 'global');
  const cached = stateCache.get(key);
  if (cached?.loaded) return cached;

  const stored = await getStoredState(guildId);
  const nextState = {
    manualOffsetWeeks: Number(stored.manualOffsetWeeks) || 0,
    lastAdvancedAt: stored.lastAdvancedAt || null,
    loaded: true,
  };
  stateCache.set(key, nextState);
  return nextState;
}

function getCurrentSeason(guildId, now = Date.now()) {
  const cached = getCachedState(guildId);
  const weekIndex = getBaseWeekIndex(now) + (Number(cached.manualOffsetWeeks) || 0);
  return config.SEASONS[normalizeSeasonIndex(weekIndex)];
}

function getSeasonStateSummary(guildId, now = Date.now()) {
  const cached = getCachedState(guildId);
  const baseWeekIndex = getBaseWeekIndex(now);
  const manualOffsetWeeks = Number(cached.manualOffsetWeeks) || 0;
  const effectiveWeekIndex = baseWeekIndex + manualOffsetWeeks;
  const seasonIndex = normalizeSeasonIndex(effectiveWeekIndex);
  const nextSeasonIndex = normalizeSeasonIndex(effectiveWeekIndex + 1);
  const weekStartUtcMs = getWeekStartUtcMs(now, DEFAULT_TIME_ZONE);
  const nextWeekStartUtcMs = weekStartUtcMs + 7 * 24 * 60 * 60 * 1000;

  return {
    season: config.SEASONS[seasonIndex],
    nextSeason: config.SEASONS[nextSeasonIndex],
    manualOffsetWeeks,
    weekStartUtcMs,
    nextWeekStartUtcMs,
    lastAdvancedAt: cached.lastAdvancedAt || null,
  };
}

async function advanceToNextSeason(guildId, steps = 1) {
  const cached = await ensureSeasonStateLoaded(guildId);
  const increment = Math.max(1, Number(steps) || 1);
  const nextState = {
    manualOffsetWeeks: (Number(cached.manualOffsetWeeks) || 0) + increment,
    lastAdvancedAt: Date.now(),
    loaded: true,
  };
  stateCache.set(String(guildId || 'global'), nextState);
  await saveStoredState(guildId, {
    manualOffsetWeeks: nextState.manualOffsetWeeks,
    lastAdvancedAt: nextState.lastAdvancedAt,
  });
  return getSeasonStateSummary(guildId);
}

module.exports = {
  ensureSeasonStateLoaded,
  getCurrentSeason,
  getSeasonStateSummary,
  advanceToNextSeason,
  getWeekStartUtcMs,
};
