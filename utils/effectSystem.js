const { pool } = require('./db');
const economy = require('./economy');
const defs = require('../data/effects/definitions');

const SYSTEM = defs.system || {};

function getEffectDefinition(effectId) {
  return defs.effects?.[String(effectId)] || null;
}

function normalizeActivityConfig(activity = {}) {
  return {
    key: String(activity.key || activity.id || activity.name || 'unknown_activity'),
    name: String(activity.name || activity.title || activity.key || activity.id || 'Unknown Activity'),
    effectsApply: activity.effectsApply !== false,
    canAwardEffects: activity.canAwardEffects !== false,
    blockedBlessings: Array.isArray(activity.blockedBlessings) ? activity.blockedBlessings.map(String) : [],
    blockedCurses: Array.isArray(activity.blockedCurses) ? activity.blockedCurses.map(String) : [],
    effectAwardPool: activity.effectAwardPool || null,
  };
}

async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS echo_status_effects (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      effect_id TEXT NOT NULL,
      effect_type TEXT NOT NULL,
      target TEXT NOT NULL DEFAULT 'money_reward',
      modifier_mode TEXT NOT NULL,
      modifier_value BIGINT NOT NULL,
      uses_remaining INTEGER NULL,
      expires_at TIMESTAMPTZ NULL,
      source_key TEXT NULL,
      source_type TEXT NULL,
      award_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS echo_status_effects_exp_idx
      ON echo_status_effects (expires_at);
  `);
}

function buildExpiry(minutes) {
  const mins = Number(minutes);
  if (!Number.isFinite(mins) || mins <= 0) return null;
  return new Date(Date.now() + mins * 60_000);
}

async function clearActiveEffect(guildId, userId) {
  await ensureTables();
  await pool.query(
    `DELETE FROM echo_status_effects WHERE guild_id=$1 AND user_id=$2`,
    [String(guildId), String(userId)]
  );
}

function hydrateRow(row) {
  return {
    effectId: String(row.effect_id),
    effectType: String(row.effect_type),
    target: String(row.target || 'money_reward'),
    modifierMode: String(row.modifier_mode),
    modifierValue: Number(row.modifier_value || 0),
    usesRemaining: row.uses_remaining == null ? null : Number(row.uses_remaining),
    expiresAt: row.expires_at ? new Date(row.expires_at) : null,
    sourceKey: row.source_key ? String(row.source_key) : null,
    sourceType: row.source_type ? String(row.source_type) : null,
    awardMeta: row.award_meta || {},
    createdAt: row.created_at ? new Date(row.created_at) : null,
    updatedAt: row.updated_at ? new Date(row.updated_at) : null,
    definition: getEffectDefinition(row.effect_id),
  };
}

function isExpired(effect) {
  if (!effect) return true;
  if (effect.expiresAt && effect.expiresAt.getTime() <= Date.now()) return true;
  if (effect.usesRemaining != null && effect.usesRemaining <= 0) return true;
  return false;
}

async function getActiveEffect(guildId, userId, { clearExpired = true } = {}) {
  await ensureTables();
  const res = await pool.query(
    `SELECT * FROM echo_status_effects WHERE guild_id=$1 AND user_id=$2 LIMIT 1`,
    [String(guildId), String(userId)]
  );
  const row = res.rows?.[0];
  if (!row) return null;

  const effect = hydrateRow(row);
  if (!effect.definition || effect.definition.enabled === false || isExpired(effect)) {
    if (clearExpired) await clearActiveEffect(guildId, userId);
    return null;
  }
  return effect;
}

function normalizeAwardFromDefinition(definition, award = {}) {
  const modifierMode = String(award.modifierMode || definition.defaultModifierMode || 'percent');
  if (!definition.allowedModifierModes?.includes(modifierMode)) {
    throw new Error(`Modifier mode ${modifierMode} is not allowed for ${definition.id}`);
  }

  const modifierValue = Number(award.modifierValue ?? definition.defaultModifierValue ?? 0);
  const requestedUses = award.usesRemaining ?? award.uses ?? definition.defaultDuration?.uses ?? null;
  const requestedMinutes = award.minutes ?? definition.defaultDuration?.minutes ?? null;

  const usesRemaining = definition.allowUseDuration
    ? (requestedUses == null ? null : Math.max(0, Math.floor(Number(requestedUses))))
    : null;

  const expiresAt = definition.allowTimeDuration ? buildExpiry(requestedMinutes) : null;

  return { modifierMode, modifierValue, usesRemaining, expiresAt };
}

async function awardEffect(guildId, userId, effectId, award = {}) {
  await ensureTables();
  if (!SYSTEM.enabled) return { ok: false, status: 'system_disabled' };

  const definition = getEffectDefinition(effectId);
  if (!definition || definition.enabled === false) return { ok: false, status: 'effect_disabled' };

  const payload = normalizeAwardFromDefinition(definition, award);
  const active = await getActiveEffect(guildId, userId, { clearExpired: true });

  if (!active) {
    await pool.query(
      `INSERT INTO echo_status_effects (guild_id, user_id, effect_id, effect_type, target, modifier_mode, modifier_value, uses_remaining, expires_at, source_key, source_type, award_meta, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,NOW())
       ON CONFLICT (guild_id, user_id)
       DO UPDATE SET effect_id=EXCLUDED.effect_id, effect_type=EXCLUDED.effect_type, target=EXCLUDED.target, modifier_mode=EXCLUDED.modifier_mode, modifier_value=EXCLUDED.modifier_value, uses_remaining=EXCLUDED.uses_remaining, expires_at=EXCLUDED.expires_at, source_key=EXCLUDED.source_key, source_type=EXCLUDED.source_type, award_meta=EXCLUDED.award_meta, updated_at=NOW()`,
      [
        String(guildId),
        String(userId),
        definition.id,
        definition.type,
        definition.target || 'money_reward',
        payload.modifierMode,
        payload.modifierValue,
        payload.usesRemaining,
        payload.expiresAt,
        award.sourceKey || null,
        award.sourceType || null,
        JSON.stringify(award.meta || {}),
      ]
    );
    return { ok: true, status: 'awarded', effectId: definition.id };
  }

  if (active.effectId === definition.id && active.effectType === 'blessing') {
    await pool.query(
      `UPDATE echo_status_effects
       SET modifier_mode=$3, modifier_value=$4, uses_remaining=$5, expires_at=$6, source_key=$7, source_type=$8, award_meta=$9::jsonb, updated_at=NOW()
       WHERE guild_id=$1 AND user_id=$2`,
      [
        String(guildId),
        String(userId),
        payload.modifierMode,
        payload.modifierValue,
        payload.usesRemaining,
        payload.expiresAt,
        award.sourceKey || null,
        award.sourceType || null,
        JSON.stringify(award.meta || {}),
      ]
    );
    return { ok: true, status: 'refreshed', effectId: definition.id };
  }

  if (active.effectId === definition.id && active.effectType === 'curse') {
    return { ok: false, status: 'rejected_same_curse', activeEffectId: active.effectId };
  }

  return { ok: false, status: 'rejected_existing_other', activeEffectId: active.effectId };
}

function calculateAdjustment(baseAmount, effect) {
  const base = Math.max(0, Math.floor(Number(baseAmount || 0)));
  const value = Number(effect?.modifierValue || 0);
  if (!effect || base <= 0 || !Number.isFinite(value)) return 0;
  if (effect.modifierMode === 'flat') return Math.trunc(value);
  return Math.trunc(base * (value / 100));
}

async function consumeUse(guildId, userId) {
  await ensureTables();
  const res = await pool.query(
    `UPDATE echo_status_effects
     SET uses_remaining = CASE
       WHEN uses_remaining IS NULL THEN NULL
       ELSE GREATEST(uses_remaining - 1, 0)
     END,
     updated_at = NOW()
     WHERE guild_id=$1 AND user_id=$2
     RETURNING uses_remaining, expires_at`,
    [String(guildId), String(userId)]
  );
  const row = res.rows?.[0];
  if (!row) return null;
  if ((row.uses_remaining != null && Number(row.uses_remaining) <= 0) || (row.expires_at && new Date(row.expires_at).getTime() <= Date.now())) {
    await clearActiveEffect(guildId, userId);
  }
  return row;
}

async function performPrimaryPayout({ payoutSource, guildId, userId, amount, type, meta }) {
  const amt = Math.max(0, Math.floor(Number(amount || 0)));
  if (amt <= 0) return { ok: true, skipped: true, amount: 0 };
  if (payoutSource === 'bank') {
    return economy.bankToUserIfEnough(guildId, userId, amt, type, meta);
  }
  return economy.creditUser(guildId, userId, amt, type, meta);
}

async function payoutWithEffects({ guildId, userId, baseAmount, type, meta = {}, payoutSource = 'mint', activity = {} }) {
  const base = Math.max(0, Math.floor(Number(baseAmount || 0)));
  const activityCfg = normalizeActivityConfig(activity);

  let activeEffect = null;
  let adjustment = 0;
  let finalAmount = base;

  if (SYSTEM.enabled && activityCfg.effectsApply && base > 0) {
    activeEffect = await getActiveEffect(guildId, userId, { clearExpired: true });
    if (activeEffect && activeEffect.target === 'money_reward') {
      adjustment = calculateAdjustment(base, activeEffect);
      finalAmount = Math.max(Number(SYSTEM.minPayoutFloor || 0), base + adjustment);
    }
  }

  const primaryAmount = adjustment >= 0 ? base : finalAmount;
  const bonusAmount = adjustment > 0 ? adjustment : 0;

  const primaryMeta = {
    ...meta,
    activityKey: activityCfg.key,
    activityName: activityCfg.name,
    effectApplied: Boolean(activeEffect),
    effectId: activeEffect?.effectId || null,
    effectType: activeEffect?.effectType || null,
    effectModifierMode: activeEffect?.modifierMode || null,
    effectModifierValue: activeEffect?.modifierValue ?? null,
    effectBaseAmount: base,
    effectAdjustment: adjustment,
    effectFinalAmount: finalAmount,
  };

  const primary = await performPrimaryPayout({ payoutSource, guildId, userId, amount: primaryAmount, type, meta: primaryMeta });
  if (!primary?.ok) {
    return { ok: false, baseAmount: base, finalAmount: 0, adjustment, bonusAmount: 0, effect: activeEffect, activity: activityCfg, primary };
  }

  if (bonusAmount > 0) {
    await economy.creditUser(guildId, userId, bonusAmount, `${type}_effect_bonus`, {
      ...primaryMeta,
      mintedByEffect: true,
      bonusOnly: true,
      balance_type: 'wallet',
    });
  }

  if (activeEffect) {
    await consumeUse(guildId, userId);
  }

  return {
    ok: true,
    baseAmount: base,
    finalAmount,
    adjustment,
    bonusAmount,
    effect: activeEffect,
    activity: activityCfg,
    primary,
  };
}

function effectAllowedForActivity(effectId, activity = {}) {
  const def = getEffectDefinition(effectId);
  if (!def) return false;
  const cfg = normalizeActivityConfig(activity);
  if (!cfg.canAwardEffects) return false;
  if (def.type === 'blessing' && cfg.blockedBlessings.includes(def.id)) return false;
  if (def.type === 'curse' && cfg.blockedCurses.includes(def.id)) return false;
  return true;
}

function pickWeightedEffect(activity = {}) {
  const cfg = normalizeActivityConfig(activity);
  const pool = cfg.effectAwardPool || {};
  const nothingWeight = Math.max(0, Number(pool.nothingWeight ?? 0));
  const blessingWeight = Math.max(0, Number(pool.blessingWeight ?? 0));
  const curseWeight = Math.max(0, Number(pool.curseWeight ?? 0));
  const totalBucket = nothingWeight + blessingWeight + curseWeight;
  if (!cfg.canAwardEffects || totalBucket <= 0) return null;

  let roll = Math.random() * totalBucket;
  let bucket = 'nothing';
  if ((roll -= nothingWeight) < 0) bucket = 'nothing';
  else if ((roll -= blessingWeight) < 0) bucket = 'blessing';
  else bucket = 'curse';
  if (bucket === 'nothing') return null;

  const overrides = pool.weightOverrides || {};
  const candidates = Object.values(defs.effects || {})
    .filter((def) => def.enabled !== false)
    .filter((def) => def.type === bucket)
    .filter((def) => effectAllowedForActivity(def.id, cfg))
    .map((def) => ({ def, weight: Math.max(0, Number(overrides[def.id] ?? def.defaultWeight ?? 1)) }))
    .filter((row) => row.weight > 0);

  if (!candidates.length) return null;
  const total = candidates.reduce((sum, row) => sum + row.weight, 0);
  let pick = Math.random() * total;
  for (const row of candidates) {
    pick -= row.weight;
    if (pick <= 0) return row.def;
  }
  return candidates[candidates.length - 1]?.def || null;
}

module.exports = {
  ensureTables,
  getEffectDefinition,
  getActiveEffect,
  clearActiveEffect,
  awardEffect,
  payoutWithEffects,
  normalizeActivityConfig,
  effectAllowedForActivity,
  pickWeightedEffect,
};
