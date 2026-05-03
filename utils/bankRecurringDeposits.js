const { pool } = require("./db");

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DUE_PER_TICK = 100;

let schedulerStarted = false;
let schedulerHandle = null;

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bank_recurring_deposits (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      amount BIGINT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      next_run_at TIMESTAMPTZ NOT NULL,
      last_run_at TIMESTAMPTZ NULL,
      last_result TEXT NULL,
      failed_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, user_id)
    );

    ALTER TABLE IF EXISTS bank_recurring_deposits
    ADD COLUMN IF NOT EXISTS failed_count INTEGER NOT NULL DEFAULT 0;

    CREATE INDEX IF NOT EXISTS idx_bank_recurring_deposits_due
    ON bank_recurring_deposits (enabled, next_run_at);
  `);
}

function nextDailyRun(fromMs = Date.now()) {
  return new Date(fromMs + DAY_MS);
}

async function getRecurringDeposit(guildId, userId) {
  await ensureSchema();
  const res = await pool.query(
    `SELECT amount, enabled, next_run_at, last_run_at, last_result, failed_count
     FROM bank_recurring_deposits
     WHERE guild_id=$1 AND user_id=$2`,
    [String(guildId), String(userId)]
  );
  return res.rows?.[0] || null;
}

async function setRecurringDeposit(guildId, userId, amount) {
  await ensureSchema();
  const cleanAmount = Math.floor(Number(amount) || 0);
  if (cleanAmount <= 0) throw new Error("Recurring deposit amount must be positive");
  const nextRunAt = nextDailyRun();
  const res = await pool.query(
    `INSERT INTO bank_recurring_deposits (guild_id, user_id, amount, enabled, next_run_at, updated_at)
     VALUES ($1,$2,$3,TRUE,$4,NOW())
     ON CONFLICT (guild_id, user_id)
     DO UPDATE SET
       amount = EXCLUDED.amount,
       enabled = TRUE,
       next_run_at = EXCLUDED.next_run_at,
       failed_count = 0,
       updated_at = NOW()
     RETURNING amount, enabled, next_run_at, last_run_at, last_result, failed_count`,
    [String(guildId), String(userId), cleanAmount, nextRunAt]
  );
  return res.rows[0];
}

async function disableRecurringDeposit(guildId, userId) {
  await ensureSchema();
  const res = await pool.query(
    `UPDATE bank_recurring_deposits
     SET enabled=FALSE, updated_at=NOW()
     WHERE guild_id=$1 AND user_id=$2
     RETURNING amount, enabled, next_run_at, last_run_at, last_result, failed_count`,
    [String(guildId), String(userId)]
  );
  return res.rows?.[0] || null;
}

async function processOneDue(row) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const scheduleRes = await client.query(
      `SELECT guild_id, user_id, amount, next_run_at, failed_count
       FROM bank_recurring_deposits
       WHERE guild_id=$1 AND user_id=$2 AND enabled=TRUE AND next_run_at <= NOW()
       FOR UPDATE`,
      [String(row.guild_id), String(row.user_id)]
    );
    const schedule = scheduleRes.rows?.[0];
    if (!schedule) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "not_due" };
    }

    const amount = Math.max(0, Math.floor(Number(schedule.amount) || 0));
    const nextRunAt = nextDailyRun(Math.max(Date.now(), new Date(schedule.next_run_at).getTime()));
    const move = amount > 0
      ? await client.query(
          `UPDATE user_balances
           SET balance = balance - $3,
               bank_balance = bank_balance + $3
           WHERE guild_id=$1 AND user_id=$2 AND balance >= $3
           RETURNING balance, bank_balance`,
          [String(schedule.guild_id), String(schedule.user_id), amount]
        )
      : { rowCount: 0 };

    const moved = move.rowCount > 0;
    if (moved) {
      await client.query(
        `INSERT INTO transactions (guild_id, user_id, amount, type, meta)
         VALUES ($1,$2,$3,$4,$5)`,
        [
          String(schedule.guild_id),
          String(schedule.user_id),
          0,
          "bank_deposit",
          {
            amount,
            recurring: true,
            from: "wallet",
            to: "bank",
            reason: "daily_recurring",
          },
        ]
      );
    }

    const failedCount = moved ? 0 : Number(schedule.failed_count || 0) + 1;
    const enabled = moved || failedCount < 3;
    await client.query(
      `UPDATE bank_recurring_deposits
       SET next_run_at=$3,
           last_run_at=NOW(),
           last_result=$4,
           failed_count=$5,
           enabled=$6,
           updated_at=NOW()
       WHERE guild_id=$1 AND user_id=$2`,
      [
        String(schedule.guild_id),
        String(schedule.user_id),
        nextRunAt,
        moved ? "deposited" : (enabled ? "insufficient_wallet" : "cancelled_after_3_failures"),
        failedCount,
        enabled,
      ]
    );

    await client.query("COMMIT");
    return {
      ok: moved,
      reason: moved ? "deposited" : (enabled ? "insufficient_wallet" : "cancelled_after_3_failures"),
      amount,
      failedCount,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function processDueDeposits() {
  await ensureSchema();
  const due = await pool.query(
    `SELECT guild_id, user_id
     FROM bank_recurring_deposits
     WHERE enabled=TRUE AND next_run_at <= NOW()
     ORDER BY next_run_at ASC
     LIMIT $1`,
    [MAX_DUE_PER_TICK]
  );

  let processed = 0;
  for (const row of due.rows || []) {
    await processOneDue(row).catch((err) => {
      console.error("[BANK][RECURRING] daily deposit failed:", err);
    });
    processed += 1;
  }
  return processed;
}

function startScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  schedulerHandle = setInterval(() => {
    processDueDeposits().catch((err) => console.error("[BANK][RECURRING] scheduler failed:", err));
  }, 10 * 60 * 1000);
  processDueDeposits().catch((err) => console.error("[BANK][RECURRING] initial tick failed:", err));
}

module.exports = {
  ensureSchema,
  getRecurringDeposit,
  setRecurringDeposit,
  disableRecurringDeposit,
  processDueDeposits,
  startScheduler,
};
