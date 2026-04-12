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

    return [
      `**${m.name}**`,
      `Tier ${m.tier} - Owned: ${owned} - Rented: ${rented} - Busy: ${busy}`,
      `Buy: $${m.buyPrice.toLocaleString()} - Rent: $${m.rentPrice.toLocaleString()} - Sell: $${machineEngine.getSellValue(m).toLocaleString()}`,
      `Speed Bonus: ${speedBonus}% - Tasks: ${tasks}`,
    ].join("\n");
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
            .setLabel(`Field ${index + 1}`)
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

function buildFarmingEmbed(farm) {
  const fields = farm.fields || [];
  const season = farming.getCurrentSeason();
  const nextCost = fields.length < config.MAX_FIELDS ? farming.getNextFieldCost(fields.length) : null;

  const counts = fields.reduce(
    (acc, field) => {
      const state = field?.state || "empty";
      if (state === "growing") acc.growing += 1;
      else if (state === "ready") acc.ready += 1;
      else if (state === "spoiled") acc.spoiled += 1;
      else if (!field?.cultivated) acc.cleanup += 1;
      else acc.empty += 1;
      if (farming.isFieldTaskActive(field)) acc.busy += 1;
      return acc;
    },
    { growing: 0, ready: 0, spoiled: 0, cleanup: 0, empty: 0, busy: 0 }
  );

  const fieldLines = fields.length
    ? fields.map((field, index) => {
        let status = "Empty";
        if (field.state === "growing") status = "Growing";
        if (field.state === "ready") status = "Ready";
        if (field.state === "spoiled") status = "Spoiled";
        if (field.state === "empty" && !field.cultivated) status = "Needs cleanup";
        if (farming.isFieldTaskActive(field)) {
          status = `${field.task.key} until <t:${Math.floor(Number(field.task.endsAt) / 1000)}:R>`;
        }
        const crop = field.cropId ? ` - ${field.cropId}` : "";
        const size = farming.getFieldSize(field.level || 1);
        return `**Field ${index + 1}** - Lv ${field.level || 1} (${size}x${size}) - ${status}${crop}`;
      }).join("\n")
    : "No fields yet. Buy your first field to start farming.";

  return ui.applySystemStyle(
    new EmbedBuilder()
      .setTitle("🌾 Farming")
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
          name: "Farm Status",
          value: [
            `Fields: **${fields.length}/${config.MAX_FIELDS}**`,
            `Ready: **${counts.ready}**`,
            `Growing: **${counts.growing}**`,
            `Busy: **${counts.busy}**`,
            `Needs cleanup: **${counts.cleanup + counts.spoiled}**`,
          ].join("\n"),
          inline: true,
        },
        {
          name: "Fields",
          value: fieldLines.slice(0, 1024),
          inline: false,
        }
      ),
    "job",
    "Open a field to cultivate, plant, harvest, or upgrade."
  );
}

function renderFieldVisual(field) {
  if (!field) return "";

  const level = Math.max(1, Number(field.level || 1));
  const size = farming.getFieldSize(level);
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

function buildFieldEmbed(farm, fieldIndex) {
  const field = (farm.fields || [])[fieldIndex];
  const visual = renderFieldVisual(field);

  if (!field) {
    return new EmbedBuilder()
      .setTitle("🌾 Field")
      .setDescription("That field does not exist.")
      .setColor(ui.colors.danger);
  }

  const allCrops = farming.getAvailableCrops(config.MAX_FIELD_LEVEL || 10);
  const cropMap = Object.fromEntries(allCrops.map((crop) => [crop.key, crop]));
  const crop = field.cropId ? cropMap[field.cropId] : null;
  const cropName = crop?.name || "None";

  let stateText = "Empty";
  if (field.state === "growing") stateText = "Growing";
  if (field.state === "ready") stateText = "Ready to Harvest";
  if (field.state === "spoiled") stateText = "Spoiled";
  if (field.state === "empty" && !field.cultivated) stateText = "Needs Cleanup";

  const task = field.task || null;
  const taskLine =
    task?.key && task?.endsAt && Date.now() < Number(task.endsAt)
      ? `🛠️ **Task:** ${task.key}\n⏳ **Done:** <t:${Math.floor(Number(task.endsAt) / 1000)}:R>\n🕒 **At:** <t:${Math.floor(Number(task.endsAt) / 1000)}:F>`
      : "";

  const readyLine =
    !task?.key && field.state === "growing" && field.readyAt
      ? `⏳ **Ready:** <t:${Math.floor(Number(field.readyAt) / 1000)}:R>\n🕒 **At:** <t:${Math.floor(Number(field.readyAt) / 1000)}:F>`
      : "";

  const cultivatedLine = field.cultivated ? "✅ Cultivated" : "❌ Needs Cultivation";
  const size = farming.getFieldSize(field.level || 1);
  const plots = farming.getFieldPlotCount(field.level || 1);
  const cropYield = crop ? farming.getYieldRangeForField(crop, field) : null;
  const taskTimes = {
    cultivate: farming.getTaskDurationMs("cultivate", field),
    seed: farming.getTaskDurationMs("seed", field),
    harvest: farming.getTaskDurationMs("harvest", field),
  };
  const formatDuration = (ms) => {
    const totalMinutes = Math.max(1, Math.round(ms / 60000));
    if (totalMinutes < 60) return `${totalMinutes}m`;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  };
  const machineHint =
    field.state === "ready"
      ? "Needs a free harvester."
      : field.state === "empty" && field.cultivated
        ? "Needs a tractor and seeder to plant."
        : field.state === "spoiled" || !field.cultivated
          ? "Needs a tractor and cultivator."
          : "Let it grow.";

  return new EmbedBuilder()
    .setTitle(`🌾 Field ${fieldIndex + 1}`)
    .setDescription(
      [
        "**Field Layout**",
        visual,
        "",
        `📈 **Level:** ${field.level || 1}`,
        `📐 **Size:** ${size}x${size} (${plots} plots)` ,
        `📌 **Status:** ${stateText}`,
        `🌿 **Crop:** ${cropName}`,
        cropYield ? `📦 **Yield Range:** ${cropYield.min}-${cropYield.max}` : null,
        `🪴 **Condition:** ${cultivatedLine}`,
        `🍂 **Season:** ${farming.getCurrentSeason()}`,
        `⏱️ **Task Times:** Cultivate ${formatDuration(taskTimes.cultivate)} • Seed ${formatDuration(taskTimes.seed)} • Harvest ${formatDuration(taskTimes.harvest)}`,
        `🚜 **Machine Need:** ${machineHint}`,
        taskLine,
        readyLine,
      ].filter(Boolean).join("\n")
    )
    .setColor(ui.systems.job.color)
    .setFooter({ text: "Fields can only run one task at a time." });
}

function buildFieldComponents(farm, fieldIndex) {
  const field = (farm.fields || [])[fieldIndex];
  const rows = [];

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

  const currentSeason = farming.getCurrentSeason();
  const cropOptions = farming
    .getAvailableCrops(field.level || 1)
    .filter((crop) => Array.isArray(crop.seasons) && crop.seasons.includes(currentSeason));

  if (field.state === "spoiled" || !field.cultivated) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`farm_cultivate:${fieldIndex}`)
          .setLabel("🧹 Cultivate")
          .setStyle(ButtonStyle.Secondary)
      )
    );
  }

  if (field.state === "empty" && field.cultivated && cropOptions.length > 0) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`farm_plant_select:${fieldIndex}`)
          .setPlaceholder("Choose a crop...")
          .addOptions(
            cropOptions.map((crop) => ({
              label: crop.name,
              value: `farm_plant:${fieldIndex}:${crop.key}`,
              description: `Level ${crop.level} - ${crop.growthHours}h growth`,
            }))
          )
      )
    );
  }

  if (field.state === "empty" && field.cultivated && cropOptions.length === 0) {
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

  if (field.state === "empty" && field.cultivated && (field.level || 1) < config.MAX_FIELD_LEVEL) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`farm_upgrade:${fieldIndex}`)
          .setLabel("⬆ Upgrade Field")
          .setStyle(ButtonStyle.Primary)
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

module.exports = {
  buildFarmMarketEmbed,
  buildFarmMarketComponents,
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
};
