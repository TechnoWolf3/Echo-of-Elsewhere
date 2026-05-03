const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require("discord.js");

const ui = require("../../utils/ui");
const engine = require("../../utils/manufacturing/engine");
const market = require("../../utils/manufacturing/market");
const materials = require("../../data/manufacturing/materials");
const config = require("../../data/manufacturing/config");

function labelFactoryType(factoryType) {
  const data = engine.getFactoryTypes()[factoryType];
  return data ? `${data.emoji} ${data.name}` : "Unassigned";
}

function summarizeStorage(storage = {}) {
  const entries = Object.entries(storage || {}).filter(([, qty]) => Number(qty || 0) > 0);
  if (!entries.length) return "Empty";
  return entries
    .slice(0, 6)
    .map(([itemId, qty]) => `${engine.getOutputItemName(itemId)} x${qty}`)
    .join("\n");
}

function buildManufacturingEmbed(state) {
  const plots = state.plots || [];
  const nextCost = plots.length < config.MAX_PLOTS ? engine.getNextPlotCost(plots.length) : null;
  const counts = plots.reduce((acc, plot) => {
    if (plot.factoryType) acc.assigned += 1;
    if ((plot.pendingImports || []).length) acc.importing += 1;
    acc.running += (plot.productionSlots || []).filter((slot) => slot?.recipeId).length;
    acc.finished += Object.values(plot.outputStorage || {}).reduce((sum, qty) => sum + Number(qty || 0), 0);
    return acc;
  }, { assigned: 0, importing: 0, running: 0, finished: 0 });

  const plotLines = plots.length
    ? plots.map((plot, index) => {
        const slots = (plot.productionSlots || []).filter((slot) => slot?.recipeId).length;
        const capacity = engine.getStorageCapacity(plot.level);
        return `**Plot ${index + 1}** - Lv ${plot.level} - ${labelFactoryType(plot.factoryType)} - Slots ${slots}/${engine.getProductionSlotCount(plot.level)} - In ${engine.sumStorage(plot.inputStorage)}/${capacity} - Out ${engine.sumStorage(plot.outputStorage)}/${capacity}`;
      }).join("\n")
    : "No factory plots yet. Buy your first plot to begin production.";

  return ui.applySystemStyle(
    new EmbedBuilder()
      .setTitle("🏭 Manufacturing")
      .setDescription(
        [
          plots.length < config.MAX_PLOTS
            ? `Next plot: **${ui.money(nextCost)}**`
            : "Factory plot limit reached.",
          "",
          "Expand your enterprise with factory plots, recipes, contracts, and market sales.",
        ].join("\n")
      )
      .addFields(
        {
          name: "Network Status",
          value: [
            `Plots: **${plots.length}/${config.MAX_PLOTS}**`,
            `Assigned: **${counts.assigned}**`,
            `Running Slots: **${counts.running}**`,
            `Imports In Transit: **${counts.importing}**`,
            `Finished Goods: **${counts.finished}**`,
          ].join("\n"),
          inline: true,
        },
        {
          name: "Factory Plots",
          value: plotLines.slice(0, 1024),
          inline: false,
        }
      ),
    "job",
    "Mirror your farming growth: buy plots, assign factory types, and build output chains."
  );
}

function buildManufacturingComponents(state) {
  const rows = [];
  const plots = state.plots || [];
  const buttons = [];

  if (plots.length < config.MAX_PLOTS) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId("manu_buy")
        .setLabel(`Buy Plot (${ui.money(engine.getNextPlotCost(plots.length))})`)
        .setStyle(ButtonStyle.Success)
    );
  }

  buttons.push(
    new ButtonBuilder().setCustomId("manu_market").setLabel("📈 Market").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("manu_contracts").setLabel("📜 Contracts").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("manu_shop").setLabel("🛒 Shop").setStyle(ButtonStyle.Primary)
  );

  rows.push(new ActionRowBuilder().addComponents(buttons));

  for (let start = 0; start < plots.length; start += 5) {
    rows.push(
      new ActionRowBuilder().addComponents(
        plots.slice(start, start + 5).map((_, offset) => {
          const index = start + offset;
          return new ButtonBuilder()
            .setCustomId(`manu_select:${index}`)
            .setLabel(`Plot ${index + 1}`)
            .setStyle(ButtonStyle.Primary);
        })
      )
    );
  }

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("job_back:hub")
        .setLabel(ui.nav.back.label)
        .setEmoji(ui.nav.back.emoji)
        .setStyle(ui.nav.back.style)
    )
  );

  return rows;
}

function renderPlotVisual(plot) {
  const size = Math.min(3 + Math.max(0, Number(plot?.level || 1) - 1), 6);
  const tile = plot?.factoryType === "food_processing"
    ? "🟨"
    : plot?.factoryType === "textiles"
      ? "🟪"
      : plot?.factoryType === "electronics"
        ? "🟦"
        : plot?.factoryType === "construction"
          ? "🟫"
          : "⬜";
  const rows = [];
  for (let row = 0; row < size; row += 1) {
    rows.push(Array.from({ length: size }, () => tile).join(""));
  }
  return rows.join("\n");
}

function buildPlotEmbed(state, plotIndex) {
  const plot = (state.plots || [])[plotIndex];
  if (!plot) {
    return ui.applySystemStyle(
      new EmbedBuilder().setTitle("🏭 Factory Plot").setDescription("That factory plot does not exist."),
      "job"
    );
  }

  const capacity = engine.getStorageCapacity(plot.level);
  const slots = engine.getProductionSlotCount(plot.level);
  const activeSlots = (plot.productionSlots || [])
    .map((slot, index) => ({ slot, index }))
    .filter(({ slot }) => slot?.recipeId)
    .map(({ slot, index }) => {
      const recipe = engine.getRecipe(slot.recipeId);
      const eventLine = slot.event && Date.now() >= Number(slot.eventAt || 0) && !slot.event.handled
        ? ` - Event: ${slot.event.name}`
        : slot.event?.handled
          ? " - Bonus locked in"
          : "";
      return `Slot ${index + 1}: ${recipe?.name || slot.recipeId} until <t:${Math.floor(Number(slot.endsAt || 0) / 1000)}:R>${eventLine}`;
    });

  return ui.applySystemStyle(
    new EmbedBuilder()
      .setTitle(`🏭 Factory Plot ${plotIndex + 1}`)
      .setDescription(
        [
          "**Factory Layout**",
          renderPlotVisual(plot),
          "",
          `Type: **${labelFactoryType(plot.factoryType)}**`,
          `Level: **${plot.level}**`,
          `Slots: **${activeSlots.length}/${slots}**`,
          `Input Storage: **${engine.sumStorage(plot.inputStorage)}/${capacity}**`,
          `Output Storage: **${engine.sumStorage(plot.outputStorage)}/${capacity}**`,
          `Imports Waiting: **${(plot.pendingImports || []).length}**`,
        ].join("\n")
      )
      .addFields(
        {
          name: "Input Storage",
          value: summarizeStorage(plot.inputStorage).slice(0, 1024),
          inline: false,
        },
        {
          name: "Output Storage",
          value: summarizeStorage(plot.outputStorage).slice(0, 1024),
          inline: false,
        },
        {
          name: "Production Slots",
          value: activeSlots.length ? activeSlots.join("\n").slice(0, 1024) : "All slots idle.",
          inline: false,
        }
      ),
    "job",
    "Factory events are optional. Ignoring them causes no penalty; handling them grants a bonus."
  );
}

function buildPlotComponents(state, plotIndex) {
  const plot = (state.plots || [])[plotIndex];
  if (!plot) {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("manu_back")
          .setLabel(ui.nav.back.label)
          .setEmoji(ui.nav.back.emoji)
          .setStyle(ui.nav.back.style)
      )
    ];
  }

  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`manu_plot_type:${plotIndex}`)
        .setLabel(plot.factoryType ? "Change Type" : "Assign Type")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`manu_plot_import:${plotIndex}`)
        .setLabel("Import Farm Goods")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`manu_plot_materials:${plotIndex}`)
        .setLabel("Buy Materials")
        .setStyle(ButtonStyle.Secondary)
    )
  ];

  const pendingEvent = (plot.productionSlots || []).findIndex(
    (slot) => slot?.event && Date.now() >= Number(slot.eventAt || 0) && !slot.event.handled
  );

  const secondButtons = [];
  if (plot.factoryType) {
    secondButtons.push(
      new ButtonBuilder()
        .setCustomId(`manu_upgrade:${plotIndex}`)
        .setLabel(`Upgrade (${ui.money(engine.getUpgradeCost(plot.level))})`)
        .setStyle(ButtonStyle.Success)
        .setDisabled((plot.level || 1) >= config.MAX_PLOT_LEVEL || engine.getUpgradeCost(plot.level) <= 0)
    );
  }
  if (pendingEvent >= 0) {
    secondButtons.push(
      new ButtonBuilder()
        .setCustomId(`manu_event:${plotIndex}:${pendingEvent}`)
        .setLabel("Handle Event")
        .setStyle(ButtonStyle.Primary)
    );
  }
  if (secondButtons.length) {
    rows.push(new ActionRowBuilder().addComponents(secondButtons));
  }

  if (plot.factoryType) {
    const recipes = engine.getRecipesForFactory(plot.factoryType, plot.level);
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`manu_recipe_select:${plotIndex}`)
          .setPlaceholder("Start a production recipe...")
          .addOptions(
            recipes.slice(0, 25).map((recipe) => ({
              label: recipe.name,
              value: `manu_start:${plotIndex}:${recipe.id}`,
              description: `Lv ${recipe.unlockLevel} - ${recipe.baseTimeSeconds}s - ${recipe.output.amount} output`,
            }))
          )
      )
    );
  }

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("manu_back")
        .setLabel(ui.nav.back.label)
        .setEmoji(ui.nav.back.emoji)
        .setStyle(ui.nav.back.style)
    )
  );

  return rows;
}

function buildFactoryTypeEmbed(plot, plotIndex) {
  const lines = Object.entries(engine.getFactoryTypes()).map(([, type]) => {
    return `${type.emoji} **${type.name}**\n${type.description}`;
  });

  return ui.applySystemStyle(
    new EmbedBuilder()
      .setTitle(`🏭 Plot ${plotIndex + 1} Factory Type`)
      .setDescription(lines.join("\n\n")),
    "job",
    plot?.factoryType
      ? "Changing factory type keeps only part of your stored stock and clears active work."
      : "Choose the production focus for this plot."
  );
}

function buildFactoryTypeComponents(plotIndex) {
  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`manu_type_select:${plotIndex}`)
        .setPlaceholder("Choose a factory type...")
        .addOptions(
          Object.entries(engine.getFactoryTypes()).map(([id, type]) => ({
            label: type.name,
            value: `manu_type:${plotIndex}:${id}`,
            description: type.description.slice(0, 100),
            emoji: type.emoji,
          }))
        )
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`manu_return_plot:${plotIndex}`)
        .setLabel(ui.nav.back.label)
        .setEmoji(ui.nav.back.emoji)
        .setStyle(ui.nav.back.style)
    )
  ];
}

function buildImportEmbed(plot, plotIndex, items) {
  return ui.applySystemStyle(
    new EmbedBuilder()
      .setTitle(`🚛 Plot ${plotIndex + 1} Import Bay`)
      .setDescription(
        [
          "Move farm goods into this plot's input storage.",
          "",
          `Storage: **${engine.sumStorage(plot.inputStorage)}/${engine.getStorageCapacity(plot.level)}**`,
          "",
          items.length
            ? items.slice(0, 8).map((item) => `${item.relevant ? "⭐" : "•"} **${item.name}** x${item.qty}`).join("\n")
            : "You do not have any farm goods ready to import.",
        ].join("\n")
      ),
    "job",
    "Imports take time, but they are cheaper than buying dedicated manufacturing stock."
  );
}

function buildImportComponents(plotIndex, items) {
  const rows = [];
  if (items.length) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`manu_import_select:${plotIndex}`)
          .setPlaceholder("Choose a farm good to import (batch of up to 5)...")
          .addOptions(
            items.slice(0, 25).map((item) => ({
              label: `${item.name} (${item.qty})`,
              value: `manu_import:${plotIndex}:${item.itemId}`,
              description: item.relevant ? "Used by this plot's recipes" : "Can still be stored here",
            }))
          )
      )
    );
  }

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`manu_return_plot:${plotIndex}`)
        .setLabel(ui.nav.back.label)
        .setEmoji(ui.nav.back.emoji)
        .setStyle(ui.nav.back.style)
    )
  );

  return rows;
}

function buildMaterialsEmbed(plot, plotIndex) {
  const items = Object.values(materials)
    .filter((item) => !plot.factoryType || item.factoryTypes.includes(plot.factoryType));

  return ui.applySystemStyle(
    new EmbedBuilder()
      .setTitle(`🛒 Plot ${plotIndex + 1} Supply Shop`)
      .setDescription(
        items.slice(0, 10).map((item) => {
          return `**${item.name}**\n${ui.money(item.price)} for ${item.bundleAmount} ${item.unitName}${item.bundleAmount === 1 ? "" : "s"}`;
        }).join("\n\n") || "No shop bundles are available for this plot yet."
      ),
    "job",
    "Purchased materials are instant, more expensive, and cannot be sold."
  );
}

function buildMaterialsComponents(plot, plotIndex) {
  const items = Object.values(materials)
    .filter((item) => !plot.factoryType || item.factoryTypes.includes(plot.factoryType));
  const rows = [];

  if (items.length) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`manu_material_select:${plotIndex}`)
          .setPlaceholder("Buy a materials bundle...")
          .addOptions(
            items.slice(0, 25).map((item) => ({
              label: item.name,
              value: `manu_material:${plotIndex}:${item.id}`,
              description: `${ui.money(item.price)} for ${item.bundleAmount}`,
            }))
          )
      )
    );
  }

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`manu_return_plot:${plotIndex}`)
        .setLabel(ui.nav.back.label)
        .setEmoji(ui.nav.back.emoji)
        .setStyle(ui.nav.back.style)
    )
  );

  return rows;
}

function buildMarketEmbed(state) {
  const items = market.getSellableItems(state);
  return ui.applySystemStyle(
    new EmbedBuilder()
      .setTitle("📈 Manufacturing Market")
      .setDescription(
        items.length
          ? items.map((item) => `**${item.name}** x${item.qty}\n${ui.money(item.unitPrice)} each - Total ${ui.money(item.totalValue)}`).join("\n\n")
          : "You do not have any market-ready finished goods."
      ),
    "job",
    "Manufacturing market sales are instant, but they pay less than contracts."
  );
}

function buildMarketComponents(state) {
  const items = market.getSellableItems(state);
  const rows = [];
  if (items.length) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("manu_market_select")
          .setPlaceholder("Sell all stock of a finished good...")
          .addOptions(
            items.slice(0, 25).map((item) => ({
              label: `${item.name} (${item.qty})`,
              value: `manu_sell:${item.itemId}`,
              description: `Sell all for ${ui.money(item.totalValue)}`,
            }))
          )
      )
    );
  }

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("manu_back")
        .setLabel(ui.nav.back.label)
        .setEmoji(ui.nav.back.emoji)
        .setStyle(ui.nav.back.style)
    )
  );

  return rows;
}

function buildContractsEmbed(state) {
  const offers = state.contractBoard?.offers || [];
  return ui.applySystemStyle(
    new EmbedBuilder()
      .setTitle("📜 Manufacturing Contracts")
      .setDescription(
        offers.length
          ? offers.map((offer) => `**${offer.name}** x${offer.qty}\nPays ${ui.money(offer.payout)} - Expires <t:${Math.floor(Number(offer.expiresAt || 0) / 1000)}:R>`).join("\n\n")
          : "No contracts are available right now. Check back after the board refreshes."
      ),
    "job",
    "Contracts pay better than the spot market, but require finished goods on hand."
  );
}

function buildContractsComponents(state) {
  const offers = state.contractBoard?.offers || [];
  const rows = [];
  if (offers.length) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("manu_contract_select")
          .setPlaceholder("Fulfill a contract...")
          .addOptions(
            offers.slice(0, 25).map((offer) => ({
              label: `${offer.name} (${offer.qty})`,
              value: `manu_contract:${offer.id}`,
              description: `Pays ${ui.money(offer.payout)}`,
            }))
          )
      )
    );
  }

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("manu_back")
        .setLabel(ui.nav.back.label)
        .setEmoji(ui.nav.back.emoji)
        .setStyle(ui.nav.back.style)
    )
  );

  return rows;
}

module.exports = {
  buildManufacturingEmbed,
  buildManufacturingComponents,
  buildPlotEmbed,
  buildPlotComponents,
  buildFactoryTypeEmbed,
  buildFactoryTypeComponents,
  buildImportEmbed,
  buildImportComponents,
  buildMaterialsEmbed,
  buildMaterialsComponents,
  buildMarketEmbed,
  buildMarketComponents,
  buildContractsEmbed,
  buildContractsComponents,
};
