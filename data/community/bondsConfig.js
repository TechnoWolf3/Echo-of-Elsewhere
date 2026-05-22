const BOND_LEVELS = [
  { level: 0, name: "Strangers", xp: 0 },
  { level: 1, name: "Seen Around", xp: 100 },
  { level: 2, name: "Casual Mates", xp: 300 },
  { level: 3, name: "Decent Mates", xp: 650 },
  { level: 4, name: "Proper Mates", xp: 1150 },
  { level: 5, name: "Ride or Die", xp: 1850 },
  { level: 6, name: "Absolute Menaces", xp: 2800 },
  { level: 7, name: "Certified Duo", xp: 4000 },
  { level: 8, name: "Two-Person Problem", xp: 5500 },
  { level: 9, name: "Server Warning Label", xp: 7250 },
  { level: 10, name: "Echo's Favourite Mistake", xp: 9500 },
];

const BOND_CONFIG = {
  enabled: true,
  maxLevel: 10,
  casinoMinimumStake: 500,
  xp: {
    sharedCasinoGame: 2,
    sharedCasinoWinBonus: 1,
    sharedLegalJob: 4,
    sharedGroupGame: 4,
    sharedCommunityEvent: 6,
    firstSharedActivityDailyBonus: 5,
  },
  dailyCaps: {
    total: 75,
    casino: 20,
    job: 30,
    game: 30,
    community: 30,
    repeatedSameActivity: 20,
  },
  maxBonuses: {
    jobPayoutPct: 8,
    jobXpPct: 5,
    casinoProfitPct: 5,
  },
};

module.exports = {
  BOND_LEVELS,
  BOND_CONFIG,
};
