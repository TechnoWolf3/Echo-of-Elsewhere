// data/games/categories/casino.js
module.exports = {
  id: "casino",
  name: "Casino",
  emoji: "🎰",
  description: "Low lights. Sharp cards. Louder consequences.",
  order: 1,

  games: [
    {
      id: "higherlower",
      name: "Higher or Lower",
      emoji: "🔼",
      description: "Chase the next card and guard your streak.",
      run: async (interaction, ctx = {}) => {
        const hol = require("../higherLower");
        return hol.startFromHub(interaction, ctx);
      },
    },

    {
      id: "blackjack",
      name: "Blackjack",
      emoji: "🃏",
      description: "Beat the dealer before the table eats you.",
      run: async (interaction, ctx = {}) => {
        const bj = require("../blackjack");
        return bj.startFromHub(interaction, ctx);
      },
    },

    {
      id: "roulette",
      name: "Roulette",
      emoji: "🎡",
      description: "Pick your colour, number, or nerve.",
      run: async (interaction, ctx = {}) => {
        const rou = require("../roulette");
        return rou.startFromHub(interaction, ctx);
      },
    },


    {
      id: "keno",
      name: "Keno",
      emoji: "🔢",
      description: "Mark the board and hope the draw listens.",
      run: async (interaction, ctx = {}) => {
        const keno = require("../keno");
        return keno.startFromHub(interaction, ctx);
      },
    },

    {
      id: "scratchcards",
      name: "Scratch Cards",
      emoji: "🎟️",
      description: "Scratch fast and let the prize breathe.",
      run: async (interaction, ctx = {}) => {
        const scratch = require("../scratchcards");
        return scratch.startFromHub(interaction, ctx);
      },
    },


    {
      id: "bullshit",
      name: "Bullshit",
      emoji: "💩",
      description: "Play the rank. Sell the lie.",
      run: async (interaction, ctx = {}) => {
        const hol = require("../bullshit");
        return hol.startFromHub(interaction, ctx);
      },
    },
  ],
};
