// data/nineToFive/shift.js
module.exports = {
  effectConfig: {
    key: "shift",
    name: "Shift",
    effectsApply: true,
    canAwardEffects: true,
    blockedBlessings: [],
    blockedCurses: [],
    effectAwardPool: { nothingWeight: 100, blessingWeight: 0, curseWeight: 0, weightOverrides: {} },
  },
  // UI
  title: "🕒 Shift",
  inProgressTitle: "🕒 Shift In Progress",
  completeTitle: "🕒 Shift Complete",
  footer: "Stay on the board. Collect when ready.",

  // Timing
  durationSeconds: 45,
  tickSeconds: 5,

  // Rewards / XP
  xp: {
    success: 12,
    // (optional later) fail: 0
  },

  payout: {
    min: 1200,
    max: 2600,
  },
};
