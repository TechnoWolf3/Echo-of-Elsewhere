const daily = require("./daily");
const weekly = require("./weekly");
const monthly = require("./monthly");

const rituals = [daily, weekly, monthly];

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
