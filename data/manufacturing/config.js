module.exports = {
  PLOT_BASE_COST: 150000,
  PLOT_COST_MULTIPLIER: 1.5,
  MAX_PLOTS: 6,
  MAX_PLOT_LEVEL: 10,
  FACTORY_CHANGE_RETAIN_RATE: 0.65,
  IMPORT_BASE_TIME_SECONDS: 90,
  IMPORT_PER_ITEM_SECONDS: 20,
  CONTRACT_REFRESH_MS: 6 * 60 * 60 * 1000,
  CONTRACT_COUNT: 3,
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
  FACTORY_TYPES: {
    food_processing: {
      name: "Food Processing",
      emoji: "🍞",
      description: "Turn farm produce and pantry goods into packaged food."
    },
    textiles: {
      name: "Textiles",
      emoji: "🧵",
      description: "Process fibres, fabric, and dyes into finished goods."
    },
    electronics: {
      name: "Electronics",
      emoji: "🔌",
      description: "Assemble components into consumer-ready hardware."
    },
    construction: {
      name: "Construction",
      emoji: "🧱",
      description: "Refine industrial materials into building products."
    },
  },
  EVENT_TYPES: {
    food_processing: [
      { id: "spoilage_risk", name: "Spoilage Risk", bonusText: "+1 output if handled." },
      { id: "rush_order", name: "Rush Order", bonusText: "+1 output if handled." },
    ],
    textiles: [
      { id: "quality_check", name: "Quality Check", bonusText: "+1 output if handled." },
      { id: "pattern_issue", name: "Pattern Issue", bonusText: "+1 output if handled." },
    ],
    electronics: [
      { id: "power_surge", name: "Power Surge", bonusText: "+1 output if handled." },
      { id: "faulty_components", name: "Faulty Components", bonusText: "+1 output if handled." },
    ],
    construction: [
      { id: "machinery_issue", name: "Machinery Issue", bonusText: "+1 output if handled." },
      { id: "bulk_order", name: "Bulk Order", bonusText: "+1 output if handled." },
    ],
  },
};
