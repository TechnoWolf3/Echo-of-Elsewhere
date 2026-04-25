// data/nineToFive/transportContract.js
module.exports = {
  // UI
  titlePrefix: "📦", // used in step titles if you want
  footer: "Finish all 3 steps to get paid.",

  // Rewards / XP (matches what you had)
  xp: {
    success: 15,
    fail: 4, // consolation XP (does NOT count as a completed job)
  },

  // Base pay before bonuses from choices
  basePay: {
    min: 1575,
    max: 2625,
  },

  cooldownSeconds: 10 * 60,

  // When a contract fails, you still pay a small consolation amount (does NOT count as a job)
  consolationPay: {
    min: 60,
    max: 260,
  },

  // Unlock rules
  unlocks: {
    vipLevel: 10,
    dangerLevel: 20,
  },

  // Contract steps (non-repeating labels; pick what feels fun)
  steps: [
    {
      title: "📦 Step 1/3 — Pick your route",
      desc: "How are you getting there?",
      baseChoices: [
        { id: "highway", label: "Highway", modMin: 0, modMax: 340, risk: 0.02 },
        { id: "backstreets", label: "Backstreets", modMin: 170, modMax: 590, risk: 0.06 },
        { id: "scenic", label: "Scenic", modMin: -80, modMax: 380, risk: 0.01 },
      ],
      vipChoices: [
        { id: "viplane", label: "VIP Lane", modMin: 340, modMax: 880, risk: 0.08 },
      ],
      dangerChoices: [
        { id: "hotroute", label: "Hot Route", modMin: 630, modMax: 1470, risk: 0.14 },
      ],
    },
    {
      title: "📦 Step 2/3 — Handling",
      desc: "Package handling style?",
      baseChoices: [
        { id: "careful", label: "Careful", modMin: 80, modMax: 380, risk: 0.01 },
        { id: "fast", label: "Fast", modMin: 250, modMax: 710, risk: 0.08 },
        { id: "standard", label: "Standard", modMin: 0, modMax: 340, risk: 0.03 },
      ],
      vipChoices: [
        { id: "insured", label: "Insured Handling", modMin: 250, modMax: 670, risk: 0.04 },
      ],
      dangerChoices: [
        { id: "fragile", label: "Ultra Fragile", modMin: 550, modMax: 1300, risk: 0.16 },
      ],
    },
    {
      title: "📦 Step 3/3 — Delivery",
      desc: "How do you finish it?",
      baseChoices: [
        { id: "signature", label: "Signature", modMin: 150, modMax: 460, risk: 0.03 },
        { id: "doorstep", label: "Doorstep", modMin: 0, modMax: 360, risk: 0.05 },
        { id: "priority", label: "Priority", modMin: 290, modMax: 800, risk: 0.10 },
      ],
      vipChoices: [
        { id: "vipdrop", label: "VIP Priority", modMin: 500, modMax: 1260, risk: 0.12 },
      ],
      dangerChoices: [
        { id: "blackops", label: "Black Ops Drop", modMin: 840, modMax: 1890, risk: 0.20 },
      ],
    },
  ],

  activityEffects: {
    effectsApply: true,
    canAwardEffects: true,
    blockedBlessings: [],
    blockedCurses: [],
    effectAwardPool: {
      nothingWeight: 100,
      blessingWeight: 0,
      curseWeight: 0,
      blessingWeights: {},
      curseWeights: {},
    },
  },
};
