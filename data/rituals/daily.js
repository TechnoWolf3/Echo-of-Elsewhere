const { nextSydneyMidnightUTC } = require("../../utils/rituals");

module.exports = {
  id: "daily",
  placement: "primary",
  type: "daily",
  awardSource: "daily",
  cooldownKey: "daily",
  name: "Daily Ritual",
  shortName: "Daily Ritual",
  description: "A smaller rite performed once each Sydney day.",
  payout: { min: 2500, max: 5000 },
  nextClaimAt: nextSydneyMidnightUTC,
  claimText: ({ amount }) => `🕯️ Your **Daily Ritual** is complete. Echo places **$${Number(amount).toLocaleString()}** in your hands.`,
  cooldownText: ({ unix }) => `⏳ Your **Daily Ritual** is already complete. Return <t:${unix}:R>.`,
  activityEffects: {
    effectsApply: true,
    canAwardEffects: true,
    blockedBlessings: [],
    blockedCurses: [],
    effectAwardPool: {
      nothingWeight: 75,
      blessingWeight: 25,
      curseWeight: 0,
      blessingWeights: {},
      curseWeights: {},
    },
  },
};
