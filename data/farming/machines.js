module.exports = {
  // Tractors
  tractor_small: {
    id: "tractor_small",
    name: "Small Tractor",
    type: "tractor",
    tier: 1,
    buyPrice: 85000,
    rentPrice: 12000,
    taskSpeedMult: 1.0,
    requiredFor: ["cultivate", "seed"],
  },

  tractor_medium: {
    id: "tractor_medium",
    name: "Medium Tractor",
    type: "tractor",
    tier: 2,
    buyPrice: 180000,
    rentPrice: 22000,
    taskSpeedMult: 0.85,
    requiredFor: ["cultivate", "seed", "fertilise"],
  },

  // Cultivators
  cultivator_basic: {
    id: "cultivator_basic",
    name: "Basic Cultivator",
    type: "cultivator",
    tier: 1,
    buyPrice: 24000,
    rentPrice: 4000,
    taskSpeedMult: 1.0,
    requiredFor: ["cultivate"],
  },

  cultivator_heavy: {
    id: "cultivator_heavy",
    name: "Heavy Cultivator",
    type: "cultivator",
    tier: 2,
    buyPrice: 52000,
    rentPrice: 7000,
    taskSpeedMult: 0.85,
    requiredFor: ["cultivate"],
  },

  // Seeders
  seeder_basic: {
    id: "seeder_basic",
    name: "Basic Seeder",
    type: "seeder",
    tier: 1,
    buyPrice: 30000,
    rentPrice: 5000,
    taskSpeedMult: 1.0,
    requiredFor: ["seed"],
  },

  seeder_precision: {
    id: "seeder_precision",
    name: "Precision Seeder",
    type: "seeder",
    tier: 2,
    buyPrice: 70000,
    rentPrice: 9000,
    taskSpeedMult: 0.8,
    requiredFor: ["seed"],
  },

  // Sprayers
  sprayer_basic: {
    id: "sprayer_basic",
    name: "Basic Sprayer",
    type: "sprayer",
    tier: 1,
    buyPrice: 28000,
    rentPrice: 4500,
    taskSpeedMult: 1.0,
    requiredFor: ["fertilise"],
  },

  sprayer_large: {
    id: "sprayer_large",
    name: "Large Sprayer",
    type: "sprayer",
    tier: 2,
    buyPrice: 65000,
    rentPrice: 8500,
    taskSpeedMult: 0.8,
    requiredFor: ["fertilise"],
  },

  // Harvesters
  harvester_small: {
    id: "harvester_small",
    name: "Small Harvester",
    type: "harvester",
    tier: 1,
    buyPrice: 140000,
    rentPrice: 18000,
    taskSpeedMult: 1.0,
    requiredFor: ["harvest"],
  },

  harvester_medium: {
    id: "harvester_medium",
    name: "Medium Harvester",
    type: "harvester",
    tier: 2,
    buyPrice: 260000,
    rentPrice: 30000,
    taskSpeedMult: 0.8,
    requiredFor: ["harvest"],
  },
};