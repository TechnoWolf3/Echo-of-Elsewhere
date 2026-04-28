const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require("discord.js");

const ui = require("../../utils/ui");
const farming = require("../../utils/farming/engine");
const machineEngine = require("../../utils/farming/machineEngine");
const config = require("../../data/farming/config");

function formatFarmTaskName(taskKey) {
  return {
    cultivate: "Cultivating",
    seed: "Seeding",
    harvest: "Harvesting",
    fertilise: "Fertilising",
    upgrade: "Upgrading",
  }[taskKey] || "Working";
}

function formatCropName(cropId) {
  if (!cropId) return "No crop";
  return String(cropId)
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildFarmMarketEmbed(items) {
  if (!items || items.length === 0) {
    return ui.applySystemStyle(
      new EmbedBuilder().setTitle("💰 Farm Market").setDescription(
        [
          "You have no harvested crops to sell.",
          "",
          "Harvest produce from your fields, then come back here.",
        ].join("\n")
      ),
      "job"
    );
  }

  const lines = items.map((item) =>
    `**${item.name}** - ${item.qty} in stock\n$${item.unitPrice.toLocaleString()} each - Total: $${item.totalValue.toLocaleString()}`
  );

  return ui.applySystemStyle(
    new EmbedBuilder().setTitle("💰 Farm Market").setDescription(lines.join("\n\n")),
    "job"
  );
}

function buildFarmMarketComponents(items) {
  const rows = [];

  if (items && items.length > 0) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("farm_market_select")
          .setPlaceholder("Choose a crop to sell...")
          .addOptions(
            items.map((item) => ({
              label: `${item.name} (${item.qty})`,
              value: `farm_sell:${item.itemId}`,
              description: `Sell all for $${item.totalValue.toLocaleString()}`,
            }))
          )
      )
    );
  }

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("farm_back")
        .setLabel(ui.nav.back.label)
        .setEmoji(ui.nav.back.emoji)
        .setStyle(ui.nav.back.style)
    )
  );

  return rows;
}

function buildFarmStoreHomeEmbed() {
  return ui.applySystemStyle(
    new EmbedBuilder()
      .setTitle("Farm Store")
      .setDescription(
        [
          "Buy supplies for the farm.",
          "",
          "**Fertiliser** - Optional crop boosts for growth speed and yield.",
          "**Animal Husbandry** - Breeding items for barns.",
        ].join("\n")
      ),
    "job"
  );
}

function buildFarmStoreHomeComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("farm_store_fertiliser")
        .setLabel("Fertiliser")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("farm_store_husbandry")
        .setLabel("Animal Husbandry")
        .setStyle(ButtonStyle.Primary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("farm_back")
        .setLabel(ui.nav.back.label)
        .setEmoji(ui.nav.back.emoji)
        .setStyle(ui.nav.back.style)
    ),
  ];
}

function buildFarmStoreFertiliserEmbed(farm) {
  const fertiliserLines = farming.listFertilisers().map((fertiliser) => {
    const qty = farming.getFertiliserQty(farm, fertiliser.id);
    const growth = Math.round(Number(fertiliser.growthReductionPct || 0) * 100);
    const yieldBonus = Math.round(Number(fertiliser.yieldBonusPct || 0) * 100);
    const perks = [
      growth > 0 ? `${growth}% faster growth` : null,
      yieldBonus > 0 ? `${yieldBonus}% yield` : null,
    ].filter(Boolean).join(", ");
    return [
      `**${fertiliser.name}** - ${ui.money(fertiliser.price)}`,
      fertiliser.description,
      `Owned: **${qty}**${perks ? ` - Perks: ${perks}` : ""}`,
    ].join("\n");
  });

  return ui.applySystemStyle(
    new EmbedBuilder()
      .setTitle("Farm Store - Fertiliser")
      .setDescription("Choose a fertiliser, then enter the quantity to buy.")
      .addFields({
        name: "Stock",
        value: fertiliserLines.join("\n\n"),
      })
      .setFooter({ text: "Fertiliser is optional. Apply during early growth or after 75% growth for the best boosts." }),
    "job"
  );
}

function buildFarmStoreFertiliserComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("farm_store_fertiliser_select")
        .setPlaceholder("Choose fertiliser to buy...")
        .addOptions(
          farming.listFertilisers().map((fertiliser) => ({
            label: fertiliser.name,
            value: `farm_store_fertiliser_buy:${fertiliser.id}`,
            description: `$${Number(fertiliser.price || 0).toLocaleString()} - ${fertiliser.description}`.slice(0, 100),
          }))
        )
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("farm_store_home")
        .setLabel(ui.nav.back.label)
        .setEmoji(ui.nav.back.emoji)
        .setStyle(ui.nav.back.style)
    ),
  ];
}

function buildFarmStoreHusbandryEmbed(farm) {
  const itemLines = farming.listAnimalHusbandryItems().map((item) => {
    const qty = farming.getAnimalHusbandryQty(farm, item.id);
    const type = farming.getLivestockType(item.livestockType);
    return [
      `**${item.name}** - ${ui.money(item.price)}`,
      item.description,
      `Owned: **${qty}** - For: **${type?.animalName || "Livestock"}** - Matures in **${item.maturityHours}h**`,
    ].join("\n");
  });

  return ui.applySystemStyle(
    new EmbedBuilder()
      .setTitle("Farm Store - Animal Husbandry")
      .setDescription("Buy breeding supplies for barns. Baby animals count toward capacity but do not produce until mature.")
      .addFields({
        name: "Stock",
        value: itemLines.join("\n\n"),
      })
      .setFooter({ text: "Use husbandry items from the barn page. Barn upgrades pause production until complete." }),
    "job"
  );
}

function buildFarmStoreHusbandryComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("farm_store_husbandry_select")
        .setPlaceholder("Choose husbandry item to buy...")
        .addOptions(
          farming.listAnimalHusbandryItems().map((item) => ({
            label: item.name,
            value: `farm_store_husbandry_buy:${item.id}`,
            description: `$${Number(item.price || 0).toLocaleString()} - ${item.description}`.slice(0, 100),
          }))
        )
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("farm_store_home")
        .setLabel(ui.nav.back.label)
        .setEmoji(ui.nav.back.emoji)
        .setStyle(ui.nav.back.style)
    ),
  ];
}

function buildMachineShedHomeEmbed() {
  return ui.applySystemStyle(
    new EmbedBuilder().setTitle("🚜 Machine Shed").setDescription(
      [
        "Manage your farming equipment.",
        "",
        "🛒 **Buy** - Purchase new machinery",
        "📦 **Sell** - Sell owned equipment",
        "⏱️ **Rent** - Short-term equipment hire",
      ].join("\n")
    ),
    "job"
  );
}

function buildMachineShedHomeComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("machine_buy")
        .setLabel("🛒 Buy")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("machine_rent")
        .setLabel("⏱️ Rent")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("machine_sell")
        .setLabel("📦 Sell")
        .setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("farm_back")
        .setLabel(ui.nav.back.label)
        .setEmoji(ui.nav.back.emoji)
        .setStyle(ui.nav.back.style)
    ),
  ];
}

function machineActionLabel(mode) {
  if (mode === "rent") return "Rent";
  if (mode === "sell") return "Sell";
  return "Buy";
}

function buildMachineActionEmbed(mode = "buy") {
  return ui.applySystemStyle(
    new EmbedBuilder()
      .setTitle(`🚜 Machine Shed - ${machineActionLabel(mode)} Machinery`)
      .setDescription("Select a category to browse machines."),
    "job"
  );
}

function buildMachineActionCategoryComponents(mode = "buy") {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`machine_cat:${mode}:tractor`).setLabel("🚜 Tractors").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`machine_cat:${mode}:cultivate`).setLabel("🪓 Cultivation").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`machine_cat:${mode}:seed`).setLabel("🌱 Seeding").setStyle(ButtonStyle.Primary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`machine_cat:${mode}:spray`).setLabel("💧 Spraying").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`machine_cat:${mode}:harvest`).setLabel("🌾 Harvesting").setStyle(ButtonStyle.Primary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("machine_home")
        .setLabel(ui.nav.back.label)
        .setEmoji(ui.nav.back.emoji)
        .setStyle(ui.nav.back.style)
    ),
  ];
}

function machineCategoryList(category) {
  return machineEngine.listMachines().filter((m) => {
    if (category === "tractor") return m.type === "tractor";
    if (category === "cultivate") return m.type === "cultivator";
    if (category === "seed") return m.type === "seeder";
    if (category === "spray") return m.type === "sprayer";
    if (category === "harvest") return m.type === "harvester";
    return false;
  });
}

function buildMachineActionCategoryEmbed(category, state, mode = "buy") {
  const categoryNames = {
    tractor: "Tractors",
    cultivate: "Cultivation Equipment",
    seed: "Seeding Equipment",
    spray: "Spraying Equipment",
    harvest: "Harvesters",
  };

  const lines = machineCategoryList(category).map((m) => {
    const owned = machineEngine.getOwnedCount(state, m.id);
    const rented = machineEngine.getRentedCount(state, m.id);
    const busy = machineEngine.getOccupiedCountForMachine(state, m.id);
    const speedBonus = Math.max(0, Math.round((1 - (m.taskSpeedMult || 1)) * 100));
    const tasks = Array.isArray(m.requiredFor) && m.requiredFor.length ? m.requiredFor.join(", ") : "General use";

    const powerLine =
      m.type === "tractor"
        ? `Power: ${m.horsepower} HP`
        : m.minHorsepower
          ? `Requires: ${m.minHorsepower} HP`
          : null;

    return [
      `**${m.name}**`,
      `Tier ${m.tier} - Owned: ${owned} - Rented: ${rented} - Busy: ${busy}`,
      powerLine,
      `Buy: $${m.buyPrice.toLocaleString()} - Rent: $${m.rentPrice.toLocaleString()} - Sell: $${machineEngine.getSellValue(m).toLocaleString()}`,
      `Speed Bonus: ${speedBonus}% - Tasks: ${tasks}`,
    ].filter(Boolean).join("\n");
  });

  return ui.applySystemStyle(
    new EmbedBuilder()
      .setTitle(`🚜 Machine Shed - ${machineActionLabel(mode)} ${categoryNames[category] || "Machines"}`)
      .setDescription(lines.length ? lines.join("\n\n") : "No machines found in this category."),
    "job"
  );
}

function buildMachineActionSelectComponents(category, state, mode = "buy") {
  const machines = machineCategoryList(category);
  const selectable = mode === "sell"
    ? machines.filter((m) => machineEngine.getOwnedCount(state, m.id) > 0)
    : machines;

  const rows = [];

  if (selectable.length) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`machine_select:${mode}:${category}`)
          .setPlaceholder(`Choose a machine to ${machineActionLabel(mode).toLowerCase()}...`)
          .addOptions(
            selectable.map((m) => {
              const price = mode === "rent"
                ? m.rentPrice
                : mode === "sell"
                  ? machineEngine.getSellValue(m)
                  : m.buyPrice;

              return {
                label: mode === "sell" ? `${m.name} (${machineEngine.getOwnedCount(state, m.id)} owned)` : m.name,
                value: `farm_machine_${mode}:${m.id}`,
                description: `$${price.toLocaleString()}`,
              };
            })
          )
      )
    );
  } else {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("machine_noop")
          .setLabel(mode === "sell" ? "No Owned Machines Here" : "No Machines Available")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true)
      )
    );
  }

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`machine_${mode}`)
        .setLabel(ui.nav.back.label)
        .setEmoji(ui.nav.back.emoji)
        .setStyle(ui.nav.back.style)
    )
  );

  return rows;
}

function buildFarmingComponents(farm) {
  const rows = [];
  const fields = farm.fields || [];
  const actionButtons = [];

  if (fields.length < config.MAX_FIELDS) {
    const nextCost = farming.getNextFieldCost(fields.length);
    actionButtons.push(
      new ButtonBuilder()
        .setCustomId("farm_buy")
        .setLabel(`Buy Field ($${nextCost.toLocaleString()})`)
        .setStyle(ButtonStyle.Success)
    );
  }

  actionButtons.push(
    new ButtonBuilder().setCustomId("farm_market").setLabel("💰 Market").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("farm_store").setLabel("🏪 Store").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("farm_machines").setLabel("🚜 Machine Shed").setStyle(ButtonStyle.Primary)
  );

  rows.push(new ActionRowBuilder().addComponents(actionButtons));

  for (let start = 0; start < fields.length; start += 5) {
    rows.push(
      new ActionRowBuilder().addComponents(
        fields.slice(start, start + 5).map((_, offset) => {
          const index = start + offset;
          return new ButtonBuilder()
            .setCustomId(`farm_select:${index}`)
            .setLabel(farming.isBarn(fields[index]) ? `Barn ${index + 1}` : `Field ${index + 1}`)
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

function buildFarmingEmbed(farm, weatherChannel = null, guildId = null) {
  const fields = farm.fields || [];
  const season = farming.getCurrentSeason(guildId);
  const nextCost = fields.length < config.MAX_FIELDS ? farming.getNextFieldCost(fields.length) : null;

  const counts = fields.reduce(
    (acc, field) => {
      const state = field?.state || "empty";
      if (farming.isBarn(field)) acc.barns += 1;
      else if (state === "growing") acc.growing += 1;
      else if (state === "ready") acc.ready += 1;
      else if (state === "spoiled") acc.spoiled += 1;
      else if (!field?.cultivated) acc.cleanup += 1;
      else acc.empty += 1;
      if (farming.isFieldTaskActive(field) || farming.isBarnTaskActive(field)) acc.busy += 1;
      return acc;
    },
    { growing: 0, ready: 0, spoiled: 0, cleanup: 0, empty: 0, busy: 0, barns: 0 }
  );

  const fieldLines = fields.length
  ? fields.map((field, index) => {
      if (farming.isBarn(field)) {
        const type = farming.getLivestockType(field.livestockType);
        const production = farming.getBarnProductionInfo(field);
        const barnCounts = farming.getBarnAnimalCounts(field);
        const status = farming.isBarnTaskActive(field)
          ? `${formatFarmTaskName(field.task.key)}, completes <t:${Math.floor(Number(field.task.endsAt) / 1000)}:R>`
          : barnCounts.total <= 0
          ? "Empty barn"
          : production.readyCycles > 0
            ? `${type?.output?.name || "Products"} ready`
            : barnCounts.adults > 0 && production.readyAt
              ? `Next produce <t:${Math.floor(Number(production.readyAt) / 1000)}:R>`
              : "Waiting for adults";
        const babyText = barnCounts.babies > 0 ? ` (${barnCounts.babies} young)` : "";
        return [
          `**Barn ${index + 1}** - Lv **${field.level || 1}** - ${type?.animalName || "Livestock"}`,
          `${barnCounts.adults}/${farming.getBarnCapacity(field)} adults${babyText} - ${status}`,
        ].join("\n");
      }

      let status = "Empty";

      if (field.state === "growing") {
        if (field.readyAt) {
          status = `Growing, ready <t:${Math.floor(Number(field.readyAt) / 1000)}:R>`;
        } else {
          status = "Growing";
        }
      }

      if (field.state === "ready") status = "Ready";
      if (field.state === "spoiled") status = "Spoiled";
      if (field.state === "empty" && !field.cultivated) status = "Needs cleanup";
      if (field.fieldCondition?.label) status = field.fieldCondition.label;

      if (farming.isFieldTaskActive(field)) {
        status = `${formatFarmTaskName(field.task.key)}, completes <t:${Math.floor(Number(field.task.endsAt) / 1000)}:R>`;
      }

      const crop = field.cropId ? formatCropName(field.cropId) : "No crop";
      const size = farming.getFieldSize(field.level || 1);
      const usable = farming.getUsablePlots(field);
      const total = farming.getTotalPlots(field);
      const plotText = usable === total ? `${size}x${size}` : `${usable}/${total} plots`;

      return [
        `**Field ${index + 1}** - Lv **${field.level || 1}** - ${plotText}`,
        `${crop} - ${status}`,
      ].join("\n");
    }).join("\n\n")
  : "No fields yet. Buy your first field to start farming.";

  const embed = new EmbedBuilder()
    .setTitle("Farming")
    .setDescription(
      [
        `Season: **${season}**`,
        fields.length < config.MAX_FIELDS
          ? `Next field: **${ui.money(nextCost)}**`
          : "Field limit reached.",
      ].join("\n")
    )
    .addFields(
      {
        name: "Overview",
        value: [
          `Plots: **${fields.length}/${config.MAX_FIELDS}**`,
          `Barns: **${counts.barns}**`,
          `Open fields: **${counts.empty}**`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "Work Queue",
        value: [
          `Busy: **${counts.busy}**`,
          `Ready: **${counts.ready}**`,
          `Growing: **${counts.growing}**`,
          `Needs cleanup: **${counts.cleanup + counts.spoiled}**`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "Plots",
        value: fieldLines.slice(0, 1024),
        inline: false,
      }
    );

  if (weatherChannel) {
    embed.addFields({
      name: "Weather",
      value: [
        `**${weatherChannel.headline}**`,
        weatherChannel.impact,
        weatherChannel.report ? `> ${weatherChannel.report}` : "",
      ].filter(Boolean).join("\n"),
      inline: false,
    });
  }

  return ui.applySystemStyle(
    embed,
    "job",
    "Open a field to cultivate, plant, harvest, or upgrade."
  );
}

function renderBarnVisual(barn) {
  const type = farming.getLivestockType(barn?.livestockType);
  if (!type) return "";
  if (type.id === "chickens") return "🐔🐔🐔\n🟨🟨🟨";
  if (type.id === "sheep") return "🐑🐑🐑\n🟩🟩🟩";
  return "🐄🐄🐄\n🟫🟫🟫";
}

function renderFieldVisual(field) {
  if (!field) return "";

  const level = Math.max(1, Number(field.level || 1));
  const size = Math.min(farming.getFieldSize(level), 12);
  const cropId = String(field.cropId || "").toLowerCase();

  function tileForGrowing() {
    if (["spinach", "cabbage", "soybeans"].includes(cropId)) return "🟩";
    if (["wheat", "barley", "oats", "corn", "canola"].includes(cropId)) return "🌱";
    if (["carrots", "potatoes"].includes(cropId)) return "🟩";
    return "🟩";
  }

  function tileForReady() {
    if (["wheat", "barley", "oats", "corn", "canola"].includes(cropId)) return "🟨";
    if (["spinach", "soybeans", "cabbage"].includes(cropId)) return "🟩";
    if (["carrots", "potatoes"].includes(cropId)) return "🟧";
    return "🟨";
  }

  function buildGrid(tile, usePattern = false) {
    const rows = [];
    for (let r = 0; r < size; r++) {
      let line = "";
      for (let c = 0; c < size; c++) {
        if (usePattern && (r + c) % 2 === 1) line += "▪️";
        else line += tile;
      }
      rows.push(line);
    }
    return rows.join("\n");
  }

  function buildDebrisGrid() {
    const rows = [];
    for (let r = 0; r < size; r++) {
      let line = "";
      for (let c = 0; c < size; c++) {
        const roll = Math.random();
        if (roll < 0.14) line += "⬜";
        else if (roll < 0.24) line += "⬛";
        else line += "🟫";
      }
      rows.push(line);
    }
    return rows.join("\n");
  }

  function buildSpoiledGrid() {
    const rows = [];
    for (let r = 0; r < size; r++) {
      let line = "";
      for (let c = 0; c < size; c++) {
        const roll = Math.random();
        if (roll < 0.35) line += "⬛";
        else line += "🟫";
      }
      rows.push(line);
    }
    return rows.join("\n");
  }

  if (field.state === "spoiled") return buildSpoiledGrid();
  if (field.state === "empty" && !field.cultivated) return buildDebrisGrid();
  if (field.state === "ready") return buildGrid(tileForReady());
  if (field.state === "growing") return buildGrid(tileForGrowing(), true);

  return buildGrid("🟫");
}

function buildFieldEmbed(farm, fieldIndex, guildId = null) {
  const field = (farm.fields || [])[fieldIndex];

  if (!field) {
    return new EmbedBuilder()
      .setTitle("🌾 Field")
      .setDescription("That field does not exist.")
      .setColor(ui.colors.danger);
  }

  if (farming.isBarn(field)) {
    const type = farming.getLivestockType(field.livestockType);
    const capacity = farming.getBarnCapacity(field);
    const production = farming.getBarnProductionInfo(field);
    const counts = farming.getBarnAnimalCounts(field);
    const babyLine = counts.babyGroups.length
      ? counts.babyGroups.map((baby) => `${baby.qty} young mature <t:${Math.floor(Number(baby.maturesAt) / 1000)}:R>`).join("\n")
      : "None";
    const readyText = production.paused
      ? `Paused for upgrade until <t:${Math.floor(Number(production.readyAt || Date.now()) / 1000)}:R>`
      : production.readyCycles > 0
      ? `Ready now (${production.readyCycles} cycle${production.readyCycles === 1 ? "" : "s"})`
      : counts.adults > 0 && production.readyAt
        ? `<t:${Math.floor(Number(production.readyAt) / 1000)}:R>`
        : counts.babies > 0
          ? "Waiting for adults."
          : "Restock or breed animals to restart production.";

    return new EmbedBuilder()
      .setTitle(`Barn ${fieldIndex + 1}`)
      .setDescription(renderBarnVisual(field))
      .addFields(
        {
          name: "Barn",
          value: [
            `Type: **${type?.name || "Barn"}**`,
            `Level: **${field.level || 1}**`,
            `Season: **${farming.getCurrentSeason(guildId)}**`,
          ].join("\n"),
          inline: true,
        },
        {
          name: "Stock",
          value: [
            `Adults: **${counts.adults}/${capacity}**`,
            `Young: **${counts.babies}/${capacity}**`,
            `Total: **${Number(field.animalCount || 0)}/${capacity}** ${type?.animalName || "animals"}`,
          ].join("\n"),
          inline: true,
        },
        {
          name: "Production",
          value: [
            `Produce: **${type?.output?.name || "Produce"}** every **${type?.productionHours || 0}h**`,
            `Next collection: **${readyText}**`,
            `Slaughter output: **${type?.slaughter?.name || "Meat"}**`,
            `Demolition: **${ui.money(farming.getBarnDemolitionCost(field))}**`,
          ].join("\n"),
        },
        {
          name: "Animal Ages",
          value: `Maturing: ${babyLine}`,
        }
      )
      .setColor(ui.systems.job.color)
      .setFooter({ text: "Barns produce over time. Slaughter clears the current stock." });
  }

  const visual = renderFieldVisual(field);

  const allCrops = farming.getAvailableCrops(config.MAX_FIELD_LEVEL || 10);
  const cropMap = Object.fromEntries(allCrops.map((crop) => [crop.key, crop]));
  const crop = field.cropId ? cropMap[field.cropId] : null;
  const cropName = crop?.name || "None";

  let stateText = "Empty";
  if (field.state === "growing") stateText = "Growing";
  if (field.state === "ready") stateText = "Ready to Harvest";
  if (field.state === "spoiled") stateText = "Spoiled";
  if (field.state === "empty" && !field.cultivated) stateText = "Needs Cleanup";
  if (field.fieldCondition?.label) stateText = field.fieldCondition.label;

  const task = field.task || null;
  const taskLine =
    task?.key && task?.endsAt && Date.now() < Number(task.endsAt)
      ? [
          `Task: **${formatFarmTaskName(task.key)}**`,
          `Completes: <t:${Math.floor(Number(task.endsAt) / 1000)}:R>`,
          `At: <t:${Math.floor(Number(task.endsAt) / 1000)}:F>`,
        ].join("\n")
      : "";

  const readyLine =
    !task?.key && field.state === "growing" && field.readyAt
      ? [
          `Ready: <t:${Math.floor(Number(field.readyAt) / 1000)}:R>`,
          `At: <t:${Math.floor(Number(field.readyAt) / 1000)}:F>`,
        ].join("\n")
      : "";

  const cultivatedLine = field.cultivated ? "✅ Cultivated" : "❌ Needs Cultivation";
  const machineHint =
    field.state === "ready"
      ? "Needs a free harvester."
      : field.state === "empty" && field.cultivated && !field.fieldCondition?.requiresCultivation
        ? "Needs a tractor and seeder to plant."
        : field.state === "spoiled" || !field.cultivated || field.fieldCondition?.requiresCultivation
          ? "Needs a tractor and cultivator."
          : "Let it grow.";

  const fieldSize = farming.getFieldSize(field.level || 1);
  const totalPlots = farming.getTotalPlots(field);
  const usablePlots = farming.getUsablePlots(field);
  const yieldRange = crop ? farming.getScaledYieldRange(crop, field) : null;
  const fertiliserWindow = farming.getFertiliserWindow(field);
  const yieldBonus = Math.round(farming.getFertiliserYieldBonus(field) * 100);
  const weatherLines = [];
  if (field.cropWeatherEffect?.label) weatherLines.push(`🌦️ **Crop Effect:** ${field.cropWeatherEffect.label}`);
  if (field.fieldCondition?.label) weatherLines.push(`🧱 **Field Condition:** ${field.fieldCondition.label}`);

  return new EmbedBuilder()
    .setTitle(`Field ${fieldIndex + 1}`)
    .setDescription(visual)
    .addFields(
      {
        name: "Field",
        value: [
          `Level: **${field.level || 1}**`,
          `Size: **${fieldSize}x${fieldSize}**`,
          `Plots: **${usablePlots}/${totalPlots}** usable`,
          `Season: **${farming.getCurrentSeason(guildId)}**`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "Crop",
        value: [
          `Crop: **${cropName}**`,
          `Status: **${stateText}**`,
          yieldRange ? `Yield: **${yieldRange[0]}-${yieldRange[1]}**` : "Yield: **None**",
        ].join("\n"),
        inline: true,
      },
      {
        name: "Work",
        value: [
          `Condition: **${cultivatedLine}**`,
          `Machine need: **${machineHint}**`,
          taskLine || readyLine || "No active task.",
        ].filter(Boolean).join("\n"),
      },
      {
        name: "Fertiliser",
        value: [
          yieldBonus > 0 ? `Yield bonus: **+${yieldBonus}%**` : "Yield bonus: **None**",
          fertiliserWindow ? `Window: **${fertiliserWindow === "early" ? "Early growth" : "Late growth"}**` : "Window: **Closed**",
        ].join("\n"),
        inline: true,
      },
      {
        name: "Weather",
        value: weatherLines.length ? weatherLines.join("\n") : "No active field effects.",
        inline: true,
      }
    )
    .setColor(ui.systems.job.color)
    .setFooter({ text: "Fields can only run one task at a time." });
}

function buildFieldComponents(farm, fieldIndex, guildId = null) {
  const field = (farm.fields || [])[fieldIndex];
  const rows = [];

  if (farming.isBarn(field)) {
    return buildBarnComponents(farm, fieldIndex);
  }

  if (!field) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("farm_back")
          .setLabel(ui.nav.back.label)
          .setEmoji(ui.nav.back.emoji)
          .setStyle(ui.nav.back.style)
      )
    );
    return rows;
  }

  const taskActive = farming.isFieldTaskActive(field);

  if (taskActive) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("farm_task_busy")
          .setLabel("Task In Progress")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true)
      )
    );

    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("farm_back")
          .setLabel(ui.nav.back.label)
          .setEmoji(ui.nav.back.emoji)
          .setStyle(ui.nav.back.style)
      )
    );

    return rows;
  }

  const currentSeason = farming.getCurrentSeason(guildId);
  const cropOptions = farming
    .getAvailableCrops(field.level || 1)
    .filter((crop) => Array.isArray(crop.seasons) && crop.seasons.includes(currentSeason));

  if (field.state === "spoiled" || !field.cultivated || field.fieldCondition?.requiresCultivation) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`farm_cultivate:${fieldIndex}`)
          .setLabel("🧹 Cultivate")
          .setStyle(ButtonStyle.Secondary)
      )
    );
  }

  if (field.state === "empty" && field.cultivated && !field.fieldCondition?.requiresCultivation && cropOptions.length > 0) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`farm_plant_select:${fieldIndex}`)
          .setPlaceholder("Choose a crop...")
          .addOptions(
            cropOptions.map((crop) => ({
              label: crop.name,
              value: `farm_plant:${fieldIndex}:${crop.key}`,
              description: `Level ${crop.level} - ${crop.growthHours}h growth - ${farming.getScaledYieldRange(crop, field).join("-")}` ,
            }))
          )
      )
    );
  }

  if (field.state === "empty" && field.cultivated && !field.fieldCondition?.requiresCultivation && cropOptions.length === 0) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("farm_no_crops")
          .setLabel("No Seasonal Crops Available")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true)
      )
    );
  }

  if (field.state === "ready") {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`farm_harvest:${fieldIndex}`)
          .setLabel("🌾 Harvest")
          .setStyle(ButtonStyle.Success)
      )
    );
  }

  const activeFertiliserWindow = farming.getFertiliserWindow(field);
  const fertiliserOptions = farming
    .listFertilisers()
    .filter((fertiliser) => farming.getFertiliserQty(farm, fertiliser.id) > 0);

  if (activeFertiliserWindow) {
    if (fertiliserOptions.length) {
      rows.push(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`farm_fertilise_select:${fieldIndex}`)
            .setPlaceholder(`Apply fertiliser (${activeFertiliserWindow} window)...`)
            .addOptions(
              fertiliserOptions.map((fertiliser) => ({
                label: `${fertiliser.name} (${farming.getFertiliserQty(farm, fertiliser.id)})`,
                value: `farm_fertilise:${fieldIndex}:${fertiliser.id}`,
                description: fertiliser.description.slice(0, 100),
              }))
            )
        )
      );
    } else {
      rows.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("farm_fertiliser_none")
            .setLabel("No Fertiliser Owned")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
          new ButtonBuilder()
            .setCustomId("farm_store_fertiliser")
            .setLabel("Buy Fertiliser")
            .setStyle(ButtonStyle.Primary)
        )
      );
    }
  }

  if (field.cropId && (field.state === "growing" || field.state === "ready")) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`farm_recultivate:${fieldIndex}`)
          .setLabel("♻️ Re-Cultivate")
          .setStyle(ButtonStyle.Danger)
      )
    );
  }

  if (field.state === "empty" && field.cultivated && !field.fieldCondition?.requiresCultivation && (field.level || 1) < config.MAX_FIELD_LEVEL) {
    const upgradeCost = farming.getUpgradeCost(field.level || 1);
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`farm_upgrade:${fieldIndex}`)
          .setLabel(`⬆ Upgrade Field ($${upgradeCost.toLocaleString()})`)
          .setStyle(ButtonStyle.Primary)
      )
    );
  }

  if (field.state === "empty" && field.cultivated && !field.fieldCondition?.requiresCultivation) {
    const barnOptions = farming
      .getLivestockTypes()
      .filter((type) => (field.level || 1) >= Number(type.levelRequired || 1));

    if (barnOptions.length) {
      rows.push(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`farm_barn_select:${fieldIndex}`)
            .setPlaceholder("Convert to barn...")
            .addOptions(
              barnOptions.map((type) => ({
                label: type.name,
                value: `farm_barn:${fieldIndex}:${type.id}`,
                description: `$${Number(type.convertCost || 0).toLocaleString()} - ${type.animalName} - ${type.output?.name || "produce"}`,
              }))
            )
        )
      );
    }
  }

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("farm_back")
        .setLabel(ui.nav.back.label)
        .setEmoji(ui.nav.back.emoji)
        .setStyle(ui.nav.back.style)
    )
  );

  return rows;
}

function buildBarnComponents(farm, fieldIndex) {
  const barn = (farm.fields || [])[fieldIndex];
  const rows = [];

  if (!farming.isBarn(barn)) return buildFieldComponents(farm, fieldIndex);

  const production = farming.getBarnProductionInfo(barn);
  const counts = farming.getBarnAnimalCounts(barn);
  const hasAnimals = counts.total > 0;
  const hasAdults = counts.adults > 0;
  const busy = farming.isBarnTaskActive(barn);

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`farm_barn_collect:${fieldIndex}`)
        .setLabel("Collect Produce")
        .setStyle(ButtonStyle.Success)
        .setDisabled(busy || !hasAdults || production.readyCycles <= 0),
      new ButtonBuilder()
        .setCustomId(`farm_barn_slaughter:${fieldIndex}`)
        .setLabel("Slaughter")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(busy || !hasAnimals),
      new ButtonBuilder()
        .setCustomId(`farm_barn_restock:${fieldIndex}`)
        .setLabel("Restock")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(busy || hasAnimals)
    )
  );

  const husbandryOptions = farming
    .listAnimalHusbandryItems()
    .filter((item) => item.livestockType === barn.livestockType && farming.getAnimalHusbandryQty(farm, item.id) > 0);

  if (husbandryOptions.length) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`farm_barn_breed_select:${fieldIndex}`)
          .setPlaceholder("Breed animals...")
          .setDisabled(busy)
          .addOptions(
            husbandryOptions.map((item) => ({
              label: `${item.name} (${farming.getAnimalHusbandryQty(farm, item.id)})`,
              value: `farm_barn_breed:${fieldIndex}:${item.id}`,
              description: `${item.offspring} ${item.babyName} - matures in ${item.maturityHours}h`,
            }))
          )
      )
    );
  } else {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("farm_husbandry_none")
          .setLabel("No Husbandry Items")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId("farm_store_husbandry")
          .setLabel("Buy Husbandry")
          .setStyle(ButtonStyle.Primary)
          .setDisabled(busy)
      )
    );
  }

  if ((barn.level || 1) < config.MAX_FIELD_LEVEL) {
    const upgradeCost = farming.getBarnUpgradeCost(barn.level || 1);
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`farm_barn_upgrade:${fieldIndex}`)
          .setLabel(`Upgrade Barn ($${upgradeCost.toLocaleString()})`)
          .setStyle(ButtonStyle.Primary)
          .setDisabled(busy)
      )
    );
  }

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`farm_barn_demolish:${fieldIndex}`)
        .setLabel(`Demolish (${ui.money(farming.getBarnDemolitionCost(barn))})`)
        .setStyle(ButtonStyle.Danger)
        .setDisabled(busy)
    )
  );

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("farm_back")
        .setLabel(ui.nav.back.label)
        .setEmoji(ui.nav.back.emoji)
        .setStyle(ui.nav.back.style)
    )
  );

  return rows;
}

module.exports = {
  buildFarmMarketEmbed,
  buildFarmMarketComponents,
  buildFarmStoreHomeEmbed,
  buildFarmStoreHomeComponents,
  buildFarmStoreFertiliserEmbed,
  buildFarmStoreFertiliserComponents,
  buildFarmStoreHusbandryEmbed,
  buildFarmStoreHusbandryComponents,
  buildMachineShedHomeEmbed,
  buildMachineShedHomeComponents,
  buildMachineActionEmbed,
  buildMachineActionCategoryComponents,
  buildMachineActionCategoryEmbed,
  buildMachineActionSelectComponents,
  buildFarmingEmbed,
  buildFarmingComponents,
  buildFieldEmbed,
  buildFieldComponents,
  buildBarnComponents,
};
