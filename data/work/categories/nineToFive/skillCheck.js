// data/nineToFive/skillCheck.js
module.exports = {
  // UI
  title: "🧠 Skill Check",
  footer: "Succeed for full pay. Fail for a tiny payout.",

  // Timing
  timeLimitMs: 12_000,

  // Choices
  emojis: ["🟥", "🟦", "🟩", "🟨"],

  // Rewards / XP
  xp: {
    success: 10,
    fail: 3,
  },

  payout: {
    success: { min: 650, max: 1600 },
    fail: { min: 50, max: 220 },
  },

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
