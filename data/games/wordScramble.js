const { buildGuessingGame } = require('./typedGuessBase');

const WORDS = [
  // Short
  'taxi','wolf','lava','echo','mint','dust','bolt','iron','gear','fuel','coal','wind','rock','wood','salt','rain','storm','spark','flare','ember',

  // Medium
  'dragon','galaxy','banana','thunder','station','rescue','casino','scooter','paradox','lantern','outback','wizard','penguin','biscuit','voltage','hangar','diamond','satellite','battery','circuit',
  'tractor','harvest','explorer','factory','mission','command','voyager','gravity','booster','scanner','console','network','control','charger','engine','turbine','landing','orbit','compass','beacon',

  // Longer
  'astronomy','spaceship','technology','laboratory','electricity','generation','calculation','simulation','automation','navigation',
  'architecture','construction','infrastructure','communication','revolutionary','transportation','investigation','documentation','information','verification',
  'observation','coordination','transmission','distribution','modification','adaptation','calibration','fabrication','reconstruction','configuration',

  // Hard / long words
  'characteristic','miscommunication','intercontinental','hyperventilation','microarchitecture','electromagnetic','counterproductive',
  'disproportionate','incompatibility','institutionalize','internationalization','conceptualization','thermodynamics','photosynthesis',
  'electromechanical','counterintelligence','hyperconnectivity','industrialization','characterization','electroencephalogram',

  // Fun chaotic ones
  'flabbergasted','bamboozlement','skullduggery','thingamajig','whatchamacallit','hullabaloo','kerfuffle','lollygagging','nincompoop',
  'snickerdoodle','ragamuffin','pumpernickel','boondoggle','flummoxed','fandango','dinglehopper','shenanigans','hocuspocus',

  // Extra long nightmare words
  'pseudopseudohypoparathyroidism',
  'floccinaucinihilipilification',
  'antidisestablishmentarianism',
  'honorificabilitudinitatibus',
  'thyroparathyroidectomized',
  'psychoneuroendocrinological',
  'hepaticocholangiogastrostomy',
  'spectrophotofluorometrically'
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
