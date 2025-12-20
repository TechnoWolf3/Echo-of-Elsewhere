const fs = require("fs");
const path = require("path");

function loadAchievementsFromJson() {
  // utils/achievementsLoader.js → ../data/achievements.json
  const filePath = path.join(__dirname, "..", "data", "achievements.json");
  const raw = fs.readFileSync(filePath, "utf8");
  const list = JSON.parse(raw);

  if (!Array.isArray(list)) throw new Error("achievements.json must be an array");

  const ids = new Set();
  for (const a of list) {
    if (!a.id || typeof a.id !== "string") throw new Error("Each achievement must have an id");
    if (!/^[a-z0-9_]+$/.test(a.id)) throw new Error(`Invalid id '${a.id}' (use lowercase/nums/underscores)`);
    if (ids.has(a.id)) throw new Error(`Duplicate achievement id '${a.id}'`);
    ids.add(a.id);

    if (!a.name || !a.description) throw new Error(`Achievement '${a.id}' missing name/description`);
    if (a.reward_coins == null) a.reward_coins = 0;
    if (typeof a.reward_coins !== "number" || a.reward_coins < 0) {
      throw new Error(`Achievement '${a.id}' reward_coins must be a number >= 0`);
    }
    if (typeof a.hidden !== "boolean") a.hidden = false;
    if (!a.category) a.category = "General";
    if (a.reward_role_id === undefined) a.reward_role_id = null;
  }

  return list;
}

module.exports = { loadAchievementsFromJson };
