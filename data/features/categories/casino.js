// data/features/categories/casino.js
module.exports = {
  id: "casino",
  order: 2,
  name: "Casino",
  emoji: "🎰",
  blurb: "About our Casino.",
  description:
    "The Casino is a money-driven game hub connected directly to the server bank. Place bets, test your luck across multiple games. Wins withdraw from the vault, losses feed it back in.",

  // Items shown inside the category (like help.commands)
  items: [
    {
      id: "higher_Lower",
      name: "🎴 Higher or Lower",
      short: "Fast-paced risk rounds with instant outcomes.",
      detail:
        "Higher or Lower is built for quick decisions and rapid momentum.\n" +
        "it’s a streamlined, reaction-driven casino game designed for fast betting cycles without heavy setup.\n" +
        "Clean visuals, simple choices, and immediate results make it perfect for players who want quick risk with real economic impact.\n" +
        "Every round ties directly into the server bank, keeping even short sessions meaningful.",
    },
    {
      id: "blackjack",
      name: "♠️ Blackjack (21)",
      short: "A structured card table experience with strategic pacing.",
      detail:
        "Blackjack delivers a classic table-style experience with interactive actions and clear game flow.\n" +
        "Designed to feel readable and deliberate, it balances strategy and risk while staying smooth inside Discord.\n" +
        "Outcomes are resolved cleanly, bets are validated securely, and payouts flow directly between accounts.",
    },
    {
      id: "roulette",
      name: "🎰 Roulette",
      short: "Spin-based betting with instant resolution.",
      detail:
        "Roulette brings high-energy, spin-driven betting into the casino suite.\n" +
        "It’s designed for quick wagers and satisfying outcomes without unnecessary complexity.\n" +
        "esults are calculated cleanly and reflected immediately in both personal balances and the server vault.\n" +
        "It’s simple to engage with, but always impactful within the shared economy.",
    },
    {
      id: "bullshit",
      name: "🃏 Bullshit!",
      short: "A social bluffing card game with calculated chaos.",
      detail:
        "Bullshit! adds a social edge to the casino environment, built around deception, timing, and bold calls.\n" +
        "Unlike pure luck-based games, this one rewards reading the table and choosing the right moment to challenge.\n" +
        "- With a twist of Russian Roulette when something goes wrong, Bullshit! is sure to keep you on your toes.",
    },
  ],
};
