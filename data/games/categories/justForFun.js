// data/games/categories/justForFun.js
module.exports = {
  id: 'fun',
  name: 'Just for Fun',
  emoji: '🎉',
  description: 'Low-stakes arcade games with no economy tie-ins.',
  order: 3,

  games: [
    {
      id: 'rps',
      name: 'Rock Paper Scissors',
      emoji: '🪨',
      description: 'Multiplayer duel with hidden picks.',
      run: async (interaction, ctx = {}) => require('../rps').startFromHub(interaction, ctx),
    },
    {
      id: 'trivia',
      name: 'Trivia',
      emoji: '🧠',
      description: 'First correct answer in chat wins.',
      run: async (interaction, ctx = {}) => require('../trivia').startFromHub(interaction, ctx),
    },
    {
      id: 'guessnumber',
      name: 'Guess the Number',
      emoji: '🔢',
      description: 'First person to find the secret number wins.',
      run: async (interaction, ctx = {}) => require('../guessNumber').startFromHub(interaction, ctx),
    },
    {
      id: 'wordscramble',
      name: 'Word Scramble',
      emoji: '🔀',
      description: 'Unscramble the word before anyone else.',
      run: async (interaction, ctx = {}) => require('../wordScramble').startFromHub(interaction, ctx),
    },
    {
      id: 'hangman',
      name: 'Hangman',
      emoji: '🎯',
      description: 'Two-player turn-based word guessing duel.',
      run: async (interaction, ctx = {}) => require('../hangman').startFromHub(interaction, ctx),
    },
    {
      id: 'emojiguess',
      name: 'Emoji Guessing Game',
      emoji: '😎',
      description: 'Guess the phrase or title from emoji clues.',
      run: async (interaction, ctx = {}) => require('../emojiGuess').startFromHub(interaction, ctx),
    },
    {
      id: 'moviequote',
      name: 'Guess the Movie Quote',
      emoji: '🎬',
      description: 'Name the movie from the quote.',
      run: async (interaction, ctx = {}) => require('../movieQuote').startFromHub(interaction, ctx),
    },
    {
      id: 'storybuilder',
      name: 'Story Builder',
      emoji: '📖',
      description: 'Multiplayer prompt duel with audience voting.',
      run: async (interaction, ctx = {}) => require('../storyBuilder').startFromHub(interaction, ctx),
    },
    {
      id: 'memerating',
      name: 'Meme Rating Game',
      emoji: '🧻',
      description: 'Multiplayer rating duel with audience voting.',
      run: async (interaction, ctx = {}) => require('../memeRating').startFromHub(interaction, ctx),
    },
  ],
};
