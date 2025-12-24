// data/grind/index.js
module.exports = {
  category: {
    title: "🕒 Grind",
    description: "Longer jobs that build fatigue. When you hit 100% fatigue, all Grind jobs lock while you recover.",
    footer: "Fatigue is shared across all Grind jobs.",
  },

  list: ["storeClerk"],

  jobs: {
    storeClerk: {
      title: "🏪 Store Clerk",
      desc: "Process customers and calculate change.",
      buttonId: "grind:clerk",
    },
  },
};
