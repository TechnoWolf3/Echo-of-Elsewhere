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
    {
      id: "bullshit",
      name: "How to Play - BULLSHIT!",
      short: "Found inside the /games hub.",
      detail:
        "**Bullshit**\n" +
        "🎯 **Objective**\n" +
        "**Be the first player to get rid of all your cards or be the last man standing.**\n" +
        "Players take turns placing cards face down and declaring what they are.\n" +
        "They can tell the truth… or they can lie.\n\n" +
        "If someone thinks you’re lying, they can call “Bullshit!”\n\n" +
        "🃏 **Basic Rules**\n" +
        "- The game follows a sequence (e.g., A → 2 → 3 → 4 … → K → repeat).\n" +
        "- On your turn, you must place one or more cards face down.\n" +
        "You declare them as the next value in the sequence.\n" +
        "You may lie about what you placed.\n\n" +
        "Other players decide whether they believe you or call you on your **BULLSHIT!**\n\n" +
        "🎮 **Buttons & What They Do**\n\n" +
        "➕ Play Cards\n" +
        "- Select and place the cards you want to put down.\n" +
        "- You must declare them as the current required rank.\n\n" +
        "📣 Bullshit!\n" +
        "- Call out the previous player if you think they lied.\n" +
        "  - If they were lying → they will run the roulette. With any luck, they'll end up dead.\n" +
        "  - If they were telling the truth → you will run the roulette. With any luck, you'll live to play another hand.\n\n" +
        "💥 Round Outcomes\n" +
        "- Lie successfully → play continues.\n" +
        "- Lie and get caught → pick up the pile.\n" +
        "- Call correctly → opponent picks up pile.\n" +
        "- Call incorrectly → you pick up pile.\n" +
        "- Last player standing wins.\n\n" +
        "-# Early game lies sell easier, confidence is the game and revenge is common.",
    },
  ],
};
