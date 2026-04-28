// data/help/categories/games.js
module.exports = {
  id: "games",
  order: 4,
  name: "Games",
  emoji: "🎮",
  blurb: "Party games, just-for-fun games, and random Echo events.",

  commands: [
    {
      id: "gamesHub",
      name: "/games",
      short: "Open the games hub.",
      detail:
        "**/games**\n" +
        "Posts or refreshes the Games Hub in the current channel.\n\n" +
        "Use the category menu to choose Casino, Drinking Games, or Just for Fun. Then choose a game from the game menu.",
    },
    {
      id: "votendrink",
      name: "Vote & Drink",
      short: "Vote-based party game.",
      detail:
        "**Vote & Drink**\n" +
        "Found under the Drinking Games category in **/games**.\n\n" +
        "Players vote on prompts such as **Who's the most likely to ___?** The player with the most votes drinks.",
    },
    {
      id: "justForFun",
      name: "Just for Fun Games",
      short: "Low-stakes games with no economy tie-ins.",
      detail:
        "**Just for Fun**\n" +
        "These games are launched from the Just for Fun category in **/games**.\n\n" +
        "**Current games:** Rock Paper Scissors, Trivia, Guess the Number, Word Scramble, Hangman, Emoji Guess, Movie Quote, Story Builder, and Meme Rating.\n\n" +
        "They are built for chat activity, duels, voting, and quick server moments rather than money making.",
    },
    {
      id: "typedGuessGames",
      name: "Typed Guess Games",
      short: "Race to answer correctly in chat.",
      detail:
        "**Typed Guess Games**\n" +
        "Trivia, Guess the Number, Word Scramble, Emoji Guess, and Movie Quote ask players to type answers in chat.\n\n" +
        "The first valid answer wins the round or advances the game, depending on the mode.",
    },
    {
      id: "duelGames",
      name: "Duel & Voting Games",
      short: "Player-vs-player and audience-voted games.",
      detail:
        "**Duel & Voting Games**\n" +
        "Rock Paper Scissors and Hangman focus on direct player matchups.\n\n" +
        "Story Builder and Meme Rating use prompts and audience voting to decide the winner.",
    },
    {
      id: "botGames",
      name: "Bot Games",
      short: "Random Echo challenges that appear in chat.",
      detail:
        "**Bot Games**\n" +
        "Bot Games are random timed events that Echo posts into the configured event channel.\n\n" +
        "**How they work:** an event appears, the first player to press **Play** claims it, and claimed events must be finished before they expire.\n\n" +
        "**Current events:** Quickdraw, Double or Nothing, Risk Ladder, and Mystery Box.",
    },
    {
      id: "quickdraw",
      name: "Quickdraw",
      short: "First click wins a small prize.",
      detail:
        "**Quickdraw**\n" +
        "A speed event. The first player to click **Play** wins the listed prize.\n\n" +
        "There is no entry cost. It is purely a race to react first.",
    },
    {
      id: "doubleOrNothing",
      name: "Double or Nothing",
      short: "Risk the listed stake for a 50/50 double.",
      detail:
        "**Double or Nothing**\n" +
        "The first player to claim the event risks the listed amount from their balance.\n\n" +
        "Win and the stake doubles. Lose and the stake is gone.",
    },
    {
      id: "riskLadder",
      name: "Risk Ladder",
      short: "Climb for more money or cash out safely.",
      detail:
        "**Risk Ladder**\n" +
        "The first player to claim the ladder can continue through rising payout steps or cash out.\n\n" +
        "Each continue increases the possible prize but also increases the bust chance. Cashing out locks in the current pot.",
    },
    {
      id: "mysteryBox",
      name: "Mystery Box",
      short: "Pay to open a box with unknown results.",
      detail:
        "**Mystery Box**\n" +
        "The first player to claim pays the listed cost to open the box.\n\n" +
        "The result can be empty, a small win, a better win, or a rare jackpot.",
    },
  ],
};
