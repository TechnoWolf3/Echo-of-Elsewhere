// data/features/categories/community.js
module.exports = {
  id: "community",
  order: 2,
  name: "Echo Community",
  emoji: "🌌",
  blurb: "Server activity, Echo Resonance levels, rank cards, and weekly pulse.",
  description:
    "Echo Community is the server presence layer. It watches eligible chat and voice activity, turns that activity into Echo Resonance XP, and gives members a clean way to see who has been most active around The Place.",

  items: [
    {
      id: "community_hub",
      name: "/community",
      short: "Open the Echo Community hub for leaderboards and weekly pulse.",
      detail:
        "**/community** opens the Echo Community hub.\n\n" +
        "It shows the top Echo Resonance members, the most active members this week, and server pulse stats such as messages counted, voice time, and level-ups.\n\n" +
        "This is the public overview for community activity without adding a pile of extra commands.",
    },
    {
      id: "echo_resonance",
      name: "Echo Resonance",
      short: "The community XP and leveling system for activity in chat and voice.",
      detail:
        "Echo Resonance is Echo's community leveling system.\n\n" +
        "Members earn XP from eligible chat activity and eligible voice activity. As total XP grows, members level up and move through themed Resonance titles such as New Voice, Echo-Touched, and The Echo Remembers.\n\n" +
        "Level-up announcements may appear when someone reaches a new level, depending on server configuration.",
    },
    {
      id: "level_card",
      name: "/level",
      short: "Show your Echo Resonance rank card, or view another member's.",
      detail:
        "**/level** shows your Echo Resonance rank card.\n\n" +
        "**/level user:@someone** shows another member's card.\n\n" +
        "The rank card shows avatar, display name, Resonance title, level, server rank, XP progress, total XP, messages counted, and voice time.",
    },
    {
      id: "weekly_activity",
      name: "Weekly Activity",
      short: "Rolling weekly stats power the active-this-week leaderboard.",
      detail:
        "Echo Community uses recent activity to show a rolling weekly picture of the server.\n\n" +
        "The weekly view focuses on XP gained, eligible messages, eligible voice time, and level-ups. This keeps the hub useful for both long-term members and people who have been especially present this week.",
    },
  ],
};
