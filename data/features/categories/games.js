// data/features/categories/games.js
module.exports = {
  id: "games",
  order: 6,
  name: "Games Hub",
  emoji: "🎮",
  blurb: "Low-stakes, party, and social games launched from /games.",
  description:
    "The Games Hub is the shared launcher for casino games, drinking games, and low-stakes fun games. Some games affect the economy, while others are purely for server activity.",

  items: [
    {
      id: "games_hub",
      name: "Games Hub",
      short: "A channel-based launcher for playable games.",
      detail:
        "Use **/games** to post or refresh the games hub in the current channel.\n\n" +
        "Players choose a category, then select a game. The hub tracks active games per channel so one game does not overwrite another.",
    },
    {
      id: "drinking_games",
      name: "Drinking Games",
      short: "Party prompts and vote-based social games.",
      detail:
        "The Drinking Games category includes **Vote & Drink**, where players vote on prompts and the player with the most votes drinks.\n\n" +
        "These games are built for social play rather than money making.",
    },
    {
      id: "arcade_games",
      name: "Just for Fun Games",
      short: "Low-stakes games with no economy tie-ins.",
      detail:
        "The Just for Fun category includes Rock Paper Scissors, Trivia, Guess the Number, Word Scramble, Hangman, Emoji Guess, Movie Quote, Story Builder, and Meme Rating.\n\n" +
        "These are designed for activity, duels, chat participation, and quick server moments without direct balance payouts.",
    },
    {
      id: "active_game_controls",
      name: "Active Game Controls",
      short: "Refresh, back, home, and close controls keep panels tidy.",
      detail:
        "The games hub includes navigation controls so players can move between categories and refresh the current state.\n\n" +
        "Staff with channel permissions can close stale panels when needed.",
    },
  ],
};
