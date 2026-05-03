const { EmbedBuilder } = require("discord.js");

const ui = require("../../utils/ui");
const farming = require("../../utils/farming/engine");
const farmWeather = require("../../utils/farming/weather");
const market = require("../../utils/farming/market");
const machineEngine = require("../../utils/farming/machineEngine");
const farmingUi = require("../farming/ui");
const manufacturing = require("../../utils/manufacturing/engine");
const manufacturingUi = require("../manufacturing/ui");
const underworld = require("../../utils/underworld/engine");
const underworldUi = require("../underworld/ui");
const underworldSuspicion = require("../../utils/underworld/suspicion");
const smugglingEngine = require("../../utils/underworld/smugglingEngine");

async function renderEnterpriseView({
  session,
  msg,
  guildId,
  userId,
  buildUnderworldEmbed,
  buildUnderworldComponents,
  buildEnterprisesComponents,
}) {
  if (session.view === "farming") {
    try {
      const farm = await farming.ensureFarm(guildId, userId);
      const weatherState = await farmWeather.ensureDailyWeatherState(guildId);
      const components = farmingUi.buildFarmingComponents(farm);
      const weatherChannel = farmWeather.buildWeatherChannel(weatherState);

      await msg.edit({
        embeds: [farmingUi.buildFarmingEmbed(farm, weatherChannel, guildId)],
        components,
      });
      return true;
    } catch (err) {
      console.error("[FARM] redraw failed:", err);
      await msg.edit({
        embeds: [
          new EmbedBuilder()
            .setTitle("Farming")
            .setDescription("Farming failed to load. Check the bot logs for details.")
            .setColor(ui.colors.danger),
        ],
        components: buildEnterprisesComponents(false),
      }).catch(() => {});
      return true;
    }
  }

  if (session.view === "farm_field") {
    const farm = await farming.ensureFarm(guildId, userId);
    await farmWeather.ensureDailyWeatherState(guildId);
    await msg.edit({
      embeds: [farmingUi.buildFieldEmbed(farm, session.fieldIndex, guildId)],
      components: farmingUi.buildFieldComponents(farm, session.fieldIndex, guildId),
    }).catch(() => {});
    return true;
  }

  if (session.view === "farm_market") {
    const items = await market.getSellableFarmItems(guildId, userId);
    await msg.edit({
      embeds: [farmingUi.buildFarmMarketEmbed(items)],
      components: farmingUi.buildFarmMarketComponents(items),
    }).catch(() => {});
    return true;
  }

  if (session.view === "farm_store") {
    const farm = await farming.ensureFarm(guildId, userId);
    const storePage = session.farmStorePage || "home";
    const storeEmbed = storePage === "fertiliser"
      ? farmingUi.buildFarmStoreFertiliserEmbed(farm)
      : storePage === "husbandry"
        ? farmingUi.buildFarmStoreHusbandryEmbed(farm)
        : farmingUi.buildFarmStoreHomeEmbed(farm);
    const storeComponents = storePage === "fertiliser"
      ? farmingUi.buildFarmStoreFertiliserComponents(farm)
      : storePage === "husbandry"
        ? farmingUi.buildFarmStoreHusbandryComponents(farm)
        : farmingUi.buildFarmStoreHomeComponents(farm);
    await msg.edit({
      embeds: [storeEmbed],
      components: storeComponents,
    }).catch(() => {});
    return true;
  }

  if (session.view === "farm_machines") {
    if (session.machinePage === "home") {
      await msg.edit({
        embeds: [farmingUi.buildMachineShedHomeEmbed()],
        components: farmingUi.buildMachineShedHomeComponents(),
      }).catch(() => {});
      return true;
    }

    if (["buy", "rent", "sell"].includes(session.machinePage)) {
      await msg.edit({
        embeds: [farmingUi.buildMachineActionEmbed(session.machinePage)],
        components: farmingUi.buildMachineActionCategoryComponents(session.machinePage),
      }).catch(() => {});
      return true;
    }

    if (session.machinePage?.startsWith("machine_cat:")) {
      const [, mode, category] = session.machinePage.split(":");
      const machineState = await machineEngine.ensureMachineState(guildId, userId);
      await msg.edit({
        embeds: [farmingUi.buildMachineActionCategoryEmbed(category, machineState, mode)],
        components: farmingUi.buildMachineActionSelectComponents(category, machineState, mode),
      }).catch(() => {});
      return true;
    }
  }

  if (session.view === "manufacturing") {
    try {
      let plant = await manufacturing.ensureState(guildId, userId);
      const runtime = await manufacturing.applyRuntimeRollovers(guildId, userId, plant);
      plant = runtime.state;

      await msg.edit({
        embeds: [manufacturingUi.buildManufacturingEmbed(plant)],
        components: manufacturingUi.buildManufacturingComponents(plant),
      }).catch(() => {});
      return true;
    } catch (err) {
      console.error("[MANUFACTURING] redraw failed:", err);
      await msg.edit({
        embeds: [
          new EmbedBuilder()
            .setTitle("Manufacturing")
            .setDescription("Manufacturing failed to load. Check the bot logs for details.")
            .setColor(ui.colors.danger),
        ],
        components: buildEnterprisesComponents(false),
      }).catch(() => {});
      return true;
    }
  }

  if (session.view === "manu_plot") {
    let plant = await manufacturing.ensureState(guildId, userId);
    const runtime = await manufacturing.applyRuntimeRollovers(guildId, userId, plant);
    plant = runtime.state;
    await msg.edit({
      embeds: [manufacturingUi.buildPlotEmbed(plant, session.manuPlotIndex)],
      components: manufacturingUi.buildPlotComponents(plant, session.manuPlotIndex),
    }).catch(() => {});
    return true;
  }

  if (session.view === "manu_plot_type") {
    const plant = await manufacturing.ensureState(guildId, userId);
    const plot = plant.plots?.[session.manuPlotIndex] || null;
    await msg.edit({
      embeds: [manufacturingUi.buildFactoryTypeEmbed(plot, session.manuPlotIndex)],
      components: manufacturingUi.buildFactoryTypeComponents(session.manuPlotIndex),
    }).catch(() => {});
    return true;
  }

  if (session.view === "manu_plot_import") {
    const plant = await manufacturing.ensureState(guildId, userId);
    const plot = plant.plots?.[session.manuPlotIndex];
    const items = plot ? await manufacturing.listFarmImportCandidates(guildId, userId, plot) : [];
    await msg.edit({
      embeds: [manufacturingUi.buildImportEmbed(plot || {}, session.manuPlotIndex, items)],
      components: manufacturingUi.buildImportComponents(session.manuPlotIndex, items),
    }).catch(() => {});
    return true;
  }

  if (session.view === "manu_plot_materials") {
    const plant = await manufacturing.ensureState(guildId, userId);
    const plot = plant.plots?.[session.manuPlotIndex] || plant.plots?.[0] || {};
    await msg.edit({
      embeds: [manufacturingUi.buildMaterialsEmbed(plot, session.manuPlotIndex || 0)],
      components: manufacturingUi.buildMaterialsComponents(plot, session.manuPlotIndex || 0),
    }).catch(() => {});
    return true;
  }

  if (session.view === "manu_material_qty") {
    const plant = await manufacturing.ensureState(guildId, userId);
    const plotIndex = session.manuPlotIndex || 0;
    const plot = plant.plots?.[plotIndex] || plant.plots?.[0] || {};
    const item = manufacturing.getShopItemsForPlot(plot).find((entry) => entry.id === session.manuMaterialId) || null;
    await msg.edit({
      embeds: [manufacturingUi.buildMaterialQuantityEmbed(plot, plotIndex, item)],
      components: manufacturingUi.buildMaterialQuantityComponents(plot, plotIndex, item),
    }).catch(() => {});
    return true;
  }

  if (session.view === "manu_market") {
    let plant = await manufacturing.ensureState(guildId, userId);
    const runtime = await manufacturing.applyRuntimeRollovers(guildId, userId, plant);
    plant = runtime.state;
    await msg.edit({
      embeds: [manufacturingUi.buildMarketEmbed(plant)],
      components: manufacturingUi.buildMarketComponents(plant),
    }).catch(() => {});
    return true;
  }

  if (session.view === "manu_contracts") {
    let plant = await manufacturing.ensureState(guildId, userId);
    plant = manufacturing.refreshContractBoard(plant);
    await manufacturing.saveState(guildId, userId, plant);
    await msg.edit({
      embeds: [manufacturingUi.buildContractsEmbed(plant)],
      components: manufacturingUi.buildContractsComponents(plant),
    }).catch(() => {});
    return true;
  }

  if (session.view === "underworld") {
    await msg.edit({
      embeds: [buildUnderworldEmbed()],
      components: buildUnderworldComponents(false),
    }).catch(() => {});
    return true;
  }

  if (session.view === "underworld_operations") {
    const state = await underworld.ensureState(guildId, userId);
    await underworld.applyRuntime(guildId, userId, state);
    await msg.edit({
      embeds: [underworldUi.buildOperationsEmbed(state)],
      components: underworldUi.buildOperationsComponents(state),
    }).catch(() => {});
    return true;
  }

  if (session.view === "underworld_building") {
    const state = await underworld.ensureState(guildId, userId);
    await underworld.applyRuntime(guildId, userId, state);

    const buildingCount = state.buildings?.length || 0;
    if (!buildingCount) {
      session.view = "underworld_operations";
      session.underworldBuildingId = null;
      await msg.edit({
        embeds: [underworldUi.buildOperationsEmbed(state)],
        components: underworldUi.buildOperationsComponents(state),
      }).catch(() => {});
      return true;
    }

    const currentBuilding = underworld.resolveBuilding(state, session.underworldBuildingId);
    if (!currentBuilding.building) {
      session.underworldBuildingId = state.buildings[0]?.id || null;
    }

    await msg.edit({
      embeds: [underworldUi.buildBuildingEmbed(state, session.underworldBuildingId)],
      components: underworldUi.buildBuildingComponents(state, session.underworldBuildingId),
    }).catch(() => {});
    return true;
  }

  if (session.view === "underworld_smuggling") {
    const state = await underworld.ensureState(guildId, userId);
    await underworld.applyRuntime(guildId, userId, state);
    await smugglingEngine.openDueEvent(guildId, userId, state);
    await underworld.saveState(guildId, userId, state);
    const suspicionInfo = await underworldSuspicion.getUnderworldSuspicion(guildId, userId);
    await msg.edit({
      embeds: [underworldUi.buildSmugglingHomeEmbed(state, suspicionInfo)],
      components: underworldUi.buildSmugglingHomeComponents(state),
    }).catch(() => {});
    return true;
  }

  if (session.view === "underworld_smuggling_garage") {
    const state = await underworld.ensureState(guildId, userId);
    await msg.edit({
      embeds: [underworldUi.buildVehicleGarageEmbed(state)],
      components: underworldUi.buildVehicleGarageComponents(state),
    }).catch(() => {});
    return true;
  }

  if (session.view === "underworld_smuggling_shop") {
    if (session.underworldSmugglingShopClass) {
      await msg.edit({
        embeds: [underworldUi.buildVehicleShopCategoryEmbed(session.underworldSmugglingShopClass)],
        components: underworldUi.buildVehicleShopCategoryComponents(session.underworldSmugglingShopClass),
      }).catch(() => {});
      return true;
    }

    await msg.edit({
      embeds: [underworldUi.buildVehicleShopEmbed()],
      components: underworldUi.buildVehicleShopComponents(),
    }).catch(() => {});
    return true;
  }

  if (session.view === "underworld_smuggling_start") {
    const state = await underworld.ensureState(guildId, userId);
    const suspicionInfo = await underworldSuspicion.getUnderworldSuspicion(guildId, userId);
    await msg.edit({
      embeds: [underworldUi.buildStartRunEmbed(state, session.underworldSmugglingFlow || {}, suspicionInfo)],
      components: underworldUi.buildStartRunComponents(state, session.underworldSmugglingFlow || {}),
    }).catch(() => {});
    return true;
  }

  if (session.view === "underworld_smuggling_active") {
    const state = await underworld.ensureState(guildId, userId);
    await smugglingEngine.openDueEvent(guildId, userId, state);
    await underworld.saveState(guildId, userId, state);
    const suspicionInfo = await underworldSuspicion.getUnderworldSuspicion(guildId, userId);
    await msg.edit({
      embeds: [underworldUi.buildActiveRunEmbed(state, suspicionInfo)],
      components: underworldUi.buildActiveRunComponents(state),
    }).catch(() => {});
    return true;
  }

  return false;
}

module.exports = {
  renderEnterpriseView,
};
