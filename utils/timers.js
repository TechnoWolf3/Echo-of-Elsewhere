function toTimestamp(value, fallback = 0) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function hasElapsed(targetAt, now = Date.now()) {
  const target = toTimestamp(targetAt, 0);
  return target > 0 && now >= target;
}

function msRemaining(targetAt, now = Date.now()) {
  const target = toTimestamp(targetAt, 0);
  if (target <= 0) return 0;
  return Math.max(0, target - now);
}

function buildTimedWindow(openedAt, durationMs) {
  const opened = toTimestamp(openedAt, Date.now());
  const duration = Math.max(0, toTimestamp(durationMs, 0));
  return {
    openedAt: opened,
    deadlineAt: opened + duration,
  };
}

module.exports = {
  toTimestamp,
  hasElapsed,
  msRemaining,
  buildTimedWindow,
};
