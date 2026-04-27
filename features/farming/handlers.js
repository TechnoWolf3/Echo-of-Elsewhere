const {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

const config = require("../../data/farming/config");
const farming = require("../../utils/farming/engine");
const market = require("../../utils/farming/market");
const machineEngine = require("../../utils/farming/machineEngine");
const weather = require("../../utils/farming/weather");
const farmingUi = require("./ui");
const { tryDebitBank, creditBank } = require("../../utils/economy");

function isFarmingInteraction(actionId) {
  return (
    actionId === "enterprise:farming" ||
    actionId === "farm_market" ||
    actionId === "farm_store" ||
    actionId === "farm_store_home" ||
    actionId === "farm_store_fertiliser" ||
    actionId === "farm_machines" ||
    actionId === "farm_back" ||
    actionId === "machine_home" ||
    actionId === "machine_buy" ||
    actionId === "machine_rent" ||
    actionId === "machine_sell" ||
    actionId.startsWith("buy_cat_") ||
    actionId.startsWith("machine_cat:") ||
    actionId.startsWith("farm_select:") ||
    actionId.startsWith("farm_machine_buy:") ||
    actionId.startsWith("farm_machine_rent:") ||
    actionId.startsWith("farm_machine_sell:") ||
    actionId.startsWith("farm_cultivate:") ||
    actionId.startsWith("farm_recultivate:") ||
    actionId.startsWith("farm_upgrade:") ||
    actionId.startsWith("farm_barn:") ||
    actionId.startsWith("farm_barn_collect:") ||
    actionId.startsWith("farm_barn_slaughter:") ||
    actionId.startsWith("farm_barn_restock:") ||
    actionId.startsWith("farm_barn_upgrade:") ||
    actionId.startsWith("farm_barn_demolish:") ||
    actionId.startsWith("farm_plant:") ||
    actionId.startsWith("farm_harvest:") ||
    actionId.startsWith("farm_fertilise:") ||
    actionId.startsWith("farm_store_fertiliser_buy:") ||
    actionId.startsWith("farm_sell:") ||
    actionId === "farm_buy"
  );
}

async function handleFarmingInteraction({
  actionId,
  interaction,
  session,
  msg,
  pool,
  guildId,
  userId,
  redraw,
}) {
  if (!isFarmingInteraction(actionId)) return false;

  if (actionId === "enterprise:farming") {
    session.view = "farming";
    session.lastCategory = "enterprises";
    await redraw();
    return true;
  }

  if (actionId === "farm_market") {
    session.view = "farm_market";
    await redraw();
    return true;
  }

  if (actionId === "farm_store") {
    session.view = "farm_store";
    session.farmStorePage = "home";
    await redraw();
    return true;
  }

  if (actionId === "farm_store_home") {
    session.view = "farm_store";
    session.farmStorePage = "home";
    await redraw();
    return true;
  }

  if (actionId === "farm_store_fertiliser") {
    session.view = "farm_store";
    session.farmStorePage = "fertiliser";
    await redraw();
    return true;
  }

  if (actionId === "farm_machines") {
    session.view = "farm_machines";
    session.machinePage = "home";
    await redraw();
    return true;
  }

  if (actionId === "machine_home") {
    session.machinePage = "home";
    await redraw();
    return true;
  }

  if (actionId === "machine_buy") {
    session.machinePage = "buy";
    await redraw();
    return true;
  }

  if (actionId === "machine_rent") {
    session.machinePage = "rent";
    await redraw();
    return true;
  }

  if (actionId === "machine_sell") {
    session.machinePage = "sell";
    await redraw();
    return true;
  }

  if (actionId.startsWith("buy_cat_")) {
    const category = actionId.replace("buy_cat_", "");
    session.machinePage = `machine_cat:buy:${category}`;
    await redraw();
    return true;
  }

  if (actionId.startsWith("machine_cat:")) {
    const [, mode, category] = actionId.split(":");
    session.machinePage = `machine_cat:${mode}:${category}`;
    await redraw();
    return true;
  }

  if (actionId === "farm_back") {
    session.view = "farming";
    session.fieldIndex = null;
    session.farmStorePage = null;
    await redraw();
    return true;
  }

  if (actionId === "farm_buy") {
    const farm = await farming.ensureFarm(guildId, userId);
    if ((farm.fields || []).length >= config.MAX_FIELDS) {
      await interaction.followUp({
        content: "❌ You already own the maximum number of fields.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return true;
    }

    const cost = farming.getNextFieldCost(farm.fields.length);
    const debit = await tryDebitBank(guildId, userId, cost, "farming_field_purchase", {
      enterprise: "farming",
      action: "buy_field",
      fieldCountBefore: farm.fields.length,
    });

    if (!debit.ok) {
      await interaction.followUp({
        content: `❌ You need $${cost.toLocaleString()} in your bank.`,
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return true;
    }

    const result = await farming.buyField(guildId, userId, farm);
    if (result?.ok === false) {
      await creditBank(guildId, userId, cost, "farming_field_purchase_refund", {
        enterprise: "farming",
        action: "buy_field_refund",
        reason: result.reasonText || "purchase_failed",
      });
      await interaction.followUp({
        content: `❌ ${result.reasonText}`,
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return true;
    }

    await redraw();
    return true;
  }

  if (actionId.startsWith("farm_select:")) {
    const fieldIndex = Number(actionId.split(":")[1]);
    const farm = await farming.ensureFarm(guildId, userId);
    await weather.ensureDailyWeatherState(guildId);
    await farming.applySeasonRollover(guildId, userId, farm);

    session.view = "farm_field";
    session.fieldIndex = fieldIndex;

    await msg.edit({
      embeds: [farmingUi.buildFieldEmbed(farm, fieldIndex, guildId)],
      components: farmingUi.buildFieldComponents(farm, fieldIndex, guildId),
    });
    return true;
  }

  if (actionId.startsWith("farm_machine_buy:")) {
    const machineId = actionId.split(":")[1];
    const result = await machineEngine.buyMachine(guildId, userId, machineId);

    if (!result.ok) {
      await interaction.followUp({
        content: `❌ ${result.reasonText}`,
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return true;
    }

    await interaction.followUp({
      content: `✅ Bought ${result.machine.name} for $${result.machine.buyPrice.toLocaleString()}.`,
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});

    session.view = "farm_machines";
    await redraw();
    return true;
  }

  if (actionId.startsWith("farm_machine_rent:")) {
    const machineId = actionId.split(":")[1];
    const result = await machineEngine.rentMachine(guildId, userId, machineId);

    if (!result.ok) {
      await interaction.followUp({
        content: `❌ ${result.reasonText}`,
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return true;
    }

    await interaction.followUp({
      content: `✅ Rented ${result.machine.name} for $${result.machine.rentPrice.toLocaleString()}. Rental expires <t:${Math.floor(result.expiresAt / 1000)}:R>.`,
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});

    await redraw();
    return true;
  }

  if (actionId.startsWith("farm_machine_sell:")) {
    const machineId = actionId.split(":")[1];
    const result = await machineEngine.sellMachine(guildId, userId, machineId);

    if (!result.ok) {
      await interaction.followUp({
        content: `❌ ${result.reasonText}`,
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return true;
    }

    await interaction.followUp({
      content: `✅ Sold ${result.machine.name} for $${result.sellValue.toLocaleString()}.`,
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});

    await redraw();
    return true;
  }

  if (actionId.startsWith("farm_store_fertiliser_buy:")) {
    const fertiliserId = actionId.split(":")[1];
    const farm = await farming.ensureFarm(guildId, userId);
    const fertiliser = farming.getFertiliser(fertiliserId);
    if (!fertiliser) {
      await interaction.followUp({ content: "Unknown fertiliser.", flags: MessageFlags.Ephemeral }).catch(() => {});
      return true;
    }

    const modal = new ModalBuilder()
      .setCustomId(`farm_store_fertiliser_qty:${fertiliserId}:${interaction.id}`)
      .setTitle(`Buy ${fertiliser.name}`)
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("qty")
            .setLabel("Quantity")
            .setPlaceholder("Example: 5")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        )
      );

    await interaction.showModal(modal);
    const submitted = await interaction.awaitModalSubmit({
      time: 60_000,
      filter: (modalInteraction) =>
        modalInteraction.user.id === userId &&
        modalInteraction.customId === `farm_store_fertiliser_qty:${fertiliserId}:${interaction.id}`,
    }).catch(() => null);

    if (!submitted) return true;
    await submitted.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

    const qty = Math.floor(Number(submitted.fields.getTextInputValue("qty")));
    if (!Number.isFinite(qty) || qty <= 0) {
      await submitted.editReply("Enter a whole number greater than 0.").catch(() => {});
      return true;
    }
    if (qty > 999) {
      await submitted.editReply("Buy 999 or fewer at a time.").catch(() => {});
      return true;
    }

    const totalCost = Number(fertiliser.price || 0) * qty;
    const debit = await tryDebitBank(guildId, userId, totalCost, "farming_fertiliser_purchase", {
      enterprise: "farming",
      action: "buy_fertiliser",
      fertiliserId,
      qty,
    });
    if (!debit.ok) {
      await submitted.editReply(`You need $${totalCost.toLocaleString()} in your bank to buy ${qty}x ${fertiliser.name}.`).catch(() => {});
      return true;
    }
    const result = await farming.buyFertiliser(guildId, userId, farm, fertiliserId, qty);
    if (!result.ok) {
      await creditBank(guildId, userId, totalCost, "farming_fertiliser_refund", { fertiliserId, qty });
      await submitted.editReply(result.reasonText).catch(() => {});
      return true;
    }
    await submitted.editReply(`Bought ${qty}x ${result.fertiliser.name} for $${totalCost.toLocaleString()}.`).catch(() => {});
    await redraw();
    return true;
  }

  if (actionId.startsWith("farm_cultivate:")) {
    const fieldIndex = Number(actionId.split(":")[1]);
    await startMachineBackedFieldTask({
      action: "cultivate",
      fieldIndex,
      guildId,
      userId,
      interaction,
      msg,
      successText: "🛠️ Cultivation started.",
    });
    return true;
  }

  if (actionId.startsWith("farm_recultivate:")) {
    const fieldIndex = Number(actionId.split(":")[1]);
    await startMachineBackedFieldTask({
      action: "cultivate",
      fieldIndex,
      guildId,
      userId,
      interaction,
      msg,
      extra: { forceResetCrop: true },
      successText: "♻️ Re-cultivation started. The current crop will be cleared when the job finishes.",
    });
    return true;
  }

  if (actionId.startsWith("farm_plant:")) {
    const [, fieldIndexRaw, cropId] = actionId.split(":");
    const fieldIndex = Number(fieldIndexRaw);
    await startMachineBackedFieldTask({
      action: "seed",
      fieldIndex,
      guildId,
      userId,
      interaction,
      msg,
      extra: { cropId },
      successText: "🌱 Seeding started.",
    });
    return true;
  }

  if (actionId.startsWith("farm_harvest:")) {
    const fieldIndex = Number(actionId.split(":")[1]);
    await startMachineBackedFieldTask({
      action: "harvest",
      fieldIndex,
      guildId,
      userId,
      interaction,
      msg,
      successText: "🌾 Harvesting started.",
    });
    return true;
  }

  if (actionId.startsWith("farm_fertilise:")) {
    const [, fieldIndexRaw, fertiliserId] = actionId.split(":");
    const fieldIndex = Number(fieldIndexRaw);
    await startMachineBackedFieldTask({
      action: "fertilise",
      fieldIndex,
      guildId,
      userId,
      interaction,
      msg,
      extra: { fertiliserId },
      successText: "Fertilising started.",
    });
    return true;
  }

  if (actionId.startsWith("farm_upgrade:")) {
    const fieldIndex = Number(actionId.split(":")[1]);
    const farm = await farming.ensureFarm(guildId, userId);
    const currentLevel = farm.fields?.[fieldIndex]?.level || 1;
    const cost = farming.getUpgradeCost(currentLevel);

    if (cost <= 0) {
      await interaction.followUp({
        content: "❌ This field cannot be upgraded right now.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return true;
    }

    const debit = await tryDebitBank(guildId, userId, cost, "farming_field_upgrade", {
      enterprise: "farming",
      action: "upgrade_field",
      fieldIndex,
      fromLevel: currentLevel,
      toLevel: currentLevel + 1,
    });

    if (!debit.ok) {
      await interaction.followUp({
        content: `❌ You need $${cost.toLocaleString()} in your bank to upgrade this field.`,
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return true;
    }

    const result = await farming.upgradeField(guildId, userId, farm, fieldIndex);
    if (!result.ok) {
      await creditBank(guildId, userId, cost, "farming_field_upgrade_refund", {
        enterprise: "farming",
        action: "upgrade_field_refund",
        fieldIndex,
        reason: result.reasonText || "upgrade_failed",
      });
      await interaction.followUp({
        content: `❌ ${result.reasonText}`,
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return true;
    }

    const updatedFarm = await farming.ensureFarm(guildId, userId);
    await msg.edit({
      embeds: [farmingUi.buildFieldEmbed(updatedFarm, fieldIndex, guildId)],
      components: farmingUi.buildFieldComponents(updatedFarm, fieldIndex, guildId),
    });
    return true;
  }

  if (actionId.startsWith("farm_barn:")) {
    const [, fieldIndexRaw, livestockType] = actionId.split(":");
    const fieldIndex = Number(fieldIndexRaw);
    const type = farming.getLivestockType(livestockType);
    if (!type) {
      await interaction.followUp({ content: "❌ Unknown livestock type.", flags: MessageFlags.Ephemeral }).catch(() => {});
      return true;
    }

    const farm = await farming.ensureFarm(guildId, userId);
    const cost = Number(type.convertCost || 0);
    const debit = await tryDebitBank(guildId, userId, cost, "farming_barn_conversion", {
      enterprise: "farming",
      action: "convert_barn",
      fieldIndex,
      livestockType,
    });

    if (!debit.ok) {
      await interaction.followUp({
        content: `❌ You need $${cost.toLocaleString()} in your bank to convert this field.`,
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return true;
    }

    const result = await farming.convertFieldToBarn(guildId, userId, farm, fieldIndex, livestockType);
    if (!result.ok) {
      await creditBank(guildId, userId, cost, "farming_barn_conversion_refund", {
        enterprise: "farming",
        action: "convert_barn_refund",
        fieldIndex,
        reason: result.reasonText || "conversion_failed",
      });
      await interaction.followUp({ content: `❌ ${result.reasonText}`, flags: MessageFlags.Ephemeral }).catch(() => {});
      return true;
    }

    const updatedFarm = await farming.ensureFarm(guildId, userId);
    await interaction.followUp({
      content: `✅ Converted Field ${fieldIndex + 1} into a ${result.type.name}.`,
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    await msg.edit({
      embeds: [farmingUi.buildFieldEmbed(updatedFarm, fieldIndex, guildId)],
      components: farmingUi.buildFieldComponents(updatedFarm, fieldIndex, guildId),
    });
    return true;
  }

  if (actionId.startsWith("farm_barn_collect:")) {
    const fieldIndex = Number(actionId.split(":")[1]);
    const farm = await farming.ensureFarm(guildId, userId);
    const result = await farming.collectBarnProducts(guildId, userId, farm, fieldIndex);

    if (!result.ok) {
      await interaction.followUp({ content: `❌ ${result.reasonText}`, flags: MessageFlags.Ephemeral }).catch(() => {});
      return true;
    }

    const updatedFarm = await farming.ensureFarm(guildId, userId);
    await interaction.followUp({
      content: `✅ Collected ${result.qty}x ${result.itemName}.`,
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    await msg.edit({
      embeds: [farmingUi.buildFieldEmbed(updatedFarm, fieldIndex, guildId)],
      components: farmingUi.buildFieldComponents(updatedFarm, fieldIndex, guildId),
    });
    return true;
  }

  if (actionId.startsWith("farm_barn_slaughter:")) {
    const fieldIndex = Number(actionId.split(":")[1]);
    const farm = await farming.ensureFarm(guildId, userId);
    const result = await farming.slaughterBarn(guildId, userId, farm, fieldIndex);

    if (!result.ok) {
      await interaction.followUp({ content: `❌ ${result.reasonText}`, flags: MessageFlags.Ephemeral }).catch(() => {});
      return true;
    }

    const updatedFarm = await farming.ensureFarm(guildId, userId);
    await interaction.followUp({
      content: `✅ Slaughtered ${result.animals} animals and produced ${result.qty}x ${result.itemName}.`,
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    await msg.edit({
      embeds: [farmingUi.buildFieldEmbed(updatedFarm, fieldIndex, guildId)],
      components: farmingUi.buildFieldComponents(updatedFarm, fieldIndex, guildId),
    });
    return true;
  }

  if (actionId.startsWith("farm_barn_restock:")) {
    const fieldIndex = Number(actionId.split(":")[1]);
    const farm = await farming.ensureFarm(guildId, userId);
    const barn = farm.fields?.[fieldIndex];
    const type = farming.getLivestockType(barn?.livestockType);
    const cost = Math.round(Number(type?.convertCost || 0) * 0.35);

    const debit = await tryDebitBank(guildId, userId, cost, "farming_barn_restock", {
      enterprise: "farming",
      action: "restock_barn",
      fieldIndex,
      livestockType: barn?.livestockType,
    });

    if (!debit.ok) {
      await interaction.followUp({
        content: `❌ You need $${cost.toLocaleString()} in your bank to restock this barn.`,
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return true;
    }

    const result = await farming.restockBarn(guildId, userId, farm, fieldIndex);
    if (!result.ok) {
      await creditBank(guildId, userId, cost, "farming_barn_restock_refund", {
        enterprise: "farming",
        action: "restock_barn_refund",
        fieldIndex,
        reason: result.reasonText || "restock_failed",
      });
      await interaction.followUp({ content: `❌ ${result.reasonText}`, flags: MessageFlags.Ephemeral }).catch(() => {});
      return true;
    }

    const updatedFarm = await farming.ensureFarm(guildId, userId);
    await interaction.followUp({
      content: `✅ Restocked ${result.type.name} with ${result.capacity} animals.`,
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    await msg.edit({
      embeds: [farmingUi.buildFieldEmbed(updatedFarm, fieldIndex, guildId)],
      components: farmingUi.buildFieldComponents(updatedFarm, fieldIndex, guildId),
    });
    return true;
  }

  if (actionId.startsWith("farm_barn_upgrade:")) {
    const fieldIndex = Number(actionId.split(":")[1]);
    const farm = await farming.ensureFarm(guildId, userId);
    const barn = farm.fields?.[fieldIndex];
    const currentLevel = barn?.level || 1;
    const cost = farming.getBarnUpgradeCost(currentLevel);

    const debit = await tryDebitBank(guildId, userId, cost, "farming_barn_upgrade", {
      enterprise: "farming",
      action: "upgrade_barn",
      fieldIndex,
      fromLevel: currentLevel,
      toLevel: currentLevel + 1,
    });

    if (!debit.ok) {
      await interaction.followUp({
        content: `❌ You need $${cost.toLocaleString()} in your bank to upgrade this barn.`,
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return true;
    }

    const field = farm.fields?.[fieldIndex];
    if (!farming.isBarn(field) || currentLevel >= config.MAX_FIELD_LEVEL) {
      await creditBank(guildId, userId, cost, "farming_barn_upgrade_refund", {
        enterprise: "farming",
        action: "upgrade_barn_refund",
        fieldIndex,
        reason: "upgrade_failed",
      });
      await interaction.followUp({ content: "❌ This barn cannot be upgraded right now.", flags: MessageFlags.Ephemeral }).catch(() => {});
      return true;
    }

    field.level = currentLevel + 1;
    await farming.saveFarm(guildId, userId, farm);

    const updatedFarm = await farming.ensureFarm(guildId, userId);
    await msg.edit({
      embeds: [farmingUi.buildFieldEmbed(updatedFarm, fieldIndex, guildId)],
      components: farmingUi.buildFieldComponents(updatedFarm, fieldIndex, guildId),
    });
    return true;
  }

  if (actionId.startsWith("farm_barn_demolish:")) {
    const fieldIndex = Number(actionId.split(":")[1]);
    const farm = await farming.ensureFarm(guildId, userId);
    const barn = farm.fields?.[fieldIndex];
    const cost = farming.getBarnDemolitionCost(barn);

    const debit = await tryDebitBank(guildId, userId, cost, "farming_barn_demolition", {
      enterprise: "farming",
      action: "demolish_barn",
      fieldIndex,
      livestockType: barn?.livestockType,
    });

    if (!debit.ok) {
      await interaction.followUp({
        content: `❌ You need $${cost.toLocaleString()} in your bank for demolition and cleanup fees.`,
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return true;
    }

    const result = await farming.demolishBarn(guildId, userId, farm, fieldIndex);
    if (!result.ok) {
      await creditBank(guildId, userId, cost, "farming_barn_demolition_refund", {
        enterprise: "farming",
        action: "demolish_barn_refund",
        fieldIndex,
        reason: result.reasonText || "demolition_failed",
      });
      await interaction.followUp({ content: `❌ ${result.reasonText}`, flags: MessageFlags.Ephemeral }).catch(() => {});
      return true;
    }

    const updatedFarm = await farming.ensureFarm(guildId, userId);
    await interaction.followUp({
      content: `✅ Barn demolished. The plot is back to a field, but it needs cultivation before planting.`,
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    await msg.edit({
      embeds: [farmingUi.buildFieldEmbed(updatedFarm, fieldIndex, guildId)],
      components: farmingUi.buildFieldComponents(updatedFarm, fieldIndex, guildId),
    });
    return true;
  }

  if (actionId.startsWith("farm_sell:")) {
    const itemId = actionId.split(":")[1];
    const result = await market.sellCrop(guildId, userId, itemId);

    if (!result.ok) {
      await interaction.followUp({
        content: `❌ ${result.reasonText}`,
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return true;
    }

    session.view = "farm_market";

    await interaction.followUp({
      content: `✅ Sold ${result.qty}x ${result.name} for $${result.totalValue.toLocaleString()}.`,
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});

    await redraw();
    return true;
  }

  return true;
}

async function startMachineBackedFieldTask({
  action,
  fieldIndex,
  guildId,
  userId,
  interaction,
  msg,
  extra = {},
  successText,
}) {
  const farm = await farming.ensureFarm(guildId, userId);
  await weather.ensureDailyWeatherState(guildId);
  const field = farm.fields?.[fieldIndex];
  const baseTaskMs = farming.getTaskDurationMs(field, action, 60000);
  const speedMult = await machineEngine.getBestTaskSpeedMultiplier(guildId, userId, action);
  const taskMs = Math.max(15000, Math.round(baseTaskMs * speedMult));
  const result = await farming.startFieldTask(guildId, userId, farm, fieldIndex, action, taskMs, extra);

  if (!result.ok) {
    await interaction.followUp({
      content: `❌ ${result.reasonText}`,
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return;
  }

  const machineCheck = await machineEngine.reserveMachinesForTask(
    guildId,
    userId,
    fieldIndex,
    action,
    taskMs
  );

  if (!machineCheck.ok) {
    await farming.clearFieldTask(guildId, userId, farm, fieldIndex).catch(() => {});
    await interaction.followUp({
      content: `❌ ${machineCheck.reasonText}`,
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return;
  }

  const updatedFarm = await farming.ensureFarm(guildId, userId);

  await interaction.followUp({
    content: `${successText} It will finish <t:${Math.floor(Number(result.task.endsAt) / 1000)}:R>.`,
    flags: MessageFlags.Ephemeral,
  }).catch(() => {});

  await msg.edit({
    embeds: [farmingUi.buildFieldEmbed(updatedFarm, fieldIndex, guildId)],
    components: farmingUi.buildFieldComponents(updatedFarm, fieldIndex, guildId),
  });
}

module.exports = {
  handleFarmingInteraction,
  isFarmingInteraction,
};
