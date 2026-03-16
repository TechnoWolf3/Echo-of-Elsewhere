const DEFAULT_LENGTH = 16;
const DEFAULT_FILLED = "▰";
const DEFAULT_EMPTY = "▱";

function clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function renderProgressBarFromRatio(ratio, {
  length = DEFAULT_LENGTH,
  filled = DEFAULT_FILLED,
  empty = DEFAULT_EMPTY,
} = {}) {
  const safeLength = Math.max(1, Math.floor(Number(length) || DEFAULT_LENGTH));
  const safeRatio = clamp01(ratio);
  const filledCount = Math.round(safeRatio * safeLength);
  return filled.repeat(filledCount) + empty.repeat(Math.max(0, safeLength - filledCount));
}

function renderProgressBar(value, max = 100, options = {}) {
  const safeMax = Math.max(1, Number(max || 100));
  const safeValue = Math.max(0, Number(value || 0));
  return renderProgressBarFromRatio(safeValue / safeMax, options);
}

function makeProgressBar(current, target, options = {}) {
  return renderProgressBar(current, target, options);
}

module.exports = {
  DEFAULT_LENGTH,
  DEFAULT_FILLED,
  DEFAULT_EMPTY,
  renderProgressBar,
  renderProgressBarFromRatio,
  makeProgressBar,
};
