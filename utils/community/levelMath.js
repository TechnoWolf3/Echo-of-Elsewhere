const { getLevelTitle } = require("../../data/community/levelTitles");

function toSafeXp(value) {
  const xp = Math.floor(Number(value) || 0);
  return Math.max(0, xp);
}

function xpNeededForLevel(level) {
  const safeLevel = Math.max(1, Math.floor(Number(level) || 1));
  return 100 + Math.floor(Math.pow(safeLevel, 1.75) * 45);
}

function totalXpForLevel(level) {
  const targetLevel = Math.max(1, Math.floor(Number(level) || 1));
  let total = 0;
  for (let current = 1; current < targetLevel; current += 1) {
    total += xpNeededForLevel(current);
  }
  return total;
}

function levelFromTotalXp(totalXp) {
  const xp = toSafeXp(totalXp);
  let level = 1;
  let remaining = xp;

  while (remaining >= xpNeededForLevel(level)) {
    remaining -= xpNeededForLevel(level);
    level += 1;
    if (level > 10000) break;
  }

  return level;
}

function getLevelProgress(totalXp) {
  const xp = toSafeXp(totalXp);
  const level = levelFromTotalXp(xp);
  const levelStartXp = totalXpForLevel(level);
  const currentLevelXp = Math.max(0, xp - levelStartXp);
  const xpForNextLevel = xpNeededForLevel(level);
  const progressRatio = xpForNextLevel > 0 ? Math.min(1, currentLevelXp / xpForNextLevel) : 0;

  return {
    level,
    title: getLevelTitle(level),
    totalXp: xp,
    currentLevelXp,
    xpForNextLevel,
    progressRatio,
    progressPercent: Math.round(progressRatio * 100),
    nextLevel: level + 1,
  };
}

module.exports = {
  xpNeededForLevel,
  totalXpForLevel,
  levelFromTotalXp,
  getLevelProgress,
};
