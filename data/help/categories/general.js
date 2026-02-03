// data/help/categories/general.js
module.exports = {
  id: "general",
  order: 1,
  name: "General",
  emoji: "🧭",
  blurb: "Basics and utility commands.",

  commands: [
    {
      id: "ping",
      name: "/ping",
      short: "Check bot latency / responsiveness.",
      detail:
        "**/ping**\n" +
        "Use this to check if the bot is alive and responding.\n\n" +
        "**Tip:** If commands feel slow, try /ping and report the result to staff.",
    },
    {
      id: "inventory",
      name: "/inventory",
      short: "View what you’re carrying / stored.",
      detail:
        "**/inventory**\n" +
        "Shows your inventory contents.\n\n" +
        "**Common use:** checking items before using the shop or jobs.",
    },
    {
      id: "achievements",
      name: "/achievements",
      short: "View your achievements and progress.",
      detail:
        "**/achievements**\n" +
        "Shows unlocked achievements and progress toward others.\n\n" +
        "**Note:** Achievements may unlock automatically from gameplay.",
    },
  ],
};
