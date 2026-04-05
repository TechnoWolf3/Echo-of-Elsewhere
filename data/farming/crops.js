module.exports = {
  // Level 1 Crops
  wheat: {
    id: "wheat",
    name: "Wheat",
    level: 1,
    growthHours: 4,
    yield: [3, 6],
    seasons: ["spring", "summer"],
    regrow: false,
    debrisChance: 0.25,
  },

  barley: {
    id: "barley",
    name: "Barley",
    level: 1,
    growthHours: 4,
    yield: [3, 6],
    seasons: ["spring", "summer"],
    regrow: false,
    debrisChance: 0.25,
  },

  oats: {
    id: "oats",
    name: "Oats",
    level: 1,
    growthHours: 3,
    yield: [2, 5],
    seasons: ["spring"],
    regrow: false,
    debrisChance: 0.25,
  },

  spinach: {
    id: "spinach",
    name: "Spinach",
    level: 1,
    growthHours: 3,
    regrowHours: 2,
    yield: [2, 5],
    seasons: ["spring", "winter"],
    regrow: true,
    debrisChance: 0,
  },
// Level 2 Crops
  potatoes: {
    id: "potatoes",
    name: "Potatoes",
    level: 2,
    growthHours: 6,
    yield: [5, 9],
    seasons: ["spring", "autumn"],
    regrow: false,
    debrisChance: 0.25,
  },

  canola: {
    id: "canola",
    name: "Canola",
    level: 2,
    growthHours: 7,
    yield: [6, 10],
    seasons: ["summer"],
    regrow: false,
    debrisChance: 0.25,
  },
// Level 3 Crops
  corn: {
    id: "corn",
    name: "Corn",
    level: 3,
    growthHours: 8,
    regrowHours: 5,
    yield: [6, 12],
    seasons: ["summer", "autumn"],
    regrow: true,
    debrisChance: 0,
  },

  soybeans: {
    id: "soybeans",
    name: "Soybeans",
    level: 3,
    growthHours: 7,
    yield: [6, 11],
    seasons: ["summer"],
    regrow: false,
    debrisChance: 0.25,
  },
// Level 4 Crops
  carrots: {
    id: "carrots",
    name: "Carrots",
    level: 4,
    growthHours: 9,
    yield: [8, 14],
    seasons: ["autumn"],
    regrow: false,
    debrisChance: 0.25,
  },
};