// data/games/categories/justForFun.js
module.exports = {
  id: 'fun',
  name: 'Just for Fun',
  emoji: '🎉',
  description: 'Small chaos. No paperwork.',
  order: 3,

  games: [
    {
      id: 'rps',
      name: 'Rock Paper Scissors',
      emoji: '🪨',
      description: 'Pick your hand and call their bluff.',
      run: async (interaction, ctx = {}) => require('../rps').startFromHub(interaction, ctx),
    },
    {
      id: 'trivia',
      name: 'Trivia',
      emoji: '🧠',
      description: 'First sharp answer takes it.',
      run: async (interaction, ctx = {}) => require('../trivia').startFromHub(interaction, ctx),
    },
    {
      id: 'guessnumber',
      name: 'Guess the Number',
      emoji: '🔢',
      description: 'Find the number before the room does.',
      run: async (interaction, ctx = {}) => require('../guessNumber').startFromHub(interaction, ctx),
    },
    {
      id: 'wordscramble',
      name: 'Word Scramble',
      emoji: '🔀',
      description: 'Untangle the word under pressure.',
      run: async (interaction, ctx = {}) => require('../wordScramble').startFromHub(interaction, ctx),
    },
    {
      id: 'hangman',
      name: 'Hangman',
      emoji: '🎯',
      description: 'Guess the word before the rope runs out.',
      run: async (interaction, ctx = {}) => require('../hangman').startFromHub(interaction, ctx),
    },
    {
      id: 'emojiguess',
      name: 'Emoji Guessing Game',
      emoji: '😎',
      description: 'Read the tiny symbols. Somehow.',
      run: async (interaction, ctx = {}) => require('../emojiGuess').startFromHub(interaction, ctx),
    },
    {
      id: 'moviequote',
      name: 'Guess the Movie Quote',
      emoji: '🎬',
      description: 'Catch the film from one line.',
      run: async (interaction, ctx = {}) => require('../movieQuote').startFromHub(interaction, ctx),
    },
    {
      id: 'storybuilder',
      name: 'Story Builder',
      emoji: '📖',
      description: 'Build the best line together.',
      run: async (interaction, ctx = {}) => require('../storyBuilder').startFromHub(interaction, ctx),
    },
    {
      id: 'memerating',
      name: 'Meme Rating Game',
      emoji: '🧻',
      description: 'Post the joke and survive the vote.',
      run: async (interaction, ctx = {}) => require('../memeRating').startFromHub(interaction, ctx),
    },
  ],
};
