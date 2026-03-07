const { buildGuessingGame } = require('./typedGuessBase');

const QUOTES = [
  { quote: 'May the Force be with you.', answers: ['star wars'] },
  { quote: 'Why so serious?', answers: ['the dark knight', 'dark knight'] },
  { quote: 'I am inevitable.', answers: ['avengers endgame', 'endgame'] },
  { quote: 'You shall not pass!', answers: ['lord of the rings', 'the lord of the rings', 'fellowship of the ring'] },
  { quote: 'Just keep swimming.', answers: ['finding nemo', 'nemo'] },
  { quote: 'I see dead people.', answers: ['the sixth sense', 'sixth sense'] },
  { quote: 'To infinity and beyond!', answers: ['toy story'] },
  { quote: 'I volunteer as tribute.', answers: ['the hunger games', 'hunger games'] },
  { quote: 'With great power comes great responsibility.', answers: ['spider man', 'spiderman'] },
  { quote: 'You can’t handle the truth!', answers: ['a few good men'] },
  { quote: 'Life finds a way.', answers: ['jurassic park'] },
  { quote: 'Wakanda forever!', answers: ['black panther'] },
];

async function startFromHub(interaction, opts = {}) {
  return buildGuessingGame(interaction, {
    ...opts,
    key: 'moviequote',
    title: '🎬 Guess the Movie Quote',
    description: 'First person to name the movie wins.',
    prompt: () => {
      const item = QUOTES[Math.floor(Math.random() * QUOTES.length)];
      return {
        ask: `**Which movie is this quote from?**\n> ${item.quote}`,
        answers: item.answers,
        reveal: `**Answer:** ${item.answers[0]}`,
      };
    },
    timeoutMs: 45_000,
  });
}

module.exports = { startFromHub };
