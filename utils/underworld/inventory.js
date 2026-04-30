function ensureInventory(state) {
  state.smuggling = state.smuggling || {};
  state.smuggling.inventory = state.smuggling.inventory || {};
  return state.smuggling.inventory;
}

function getProductQuantity(state, productId) {
  return Math.max(0, Number(ensureInventory(state)[productId] || 0));
}

function getInventorySummary(state) {
  return { ...ensureInventory(state) };
}

function addProduct(state, productId, quantity) {
  const inventory = ensureInventory(state);
  const amount = Math.max(0, Math.floor(Number(quantity || 0)));
  inventory[productId] = getProductQuantity(state, productId) + amount;
  return inventory[productId];
}

function removeProduct(state, productId, quantity) {
  const amount = Math.max(0, Math.floor(Number(quantity || 0)));
  const current = getProductQuantity(state, productId);
  if (current < amount) return { ok: false, available: current };
  ensureInventory(state)[productId] = current - amount;
  return { ok: true, remaining: current - amount };
}

module.exports = {
  ensureInventory,
  getProductQuantity,
  getInventorySummary,
  addProduct,
  removeProduct,
};
