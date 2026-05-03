const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  MessageFlags,
} = require("discord.js");

const { pool } = require("../utils/db");
const jail = require("../utils/jail");
const ui = require("../utils/ui");
const config = require("../data/jail/config");
const npcs = require("../data/jail/npcs");

const HUB_TTL_MS = 5 * 60_000;

function money(value) {
  return `$${Number(value || 0).toLocaleString("en-AU")}`;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function randInt(min, max) {
  return Math.floor(Number(min || 0) + Math.random() * (Number(max || 0) - Number(min || 0) + 1));
}

function unix(date) {
  return Math.floor(new Date(date).getTime() / 1000);
}

function remainingSeconds(session) {
  return Math.max(0, Math.ceil((session.jailedUntil.getTime() - Date.now()) / 1000));
}

async function getCooldown(guildId, userId, key) {
  const res = await pool.query(
    `SELECT next_claim_at FROM cooldowns WHERE guild_id=$1 AND user_id=$2 AND key=$3`,
    [String(guildId), String(userId), key]
  );
  const date = res.rows?.[0]?.next_claim_at ? new Date(res.rows[0].next_claim_at) : null;
  if (!date || Number.isNaN(date.getTime()) || date <= new Date()) return null;
  return date;
}

async function setCooldown(guildId, userId, key, seconds) {
  const next = new Date(Date.now() + Math.max(0, Number(seconds || 0)) * 1000);
  await pool.query(
    `INSERT INTO cooldowns (guild_id, user_id, key, next_claim_at)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (guild_id, user_id, key)
     DO UPDATE SET next_claim_at=EXCLUDED.next_claim_at`,
    [String(guildId), String(userId), key, next]
  );
  return next;
}

function activeEffectsLine(session) {
  const effects = Object.keys(session.effects || {});
  const items = Object.entries(session.items || {})
    .filter(([, qty]) => Number(qty) > 0)
    .map(([id, qty]) => `${config.shop.items[id]?.name || id} x${qty}`);
  const lines = [];
  if (effects.length) lines.push(`Effects: ${effects.map((id) => config.effects.blessings[id]?.name || config.effects.curses[id]?.name || id).join(", ")}`);
  if (items.length) lines.push(`Contraband: ${items.join(", ")}`);
  return lines.length ? lines.join("\n") : "None active";
}

function buildHubEmbed(user, session) {
  const bail = jail.getBailCost(session);
  return ui.applySystemStyle(
    new EmbedBuilder()
      .setTitle("Jail")
      .setDescription([
        `**${user.username}**, you are locked up in Echo's finest concrete timeout box.`,
        "Pick an action below. Prison Money is separate from your wallet.",
      ].join("\n"))
      .addFields(
        { name: "Sentence", value: `**${jail.formatDuration(remainingSeconds(session))}** left\n<t:${unix(session.jailedUntil)}:R>`, inline: true },
        { name: "Prison Money", value: `**${money(session.prisonMoney)}**`, inline: true },
        { name: "Bail", value: `**${money(bail)}**\nWallet only`, inline: true },
        { name: "Reduction Cap", value: `**${jail.formatDuration(session.maxReducibleRemaining)}** left\n${jail.formatDuration(session.sentenceReducedSeconds)} used`, inline: true },
        { name: "Work Done", value: `**${session.workCount}** task${session.workCount === 1 ? "" : "s"}`, inline: true },
        { name: "Items / Effects", value: activeEffectsLine(session).slice(0, 1024), inline: true }
      ),
    "job",
    "Bail is fixed from the original sentence. Waiting does not discount it."
  );
}

function hubRows(disabled = false) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("jail:bail").setLabel("Pay Bail").setStyle(ButtonStyle.Danger).setDisabled(disabled),
      new ButtonBuilder().setCustomId("jail:work").setLabel("Work Detail").setStyle(ButtonStyle.Primary).setDisabled(disabled),
      new ButtonBuilder().setCustomId("jail:shop").setLabel("Contraband Shop").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
      new ButtonBuilder().setCustomId("jail:escape").setLabel("Attempt Escape").setStyle(ButtonStyle.Danger).setDisabled(disabled),
      new ButtonBuilder().setCustomId("jail:gamble").setLabel("Card Table").setStyle(ButtonStyle.Success).setDisabled(disabled)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("jail:info").setLabel("Sentence Info").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
      new ButtonBuilder().setCustomId("jail:refresh").setLabel("Refresh").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
      new ButtonBuilder().setCustomId("jail:close").setLabel("Close").setStyle(ButtonStyle.Secondary).setDisabled(disabled)
    ),
  ];
}

function backRows(disabled = false) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("jail:home").setLabel("Back").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
      new ButtonBuilder().setCustomId("jail:refresh").setLabel("Refresh").setStyle(ButtonStyle.Secondary).setDisabled(disabled)
    ),
  ];
}

function workEmbed(session) {
  return ui.applySystemStyle(
    new EmbedBuilder()
      .setTitle("Jail Work Detail")
      .setDescription([
        "Choose one prison job from the menu.",
        "Good work earns Prison Money and can trim a little sentence time.",
      ].join("\n"))
      .addFields(
        { name: "Typical Pay", value: `${money(config.work.payoutRange[0])}-${money(config.work.payoutRange[1])} PM`, inline: true },
        { name: "Time Trim", value: "30-90s on success", inline: true },
        { name: "Cap Left", value: jail.formatDuration(session.maxReducibleRemaining), inline: true },
        {
          name: "Available Details",
          value: Object.values(config.work.tasks)
            .map((task) => `**${task.name}**`)
            .join("  |  "),
          inline: false,
        }
      ),
    "job",
    "Repeated work has diminishing returns."
  );
}

function workRows(disabled = false) {
  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("jail:work_select")
        .setPlaceholder("Choose a work detail")
        .setDisabled(disabled)
        .addOptions(Object.entries(config.work.tasks).map(([id, task]) => ({
          label: task.name,
          value: id,
          description: task.description.slice(0, 100),
        })))
    ),
    ...backRows(disabled),
  ];
}

const SHOP_CATEGORIES = [
  {
    id: "basics",
    label: "Basics",
    button: "Basics",
    description: "Cheap utility and small favours.",
    items: ["energy_drink", "guard_snack"],
  },
  {
    id: "paperwork",
    label: "Paperwork",
    button: "Paperwork",
    description: "Sentence-reduction contraband.",
    items: ["broken_laptop", "fake_id_band", "burner_phone"],
  },
  {
    id: "unlocks",
    label: "Unlocks",
    button: "Unlocks",
    description: "Session unlocks for jail activities.",
    items: ["contraband_radio", "deck_of_cards"],
  },
  {
    id: "escape",
    label: "Escape Gear",
    button: "Escape Gear",
    description: "High-risk escape support.",
    items: ["escape_kit", "loose_vent_cover"],
  },
  {
    id: "future",
    label: "Future Trouble",
    button: "Future",
    description: "Tracked for later prison systems.",
    items: ["shank"],
  },
];

function shopCategoryById(categoryId) {
  return SHOP_CATEGORIES.find((cat) => cat.id === categoryId) || SHOP_CATEGORIES[0];
}

function shopItemLine(item) {
  if (!item) return null;
  const tag = item.type === "escape"
    ? "Escape"
    : item.type === "unlock"
      ? "Unlock"
      : item.type === "effect"
        ? "Boost"
        : "Use";
  return [
    `**${item.name}** - ${money(item.price)} PM`,
    `${tag} - ${item.description}`,
  ].join("\n");
}

function shopHomeEmbed(session) {
  const categoryLines = SHOP_CATEGORIES.map((cat) => `**${cat.label}** - ${cat.description}`);
  return ui.applySystemStyle(
    new EmbedBuilder()
      .setTitle("Contraband Shop")
      .setDescription(
        [
          "Buy prison-only contraband with Prison Money.",
          "",
          ...categoryLines,
        ].join("\n")
      )
      .addFields(
        { name: "Balance", value: `**${money(session.prisonMoney)} PM**`, inline: true },
        { name: "Rule", value: "Wallet and bank cash cannot be used.", inline: true }
      ),
    "job",
    "Choose a category to browse stock."
  );
}

function shopHomeRows(disabled = false) {
  return [
    new ActionRowBuilder().addComponents(
      SHOP_CATEGORIES.slice(0, 5).map((cat) =>
        new ButtonBuilder()
          .setCustomId(`jail:shop_cat:${cat.id}`)
          .setLabel(cat.button)
          .setStyle(ButtonStyle.Primary)
          .setDisabled(disabled)
      )
    ),
    ...backRows(disabled),
  ];
}

function shopCategoryEmbed(session, categoryId) {
  const category = shopCategoryById(categoryId);
  const stockLines = category.items
    .map((itemId) => shopItemLine(config.shop.items[itemId]))
    .filter(Boolean);

  return ui.applySystemStyle(
    new EmbedBuilder()
      .setTitle(`Contraband Shop - ${category.label}`)
      .setDescription(category.description)
      .addFields(
        { name: "Balance", value: `**${money(session.prisonMoney)} PM**`, inline: true },
        { name: "Stock", value: stockLines.join("\n\n") || "No stock in this category.", inline: false }
      ),
    "job",
    "Choose an item below to buy."
  );
}

function shopCategoryRows(categoryId, disabled = false) {
  const category = shopCategoryById(categoryId);
  const options = category.items
    .map((itemId) => {
      const item = config.shop.items[itemId];
      if (!item) return null;
      return {
        label: item.name,
        value: itemId,
        description: `${money(item.price)} PM - ${item.description}`.slice(0, 100),
      };
    })
    .filter(Boolean);

  const rows = [];
  if (options.length) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("jail:shop_select")
          .setPlaceholder(`Buy from ${category.label}...`)
          .setDisabled(disabled)
          .addOptions(options)
      )
    );
  }

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("jail:shop")
        .setLabel(ui.nav.back.label)
        .setEmoji(ui.nav.back.emoji)
        .setStyle(ui.nav.back.style)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId("jail:home")
        .setLabel("Jail Hub")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled)
    )
  );
  return rows;
}

function shopEmbed(session) {
  return shopHomeEmbed(session);
}

function shopRows(disabled = false) {
  return shopHomeRows(disabled);
}

function escapeEmbed(session) {
  const chanceHint = session.items.loose_vent_cover ? "Loose Vent Cover ready" : session.items.escape_kit ? "Escape Kit ready" : "No escape item ready";
  return ui.applySystemStyle(
    new EmbedBuilder()
      .setTitle("Attempt Escape")
      .setDescription("High risk, high reward. Success releases you. Failure adds time, heat, and a wallet fine.")
      .addFields(
        { name: "Quiet", value: "Safer failure\nLower chance", inline: true },
        { name: "Quick", value: "Standard risk\nBaseline chance", inline: true },
        { name: "Reckless", value: "Better chance\nHarsher failure", inline: true },
        { name: "Gear", value: chanceHint, inline: true },
        { name: "Attempts", value: `${session.escapeAttempts}`, inline: true },
        { name: "Warning", value: "Escape items are consumed when used.", inline: true }
      ),
    "job",
    "Escape failure is intentionally harsh."
  );
}

function escapeRows(disabled = false) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("jail:escape_route:quiet").setLabel("Quiet").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
      new ButtonBuilder().setCustomId("jail:escape_route:quick").setLabel("Quick").setStyle(ButtonStyle.Primary).setDisabled(disabled),
      new ButtonBuilder().setCustomId("jail:escape_route:reckless").setLabel("Reckless").setStyle(ButtonStyle.Danger).setDisabled(disabled)
    ),
    ...backRows(disabled),
  ];
}

function hasCardTableAccess(session, otherJailedCount = 0) {
  return Boolean(session.items.deck_of_cards) || Number(otherJailedCount || 0) > 0;
}

function cardAccessText(session, otherJailedCount = 0) {
  if (session.items.deck_of_cards) return "Deck owned";
  if (Number(otherJailedCount || 0) > 0) return `${otherJailedCount} other inmate${Number(otherJailedCount) === 1 ? "" : "s"} jailed`;
  return "Requires Deck of Cards or another jailed player";
}

function gamblingEmbed(session, selectedNpc = npcs[0], otherJailedCount = 0) {
  const hasAccess = hasCardTableAccess(session, otherJailedCount);
  return ui.applySystemStyle(
    new EmbedBuilder()
      .setTitle("Prison Card Table")
      .setDescription(
        hasAccess
          ? [
              selectedNpc ? `**${selectedNpc.name}**: "${selectedNpc.flavor}"` : "Pick a prisoner.",
              selectedNpc ? selectedNpc.personality : "",
              "",
              "Current game: high card. Highest roll wins. Ties push.",
            ].filter(Boolean).join("\n")
          : [
              "The card table is locked down.",
              "Buy a **Deck of Cards** from contraband, or wait until another player is jailed.",
            ].join("\n")
      )
      .addFields(
        { name: "Your Prison Money", value: money(session.prisonMoney), inline: true },
        { name: "Opponent", value: selectedNpc?.name || "None", inline: true },
        { name: "Access", value: cardAccessText(session, otherJailedCount), inline: true }
      ),
    "job",
    "NPC gambling is for risk and time, not reliable profit."
  );
}

function gamblingRows(selectedNpcId, disabled = false, hasAccess = true) {
  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("jail:npc_select")
        .setPlaceholder("Choose an NPC prisoner")
        .setDisabled(disabled || !hasAccess)
        .addOptions(npcs.map((npc) => ({
          label: npc.name,
          value: npc.id,
          description: npc.personality.slice(0, 100),
          default: npc.id === selectedNpcId,
        })))
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("jail:bet:50").setLabel("Bet $50").setStyle(ButtonStyle.Secondary).setDisabled(disabled || !hasAccess),
      new ButtonBuilder().setCustomId("jail:bet:100").setLabel("Bet $100").setStyle(ButtonStyle.Primary).setDisabled(disabled || !hasAccess),
      new ButtonBuilder().setCustomId("jail:bet:250").setLabel("Bet $250").setStyle(ButtonStyle.Success).setDisabled(disabled || !hasAccess),
      new ButtonBuilder().setCustomId("jail:bet:500").setLabel("Bet $500").setStyle(ButtonStyle.Danger).setDisabled(disabled || !hasAccess)
    ),
    ...backRows(disabled),
  ];
}

function buildKitchenRun() {
  const foods = ["beans", "toast", "eggs", "soup", "rice", "pie"];
  const order = shuffle(foods).slice(0, 3);
  const options = shuffle([
    order,
    shuffle(order),
    [order[1], order[0], order[2]],
    shuffle(foods).slice(0, 3),
  ].map((parts, idx) => ({ id: idx === 0 ? "correct" : `wrong_${idx}`, label: parts.join(" > ") })));
  return {
    embed: new EmbedBuilder().setTitle("Kitchen Duty").setDescription(`Tray order called out:\n\n**${order.join(" > ")}**\n\nPick the matching order before the cook vaporises your confidence.`),
    options,
    successId: "correct",
  };
}

function buildLaundryRun() {
  const rules = [
    { prompt: "Orange uniforms before grey towels, marked uniforms last.", correct: "Orange > Grey > Marked" },
    { prompt: "Towels first, uniforms second, anything marked goes last.", correct: "Towels > Uniforms > Marked" },
    { prompt: "Grey towels before orange uniforms, damaged linen last.", correct: "Grey > Orange > Damaged" },
  ];
  const rule = pick(rules);
  const wrong = ["Marked > Orange > Grey", "Uniforms > Damaged > Towels", "Orange > Marked > Grey", "Damaged > Grey > Orange"];
  const options = shuffle([{ id: "correct", label: rule.correct }, ...shuffle(wrong).slice(0, 3).map((label, i) => ({ id: `wrong_${i}`, label }))]);
  return {
    embed: new EmbedBuilder().setTitle("Laundry Sorting").setDescription(`Rule from the bored guard:\n\n**${rule.prompt}**\n\nChoose the correct sorting order.`),
    options,
    successId: "correct",
  };
}

function buildCellsRun() {
  const bad = pick(["A1", "B2", "C3", "D4"]);
  const tiles = ["A1", "B2", "C3", "D4"];
  return {
    embed: new EmbedBuilder().setTitle("Cleaning Cells").setDescription("Pick a section to clean. One has a surprise inspection hazard. Naturally, nobody tells you which one."),
    options: tiles.map((tile) => ({ id: tile === bad ? "bad" : `safe_${tile}`, label: tile })),
    successId: null,
    isSuccess: (id) => id !== "bad",
  };
}

function buildSupplyRun() {
  return {
    embed: new EmbedBuilder().setTitle("Supply Run").setDescription("Choose your route through the block."),
    options: [
      { id: "long", label: "Long route", successChance: 0.9, payoutMultiplier: 0.85, reductionMultiplier: 0.85 },
      { id: "maintenance", label: "Maintenance corridor", successChance: 0.7, payoutMultiplier: 1.1, reductionMultiplier: 1.05 },
      { id: "short", label: "Short route", successChance: 0.55, payoutMultiplier: 1.25, reductionMultiplier: 1.2 },
    ],
    routeBased: true,
  };
}

function buildWorkshopRun() {
  const correct = "Bolt > Sand > Paint > Inspect";
  const options = shuffle([
    { id: "correct", label: correct },
    { id: "wrong_1", label: "Sand > Bolt > Paint > Inspect" },
    { id: "wrong_2", label: "Paint > Sand > Bolt > Inspect" },
    { id: "wrong_3", label: "Bolt > Paint > Inspect > Sand" },
  ]);
  return {
    embed: new EmbedBuilder().setTitle("Workshop Duty").setDescription("The steps are scribbled on a board. Build it in the correct order:\n\n**Bolt > Sand > Paint > Inspect**"),
    options,
    successId: "correct",
  };
}

function buildYardRun() {
  return {
    embed: new EmbedBuilder().setTitle("Yard Work").setDescription("Choose your effort level."),
    options: [
      { id: "easy", label: "Take it easy", successChance: 0.95, payoutMultiplier: 0.65, reductionMultiplier: 0.65 },
      { id: "hard", label: "Work hard", successChance: 0.78, payoutMultiplier: 1.0, reductionMultiplier: 1.0 },
      { id: "showoff", label: "Show off", successChance: 0.52, payoutMultiplier: 1.35, reductionMultiplier: 1.25 },
    ],
    routeBased: true,
  };
}

function buildWorkRun(taskId) {
  const builders = {
    kitchen: buildKitchenRun,
    laundry: buildLaundryRun,
    cells: buildCellsRun,
    supply: buildSupplyRun,
    workshop: buildWorkshopRun,
    yard: buildYardRun,
  };
  const run = (builders[taskId] || buildKitchenRun)();
  run.embed.setColor(ui.colors.job).setFooter({ text: "Work success can pay Prison Money and reduce sentence time." });
  return run;
}

function workRunRows(taskId, run, disabled = false) {
  return [
    new ActionRowBuilder().addComponents(
      run.options.slice(0, 5).map((opt) =>
        new ButtonBuilder()
          .setCustomId(`jail:work_choice:${taskId}:${opt.id}`)
          .setLabel(opt.label.slice(0, 80))
          .setStyle(ButtonStyle.Primary)
          .setDisabled(disabled)
      )
    ),
    ...backRows(disabled),
  ];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("jail")
    .setDescription("Open your jail hub if you are currently locked up."),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: "Server only.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    await jail.ensureJailSchema();
    let current = await jail.fetchJailSession(interaction.guildId, interaction.user.id);
    if (!current) {
      return interaction.reply({ content: "You are not currently jailed.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    await interaction.reply({
      embeds: [buildHubEmbed(interaction.user, current)],
      components: hubRows(false),
    });

    const message = await interaction.fetchReply();
    const state = {
      view: "hub",
      workRun: null,
      selectedNpcId: npcs[0].id,
    };

    const collector = message.createMessageComponentCollector({ idle: HUB_TTL_MS });
    let panelRemoved = false;

    async function removePanel(reason = "closed") {
      if (panelRemoved) return;
      panelRemoved = true;
      try {
        await message.delete();
        return;
      } catch {}

      try {
        await interaction.editReply({
          content: reason === "idle" ? "Jail panel closed due to inactivity." : "Jail panel closed.",
          embeds: [],
          components: [],
        });
      } catch {}
    }

    async function refresh() {
      current = await jail.fetchJailSession(interaction.guildId, interaction.user.id);
      return current;
    }

    async function showHub(i, note = null) {
      const session = await refresh();
      if (!session) {
        collector.stop("released");
        return i.editReply({ content: note || "You are no longer jailed.", embeds: [], components: [] }).catch(() => {});
      }
      state.view = "hub";
      return i.editReply({
        content: note,
        embeds: [buildHubEmbed(interaction.user, session)],
        components: hubRows(false),
      }).catch(() => {});
    }

    async function showResult(i, title, lines, components = backRows(false)) {
      const embed = ui.applySystemStyle(
        new EmbedBuilder().setTitle(title).setDescription(lines.filter(Boolean).join("\n")),
        "job"
      );
      return i.editReply({ embeds: [embed], components }).catch(() => {});
    }

    collector.on("collect", async (i) => {
      try {
        if (i.user.id !== interaction.user.id) {
          return i.reply({ content: "This jail file is not yours.", flags: MessageFlags.Ephemeral }).catch(() => {});
        }
        await i.deferUpdate().catch(() => {});

        const id = i.isStringSelectMenu?.() ? i.customId : String(i.customId || "");
        const action = i.isStringSelectMenu?.() ? i.customId : id;
        const session = await refresh();
        if (!session) {
          collector.stop("released");
          return i.editReply({ content: "You are no longer jailed.", embeds: [], components: [] }).catch(() => {});
        }

        if (action === "jail:close") {
          collector.stop("closed");
          return removePanel("closed");
        }

        if (action === "jail:home" || action === "jail:refresh") return showHub(i);

        if (action === "jail:info") {
          return showResult(i, "Sentence Info", [
            `Original sentence: **${jail.formatDuration(session.originalSentenceSeconds)}**`,
            `Remaining: **${jail.formatDuration(remainingSeconds(session))}**`,
            `Work/item reduction cap: **${jail.formatDuration(session.reductionCapSeconds)}**`,
            `Cap remaining: **${jail.formatDuration(session.maxReducibleRemaining)}**`,
            `Prison Money converts to wallet cash only when you are released.`,
          ]);
        }

        if (action === "jail:bail") {
          const result = await jail.payBail(interaction.guildId, interaction.user.id);
          if (result.ok) {
            collector.stop("bail");
            return i.editReply({
              content: `Bail paid: **${money(result.cost)}**. You are released.${result.released?.message ? `\n${result.released.message}` : ""}`,
              embeds: [],
              components: [],
            }).catch(() => {});
          }
          if (result.reason === "insufficient_wallet") {
            return showHub(i, `You need **${money(result.cost)} wallet cash** for bail. Bank and Prison Money do not count.`);
          }
          return showHub(i, "You are not currently jailed.");
        }

        if (action === "jail:work") {
          state.view = "work";
          return i.editReply({ embeds: [workEmbed(session)], components: workRows(false) }).catch(() => {});
        }

        if (action === "jail:shop") {
          state.view = "shop";
          state.shopCategory = null;
          return i.editReply({ embeds: [shopHomeEmbed(session)], components: shopHomeRows(false) }).catch(() => {});
        }

        if (id.startsWith("jail:shop_cat:")) {
          const categoryId = id.split(":")[2];
          state.view = "shop_category";
          state.shopCategory = categoryId;
          return i.editReply({
            embeds: [shopCategoryEmbed(session, categoryId)],
            components: shopCategoryRows(categoryId, false),
          }).catch(() => {});
        }

        if (action === "jail:escape") {
          state.view = "escape";
          return i.editReply({ embeds: [escapeEmbed(session)], components: escapeRows(false) }).catch(() => {});
        }

        if (action === "jail:gamble") {
          state.view = "gamble";
          const npc = npcs.find((entry) => entry.id === state.selectedNpcId) || npcs[0];
          const otherJailed = await jail.countOtherJailedPlayers(interaction.guildId, interaction.user.id);
          const canUseTable = hasCardTableAccess(session, otherJailed);
          return i.editReply({
            embeds: [gamblingEmbed(session, npc, otherJailed)],
            components: gamblingRows(npc.id, false, canUseTable),
          }).catch(() => {});
        }

        if (action === "jail:work_select") {
          const cd = await getCooldown(interaction.guildId, interaction.user.id, "jail:work");
          if (cd) return showHub(i, `Work detail cooldown ends <t:${unix(cd)}:R>.`);
          const taskId = String(i.values?.[0] || "kitchen");
          state.workRun = buildWorkRun(taskId);
          return i.editReply({
            embeds: [state.workRun.embed],
            components: workRunRows(taskId, state.workRun, false),
          }).catch(() => {});
        }

        if (action === "jail:shop_select") {
          const itemId = String(i.values?.[0] || "");
          const result = await jail.buyContraband(interaction.guildId, interaction.user.id, itemId);
          const categoryId = state.shopCategory || SHOP_CATEGORIES.find((cat) => cat.items.includes(itemId))?.id || "basics";
          if (!result.ok) {
            if (result.reason === "insufficient_prison_money") {
              return i.editReply({
                content: `Not enough Prison Money for **${result.item.name}**.`,
                embeds: [shopCategoryEmbed(session, categoryId)],
                components: shopCategoryRows(categoryId, false),
              }).catch(() => {});
            }
            return i.editReply({
              content: "That contraband could not be bought.",
              embeds: [shopCategoryEmbed(session, categoryId)],
              components: shopCategoryRows(categoryId, false),
            }).catch(() => {});
          }
          const next = await refresh();
          return i.editReply({
            embeds: [shopCategoryEmbed(next, categoryId)],
            components: shopCategoryRows(categoryId, false),
            content: result.message,
          }).catch(() => {});
        }

        if (action === "jail:npc_select") {
          state.selectedNpcId = String(i.values?.[0] || npcs[0].id);
          const npc = npcs.find((entry) => entry.id === state.selectedNpcId) || npcs[0];
          const otherJailed = await jail.countOtherJailedPlayers(interaction.guildId, interaction.user.id);
          const canUseTable = hasCardTableAccess(session, otherJailed);
          return i.editReply({
            embeds: [gamblingEmbed(session, npc, otherJailed)],
            components: gamblingRows(npc.id, false, canUseTable),
          }).catch(() => {});
        }

        if (id.startsWith("jail:bet:")) {
          const bet = Number(id.split(":")[2] || 50);
          const npc = npcs.find((entry) => entry.id === state.selectedNpcId) || npcs[0];
          const otherJailed = await jail.countOtherJailedPlayers(interaction.guildId, interaction.user.id);
          const canUseTable = hasCardTableAccess(session, otherJailed);
          const result = await jail.gambleNpc(interaction.guildId, interaction.user.id, npc, "high_card", bet, {
            allowSharedDeck: canUseTable && !session.items.deck_of_cards,
          });
          if (!result.ok) {
            const msg = result.reason === "needs_deck_or_inmates"
              ? "You need a Deck of Cards from contraband, or at least one other player must be jailed."
              : "Not enough Prison Money for that bet.";
            const npc = npcs.find((entry) => entry.id === state.selectedNpcId) || npcs[0];
            return i.editReply({
              content: msg,
              embeds: [gamblingEmbed(session, npc, otherJailed)],
              components: gamblingRows(npc.id, false, hasCardTableAccess(session, otherJailed)),
            }).catch(() => {});
          }
          const outcome = result.tied ? "Push" : result.won ? "You won" : "You lost";
          const next = result.session || await refresh();
          const nextOtherJailed = await jail.countOtherJailedPlayers(interaction.guildId, interaction.user.id);
          const nextAccess = hasCardTableAccess(next, nextOtherJailed);
          return i.editReply({
            content: `${npc.name}: "${npc.flavor}"\n${outcome}. You rolled **${result.playerRoll}**, ${npc.name} rolled **${result.npcRoll}**. Net: **${money(result.delta)}** PM.`,
            embeds: [gamblingEmbed(next, npc, nextOtherJailed)],
            components: gamblingRows(npc.id, false, nextAccess),
          }).catch(() => {});
        }

        if (id.startsWith("jail:escape_route:")) {
          const cd = await getCooldown(interaction.guildId, interaction.user.id, "jail:escape");
          if (cd) return showHub(i, `Escape attempt cooldown ends <t:${unix(cd)}:R>.`);
          const route = id.split(":")[2];
          const result = await jail.attemptEscape(interaction.guildId, interaction.user.id, { route });
          await setCooldown(interaction.guildId, interaction.user.id, "jail:escape", config.escape.cooldownSeconds);
          if (result.success) {
            collector.stop("escape");
            return i.editReply({
              content: [
                `Escape succeeded via **${result.route}**. Chance was about **${Math.round(result.chance * 100)}%**.`,
                result.consumed?.length ? `Consumed: ${result.consumed.join(", ")}` : null,
                result.released?.message,
              ].filter(Boolean).join("\n"),
              embeds: [],
              components: [],
            }).catch(() => {});
          }
          return showResult(i, "Escape Failed", [
            `Route: **${result.route}**`,
            `Chance was about **${Math.round(result.chance * 100)}%**.`,
            result.consumed?.length ? `Consumed: ${result.consumed.join(", ")}` : null,
            `Sentence increased by **${result.extraMinutes} minutes**.`,
            `Fine: **${money(result.fine)}** (paid **${money(result.finePaid)}** from wallet).`,
            `Heat increased. The walls are paying attention now.`,
          ], escapeRows(false));
        }

        if (id.startsWith("jail:work_choice:")) {
          const parts = id.split(":");
          const taskId = parts[2];
          const choiceId = parts.slice(3).join(":");
          const run = state.workRun;
          if (!run) return showHub(i, "That work detail expired. Pick a new one.");

          let success = false;
          let option = run.options.find((entry) => entry.id === choiceId) || {};
          if (run.routeBased) {
            success = Math.random() < Number(option.successChance || 0.5);
          } else if (typeof run.isSuccess === "function") {
            success = run.isSuccess(choiceId);
          } else {
            success = choiceId === run.successId;
          }

          const result = await jail.recordWorkResult(interaction.guildId, interaction.user.id, taskId, {
            success,
            payoutMultiplier: option.payoutMultiplier || 1,
            reductionMultiplier: option.reductionMultiplier || 1,
          });
          await setCooldown(interaction.guildId, interaction.user.id, "jail:work", result.cooldownSeconds || config.work.baseCooldownSeconds);
          state.workRun = null;
          return showResult(i, success ? "Work Detail Complete" : "Work Detail Botched", [
            success ? "The guard grunts something that might be approval." : "The guard writes your name down with theatrical disappointment.",
            `Prison Money earned: **${money(result.payout)}**`,
            result.appliedReductionSeconds > 0
              ? `Sentence reduced by **${jail.formatDuration(result.appliedReductionSeconds)}**.`
              : "No sentence reduction applied.",
            result.reductionCapped ? "Your reduction cap stopped part of that reduction." : null,
            `Next work detail: <t:${unix(new Date(Date.now() + (result.cooldownSeconds || 75) * 1000))}:R>`,
          ], backRows(false));
        }
      } catch (err) {
        console.error("[JAIL] interaction failed:", err);
        try {
          const session = await jail.fetchJailSession(interaction.guildId, interaction.user.id);
          if (session) {
            await i.editReply({
              content: "Jail action failed. Check Railway logs.",
              embeds: [buildHubEmbed(interaction.user, session)],
              components: hubRows(false),
            });
          } else {
            await i.editReply({ content: "Jail action failed, but you are no longer jailed.", embeds: [], components: [] });
          }
        } catch {}
      }
    });

    collector.on("end", async (_collected, reason) => {
      if (["released", "bail", "escape"].includes(String(reason))) return;
      await removePanel(String(reason) === "idle" ? "idle" : "closed");
    });
  },
};
