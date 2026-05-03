const recipes = require("../../data/manufacturing/recipes");
const engine = require("./engine");

function hashText(value) {
  return String(value || "").split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
}

function getRecipeByOutput(itemId) {
  return recipes.find((recipe) => recipe.output?.itemId === itemId) || null;
}

function getPrice(itemId, now = Date.now()) {
  const recipe = getRecipeByOutput(itemId);
  if (!recipe) return 0;
  const base = Number(recipe.baseValue || 0);
  const wave = Math.sin((Math.floor(now / 3600000) + hashText(itemId)) / 3);
  const multiplier = 0.9 + ((wave + 1) / 2) * 0.22;
  return Math.max(1, Math.floor(base * multiplier));
}

function getSellableItems(state) {
  return engine.getAggregatedOutput(state)
    .map((item) => ({
      ...item,
      unitPrice: getPrice(item.itemId),
      totalValue: Number(item.qty || 0) * getPrice(item.itemId),
      recipe: getRecipeByOutput(item.itemId),
    }))
    .filter((item) => item.recipe?.marketEnabled);
}

module.exports = {
  getPrice,
  getSellableItems,
};
