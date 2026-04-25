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
    perKm: 12,
    useFreightModifiers: false,
  },

  duration: {
    minutesPerKm: 0.01,
    minMinutes: 3,
  },

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
