// data/nineToFive/shift.js
module.exports = {
  // UI
  title: "🕒 Shift",
  inProgressTitle: "🕒 Shift In Progress",
  completeTitle: "🕒 Shift Complete",
  footer: "Stay on the board. Collect when ready.",

  // Timing
  durationSeconds: 45,
  cooldownSeconds: 6 * 60,
  tickSeconds: 5,

  // Rewards / XP
  xp: {
    success: 12,
    // (optional later) fail: 0
  },

  payout: {
    min: 3500,
    max: 6500,
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
