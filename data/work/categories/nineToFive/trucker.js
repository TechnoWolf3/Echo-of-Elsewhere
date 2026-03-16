const routes = require("./trucker.routes");
const {
  freightPool,
  trailerConfigs,
  truckTypes,
  manifestLines,
} = require("./trucker.freight");

module.exports = {
  title: "🚛 Trucker",
  manifestTitle: "🚛 Freight Manifest",
  inProgressTitle: "🚛 Long Haul In Progress",
  completeTitle: "✅ Delivery Complete",
  footer: "Start the run, let the kilometres roll, then collect the cheque.",
  updateEverySeconds: 30,

  xp: {
    success: 18,
  },

  payout: {
    perKmMin: 1.7,
    perKmMax: 2.55,
    longHaulBonusMin: 50,
    longHaulBonusMax: 850,
  },

  durationTiers: [
    { maxKm: 180, minutes: 3 },
    { maxKm: 350, minutes: 4 },
    { maxKm: 600, minutes: 5 },
    { maxKm: 900, minutes: 6 },
    { maxKm: 1200, minutes: 7 },
    { maxKm: 1600, minutes: 8 },
    { maxKm: 2100, minutes: 10 },
    { maxKm: 2700, minutes: 12 },
    { maxKm: 3400, minutes: 15 },
    { maxKm: Infinity, minutes: 15 },
  ],

  routes,
  // Cargo items are objects: { name, category, payoutModifier }
  freightPool,
  // Trailer compatibility keyed by freight category.
  trailerConfigs,
  // Flat fallback list for safety / compatibility.
  truckTypes,
  manifestLines,

  activityEffects: {
    effectsApply: true,
    canAwardEffects: true,
    blockedBlessings: [],
    blockedCurses: [],
    effectAwardPool: {
      nothingWeight: 100,
      blessingWeight: 0,
      curseWeight: 0,
      blessingWeights: {},
      curseWeights: {},
    },
  },
};
