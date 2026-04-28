// data/features/categories/casino.js
module.exports = {
  id: "casino",
  order: 2,
  name: "Casino",
  emoji: "🎰",
  blurb: "Money games tied directly into the shared economy.",
  description:
    "The Casino is a money-driven games hub connected to the server bank. Players place bets, test their luck, and move money through the wider economy. Wins withdraw from the vault, losses feed it back in.",

  items: [
    {
      id: "games_hub_casino",
      name: "Casino Hub",
      short: "Launch casino games from /games.",
      detail:
        "Use **/games** to open the games hub, then choose the Casino category.\n\n" +
        "The hub tracks whether a game is already active in the channel, supports refresh/back/home controls, and prevents overlapping games in the same channel.",
    },
    {
      id: "higher_lower",
      name: "Higher or Lower",
      short: "Build a streak by predicting the next card.",
      detail:
        "Higher or Lower is a fast betting game where players predict whether the next card will be higher or lower.\n\n" +
        "Correct guesses build a streak and grow the potential payout. A wrong guess ends the run, while cashing out locks in the current reward.",
    },
    {
      id: "blackjack",
      name: "Blackjack",
      short: "Classic 21 with hits, stands, doubles, and splits.",
      detail:
        "Blackjack delivers a structured table game inside Discord.\n\n" +
        "Players try to beat the dealer by getting as close to 21 as possible without busting. The game supports core actions like hit, stand, double, and split.",
    },
    {
      id: "roulette",
      name: "Roulette",
      short: "Spin-based betting on colours, zero, or numbers.",
      detail:
        "Roulette lets players place quick wagers on red, black, green zero, or specific numbers.\n\n" +
        "Safer bets pay less, while exact-number and zero bets carry higher risk for higher payout potential.",
    },
    {
      id: "keno",
      name: "Keno",
      short: "Pick numbers and wait for the draw.",
      detail:
        "Keno offers draw-based casino play from the games hub.\n\n" +
        "Players choose entries and wait for the draw result. It is built for simple odds, quick resolution, and clear risk.",
    },
    {
      id: "scratchcards",
      name: "Scratch Cards",
      short: "Fast fixed-price scratchie outcomes.",
      detail:
        "Scratch Cards are quick casino hits with a fixed entry price.\n\n" +
        "Players pick a card, reveal the result, and immediately see whether they hit a payout.",
    },
    {
      id: "bullshit",
      name: "Bullshit",
      short: "A social bluffing card game with dangerous calls.",
      detail:
        "Bullshit adds a social bluffing game to the casino suite.\n\n" +
        "Players place cards face down, declare what they played, and dare the table to believe them. Calling a lie can swing the round hard.",
    },
  ],
};
