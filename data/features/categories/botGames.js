// data/features/categories/botGames.js
module.exports = {
  id: "botgames",
  order: 3,
  name: "Bot Games",
  emoji: "🧩",
  blurb: "Echo's random challenges, do you dare contest?.",
  description:
    "Bot Games are unpredictable challenges manifested directly by Echo.\n" +
    "They appear at random, offering moments of high risk and sudden opportunity.\n" +
    "Some grant fortune. Others demand sacrifice.",

  // Bot Games features
  items: [
    {
      id: "echo_rift",
      name: "🕳 Echo Rift",
      short: "A reality tear offering risk, reward… or ruin.",
      detail:
        "The Echo Rift appears unpredictably, opening for a single challenger.\n" +
        "Step inside and face layered choices where every decision shapes your fate.\n" +
        "Blessings can bring fortune, while curses may demand tribute or time.\n" +
        "Rarely, Echo may mark someone as **Chosen**, but such favor comes sparingly.",
    },
    {
      id: "double_or_nothing",
      name: "🎲 Double or Nothing",
      short: "Push your winnings or lose it all.",
      detail:
        "Double or Nothing is a high-risk continuation event.\n" +
        "After a successful day at the casino, you may choose to gamble your reward for a chance to double it.\n" +
        "Win and your prize grows. Fail, and everything is forfeited.\n" +
        "Designed for bold players who trust momentum over caution.",
    },
    {
      id: "risk_ladder",
      name: "🪜 Risk Ladder",
      short: "Climb higher for greater rewards, but one misstep ends it.",
      detail:
        "Risk Ladder challenges players to advance through escalating tiers of reward.\n" +
        "Each step increases potential payout while raising the chance of collapse.\n" +
        "Cash out early to secure profits, or climb higher in pursuit of bigger gains.\n" +
        "Every rung tests your discipline and nerve.",
    },
    {
      id: "mystery_box",
      name: "🎁 Mystery Box",
      short: "A sealed reward… or an expensive mistake.",
      detail:
        "The Mystery Box offers unpredictable outcomes ranging from modest gains to costly setbacks.\n" +
        "Open it and accept whatever Echo has prepared, whether fortune or misfortune.\n" +
        "There are no previews, no guarantees, and no second chances.\n" +
        "Curiosity often comes with a price.",
    },
  ],
};
