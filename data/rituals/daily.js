const { nextSydneyMidnightUTC } = require('../../utils/rituals');

module.exports = {
  id: 'daily',
  name: 'Daily Ritual',
  shortName: 'Daily',
  description: 'A modest daily rite for those who like their coin with a touch of ceremony.',
  placement: 'primary',
  emoji: '🎁',
  cooldownKey: 'daily',
  type: 'daily',
  awardSource: 'daily',
  payout: {
    min: 2500,
    max: 5000,
  },
  nextClaimAt: nextSydneyMidnightUTC,
  cooldownText: ({ unix }) => `⏳ Your daily ritual has already been completed. Return <t:${unix}:R>.`,
  claimText: ({ amount }) => `🎁 Daily Ritual completed: **$${Number(amount || 0).toLocaleString()}** has been placed in your hands.`,
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
