const { pool } = require('./db');
const definitions = require('../data/effects/definitions');
const { setJail } = require('./jail');

let schemaReady = false;

const DEFAULT_ACTIVITY_EFFECTS = Object.freeze({
  effectsApply: true,
  canAwardEffects: true,
  blockedBlessings: [],
  blockedCurses: [],
  effectAwardPool: {
    nothingWeight: 100,
    blessingWeight: 0,
    curseWeight: 0,
    blessingWeights: {},
    curseWeights: {},
  },
});

async function ensureSchema() {
  if (schemaReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_effects (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      effect_id TEXT NOT NULL,
      effect_type TEXT NOT NULL,
      target TEXT NOT NULL DEFAULT 'money_reward',
      modifier_mode TEXT NOT NULL,
      modifier_value INTEGER NOT NULL,
      expires_at TIMESTAMPTZ NULL,
      uses_remaining INTEGER NULL,
      source TEXT NULL,
      awarded_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
      granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, user_id)
    )
  `);
  schemaReady = true;
}

function randInt(min, max) {
  const lo = Math.floor(Number(min || 0));
  const hi = Math.floor(Number(max || 0));
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return 0;
  if (hi <= lo) return lo;
  return Math.floor(lo + Math.random() * (hi - lo + 1));
}

function pickRandom(arr) {
  if (!Array.isArray(arr) || !arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)] || null;
}

function tsOf(value) {
  const date = value instanceof Date ? value : value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return Math.floor(date.getTime() / 1000);
}

function relativeTs(value) {
  const ts = tsOf(value);
  return ts ? `<t:${ts}:R>` : null;
}

function absoluteTs(value) {
  const ts = tsOf(value);
  return ts ? `<t:${ts}:F>` : null;
}

function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${Number(count) === 1 ? singular : plural}`;
}

function describeDuration(instance) {
  const bits = [];
  if (instance?.expiresAt) bits.push(relativeTs(instance.expiresAt));
  if (instance?.usesRemaining !== null && instance?.usesRemaining !== undefined) {
    bits.push(`for **${pluralize(Number(instance.usesRemaining), 'use')}**`);
  }
  if (!bits.length) return 'for a while yet';
  return bits.join(' or ');
}

function normalizeActivityEffects(input) {
  const cfg = input || {};
  const poolCfg = cfg.effectAwardPool || {};
  return {
    effectsApply: cfg.effectsApply !== false,
    canAwardEffects: cfg.canAwardEffects === true,
    blockedBlessings: Array.isArray(cfg.blockedBlessings) ? cfg.blockedBlessings.map(String) : [],
    blockedCurses: Array.isArray(cfg.blockedCurses) ? cfg.blockedCurses.map(String) : [],
    effectAwardPool: {
      nothingWeight: Number(poolCfg.nothingWeight ?? DEFAULT_ACTIVITY_EFFECTS.effectAwardPool.nothingWeight) || 0,
      blessingWeight: Number(poolCfg.blessingWeight ?? DEFAULT_ACTIVITY_EFFECTS.effectAwardPool.blessingWeight) || 0,
      curseWeight: Number(poolCfg.curseWeight ?? DEFAULT_ACTIVITY_EFFECTS.effectAwardPool.curseWeight) || 0,
      blessingWeights: poolCfg.blessingWeights && typeof poolCfg.blessingWeights === 'object' ? poolCfg.blessingWeights : {},
      curseWeights: poolCfg.curseWeights && typeof poolCfg.curseWeights === 'object' ? poolCfg.curseWeights : {},
    },
  };
}

function getDefinition(effectId) {
  return definitions[String(effectId)] || null;
}

function parseJsonMeta(meta) {
  if (!meta) return {};
  if (typeof meta === 'object') return meta;
  try {
    return JSON.parse(meta);
  } catch {
    return {};
  }
}

function pickRangeValue(explicitValue, explicitRange, defValue, defRange) {
  const range = explicitRange || defRange;
  if (Array.isArray(range) && range.length >= 2) {
    return randInt(range[0], range[1]);
  }
  const n = Number(explicitValue ?? defValue ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function fillTemplate(line, context = {}) {
  return String(line || '').replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
    const value = context[key];
    return value === undefined || value === null ? '' : String(value);
  }).replace(/\s+\./g, '.').trim();
}

function buildEffectContext(def, instance = {}, extra = {}) {
  const awardedMeta = parseJsonMeta(instance.awardedMeta || extra.awardedMeta);
  const expiresAt = instance.expiresAt || instance.expires_at || null;
  const usesRemaining = instance.usesRemaining ?? instance.uses_remaining ?? null;
  const jailMinutes = awardedMeta.jailMinutes ?? extra.jailMinutes ?? null;
  const jailUntil = extra.jailedUntil || null;
  return {
    effectName: def?.name || 'Echo effect',
    effectId: def?.id || instance.effectId || instance.effect_id || '',
    durationText: describeDuration({ expiresAt, usesRemaining }),
    expiresRelative: relativeTs(expiresAt) || '',
    expiresFull: absoluteTs(expiresAt) || '',
    usesRemaining: usesRemaining ?? '',
    jailMinutes: jailMinutes ?? '',
    jailUntilRelative: relativeTs(jailUntil) || '',
    jailUntilFull: absoluteTs(jailUntil) || '',
    ...extra,
  };
}

function genericLine(kind, ctx) {
  if (kind === 'awarded') return `✨ **${ctx.effectName}** settles in ${ctx.durationText}.`;
  if (kind === 'refreshed') return `✨ **${ctx.effectName}** returns and now lasts ${ctx.durationText}.`;
  if (kind === 'rejected_same_curse') return `🕸️ **${ctx.effectName}** is already on you. Echo refuses to deepen it.`;
  if (kind === 'rejected_existing_other') return `🌫️ Echo reaches for you, but another effect is already hanging on.`;
  if (kind === 'triggered') return `⛓️ **${ctx.effectName}** triggers — you are jailed until ${ctx.jailUntilRelative}.`;
  return null;
}

function buildEffectNotice(def, kind, instance = {}, extra = {}) {
  const keyMap = {
    awarded: 'awardLines',
    refreshed: 'refreshLines',
    rejected_same_curse: 'rejectSameCurseLines',
    rejected_existing_other: 'rejectExistingOtherLines',
    triggered: 'triggerLines',
  };
  const lines = def?.[keyMap[kind]];
  const ctx = buildEffectContext(def, instance, extra);
  const raw = pickRandom(lines) || genericLine(kind, ctx);
  return raw ? fillTemplate(raw, ctx) : null;
}

async function getActiveEffect(guildId, userId, { clearExpired = true } = {}) {
  await ensureSchema();
  const res = await pool.query(
    `SELECT * FROM user_effects WHERE guild_id=$1 AND user_id=$2 LIMIT 1`,
    [String(guildId), String(userId)]
  );
  const row = res.rows?.[0] || null;
  if (!row) return null;
  row.awarded_meta = parseJsonMeta(row.awarded_meta);

  const expiredByTime = row.expires_at ? new Date(row.expires_at).getTime() <= Date.now() : false;
  const expiredByUses = row.uses_remaining !== null && Number(row.uses_remaining) <= 0;
  if ((expiredByTime || expiredByUses) && clearExpired) {
    await clearActiveEffect(guildId, userId);
    return null;
  }
  return row;
}

async function clearActiveEffect(guildId, userId) {
  await ensureSchema();
  await pool.query(`DELETE FROM user_effects WHERE guild_id=$1 AND user_id=$2`, [String(guildId), String(userId)]);
}

function buildAwardInstance(def, award = {}) {
  const useTime = award.useTime ?? def.defaultUseTime ?? !!award.durationMinutes ?? false;
  const useUses = award.useUses ?? def.defaultUseUses ?? Number.isFinite(Number(award.uses)) ?? false;

  const durationMinutes = useTime
    ? pickRangeValue(award.durationMinutes, award.durationMinutesRange, def.defaultDurationMinutes, def.defaultDurationMinutesRange)
    : null;
  const uses = useUses
    ? pickRangeValue(award.uses, award.usesRange, def.defaultUses, def.defaultUsesRange)
    : null;

  const awardedMeta = {
    ...(def.defaultAwardedMeta || {}),
    ...(award.meta && typeof award.meta === 'object' ? award.meta : {}),
  };

  if (Array.isArray(def.triggers) && !awardedMeta.triggers) {
    awardedMeta.triggers = [...def.triggers];
  }
  if (Array.isArray(award.triggers)) {
    awardedMeta.triggers = [...award.triggers];
  }
  if (Array.isArray(def.jailMinutesRange) && awardedMeta.jailMinutes == null) {
    awardedMeta.jailMinutes = randInt(def.jailMinutesRange[0], def.jailMinutesRange[1]);
  }
  if (award.jailMinutes != null) {
    awardedMeta.jailMinutes = Number(award.jailMinutes);
  }

  return {
    effectId: def.id,
    effectType: def.type,
    target: def.target,
    modifierMode: String(award.modifierMode || def.modifierMode),
    modifierValue: Number(award.value ?? def.defaultValue ?? 0),
    expiresAt: useTime && durationMinutes > 0 ? new Date(Date.now() + durationMinutes * 60_000) : null,
    usesRemaining: useUses && uses > 0 ? uses : null,
    source: award.source ? String(award.source) : null,
    awardedMeta,
  };
}

async function awardEffect(guildId, userId, effectId, award = {}) {
  await ensureSchema();
  const def = getDefinition(effectId);
  if (!def || def.enabled === false) return { ok: false, status: 'rejected_invalid' };

  const current = await getActiveEffect(guildId, userId);
  const instance = buildAwardInstance(def, award);

  if (!current) {
    await pool.query(
      `INSERT INTO user_effects (
        guild_id, user_id, effect_id, effect_type, target, modifier_mode, modifier_value,
        expires_at, uses_remaining, source, awarded_meta, granted_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,NOW(),NOW())
      ON CONFLICT (guild_id, user_id) DO UPDATE SET
        effect_id=EXCLUDED.effect_id,
        effect_type=EXCLUDED.effect_type,
        target=EXCLUDED.target,
        modifier_mode=EXCLUDED.modifier_mode,
        modifier_value=EXCLUDED.modifier_value,
        expires_at=EXCLUDED.expires_at,
        uses_remaining=EXCLUDED.uses_remaining,
        source=EXCLUDED.source,
        awarded_meta=EXCLUDED.awarded_meta,
        granted_at=NOW(),
        updated_at=NOW()`,
      [String(guildId), String(userId), instance.effectId, instance.effectType, instance.target, instance.modifierMode,
        instance.modifierValue, instance.expiresAt, instance.usesRemaining, instance.source, JSON.stringify(instance.awardedMeta || {})]
    );
    return { ok: true, status: 'awarded', effectId: instance.effectId, instance, notice: buildEffectNotice(def, 'awarded', instance) };
  }

  if (String(current.effect_id) === String(instance.effectId)) {
    if (String(current.effect_type) === 'curse') {
      return {
        ok: false,
        status: 'rejected_same_curse',
        effectId: instance.effectId,
        instance,
        notice: buildEffectNotice(def, 'rejected_same_curse', instance),
      };
    }
    await pool.query(
      `UPDATE user_effects
       SET effect_type=$3, target=$4, modifier_mode=$5, modifier_value=$6,
           expires_at=$7, uses_remaining=$8, source=$9, awarded_meta=$10::jsonb,
           granted_at=NOW(), updated_at=NOW()
       WHERE guild_id=$1 AND user_id=$2`,
      [String(guildId), String(userId), instance.effectType, instance.target, instance.modifierMode,
        instance.modifierValue, instance.expiresAt, instance.usesRemaining, instance.source, JSON.stringify(instance.awardedMeta || {})]
    );
    return { ok: true, status: 'refreshed', effectId: instance.effectId, instance, notice: buildEffectNotice(def, 'refreshed', instance) };
  }

  return {
    ok: false,
    status: 'rejected_existing_other',
    activeEffectId: String(current.effect_id),
    effectId: instance.effectId,
    instance,
    notice: buildEffectNotice(def, 'rejected_existing_other', instance),
  };
}

function pickWeighted(entries) {
  const valid = entries.filter((e) => Number(e.weight) > 0);
  if (!valid.length) return null;
  const total = valid.reduce((sum, e) => sum + Number(e.weight), 0);
  let roll = Math.random() * total;
  for (const entry of valid) {
    roll -= Number(entry.weight);
    if (roll <= 0) return entry;
  }
  return valid[valid.length - 1];
}

function listAllowedEffects(kind, activityEffects) {
  const cfg = normalizeActivityEffects(activityEffects);
  const blocklist = kind === 'blessing' ? cfg.blockedBlessings : cfg.blockedCurses;
  const weightsMap = kind === 'blessing' ? cfg.effectAwardPool.blessingWeights : cfg.effectAwardPool.curseWeights;

  return Object.values(definitions)
    .filter((def) => def.enabled !== false && def.type === kind)
    .filter((def) => !blocklist.includes(def.id))
    .map((def) => ({
      id: def.id,
      weight: Number(weightsMap[def.id] ?? def.defaultAwardWeight ?? 1),
    }))
    .filter((x) => x.weight > 0);
}

function pickWeightedEffect(activityEffects) {
  const cfg = normalizeActivityEffects(activityEffects);
  const category = pickWeighted([
    { kind: 'none', weight: cfg.effectAwardPool.nothingWeight },
    { kind: 'blessing', weight: cfg.effectAwardPool.blessingWeight },
    { kind: 'curse', weight: cfg.effectAwardPool.curseWeight },
  ]);
  if (!category || category.kind === 'none') return null;
  const pool = listAllowedEffects(category.kind, cfg);
  const chosen = pickWeighted(pool);
  return chosen ? chosen.id : null;
}

async function maybeAwardEffectFromActivity({ guildId, userId, activityEffects, source, award = {} }) {
  const cfg = normalizeActivityEffects(activityEffects);
  if (!cfg.canAwardEffects) return { ok: true, status: 'disabled' };
  const effectId = pickWeightedEffect(cfg);
  if (!effectId) return { ok: true, status: 'none' };
  return awardEffect(guildId, userId, effectId, { ...award, source });
}

async function previewMoneyEffect({ guildId, userId, activityEffects, amount }) {
  const baseAmount = Math.max(0, Math.floor(Number(amount || 0)));
  const cfg = normalizeActivityEffects(activityEffects);
  if (!cfg.effectsApply || baseAmount <= 0) {
    return { baseAmount, finalAmount: baseAmount, modifierAmount: 0, activeEffect: null };
  }

  const active = await getActiveEffect(guildId, userId);
  if (!active) {
    return { baseAmount, finalAmount: baseAmount, modifierAmount: 0, activeEffect: null };
  }
  if (String(active.target) !== 'money_reward') {
    return { baseAmount, finalAmount: baseAmount, modifierAmount: 0, activeEffect: null };
  }

  const mode = String(active.modifier_mode || 'percent');
  const value = Number(active.modifier_value || 0);
  let modifierAmount = 0;
  if (mode === 'flat') modifierAmount = Math.trunc(value);
  else modifierAmount = Math.floor(baseAmount * (value / 100));

  const finalAmount = Math.max(0, baseAmount + modifierAmount);
  return {
    baseAmount,
    finalAmount,
    modifierAmount,
    activeEffect: active,
    effectId: String(active.effect_id),
    effectType: String(active.effect_type),
    modifierMode: mode,
    modifierValue: value,
  };
}

async function consumeEffectUse(guildId, userId, activeEffect) {
  if (!activeEffect) return;
  await ensureSchema();
  const current = await getActiveEffect(guildId, userId);
  if (!current || String(current.effect_id) !== String(activeEffect.effect_id)) return;

  const nextUses = current.uses_remaining === null ? null : Number(current.uses_remaining) - 1;
  const expiredByTime = current.expires_at ? new Date(current.expires_at).getTime() <= Date.now() : false;
  const expiredByUses = nextUses !== null && nextUses <= 0;

  if (expiredByTime || expiredByUses) {
    await clearActiveEffect(guildId, userId);
    return;
  }

  if (current.uses_remaining !== null) {
    await pool.query(
      `UPDATE user_effects SET uses_remaining=$3, updated_at=NOW() WHERE guild_id=$1 AND user_id=$2`,
      [String(guildId), String(userId), nextUses]
    );
  }
}

async function handleTriggeredEffectEvent({ guildId, userId, eventKey, context = {} }) {
  const active = await getActiveEffect(guildId, userId);
  if (!active || String(active.target) !== 'trigger_event') return { triggered: false };

  const def = getDefinition(active.effect_id);
  if (!def || def.enabled === false) return { triggered: false };

  const awardedMeta = parseJsonMeta(active.awarded_meta);
  const triggers = Array.isArray(awardedMeta.triggers) ? awardedMeta.triggers : Array.isArray(def.triggers) ? def.triggers : [];
  if (!triggers.includes(String(eventKey))) return { triggered: false };

  if (String(active.modifier_mode) === 'jail_on_failure') {
    const jailMinutes = Number(awardedMeta.jailMinutes || def.defaultJailMinutes || active.modifier_value || 0);
    if (!Number.isFinite(jailMinutes) || jailMinutes <= 0) return { triggered: false };

    const jailedUntil = await setJail(guildId, userId, jailMinutes);
    await clearActiveEffect(guildId, userId);
    return {
      triggered: true,
      action: 'jail',
      jailMinutes,
      jailedUntil,
      effectId: String(active.effect_id),
      notice: buildEffectNotice(def, 'triggered', {
        effectId: String(active.effect_id),
        awardedMeta,
      }, {
        ...context,
        jailedUntil,
        jailMinutes,
      }),
    };
  }

  return { triggered: false };
}

async function creditUserWithEffects({ guildId, userId, amount, type, meta = {}, activityEffects, awardSource }) {
  const economy = require('./economy');
  const preview = await previewMoneyEffect({ guildId, userId, activityEffects, amount });

  if (preview.finalAmount > 0) {
    const baseToCredit = preview.modifierAmount > 0 ? preview.baseAmount : preview.finalAmount;
    if (baseToCredit > 0) {
      await economy.creditUser(guildId, userId, baseToCredit, type, { ...meta, effectApplied: !!preview.activeEffect, effectId: preview.effectId || null, effectAdjustment: preview.modifierAmount || 0 });
    }
    if (preview.modifierAmount > 0) {
      await economy.creditUser(guildId, userId, preview.modifierAmount, `${type}_effect_bonus`, { ...meta, effectBonusMinted: true, effectId: preview.effectId || null });
    }
  }

  if (preview.activeEffect) {
    await consumeEffectUse(guildId, userId, preview.activeEffect);
  }

  const awardResult = await maybeAwardEffectFromActivity({ guildId, userId, activityEffects, source: awardSource || type });
  return { ok: true, ...preview, awardResult };
}

async function bankPayoutWithEffects({ guildId, userId, amount, type, meta = {}, activityEffects, awardSource }) {
  const economy = require('./economy');
  const preview = await previewMoneyEffect({ guildId, userId, activityEffects, amount });
  const bankAmount = preview.modifierAmount > 0 ? preview.baseAmount : preview.finalAmount;
  let payoutResult = { ok: true };

  if (bankAmount > 0) {
    payoutResult = await economy.bankToUserIfEnough(guildId, userId, bankAmount, type, { ...meta, effectApplied: !!preview.activeEffect, effectId: preview.effectId || null, effectAdjustment: preview.modifierAmount || 0 });
    if (!payoutResult?.ok) {
      return { ok: false, ...preview, payoutResult, awardResult: { ok: true, status: 'skipped_payout_failed' } };
    }
  }

  if (preview.modifierAmount > 0) {
    await economy.creditUser(guildId, userId, preview.modifierAmount, `${type}_effect_bonus`, { ...meta, effectBonusMinted: true, effectId: preview.effectId || null });
  }

  if (preview.activeEffect) {
    await consumeEffectUse(guildId, userId, preview.activeEffect);
  }

  const awardResult = await maybeAwardEffectFromActivity({ guildId, userId, activityEffects, source: awardSource || type });
  return { ok: true, ...preview, payoutResult, awardResult };
}

module.exports = {
  DEFAULT_ACTIVITY_EFFECTS,
  normalizeActivityEffects,
  getActiveEffect,
  clearActiveEffect,
  awardEffect,
  pickWeightedEffect,
  maybeAwardEffectFromActivity,
  previewMoneyEffect,
  consumeEffectUse,
  handleTriggeredEffectEvent,
  creditUserWithEffects,
  bankPayoutWithEffects,
  buildEffectNotice,
  describeDuration,
};
