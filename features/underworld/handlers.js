const { MessageFlags } = require("discord.js");

const engine = require("../../utils/underworld/engine");
const { creditUserWithEffects } = require("../../utils/effectSystem");
const branches = require("../../data/underworld/branches");

const BRANCH_MAP = Object.fromEntries(branches.map((branch) => [branch.value, branch]));

function isUnderworldInteraction(actionId) {
  return (
    actionId === "enterprise:underworld" ||
    actionId.startsWith("underworld:") ||
    actionId === "uw_home" ||
    actionId === "uw_operations" ||
    actionId === "uw_refresh" ||
    actionId.startsWith("uw_select:") ||
    actionId.startsWith("uw_buy_building:") ||
    actionId.startsWith("uw_convert:") ||
    actionId.startsWith("uw_start:") ||
    actionId.startsWith("uw_event:") ||
    actionId.startsWith("uw_distribution:") ||
    actionId.startsWith("uw_dismantle:") ||
    actionId.startsWith("uw_emergency:")
  );
}

async function tell(interaction, content) {
  await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
}

async function handleUnderworldInteraction({
  actionId,
  interaction,
  session,
  guildId,
  userId,
  redraw,
}) {
  if (!isUnderworldInteraction(actionId)) return false;

  const load = async () => {
    const state = await engine.ensureState(guildId, userId);
    await engine.applyRuntime(guildId, userId, state);
    return state;
  };

  if (actionId === "enterprise:underworld") {
    await load();
    session.view = "underworld";
    session.lastCategory = "underworld";
    await redraw();
    return true;
  }

  if (actionId.startsWith("underworld:")) {
    const branch = BRANCH_MAP[actionId];
    if (!branch) {
      await tell(interaction, "❌ That Underworld branch is not recognized.");
      return true;
    }

    if (!branch.available || !branch.sessionView) {
      await tell(interaction, "⚠️ That Underworld branch is scaffolded for later and is not live yet.");
      return true;
    }

    await load();
    session.view = branch.sessionView;
    session.lastCategory = "underworld";
    await redraw();
    return true;
  }

  if (actionId === "uw_home") {
    await load();
    session.view = "underworld";
    await redraw();
    return true;
  }

  if (actionId === "uw_operations") {
    await load();
    session.view = "underworld_operations";
    await redraw();
    return true;
  }

  if (actionId === "uw_refresh") {
    await load();
    await redraw();
    return true;
  }

  if (actionId.startsWith("uw_select:")) {
    const buildingId = actionId.split(":")[1];
    await load();
    session.view = "underworld_building";
    session.underworldBuildingId = buildingId;
    await redraw();
    return true;
  }

  if (actionId.startsWith("uw_buy_building:")) {
    const buildingId = actionId.split(":")[1];
    const state = await load();
    const result = await engine.purchaseBuilding(guildId, userId, state, buildingId);
    if (!result.ok) {
      await tell(interaction, `❌ ${result.reasonText}`);
      return true;
    }

    await tell(interaction, `✅ Purchased ${result.definition.name}.`);
    session.view = "underworld_operations";
    await redraw();
    return true;
  }

  if (actionId.startsWith("uw_convert:")) {
    const [, buildingId, operationId] = actionId.split(":");
    const state = await load();
    const result = await engine.startConversion(guildId, userId, state, buildingId, operationId);
    if (!result.ok) {
      await tell(interaction, `❌ ${result.reasonText}`);
      return true;
    }

    session.view = "underworld_building";
    session.underworldBuildingId = buildingId;
    await tell(
      interaction,
      `✅ ${result.operation.name} conversion started. It completes <t:${Math.floor(Number(result.building.conversion.completeAt) / 1000)}:R>.`
    );
    await redraw();
    return true;
  }

  if (actionId.startsWith("uw_start:")) {
    const buildingId = actionId.split(":")[1];
    const state = await load();
    const result = await engine.startRun(guildId, userId, state, buildingId);
    if (!result.ok) {
      await tell(interaction, `❌ ${result.reasonText}`);
      return true;
    }

    session.view = "underworld_building";
    session.underworldBuildingId = buildingId;
    await tell(
      interaction,
      `✅ ${result.operation.name} run started. Production wraps <t:${Math.floor(Number(result.building.activeRun.readyAt) / 1000)}:R>.`
    );
    await redraw();
    return true;
  }

  if (actionId.startsWith("uw_event:")) {
    const [, buildingId, choiceId] = actionId.split(":");
    const state = await load();
    const result = await engine.resolveEventChoice(guildId, userId, state, buildingId, choiceId);
    if (!result.ok) {
      await tell(interaction, `❌ ${result.reasonText}`);
      return true;
    }

    const costText = result.cost > 0 ? ` for $${Number(result.cost).toLocaleString()}` : "";
    await tell(interaction, `✅ ${result.choice.label}${costText}.`);
    session.view = "underworld_building";
    session.underworldBuildingId = buildingId;
    await redraw();
    return true;
  }

  if (actionId.startsWith("uw_distribution:")) {
    const [, buildingId, modeId] = actionId.split(":");
    const state = await load();
    const result = await engine.chooseDistribution(guildId, userId, state, buildingId, modeId, {
      payoutFn: (amount, meta) => creditUserWithEffects({
        guildId,
        userId,
        amount,
        type: "underworld_operation_payout",
        meta,
        awardSource: "underworld_operation_payout",
      }),
    });
    if (!result.ok) {
      await tell(interaction, `❌ ${result.reasonText}`);
      return true;
    }

    if (result.buildingLost) {
      session.view = "underworld_operations";
      session.underworldBuildingId = null;
      await tell(
        interaction,
        `💥 Full bust. The building is gone and you are jailed for ${result.jailedMinutes} minutes.`
      );
      await redraw();
      return true;
    }

    const raidLine = result.raidOutcome ? ` ${result.raidOutcome.name}.` : " Clean run.";
    await tell(
      interaction,
      `✅ Distribution completed. Payout: $${Number(result.payout || 0).toLocaleString()}.${raidLine}`
    );
    session.view = "underworld_building";
    session.underworldBuildingId = buildingId;
    await redraw();
    return true;
  }

  if (actionId.startsWith("uw_dismantle:") || actionId.startsWith("uw_emergency:")) {
    const emergency = actionId.startsWith("uw_emergency:");
    const buildingId = actionId.split(":")[1];
    const state = await load();
    const result = await engine.dismantleOperation(guildId, userId, state, buildingId, { emergency });
    if (!result.ok) {
      await tell(interaction, `❌ ${result.reasonText}`);
      return true;
    }

    await tell(
      interaction,
      `✅ Setup dismantled. Refund returned to bank: $${Number(result.refund || 0).toLocaleString()}.`
    );
    session.view = "underworld_building";
    session.underworldBuildingId = buildingId;
    await redraw();
    return true;
  }

  return true;
}

module.exports = {
  isUnderworldInteraction,
  handleUnderworldInteraction,
};
