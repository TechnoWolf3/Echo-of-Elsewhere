const daily = require("./daily");
const weekly = require("./weekly");
const monthly = require("./monthly");
const echoCipher = require("./echoCipher");

const rituals = [daily, weekly, monthly, echoCipher];

function getRitual(id) {
  return rituals.find((ritual) => ritual.id === id) || null;
}

function getPrimaryRituals() {
  return rituals.filter((ritual) => ritual.placement === "primary");
}

function getOtherRituals() {
  return rituals.filter((ritual) => ritual.placement === "other");
}

module.exports = {
  rituals,
  getRitual,
  getPrimaryRituals,
  getOtherRituals,
};
