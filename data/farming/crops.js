module.exports = {
  wheat: {
    name: "Wheat",
    tier: 0,
    growthHours: 6,
    regrow: false,
    baseYield: { min: 18, max: 26 },
    basePrice: 45,
    seasons: {
      spring: "good",
      summer: "best",
      autumn: "ok",
      winter: "invalid",
    }
  },

  corn: {
    name: "Corn",
    tier: 2,
    growthHours: 16,
    regrow: true,
    regrowHours: 8,
    baseYield: { min: 10, max: 16 },
    basePrice: 135,
    seasons: {
      spring: "ok",
      summer: "best",
      autumn: "good",
      winter: "invalid",
    }
  },

  timber: {
    name: "Timber",
    tier: 5,
    growthHours: 48,
    regrow: false,
    baseYield: { min: 6, max: 10 },
    basePrice: 520,
    seasons: {
      spring: "good",
      summer: "good",
      autumn: "good",
      winter: "good",
    }
  }
};