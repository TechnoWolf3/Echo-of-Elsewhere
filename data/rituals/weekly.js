const { nextSydneyMondayMidnightUTC } = require("../../utils/rituals");

module.exports = {
  id: "weekly",
  placement: "primary",
  type: "weekly",
  awardSource: "weekly",
  cooldownKey: "weekly",
  name: "Weekly Ritual",
  shortName: "Weekly Ritual",
  description: "A steadier rite that returns each Sydney week.",
  payout: { min: 12000, max: 20000 },
  nextClaimAt: nextSydneyMondayMidnightUTC,
  claimText: ({ amount }) => `🕯️ Your **Weekly Ritual** is complete. Echo answers with **$${Number(amount).toLocaleString()}**.`,
  cooldownText: ({ unix }) => `⏳ Your **Weekly Ritual** has already been completed. Return <t:${unix}:R>.`,
  activityEffects: {
    effectsApply: true,
    canAwardEffects: true,
    blockedBlessings: [],
    blockedCurses: [],
    effectAwardPool: {
      nothingWeight: 70,
      blessingWeight: 30,
      curseWeight: 0,
      blessingWeights: {},
      curseWeights: {},
    },
  },
};
