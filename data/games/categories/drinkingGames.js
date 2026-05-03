// data/games/categories/drinkingGames.js
// Games Hub category: Drinking Games

module.exports = {
  id: "drinking",
  name: "Drinking Games",
  emoji: "🍻",
  description: "Raise a glass. Lower your standards.",
  order: 2,

  games: [
    {
      id: "votendrink",
      name: "Vote & Drink",
      emoji: "🗳️",
      description: "Vote fast. Someone drinks.",
      run: async (interaction, ctx = {}) => {
        const game = require("../votendrink");
        return game.startFromHub(interaction, ctx);
      },
    },
  ],
};
