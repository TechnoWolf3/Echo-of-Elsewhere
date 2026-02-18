// data/games/categories/casino.js
module.exports = {
  id: "casino",
  name: "Casino",
  emoji: "🎰",
  description: "House games, table fees, and big swings.",
  order: 1,

  games: [
    {
      id: "higherlower",
      name: "Higher or Lower",
      emoji: "🔼",
      description: "Pick 🔼 or 🔽 • build a streak • cash out",
      run: async (interaction, ctx = {}) => {
        const hol = require("../higherLower");
        return hol.startFromHub(interaction, ctx);
      },
    },

    {
      id: "blackjack",
      name: "Blackjack",
      emoji: "🃏",
      description: "1–10 players • splits/double • table fees",
      run: async (interaction, ctx = {}) => {
        const bj = require("../blackjack");
        return bj.startFromHub(interaction, ctx);
      },
    },

    {
      id: "roulette",
      name: "Roulette",
      emoji: "🎡",
      description: "Red/Black/Numbers • table fees",
      run: async (interaction, ctx = {}) => {
        const rou = require("../roulette");
        return rou.startFromHub(interaction, ctx);
      },
    },

    {
      id: "bullshit",
      name: "Bullshit - The card game",
      emoji: "💩",
      description: "Place cards that mach the rank... or not. Think someones lying? **BULLSHIT!**",
      run: async (interaction, ctx = {}) => {
        const hol = require("../bullshit");
        return hol.startFromHub(interaction, ctx);
      },
    },
  ],
};
