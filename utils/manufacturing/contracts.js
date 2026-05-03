const { creditBank } = require("../economy");
const engine = require("./engine");

async function fulfillContract(guildId, userId, state, offerId) {
  const nextState = engine.refreshContractBoard(state);
  const offer = (nextState.contractBoard?.offers || []).find((entry) => entry.id === offerId);
  if (!offer) return { ok: false, reasonText: "That manufacturing contract is no longer available." };

  const outputs = engine.getAggregatedOutput(nextState);
  const owned = Number(outputs.find((item) => item.itemId === offer.itemId)?.qty || 0);
  if (owned < Number(offer.qty || 0)) {
    return { ok: false, reasonText: "You do not have enough finished goods to fulfill that contract." };
  }

  const removed = engine.takeFromOutputStorage(nextState, offer.itemId, Number(offer.qty || 0));
  if (!removed) {
    return { ok: false, reasonText: "Failed to reserve the required goods for that contract." };
  }

  await creditBank(guildId, userId, Number(offer.payout || 0), "manufacturing_contract", {
    enterprise: "manufacturing",
    contractId: offer.id,
    recipeId: offer.recipeId,
    itemId: offer.itemId,
    qty: offer.qty,
  });

  nextState.contractBoard.offers = (nextState.contractBoard.offers || []).filter((entry) => entry.id !== offerId);
  await engine.saveState(guildId, userId, nextState);

  return { ok: true, offer, payout: Number(offer.payout || 0), state: nextState };
}

module.exports = {
  fulfillContract,
};
