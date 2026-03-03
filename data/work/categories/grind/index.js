// data/work/categories/grind/index.js
module.exports = {
  category: {
    title: "🕒 Grind",
    description: "Longer jobs that build fatigue. At 100% fatigue you should rest — you can push on, but mistakes can end your shift with a recovery lockout.",
    footer: "Fatigue is shared across all Grind jobs.",
  },

  list: ["storeClerk", "warehousing", "fishing", "quarry"],

  jobs: {
    storeClerk: {
      title: "🏪 Store Clerk",
      desc: "Process customers and calculate change.",
      buttonId: "grind:clerk",
    },
    warehousing: {
      title: "📦 Warehousing",
      desc: "Timed orders with streak multipliers (Picker/Packer or Forklift).",
      buttonId: "grind:warehousing",
    },
    fishing: {
      title: "🎣 Fishing",
      desc: "Cast, react to bites, and chase rare/legendary catches.",
      buttonId: "grind:fishing",
    },
    quarry: {
      title: "🪨 Quarry",
      desc: "Prospect dig sites and go deeper for better finds (watch the cave-in risk).",
      buttonId: "grind:quarry",
    },
  },
};
