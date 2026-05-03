module.exports = {
  FIELD_BASE_COST: 150000,
  FIELD_COST_MULTIPLIER: 1.5,
  NON_REGROW_DEBRIS_CHANCE_AFTER_HARVEST: 0.35,

  UPGRADE_COSTS: {
    2: 60000,
    3: 110000,
    4: 175000,
    5: 260000,
    6: 380000,
    7: 550000,
    8: 800000,
    9: 1150000,
    10: 1600000,
  },

  MAX_FIELD_LEVEL: 10,

  MAX_FIELDS: 6,

  FIELD_UPGRADE_DURATION_MS: 60 * 60 * 1000,

  BARN_DEMOLITION_BASE_COST: 120000,
  BARN_DEMOLITION_LEVEL_MULTIPLIER: 35000,
  BARN_UPGRADE_DURATION_MS: 60 * 60 * 1000,
  BARN_CAPACITY_LEVEL_MULTIPLIERS: {
    1: 1,
    2: 1.28,
    3: 1.6,
    4: 1.95,
    5: 2.35,
    6: 2.8,
    7: 3.3,
    8: 3.85,
    9: 4.45,
    10: 5.1,
  },

  CROP_YIELD_SCALING: {
    perLevelBeyondUnlock: 0.13,
  },

  SEASONS: ["spring", "summer", "autumn", "winter"],

  SEASON_LENGTH_MS: 7 * 24 * 60 * 60 * 1000, // 1 week
};
