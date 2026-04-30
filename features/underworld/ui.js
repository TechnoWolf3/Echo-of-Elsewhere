const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require("discord.js");

const ui = require("../../utils/ui");
const { renderProgressBar } = require("../../utils/progressBar");
const engine = require("../../utils/underworld/engine");
const smuggling = require("../../utils/underworld/smugglingEngine");
const config = require("../../data/underworld/config");
const products = require("../../data/underworld/products");

function suspicionMeter(value) {
  const amount = Math.max(0, Math.min(config.MAX_SUSPICION, Math.round(Number(value || 0))));
  return `${renderProgressBar(amount, config.MAX_SUSPICION, { length: 10 })} ${amount}/${config.MAX_SUSPICION}`;
}

function formatStatus(building) {
  const status = engine.getBuildingStatus(building);
  if (status === "converting") return `Converting, Completes <t:${Math.floor(Number(building.conversion.completeAt) / 1000)}:R>`;
  if (status === "event") return `Event live, Closes <t:${Math.floor(Number(building.activeRun.pendingEvent.deadlineAt) / 1000)}:R>`;
  if (status === "cooling_off") return `Goods cooling off, Sellable <t:${Math.floor(Number(building.activeRun?.storageGoods?.sellReadyAt || Date.now()) / 1000)}:R>`;
  if (status === "distribution") return "Awaiting distribution";
  if (status === "running") return `Running, Completes <t:${Math.floor(Number(building.activeRun.readyAt) / 1000)}:R>`;
  if (status === "ready" && Date.now() < Number(building.runCooldownUntil || 0)) return `Resetting, Next run <t:${Math.floor(Number(building.runCooldownUntil) / 1000)}:R>`;
  if (status === "ready") return "Ready to run";
  return "Empty shell";
}

function formatStoredGoods(goods = []) {
  if (!Array.isArray(goods) || !goods.length) return "";
  return goods
    .map((item) => `- ${Number(item.quantity || 0).toLocaleString()}x ${item.name || "Unknown goods"}`)
    .join("\n");
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
            `Average suspicion: ${suspicionMeter(averageSuspicion)}`,
            `Converting: **${summary.converting}**`,
            `Risk profile: **High**`,
          ].join("\n"),
          inline: true,
        }
      ),
    "underworld",
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
        .setCustomId("uw_smuggling")
        .setLabel("Smuggling")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId("job_back:hub")
        .setLabel(ui.nav.back.label)
        .setEmoji(ui.nav.back.emoji)
        .setStyle(ui.nav.back.style)
    ),
  ];
}

function buildSmugglingHomeEmbed(state, suspicionInfo = { suspicion: 0, band: { label: "Quiet" } }) {
  const smugglingState = smuggling.ensureSmugglingState(state);
  const inv = smugglingState.inventory || {};
  const activeRun = smuggling.getActiveRun(state);
  const inventoryLines = Object.entries(products)
    .map(([id, product]) => `${product.label}: **${Number(inv[id] || 0).toLocaleString()} ${product.unitLabel}**`)
    .join("\n");

  return ui.applySystemStyle(
    new EmbedBuilder()
      .setTitle("🚚 Underworld Smuggling")
      .setDescription("Cargo moves. Patrols notice. Buyers pay fast and leave faster.")
      .addFields(
        {
          name: "Pressure",
          value: [
            `Suspicion: ${suspicionMeter(suspicionInfo.suspicion || 0)}`,
            `Band: **${suspicionInfo.band?.label || "Quiet"}**`,
          ].join("\n"),
          inline: false,
        },
        {
          name: "Garage",
          value: [
            `Vehicles: **${smugglingState.vehicles.length.toLocaleString()}**`,
            `Active run: **${activeRun ? "Yes" : "No"}**`,
          ].join("\n"),
          inline: true,
        },
        {
          name: "Product Storage",
          value: inventoryLines || "No produced product stored yet. Purchased cargo is always available at worse margins.",
        }
      ),
    "underworld",
    "Smuggling uses shared Underworld suspicion."
  );
}

function buildSmugglingHomeComponents(state) {
  const hasVehicle = smuggling.ensureSmugglingState(state).vehicles.length > 0;
  const activeRun = smuggling.getActiveRun(state);
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("uw_smuggle_start")
        .setLabel("Start Run")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(Boolean(activeRun) || !hasVehicle),
      new ButtonBuilder()
        .setCustomId("uw_smuggle_garage")
        .setLabel("Vehicles")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("uw_smuggle_active")
        .setLabel("Active Run")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!activeRun)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("uw_home")
        .setLabel(ui.nav.back.label)
        .setEmoji(ui.nav.back.emoji)
        .setStyle(ui.nav.back.style),
      new ButtonBuilder()
        .setCustomId("uw_refresh")
        .setLabel(ui.nav.refresh.label)
        .setEmoji(ui.nav.refresh.emoji)
        .setStyle(ui.nav.refresh.style)
    ),
  ];
}

function buildVehicleGarageEmbed(state) {
  const vehicles = smuggling.ensureSmugglingState(state).vehicles;
  const lines = vehicles.length
    ? vehicles.map((vehicle, index) => {
        const def = smuggling.getVehicleDefinition(vehicle.vehicleType);
        return [
          `**${index + 1}. ${vehicle.nickname || def?.label || "Vehicle"}**`,
          `Class: ${def?.class || "unknown"} | Capacity: **${def?.capacity || 0}**`,
          `Speed: **${def?.speed || 1}x** | Stealth: **${def?.stealth || 1}x** | Heat: **${def?.heatProfile || 1}x**`,
          `Durability: **${Number(vehicle.durabilityCurrent || 0)}/${Number(vehicle.durabilityMax || 0)}** | Repairs: **${Number(vehicle.repairCount || 0)}**`,
          `Scrap estimate: **${ui.money(smuggling.getVehicleScrapValue(vehicle))}**`,
        ].join("\n");
      }).join("\n\n")
    : "No vehicles yet. Buy something with wheels and questionable paperwork.";

  return ui.applySystemStyle(
    new EmbedBuilder()
      .setTitle("🚚 Smuggling Garage")
      .setDescription(lines),
    "underworld",
    "Repairs restore current durability but reduce max durability."
  );
}

function buildVehicleGarageComponents(state) {
  const owned = smuggling.ensureSmugglingState(state).vehicles;
  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("uw_smuggle_shop").setLabel("Buy Vehicle").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("uw_smuggling").setLabel(ui.nav.back.label).setEmoji(ui.nav.back.emoji).setStyle(ui.nav.back.style)
    ),
  ];
  if (owned.length) {
    rows.unshift(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("uw_smuggle_vehicle_action")
          .setPlaceholder("Repair or scrap a vehicle...")
          .addOptions(
            owned.flatMap((vehicle, index) => {
              const def = smuggling.getVehicleDefinition(vehicle.vehicleType);
              const name = `${index + 1}. ${vehicle.nickname || def?.label || "Vehicle"}`;
              return [
                { label: `Repair ${name}`.slice(0, 100), value: `uw_smuggle_repair:${vehicle.id}`, description: `Cost ${ui.money(smuggling.getRepairCost(vehicle))}`.slice(0, 100) },
                { label: `Scrap ${name}`.slice(0, 100), value: `uw_smuggle_scrap:${vehicle.id}`, description: `Return ${ui.money(smuggling.getVehicleScrapValue(vehicle))}`.slice(0, 100) },
              ];
            }).slice(0, 25)
          )
      )
    );
  }
  return rows;
}

function buildVehicleShopEmbed() {
  return ui.applySystemStyle(
    new EmbedBuilder()
      .setTitle("🚚 Smuggling Vehicle Shop")
      .setDescription(
        [
          "Choose a class to browse vehicles.",
          "",
          "🏍️ **Bikes** - tiny cargo, fast routes, low attention.",
          "🚗 **Street Cars** - flexible daily-driver cover.",
          "🚐 **Vans** - balanced capacity and subtlety.",
          "🚛 **Trucks** - heavy cargo, heavy attention.",
          "🛻 **Utility** - practical cover for rougher routes.",
          "🧰 **Specialist** - expensive tricks and odd advantages.",
        ].join("\n")
      ),
    "underworld",
    "Vehicles are permanent until scrapped. Repairs reduce max durability."
  );
}

function buildVehicleShopComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("uw_smuggle_shop_class:bike").setLabel("🏍️ Bikes").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("uw_smuggle_shop_class:street car").setLabel("🚗 Street Cars").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("uw_smuggle_shop_class:van").setLabel("🚐 Vans").setStyle(ButtonStyle.Primary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("uw_smuggle_shop_class:truck").setLabel("🚛 Trucks").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("uw_smuggle_shop_class:utility").setLabel("🛻 Utility").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("uw_smuggle_shop_class:specialist").setLabel("🧰 Specialist").setStyle(ButtonStyle.Primary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("uw_smuggle_garage").setLabel(ui.nav.back.label).setEmoji(ui.nav.back.emoji).setStyle(ui.nav.back.style)
    ),
  ];
}

function vehicleClassList(vehicleClass) {
  return Object.values(smuggling.vehicles)
    .filter((vehicle) => vehicle.class === vehicleClass)
    .sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
}

function vehicleClassLabel(vehicleClass) {
  return {
    bike: "Bikes",
    "street car": "Street Cars",
    van: "Vans",
    truck: "Trucks",
    utility: "Utility Vehicles",
    specialist: "Specialist Vehicles",
  }[vehicleClass] || "Vehicles";
}

function formatVehicleStats(vehicle) {
  return [
    `Price: **${ui.money(vehicle.price)}**`,
    `Capacity: **${vehicle.capacity}**`,
    `Speed: **${vehicle.speed}x**`,
    `Stealth: **${vehicle.stealth}x**`,
    `Heat: **${vehicle.heatProfile}x**`,
  ].join(" | ");
}

function buildVehicleShopCategoryEmbed(vehicleClass) {
  const list = vehicleClassList(vehicleClass);
  const lines = list.map((vehicle) => [
    `**${vehicle.label}**`,
    formatVehicleStats(vehicle),
    vehicle.flavour,
  ].join("\n"));

  return ui.applySystemStyle(
    new EmbedBuilder()
      .setTitle(`🚚 Smuggling Vehicle Shop - ${vehicleClassLabel(vehicleClass)}`)
      .setDescription(lines.length ? lines.join("\n\n") : "No vehicles found in this class."),
    "underworld",
    "Pick one vehicle from the menu below."
  );
}

function buildVehicleShopCategoryComponents(vehicleClass) {
  const list = vehicleClassList(vehicleClass);
  const rows = [];
  if (list.length) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`uw_smuggle_shop_select:${vehicleClass}`)
          .setPlaceholder("Choose a vehicle to buy...")
          .addOptions(
            list.map((vehicle) => ({
              label: vehicle.label,
              value: `uw_smuggle_buy_vehicle:${vehicle.id}`,
              description: `${ui.money(vehicle.price)} | cap ${vehicle.capacity} | speed ${vehicle.speed}x | stealth ${vehicle.stealth}x`.slice(0, 100),
            }))
          )
      )
    );
  }
  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("uw_smuggle_shop").setLabel(ui.nav.back.label).setEmoji(ui.nav.back.emoji).setStyle(ui.nav.back.style)
    )
  );
  return rows;
}

function buildStartRunEmbed(state, flow = {}, suspicionInfo = { suspicion: 0 }) {
  const vehicle = flow.vehicleId ? smuggling.getOwnedVehicle(state, flow.vehicleId) : null;
  const estimate = flow.productId && flow.sourceType && vehicle && flow.cargoAmount
    ? smuggling.calculateRunEstimate({ productId: flow.productId, sourceType: flow.sourceType, cargoAmount: flow.cargoAmount, vehicle, suspicionScore: suspicionInfo.suspicion })
    : null;
  const product = flow.productId ? products[flow.productId] : null;
  const vehicleDef = vehicle ? smuggling.getVehicleDefinition(vehicle.vehicleType) : null;
  const lines = [
    `Product: **${product?.label || "Choose product"}**`,
    `Source: **${flow.sourceType || "Choose source"}**`,
    `Vehicle: **${vehicleDef?.label || "Choose vehicle"}**`,
    `Cargo: **${flow.cargoAmount || "Choose amount"}**`,
  ];
  if (estimate) {
    lines.push("");
    lines.push(`Estimated payout: **${ui.money(estimate.estimatedPayout)}**`);
    lines.push(`Upfront cost: **${ui.money(estimate.upfrontCost)}**`);
    lines.push(`Estimated profit: **${ui.money(estimate.estimatedProfit)}**`);
    lines.push(`Duration: **${estimate.durationMinutes} min** | Deliveries: **${estimate.deliveries}**`);
    lines.push(`Suspicion: **+${estimate.suspicionGain}** | Risk: **${estimate.riskBand}**`);
    lines.push("Busts can seize cargo, damage vehicles, and cause jail.");
  }
  return ui.applySystemStyle(
    new EmbedBuilder().setTitle("🚚 Plan Smuggling Run").setDescription(lines.join("\n")),
    "underworld",
    "Purchased cargo works without storage, but the margin is rough."
  );
}

function buildStartRunComponents(state, flow = {}) {
  const rows = [];
  if (!flow.productId) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId("uw_smuggle_product_select").setPlaceholder("Choose cargo...").addOptions(
        Object.values(products).map((product) => ({
          label: product.label,
          value: `uw_smuggle_product:${product.id}`,
          description: `${product.unitLabel} | produced $${product.producedSellValue}/unit | purchased $${product.purchasedSellValue}/unit`.slice(0, 100),
        }))
      )
    ));
  } else if (!flow.sourceType) {
    const qty = Number(smuggling.ensureSmugglingState(state).inventory[flow.productId] || 0);
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("uw_smuggle_source:produced").setLabel(`Produced (${qty})`).setStyle(ButtonStyle.Success).setDisabled(qty <= 0),
      new ButtonBuilder().setCustomId("uw_smuggle_source:purchased").setLabel("Purchased").setStyle(ButtonStyle.Danger)
    ));
  } else if (!flow.vehicleId) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId("uw_smuggle_run_vehicle_select").setPlaceholder("Choose vehicle...").addOptions(
        smuggling.ensureSmugglingState(state).vehicles.slice(0, 25).map((vehicle, index) => {
          const def = smuggling.getVehicleDefinition(vehicle.vehicleType);
          return {
            label: `${index + 1}. ${vehicle.nickname || def?.label || "Vehicle"}`.slice(0, 100),
            value: `uw_smuggle_run_vehicle:${vehicle.id}`,
            description: `Cap ${def?.capacity || 0} | Durability ${vehicle.durabilityCurrent}/${vehicle.durabilityMax}`.slice(0, 100),
          };
        })
      )
    ));
  } else if (!flow.cargoAmount) {
    const vehicle = smuggling.getOwnedVehicle(state, flow.vehicleId);
    const def = smuggling.getVehicleDefinition(vehicle?.vehicleType);
    const max = Number(def?.capacity || 1);
    const amounts = [...new Set([Math.min(5, max), Math.floor(max * 0.25), Math.floor(max * 0.5), Math.floor(max * 0.75), max].filter((n) => n > 0))];
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId("uw_smuggle_amount_select").setPlaceholder("Choose cargo amount...").addOptions(
        amounts.map((amount) => ({ label: `${amount} units`, value: `uw_smuggle_amount:${amount}`, description: `${Math.ceil(amount / Number(config.SMUGGLING.parcelSize || 25))} delivery parcel(s)` }))
      )
    ));
  } else {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("uw_smuggle_confirm").setLabel("Start Run").setStyle(ButtonStyle.Danger)
    ));
  }
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("uw_smuggle_start_reset").setLabel("Reset Plan").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("uw_smuggling").setLabel(ui.nav.back.label).setEmoji(ui.nav.back.emoji).setStyle(ui.nav.back.style)
  ));
  return rows;
}

function buildActiveRunEmbed(state, suspicionInfo = { suspicion: 0 }) {
  const run = smuggling.getActiveRun(state);
  if (!run) {
    return ui.applySystemStyle(new EmbedBuilder().setTitle("🚚 Active Smuggling Run").setDescription("No cargo is currently moving."), "underworld");
  }
  const product = products[run.productId];
  const vehicle = smuggling.getOwnedVehicle(state, run.vehicleId);
  const def = smuggling.getVehicleDefinition(vehicle?.vehicleType);
  const event = run.eventState?.eventId ? smuggling.events[run.eventState.eventId] : null;
  const lines = [
    `Cargo: **${Number(run.cargoRemaining || 0).toLocaleString()} ${product?.unitLabel || "units"} ${product?.label || ""}**`,
    `Vehicle: **${def?.label || "Unknown"}** (${Number(vehicle?.durabilityCurrent || 0)}/${Number(vehicle?.durabilityMax || 0)})`,
    `Deliveries: **${Number(run.deliveriesCompleted || 0)}/${Number(run.deliveriesTotal || 0)}**`,
    `Ends: **<t:${Math.floor(Number(run.endsAt || Date.now()) / 1000)}:R>**`,
    `Risk: **${Math.round(Number(run.risk?.current || 0) * 100)}%**`,
    `Suspicion: ${suspicionMeter(suspicionInfo.suspicion || 0)}`,
  ];
  if (event && run.status === "event") {
    lines.push("");
    lines.push(`**Route Event: ${event.label}**`);
    lines.push(event.description);
    lines.push(`Respond <t:${Math.floor(Number(run.eventState.deadlineAt || Date.now()) / 1000)}:R>, or ignore it for no major penalty.`);
  }
  return ui.applySystemStyle(new EmbedBuilder().setTitle("🚚 Active Smuggling Run").setDescription(lines.join("\n")), "underworld");
}

function buildActiveRunComponents(state) {
  const run = smuggling.getActiveRun(state);
  const rows = [];
  if (run?.status === "event") {
    const event = smuggling.events[run.eventState.eventId];
    rows.push(new ActionRowBuilder().addComponents(
      ...(event.options || []).slice(0, 5).map((option) =>
        new ButtonBuilder().setCustomId(`uw_smuggle_event:${option.id}`).setLabel(option.label).setStyle(ButtonStyle.Primary)
      )
    ));
  }
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("uw_smuggle_claim").setLabel("Claim/Finish").setStyle(ButtonStyle.Success).setDisabled(!run || run.status === "event" || Date.now() < Number(run.endsAt || 0)),
    new ButtonBuilder().setCustomId("uw_refresh").setLabel(ui.nav.refresh.label).setEmoji(ui.nav.refresh.emoji).setStyle(ui.nav.refresh.style),
    new ButtonBuilder().setCustomId("uw_smuggling").setLabel(ui.nav.back.label).setEmoji(ui.nav.back.emoji).setStyle(ui.nav.back.style)
  ));
  return rows;
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
    "underworld",
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
      "underworld"
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

  if (!run && Date.now() < Number(building.runCooldownUntil || 0)) {
    lines.push(`**Next run:** <t:${Math.floor(Number(building.runCooldownUntil) / 1000)}:R>`);
  }

  if (storageStock > 0 || op?.storageEnabled) {
    const lockedUntil = Number(building.storage?.sellLockedUntil || 0);
    lines.push("");
    lines.push("**Storage**");
    lines.push(`Stock: **${storageStock.toLocaleString()}/${Number(def?.capacity || 0).toLocaleString()}**`);
    if (Number(building.storage?.totalValue || 0) > 0) {
      lines.push(`Estimated street value: **${ui.money(building.storage.totalValue)}**`);
    }
    if (Array.isArray(building.storage?.goods) && building.storage.goods.length) {
      lines.push("");
      lines.push("**Goods**");
      lines.push(formatStoredGoods(building.storage.goods));
    }
    if (lockedUntil > Date.now()) {
      lines.push("");
      lines.push(`Fence cooldown: **<t:${Math.floor(lockedUntil / 1000)}:R>**`);
    }
  }

  const embed = ui.applySystemStyle(
    new EmbedBuilder()
      .setTitle(`🕶️ Building ${buildingIndex + 1}`)
      .setDescription(lines.join("\n")),
    "underworld",
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
  const op = engine.getOperationDefinition(building.operationType);
  const hasStoredGoods = Boolean(op?.storageEnabled && Number(building.storage?.stock || 0) > 0 && Number(building.storage?.totalValue || 0) > 0);
  const runCooldownActive = Date.now() < Number(building.runCooldownUntil || 0);

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
  } else if ((["awaiting_distribution", "cooling_off"].includes(run?.status) && (!op?.storageEnabled || Number(run.storageGoods?.units || 0) > 0)) || (!run && hasStoredGoods)) {
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
    if (run?.status === "awaiting_distribution" && ["meth_lab", "cocaine_lab"].includes(op?.id)) {
      rows.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`uw_store_smuggling:${building.id}`)
            .setLabel("Store For Smuggling")
            .setStyle(ButtonStyle.Secondary)
        )
      );
    }
    if (!run && op?.storageEnabled) {
      rows.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`uw_start:${building.id}`)
            .setLabel("Start Operation")
            .setStyle(ButtonStyle.Primary)
            .setDisabled(runCooldownActive || Number(building.storage?.stock || 0) >= Number(engine.getBuildingDefinition(building.buildingId)?.capacity || 0)),
          new ButtonBuilder()
            .setCustomId(`uw_dismantle:${building.id}`)
            .setLabel("Dismantle")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(hasStoredGoods)
        )
      );
    }
  } else if (building.operationType && !building.conversion) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`uw_start:${building.id}`)
          .setLabel("Start Operation")
          .setStyle(ButtonStyle.Primary)
          .setDisabled(Boolean(building.activeRun) || runCooldownActive || (op?.storageEnabled && Number(building.storage?.stock || 0) >= Number(engine.getBuildingDefinition(building.buildingId)?.capacity || 0))),
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
  buildSmugglingHomeEmbed,
  buildSmugglingHomeComponents,
  buildVehicleGarageEmbed,
  buildVehicleGarageComponents,
  buildVehicleShopEmbed,
  buildVehicleShopComponents,
  buildVehicleShopCategoryEmbed,
  buildVehicleShopCategoryComponents,
  buildStartRunEmbed,
  buildStartRunComponents,
  buildActiveRunEmbed,
  buildActiveRunComponents,
};
