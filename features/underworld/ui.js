const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require("discord.js");

const ui = require("../../utils/ui");
const engine = require("../../utils/underworld/engine");
const config = require("../../data/underworld/config");

function suspicionMeter(value) {
  const amount = Math.max(0, Math.min(config.MAX_SUSPICION, Math.round(Number(value || 0))));
  const filled = Math.round((amount / config.MAX_SUSPICION) * 8);
  return `${"■".repeat(filled)}${"□".repeat(Math.max(0, 8 - filled))} ${amount}/${config.MAX_SUSPICION}`;
}

function formatStatus(building) {
  const status = engine.getBuildingStatus(building);
  if (status === "converting") return `Converting, Completes <t:${Math.floor(Number(building.conversion.completeAt) / 1000)}:R>`;
  if (status === "event") return `Event live, Closes <t:${Math.floor(Number(building.activeRun.pendingEvent.deadlineAt) / 1000)}:R>`;
  if (status === "cooling_off") return `Goods cooling off, Sellable <t:${Math.floor(Number(building.activeRun?.storageGoods?.sellReadyAt || Date.now()) / 1000)}:R>`;
  if (status === "distribution") return "Awaiting distribution";
  if (status === "running") return `Running, Completes <t:${Math.floor(Number(building.activeRun.readyAt) / 1000)}:R>`;
  if (status === "ready") return "Ready to run";
  return "Empty shell";
}

function buildUnderworldHomeEmbed(state) {
  const summary = engine.getStateSummary(state);
  const averageSuspicion = summary.total ? Math.round(summary.suspicion / summary.total) : 0;

  return ui.applySystemStyle(
    new EmbedBuilder()
      .setTitle("🕶️ The Underworld")
      .setDescription(
        [
          "Quiet buildings. Loud money. Serious fallout if you get sloppy.",
          "",
          "Operations are persistent and keep moving while you are offline.",
          "Use this hub to buy warehouses, convert them, and manage live runs.",
        ].join("\n")
      )
      .addFields(
        {
          name: "Network",
          value: [
            `Buildings: **${summary.total}/${config.MAX_BUILDINGS}**`,
            `Running: **${summary.running}**`,
            `Live events: **${summary.events}**`,
            `Awaiting distribution: **${summary.distribution}**`,
          ].join("\n"),
          inline: true,
        },
        {
          name: "Pressure",
          value: [
            `Average suspicion: **${averageSuspicion}**`,
            `Converting: **${summary.converting}**`,
            `Risk profile: **High**`,
          ].join("\n"),
          inline: true,
        }
      ),
    "job",
    "Underworld runs are expensive, risky, and persistent."
  );
}

function buildUnderworldHomeComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("uw_operations")
        .setLabel("Operations")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("job_back:hub")
        .setLabel(ui.nav.back.label)
        .setEmoji(ui.nav.back.emoji)
        .setStyle(ui.nav.back.style)
    ),
  ];
}

function buildOperationsEmbed(state) {
  const lines = (state.buildings || []).length
    ? state.buildings.map((building, index) => {
        const def = engine.getBuildingDefinition(building.buildingId);
        const op = building.operationType ? engine.getOperationDefinition(building.operationType) : null;
        return [
          `**${index + 1}. ${def?.name || "Unknown Building"}**`,
          `Status: ${formatStatus(building)}`,
          `Setup: ${op?.name || "Empty"}`,
          `Suspicion: ${suspicionMeter(building.suspicion)}`,
        ].join("\n");
      }).join("\n\n")
    : "No buildings yet. Buy a warehouse to start your network.";

  return ui.applySystemStyle(
    new EmbedBuilder()
      .setTitle("🕶️ Underworld Operations")
      .setDescription(lines)
      .addFields({
        name: "Building Types",
        value: engine.buildings.map((entry) => `${entry.name} - ${ui.money(entry.purchaseCost)}`).join("\n"),
      }),
    "job",
    "Pick a building to inspect, or buy another shell."
  );
}

function buildOperationsComponents(state) {
  const rows = [];

  const buyOptions = engine.buildings.map((entry) => ({
    label: entry.name,
    value: `uw_buy_building:${entry.id}`,
    description: `$${entry.purchaseCost.toLocaleString()} - Capacity ${entry.capacity}`,
  }));

  rows.push(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("uw_buy_building_select")
        .setPlaceholder("Buy a warehouse...")
        .addOptions(buyOptions)
        .setDisabled((state.buildings || []).length >= config.MAX_BUILDINGS)
    )
  );

  if ((state.buildings || []).length) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("uw_building_select")
          .setPlaceholder("Inspect a building...")
          .addOptions(
            state.buildings.map((building, index) => {
              const def = engine.getBuildingDefinition(building.buildingId);
              return {
                label: `${index + 1}. ${def?.name || "Building"}`,
                value: `uw_select:${building.id}`,
                description: formatStatus(building).slice(0, 100),
              };
            })
          )
      )
    );
  }

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("uw_home")
        .setLabel(ui.nav.back.label)
        .setEmoji(ui.nav.back.emoji)
        .setStyle(ui.nav.back.style)
    )
  );

  return rows;
}

function buildEventChoiceLabel(choice) {
  const parts = [choice.label];
  if (choice.costFlat) parts.push(`$${Number(choice.costFlat).toLocaleString()}`);
  if (choice.suspicionDelta) parts.push(`${choice.suspicionDelta > 0 ? "+" : ""}${choice.suspicionDelta} suspicion`);
  return parts.join(" • ");
}

function buildBuildingEmbed(state, buildingId) {
  const { building, buildingIndex } = engine.resolveBuilding(state, buildingId);
  if (!building) {
    return ui.applySystemStyle(
      new EmbedBuilder()
        .setTitle("🕶️ Underworld Building")
        .setDescription("That building no longer exists."),
      "job"
    );
  }

  const def = engine.getBuildingDefinition(building.buildingId);
  const op = building.operationType ? engine.getOperationDefinition(building.operationType) : null;
  const run = building.activeRun;
  const pendingEvent = run?.pendingEvent ? engine.EVENTS[run.pendingEvent.eventId] : null;
  const storageStock = Number(building.storage?.stock || 0);

  const lines = [
    `**Building:** ${def?.name || "Unknown"}`,
    `**Capacity:** ${def?.capacity || 0}`,
    `**Status:** ${formatStatus(building)}`,
    `**Suspicion:** ${suspicionMeter(building.suspicion)}`,
    `**Operation:** ${op?.name || "Empty"}`,
    `**Setup invested:** ${ui.money(building.setupInvestment || 0)}`,
  ];

  if (building.conversion?.completeAt) {
    lines.push(`**Conversion completes:** <t:${Math.floor(Number(building.conversion.completeAt) / 1000)}:R>`);
    lines.push(`**At:** <t:${Math.floor(Number(building.conversion.completeAt) / 1000)}:F>`);
  }

  if (run?.status === "running") {
    lines.push(`**Batch cost:** ${ui.money(run.batchCost)}`);
    lines.push(`**Completes:** <t:${Math.floor(Number(run.readyAt) / 1000)}:R>`);
    lines.push(`**At:** <t:${Math.floor(Number(run.readyAt) / 1000)}:F>`);
  }

  if (run?.status === "awaiting_distribution") {
    lines.push(`**Distribution:** ${op?.storageEnabled ? "Cooled goods are ready for sale." : "Ready to push this batch to market."}`);
  }

  if (run?.status === "cooling_off") {
    lines.push(`**Cooling off:** Goods can be sold <t:${Math.floor(Number(run.storageGoods?.sellReadyAt || Date.now()) / 1000)}:R>`);
    lines.push("**Early sale risk:** Higher suspicion, lower payout, and possible stolen-goods report.");
  }

  if (storageStock > 0 || op?.storageEnabled) {
    const lockedUntil = Number(building.storage?.sellLockedUntil || 0);
    lines.push(`**Stored goods:** ${storageStock}`);
    if (Number(building.storage?.totalValue || 0) > 0) {
      lines.push(`**Estimated street value:** ${ui.money(building.storage.totalValue)}`);
    }
    if (Array.isArray(building.storage?.goods) && building.storage.goods.length) {
      lines.push(`**Goods:** ${building.storage.goods.map((item) => `${item.quantity}x ${item.name}`).join(", ")}`);
    }
    if (lockedUntil > Date.now()) {
      lines.push(`**Fence cooldown ends:** <t:${Math.floor(lockedUntil / 1000)}:R>`);
    }
  }

  const embed = ui.applySystemStyle(
    new EmbedBuilder()
      .setTitle(`🕶️ Building ${buildingIndex + 1}`)
      .setDescription(lines.join("\n")),
    "job",
    "High suspicion lowers liquidation returns and raises raid odds."
  );

  if (pendingEvent) {
    embed.addFields({
      name: `Live Event: ${pendingEvent.name}`,
      value: [
        pendingEvent.description,
        "",
        `Window closes <t:${Math.floor(Number(run.pendingEvent.deadlineAt) / 1000)}:R>.`,
        `At <t:${Math.floor(Number(run.pendingEvent.deadlineAt) / 1000)}:F>.`,
      ].join("\n"),
    });
  } else if (run?.eventLog?.length) {
    embed.addFields({
      name: "Recent Heat",
      value: run.eventLog.slice(-3).map((entry) => {
        const event = engine.EVENTS[entry.eventId];
        return `${event?.name || entry.eventId} - ${entry.resolution}`;
      }).join("\n"),
    });
  }

  embed.addFields({
    name: "Upgrades",
    value: [
      `Security ${building.upgrades?.security || 0}/3`,
      `Equipment ${building.upgrades?.equipment || 0}/3`,
      `Efficiency ${building.upgrades?.efficiency || 0}/3`,
    ].join("\n"),
    inline: true,
  });

  return embed;
}

function buildBuildingComponents(state, buildingId) {
  const { building, buildingIndex } = engine.resolveBuilding(state, buildingId);
  if (!building) return buildOperationsComponents(state);

  const rows = [];
  const run = building.activeRun;
  const pendingEvent = run?.pendingEvent ? engine.EVENTS[run.pendingEvent.eventId] : null;

  if (!building.operationType && !building.conversion) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`uw_convert_select:${building.id}`)
          .setPlaceholder("Convert this building...")
          .addOptions(
            engine.operations.map((entry) => ({
              label: entry.name,
              value: `uw_convert:${building.id}:${entry.id}`,
              description: `${ui.money(entry.conversionCost)} - ${entry.conversionHours}h setup`,
            }))
          )
      )
    );
  }

  if (pendingEvent) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`uw_event_select:${building.id}`)
          .setPlaceholder("Respond to the event...")
          .addOptions(
            pendingEvent.choices.map((choice) => ({
              label: choice.label,
              value: `uw_event:${building.id}:${choice.id}`,
              description: buildEventChoiceLabel(choice).slice(0, 100),
            }))
          )
      )
    );
  } else if (["awaiting_distribution", "cooling_off"].includes(run?.status) && (!engine.getOperationDefinition(building.operationType)?.storageEnabled || Number(run.storageGoods?.units || 0) > 0)) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`uw_distribution:${building.id}:safe`)
          .setLabel("Safe")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`uw_distribution:${building.id}:standard`)
          .setLabel("Standard")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`uw_distribution:${building.id}:aggressive`)
          .setLabel("Aggressive")
          .setStyle(ButtonStyle.Danger)
      )
    );
  } else if (building.operationType && !building.conversion) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`uw_start:${building.id}`)
          .setLabel("Start Operation")
          .setStyle(ButtonStyle.Primary)
          .setDisabled(Boolean(building.activeRun)),
        new ButtonBuilder()
          .setCustomId(`uw_dismantle:${building.id}`)
          .setLabel("Dismantle")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(Boolean(building.activeRun))
      )
    );
  }

  if (building.operationType || building.conversion) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`uw_emergency:${building.id}`)
          .setLabel("Emergency Dismantle")
          .setStyle(ButtonStyle.Danger)
      )
    );
  }

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("uw_operations")
        .setLabel(ui.nav.back.label)
        .setEmoji(ui.nav.back.emoji)
        .setStyle(ui.nav.back.style),
      new ButtonBuilder()
        .setCustomId("uw_refresh")
        .setLabel(ui.nav.refresh.label)
        .setEmoji(ui.nav.refresh.emoji)
        .setStyle(ui.nav.refresh.style)
    )
  );

  return rows;
}

module.exports = {
  buildUnderworldHomeEmbed,
  buildUnderworldHomeComponents,
  buildOperationsEmbed,
  buildOperationsComponents,
  buildBuildingEmbed,
  buildBuildingComponents,
};
