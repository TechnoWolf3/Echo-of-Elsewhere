// data/help/categories/community.js
module.exports = {
  id: "community",
  order: 2,
  name: "Community",
  emoji: "🌌",
  blurb: "Echo Resonance levels, rank cards, and weekly server activity.",

  commands: [
    {
      id: "community",
      name: "/community",
      short: "Open the Echo Community hub.",
      detail:
        "**/community**\n" +
        "Shows the Echo Community hub for the server.\n\n" +
        "**Includes:**\n" +
        "- Top Echo Resonance members\n" +
        "- Most active members this week\n" +
        "- Weekly server pulse stats\n\n" +
        "**Notes:**\n" +
        "- Activity is based on eligible chat and voice participation.\n" +
        "- Low-population servers may show fewer leaderboard entries until more activity is recorded.",
    },
    {
      id: "level",
      name: "/level",
      short: "Show an Echo Resonance rank card.",
      detail:
        "**/level**\n" +
        "Shows your Echo Resonance rank card.\n\n" +
        "**/level user:@someone**\n" +
        "Shows another member's Echo Resonance rank card.\n\n" +
        "**Rank card includes:**\n" +
        "- Avatar and display name\n" +
        "- Resonance title\n" +
        "- Level and server rank\n" +
        "- XP progress\n" +
        "- Total XP, messages counted, and voice time\n\n" +
        "**Notes:**\n" +
        "- Brand-new users may appear unranked until they earn XP.\n" +
        "- This is separate from **/profile**, which remains the broader server profile snapshot.",
    },
  ],
};
