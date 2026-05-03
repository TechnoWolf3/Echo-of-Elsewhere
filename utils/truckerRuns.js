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
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, user_id)
    )
  `);
  ready = true;
}

function hydrate(row) {
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
  startRun,
  claimReadyRun,
  completePaidRun,
  releaseClaim,
};
