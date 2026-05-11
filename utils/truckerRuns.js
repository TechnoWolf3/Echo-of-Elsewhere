const { pool } = require("./db");

let ready = false;

async function ensureTable() {
  if (ready) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS job_trucker_runs (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      manifest JSONB NOT NULL,
      started_at TIMESTAMPTZ NOT NULL,
      ready_at TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      paid_at TIMESTAMPTZ,
      notified_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, user_id)
    )
  `);
  await pool.query(`ALTER TABLE job_trucker_runs ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS job_trucker_manifest_state (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      manifest JSONB NOT NULL,
      refresh_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, user_id)
    )
  `);
  ready = true;
}

function hydrate(row, draft = null) {
  if (!row) return null;
  const startedAtMs = new Date(row.started_at).getTime();
  const readyAtMs = new Date(row.ready_at).getTime();
  const durationMs = Math.max(1, readyAtMs - startedAtMs);
  return {
    manifest: row.manifest,
    startMs: startedAtMs,
    durationMs,
    ready: Date.now() >= readyAtMs,
    interval: null,
    persisted: true,
    status: row.status,
    refreshCount: draft?.refreshCount ?? 0,
    refreshLimit: draft?.refreshLimit ?? null,
  };
}

function hydrateDraft(row, refreshLimit = null) {
  if (!row) return null;
  return {
    manifest: row.manifest,
    startMs: 0,
    durationMs: 0,
    ready: false,
    interval: null,
    persistedDraft: true,
    refreshCount: Math.max(0, Number(row.refresh_count || 0)),
    refreshLimit,
  };
}

async function getActiveRun(guildId, userId) {
  await ensureTable();
  const res = await pool.query(
    `SELECT guild_id, user_id, manifest, started_at, ready_at, status, paid_at
     FROM job_trucker_runs
     WHERE guild_id=$1
       AND user_id=$2
       AND (
         status='active'
         OR (status='collecting' AND updated_at < NOW() - INTERVAL '5 minutes')
       )
     LIMIT 1`,
    [String(guildId), String(userId)]
  );
  return hydrate(res.rows?.[0]);
}

async function startRun(guildId, userId, manifest, startedAtMs, durationMs) {
  await ensureTable();
  const startedAt = new Date(startedAtMs);
  const readyAt = new Date(startedAtMs + durationMs);
  const res = await pool.query(
    `INSERT INTO job_trucker_runs (guild_id, user_id, manifest, started_at, ready_at, status, paid_at, updated_at)
     VALUES ($1, $2, $3::jsonb, $4, $5, 'active', NULL, NOW())
     ON CONFLICT (guild_id, user_id)
     DO UPDATE SET
       manifest = EXCLUDED.manifest,
       started_at = EXCLUDED.started_at,
       ready_at = EXCLUDED.ready_at,
       status = 'active',
       paid_at = NULL,
       updated_at = NOW()
     RETURNING guild_id, user_id, manifest, started_at, ready_at, status, paid_at`,
    [String(guildId), String(userId), JSON.stringify(manifest), startedAt, readyAt]
  );
  return hydrate(res.rows?.[0]);
}

async function getOrCreateDraft(guildId, userId, manifest, refreshLimit = null) {
  await ensureTable();
  const res = await pool.query(
    `INSERT INTO job_trucker_manifest_state (guild_id, user_id, manifest, refresh_count, updated_at)
     VALUES ($1, $2, $3::jsonb, 0, NOW())
     ON CONFLICT (guild_id, user_id)
     DO UPDATE SET updated_at=job_trucker_manifest_state.updated_at
     RETURNING guild_id, user_id, manifest, refresh_count`,
    [String(guildId), String(userId), JSON.stringify(manifest)]
  );
  return hydrateDraft(res.rows?.[0], refreshLimit);
}

async function refreshDraft(guildId, userId, manifest, refreshLimit = 5) {
  await ensureTable();
  const limit = Math.max(0, Number(refreshLimit || 0));
  const res = await pool.query(
    `UPDATE job_trucker_manifest_state
     SET manifest=$3::jsonb,
         refresh_count=refresh_count + 1,
         updated_at=NOW()
     WHERE guild_id=$1
       AND user_id=$2
       AND refresh_count < $4
     RETURNING guild_id, user_id, manifest, refresh_count`,
    [String(guildId), String(userId), JSON.stringify(manifest), limit]
  );
  return hydrateDraft(res.rows?.[0], limit);
}

async function resetDraft(guildId, userId) {
  await ensureTable();
  await pool.query(
    `DELETE FROM job_trucker_manifest_state
     WHERE guild_id=$1 AND user_id=$2`,
    [String(guildId), String(userId)]
  );
}

async function claimReadyRun(guildId, userId) {
  await ensureTable();
  const res = await pool.query(
    `UPDATE job_trucker_runs
     SET status='collecting', updated_at=NOW()
     WHERE guild_id=$1
       AND user_id=$2
       AND (
         status='active'
         OR (status='collecting' AND updated_at < NOW() - INTERVAL '5 minutes')
       )
       AND ready_at <= NOW()
     RETURNING guild_id, user_id, manifest, started_at, ready_at, status, paid_at`,
    [String(guildId), String(userId)]
  );
  return hydrate(res.rows?.[0]);
}

async function completePaidRun(guildId, userId) {
  await ensureTable();
  await pool.query(
    `UPDATE job_trucker_runs
     SET status='paid', paid_at=NOW(), updated_at=NOW()
     WHERE guild_id=$1 AND user_id=$2 AND status='collecting'`,
    [String(guildId), String(userId)]
  );
}

async function markCompletionNotified(guildId, userId) {
  await ensureTable();
  const res = await pool.query(
    `UPDATE job_trucker_runs
     SET notified_at=NOW(), updated_at=NOW()
     WHERE guild_id=$1
       AND user_id=$2
       AND status='active'
       AND ready_at <= NOW()
       AND notified_at IS NULL
     RETURNING guild_id, user_id`,
    [String(guildId), String(userId)]
  );
  return res.rowCount > 0;
}

async function releaseClaim(guildId, userId) {
  await ensureTable();
  await pool.query(
    `UPDATE job_trucker_runs
     SET status='active', updated_at=NOW()
     WHERE guild_id=$1 AND user_id=$2 AND status='collecting'`,
    [String(guildId), String(userId)]
  );
}

module.exports = {
  ensureTable,
  getActiveRun,
  getOrCreateDraft,
  refreshDraft,
  resetDraft,
  startRun,
  claimReadyRun,
  completePaidRun,
  markCompletionNotified,
  releaseClaim,
};
