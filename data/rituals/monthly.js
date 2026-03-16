const { nextSydneyMonthMidnightUTC } = require("../../utils/rituals");

module.exports = {
  id: "monthly",
  placement: "primary",
  type: "monthly",
  awardSource: "monthly",
  cooldownKey: "monthly",
  name: "Monthly Ritual",
  shortName: "Monthly Ritual",
  description: "A heavier rite paid out once each Sydney month.",
  payout: { min: 125000, max: 300000 },
  nextClaimAt: nextSydneyMonthMidnightUTC,
  claimText: ({ amount }) => `🕯️ The **Monthly Ritual** is complete. Echo grants **$${Number(amount).toLocaleString()}**.`,
  cooldownText: ({ unix }) => `⏳ The **Monthly Ritual** is not ready yet. Return <t:${unix}:R>.`,
  activityEffects: {
    effectsApply: true,
    canAwardEffects: true,
    blockedBlessings: [],
    blockedCurses: [],
    effectAwardPool: {
      nothingWeight: 65,
      blessingWeight: 35,
      curseWeight: 0,
      blessingWeights: {},
      curseWeights: {},
    },
  },
};
