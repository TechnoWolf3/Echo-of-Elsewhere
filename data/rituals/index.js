const daily = require("./daily");
const weekly = require("./weekly");
const monthly = require("./monthly");
const echoCipher = require("./echoCipher");
const echoWheel = require("./echoWheel");
const veilSequence = require("./veilSequence");
const bladeGrid = require("./bladeGrid");
const echoArrangement = require("./echoArrangement");

const rituals = [daily, weekly, monthly, echoWheel, echoCipher, veilSequence, bladeGrid, echoArrangement];

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
