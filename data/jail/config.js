module.exports = {
  sentence: {
    smallCrimeMinutes: [5, 15],
    mediumCrimeMinutes: [20, 35],
    majorCrimeMinutes: [45, 60],
    reductionCapPercent: 0.55,
  },

  bail: {
    baseCostPerMinute: 900,
    minimumCost: 5000,
    severityMultipliers: {
      small: 1,
      medium: 1.15,
      major: 1.35,
      rift: 1.25,
      underworld: 1.45,
      admin: 1,
    },
  },

  work: {
    baseCooldownSeconds: 75,
    maxCooldownSeconds: 180,
    heavyWorkCount: 16,
    payoutRange: [80, 180],
    reductionSecondsRange: [30, 90],
    failurePayoutRange: [0, 35],
    diminishingReturns: [
      { afterTasks: 0, payoutMultiplier: 1.0, reductionMultiplier: 1.0 },
      { afterTasks: 6, payoutMultiplier: 0.85, reductionMultiplier: 0.75 },
      { afterTasks: 12, payoutMultiplier: 0.65, reductionMultiplier: 0.5 },
      { afterTasks: 20, payoutMultiplier: 0.5, reductionMultiplier: 0.35 },
    ],
    tasks: {
      kitchen: {
        name: "Kitchen Duty",
        description: "Memorise the tray order before the cook starts yelling.",
        payoutRange: [95, 180],
        reductionSecondsRange: [35, 85],
      },
      laundry: {
        name: "Laundry Sorting",
        description: "Follow the sorting rule. The machines are older than the prison.",
        payoutRange: [85, 165],
        reductionSecondsRange: [30, 75],
      },
      cells: {
        name: "Cleaning Cells",
        description: "Pick a spot to clean. Some corners bite back.",
        payoutRange: [80, 175],
        reductionSecondsRange: [30, 90],
      },
      supply: {
        name: "Supply Run",
        description: "Choose a route through the block and hope nobody notices.",
        payoutRange: [90, 200],
        reductionSecondsRange: [35, 95],
      },
      workshop: {
        name: "Workshop Duty",
        description: "Build the thing in the right order. Yes, the guard is watching.",
        payoutRange: [95, 190],
        reductionSecondsRange: [40, 95],
      },
      yard: {
        name: "Yard Work",
        description: "Choose how hard to work without becoming the entertainment.",
        payoutRange: [80, 210],
        reductionSecondsRange: [25, 100],
      },
    },
  },

  shop: {
    items: {
      energy_drink: {
        name: "Energy Drink",
        price: 250,
        type: "effect",
        description: "Next 3 work tasks have reduced cooldown.",
        effect: { cooldownMultiplier: 0.6, workUses: 3 },
      },
      guard_snack: {
        name: "Guard's Favourite Snack",
        price: 350,
        type: "use",
        description: "Random small favour, confiscation, or tiny kickback.",
      },
      broken_laptop: {
        name: "Broken Laptop",
        price: 700,
        type: "use",
        description: "Edit your report for 2-5 minutes off, respecting the cap.",
      },
      fake_id_band: {
        name: "Fake ID Band",
        price: 700,
        type: "use",
        description: "Shaves a small amount from your paperwork sentence.",
      },
      contraband_radio: {
        name: "Contraband Radio",
        price: 900,
        type: "unlock",
        description: "Better rumours. Slightly improves work payouts this session.",
      },
      deck_of_cards: {
        name: "Deck of Cards",
        price: 1000,
        type: "unlock",
        description: "Unlocks NPC card-table gambling while jailed.",
      },
      escape_kit: {
        name: "Escape Kit",
        price: 1300,
        type: "escape",
        description: "Boosts one escape attempt, then is consumed.",
        escapeBonus: 0.18,
      },
      loose_vent_cover: {
        name: "Loose Vent Cover",
        price: 1450,
        type: "escape",
        description: "Big escape boost, harsher failure.",
        escapeBonus: 0.26,
        failurePenaltyMultiplier: 1.35,
      },
      burner_phone: {
        name: "Burner Phone",
        price: 850,
        type: "use",
        description: "Call in a favour. Outcomes vary.",
      },
      shank: {
        name: "Shank",
        price: 2000,
        type: "unlock",
        description: "Session-only contraband for future prison trouble.",
      },
    },
  },

  escape: {
    baseChance: 0.18,
    maxChance: 0.65,
    failureExtraMinutesRange: [10, 20],
    failureFineRange: [2500, 9000],
    heatOnFailure: 75,
    heatOnSuccess: 45,
    cooldownSeconds: 180,
    attemptsPenalty: 0.04,
  },

  gambling: {
    minBet: 25,
    maxBet: 500,
    npcMaxBet: 250,
    houseEdgeChance: 0.05,
  },

  effects: {
    blessings: {
      good_behaviour: { name: "Good Behaviour", reductionMultiplier: 1.12 },
      greased_palms: { name: "Greased Palms", bailMultiplier: 0.9 },
      quiet_cellblock: { name: "Quiet Cellblock", cooldownMultiplier: 0.85 },
      paperwork_error: { name: "Paperwork Error", instantReductionSeconds: [45, 120] },
    },
    curses: {
      marked_inmate: { name: "Marked Inmate", cooldownMultiplier: 1.2 },
      strict_warden: { name: "Strict Warden", reductionMultiplier: 0.85 },
      bad_paperwork: { name: "Bad Paperwork", bailMultiplier: 1.15 },
      watched_closely: { name: "Watched Closely", escapePenalty: 0.08 },
    },
  },

  events: {
    chancePerHubOpen: 0.08,
    minimumMinutesBetweenEvents: 8,
  },
};
