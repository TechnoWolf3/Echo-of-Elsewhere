const crops = require('../../data/farming/crops');

function calculateYield(cropId, fieldLevel = 1) {
  const crop = crops[cropId];
  if (!crop) return 0;

  const base =
    Math.floor(
      Math.random() * (crop.baseYield.max - crop.baseYield.min + 1)
    ) + crop.baseYield.min;

  const multiplier = 1 + (fieldLevel * 0.1);

  return Math.floor(base * multiplier);
}

module.exports = {
  calculateYield
};