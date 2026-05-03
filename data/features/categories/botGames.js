// data/features/categories/botGames.js
module.exports = {
  id: "botgames",
  order: 7,
  name: "Bot Games",
  emoji: "🤖",
  blurb: "Random Echo challenges for quick reactions, risk, and sudden rewards.",
  description:
    "Bot Games are unpredictable challenges manifested directly by Echo.\n" +
    "They appear at random in the configured event channel, offering moments of high risk and sudden opportunity.",

  items: [
    {
      id: "botgames_schedule",
      name: "Random Echo Events",
      short: "Timed challenges that can appear during the day.",
      detail:
        "Bot Games are random events posted into the configured event channel.\n" +
        "Most days have no event, some days have one, and weekends have slightly better odds of activity.\n" +
        "An unclaimed event can sit for a limited time, while claimed events must be finished quickly so they do not get stuck.",
    },
    {
      id: "quickdraw",
      name: "Quickdraw",
      short: "A pure speed event with no entry cost.",
      detail:
        "Quickdraw is the simplest Bot Game.\n" +
        "The first player to click **Play** wins the listed prize.\n" +
        "There is no stake, no extra decision, and no second step. It rewards fast reactions.",
    },
    {
      id: "double_or_nothing",
      name: "Double or Nothing",
      short: "Risk a listed stake for a 50/50 double.",
      detail:
        "Double or Nothing asks the first claimant to risk the listed stake.\n" +
        "Win the roll and the stake doubles. Lose the roll and the stake is gone.\n" +
        "It is quick, sharp, and built for players who like a clean 50/50 gamble.",
    },
    {
      id: "risk_ladder",
      name: "Risk Ladder",
      short: "Climb higher for greater rewards, but one misstep ends it.",
      detail:
        "Risk Ladder challenges players to advance through escalating tiers of reward.\n" +
        "Each step increases potential payout while raising the chance of collapse.\n" +
        "Cash out early to secure profits, or climb higher in pursuit of bigger gains.\n" +
        "Every rung tests your discipline and nerve.",
    },
    {
      id: "mystery_box",
      name: "Mystery Box",
      short: "A sealed reward or an expensive mistake.",
      detail:
        "The Mystery Box offers unpredictable outcomes ranging from nothing to a rare jackpot.\n" +
        "The first claimant pays the listed cost, opens the box, and accepts the result.\n" +
        "There are no previews, no guarantees, and no second chances.",
    },
  ],
};
