// data/games/registry.js
// Category-based registry for /games hub.
// Add new categories/games here without touching the hub logic.

module.exports = {
  categories: [
    {
      id: "casino",
      name: "Casino",
      emoji: "🎰",
      blurb: "House games, table fees, and big swings.",
      games: [
        {
          key: "blackjack",
          label: "Blackjack",
          emoji: "🃏",
          hint: "1–10 players • splits/double • table fees",
          modulePath: "../data/games/blackjack",
          startExport: "startFromHub",
        },
        {
          key: "roulette",
          label: "Roulette",
          emoji: "🎡",
          hint: "Red/Black/Numbers • table fees",
          modulePath: "../data/games/roulette",
          startExport: "startFromHub",
        },
        {
          key: "higherlower",
          label: "Higher or Lower",
          // IMPORTANT: must be ONE emoji for select menus
          emoji: "🔼",
          hint: "Pick 🔼 or 🔽 • build a streak • cash out",
          modulePath: "../data/games/higherLower",
          startExport: "startFromHub",
        },
      ],
    },
  ],
};
