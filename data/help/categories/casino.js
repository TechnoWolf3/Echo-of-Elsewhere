// data/help/categories/casino.js
module.exports = {
  id: "casino",
  order: 3,
  name: "Casino",
  emoji: "🎰",
  blurb: "Money games launched through the /games hub.",

  commands: [
    {
      id: "casinoHub",
      name: "/games",
      short: "Open the games hub and choose Casino.",
      detail:
        "**/games**\n" +
        "Posts or refreshes the Games Hub in the current channel.\n\n" +
        "Choose **Casino** from the category menu to launch casino games. If a game is already active in the channel, the hub will stop another one from starting over it.",
    },
    {
      id: "blackjack",
      name: "How to Play - Blackjack",
      short: "Beat the dealer without going over 21.",
      detail:
        "**Blackjack**\n" +
        "Try to beat the dealer by getting your hand total as close to 21 as possible without going over.\n\n" +
        "Number cards use face value. J, Q, and K count as 10. Aces count as 1 or 11, whichever helps the hand most.\n\n" +
        "**Buttons:** Hit draws a card, Stand ends your turn, Double doubles your bet for one final card, and Split separates matching starting cards into two hands.",
    },
    {
      id: "roulette",
      name: "How to Play - Roulette",
      short: "Bet on where the ball will land.",
      detail:
        "**Roulette**\n" +
        "Place a bet, spin the wheel, and win if the ball lands on your selection.\n\n" +
        "**Common bets:** red, black, green zero, or a specific number.\n\n" +
        "Colour bets are safer and pay less. Green or exact-number bets are riskier and pay more.",
    },
    {
      id: "higherOrLower",
      name: "How to Play - Higher or Lower",
      short: "Predict the next card and build a streak.",
      detail:
        "**Higher or Lower**\n" +
        "Predict whether the next card will be higher or lower than the current card.\n\n" +
        "Each correct guess builds your streak and increases the potential payout. One wrong guess ends the run. Use **Cash Out** when you want to secure the current reward.",
    },
    {
      id: "keno",
      name: "How to Play - Keno",
      short: "Pick entries and wait for the draw.",
      detail:
        "**Keno**\n" +
        "Launch Keno from the Casino category in **/games**.\n\n" +
        "Choose your entries, confirm the play, and wait for the draw result. Payouts depend on the selected mode and how the drawn result lands.",
    },
    {
      id: "scratchcards",
      name: "How to Play - Scratch Cards",
      short: "Pick a scratch card and reveal the result.",
      detail:
        "**Scratch Cards**\n" +
        "Launch Scratch Cards from the Casino category in **/games**.\n\n" +
        "Pick a card, pay the listed price, and reveal the outcome. Results resolve quickly, making scratch cards the fastest casino option.",
    },
    {
      id: "bullshit",
      name: "How to Play - Bullshit",
      short: "Lie, call bluffs, and survive the table.",
      detail:
        "**Bullshit**\n" +
        "Players take turns placing cards face down and declaring what they played.\n\n" +
        "You can tell the truth or lie. Other players can call **Bullshit** if they think the previous player lied.\n\n" +
        "Calling correctly punishes the liar. Calling incorrectly punishes the caller. The goal is to survive the table and get rid of your cards.",
    },
  ],
};
