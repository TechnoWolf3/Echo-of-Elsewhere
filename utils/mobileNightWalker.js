const crypto = require("crypto");
const { pool } = require("./db");
const appLinking = require("./appLinking");
const { creditUserWithEffects } = require("./effectSystem");
const { recordProgress: recordContractProgress } = require("./contracts");
const standingService = require("./community/standing");
const nightWalker = require("../data/work/categories/nightwalker");

const SESSION_TTL_MS = 8 * 60 * 1000;
const JOB_KEYS = ["flirt", "lapDance", "prostitute"];
const JOB_ALIASES = {
  flirt: "flirt",
  lapdance: "lapDance",
  lap_dance: "lapDance",
  "lap-dance": "lapDance",
  prostitute: "prostitute",
};

let schemaReady = false;

function db() {
  if (!pool?.query) throw new Error("DATABASE_URL is not configured.");
  return pool;
}

function id() {
  return `nw_${crypto.randomBytes(12).toString("hex")}`;
}

function normalizeCtx(ctx) {
  return { ...ctx, userId: String(ctx.userId || ctx.discordUserId || "") };
}

function normalizeJobId(input) {
  const raw = String(input || "").trim();
  return JOB_ALIASES[raw] || JOB_ALIASES[raw.toLowerCase()] || raw;
}

function iso(value) {
  const date = value instanceof Date ? value : value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, Number(n) || 0));
}

function randInt(min, max) {
  const lo = Math.floor(Number(min) || 0);
  const hi = Math.floor(Number(max) || lo);
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

function sampleUnique(arr, n) {
  const copy = Array.isArray(arr) ? [...arr] : [];
  const out = [];
  while (copy.length && out.length < n) {
    out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
  }
  while (out.length < n && arr?.length) {
    out.push(arr[Math.floor(Math.random() * arr.length)]);
  }
  return out;
}

function xpToNext(level) {
  return 100 + (Math.max(1, Number(level) || 1) - 1) * 60;
}

function levelMultiplier(level) {
  const mult = 1 + 0.02 * (Math.max(1, Number(level) || 1) - 1);
  return Math.min(mult, 1.6);
}

function cooldownFor(jobId, cfg = {}) {
  const defaults = { flirt: 300, lapDance: 420, prostitute: 600 };
  return {
    key: `job:nw:${jobId}`,
    seconds: Number(cfg.cooldownSeconds ?? defaults[jobId] ?? 300),
  };
}

async function ensureSchema() {
  if (schemaReady) return;
  await appLinking.ensureSchema();
  await db().query(`
    CREATE TABLE IF NOT EXISTS cooldowns (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      key TEXT NOT NULL,
      next_claim_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (guild_id, user_id, key)
    );

    CREATE TABLE IF NOT EXISTS job_progress (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      xp INTEGER NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 1,
      total_jobs INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS nightwalker_sessions (
      id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      profile_id TEXT NULL,
      job_id TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'nightwalker',
      status TEXT NOT NULL DEFAULT 'active',
      state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      result_json JSONB NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      resolved_at TIMESTAMPTZ NULL
    );
    CREATE INDEX IF NOT EXISTS idx_nw_sessions_user_status ON nightwalker_sessions (guild_id, user_id, status);
    CREATE INDEX IF NOT EXISTS idx_nw_sessions_expires ON nightwalker_sessions (expires_at);
  `);
  schemaReady = true;
}

async function getJobProgress(guildId, userId) {
  await db().query(
    `INSERT INTO job_progress (guild_id, user_id, xp, level, total_jobs)
     VALUES ($1,$2,0,1,0)
     ON CONFLICT (guild_id, user_id) DO NOTHING`,
    [guildId, userId]
  );
  const res = await db().query(
    `SELECT xp, level, total_jobs FROM job_progress WHERE guild_id=$1 AND user_id=$2`,
    [guildId, userId]
  );
  const row = res.rows?.[0] || {};
  return {
    xp: Number(row.xp || 0),
    level: Number(row.level || 1),
    totalJobs: Number(row.total_jobs || 0),
  };
}

async function addXpAndMaybeLevel(guildId, userId, xpGain, countJob = true) {
  const progress = await getJobProgress(guildId, userId);
  let xp = Number(progress.xp || 0) + Math.max(0, Math.floor(Number(xpGain || 0)));
  let level = Number(progress.level || 1);
  let leveledUp = false;

  while (xp >= xpToNext(level)) {
    xp -= xpToNext(level);
    level += 1;
    leveledUp = true;
  }

  const totalJobs = Number(progress.totalJobs || 0) + (countJob ? 1 : 0);
  await db().query(
    `UPDATE job_progress SET xp=$1, level=$2, total_jobs=$3, updated_at=NOW() WHERE guild_id=$4 AND user_id=$5`,
    [xp, level, totalJobs, guildId, userId]
  );
  return { xp, level, totalJobs, leveledUp };
}

async function getCooldown(guildId, userId, key) {
  const res = await db().query(
    `SELECT next_claim_at FROM cooldowns WHERE guild_id=$1 AND user_id=$2 AND key=$3`,
    [guildId, userId, key]
  );
  const date = res.rows?.[0]?.next_claim_at ? new Date(res.rows[0].next_claim_at) : null;
  return date && date.getTime() > Date.now() ? date : null;
}

async function setCooldown(guildId, userId, key, seconds) {
  const next = new Date(Date.now() + Math.max(0, Number(seconds) || 0) * 1000);
  await db().query(
    `INSERT INTO cooldowns (guild_id, user_id, key, next_claim_at)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (guild_id, user_id, key)
     DO UPDATE SET next_claim_at=EXCLUDED.next_claim_at`,
    [guildId, userId, key, next]
  );
  return next;
}

async function cooldowns(ctx) {
  const out = {};
  for (const jobId of JOB_KEYS) {
    const cfg = nightWalker.jobs?.[jobId] || {};
    out[jobId] = iso(await getCooldown(ctx.guildId, ctx.userId, cooldownFor(jobId, cfg).key));
  }
  return out;
}

async function jailed(ctx) {
  const res = await db().query(
    `SELECT jailed_until FROM jail WHERE guild_id=$1 AND user_id=$2 AND jailed_until > NOW() LIMIT 1`,
    [ctx.guildId, ctx.userId]
  );
  return res.rows?.[0]?.jailed_until ? iso(res.rows[0].jailed_until) : null;
}

function publicChoice(choice, index) {
  return { index, label: String(choice?.label || `Option ${index + 1}`) };
}

function publicState(state, jobId, cfg) {
  return {
    wrongCount: Number(state.wrongCount || 0),
    wrongLimit: jobId === "flirt" ? Number(cfg.failOnWrongs || 2) : null,
    mistakes: Number(state.penaltyTokens || 0),
    mistakeLimit: jobId === "lapDance" ? Number(cfg.penalties?.failAt || 3) : null,
    risk: Number(state.risk || 0),
    riskLimit: jobId === "prostitute" && cfg.risk?.failAt ? Number(cfg.risk.failAt) : null,
    payoutModPct: Number(state.payoutModPct || 0),
  };
}

function renderSession(row, extra = {}) {
  const state = row.state_json || {};
  const jobId = row.job_id;
  const cfg = nightWalker.jobs?.[jobId] || {};
  const rounds = Number(cfg.rounds || state.rounds || 1);
  const roundIndex = Number(state.roundIndex || 0);
  const current = state.pickedScenarios?.[roundIndex] || null;
  const resolved = row.status !== "active";

  return {
    id: row.id,
    sessionId: row.id,
    jobId,
    status: row.status,
    result: row.result_json?.status || row.result_json?.result || null,
    title: cfg.title || jobId,
    round: resolved ? Math.min(rounds, roundIndex + 1) : roundIndex + 1,
    rounds,
    prompt: resolved ? null : current?.prompt || null,
    choices: resolved ? [] : (current?.choices || []).map(publicChoice),
    state: publicState(state, jobId, cfg),
    feedback: extra.feedback ?? state.feedback ?? null,
    message: extra.message ?? state.message ?? null,
    expiresAt: iso(row.expires_at),
  };
}

async function expireIfNeeded(row) {
  if (row.status === "active" && new Date(row.expires_at).getTime() <= Date.now()) {
    const res = await db().query(
      `UPDATE nightwalker_sessions
       SET status='expired', result_json=$2::jsonb, updated_at=NOW(), resolved_at=NOW()
       WHERE id=$1
       RETURNING *`,
      [row.id, JSON.stringify({ status: "expired", payout: 0, xpGained: 0 })]
    );
    return res.rows[0] || row;
  }
  return row;
}

async function loadSession(ctx, sessionId) {
  const res = await db().query(
    `SELECT * FROM nightwalker_sessions WHERE id=$1 AND guild_id=$2 AND user_id=$3`,
    [sessionId, ctx.guildId, ctx.userId]
  );
  const row = res.rows?.[0];
  if (!row) return { ok: false, statusCode: 404, message: "Night Walker session not found." };
  return { ok: true, row: await expireIfNeeded(row) };
}

async function updateSession(row, state, result = null, status = "active") {
  const res = await db().query(
    `UPDATE nightwalker_sessions
     SET status=$2,
         state_json=$3::jsonb,
         result_json=$4::jsonb,
         updated_at=NOW(),
         resolved_at=CASE WHEN $2 <> 'active' THEN NOW() ELSE resolved_at END
     WHERE id=$1
     RETURNING *`,
    [row.id, status, JSON.stringify(state), result ? JSON.stringify(result) : row.result_json ? JSON.stringify(row.result_json) : null]
  );
  return res.rows[0];
}

async function overview(ctx) {
  ctx = normalizeCtx(ctx);
  await ensureSchema();
  if (!ctx.userId) return { ok: false, statusCode: 400, message: "Linked Discord user is required." };

  const [progress, cds, profile, jailedUntil] = await Promise.all([
    getJobProgress(ctx.guildId, ctx.userId),
    cooldowns(ctx),
    appLinking.buildProfileSnapshot(ctx.profileId),
    jailed(ctx),
  ]);

  const now = Date.now();
  return {
    ok: true,
    body: {
      profile,
      progress: {
        ...progress,
        xpToNext: xpToNext(progress.level),
        levelBonusPct: Math.round((levelMultiplier(progress.level) - 1) * 100),
      },
      cooldowns: cds,
      jailed: Boolean(jailedUntil),
      jailedUntil,
      jobs: JOB_KEYS.map((jobId) => {
        const cfg = nightWalker.jobs?.[jobId] || {};
        const cd = cds[jobId] ? new Date(cds[jobId]).getTime() : 0;
        const available = !jailedUntil && (!cd || cd <= now);
        return {
          id: jobId,
          title: cfg.title || jobId,
          rounds: Number(cfg.rounds || 1),
          cooldownSeconds: Number(cooldownFor(jobId, cfg).seconds),
          payoutRange: [Number(cfg.payout?.min || cfg.basePayout?.min || 0), Number(cfg.payout?.max || cfg.basePayout?.max || 0)],
          xp: { success: Number(cfg.xp?.success || 0), fail: 0 },
          available,
          disabledReason: jailedUntil ? "jailed" : cd > now ? "cooldown" : null,
        };
      }),
    },
  };
}

async function start(ctx, jobIdRaw) {
  ctx = normalizeCtx(ctx);
  await ensureSchema();
  if (!ctx.userId) return { ok: false, statusCode: 400, message: "Linked Discord user is required." };

  const jobId = normalizeJobId(jobIdRaw);
  const cfg = nightWalker.jobs?.[jobId];
  if (!cfg || !JOB_KEYS.includes(jobId)) return { ok: false, statusCode: 404, message: "Night Walker job not found." };

  const jailUntil = await jailed(ctx);
  if (jailUntil) return { ok: false, statusCode: 403, message: "You cannot work Night Walker while jailed." };

  const cooldown = cooldownFor(jobId, cfg);
  const cd = await getCooldown(ctx.guildId, ctx.userId, cooldown.key);
  if (cd) return { ok: false, statusCode: 429, message: "That Night Walker job is on cooldown." };

  const active = await db().query(
    `SELECT id FROM nightwalker_sessions
     WHERE guild_id=$1 AND user_id=$2 AND status='active' AND expires_at > NOW()
     LIMIT 1`,
    [ctx.guildId, ctx.userId]
  );
  if (active.rows?.[0]) return { ok: false, statusCode: 409, message: "You already have an active Night Walker session." };

  const rounds = Number(cfg.rounds || 1);
  const state = {
    jobId,
    roundIndex: 0,
    pickedScenarios: sampleUnique(cfg.scenarios || [], rounds),
    wrongCount: 0,
    penaltyTokens: 0,
    risk: Number(cfg.risk?.start || 0),
    payoutModPct: 0,
    feedback: null,
    message: "Read the room.",
  };
  const sessionId = id();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const res = await db().query(
    `INSERT INTO nightwalker_sessions
       (id, guild_id, user_id, profile_id, job_id, category, status, state_json, expires_at)
     VALUES ($1,$2,$3,$4,$5,'nightwalker','active',$6::jsonb,$7)
     RETURNING *`,
    [sessionId, ctx.guildId, ctx.userId, ctx.profileId, jobId, JSON.stringify(state), expiresAt]
  );
  const row = res.rows[0];
  return {
    ok: true,
    body: {
      session: renderSession(row, { message: "Read the room." }),
      profile: await appLinking.buildProfileSnapshot(ctx.profileId),
    },
  };
}

async function getSession(ctx, sessionId) {
  ctx = normalizeCtx(ctx);
  await ensureSchema();
  const loaded = await loadSession(ctx, sessionId);
  if (!loaded.ok) return loaded;
  return {
    ok: true,
    body: {
      session: renderSession(loaded.row),
      profile: await appLinking.buildProfileSnapshot(ctx.profileId),
    },
  };
}

function applyChoiceEffects(jobId, state, cfg, choice) {
  if (jobId === "flirt") {
    const modifiers = cfg.modifiers || {};
    if (choice.tag === "wrong" || choice.correct === false) {
      state.wrongCount = Number(state.wrongCount || 0) + 1;
      state.payoutModPct -= Number(modifiers.wrongPenaltyPct || 0);
    } else if (choice.tag === "good") {
      state.payoutModPct += Number(modifiers.goodBonusPct || 0);
    } else {
      state.payoutModPct += Number(modifiers.neutralBonusPct || 0);
    }
  }

  if (jobId === "lapDance") {
    const penalties = cfg.penalties || {};
    if (choice.tag === "awkward" || choice.penalty) {
      state.penaltyTokens = Number(state.penaltyTokens || 0) + Number(choice.penalty || penalties.awkwardAdds || 1);
    } else if (choice.tag === "smooth") {
      state.penaltyTokens = Math.max(0, Number(state.penaltyTokens || 0) - Number(penalties.smoothRemoves || 0));
    }
  }

  if (jobId === "prostitute") {
    state.risk = clamp(Number(state.risk || 0) + Number(choice.riskDelta || 0), 0, 200);
  }

  if (jobId !== "flirt") {
    state.payoutModPct = clamp(Number(state.payoutModPct || 0) + Number(choice.payoutDeltaPct || 0), -80, 200);
  } else {
    state.payoutModPct = clamp(Number(state.payoutModPct || 0), -80, 200);
  }
}

function failureReason(jobId, state, cfg) {
  if (jobId === "flirt" && Number(state.wrongCount || 0) >= Number(cfg.failOnWrongs || 2)) {
    return "Too many wrong answers. No payout.";
  }
  if (jobId === "lapDance" && Number(state.penaltyTokens || 0) >= Number(cfg.penalties?.failAt || 3)) {
    return "You messed up too many times. No payout.";
  }
  if (jobId === "prostitute" && cfg.risk?.failAt && Number(state.risk || 0) >= Number(cfg.risk.failAt)) {
    return "Risk got too high. No payout.";
  }
  return null;
}

function getPreSettlementPayout(jobId, state, cfg) {
  const base = randInt(cfg.payout?.min ?? cfg.basePayout?.min ?? 1000, cfg.payout?.max ?? cfg.basePayout?.max ?? 2000);
  let multiplier = 1 + Number(state.payoutModPct || 0) / 100;
  let riskBonusPct = 0;

  if (jobId === "prostitute") {
    const risk = Math.max(0, Number(state.risk || 0));
    const variance = Math.max(0, Number(cfg.risk?.payoutVariancePct ?? 5));
    riskBonusPct = randInt(Math.max(0, Math.floor(risk - variance)), Math.ceil(risk + variance));
    multiplier = 1 + riskBonusPct / 100;
  }

  return {
    base,
    multiplier,
    riskBonusPct,
    amountBase: Math.max(0, Math.floor(base * multiplier)),
  };
}

async function settleLegalJob(ctx, jobId, state, cfg, amountBase) {
  const progress = await getJobProgress(ctx.guildId, ctx.userId);
  let amount = Math.floor(Number(amountBase || 0) * levelMultiplier(progress.level));
  let xpGain = Math.max(0, Math.floor(Number(cfg.xp?.success || 0)));
  const meta = {
    job: jobId,
    modPct: Math.round(Number(state.payoutModPct || 0)),
    risk: Number(state.risk || 0),
    source: "nightwalker",
    client: ctx.source || "app",
  };

  const standingRow = await standingService.getStanding(ctx.guildId, ctx.userId).catch(() => null);
  const modified = standingService.applyLegalJobModifiers(amount, xpGain, standingRow?.standing || 0);
  amount = modified.amount;
  xpGain = modified.xp;
  meta.standingModifierPct = modified.payoutPct;
  meta.standingXpModifierPct = modified.xpPct;

  const payout = await creditUserWithEffects({
    guildId: ctx.guildId,
    userId: ctx.userId,
    amount,
    type: `job_nw_${jobId}`,
    meta,
    activityEffects: cfg.activityEffects,
    awardSource: `job_nw_${jobId}`,
  });
  const finalPayout = Number(payout.finalAmount || amount || 0);

  await recordContractProgress({ guildId: ctx.guildId, userId: ctx.userId, metric: "job_earnings", amount: finalPayout }).catch(() => {});
  await recordContractProgress({ guildId: ctx.guildId, userId: ctx.userId, metric: "jobs_completed", amount: 1 }).catch(() => {});
  await standingService.adjustStanding({
    guildId: ctx.guildId,
    userId: ctx.userId,
    amount: 1,
    source: `job_nw_${jobId}`,
    reason: "legal_job_completion",
    metadata: meta,
  }).catch(() => {});

  const progressUpdate = await addXpAndMaybeLevel(ctx.guildId, ctx.userId, xpGain, true);
  return { finalPayout, xpGain, progressUpdate };
}

async function action(ctx, sessionId, body = {}) {
  ctx = normalizeCtx(ctx);
  await ensureSchema();
  if (!ctx.userId) return { ok: false, statusCode: 400, message: "Linked Discord user is required." };

  const loaded = await loadSession(ctx, sessionId);
  if (!loaded.ok) return loaded;
  let row = loaded.row;
  if (row.status !== "active") {
    return {
      ok: true,
      body: {
        session: renderSession(row),
        result: row.result_json || null,
        profile: await appLinking.buildProfileSnapshot(ctx.profileId),
        message: row.status === "expired" ? "Night Walker session expired." : "Night Walker session is no longer active.",
      },
    };
  }

  const jailUntil = await jailed(ctx);
  if (jailUntil) return { ok: false, statusCode: 403, message: "You cannot continue Night Walker while jailed." };

  const state = row.state_json || {};
  const jobId = row.job_id;
  const cfg = nightWalker.jobs?.[jobId];
  if (!cfg) return { ok: false, statusCode: 404, message: "Night Walker job not found." };

  const roundIndex = Number(state.roundIndex || 0);
  const scenario = state.pickedScenarios?.[roundIndex];
  const choiceIndex = Number(body.choiceIndex);
  const choice = scenario?.choices?.[choiceIndex];
  if (!choice || !Number.isInteger(choiceIndex)) {
    return { ok: false, statusCode: 400, message: "Choose a valid option." };
  }

  applyChoiceEffects(jobId, state, cfg, choice);
  state.feedback = choice.feedback || null;

  const cooldown = cooldownFor(jobId, cfg);
  const failure = failureReason(jobId, state, cfg);
  if (failure) {
    const cooldownUntil = await setCooldown(ctx.guildId, ctx.userId, cooldown.key, cooldown.seconds);
    state.message = failure;
    const result = {
      status: "failed",
      result: "failed",
      payout: 0,
      xpGained: 0,
      cooldownKey: cooldown.key,
      cooldownUntil: iso(cooldownUntil),
    };
    row = await updateSession(row, state, result, "resolved");
    return {
      ok: true,
      body: {
        session: renderSession(row, { message: failure, feedback: state.feedback }),
        result,
        profile: await appLinking.buildProfileSnapshot(ctx.profileId),
      },
    };
  }

  state.roundIndex = roundIndex + 1;
  if (state.roundIndex < Number(cfg.rounds || 1)) {
    state.message = "Next round.";
    row = await updateSession(row, state, null, "active");
    return {
      ok: true,
      body: {
        session: renderSession(row, { message: "Next round.", feedback: state.feedback }),
        profile: await appLinking.buildProfileSnapshot(ctx.profileId),
      },
    };
  }

  const payoutRoll = getPreSettlementPayout(jobId, state, cfg);
  const settlement = await settleLegalJob(ctx, jobId, state, cfg, payoutRoll.amountBase);
  const cooldownUntil = await setCooldown(ctx.guildId, ctx.userId, cooldown.key, cooldown.seconds);
  state.message = choice.feedback || "Night Walker complete.";
  const result = {
    status: "success",
    result: "success",
    basePayout: payoutRoll.base,
    preSettlementPayout: payoutRoll.amountBase,
    multiplier: payoutRoll.multiplier,
    riskBonusPct: payoutRoll.riskBonusPct,
    finalPayout: settlement.finalPayout,
    xpGained: settlement.xpGain,
    cooldownKey: cooldown.key,
    cooldownUntil: iso(cooldownUntil),
    leveledUp: Boolean(settlement.progressUpdate?.leveledUp),
    progress: settlement.progressUpdate,
  };
  row = await updateSession(row, state, result, "resolved");
  return {
    ok: true,
    body: {
      session: renderSession(row, { message: state.message, feedback: state.feedback }),
      result,
      profile: await appLinking.buildProfileSnapshot(ctx.profileId),
    },
  };
}

module.exports = {
  ensureSchema,
  overview,
  start,
  getSession,
  action,
};
