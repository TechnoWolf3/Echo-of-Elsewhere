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
      id: "keno",
      name: "Keno",
      emoji: "🔢",
      description: "Classic Keno or Heads/Tails/Draw • 20-ball draw",
      run: async (interaction, ctx = {}) => {
        const keno = require("../keno");
        return keno.startFromHub(interaction, ctx);
      },
    },

    {
      id: "scratchcards",
      name: "Scratch Cards",
      emoji: "🎟️",
      description: "Pick a card • fixed price • fast scratchie hits",
      run: async (interaction, ctx = {}) => {
        const scratch = require("../scratchcards");
        return scratch.startFromHub(interaction, ctx);
      },
    },


    {
      id: "bullshit",
      name: "Bullshit",
      emoji: "💩",
      description: "Match the rank... or not. Someones lying? **BULLSHIT!**",
      run: async (interaction, ctx = {}) => {
        const hol = require("../bullshit");
        return hol.startFromHub(interaction, ctx);
      },
    },
  ],
};
