const { MessageFlags } = require("discord.js");

const engine = require("../../utils/manufacturing/engine");
const market = require("../../utils/manufacturing/market");
const contracts = require("../../utils/manufacturing/contracts");
const { tryDebitBank, creditUser, ensureUser } = require("../../utils/economy");

function isManufacturingInteraction(actionId) {
  return (
    actionId === "enterprise:manufacturing" ||
    actionId === "manu_buy" ||
    actionId === "manu_market" ||
    actionId === "manu_contracts" ||
    actionId === "manu_shop" ||
    actionId === "manu_back" ||
    actionId.startsWith("manu_select:") ||
    actionId.startsWith("manu_plot_type:") ||
    actionId.startsWith("manu_return_plot:") ||
    actionId.startsWith("manu_type:") ||
    actionId.startsWith("manu_plot_import:") ||
    actionId.startsWith("manu_plot_materials:") ||
    actionId.startsWith("manu_import:") ||
    actionId.startsWith("manu_material:") ||
    actionId.startsWith("manu_start:") ||
    actionId.startsWith("manu_upgrade:") ||
    actionId.startsWith("manu_sell:") ||
    actionId.startsWith("manu_contract:") ||
    actionId.startsWith("manu_event:")
  );
}

async function followUp(interaction, content) {
  await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
}

async function handleManufacturingInteraction({
  actionId,
  interaction,
  session,
  guildId,
  userId,
  redraw,
}) {
  if (!isManufacturingInteraction(actionId)) return false;

  if (actionId === "enterprise:manufacturing") {
    session.view = "manufacturing";
    session.lastCategory = "enterprises";
    await redraw();
    return true;
  }

  if (actionId === "manu_back") {
    session.view = "manufacturing";
    session.manuPlotIndex = null;
    await redraw();
    return true;
  }

  if (actionId === "manu_market") {
    session.view = "manu_market";
    await redraw();
    return true;
  }

  if (actionId === "manu_contracts") {
    session.view = "manu_contracts";
    await redraw();
    return true;
  }

  if (actionId === "manu_shop") {
    const state = await engine.ensureState(guildId, userId);
    if (!state.plots.length) {
      await followUp(interaction, "❌ Buy a factory plot first, then open that plot to buy materials into its input storage.");
      return true;
    }
    session.view = "manu_plot_materials";
    session.manuPlotIndex = 0;
    await redraw();
    return true;
  }

  if (actionId === "manu_buy") {
    const state = await engine.ensureState(guildId, userId);
    const cost = engine.getNextPlotCost((state.plots || []).length);
    const debit = await tryDebitBank(guildId, userId, cost, "manufacturing_plot_purchase", {
      enterprise: "manufacturing",
      action: "buy_plot",
      plotCountBefore: (state.plots || []).length,
    });

    if (!debit.ok) {
      await followUp(interaction, `❌ You need $${cost.toLocaleString()} in your bank.`);
      return true;
    }

    const result = await engine.buyPlot(guildId, userId, state);
    if (!result.ok) {
      await followUp(interaction, `❌ ${result.reasonText}`);
      return true;
    }

    await redraw();
    return true;
  }

  if (actionId.startsWith("manu_select:")) {
    session.view = "manu_plot";
    session.manuPlotIndex = Number(actionId.split(":")[1]);
    await redraw();
    return true;
  }

  if (actionId.startsWith("manu_plot_type:")) {
    session.view = "manu_plot_type";
    session.manuPlotIndex = Number(actionId.split(":")[1]);
    await redraw();
    return true;
  }

  if (actionId.startsWith("manu_return_plot:")) {
    session.view = "manu_plot";
    session.manuPlotIndex = Number(actionId.split(":")[1]);
    await redraw();
    return true;
  }

  if (actionId.startsWith("manu_type:")) {
    const [, plotIndexRaw, factoryType] = actionId.split(":");
    const plotIndex = Number(plotIndexRaw);
    const state = await engine.ensureState(guildId, userId);
    const plot = state.plots?.[plotIndex];
    const result = plot?.factoryType
      ? await engine.changeFactoryType(guildId, userId, state, plotIndex, factoryType)
      : await engine.assignFactoryType(guildId, userId, state, plotIndex, factoryType);

    if (!result.ok) {
      await followUp(interaction, `❌ ${result.reasonText}`);
      return true;
    }

    session.view = "manu_plot";
    session.manuPlotIndex = plotIndex;
    await followUp(
      interaction,
      result.changed
        ? `✅ Plot ${plotIndex + 1} switched to ${engine.getFactoryTypes()[factoryType].name}. Stored stock was reduced to ${Math.round((result.retainRate || 0) * 100)}% and active work was cleared.`
        : `✅ Plot ${plotIndex + 1} assigned to ${engine.getFactoryTypes()[factoryType].name}.`
    );
    await redraw();
    return true;
  }

  if (actionId.startsWith("manu_plot_import:")) {
    session.view = "manu_plot_import";
    session.manuPlotIndex = Number(actionId.split(":")[1]);
    await redraw();
    return true;
  }

  if (actionId.startsWith("manu_plot_materials:")) {
    session.view = "manu_plot_materials";
    session.manuPlotIndex = Number(actionId.split(":")[1]);
    await redraw();
    return true;
  }

  if (actionId.startsWith("manu_import:")) {
    const [, plotIndexRaw, itemId] = actionId.split(":");
    const plotIndex = Number(plotIndexRaw);
    const state = await engine.ensureState(guildId, userId);
    const candidates = await engine.listFarmImportCandidates(guildId, userId, state.plots?.[plotIndex] || null);
    const owned = Number(candidates.find((item) => item.itemId === itemId)?.qty || 0);
    const amount = Math.min(5, owned);
    const result = await engine.startImport(guildId, userId, state, plotIndex, itemId, amount);

    if (!result.ok) {
      await followUp(interaction, `❌ ${result.reasonText}`);
      return true;
    }

    await followUp(interaction, `✅ Import started for ${amount}x ${engine.getOutputItemName(itemId)}. It will arrive <t:${Math.floor(Number(result.importRun.arrivesAt || 0) / 1000)}:R>.`);
    await redraw();
    return true;
  }

  if (actionId.startsWith("manu_material:")) {
    const [, plotIndexRaw, materialId] = actionId.split(":");
    const plotIndex = Number(plotIndexRaw);
    const material = engine.getMaterial(materialId);
    if (!material) {
      await followUp(interaction, "❌ That material bundle no longer exists.");
      return true;
    }

    const state = await engine.ensureState(guildId, userId);
    const plot = state.plots?.[plotIndex];
    if (!plot) {
      await followUp(interaction, "❌ That factory plot does not exist.");
      return true;
    }

    const capacity = engine.getStorageCapacity(plot.level);
    const used = engine.sumStorage(plot.inputStorage) + (plot.pendingImports || []).reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
    if (used + Number(material.bundleAmount || 0) > capacity) {
      await followUp(interaction, "❌ That plot does not have enough input storage for this bundle.");
      return true;
    }

    const debit = await tryDebitBank(guildId, userId, Number(material.price || 0), "manufacturing_material_purchase", {
      enterprise: "manufacturing",
      plotIndex,
      materialId,
      qty: material.bundleAmount,
    });
    if (!debit.ok) {
      await followUp(interaction, `❌ You need $${Number(material.price || 0).toLocaleString()} in your bank.`);
      return true;
    }

    plot.inputStorage[material.id] = Number(plot.inputStorage[material.id] || 0) + Number(material.bundleAmount || 0);
    await engine.saveState(guildId, userId, state);
    await followUp(interaction, `✅ Bought ${material.bundleAmount}x ${material.unitName}${material.bundleAmount === 1 ? "" : "s"} for plot ${plotIndex + 1}.`);
    await redraw();
    return true;
  }

  if (actionId.startsWith("manu_start:")) {
    const [, plotIndexRaw, recipeId] = actionId.split(":");
    const plotIndex = Number(plotIndexRaw);
    const state = await engine.ensureState(guildId, userId);
    const result = await engine.startProduction(guildId, userId, state, plotIndex, recipeId);

    if (!result.ok) {
      await followUp(interaction, `❌ ${result.reasonText}`);
      return true;
    }

    await followUp(interaction, `✅ ${result.recipe.name} started in slot ${result.slotIndex + 1}. It will finish <t:${Math.floor(Number(result.slot.endsAt || 0) / 1000)}:R>.`);
    await redraw();
    return true;
  }

  if (actionId.startsWith("manu_upgrade:")) {
    const plotIndex = Number(actionId.split(":")[1]);
    const state = await engine.ensureState(guildId, userId);
    const plot = state.plots?.[plotIndex];
    const cost = engine.getUpgradeCost(plot?.level || 1);
    if (cost <= 0) {
      await followUp(interaction, "❌ This plot cannot be upgraded right now.");
      return true;
    }

    const debit = await tryDebitBank(guildId, userId, cost, "manufacturing_plot_upgrade", {
      enterprise: "manufacturing",
      plotIndex,
      fromLevel: plot?.level || 1,
      toLevel: (plot?.level || 1) + 1,
    });
    if (!debit.ok) {
      await followUp(interaction, `❌ You need $${cost.toLocaleString()} in your bank to upgrade this plot.`);
      return true;
    }

    const result = await engine.upgradePlot(guildId, userId, state, plotIndex);
    if (!result.ok) {
      await followUp(interaction, `❌ ${result.reasonText}`);
      return true;
    }

    await followUp(interaction, `✅ Plot ${plotIndex + 1} upgraded to level ${result.plot.level}.`);
    await redraw();
    return true;
  }

  if (actionId.startsWith("manu_sell:")) {
    const itemId = actionId.split(":")[1];
    const state = await engine.ensureState(guildId, userId);
    const items = market.getSellableItems(state);
    const item = items.find((entry) => entry.itemId === itemId);
    if (!item) {
      await followUp(interaction, "❌ You do not have that finished good ready for market.");
      return true;
    }

    const removed = engine.takeFromOutputStorage(state, itemId, Number(item.qty || 0));
    if (!removed) {
      await followUp(interaction, "❌ Failed to reserve those finished goods for sale.");
      return true;
    }

    await ensureUser(guildId, userId);
    await creditUser(guildId, userId, Number(item.totalValue || 0), "manufacturing_market_sale", {
      enterprise: "manufacturing",
      itemId,
      qty: item.qty,
      unitPrice: item.unitPrice,
    });
    await engine.saveState(guildId, userId, state);

    await followUp(interaction, `✅ Sold ${item.qty}x ${item.name} for $${Number(item.totalValue || 0).toLocaleString()}.`);
    await redraw();
    return true;
  }

  if (actionId.startsWith("manu_contract:")) {
    const offerId = actionId.slice("manu_contract:".length);
    const state = await engine.ensureState(guildId, userId);
    const result = await contracts.fulfillContract(guildId, userId, state, offerId);
    if (!result.ok) {
      await followUp(interaction, `❌ ${result.reasonText}`);
      return true;
    }

    await followUp(interaction, `✅ Contract fulfilled for ${result.offer.qty}x ${result.offer.name}. Paid $${result.payout.toLocaleString()} to your bank.`);
    await redraw();
    return true;
  }

  if (actionId.startsWith("manu_event:")) {
    const [, plotIndexRaw, slotIndexRaw] = actionId.split(":");
    const plotIndex = Number(plotIndexRaw);
    const slotIndex = Number(slotIndexRaw);
    const state = await engine.ensureState(guildId, userId);
    const result = await engine.handleFactoryEvent(guildId, userId, state, plotIndex, slotIndex);
    if (!result.ok) {
      await followUp(interaction, `❌ ${result.reasonText}`);
      return true;
    }

    await followUp(interaction, `✅ ${result.event.name} handled. Bonus locked in for this production run.`);
    await redraw();
    return true;
  }

  return true;
}

module.exports = {
  isManufacturingInteraction,
  handleManufacturingInteraction,
};
