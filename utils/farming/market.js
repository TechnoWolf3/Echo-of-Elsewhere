const config = require('../../data/farming/marketConfig');

function getPrice(cropId, season) {
  const crop = config[cropId];
  if (!crop) return 0;

  const [min, max] = crop.seasonalRanges[season];

  return Math.floor(Math.random() * (max - min + 1)) + min;
}

module.exports = {
  getPrice
};