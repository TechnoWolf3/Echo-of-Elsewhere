const { buildGuessingGame } = require('./typedGuessBase');

const QUESTIONS = [
  { question: 'What planet is known as the Red Planet?', answers: ['mars'] },
  { question: 'How many days are there in a leap year?', answers: ['366', 'three hundred sixty six'] },
  { question: 'What is the capital city of Japan?', answers: ['tokyo'] },
  { question: 'Which ocean is the largest on Earth?', answers: ['pacific', 'pacific ocean'] },
  { question: 'What gas do plants absorb from the atmosphere?', answers: ['carbon dioxide', 'co2'] },
  { question: 'What is the hardest natural substance on Earth?', answers: ['diamond', 'a diamond'] },
  { question: 'Who wrote Romeo and Juliet?', answers: ['william shakespeare', 'shakespeare'] },
  { question: 'What is the square root of 64?', answers: ['8', 'eight'] },
  { question: 'Which animal is known as the king of the jungle?', answers: ['lion', 'a lion'] },
  { question: 'What do bees make?', answers: ['honey'] },
  { question: 'Which continent is Egypt in?', answers: ['africa'] },
  { question: 'How many sides does a hexagon have?', answers: ['6', 'six'] },
  { question: 'What is H2O commonly called?', answers: ['water'] },
  { question: 'Which bird cannot fly and is native to New Zealand?', answers: ['kiwi', 'a kiwi'] },
  { question: 'What is the largest mammal?', answers: ['blue whale', 'the blue whale'] },
];

async function startFromHub(interaction, opts = {}) {
  return buildGuessingGame(interaction, {
    ...opts,
    key: 'trivia',
    title: '🧠 Trivia',
    description: 'First person to type the correct answer wins the round.',
    prompt: () => {
      const q = QUESTIONS[Math.floor(Math.random() * QUESTIONS.length)];
      return {
        ask: `**Question:** ${q.question}`,
        answers: q.answers,
        reveal: `**Answer:** ${q.answers[0]}`,
      };
    },
    timeoutMs: 45_000,
  });
}

module.exports = { startFromHub };
