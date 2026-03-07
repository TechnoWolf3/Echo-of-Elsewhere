const { buildGuessingGame } = require('./typedGuessBase');

const PROMPTS = [
  { clue: '🍕🐀', answers: ['pizza rat'] },
  { clue: '🦁👑', answers: ['lion king', 'the lion king'] },
  { clue: '🕷️🧍', answers: ['spider man', 'spiderman'] },
  { clue: '🧊👑', answers: ['ice queen', 'the ice queen', 'elsa'] },
  { clue: '🐠🔍', answers: ['finding nemo', 'nemo'] },
  { clue: '🚢🧊💥', answers: ['titanic'] },
  { clue: '👻🔫', answers: ['ghostbusters', 'ghost busters'] },
  { clue: '🦈🌪️', answers: ['sharknado'] },
  { clue: '🐼🥋', answers: ['kung fu panda'] },
  { clue: '🤠🧸', answers: ['toy story'] },
  { clue: '👨‍🚀🌕', answers: ['moon landing', 'the moon landing'] },
  { clue: '🐍✈️', answers: ['snakes on a plane'] },
];

async function startFromHub(interaction, opts = {}) {
  return buildGuessingGame(interaction, {
    ...opts,
    key: 'emojiguess',
    title: '😎 Emoji Guessing Game',
    description: 'Work out the phrase, movie, or title from the emoji clue.',
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
