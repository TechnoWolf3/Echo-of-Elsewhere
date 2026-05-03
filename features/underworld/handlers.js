const { MessageFlags } = require("discord.js");

const engine = require("../../utils/underworld/engine");
const smuggling = require("../../utils/underworld/smugglingEngine");
const { creditUserWithEffects } = require("../../utils/effectSystem");
const branches = require("../../data/underworld/branches");

const BRANCH_MAP = Object.fromEntries(branches.map((branch) => [branch.value, branch]));

function isUnderworldInteraction(actionId) {
  return (
    actionId === "enterprise:underworld" ||
    actionId.startsWith("underworld:") ||
    actionId === "uw_home" ||
    actionId === "uw_operations" ||
    actionId === "uw_smuggling" ||
    actionId === "uw_refresh" ||
    actionId.startsWith("uw_select:") ||
    actionId.startsWith("uw_buy_building:") ||
    actionId.startsWith("uw_convert:") ||
    actionId.startsWith("uw_start:") ||
    actionId.startsWith("uw_event:") ||
    actionId.startsWith("uw_distribution:") ||
    actionId.startsWith("uw_store_smuggling:") ||
    actionId.startsWith("uw_dismantle:") ||
    actionId.startsWith("uw_emergency:") ||
    actionId.startsWith("uw_smuggle_")
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

  if (actionId === "uw_smuggling") {
    const state = await load();
    await smuggling.openDueEvent(guildId, userId, state);
    await engine.saveState(guildId, userId, state);
    session.view = "underworld_smuggling";
    session.underworldSmugglingFlow = null;
    await redraw();
    return true;
  }

  if (actionId === "uw_refresh") {
    const state = await load();
    await smuggling.openDueEvent(guildId, userId, state);
    await engine.saveState(guildId, userId, state);
    await redraw();
    return true;
  }

  if (actionId === "uw_smuggle_garage") {
    await load();
    session.view = "underworld_smuggling_garage";
    await redraw();
    return true;
  }

  if (actionId === "uw_smuggle_shop") {
    await load();
    session.view = "underworld_smuggling_shop";
    session.underworldSmugglingShopClass = null;
    await redraw();
    return true;
  }

  if (actionId.startsWith("uw_smuggle_shop_class:")) {
    await load();
    session.view = "underworld_smuggling_shop";
    session.underworldSmugglingShopClass = actionId.slice("uw_smuggle_shop_class:".length);
    await redraw();
    return true;
  }

  if (actionId.startsWith("uw_smuggle_buy_vehicle:")) {
    const vehicleType = actionId.split(":")[1];
    const state = await load();
    const result = await smuggling.purchaseVehicle(guildId, userId, state, vehicleType);
    if (!result.ok) {
      await tell(interaction, `❌ ${result.reasonText}`);
      return true;
    }
    await engine.saveState(guildId, userId, state);
    await tell(interaction, `✅ Purchased ${result.definition.label}.`);
    session.view = "underworld_smuggling_garage";
    session.underworldSmugglingShopClass = null;
    await redraw();
    return true;
  }

  if (actionId.startsWith("uw_smuggle_repair:")) {
    const vehicleId = actionId.split(":")[1];
    const state = await load();
    const result = await smuggling.repairVehicle(guildId, userId, state, vehicleId);
    if (!result.ok) {
      await tell(interaction, `❌ ${result.reasonText}`);
      return true;
    }
    await engine.saveState(guildId, userId, state);
    await tell(interaction, `✅ Repaired ${result.vehicle.nickname || "vehicle"} for $${Number(result.cost || 0).toLocaleString()}.`);
    session.view = "underworld_smuggling_garage";
    await redraw();
    return true;
  }

  if (actionId.startsWith("uw_smuggle_scrap:")) {
    const vehicleId = actionId.split(":")[1];
    const state = await load();
    const result = await smuggling.scrapVehicle(guildId, userId, state, vehicleId);
    if (!result.ok) {
      await tell(interaction, `❌ ${result.reasonText}`);
      return true;
    }
    await engine.saveState(guildId, userId, state);
    await tell(interaction, `✅ Scrapped ${result.vehicle.nickname || "vehicle"} for $${Number(result.value || 0).toLocaleString()}. The dealer tried not to laugh. Tried.`);
    session.view = "underworld_smuggling_garage";
    await redraw();
    return true;
  }

  if (actionId === "uw_smuggle_start" || actionId === "uw_smuggle_start_reset") {
    const state = await load();
    session.view = "underworld_smuggling_start";
    session.underworldSmugglingFlow = {};
    await redraw();
    return true;
  }

  if (actionId.startsWith("uw_smuggle_product:")) {
    await load();
    session.underworldSmugglingFlow = {
      ...(session.underworldSmugglingFlow || {}),
      productId: actionId.split(":")[1],
      sourceType: null,
      vehicleId: null,
      cargoAmount: null,
    };
    session.view = "underworld_smuggling_start";
    await redraw();
    return true;
  }

  if (actionId.startsWith("uw_smuggle_source:")) {
    await load();
    session.underworldSmugglingFlow = {
      ...(session.underworldSmugglingFlow || {}),
      sourceType: actionId.split(":")[1],
      vehicleId: null,
      cargoAmount: null,
    };
    session.view = "underworld_smuggling_start";
    await redraw();
    return true;
  }

  if (actionId.startsWith("uw_smuggle_run_vehicle:")) {
    await load();
    session.underworldSmugglingFlow = {
      ...(session.underworldSmugglingFlow || {}),
      vehicleId: actionId.split(":")[1],
      cargoAmount: null,
    };
    session.view = "underworld_smuggling_start";
    await redraw();
    return true;
  }

  if (actionId.startsWith("uw_smuggle_amount:")) {
    await load();
    session.underworldSmugglingFlow = {
      ...(session.underworldSmugglingFlow || {}),
      cargoAmount: Number(actionId.split(":")[1]),
    };
    session.view = "underworld_smuggling_start";
    await redraw();
    return true;
  }

  if (actionId === "uw_smuggle_confirm") {
    const state = await load();
    const flow = session.underworldSmugglingFlow || {};
    const result = await smuggling.startRun(guildId, userId, state, flow);
    if (!result.ok) {
      await tell(interaction, `❌ ${result.reasonText}`);
      return true;
    }
    await engine.saveState(guildId, userId, state);
    await tell(interaction, `✅ Route started. ETA <t:${Math.floor(Number(result.run.endsAt) / 1000)}:R>.`);
    session.underworldSmugglingFlow = null;
    session.view = "underworld_smuggling_active";
    await redraw();
    return true;
  }

  if (actionId === "uw_smuggle_active") {
    const state = await load();
    await smuggling.openDueEvent(guildId, userId, state);
    await engine.saveState(guildId, userId, state);
    session.view = "underworld_smuggling_active";
    await redraw();
    return true;
  }

  if (actionId.startsWith("uw_smuggle_event:")) {
    const choiceId = actionId.split(":")[1];
    const state = await load();
    const result = await smuggling.resolveEventChoice(guildId, userId, state, choiceId);
    if (!result.ok) {
      await tell(interaction, `❌ ${result.reasonText}`);
      return true;
    }
    await engine.saveState(guildId, userId, state);
    await tell(interaction, `✅ ${result.choice.label}${result.cost ? ` for $${Number(result.cost).toLocaleString()}` : ""}.`);
    session.view = "underworld_smuggling_active";
    await redraw();
    return true;
  }

  if (actionId === "uw_smuggle_claim") {
    const state = await load();
    const run = smuggling.getActiveRun(state);
    if (!run) {
      await tell(interaction, "❌ No active smuggling run to finish.");
      return true;
    }
    const result = await smuggling.finalizeRun(guildId, userId, state, run.id, {
      payoutFn: (amount, meta) => creditUserWithEffects({
        guildId,
        userId,
        amount,
        type: "underworld_smuggling_payout",
        meta,
        awardSource: "underworld_smuggling_payout",
      }),
    });
    if (!result.ok) {
      await tell(interaction, `❌ ${result.reasonText}`);
      return true;
    }
    smuggling.cleanupCompletedRuns(state);
    await engine.saveState(guildId, userId, state);
    const jailLine = result.jailedMinutes ? ` Jailed for ${result.jailedMinutes} minutes.` : "";
    await tell(
      interaction,
      `✅ Run complete: ${result.outcome.replace(/_/g, " ")}. Payout $${Number(result.payout || 0).toLocaleString()}, cargo lost ${Number(result.cargoLost || 0).toLocaleString()}, vehicle damage ${Number(result.damage || 0)}.${jailLine}`
    );
    session.view = "underworld_smuggling";
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
    const earlyLine = result.earlySale?.early
      ? ` Early sale: payout reduced, suspicion +${Number(result.earlySale.suspicionGain || 0)}.`
      : "";
    const reportLine = result.stolenReport
      ? ` ${result.stolenReport.name}: suspicion +${Number(result.stolenReport.suspicionDelta || 0)}.`
      : "";
    await tell(
      interaction,
      `✅ Distribution completed. Payout: $${Number(result.payout || 0).toLocaleString()}.${raidLine}${earlyLine}${reportLine}`
    );
    session.view = "underworld_building";
    session.underworldBuildingId = buildingId;
    await redraw();
    return true;
  }

  if (actionId.startsWith("uw_store_smuggling:")) {
    const buildingId = actionId.split(":")[1];
    const state = await load();
    const result = await engine.storeRunForSmuggling(guildId, userId, state, buildingId);
    if (!result.ok) {
      await tell(interaction, `❌ ${result.reasonText}`);
      return true;
    }

    await tell(
      interaction,
      `✅ Stored ${Number(result.producedUnits || 0).toLocaleString()} units for Smuggling instead of taking an immediate payout.`
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
