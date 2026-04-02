module.exports = {
  clear_debris: {
    label: "Clear Debris",
    requires: ["tractor", "stone_picker"],
    baseTimeMinutes: 2,
    baseValue: 2500
  },

  plow: {
    label: "Plow",
    requires: ["tractor", "plow"],
    baseTimeMinutes: 3,
    baseValue: 3500
  },

  seed: {
    label: "Seed",
    requires: ["tractor", "seeder"],
    baseTimeMinutes: 3,
    baseValue: 4000
  },

  harvest: {
    label: "Harvest",
    requires: ["harvester"],
    baseTimeMinutes: 4,
    baseValue: 6000
  }
};