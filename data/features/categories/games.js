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
      short: "Low-stakes games, quick duels, and social deduction.",
      detail:
        "The Just for Fun category includes Echo Whisper, Rock Paper Scissors, Trivia, Guess the Number, Word Scramble, Hangman, Emoji Guess, Movie Quote, Story Builder, and Meme Rating.\n\n" +
        "Echo Whisper is a social deduction word game for at least 3 players: civilians share one secret word while spies receive a different one. Optional wagers are supported, but betting is not required.",
    },
    {
      id: "echo_whisper",
      name: "Echo Whisper",
      short: "Social deduction word game with optional wagers.",
      detail:
        "Echo Whisper is found under **/games -> Just for Fun**.\n\n" +
        "Civilians receive the same secret word, spies receive a different random word, and everyone gives clues before the group debates and votes. It supports 3-14 players, optional wagers, and no casino table fees.",
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
