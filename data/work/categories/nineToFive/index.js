// data/nineToFive/index.js
module.exports = {
  category: {
    id: "nineToFive",
    title: "📦 Work a 9–5",
    description: "Classic work. Steady pay.",
    footer: "Cooldown blocks payouts, not browsing.",
  },

  // What appears on the Work a 9–5 board (order matters)
  jobs: [
    {
      key: "transportContract",
      title: "🚚 Transport Contract",
      desc: "3-step choices (risk/reward).",
      button: { id: "job_95:contract", label: "🚚 Transport" },
    },
    {
      key: "skillCheck",
      title: "🧩 Skill Check",
      desc: "Quick test — win or lose.",
      button: { id: "job_95:skill", label: "🧩 Skill Check" },
    },
    {
      key: "shift",
      title: "🕒 Shift",
      desc: "Wait it out, then Collect Pay.",
      button: { id: "job_95:shift", label: "🕒 Shift" },
    },
    {
      key: "emailSorter",
      title: "📧 Email Sorter",
      desc: "Read the email, trust the clues, sort the folder.",
      button: { id: "job_95:emailSorter", label: "📧 Email Sorter" },
    },
    {
      key: "trucker",
      title: "🚛 Trucker",
      desc: "Random freight manifest. Long haul, bigger pay.",
      button: { id: "job_95:trucker", label: "🚛 Trucker" },
    },
  ],

  // Optional: if you want Legendary to appear as part of this category
  legendary: {
    enabled: true,
    button: { id: "job_95:legendary", label: "🌟 Legendary" },
    // (future) you could add unlock rules here if you want
  },
};
