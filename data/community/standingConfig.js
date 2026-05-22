const STANDING_CONFIG = {
  enabled: true,
  min: -100,
  max: 100,
  positiveDailyCap: 8,
  negativeDailyCap: 25,
  decayEnabled: true,
  decayAmountPerDay: 1,
};

const STANDING_TIERS = [
  {
    id: "golden_child",
    name: "Echo's Golden Child",
    min: 80,
    max: 100,
    description: "You are seen as a reliable member of the community. Echo has not checked the fine print.",
  },
  {
    id: "respected_citizen",
    name: "Respected Citizen",
    min: 50,
    max: 79,
    description: "You are seen as a reliable member of the community. Echo has not checked the fine print.",
  },
  {
    id: "helpful_local",
    name: "Helpful Local",
    min: 20,
    max: 49,
    description: "People have started trusting your name in small, inconvenient ways.",
  },
  {
    id: "just_some_bloke",
    name: "Just Some Bloke",
    min: -19,
    max: 19,
    description: "No major reputation yet. You are currently a normal amount of suspicious.",
  },
  {
    id: "bit_suspicious",
    name: "Bit Suspicious",
    min: -49,
    max: -20,
    description: "Echo has noticed the pattern. So has everyone else.",
  },
  {
    id: "known_menace",
    name: "Known Menace",
    min: -79,
    max: -50,
    description: "Echo has noticed the pattern. So has everyone else.",
  },
  {
    id: "walking_crime_scene",
    name: "Walking Crime Scene",
    min: -100,
    max: -80,
    description: "Echo has noticed the pattern. So has everyone else.",
  },
];

module.exports = {
  STANDING_CONFIG,
  STANDING_TIERS,
};
