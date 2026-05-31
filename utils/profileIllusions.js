const { pool } = require("./db");

const ADMIN_FAILURE_WINDOW_MS = 10 * 60 * 1000;
const ANGRY_ECHO_DURATION_MS = 5 * 60 * 1000;
const ANGRY_ECHO_TYPE = "angry_echo_fake_wipe";

function requirePool() {
  if (!pool?.query) {
    throw new Error("DATABASE_URL is not configured.");
  }
  return pool;
}

async function ensureSchema() {
  const db = requirePool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS profile_illusions (
      id BIGSERIAL PRIMARY KEY,
      profile_id TEXT NOT NULL,
      type TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_reason TEXT NULL
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_profile_illusions_active ON profile_illusions(profile_id, active, expires_at)`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS profile_admin_unlock_failures (
      profile_id TEXT PRIMARY KEY,
      failed_count INTEGER NOT NULL DEFAULT 0,
      window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

function displayPayload() {
  return {
    message: null,
    display: {
      walletBalance: 0,
      bankBalance: 0,
      serverBankBalance: 0,
      jobLevel: 0,
      jobXp: 0,
      heat: 0,
      jailedUntil: null,
      accountNumber: null,
      account_number: null,
    },
  };
}

function normalizeIllusion(row) {
  if (!row) return null;
  const payload = row.payload_json || {};
  return {
    active: true,
    type: row.type,
    startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    message: payload.message ?? null,
    display: payload.display || displayPayload().display,
  };
}

async function getActiveIllusion(profileId) {
  if (!profileId) return null;
  await ensureSchema();
  const db = requirePool();
  const res = await db.query(
    `SELECT *
     FROM profile_illusions
     WHERE profile_id=$1
       AND active=TRUE
       AND expires_at > NOW()
     ORDER BY started_at DESC
     LIMIT 1`,
    [profileId]
  );
  return normalizeIllusion(res.rows?.[0] || null);
}

async function triggerAngryEchoIllusion(profileId, reason = "admin_password_failed_twice") {
  await ensureSchema();
  const db = requirePool();
  const payload = displayPayload();
  const res = await db.query(
    `INSERT INTO profile_illusions (profile_id, type, active, started_at, expires_at, payload_json, created_reason)
     VALUES ($1, $2, TRUE, NOW(), NOW() + ($3::int * INTERVAL '1 millisecond'), $4::jsonb, $5)
     RETURNING *`,
    [profileId, ANGRY_ECHO_TYPE, ANGRY_ECHO_DURATION_MS, JSON.stringify(payload), reason]
  );
  return normalizeIllusion(res.rows?.[0] || null);
}

async function recordAdminUnlockFailure(profileId) {
  if (!profileId) {
    return { failedAttempts: 0, illusion: null };
  }
  await ensureSchema();
  const db = requirePool();
  const activeIllusion = await getActiveIllusion(profileId);
  if (activeIllusion?.type === ANGRY_ECHO_TYPE) {
    return { failedAttempts: 2, illusion: activeIllusion };
  }
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const currentRes = await client.query(
      `SELECT failed_count, window_started_at
       FROM profile_admin_unlock_failures
       WHERE profile_id=$1
       FOR UPDATE`,
      [profileId]
    );
    const current = currentRes.rows?.[0] || null;
    const windowStartedAt = current?.window_started_at ? new Date(current.window_started_at).getTime() : 0;
    const withinWindow = windowStartedAt && Date.now() - windowStartedAt <= ADMIN_FAILURE_WINDOW_MS;
    const failedAttempts = withinWindow ? Number(current.failed_count || 0) + 1 : 1;

    await client.query(
      `INSERT INTO profile_admin_unlock_failures (profile_id, failed_count, window_started_at, updated_at)
       VALUES ($1, $2, NOW(), NOW())
       ON CONFLICT (profile_id)
       DO UPDATE SET
         failed_count=$2,
         window_started_at=CASE WHEN $3::boolean THEN profile_admin_unlock_failures.window_started_at ELSE NOW() END,
         updated_at=NOW()`,
      [profileId, failedAttempts, withinWindow]
    );

    let illusion = null;
    if (failedAttempts >= 2) {
      const payload = displayPayload();
      const illusionRes = await client.query(
        `INSERT INTO profile_illusions (profile_id, type, active, started_at, expires_at, payload_json, created_reason)
         VALUES ($1, $2, TRUE, NOW(), NOW() + ($3::int * INTERVAL '1 millisecond'), $4::jsonb, 'admin_password_failed_twice')
         RETURNING *`,
        [profileId, ANGRY_ECHO_TYPE, ANGRY_ECHO_DURATION_MS, JSON.stringify(payload)]
      );
      illusion = normalizeIllusion(illusionRes.rows?.[0] || null);
    }

    await client.query("COMMIT");
    return { failedAttempts, illusion };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function clearAdminUnlockFailures(profileId) {
  if (!profileId) return;
  await ensureSchema();
  const db = requirePool();
  await db.query(`DELETE FROM profile_admin_unlock_failures WHERE profile_id=$1`, [profileId]);
}

module.exports = {
  ensureSchema,
  getActiveIllusion,
  recordAdminUnlockFailure,
  clearAdminUnlockFailures,
  triggerAngryEchoIllusion,
};
