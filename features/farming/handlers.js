const { MessageFlags } = require("discord.js");

const config = require("../../data/farming/config");
const farming = require("../../utils/farming/engine");
const market = require("../../utils/farming/market");
const machineEngine = require("../../utils/farming/machineEngine");
const weather = require("../../utils/farming/weather");
const farmingUi = require("./ui");

function isFarmingInteraction(actionId) {
  return (
    actionId === "enterprise:farming" ||
    actionId === "farm_market" ||
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
    actionId.startsWith("farm_plant:") ||
    actionId.startsWith("farm_harvest:") ||
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
    const debit = await pool.query(
      `UPDATE user_balances
       SET balance = balance - $1
       WHERE user_id=$2 AND guild_id=$3 AND balance >= $1
       RETURNING balance`,
      [cost, userId, guildId]
    );

    if (debit.rowCount === 0) {
      await interaction.followUp({
        content: `❌ You need $${cost.toLocaleString()}`,
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return true;
    }

    const result = await farming.buyField(guildId, userId, farm);
    if (result?.ok === false) {
      await pool.query(
        `UPDATE user_balances SET balance = balance + $1 WHERE user_id=$2 AND guild_id=$3`,
        [cost, userId, guildId]
      );
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
      embeds: [farmingUi.buildFieldEmbed(farm, fieldIndex)],
      components: farmingUi.buildFieldComponents(farm, fieldIndex),
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

  if (actionId.startsWith("farm_upgrade:")) {
    const fieldIndex = Number(actionId.split(":")[1]);
    const farm = await farming.ensureFarm(guildId, userId);
    const cost = farming.getUpgradeCost(farm.fields?.[fieldIndex]?.level || 1);

    const bal = await pool.query(
      `SELECT balance FROM user_balances WHERE user_id=$1 AND guild_id=$2`,
      [userId, guildId]
    );

    if ((bal.rows[0]?.balance || 0) < cost) {
      await interaction.followUp({
        content: `❌ You need $${cost.toLocaleString()} to upgrade this field.`,
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return true;
    }

    const result = await farming.upgradeField(guildId, userId, farm, fieldIndex);
    if (!result.ok) {
      await interaction.followUp({
        content: `❌ ${result.reasonText}`,
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return true;
    }

    await pool.query(
      `UPDATE user_balances SET balance = balance - $1 WHERE user_id=$2 AND guild_id=$3`,
      [cost, userId, guildId]
    );

    const updatedFarm = await farming.ensureFarm(guildId, userId);
    await msg.edit({
      embeds: [farmingUi.buildFieldEmbed(updatedFarm, fieldIndex)],
      components: farmingUi.buildFieldComponents(updatedFarm, fieldIndex),
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
  const taskMs = farming.getTaskDurationMs(field, action, 60000);
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
    embeds: [farmingUi.buildFieldEmbed(updatedFarm, fieldIndex)],
    components: farmingUi.buildFieldComponents(updatedFarm, fieldIndex),
  });
}

module.exports = {
  handleFarmingInteraction,
  isFarmingInteraction,
};
