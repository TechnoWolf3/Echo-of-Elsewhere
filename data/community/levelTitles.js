const LEVEL_TITLES = [
  { min: 1, max: 4, title: "New Voice" },
  { min: 5, max: 9, title: "Familiar Voice" },
  { min: 10, max: 14, title: "Known Around Here" },
  { min: 15, max: 24, title: "Echo-Touched" },
  { min: 25, max: 34, title: "Local Presence" },
  { min: 35, max: 49, title: "The Place Knows You" },
  { min: 50, max: 74, title: "Resonant Soul" },
  { min: 75, max: 99, title: "Voice in the Walls" },
  { min: 100, max: Infinity, title: "The Echo Remembers" },
];

function getLevelTitle(level) {
  const safeLevel = Math.max(1, Math.floor(Number(level) || 1));
  return LEVEL_TITLES.find((entry) => safeLevel >= entry.min && safeLevel <= entry.max)?.title || "New Voice";
}

module.exports = {
  LEVEL_TITLES,
  getLevelTitle,
};
