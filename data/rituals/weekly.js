const { nextSydneyMondayMidnightUTC } = require('../../utils/rituals');

module.exports = {
  id: 'weekly',
  name: 'Weekly Ritual',
  shortName: 'Weekly',
  description: 'A larger weekly observance for those willing to keep showing up.',
  placement: 'primary',
  emoji: '🗓️',
  cooldownKey: 'weekly',
  type: 'weekly',
  awardSource: 'weekly',
  payout: {
    min: 12500,
    max: 25000,
  },
  nextClaimAt: nextSydneyMondayMidnightUTC,
  cooldownText: ({ unix }) => `⏳ Your weekly ritual is still settling. Return <t:${unix}:R>.`,
  claimText: ({ amount }) => `🗓️ Weekly Ritual completed: **$${Number(amount || 0).toLocaleString()}** answers your continued devotion.`,
  activityEffects: {
    effectsApply: true,
    canAwardEffects: true,
    blockedBlessings: [],
    blockedCurses: [],
    effectAwardPool: {
      nothingWeight: 50,
      blessingWeight: 50,
      curseWeight: 0,
      blessingWeights: {},
      curseWeights: {},
    },
  },
};
