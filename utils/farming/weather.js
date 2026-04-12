const { pool } = require('../db');
const config = require('../../data/farming/config');
const weatherConfig = require('../../data/farming/weather');
const weatherChances = require('../../data/farming/weatherChances');

const DAY_MS = 24 * 60 * 60 * 1000;
const AEST_OFFSET_MS = 10 * 60 * 60 * 1000;
const FARM_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS farms (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (guild_id, user_id)
  )
`;

function getDayNumber(now = Date.now()) {
  return Math.floor((now + AEST_OFFSET_MS) / DAY_MS);
}

function getDayKey(now = Date.now()) {
  return String(getDayNumber(now));
}

function getAestDayStart(now = Date.now()) {
  return getDayNumber(now) * DAY_MS - AEST_OFFSET_MS;
}

async function ensureWeatherTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS farm_weather (
      guild_id TEXT NOT NULL,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      PRIMARY KEY (guild_id)
    )
  `);
}

async function ensureFarmTable() {
  await pool.query(FARM_TABLE_SQL);
}

function weightedPick(weightMap) {
  const entries = Object.entries(weightMap || {}).filter(([, weight]) => Number(weight) > 0);
  const total = entries.reduce((sum, [, weight]) => sum + Number(weight), 0);
  if (total <= 0) return null;
  let roll = Math.random() * total;
  for (const [key, weight] of entries) {
    roll -= Number(weight);
    if (roll <= 0) return key;
  }
  return entries[entries.length - 1]?.[0] || null;
}

function chooseRandom(arr) {
  if (!Array.isArray(arr) || !arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)] || null;
}

function randomInt(min, max) {
  const low = Math.min(Number(min) || 0, Number(max) || 0);
  const high = Math.max(Number(min) || 0, Number(max) || 0);
  return Math.floor(Math.random() * (high - low + 1)) + low;
}

function getWeatherDefinition(eventId) {
  return weatherConfig.weatherTypes?.[eventId] || null;
}

function interpolate(template, replacements = {}) {
  return String(template || '').replace(/\{(\w+)\}/g, (_, key) => String(replacements[key] ?? `{${key}}`));
}

function rollNewWeatherState(now = Date.now(), season = getCurrentSeason(now)) {
  const base = weatherConfig.defaultDayCondition;
  const dayStart = getAestDayStart(now);
  const dayKey = getDayKey(now);
  const poolForSeason = weatherChances[season] || { none: 100 };
  const selection = weightedPick(poolForSeason);

  const state = {
    dayKey,
    season,
    baseWeather: base.id,
    rolledAt: now,
    event: null,
  };

  if (!selection || selection === 'none') return state;

  const def = getWeatherDefinition(selection);
  if (!def) return state;

  const window = chooseRandom(weatherConfig.timeWindows) || weatherConfig.timeWindows[0];
  const durationHours = randomInt(def.durationHours?.[0] ?? 2, def.durationHours?.[1] ?? 4);
  const earliestStart = dayStart + window.startHour * 60 * 60 * 1000;
  const latestStart = dayStart + Math.max(window.startHour, window.endHour - durationHours) * 60 * 60 * 1000;
  const startAt = randomInt(earliestStart, Math.max(earliestStart, latestStart));
  const endAt = Math.min(startAt + durationHours * 60 * 60 * 1000, dayStart + DAY_MS - 1);

  state.event = {
    id: def.id,
    name: def.name,
    severity: def.severity,
    eventKey: `${dayKey}:${def.id}:${window.key}`,
    windowKey: window.key,
    windowLabel: window.label,
    startsAt: startAt,
    endsAt: endAt,
    activatedAt: null,
  };

  return state;
}

async function getWeatherState(guildId) {
  await ensureWeatherTable();
  const res = await pool.query(`SELECT data FROM farm_weather WHERE guild_id=$1`, [guildId]);
  return res.rowCount ? (res.rows[0].data || {}) : null;
}

async function saveWeatherState(guildId, data) {
  await ensureWeatherTable();
  await pool.query(
    `INSERT INTO farm_weather (guild_id, data)
     VALUES ($1,$2::jsonb)
     ON CONFLICT (guild_id)
     DO UPDATE SET data = EXCLUDED.data`,
    [guildId, JSON.stringify(data)]
  );
  return data;
}

function getCurrentSeason(now = Date.now()) {
  const index = Math.floor(now / config.SEASON_LENGTH_MS) % config.SEASONS.length;
  return config.SEASONS[index];
}

function hasBlockingWeatherState(field) {
  return Boolean(field?.cropWeatherEffect || field?.fieldCondition);
}

function ensureFieldMeta(field) {
  if (!field.weatherMeta || typeof field.weatherMeta !== 'object') field.weatherMeta = {};
  return field.weatherMeta;
}

function markFieldTouchedByEvent(field, eventKey) {
  const meta = ensureFieldMeta(field);
  meta.lastEventKey = eventKey;
}

function hasFieldSeenEvent(field, eventKey) {
  return field?.weatherMeta?.lastEventKey === eventKey;
}

function applyWeatherEventToField(field, event, options = {}) {
  if (!field || !event?.id || !event?.eventKey) return false;
  if (hasFieldSeenEvent(field, event.eventKey)) return false;

  const def = getWeatherDefinition(event.id);
  if (!def) return false;

  const forceImpact = Boolean(options.forceImpact);
  const impactChance = Number(def.fieldImpactChance ?? 1);
  const impacted = forceImpact || Math.random() < impactChance;

  markFieldTouchedByEvent(field, event.eventKey);
  if (!impacted) return true;

  if (hasBlockingWeatherState(field)) return true;

  const isPlanted = Boolean(field.cropId && (field.state === 'growing' || field.state === 'ready'));
  const isFieldEligible = def.appliesTo === 'all_fields'
    ? true
    : isPlanted;

  if (!isFieldEligible) return true;

  if (def.cropEffect && isPlanted && !field.cropWeatherEffect && !field.fieldCondition) {
    field.cropWeatherEffect = {
      ...def.cropEffect,
      source: def.id,
      appliedAt: Date.now(),
      eventKey: event.eventKey,
    };
    return true;
  }

  if (def.fieldEffect && !field.fieldCondition) {
    field.fieldCondition = {
      ...def.fieldEffect,
      source: def.id,
      appliedAt: Date.now(),
      eventKey: event.eventKey,
    };
    return true;
  }

  return true;
}

async function applyEventToAllFarms(guildId, state) {
  const event = state?.event;
  if (!event?.id || !event.eventKey) return false;

  await ensureFarmTable();
  const res = await pool.query(`SELECT user_id, data FROM farms WHERE guild_id=$1`, [guildId]);
  let changedAny = false;

  for (const row of res.rows) {
    const farm = row.data || { fields: [] };
    if (!Array.isArray(farm.fields) || !farm.fields.length) continue;

    let changed = false;
    for (const field of farm.fields) {
      const before = JSON.stringify({
        cropWeatherEffect: field?.cropWeatherEffect || null,
        fieldCondition: field?.fieldCondition || null,
        weatherMeta: field?.weatherMeta || null,
      });
      applyWeatherEventToField(field, event);
      const after = JSON.stringify({
        cropWeatherEffect: field?.cropWeatherEffect || null,
        fieldCondition: field?.fieldCondition || null,
        weatherMeta: field?.weatherMeta || null,
      });
      if (before !== after) changed = true;
    }

    if (!changed) continue;
    changedAny = true;
    await pool.query(
      `UPDATE farms SET data=$1::jsonb WHERE guild_id=$2 AND user_id=$3`,
      [JSON.stringify(farm), guildId, row.user_id]
    );
  }

  return changedAny;
}

async function ensureDailyWeatherState(guildId, now = Date.now()) {
  await ensureWeatherTable();
  let state = await getWeatherState(guildId);
  const season = getCurrentSeason(now);

  if (!state || state.dayKey !== getDayKey(now) || state.season !== season) {
    state = rollNewWeatherState(now, season);
    await saveWeatherState(guildId, state);
  }

  if (state?.event && now >= Number(state.event.startsAt) && !state.event.activatedAt) {
    await applyEventToAllFarms(guildId, state);
    state.event.activatedAt = now;
    await saveWeatherState(guildId, state);
  }

  return state;
}

function isEventActive(state, now = Date.now()) {
  const event = state?.event;
  if (!event?.id) return false;
  return now >= Number(event.startsAt) && now <= Number(event.endsAt);
}

function buildWeatherChannel(state, now = Date.now()) {
  const base = weatherConfig.defaultDayCondition;
  const event = state?.event;
  const def = event?.id ? getWeatherDefinition(event.id) : null;

  if (!def || !event) {
    return {
      headline: base.messages.headline,
      forecast: base.messages.forecast,
      impact: base.messages.impact,
      report: chooseRandom(base.messages.reports),
    };
  }

  const replacements = { window: event.windowLabel || 'later today' };
  return {
    headline: interpolate(def.messages.headline, replacements),
    forecast: interpolate(def.messages.forecast, replacements),
    impact: interpolate(def.messages.impact, replacements),
    report: chooseRandom(def.messages.reports),
    activeNow: isEventActive(state, now),
    eventName: def.name,
  };
}

function maybeApplyActiveEventToField(field, state, now = Date.now()) {
  if (!field || !state?.event || !isEventActive(state, now)) return false;
  return applyWeatherEventToField(field, state.event);
}

function clearHarvestWeather(field) {
  if (!field) return;
  field.cropWeatherEffect = null;
}

function clearCultivationWeather(field) {
  if (!field) return;
  field.fieldCondition = null;
}

function getYieldMultiplier(field) {
  const cropMult = Number(field?.cropWeatherEffect?.yieldMultiplier ?? 1);
  return cropMult > 0 ? cropMult : 1;
}

function getUsablePlotMultiplier(field) {
  const fieldMult = Number(field?.fieldCondition?.usablePlotMultiplier ?? 1);
  return fieldMult > 0 ? fieldMult : 1;
}

module.exports = {
  ensureDailyWeatherState,
  getWeatherState,
  saveWeatherState,
  getWeatherDefinition,
  buildWeatherChannel,
  isEventActive,
  maybeApplyActiveEventToField,
  applyWeatherEventToField,
  clearHarvestWeather,
  clearCultivationWeather,
  getYieldMultiplier,
  getUsablePlotMultiplier,
  getCurrentSeason,
  getDayKey,
};
