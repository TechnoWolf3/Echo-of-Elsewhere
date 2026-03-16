const { nextSydneyMonthMidnightUTC } = require('../../utils/rituals');

module.exports = {
  id: 'monthly',
  name: 'Monthly Ritual',
  shortName: 'Monthly',
  description: 'A heavier monthly rite with a payout worthy of waiting for it.',
  placement: 'primary',
  emoji: '🌙',
  cooldownKey: 'monthly',
  type: 'monthly',
  awardSource: 'monthly',
  payout: {
    min: 125000,
    max: 300000,
  },
  nextClaimAt: nextSydneyMonthMidnightUTC,
  cooldownText: ({ unix }) => `⏳ The monthly ritual has already been called. Return <t:${unix}:R>.`,
  claimText: ({ amount }) => `🌙 Monthly Ritual completed: **$${Number(amount || 0).toLocaleString()}** is bestowed in one heavy, satisfying drop.`,
  activityEffects: {
    effectsApply: true,
    canAwardEffects: true,
    blockedBlessings: [],
    blockedCurses: [],
    effectAwardPool: {
      nothingWeight: 0,
      blessingWeight: 100,
      curseWeight: 0,
      blessingWeights: {},
      curseWeights: {},
    },
  },
};
