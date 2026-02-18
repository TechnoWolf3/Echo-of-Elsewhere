// data/help/categories/games.js
module.exports = {
  id: "games",
  order: 4,
  name: "Games",
  emoji: "🎮",
  blurb: "Mini-Games (Not money makers).",

  commands: [
    {
      id: "gamesHub",
      name: "/games",
      short: "Open the casino / games hub.",
      detail:
        "**/games**\n" +
        "Opens the casino hub (games like blackjack/roulette, etc).\n\n" +
        "**Heads up:** Winnings/losses affect your balance.",
    },
    {
      id: "votendrink",
      name: "/votendrink",
      short: "Vote + drink game.",
      detail:
        "**/votendrink**\n" +
        "Runs the Vote & Drink game.\n\n" +
        "A game where players are asked questions such as **Whos the most likely to ___.\n" +
        "The person with the most votes is to take a sip of their drink.",
    },
  ],
};
