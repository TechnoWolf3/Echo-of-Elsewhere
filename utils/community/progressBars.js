const { renderProgressBarFromRatio } = require("../progressBar");

function renderRatioBar(ratio, options = {}) {
  return renderProgressBarFromRatio(ratio, { length: 10, ...options });
}

function renderSignedStandingBar(standing) {
  const value = Math.max(-100, Math.min(100, Number(standing) || 0));
  return renderRatioBar(Math.abs(value) / 100);
}

module.exports = {
  renderRatioBar,
  renderSignedStandingBar,
};
