const { buildGuessingGame } = require('./typedGuessBase');

const PROMPTS = [
  { clue: '🌧️🐱🐶', answers: ['raining cats and dogs'] },
  { clue: '💔', answers: ['broken heart'] },
  { clue: '🌙🚶', answers: ['moonwalk', 'moon walk'] },
  { clue: '🧊☕', answers: ['iced coffee'] },
  { clue: '🐟🍟', answers: ['fish and chips'] },
  { clue: '🔥🏠', answers: ['house on fire', 'burning house'] },
  { clue: '👀❤️🫵', answers: ['i love you'] },
  { clue: '⏰⬆️', answers: ['wake up'] },
  { clue: '📖🐛', answers: ['bookworm', 'book worm'] },
  { clue: '🎵🌧️', answers: ['rain song'] },
  { clue: '🌮🌮🌮', answers: ['three tacos'] },
  { clue: '❄️👨', answers: ['snowman', 'snow man'] },
];

async function startFromHub(interaction, opts = {}) {
  return buildGuessingGame(interaction, {
    ...opts,
    key: 'emojiguess',
    title: '😎 Emoji Guessing Game',
    description: 'Work out the phrase or simple answer from the emoji clue.',
    prompt: () => {
      const item = PROMPTS[Math.floor(Math.random() * PROMPTS.length)];
      return {
        ask: `**What does this mean?**\n${item.clue}`,
        answers: item.answers,
        reveal: `**Answer:** ${item.answers[0]}`,
      };
    },
    timeoutMs: 40_000,
  });
}

module.exports = { startFromHub };
