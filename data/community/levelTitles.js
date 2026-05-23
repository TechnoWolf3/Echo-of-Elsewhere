const LEVEL_TITLES = [
  { min: 1, max: 4, title: "Freshly Hatched Degenerate" },
  { min: 5, max: 9, title: "Suspiciously Moist Civilian" },
  { min: 10, max: 14, title: "Discount Mouth Mercenary" },
  { min: 15, max: 24, title: "Unlicensed Throat Goat" },
  { min: 25, max: 34, title: "Certified Gag Goblin" },
  { min: 35, max: 49, title: "Bedframe Warranty Voider" },
  { min: 50, max: 74, title: "Community Fleshlight" },
  { min: 75, max: 99, title: "Gag Reflex Final Boss" },
  { min: 100, max: Infinity, title: "The Reason Consent Forms Exist" },
];

function getLevelTitle(level) {
  const safeLevel = Math.max(1, Math.floor(Number(level) || 1));
  return LEVEL_TITLES.find((entry) => safeLevel >= entry.min && safeLevel <= entry.max)?.title || "Freshly Hatched Degenerate";
}

module.exports = {
  LEVEL_TITLES,
  getLevelTitle,
};
