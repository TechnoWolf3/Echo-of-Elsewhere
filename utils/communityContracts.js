const { pool } = require("./db");
const economy = require("./economy");
const legacyContracts = require("./contracts");
const bondService = require("./community/bonds");
const standingService = require("./community/standing");
const data = require("../data/communityContracts");

let schemaReady = false;

function db() {
  return pool && typeof pool.query === "function" ? pool : null;
}

function clampInt(n, fallback = 0, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const value = Number(n);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function randInt(min, max) {
  const lo = clampInt(min, 0);
  const hi = clampInt(max, lo);
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

function toDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function phaseProgress(contract, definition) {
  const phases = definition?.phases || [];
  const index = clampInt(contract.phase_index, 0, 0, Math.max(0, phases.length - 1));
  const before = phases.slice(0, index).reduce((sum, phase) => sum + clampInt(phase.requiredProgress, 0), 0);
  const currentRequired = clampInt(phases[index]?.requiredProgress, 1, 1);
  return {
    index,
    current: Math.max(0, Math.min(currentRequired, clampInt(contract.total_progress, 0) - before)),
    required: currentRequired,
  };
}

function currentPhase(definition, index) {
  const phases = definition?.phases || [];
  return phases[clampInt(index, 0, 0, Math.max(0, phases.length - 1))] || phases[0] || null;
}

function availableTasks(definition, phaseIndex) {
  const phase = currentPhase(definition, phaseIndex);
  if (!phase) return [];
  return (definition.tasks || []).filter((task) => {
    const allowed = Array.isArray(task.allowedPhaseKeys) ? task.allowedPhaseKeys : [];
    return !allowed.length || allowed.includes(phase.key);
  });
}

function getHelperMultiplier(taskStartedAt, originalDurationMs, joinedAt = new Date()) {
  const started = toDate(taskStartedAt).getTime();
  const joined = toDate(joinedAt).getTime();
  const duration = Math.max(1, Number(originalDurationMs) || 1);
  const elapsedMs = Math.max(0, joined - started);
  if (elapsedMs <= data.config.HELPER_GRACE_MS) return 1;
  const remainingRatio = Math.max(0, (duration - elapsedMs) / duration);
  return Math.max(0.02, remainingRatio);
}

function calculateReductionMs({ helperCount, originalDurationMs, remainingMs, currentReductionMs }) {
  const step = data.config.HELPER_REDUCTION_STEPS[Math.min(helperCount, data.config.HELPER_REDUCTION_STEPS.length - 1)] || 0.05;
  const original = Math.max(1, Number(originalDurationMs) || 1);
  const capMs = Math.floor(original * data.config.MAX_TOTAL_REDUCTION);
  const leftCap = Math.max(0, capMs - Math.max(0, Number(currentReductionMs) || 0));
  const reduction = Math.floor(Math.max(0, Number(remainingMs) || 0) * step);
  return Math.max(0, Math.min(reduction, leftCap));
}

async function ensureSchema() {
  const database = db();
  if (!database || schemaReady) return Boolean(database);
  await database.query(`
    CREATE TABLE IF NOT EXISTS community_job_settings (
      guild_id TEXT PRIMARY KEY,
      auto_generate BOOLEAN NOT NULL DEFAULT TRUE,
      events_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS community_job_contracts (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      contract_key TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      size TEXT NOT NULL,
      visual_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      phase_index INTEGER NOT NULL DEFAULT 0,
      total_required INTEGER NOT NULL,
      total_progress INTEGER NOT NULL DEFAULT 0,
      payout_pool BIGINT NOT NULL DEFAULT 0,
      standing_reward INTEGER DEFAULT 0,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      config JSONB NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE INDEX IF NOT EXISTS idx_cjc_guild_status ON community_job_contracts(guild_id, status);

    CREATE TABLE IF NOT EXISTS community_job_contributions (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      contract_id BIGINT NOT NULL REFERENCES community_job_contracts(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      contribution INTEGER NOT NULL DEFAULT 0,
      actions_completed INTEGER NOT NULL DEFAULT 0,
      helper_actions_completed INTEGER NOT NULL DEFAULT 0,
      lead_actions_completed INTEGER NOT NULL DEFAULT 0,
      paid_at TIMESTAMPTZ,
      last_action_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(guild_id, contract_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_cjcon_contract ON community_job_contributions(guild_id, contract_id);

    CREATE TABLE IF NOT EXISTS community_job_tasks (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      contract_id BIGINT NOT NULL REFERENCES community_job_contracts(id) ON DELETE CASCADE,
      task_key TEXT NOT NULL,
      task_label TEXT NOT NULL,
      phase_index INTEGER NOT NULL,
      lead_user_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      original_duration_ms BIGINT NOT NULL,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      original_finish_at TIMESTAMPTZ NOT NULL,
      current_finish_at TIMESTAMPTZ NOT NULL,
      completed_at TIMESTAMPTZ,
      collected_at TIMESTAMPTZ,
      min_progress INTEGER NOT NULL,
      max_progress INTEGER NOT NULL,
      final_progress INTEGER,
      max_helpers INTEGER DEFAULT 0,
      assistable BOOLEAN DEFAULT FALSE,
      total_reduction_ms BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_cjt_status ON community_job_tasks(guild_id, contract_id, status);

    CREATE TABLE IF NOT EXISTS community_job_task_helpers (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      contract_id BIGINT NOT NULL REFERENCES community_job_contracts(id) ON DELETE CASCADE,
      task_id BIGINT NOT NULL REFERENCES community_job_tasks(id) ON DELETE CASCADE,
      helper_user_id TEXT NOT NULL,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      multiplier NUMERIC NOT NULL DEFAULT 1,
      estimated_contribution INTEGER NOT NULL DEFAULT 0,
      final_contribution INTEGER,
      reduction_ms BIGINT NOT NULL DEFAULT 0,
      bond_xp_estimate INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(guild_id, task_id, helper_user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_cjth_task ON community_job_task_helpers(guild_id, task_id);

    CREATE TABLE IF NOT EXISTS community_job_history (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      contract_key TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      size TEXT NOT NULL,
      completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      total_contributors INTEGER DEFAULT 0,
      top_user_id TEXT,
      second_user_id TEXT,
      payout_pool BIGINT DEFAULT 0,
      total_progress INTEGER DEFAULT 0,
      result_text TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_cjh_guild_completed ON community_job_history(guild_id, completed_at);

    CREATE TABLE IF NOT EXISTS community_job_events (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      contract_id BIGINT NOT NULL REFERENCES community_job_contracts(id) ON DELETE CASCADE,
      event_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      effect_json JSONB,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at TIMESTAMPTZ
    );
  `);
  schemaReady = true;
  return true;
}

async function getSettings(guildId) {
  await ensureSchema();
  const database = db();
  if (!database) return { autoGenerate: true, eventsEnabled: true };
  const res = await database.query(
    `INSERT INTO community_job_settings (guild_id)
     VALUES ($1)
     ON CONFLICT (guild_id) DO UPDATE SET updated_at=community_job_settings.updated_at
     RETURNING *`,
    [String(guildId)]
  );
  const row = res.rows?.[0] || {};
  return {
    autoGenerate: row.auto_generate !== false,
    eventsEnabled: row.events_enabled !== false,
  };
}

async function updateSettings(guildId, patch = {}) {
  const current = await getSettings(guildId);
  const next = { ...current, ...patch };
  const res = await pool.query(
    `UPDATE community_job_settings
     SET auto_generate=$2, events_enabled=$3, updated_at=NOW()
     WHERE guild_id=$1
     RETURNING *`,
    [String(guildId), !!next.autoGenerate, !!next.eventsEnabled]
  );
  const row = res.rows?.[0] || {};
  return { autoGenerate: row.auto_generate !== false, eventsEnabled: row.events_enabled !== false };
}

async function getActiveContract(guildId) {
  await ensureSchema();
  const res = await pool.query(
    `SELECT * FROM community_job_contracts
     WHERE guild_id=$1 AND status='active'
     ORDER BY id DESC LIMIT 1`,
    [String(guildId)]
  );
  return res.rows?.[0] || null;
}

async function syncActiveContractDefinition(contract) {
  if (!contract || contract.status !== "active") return contract;
  const definition = data.getContract(contract.contract_key);
  if (!definition) return contract;

  const payoutPool = clampInt(definition.payoutPool, 0, 0);
  const standingReward = clampInt(definition.standingReward, 0, 0);
  const currentPool = clampInt(contract.payout_pool, 0, 0);
  const currentStanding = clampInt(contract.standing_reward, 0, 0);
  if (payoutPool <= currentPool && standingReward <= currentStanding) return contract;

  const res = await pool.query(
    `UPDATE community_job_contracts
     SET payout_pool=GREATEST(payout_pool, $2),
         standing_reward=GREATEST(COALESCE(standing_reward, 0), $3),
         updated_at=NOW()
     WHERE id=$1
     RETURNING *`,
    [Number(contract.id), payoutPool, standingReward]
  );
  return res.rows?.[0] || contract;
}

async function createContract(guildId, { key = null, size = null, category = null, emergency = false } = {}) {
  await ensureSchema();
  const existing = await getActiveContract(guildId);
  if (existing) return { ok: false, reason: "already_active", contract: existing };
  const pick = key ? data.getContract(key) : data.pickContract({ size: emergency ? "emergency" : size, category });
  if (!pick) return { ok: false, reason: "definition_missing" };
  const res = await pool.query(
    `INSERT INTO community_job_contracts
       (guild_id, contract_key, name, category, size, visual_type, total_required, payout_pool, standing_reward, config)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      String(guildId),
      pick.key,
      pick.name,
      pick.category,
      pick.size,
      pick.visualType,
      clampInt(pick.totalRequiredProgress, 1, 1),
      clampInt(pick.payoutPool, 0, 0),
      clampInt(pick.standingReward, 0, 0),
      { recommendedPlayers: pick.recommendedPlayers || "", bondRewardBase: pick.bondRewardBase || 0 },
    ]
  );
  return { ok: true, contract: res.rows[0], definition: pick };
}

async function ensureActiveContract(guildId) {
  const active = await getActiveContract(guildId);
  if (active) return syncActiveContractDefinition(active);
  const settings = await getSettings(guildId);
  if (!settings.autoGenerate) return null;
  const created = await createContract(guildId);
  return created.contract || null;
}

async function getContributors(contractId, limit = 10) {
  await ensureSchema();
  const res = await pool.query(
    `SELECT *, RANK() OVER (ORDER BY contribution DESC, updated_at ASC) AS rank
     FROM community_job_contributions
     WHERE contract_id=$1
     ORDER BY contribution DESC, updated_at ASC
     LIMIT $2`,
    [Number(contractId), clampInt(limit, 10, 1, 25)]
  );
  return res.rows || [];
}

async function getUserContribution(guildId, contractId, userId) {
  await ensureSchema();
  const res = await pool.query(
    `SELECT *, RANK() OVER (ORDER BY contribution DESC, updated_at ASC) AS rank
     FROM community_job_contributions
     WHERE guild_id=$1 AND contract_id=$2 AND contribution > 0`,
    [String(guildId), Number(contractId)]
  );
  return (res.rows || []).find((row) => String(row.user_id) === String(userId)) || null;
}

async function getActiveTasks(guildId, contractId) {
  await ensureSchema();
  const res = await pool.query(
    `SELECT t.*,
       COALESCE(COUNT(h.id), 0)::int AS helper_count
     FROM community_job_tasks t
     LEFT JOIN community_job_task_helpers h ON h.task_id=t.id
     WHERE t.guild_id=$1 AND t.contract_id=$2 AND t.status='active'
     GROUP BY t.id
     ORDER BY t.current_finish_at ASC, t.id ASC`,
    [String(guildId), Number(contractId)]
  );
  return res.rows || [];
}

async function getUserActiveLeadTask(guildId, contractId, userId) {
  const res = await pool.query(
    `SELECT * FROM community_job_tasks
     WHERE guild_id=$1 AND contract_id=$2 AND lead_user_id=$3 AND status='active'
     ORDER BY id DESC LIMIT 1`,
    [String(guildId), Number(contractId), String(userId)]
  );
  return res.rows?.[0] || null;
}

async function getUserReadyLeadTasks(guildId, contractId, userId) {
  const res = await pool.query(
    `SELECT * FROM community_job_tasks
     WHERE guild_id=$1 AND contract_id=$2 AND lead_user_id=$3
       AND status='active' AND current_finish_at <= NOW()
     ORDER BY current_finish_at ASC`,
    [String(guildId), Number(contractId), String(userId)]
  );
  return res.rows || [];
}

async function startTask({ guildId, userId, taskKey }) {
  const contract = await ensureActiveContract(guildId);
  if (!contract) return { ok: false, reason: "no_active_contract" };
  const definition = data.getContract(contract.contract_key);
  if (!definition) return { ok: false, reason: "definition_missing" };
  const activeLead = await getUserActiveLeadTask(guildId, contract.id, userId);
  if (activeLead) return { ok: false, reason: "already_active", task: activeLead };
  const task = availableTasks(definition, contract.phase_index).find((entry) => entry.key === taskKey);
  if (!task) return { ok: false, reason: "task_unavailable" };
  const now = new Date();
  const events = await getActiveEvents(guildId, contract.id);
  const durationMs = Math.max(
    60 * 1000,
    Math.floor(clampInt(task.durationMs, 10 * 60 * 1000, 60 * 1000) * eventMultiplier(events, "durationMultiplier", 1))
  );
  const finish = new Date(now.getTime() + durationMs);
  const res = await pool.query(
    `INSERT INTO community_job_tasks
       (guild_id, contract_id, task_key, task_label, phase_index, lead_user_id,
        original_duration_ms, started_at, original_finish_at, current_finish_at,
        min_progress, max_progress, max_helpers, assistable)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [
      String(guildId),
      Number(contract.id),
      task.key,
      task.label,
      clampInt(contract.phase_index, 0),
      String(userId),
      durationMs,
      now,
      finish,
      finish,
      clampInt(task.minProgress, 1, 1),
      clampInt(task.maxProgress, task.minProgress || 1, 1),
      clampInt(task.maxHelpers, 0, 0),
      !!task.assistable,
    ]
  );
  return { ok: true, contract, definition, task: res.rows[0], taskDefinition: task };
}

async function listAssistableTasks(guildId, contractId, userId) {
  const tasks = await getActiveTasks(guildId, contractId);
  const now = Date.now();
  const out = [];
  for (const task of tasks) {
    if (!task.assistable) continue;
    if (String(task.lead_user_id) === String(userId)) continue;
    const remaining = toDate(task.current_finish_at).getTime() - now;
    if (remaining < data.config.MIN_HELP_REMAINING_MS) continue;
    if (Number(task.helper_count || 0) >= Number(task.max_helpers || 0)) continue;
    const existing = await pool.query(
      `SELECT 1 FROM community_job_task_helpers WHERE guild_id=$1 AND task_id=$2 AND helper_user_id=$3 LIMIT 1`,
      [String(guildId), Number(task.id), String(userId)]
    );
    if (existing.rowCount > 0) continue;
    out.push(task);
  }
  return out;
}

async function estimateHelp({ guildId, userId, taskId }) {
  const res = await pool.query(
    `SELECT t.*,
       COALESCE(COUNT(h.id), 0)::int AS helper_count
     FROM community_job_tasks t
     LEFT JOIN community_job_task_helpers h ON h.task_id=t.id
     WHERE t.guild_id=$1 AND t.id=$2 AND t.status='active'
     GROUP BY t.id`,
    [String(guildId), Number(taskId)]
  );
  const task = res.rows?.[0] || null;
  if (!task) return { ok: false, reason: "task_missing" };
  if (String(task.lead_user_id) === String(userId)) return { ok: false, reason: "own_task" };
  if (!task.assistable) return { ok: false, reason: "not_assistable" };
  if (Number(task.helper_count || 0) >= Number(task.max_helpers || 0)) return { ok: false, reason: "full" };
  const remainingMs = toDate(task.current_finish_at).getTime() - Date.now();
  if (remainingMs < data.config.MIN_HELP_REMAINING_MS) return { ok: false, reason: "too_late" };
  const dup = await pool.query(
    `SELECT 1 FROM community_job_task_helpers WHERE guild_id=$1 AND task_id=$2 AND helper_user_id=$3 LIMIT 1`,
    [String(guildId), Number(task.id), String(userId)]
  );
  if (dup.rowCount > 0) return { ok: false, reason: "duplicate" };
  const commitments = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM community_job_task_helpers h
     JOIN community_job_tasks t ON t.id=h.task_id
     WHERE h.guild_id=$1 AND h.contract_id=$2 AND h.helper_user_id=$3 AND t.status='active'`,
    [String(guildId), Number(task.contract_id), String(userId)]
  );
  if (Number(commitments.rows?.[0]?.count || 0) >= data.config.MAX_HELPER_COMMITMENTS) {
    return { ok: false, reason: "helper_limit" };
  }
  const definition = data.getContract((await getActiveContract(guildId))?.contract_key);
  const taskDef = definition?.tasks?.find((entry) => entry.key === task.task_key) || {};
  const multiplier = getHelperMultiplier(task.started_at, task.original_duration_ms, new Date());
  const estimatedContribution = Math.max(1, Math.floor(clampInt(taskDef.helperBaseContribution, 50, 1) * multiplier));
  const reductionMs = calculateReductionMs({
    helperCount: Number(task.helper_count || 0),
    originalDurationMs: task.original_duration_ms,
    remainingMs,
    currentReductionMs: task.total_reduction_ms,
  });
  const bondXpEstimate = Math.max(0, Math.floor(clampInt(definition?.bondRewardBase, 35, 0) * multiplier));
  return { ok: true, task, taskDefinition: taskDef, multiplier, estimatedContribution, reductionMs, bondXpEstimate, remainingMs };
}

async function joinHelp({ guildId, userId, taskId }) {
  const estimate = await estimateHelp({ guildId, userId, taskId });
  if (!estimate.ok) return estimate;
  const task = estimate.task;
  const newFinish = new Date(Math.max(Date.now(), toDate(task.current_finish_at).getTime() - estimate.reductionMs));
  try {
    const res = await pool.query(
      `INSERT INTO community_job_task_helpers
         (guild_id, contract_id, task_id, helper_user_id, multiplier, estimated_contribution, reduction_ms, bond_xp_estimate)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        String(guildId),
        Number(task.contract_id),
        Number(task.id),
        String(userId),
        estimate.multiplier,
        estimate.estimatedContribution,
        estimate.reductionMs,
        estimate.bondXpEstimate,
      ]
    );
    await pool.query(
      `UPDATE community_job_tasks
       SET current_finish_at=$2, total_reduction_ms=total_reduction_ms+$3, updated_at=NOW()
       WHERE id=$1`,
      [Number(task.id), newFinish, estimate.reductionMs]
    );
    return { ok: true, helper: res.rows[0], ...estimate, newFinish };
  } catch (error) {
    if (String(error?.code) === "23505") return { ok: false, reason: "duplicate" };
    throw error;
  }
}

function taskOutcome() {
  const roll = Math.random();
  if (roll < 0.12) return { label: "Great Success", multiplier: 1.18 };
  if (roll < 0.78) return { label: "Success", multiplier: 1 };
  if (roll < 0.94) return { label: "Minor Issue", multiplier: 0.82 };
  return { label: "Poor Result", multiplier: 0.60 };
}

async function getActiveEvents(guildId, contractId) {
  await ensureSchema();
  await pool.query(
    `UPDATE community_job_events
     SET status='expired', resolved_at=NOW()
     WHERE guild_id=$1 AND contract_id=$2 AND status='active' AND expires_at IS NOT NULL AND expires_at <= NOW()`,
    [String(guildId), Number(contractId)]
  );
  const res = await pool.query(
    `SELECT * FROM community_job_events
     WHERE guild_id=$1 AND contract_id=$2 AND status='active'
     ORDER BY created_at DESC`,
    [String(guildId), Number(contractId)]
  );
  return res.rows || [];
}

async function maybeSpawnEvent(guildId, contractId) {
  const settings = await getSettings(guildId);
  if (!settings.eventsEnabled) return [];
  const active = await getActiveEvents(guildId, contractId);
  if (active.length) return active;
  if (Math.random() >= data.config.DEFAULT_EVENT_CHANCE) return active;
  const options = [
    {
      key: "volunteer_crew",
      effect: {
        title: "Volunteer Crew Arrived",
        description: "Local volunteers are making fresh tasks finish 10% faster for a while.",
        durationMultiplier: 0.9,
      },
    },
    {
      key: "perfect_conditions",
      effect: {
        title: "Perfect Working Conditions",
        description: "Weather, tools, and morale are briefly cooperating. Completed tasks add 12% more progress.",
        progressMultiplier: 1.12,
      },
    },
  ];
  const event = options[Math.floor(Math.random() * options.length)];
  await pool.query(
    `INSERT INTO community_job_events (guild_id, contract_id, event_key, effect_json, expires_at)
     VALUES ($1,$2,$3,$4,NOW()+($5::bigint * INTERVAL '1 millisecond'))`,
    [String(guildId), Number(contractId), event.key, event.effect, data.config.EVENT_DURATION_MS]
  );
  return getActiveEvents(guildId, contractId);
}

function eventMultiplier(events, key, fallback = 1) {
  return (events || []).reduce((value, event) => {
    const effect = event.effect_json || {};
    const raw = Number(effect[key]);
    return Number.isFinite(raw) && raw > 0 ? value * raw : value;
  }, fallback);
}

async function addContribution({ guildId, contractId, userId, amount, role }) {
  const lead = role === "lead" ? 1 : 0;
  const helper = role === "helper" ? 1 : 0;
  await pool.query(
    `INSERT INTO community_job_contributions
       (guild_id, contract_id, user_id, contribution, actions_completed, lead_actions_completed, helper_actions_completed, last_action_at, updated_at)
     VALUES ($1,$2,$3,$4,1,$5,$6,NOW(),NOW())
     ON CONFLICT (guild_id, contract_id, user_id)
     DO UPDATE SET contribution=community_job_contributions.contribution+EXCLUDED.contribution,
                   actions_completed=community_job_contributions.actions_completed+1,
                   lead_actions_completed=community_job_contributions.lead_actions_completed+$5,
                   helper_actions_completed=community_job_contributions.helper_actions_completed+$6,
                   last_action_at=NOW(),
                   updated_at=NOW()`,
    [String(guildId), Number(contractId), String(userId), clampInt(amount, 0, 0), lead, helper]
  );
}

async function recordLegacyProgress({ guildId, userId, amount, role }) {
  const progress = clampInt(amount, 0, 0);
  if (!guildId || !userId || progress <= 0) return;
  await legacyContracts.recordProgress({ guildId, userId, metric: "community_work_progress", amount: progress }).catch(() => {});
  await legacyContracts.recordProgress({ guildId, userId, metric: "community_work_actions", amount: 1 }).catch(() => {});
  if (role === "helper") {
    await legacyContracts.recordProgress({ guildId, userId, metric: "community_work_helped", amount: 1 }).catch(() => {});
  }
}

async function advancePhaseIfNeeded(contractId) {
  const res = await pool.query(`SELECT * FROM community_job_contracts WHERE id=$1`, [Number(contractId)]);
  const contract = res.rows?.[0] || null;
  if (!contract) return null;
  const definition = data.getContract(contract.contract_key);
  if (!definition) return contract;
  let phaseIndex = clampInt(contract.phase_index, 0);
  let cursor = 0;
  const progress = clampInt(contract.total_progress, 0);
  for (let i = 0; i < definition.phases.length; i++) {
    cursor += clampInt(definition.phases[i].requiredProgress, 0);
    if (progress < cursor) {
      phaseIndex = i;
      break;
    }
    if (i === definition.phases.length - 1) phaseIndex = i;
  }
  if (phaseIndex !== Number(contract.phase_index || 0)) {
    const updated = await pool.query(
      `UPDATE community_job_contracts SET phase_index=$2, updated_at=NOW() WHERE id=$1 RETURNING *`,
      [Number(contractId), phaseIndex]
    );
    return updated.rows?.[0] || contract;
  }
  return contract;
}

async function completeContractIfReady(guildId, contractId) {
  const res = await pool.query(`SELECT * FROM community_job_contracts WHERE id=$1 FOR UPDATE`, [Number(contractId)]);
  const contract = res.rows?.[0] || null;
  if (!contract || contract.status !== "active") return { completed: false, contract };
  if (Number(contract.total_progress || 0) < Number(contract.total_required || 1)) return { completed: false, contract };
  const definition = data.getContract(contract.contract_key);
  const contributors = await getContributors(contract.id, 100);
  const totalContribution = contributors.reduce((sum, row) => sum + Number(row.contribution || 0), 0);
  const meaningful = contributors.filter((row) => {
    const share = totalContribution > 0 ? Number(row.contribution || 0) / totalContribution : 0;
    return share >= data.config.MIN_MEANINGFUL_SHARE;
  });

  const payoutSummary = [];
  for (let i = 0; i < contributors.length; i++) {
    const row = contributors[i];
    if (Number(row.paid_at ? 1 : 0)) continue;
    const shareOfRequired = Number(row.contribution || 0) / Math.max(1, Number(contract.total_required || 1));
    if (shareOfRequired < data.config.MIN_PAYOUT_SHARE) continue;
    const base = Math.floor(Number(contract.payout_pool || 0) * (Number(row.contribution || 0) / Math.max(1, totalContribution)));
    const bonus = i === 0 ? data.config.TOP_ONE_BONUS : i === 1 ? data.config.TOP_TWO_BONUS : 0;
    const payout = Math.max(0, Math.floor(base * (1 + bonus)));
    if (payout > 0) {
      await economy.creditUser(String(guildId), String(row.user_id), payout, "community_contract_payout", {
        contractId: Number(contract.id),
        contractKey: contract.contract_key,
        contribution: Number(row.contribution || 0),
        rank: i + 1,
      }).catch(() => {});
      payoutSummary.push({ userId: String(row.user_id), payout, rank: i + 1 });
    }
    await pool.query(`UPDATE community_job_contributions SET paid_at=NOW(), updated_at=NOW() WHERE id=$1`, [Number(row.id)]);
  }

  const standingBase = clampInt(contract.standing_reward, 0, 0);
  for (const row of meaningful) {
    const rankBonus = contributors[0]?.user_id === row.user_id || contributors[1]?.user_id === row.user_id ? 1.1 : 1;
    await standingService.adjustStanding({
      guildId,
      userId: String(row.user_id),
      amount: Math.max(1, Math.floor(standingBase * rankBonus)),
      source: "community_contract",
      reason: "meaningful_contribution",
      metadata: { contractId: Number(contract.id), contractKey: contract.contract_key },
    }).catch(() => {});
  }

  if (meaningful.length >= 2) {
    await bondService.awardBondXp({
      guildId,
      userIds: meaningful.map((row) => String(row.user_id)),
      amount: Math.max(1, Math.floor(clampInt(definition?.bondRewardBase, 35) / 2)),
      source: "community_contract",
      activityType: "community",
      reason: "shared_contract_completion",
      metadata: { contractId: Number(contract.id), contractKey: contract.contract_key },
    }).catch(() => {});
  }
  if (contributors[0]?.user_id && contributors[1]?.user_id) {
    await bondService.awardBondXp({
      guildId,
      userIds: [String(contributors[0].user_id), String(contributors[1].user_id)],
      amount: clampInt(definition?.bondRewardBase, 35),
      source: "community_contract",
      activityType: "community",
      reason: "top_contributors",
      metadata: { contractId: Number(contract.id), contractKey: contract.contract_key },
    }).catch(() => {});
  }

  await pool.query(
    `UPDATE community_job_contracts
     SET status='completed', completed_at=NOW(), total_progress=GREATEST(total_progress, total_required), updated_at=NOW()
     WHERE id=$1`,
    [Number(contract.id)]
  );
  await pool.query(
    `INSERT INTO community_job_history
       (guild_id, contract_key, name, category, size, total_contributors, top_user_id, second_user_id, payout_pool, total_progress, result_text)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      String(guildId),
      contract.contract_key,
      contract.name,
      contract.category,
      contract.size,
      contributors.length,
      contributors[0]?.user_id || null,
      contributors[1]?.user_id || null,
      Number(contract.payout_pool || 0),
      Number(contract.total_progress || 0),
      definition?.resultText || "",
    ]
  );
  return {
    completed: true,
    contract: { ...contract, status: "completed" },
    definition,
    contributors,
    payoutSummary,
    meaningfulCount: meaningful.length,
  };
}

async function collectReadyTasks({ guildId, userId }) {
  const contract = await getActiveContract(guildId);
  if (!contract) return { ok: false, reason: "no_active_contract" };
  const tasks = await getUserReadyLeadTasks(guildId, contract.id, userId);
  if (!tasks.length) {
    const active = await getUserActiveLeadTask(guildId, contract.id, userId);
    return { ok: false, reason: active ? "not_ready" : "no_ready_tasks", task: active, contract };
  }
  const results = [];
  let completed = null;
  const activeEvents = await getActiveEvents(guildId, contract.id);
  const progressEventMultiplier = eventMultiplier(activeEvents, "progressMultiplier", 1);
  for (const task of tasks) {
    const outcome = taskOutcome();
    const leadProgress = Math.max(1, Math.floor(randInt(task.min_progress, task.max_progress) * outcome.multiplier * progressEventMultiplier));
    const helpers = await pool.query(
      `SELECT * FROM community_job_task_helpers WHERE task_id=$1 ORDER BY joined_at ASC`,
      [Number(task.id)]
    );
    let helperTotal = 0;
    for (const helper of helpers.rows || []) {
      const finalContribution = Math.max(1, Math.floor(Number(helper.estimated_contribution || 0) * outcome.multiplier * progressEventMultiplier));
      helperTotal += finalContribution;
      await addContribution({ guildId, contractId: contract.id, userId: helper.helper_user_id, amount: finalContribution, role: "helper" });
      await recordLegacyProgress({ guildId, userId: helper.helper_user_id, amount: finalContribution, role: "helper" });
      await pool.query(
        `UPDATE community_job_task_helpers SET final_contribution=$2 WHERE id=$1`,
        [Number(helper.id), finalContribution]
      );
      const bondXp = Math.max(0, Math.floor(Number(helper.bond_xp_estimate || 0) * outcome.multiplier));
      if (bondXp > 0) {
        await bondService.awardBondXp({
          guildId,
          userIds: [String(task.lead_user_id), String(helper.helper_user_id)],
          amount: bondXp,
          source: "community_contract_task",
          activityType: "community",
          reason: "task_helper",
          metadata: { taskId: Number(task.id), contractId: Number(contract.id), multiplier: Number(helper.multiplier || 0) },
        }).catch(() => {});
      }
    }
    const totalAdded = leadProgress + helperTotal;
    await addContribution({ guildId, contractId: contract.id, userId, amount: leadProgress, role: "lead" });
    await recordLegacyProgress({ guildId, userId, amount: leadProgress, role: "lead" });
    await pool.query(
      `UPDATE community_job_tasks
       SET status='collected', completed_at=NOW(), collected_at=NOW(), final_progress=$2, updated_at=NOW()
       WHERE id=$1 AND status='active'`,
      [Number(task.id), totalAdded]
    );
    await pool.query(
      `UPDATE community_job_contracts
       SET total_progress=LEAST(total_required, total_progress+$2), updated_at=NOW()
       WHERE id=$1`,
      [Number(contract.id), totalAdded]
    );
    results.push({ task, outcome, leadProgress, helperTotal, totalAdded, helpers: helpers.rows || [] });
  }
  const advanced = await advancePhaseIfNeeded(contract.id);
  completed = await completeContractIfReady(guildId, contract.id);
  return { ok: true, contract: advanced || contract, results, completion: completed };
}

async function snapshot(guildId, userId) {
  const contract = await ensureActiveContract(guildId);
  if (!contract) return { contract: null };
  const events = await maybeSpawnEvent(guildId, contract.id);
  const definition = data.getContract(contract.contract_key);
  const contributors = await getContributors(contract.id, 10);
  const userContribution = await getUserContribution(guildId, contract.id, userId);
  const activeTasks = await getActiveTasks(guildId, contract.id);
  const assistableTasks = await listAssistableTasks(guildId, contract.id, userId);
  const readyTasks = await getUserReadyLeadTasks(guildId, contract.id, userId);
  const leadTask = await getUserActiveLeadTask(guildId, contract.id, userId);
  return {
    contract,
    definition,
    phase: currentPhase(definition, contract.phase_index),
    phaseProgress: phaseProgress(contract, definition),
    contributors,
    userContribution,
    activeTasks,
    assistableTasks,
    readyTasks,
    leadTask,
    availableTasks: availableTasks(definition, contract.phase_index),
    events,
  };
}

async function history(guildId, limit = 8) {
  await ensureSchema();
  const res = await pool.query(
    `SELECT * FROM community_job_history WHERE guild_id=$1 ORDER BY completed_at DESC LIMIT $2`,
    [String(guildId), clampInt(limit, 8, 1, 20)]
  );
  return res.rows || [];
}

async function cancelActive(guildId) {
  const active = await getActiveContract(guildId);
  if (!active) return { ok: false, reason: "no_active_contract" };
  await pool.query(`UPDATE community_job_contracts SET status='cancelled', updated_at=NOW() WHERE id=$1`, [Number(active.id)]);
  return { ok: true, contract: active };
}

async function forceComplete(guildId) {
  const active = await getActiveContract(guildId);
  if (!active) return { ok: false, reason: "no_active_contract" };
  await pool.query(`UPDATE community_job_contracts SET total_progress=total_required, updated_at=NOW() WHERE id=$1`, [Number(active.id)]);
  const done = await completeContractIfReady(guildId, active.id);
  return { ok: true, completion: done };
}

async function resetProgress(guildId) {
  const active = await getActiveContract(guildId);
  if (!active) return { ok: false, reason: "no_active_contract" };
  await pool.query(`UPDATE community_job_contracts SET total_progress=0, phase_index=0, updated_at=NOW() WHERE id=$1`, [Number(active.id)]);
  return { ok: true };
}

async function adjustProgress(guildId, amount) {
  const active = await getActiveContract(guildId);
  if (!active) return { ok: false, reason: "no_active_contract" };
  await pool.query(
    `UPDATE community_job_contracts
     SET total_progress=GREATEST(0, LEAST(total_required, total_progress+$2)), updated_at=NOW()
     WHERE id=$1`,
    [Number(active.id), clampInt(amount, 0, -1000000, 1000000)]
  );
  const advanced = await advancePhaseIfNeeded(active.id);
  const done = await completeContractIfReady(guildId, active.id);
  return { ok: true, contract: advanced, completion: done };
}

async function adjustPayoutPool(guildId, amount) {
  const active = await getActiveContract(guildId);
  if (!active) return { ok: false, reason: "no_active_contract" };
  const res = await pool.query(
    `UPDATE community_job_contracts
     SET payout_pool=GREATEST(0, payout_pool+$2), updated_at=NOW()
     WHERE id=$1 RETURNING *`,
    [Number(active.id), clampInt(amount, 0, -1000000000, 1000000000)]
  );
  return { ok: true, contract: res.rows?.[0] || active };
}

module.exports = {
  ensureSchema,
  getSettings,
  updateSettings,
  getActiveContract,
  ensureActiveContract,
  createContract,
  snapshot,
  history,
  startTask,
  estimateHelp,
  joinHelp,
  collectReadyTasks,
  cancelActive,
  forceComplete,
  resetProgress,
  adjustProgress,
  adjustPayoutPool,
  getHelperMultiplier,
  availableTasks,
  phaseProgress,
};
