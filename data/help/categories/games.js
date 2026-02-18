// data/help/categories/games.js
module.exports = {
  id: "games",
  order: 3,
  name: "Games",
  emoji: "🎮",
  blurb: "Mini-Games and money makers.",

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
      id: "blackjack",
      name: "How to Play - Blackjack",
      short: "Found inside the /games hub.",
      detail:
        "**/Blackjack**\n" +
        "🎯 **Objective**\n" +
        "**Beat the dealer by getting your hand total as close to 21 as possible, without going over.**\n" +
        "- Number cards = face value\n" +
        "- Face cards (J, Q, K) = 10\n" +
        "- Ace = 1 or 11 (whichever benefits you most)\n" +
        "- Going over 21 = **Bust (Instant loss)**\n" +
        "Dealer must draw until reaching **17 or higher**.\n\n" +
        "**Buttons:**\n" +
        "Hit - Draw another card.\n" +
        "Stand - End turn.\n" +
        "Double - Double down, doubles your bet and draws only 1 more card.\n" +
        "Split - Split matching starting cards, takes your original bet value again for the second hand.\n\n" +
        "Bust = lose instantly\n" +
        "Blackjack = best payout\n" +
        "Best of luck out there!",
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
