const daily = require("../data/rituals/daily");
const weekly = require("../data/rituals/weekly");
const monthly = require("../data/rituals/monthly");
const insideTrackConfig = require("../data/games/casino/insideTrackConfig");
const lotteryConfig = require("../data/lottery/config");
const { CASINO_SECURITY } = require("./casinoSecurity");
const { BOND_CONFIG } = require("../data/community/bondsConfig");
const { STANDING_CONFIG, STANDING_TIERS } = require("../data/community/standingConfig");

const CONFIG_VERSION = "2026-05-27.1";

const CONFIG = Object.freeze({
  configVersion: CONFIG_VERSION,
  modifiers: {
    jobLevel: {
      xpToNextFormula: "100 + ((level - 1) * 60)",
      payoutMultiplierFormula: "min(1.6, 1 + 0.02 * (level - 1))",
      maxPayoutMultiplier: 1.6,
    },
    legendaryJob: {
      chance: 0.012,
      payout: { min: 50000, max: 90000 },
      skillTimeMs: 7000,
    },
    globalLegalJobBonus: {
      chance: 0.04,
      payout: { min: 400, max: 2000 },
    },
    bonds: {
      sharedCasinoMinimumStake: BOND_CONFIG.casinoMinimumStake,
      maxJobPayoutPct: BOND_CONFIG.maxBonuses.jobPayoutPct,
      maxJobXpPct: BOND_CONFIG.maxBonuses.jobXpPct,
      maxCasinoProfitPct: BOND_CONFIG.maxBonuses.casinoProfitPct,
      xp: BOND_CONFIG.xp,
      dailyCaps: BOND_CONFIG.dailyCaps,
    },
    standing: {
      min: STANDING_CONFIG.min,
      max: STANDING_CONFIG.max,
      positiveDailyCap: STANDING_CONFIG.positiveDailyCap,
      negativeDailyCap: STANDING_CONFIG.negativeDailyCap,
      decayAmountPerDay: STANDING_CONFIG.decayAmountPerDay,
      tiers: STANDING_TIERS,
    },
  },

  jobs: {
    nineToFive: {
      shift: {
        cooldownSeconds: 6 * 60,
        durationSeconds: 45,
        tickSeconds: 5,
        payout: { min: 3500, max: 6500 },
        xp: { success: 12 },
      },
      skillCheck: {
        cooldownSeconds: 5 * 60,
        timeLimitSeconds: 18,
        memorizeSeconds: 3.5,
        patternLength: 3,
        payout: { success: { min: 2000, max: 4000 }, fail: { min: 50, max: 220 } },
        xp: { success: 10, fail: 3, legendary: 30 },
      },
      transportContract: {
        cooldownSeconds: 10 * 60,
        basePayout: { min: 1575, max: 2625 },
        failConsolation: { min: 60, max: 260 },
        xp: { success: 15, fail: 4 },
        steps: {
          route: [
            { id: "highway", modifier: { min: 0, max: 340 }, risk: 0.02 },
            { id: "backstreets", modifier: { min: 170, max: 590 }, risk: 0.06 },
            { id: "scenic", modifier: { min: -80, max: 380 }, risk: 0.01 },
            { id: "vip_lane", unlockLevel: 10, modifier: { min: 340, max: 880 }, risk: 0.08 },
            { id: "hot_route", unlockLevel: 20, modifier: { min: 630, max: 1470 }, risk: 0.14 },
          ],
          handling: [
            { id: "careful", modifier: { min: 80, max: 380 }, risk: 0.01 },
            { id: "fast", modifier: { min: 250, max: 710 }, risk: 0.08 },
            { id: "standard", modifier: { min: 0, max: 340 }, risk: 0.03 },
            { id: "insured_vip", modifier: { min: 250, max: 670 }, risk: 0.04 },
            { id: "fragile_danger", modifier: { min: 550, max: 1300 }, risk: 0.16 },
          ],
          delivery: [
            { id: "signature", modifier: { min: 150, max: 460 }, risk: 0.03 },
            { id: "doorstep", modifier: { min: 0, max: 360 }, risk: 0.05 },
            { id: "priority", modifier: { min: 290, max: 800 }, risk: 0.10 },
            { id: "vip_priority", modifier: { min: 500, max: 1260 }, risk: 0.12 },
            { id: "black_ops", modifier: { min: 840, max: 1890 }, risk: 0.20 },
          ],
        },
      },
      trucker: {
        payoutPerKm: 12,
        minimumDurationMinutes: 3,
        durationMinutesPerKm: 0.01,
        xp: { success: 18 },
      },
      emailSorter: {
        cooldownSeconds: 8 * 60,
        emailsPerRun: 3,
        guaranteedScamEmails: 1,
        runCompletion: { min: 750, max: 1500 },
        correctEmail: { min: 1000, max: 2000 },
        scamPenalty: { min: 180, max: 360 },
        perfectBonusPct: 0,
        xp: { success: 16, partial: 9, fail: 4 },
      },
    },
    nightWalker: {
      flirt: { cooldownSeconds: 5 * 60, rounds: 5, failAfterWrong: 2, payout: { min: 2000, max: 3000 }, xp: { success: 14, fail: 4 } },
      lapDance: { cooldownSeconds: 7 * 60, rounds: 5, failAtPenaltyTokens: 3, payout: { min: 4000, max: 5000 }, xp: { success: 16, fail: 5 } },
      prostitute: { cooldownSeconds: 10 * 60, rounds: 4, basePayout: { min: 4000, max: 6000 }, payoutVariancePct: 5, xp: { success: 18, fail: 6 } },
    },
  },

  crime: {
    globalLockoutSeconds: 15 * 60,
    storeRobbery: {
      cooldownSeconds: 15 * 60,
      payout: { min: 9000, max: 18000 },
      partialMultiplier: 0.75,
      fine: { min: 3000, max: 8000 },
      bustedHardFineMultiplier: 1.1,
      jailChance: { busted: 0.18, bustedHard: 0.28 },
      jailMinutes: { min: 5, max: 15 },
      heatDrift: { clean: -8, spotted: 5, partial: 12, busted: 22, bustedHard: 35 },
    },
    heist: {
      standard: {
        cooldownSeconds: 12 * 60 * 60,
        payout: {
          clean: { min: 39900, max: 59850 },
          spotted: { min: 29260, max: 47880 },
          partial: { min: 7980, max: 23940 },
        },
        fine: { min: 12000, max: 30000 },
        jailChance: { busted: 0.45, bustedHard: 0.65 },
        jailMinutes: { min: 20, max: 35 },
      },
      major: {
        cooldownSeconds: 24 * 60 * 60,
        payout: {
          clean: { min: 73150, max: 133000 },
          spotted: { min: 63840, max: 99750 },
          partial: { min: 33250, max: 53200 },
        },
        fine: { min: 12000, max: 30000 },
        jailChance: { busted: 0.55, bustedHard: 0.75 },
        jailMinutes: { min: 45, max: 60 },
      },
      lootDrop: { chance: 0.14, amount: { min: 1500, max: 6000 } },
      valuableFind: { chance: 0.12, amount: { min: 1200, max: 6500 } },
      heatDrift: { clean: -10, spotted: 8, partial: 18, busted: 30, bustedHard: 40 },
    },
    bribeOfficer: {
      cooldownSeconds: 30 * 60,
      costs: { low: 5000, medium: 12500, high: 25000 },
      trustedContact: { chance: 0.08, successBonus: 0.12, cap: 0.95 },
    },
    layLow: {
      cooldownSeconds: 30 * 60,
      cashPayout: 0,
      decisions: 4,
    },
  },

  grind: {
    sharedCooldownSeconds: 45,
    fatigueSharedAcrossJobs: true,
    overtimeHardcapMultiplier: 1.5,
    warehousing: {
      basePay: { min: 250, max: 550 },
      streakMultipliers: [
        { minStreak: 0, multiplier: 1.0 },
        { minStreak: 6, multiplier: 1.15 },
        { minStreak: 11, multiplier: 1.3 },
        { minStreak: 16, multiplier: 1.45 },
      ],
      overtimeMultiplier: 1.6,
      events: [
        { id: "rush", chance: 0.08, orders: 3, payMultiplier: 2.0, timerDeltaSeconds: -2 },
        { id: "vip", chance: 0.04, orders: 1, payMultiplier: 2.5, timerDeltaSeconds: -1 },
        { id: "supervisor", chance: 0.04, orders: 2, payMultiplier: 1.25, failEndsInOvertime: true },
      ],
    },
    fishing: {
      normalStreakBonusCap: 0.25,
      rareBaseMultiplier: 1.2,
      rareStreakBonusCap: 0.35,
      legendaryBaseMultiplier: 1.6,
      legendaryStreakBonusCap: 0.45,
      overtimeRareBoost: 0.03,
      overtimeLegendaryBoost: 0.01,
      legendaryUltraChance: 0.05,
      slippedLegendaryMultiplier: 0.7,
    },
  },

  casino: {
    cards: {
      ranks: ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"],
      suits: ["Clubs", "Diamonds", "Hearts", "Spades"],
    },
    blackjack: {
      minBet: 500,
      maxBet: 250000,
      ttlSeconds: 15 * 60,
      tableTtlSeconds: 2 * 60 * 60,
      turnTimeoutSeconds: 60,
      payouts: { loss: 0, push: 1, win: 2, blackjack: 2.5 },
      splitNaturalBlackjackPaysAsNormalWin: true,
      doubleDown: { extraStakeMultiplier: 1 },
    },
    higherLower: {
      minBet: 500,
      maxBet: 250000,
      ttlSeconds: 15 * 60,
      tableTtlSeconds: 2 * 60 * 60,
      maxPlayers: 10,
      allowedPicks: ["higher", "lower", "same"],
      cashout: { baseMultiplier: 1, perStreak: 0.5, maxMultiplier: 10 },
    },
    roulette: {
      minBet: 500,
      maxBet: 250000,
      wheel: "european_0_36",
      payouts: { evenMoney: 2, number: 36 },
    },
    keno: {
      bettingSeconds: 30,
      drawCount: 20,
      headsTailsDrawPayouts: { heads: 2, tails: 2, draw: 4 },
      classicPayouts: {
        1: { 1: 3.5 },
        2: { 2: 10, 1: 1 },
        3: { 3: 25, 2: 2 },
        4: { 4: 75, 3: 5, 2: 1 },
        5: { 5: 250, 4: 15, 3: 2 },
        6: { 6: 800, 5: 50, 4: 5, 3: 1 },
        7: { 7: 2000, 6: 120, 5: 15, 4: 2 },
        8: { 8: 5000, 7: 400, 6: 50, 5: 10, 4: 2 },
        9: { 9: 10000, 8: 1000, 7: 120, 6: 25, 5: 5, 4: 1 },
        10: { 10: 25000, 9: 2500, 8: 400, 7: 80, 6: 20, 5: 5, 4: 1 },
      },
    },
    insideTrack: {
      minBet: insideTrackConfig.minBet,
      maxBet: insideTrackConfig.maxBet,
      standardHorseCount: insideTrackConfig.standardHorseCount,
      majorHorseCount: insideTrackConfig.majorHorseCount,
      majorRaceChance: insideTrackConfig.majorRaceChance,
      mobileTimingSeconds: { betting: 120, racing: 45, results: 15, tick: 5 },
      discordTimingSeconds: {
        standardBetting: insideTrackConfig.timing.standardBettingMs / 1000,
        standardRace: insideTrackConfig.timing.standardRaceMs / 1000,
        majorBetting: insideTrackConfig.timing.majorBettingMs / 1000,
        majorRace: insideTrackConfig.timing.majorRaceMs / 1000,
        cooldown: insideTrackConfig.timing.cooldownMs / 1000,
      },
      payoutMultipliers: insideTrackConfig.payoutMultipliers,
      odds: insideTrackConfig.odds,
      trackConditions: insideTrackConfig.trackConditions,
      majorRaces: insideTrackConfig.majorRaces,
    },
    scratchcards: {
      pocket: { cost: 500, maxListedPayout: 1800, bonuses: [{ condition: "eyes >= 3 and payout > 0", amount: 250 }] },
      lucky: { cost: 1500, maxListedPayout: 6200, bonuses: [{ condition: "clovers >= 2 and payout > 0", amount: 300 }] },
      cursed: {
        cost: 3000,
        maxListedPayout: 11000,
        bonuses: [{ condition: "fire >= 2 and payout > 0", chance: 0.35, amount: 900 }],
        penalties: [{ condition: "skulls >= 2 and payout > 0", chance: 0.28, amount: -1200 }],
        rescue: { condition: "eyes >= 3 and no payout", chance: 0.12, payout: 4500 },
      },
    },
    echoWhisper: { optionalBettingEnabled: true, payoutMultiplier: 2 },
    security: CASINO_SECURITY,
  },

  rituals: {
    daily: { payout: daily.payout, reset: "sydney_midnight" },
    weekly: { payout: weekly.payout, reset: "sydney_monday_midnight" },
    monthly: { payout: monthly.payout, reset: "sydney_month_start" },
    echoWheel: {
      cost: 10000,
      reset: "sydney_midnight",
      displayOutcomes: [
        { id: "cash_10000", amount: 10000 },
        { id: "cash_25000", amount: 25000 },
        { id: "jackpot", amount: 125000 },
        { id: "bank_error", bankAmount: 175000 },
        { id: "server_bank_blessing", amount: 250000 },
        { id: "echo_blessing_cash", amount: 90000 },
        { id: "damage", amount: -7500 },
        { id: "jail", jailMinutes: { min: 5, max: 10 } },
        { id: "void_spin", note: "Consumes current wallet." },
      ],
    },
    echoCipher: { codeLength: 5, attempts: 6, rewardByAttempt: [100000, 85000, 70000, 55000, 45000, 35000], failJailMinutes: { min: 5, max: 10 } },
    veilSequence: { rewardByCorrectPositions: { 5: 85000, 3: 55000, 2: 30000, 1: 12000, 0: 0 }, note: "Current Discord config has no explicit 4-correct reward." },
    bladeGrid: { grid: { rows: 3, columns: 5 }, payout: { min: 60000, max: 90000 } },
    echoArrangement: { rewardFormula: "round((8000 + seatCount * 6500) * perfectMultiplier * max(0.65, 1 - mistakesUsed * 0.12))" },
  },

  lottery: {
    ticketPrice: lotteryConfig.ticketPrice,
    maxTicketsPerUser: lotteryConfig.maxTicketsPerUser,
    timezone: lotteryConfig.timezone,
    drawWeekday: lotteryConfig.drawWeekday,
    drawHour: lotteryConfig.drawHour,
    drawMinute: lotteryConfig.drawMinute,
    salesCloseHoursBefore: lotteryConfig.salesCloseHoursBefore,
    allocation: lotteryConfig.allocation,
    seed: lotteryConfig.seed,
    rollover: lotteryConfig.rollover,
    balls: lotteryConfig.balls,
    divisionWeights: lotteryConfig.divisionWeights,
  },

  xp: {
    jobProgressionFormula: "100 + ((level - 1) * 60)",
  },

  cooldowns: {
    jobFallbackSeconds: 45,
    crimeGlobalSeconds: 15 * 60,
    grindSharedSeconds: 45,
  },
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getPublicGameConfig() {
  const safe = clone(CONFIG);
  if (safe.casino?.security) {
    delete safe.casino.security.typePrefixes;
    delete safe.casino.security.minFeePct;
    delete safe.casino.security.maxFeePct;
  }
  return safe;
}

function getCasinoBetLimits(game) {
  const cfg = CONFIG.casino[game] || {};
  return { minBet: Number(cfg.minBet || 0), maxBet: Number(cfg.maxBet || 0) };
}

function blackjackPayout(result, bet) {
  const stake = Math.max(0, Math.floor(Number(bet || 0)));
  const key = result === "blackjack_win" ? "blackjack" : result;
  const multiplier = Number(CONFIG.casino.blackjack.payouts[key] || 0);
  return Math.floor(stake * multiplier);
}

function higherLowerMultiplier(streak) {
  const cfg = CONFIG.casino.higherLower.cashout;
  return Math.min(cfg.maxMultiplier, cfg.baseMultiplier + Number(streak || 0) * cfg.perStreak);
}

function higherLowerCashoutValue(bet, streak) {
  return Math.floor(Math.max(0, Number(bet || 0)) * higherLowerMultiplier(streak));
}

module.exports = {
  CONFIG_VERSION,
  CONFIG,
  getPublicGameConfig,
  getCasinoBetLimits,
  blackjackPayout,
  higherLowerMultiplier,
  higherLowerCashoutValue,
};
