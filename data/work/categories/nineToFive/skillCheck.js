// data/nineToFive/skillCheck.js
module.exports = {
  // UI
  title: "🧠 Skill Check",
  footer: "Succeed for full pay. Fail for a tiny payout.",

  // Timing
  timeLimitMs: 18_000,
  memoriseMs: 3_500,
  cooldownSeconds: 5 * 60,
  patternLength: 3,

  // Choices
  emojis: ["🟥", "🟦", "🟩", "🟨"],

  // Rewards / XP
  xp: {
    success: 10,
    fail: 3,
  },

  payout: {
    success: { min: 2000, max: 4000 },
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
