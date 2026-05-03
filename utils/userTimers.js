const { pool } = require("./db");

const TIMEZONE_LABEL = "Australia/Brisbane";
const BRISBANE_OFFSET_HOURS = 10;
const POLL_INTERVAL_MS = 5 * 1000;
const MAX_DUE_PER_TICK = 50;

let schedulerStarted = false;
let schedulerHandle = null;

function requirePool() {
  if (!pool) throw new Error("Database is not configured.");
  return pool;
}

function clampText(value, max = 80) {
  return String(value || "").trim().slice(0, max);
}

function normalizeDurationPart(value) {
  const num = Math.floor(Number(String(value || "").trim() || 0));
  return Number.isFinite(num) && num >= 0 ? num : NaN;
}

function parseCountdownInput({ hours, minutes, seconds }) {
  const h = normalizeDurationPart(hours);
  const m = normalizeDurationPart(minutes);
  const s = normalizeDurationPart(seconds);

  if (![h, m, s].every(Number.isFinite)) {
    throw new Error("Timer values must be whole numbers.");
  }
  if (m > 59 || s > 59) {
    throw new Error("Minutes and seconds must be between 0 and 59.");
  }

  const totalSeconds = (h * 60 * 60) + (m * 60) + s;
  if (totalSeconds <= 0) {
    throw new Error("Set the timer for at least 1 second.");
  }
  if (totalSeconds > 7 * 24 * 60 * 60) {
    throw new Error("Timers can be at most 7 days long.");
  }

  return { hours: h, minutes: m, seconds: s, totalSeconds };
}

function parseAlarmParts({ hour, minute, second }) {
  const h = normalizeDurationPart(hour);
  const m = normalizeDurationPart(minute);
  const s = String(second || "").trim() === "" ? 0 : normalizeDurationPart(second);

  if (![h, m, s].every(Number.isFinite)) {
    throw new Error("Alarm time values must be whole numbers.");
  }
  if (h > 23 || m > 59 || s > 59) {
    throw new Error("Alarm time must use 24-hour values: 0-23 for hour, 0-59 for minute/second.");
  }

  return { hour: h, minute: m, second: s };
}

function getBrisbaneNowParts(now = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE_LABEL,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  return { year, month, day };
}

function buildAlarmTarget({ hour, minute, second }, now = new Date()) {
  const today = getBrisbaneNowParts(now);
  let targetMs = Date.UTC(
    today.year,
    today.month - 1,
    today.day,
    hour - BRISBANE_OFFSET_HOURS,
    minute,
    second,
    0
  );

  if (targetMs <= now.getTime()) {
    targetMs += 24 * 60 * 60 * 1000;
  }

  return new Date(targetMs);
}

function formatDuration(totalSeconds) {
  const safe = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const parts = [];
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (seconds || parts.length === 0) parts.push(`${seconds}s`);
  return parts.join(" ");
}

async function ensureSchema() {
  const db = requirePool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS user_timers (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      timer_name TEXT NOT NULL,
      timer_type TEXT NOT NULL,
      duration_seconds INTEGER NULL,
      target_at TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ NULL
    );

    ALTER TABLE IF EXISTS user_timers
    ADD COLUMN IF NOT EXISTS duration_seconds INTEGER NULL;

    CREATE INDEX IF NOT EXISTS idx_user_timers_due
    ON user_timers (status, target_at);

    CREATE INDEX IF NOT EXISTS idx_user_timers_lookup
    ON user_timers (guild_id, user_id, status, target_at);
  `);
}

async function createCountdownTimer({ guildId, channelId, userId, timerName, hours, minutes, seconds }) {
  await ensureSchema();
  const parsed = parseCountdownInput({ hours, minutes, seconds });
  const cleanName = clampText(timerName, 80) || "Unnamed";
  const targetAt = new Date(Date.now() + (parsed.totalSeconds * 1000));
  const db = requirePool();
  const res = await db.query(
    `INSERT INTO user_timers (
      guild_id, channel_id, user_id, timer_name, timer_type, duration_seconds, target_at, status, updated_at
    )
     VALUES ($1,$2,$3,$4,'countdown',$5,$6,'active',NOW())
     RETURNING id, timer_name, timer_type, duration_seconds, target_at, created_at`,
    [
      String(guildId),
      String(channelId),
      String(userId),
      cleanName,
      parsed.totalSeconds,
      targetAt,
    ]
  );
  return res.rows[0];
}

async function createAlarmTimer({ guildId, channelId, userId, timerName, hour, minute, second }) {
  await ensureSchema();
  const parsed = parseAlarmParts({ hour, minute, second });
  const cleanName = clampText(timerName, 80) || "Alarm";
  const targetAt = buildAlarmTarget(parsed);
  const db = requirePool();
  const res = await db.query(
    `INSERT INTO user_timers (
      guild_id, channel_id, user_id, timer_name, timer_type, duration_seconds, target_at, status, updated_at
    )
     VALUES ($1,$2,$3,$4,'alarm',NULL,$5,'active',NOW())
     RETURNING id, timer_name, timer_type, duration_seconds, target_at, created_at`,
    [
      String(guildId),
      String(channelId),
      String(userId),
      cleanName,
      targetAt,
    ]
  );
  return res.rows[0];
}

async function listActiveTimers(guildId, userId, limit = 10) {
  await ensureSchema();
  const db = requirePool();
  const res = await db.query(
    `SELECT id, timer_name, timer_type, duration_seconds, target_at, created_at
     FROM user_timers
     WHERE guild_id=$1 AND user_id=$2 AND status='active'
     ORDER BY target_at ASC
     LIMIT $3`,
    [String(guildId), String(userId), Math.max(1, Math.floor(limit))]
  );
  return res.rows || [];
}

async function cancelTimer(guildId, userId, timerId) {
  await ensureSchema();
  const db = requirePool();
  const res = await db.query(
    `UPDATE user_timers
     SET status='cancelled', updated_at=NOW()
     WHERE id=$1 AND guild_id=$2 AND user_id=$3 AND status='active'
     RETURNING id, timer_name`,
    [Number(timerId), String(guildId), String(userId)]
  );
  return res.rows[0] || null;
}

async function claimDueTimers() {
  await ensureSchema();
  const db = requirePool();

  await db.query(
    `UPDATE user_timers
     SET status='active', updated_at=NOW()
     WHERE status='delivering' AND target_at <= NOW() - INTERVAL '2 minutes'`
  );

  const res = await db.query(
    `WITH due AS (
      SELECT id
      FROM user_timers
      WHERE status='active' AND target_at <= NOW()
      ORDER BY target_at ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE user_timers timers
    SET status='delivering', updated_at=NOW()
    FROM due
    WHERE timers.id = due.id
    RETURNING timers.id, timers.guild_id, timers.channel_id, timers.user_id,
              timers.timer_name, timers.timer_type, timers.duration_seconds, timers.target_at`,
    [MAX_DUE_PER_TICK]
  );

  return res.rows || [];
}

async function markTimerCompleted(timerId) {
  const db = requirePool();
  await db.query(
    `UPDATE user_timers
     SET status='completed', completed_at=NOW(), updated_at=NOW()
     WHERE id=$1`,
    [Number(timerId)]
  );
}

async function markTimerActive(timerId) {
  const db = requirePool();
  await db.query(
    `UPDATE user_timers
     SET status='active', updated_at=NOW()
     WHERE id=$1`,
    [Number(timerId)]
  );
}

async function deliverTimer(client, row) {
  const channel = await client.channels.fetch(String(row.channel_id)).catch(() => null);
  if (!channel || typeof channel.send !== "function") {
    await markTimerCompleted(row.id);
    return;
  }

  const kindText = row.timer_type === "alarm" ? "alarm" : "timer";
  const durationText = row.duration_seconds
    ? ` (${formatDuration(row.duration_seconds)})`
    : "";

  await channel.send({
    content: `<@${row.user_id}> Your **${row.timer_name}** ${kindText} has finished${durationText}.`,
  });

  await markTimerCompleted(row.id);
}

async function processDueTimers(client) {
  const due = await claimDueTimers();
  for (const row of due) {
    try {
      await deliverTimer(client, row);
    } catch (err) {
      console.error("[TIMERS] delivery failed:", err);
      await markTimerActive(row.id).catch(() => {});
    }
  }
  return due.length;
}

function startScheduler(client) {
  if (schedulerStarted) return;
  schedulerStarted = true;

  schedulerHandle = setInterval(() => {
    processDueTimers(client).catch((err) => console.error("[TIMERS] scheduler failed:", err));
  }, POLL_INTERVAL_MS);

  processDueTimers(client).catch((err) => console.error("[TIMERS] initial tick failed:", err));
}

module.exports = {
  TIMEZONE_LABEL,
  ensureSchema,
  createCountdownTimer,
  createAlarmTimer,
  listActiveTimers,
  cancelTimer,
  startScheduler,
  processDueTimers,
  formatDuration,
};
