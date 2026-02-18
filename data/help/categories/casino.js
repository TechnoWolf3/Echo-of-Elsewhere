// data/help/categories/games.js
module.exports = {
  id: "casino",
  order: 3,
  name: "Casino",
  emoji: "🎰",
  blurb: "Home to risk-based games & payouts.",

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
        "**Blackjack**\n" +
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
      id: "roulette",
      name: "How to Play - Roulette",
      short: "Found inside the /games hub.",
      detail:
        "**Roulette**\n" +
        "🎯 **Objective**\n" +
        "**Place a bet on where you think the ball will land when the wheel spins.**\n" +
        "If the ball lands on your selection → you win based on the bet type.\n" +
        "If not → the bet is lost.\n\n" +
        "Simple concept. Brutal odds.\n\n" +
        "**Bet types**\n" +
        "🔴 **Red**\n" +
        "Bet that the ball will land on a red number. - Pays lower, safer odds.\n" +
        "⚫ **Black**\n" +
        "Bet that the ball will land on a black number. - Pays the same as red.\n" +
        "🟢 **Green (0)**\n" +
        "Bet that the ball lands on 0. - High Risk, higher payout.\n" +
        "🔢 **Number**\n" +
        "Bet on a specific number. - Lowest odds, highest payout.\n" +
        "Best of luck out there!",
    },
    {
      id: "higherOrLower",
      name: "How to Play - Higher or Lower",
      short: "Found inside the /games hub.",
      detail:
        "**Higher or Lower**\n" +
        "🎯 **Objective**\n" +
        "**Predict whether the next card drawn will be higher or lower than the current card.**\n" +
        "Build a streak of correct guesses to increase your payout.\n" +
        "One wrong guess ends the run.\n\n" +
        "Simple rules. Growing tension.\n\n" +
        "🃏 **Card Rules**\n" +
        "- Number cards = face value\n" +
        "- Face cards (J, Q, K) = 11, 12, 13 equivalent ranking\n" +
        "Only the card rank matters, **suits are irrelevant**.\n\n" +
        "🎮 **Buttons & What They Do**\n" +
        "🔺 Higher\n" +
        "Bet that the next card will be higher than the current card.\n" +
        "🔻 Lower\n" +
        "Bet that the next card will be lower than the current card.\n" +
        "💰 Cash Out\n" +
        "End your streak and collect your current payout. - Smart players know when its time to cash out!\n\n" +
        "💰 **Payout Logic**\n" +
        "- Each correct guess increases your multiplier.\n" +
        "- The longer the streak, the larger the potential payout.\n" +
        "- One incorrect guess = lose your bet.\n" +
        "- There is no partial win. Only streak or defeat.\n" +
        "Best of luck out there!",
    },
  ],
};
