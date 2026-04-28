// data/help/categories/general.js
module.exports = {
  id: "general",
  order: 1,
  name: "General",
  emoji: "🧭",
  blurb: "Basics, utility commands, profiles, and personal progress.",

  commands: [
    {
      id: "ping",
      name: "/ping",
      short: "Check bot responsiveness.",
      detail:
        "**/ping**\n" +
        "Use this to check if the bot is alive and responding.\n\n" +
        "**Tip:** if commands feel like they are not working, try **/ping** and see if the bot responds.",
    },
    {
      id: "inventory",
      name: "/inventory",
      short: "See what you have in your pockets.",
      detail:
        "**/inventory**\n" +
        "Shows your inventory contents, including item quantities and remaining uses for limited-use items.\n\n" +
        "You can also use the optional user field to view another player's inventory snapshot.\n\n" +
        "**Common use:** checking items before using the shop, farming, jobs, or other systems.",
    },
    {
      id: "achievements",
      name: "/achievements",
      short: "View your achievements.",
      detail:
        "**/achievements**\n" +
        "Shows your unlocked achievements and the ones you are missing.\n\n" +
        "**Note:** achievements unlock automatically from gameplay and chatting.",
    },
    {
      id: "profile",
      name: "/profile",
      short: "View a player's server profile.",
      detail:
        "**/profile**\n" +
        "Shows a server profile snapshot for you or another player.\n\n" +
        "**Tabs include:** overview, casino, jobs, economy, achievements, effects, and recent statement.\n\n" +
        "Use the optional user field to inspect another member's public profile snapshot.",
    },
  ],
};
