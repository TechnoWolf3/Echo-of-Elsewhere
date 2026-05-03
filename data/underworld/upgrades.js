module.exports = {
  security: {
    id: "security",
    name: "Security",
    description: "Better countersurveillance, better exits, better odds.",
    levels: [
      { level: 1, cost: 1800000, raidChanceReduction: 0.03 },
      { level: 2, cost: 3200000, raidChanceReduction: 0.06 },
      { level: 3, cost: 5500000, raidChanceReduction: 0.1 },
    ],
  },
  equipment: {
    id: "equipment",
    name: "Equipment",
    description: "Higher-end rigs that squeeze more from each cycle.",
    levels: [
      { level: 1, cost: 1500000, outputMultiplier: 0.08 },
      { level: 2, cost: 2800000, outputMultiplier: 0.16 },
      { level: 3, cost: 4800000, outputMultiplier: 0.25 },
    ],
  },
  efficiency: {
    id: "efficiency",
    name: "Efficiency",
    description: "Cleaner process flow with less attention drawn over time.",
    levels: [
      { level: 1, cost: 1400000, suspicionReduction: 2 },
      { level: 2, cost: 2600000, suspicionReduction: 4 },
      { level: 3, cost: 4200000, suspicionReduction: 7 },
    ],
  },
};
