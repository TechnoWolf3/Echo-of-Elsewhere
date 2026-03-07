const { buildGuessingGame } = require('./typedGuessBase');

const WORDS = [
  'discord', 'dragon', 'galaxy', 'banana', 'thunder', 'station', 'rescue', 'casino', 'scooter',
  'paradox', 'lantern', 'outback', 'taxi', 'wizard', 'penguin', 'biscuit', 'voltage', 'hangar', 'diamond', 'satellite'
];

function scramble(word) {
  const chars = word.split('');
  do {
    chars.sort(() => Math.random() - 0.5);
  } while (chars.join('') === word);
  return chars.join(' ');
}

async function startFromHub(interaction, opts = {}) {
  return buildGuessingGame(interaction, {
    ...opts,
    key: 'wordscramble',
    title: '🔀 Word Scramble',
    description: 'Unscramble the word before anyone else does.',
    prompt: () => {
      const word = WORDS[Math.floor(Math.random() * WORDS.length)];
      return {
        ask: `**Unscramble this word:** ${scramble(word)}`,
        answers: [word],
        reveal: `**Word:** ${word}`,
      };
    },
    timeoutMs: 40_000,
  });
}

module.exports = { startFromHub };
