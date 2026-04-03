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
  },

  barley: {
    id: "barley",
    name: "Barley",
    level: 1,
    growthHours: 4,
    yield: [3, 6],
    seasons: ["spring", "summer"],
    regrow: false,
  },

  oats: {
    id: "oats",
    name: "Oats",
    level: 1,
    growthHours: 3,
    yield: [2, 5],
    seasons: ["spring"],
    regrow: false,
  },

  spinach: {
    id: "spinach",
    name: "Spinach",
    level: 1,
    growthHours: 0.1,
    yield: [2, 5],
    seasons: ["spring", "winter"],
    regrow: true,
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
  },

  canola: {
    id: "canola",
    name: "Canola",
    level: 2,
    growthHours: 7,
    yield: [6, 10],
    seasons: ["summer"],
    regrow: false,
  },
// Level 3 Crops
  corn: {
    id: "corn",
    name: "Corn",
    level: 3,
    growthHours: 8,
    yield: [6, 12],
    seasons: ["summer", "autumn"],
    regrow: true,
    regrowHours: 5,
  },

  soybeans: {
    id: "soybeans",
    name: "Soybeans",
    level: 3,
    growthHours: 7,
    yield: [6, 11],
    seasons: ["summer"],
    regrow: false,
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
  },
};