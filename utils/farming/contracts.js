const templates = require('../../data/farming/contractTemplates');

function pickRandomContract() {
  const weighted = [];

  templates.forEach(t => {
    for (let i = 0; i < t.weight; i++) {
      weighted.push(t);
    }
  });

  return weighted[Math.floor(Math.random() * weighted.length)];
}

module.exports = {
  pickRandomContract
};