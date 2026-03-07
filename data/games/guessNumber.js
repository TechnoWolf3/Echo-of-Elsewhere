const { buildGuessingGame } = require('./typedGuessBase');

async function startFromHub(interaction, opts = {}) {
  return buildGuessingGame(interaction, {
    ...opts,
    key: 'guessnumber',
    title: '🔢 Guess the Number',
    description: 'First person to guess the secret number wins.',
    prompt: () => {
      const number = Math.floor(Math.random() * 50) + 1;
      return {
        ask: '**Guess a number between 1 and 50.**',
        answers: [String(number)],
        reveal: `**The number was:** ${number}`,
      };
    },
    timeoutMs: 35_000,
  });
}

module.exports = { startFromHub };
