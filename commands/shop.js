// commands/shop.js
const {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
} = require("discord.js");

const {
  listStoreItems,
  listSellableItems,
  purchaseItem,
  sellItem,
} = require("../utils/store");

const { guardNotJailed } = require("../utils/jail");

function money(n) {
  return `$${Number(n || 0).toLocaleString()}`;
}

// -------------------------
// CATEGORY CONFIG (EDIT ME)
// -------------------------
// If an item has meta.category, that value is used.
// Otherwise we fall back to KIND_DEFAULT_CATEGORY.
// You can rename/add/remove categories here freely.
const CATEGORY_ORDER = [
  "All",
  "Tools",
  "One time buys",
  "Consumables",
  "Perks",
  "Roles",
  "Permanent",
  "General",
  "Other",
];

const KIND_DEFAULT_CATEGORY = {
  item: "General",
  consumable: "Consumables",
  perk: "Perks",
  role: "Roles",
  permanent: "Permanent",
};

function getCategoryLabel(item) {
  const meta = item?.meta && typeof item.meta === "object" ? item.meta : {};
  const fromMeta = typeof meta.category === "string" ? meta.category.trim() : "";
  if (fromMeta) return fromMeta;
  const kind = String(item?.kind || "item");
  return KIND_DEFAULT_CATEGORY[kind] || "Other";
}

function clampInt(n, min, max) {
  const x = Math.floor(Number(n));
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("shop")
    .setDescription("Open the shop panel (buy / sell / categories).")
    .setDMPermission(false),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: "❌ Server only.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    if (await guardNotJailed(interaction)) return;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    // -------------------------
    // PANEL STATE
    // -------------------------
    const state = {
      view: "buy",          // "buy" | "sell"
      category: "All",      // label
      page: 0,              // 0-based
    };

    // -------------------------
    // LOADERS
    // -------------------------
    async function loadBuyItems() {
      const items = await listStoreItems(guildId, { enabledOnly: true });
      // decorate with category label
      return items.map((it) => ({
        ...it,
        _category: getCategoryLabel(it),
      }));
    }

    async function loadSellItems() {
      const items = await listSellableItems(guildId, userId);
      // sellables don't include meta/kind mapping consistently; category here is optional.
      // If an item exists in store_items, your listSellableItems already returns name/kind/sell_price.
      return items.map((it) => ({
        ...it,
        _category: "Sellables",
      }));
    }

    function buildCategoryOptions(allBuyItems) {
      const found = new Set();
      for (const it of allBuyItems) found.add(it._category);

      // Build a nice list:
      // - Always include "All"
      // - Then include CATEGORY_ORDER items that exist
      // - Then any extras found in meta.category but not in CATEGORY_ORDER
      const ordered = [];
      ordered.push("All");

      for (const c of CATEGORY_ORDER) {
        if (c === "All") continue;
        if (found.has(c)) ordered.push(c);
      }

      for (const c of Array.from(found)) {
        if (c === "All") continue;
        if (!ordered.includes(c)) ordered.push(c);
      }

      // Discord select menu limit: 25 options
      return ordered.slice(0, 25).map((label) => ({
        label,
        value: label,
        default: state.category === label,
      }));
    }

    function filterBuyItems(allBuyItems) {
      if (state.category === "All") return allBuyItems;
      return allBuyItems.filter((it) => it._category === state.category);
    }

    // -------------------------
    // RENDER
    // -------------------------
    const PAGE_SIZE = 5;

    async function render() {
      const allBuy = await loadBuyItems();
      const categoryOptions = buildCategoryOptions(allBuy);

      if (state.view === "buy") {
        const filtered = filterBuyItems(allBuy);
        const pages = chunk(filtered, PAGE_SIZE);
        const totalPages = Math.max(1, pages.length);
        state.page = clampInt(state.page, 0, totalPages - 1);
        const pageItems = pages[state.page] || [];

        const lines = pageItems.map((it, idx) => {
          const n = idx + 1;
          return `**#${n}** • **${it.name}** — ${money(it.price)}\n\`${it.item_id}\`  *(cat: ${it._category})*`;
        });

        const embed = new EmbedBuilder()
          .setTitle("🛒 Shop — Buy")
          .setDescription(lines.length ? lines.join("\n\n") : "_No items in this category._")
          .setFooter({ text: `Category: ${state.category} • Page ${state.page + 1}/${totalPages}` });

        const toggleRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("shop:toggle:buy").setLabel("🛒 Buy").setStyle(ButtonStyle.Secondary).setDisabled(true),
          new ButtonBuilder().setCustomId("shop:toggle:sell").setLabel("💰 Sell").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("shop:close").setLabel("❌ Close").setStyle(ButtonStyle.Danger)
        );

        const navRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("shop:prev")
            .setLabel("◀ Prev")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(state.page <= 0),
          new ButtonBuilder()
            .setCustomId("shop:next")
            .setLabel("Next ▶")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(state.page >= totalPages - 1)
        );

        const catRow = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("shop:category")
            .setPlaceholder("📂 Select category…")
            .addOptions(categoryOptions)
        );

        // Buy buttons for 1..5
        const buyButtons = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("shop:buy:1").setLabel("Buy #1").setStyle(ButtonStyle.Success).setDisabled(!pageItems[0]),
          new ButtonBuilder().setCustomId("shop:buy:2").setLabel("Buy #2").setStyle(ButtonStyle.Success).setDisabled(!pageItems[1]),
          new ButtonBuilder().setCustomId("shop:buy:3").setLabel("Buy #3").setStyle(ButtonStyle.Success).setDisabled(!pageItems[2]),
          new ButtonBuilder().setCustomId("shop:buy:4").setLabel("Buy #4").setStyle(ButtonStyle.Success).setDisabled(!pageItems[3]),
          new ButtonBuilder().setCustomId("shop:buy:5").setLabel("Buy #5").setStyle(ButtonStyle.Success).setDisabled(!pageItems[4])
        );

        // Store the current page items for button handlers
        return {
          embeds: [embed],
          components: [toggleRow, catRow, navRow, buyButtons],
          _pageItems: pageItems,
          _allBuy: allBuy,
        };
      }

      // SELL VIEW
      const sellables = await loadSellItems();
      const pages = chunk(sellables, PAGE_SIZE);
      const totalPages = Math.max(1, pages.length);
      state.page = clampInt(state.page, 0, totalPages - 1);
      const pageItems = pages[state.page] || [];

      const lines = pageItems.map((it, idx) => {
        const n = idx + 1;
        return `**#${n}** • **${it.name}** — ${money(it.sell_price)} each\nOwned: **${Number(it.qty || 0).toLocaleString()}**\n\`${it.item_id}\``;
      });

      const embed = new EmbedBuilder()
        .setTitle("💰 Shop — Sell")
        .setDescription(lines.length ? lines.join("\n\n") : "_No sellable items._")
        .setFooter({ text: `Page ${state.page + 1}/${totalPages}` });

      const toggleRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("shop:toggle:buy").setLabel("🛒 Buy").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("shop:toggle:sell").setLabel("💰 Sell").setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId("shop:close").setLabel("❌ Close").setStyle(ButtonStyle.Danger)
      );

      const navRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("shop:prev")
          .setLabel("◀ Prev")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(state.page <= 0),
        new ButtonBuilder()
          .setCustomId("shop:next")
          .setLabel("Next ▶")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(state.page >= totalPages - 1)
      );

      const sellButtons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("shop:sell:1").setLabel("Sell #1").setStyle(ButtonStyle.Success).setDisabled(!pageItems[0]),
        new ButtonBuilder().setCustomId("shop:sell:2").setLabel("Sell #2").setStyle(ButtonStyle.Success).setDisabled(!pageItems[1]),
        new ButtonBuilder().setCustomId("shop:sell:3").setLabel("Sell #3").setStyle(ButtonStyle.Success).setDisabled(!pageItems[2]),
        new ButtonBuilder().setCustomId("shop:sell:4").setLabel("Sell #4").setStyle(ButtonStyle.Success).setDisabled(!pageItems[3]),
        new ButtonBuilder().setCustomId("shop:sell:5").setLabel("Sell #5").setStyle(ButtonStyle.Success).setDisabled(!pageItems[4])
      );

      return {
        embeds: [embed],
        components: [toggleRow, navRow, sellButtons],
        _pageItems: pageItems,
        _allBuy: allBuy,
      };
    }

    // Initial render
    let viewData = await render();
    const msg = await interaction.editReply({ embeds: viewData.embeds, components: viewData.components, fetchReply: true }).catch(() => null);
    if (!msg) return;

    const collector = msg.createMessageComponentCollector({ time: 5 * 60 * 1000 });

    async function refresh() {
      viewData = await render();
      await interaction.editReply({ embeds: viewData.embeds, components: viewData.components }).catch(() => {});
    }

    function findBuyItemByIndex(i) {
      // i is 1..5 for current page
      const idx = i - 1;
      return viewData._pageItems?.[idx] || null;
    }

    function findSellItemByIndex(i) {
      const idx = i - 1;
      return viewData._pageItems?.[idx] || null;
    }

    async function showQtyModal(btn, mode, item) {
      const modalId = `shop_modal:${mode}:${item.item_id}:${Date.now()}`;
      const modal = new ModalBuilder().setCustomId(modalId).setTitle(mode === "buy" ? "Buy Quantity" : "Sell Quantity");

      const placeholder =
        mode === "buy"
          ? "e.g. 1, 5, 10"
          : `e.g. 1, 5, ${Number(item.qty || 0)}`;

      const input = new TextInputBuilder()
        .setCustomId("amount")
        .setLabel(mode === "buy" ? "How many would you like to buy?" : "How many would you like to sell?")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder(placeholder);

      modal.addComponents(new ActionRowBuilder().addComponents(input));

      await btn.showModal(modal).catch(() => {});

      const submitted = await btn
        .awaitModalSubmit({
          time: 30_000,
          filter: (m) => m.user.id === userId && m.customId === modalId,
        })
        .catch(() => null);

      if (!submitted) return;

      await submitted.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
      const raw = submitted.fields.getTextInputValue("amount");
      let qty = Math.floor(Number(raw));

      if (!Number.isFinite(qty) || qty <= 0) {
        await submitted.editReply("❌ Please enter a valid positive number.").catch(() => {});
        return;
      }

      if (mode === "buy") {
        // If not stackable or uses item, force qty = 1
        const maxUses = Number(item.max_uses || 0);
        const stackable = !!item.stackable;
        if (!stackable || maxUses > 0) qty = 1;

        const res = await purchaseItem(guildId, userId, item.item_id, qty, { via: "shop_panel_buy" });

        if (!res.ok) {
          if (res.reason === "not_found") return submitted.editReply("❌ That item doesn’t exist (or is not for sale).").catch(() => {});
          if (res.reason === "insufficient_funds")
            return submitted.editReply(`❌ Not enough balance. Your balance is **${money(res.balance)}**.`).catch(() => {});
          if (res.reason === "max_owned") return submitted.editReply("❌ You already have the maximum allowed amount.").catch(() => {});
          if (res.reason === "max_purchase_ever") return submitted.editReply("❌ That item is a one-time purchase, already bought.").catch(() => {});
          if (res.reason === "cooldown") return submitted.editReply(`⏳ Try again in **${res.retryAfterSec}s**.`).catch(() => {});
          if (res.reason === "sold_out_daily") return submitted.editReply("❌ Sold out for today.").catch(() => {});
          return submitted.editReply("❌ Purchase failed.").catch(() => {});
        }

        await submitted
          .editReply(`✅ Bought **${res.qtyBought}x** \`${res.item.item_id}\` for **${money(res.totalPrice)}**.`)
          .catch(() => {});
      } else {
        // sell: cap to owned
        const owned = Number(item.qty || 0);
        qty = Math.min(qty, owned);

        const res = await sellItem(guildId, userId, item.item_id, qty, { via: "shop_panel_sell" });

        if (!res.ok) {
          if (res.reason === "not_sellable") return submitted.editReply("❌ That item isn’t sellable.").catch(() => {});
          if (res.reason === "not_owned") return submitted.editReply("❌ You don’t own that item.").catch(() => {});
          if (res.reason === "insufficient_qty") return submitted.editReply(`❌ You only have **${res.owned}**.`).catch(() => {});
          return submitted.editReply("❌ Sell failed.").catch(() => {});
        }

        await submitted
          .editReply(`✅ Sold **${res.qtySold}x** \`${item.item_id}\` for **${money(res.total)}**.`)
          .catch(() => {});
      }

      // Refresh panel after action
      await refresh();
    }

    collector.on("collect", async (btn) => {
      // Only the command user can use the panel
      if (btn.user.id !== userId) {
        return btn.reply({ content: "❌ This menu isn’t for you.", flags: MessageFlags.Ephemeral }).catch(() => {});
      }

      // Select menus need deferUpdate too
      if (btn.isStringSelectMenu()) {
        await btn.deferUpdate().catch(() => {});
        if (btn.customId === "shop:category") {
          state.category = btn.values?.[0] || "All";
          state.page = 0;
          await refresh();
        }
        return;
      }

      await btn.deferUpdate().catch(() => {});

      const id = btn.customId;

      if (id === "shop:close") {
        collector.stop("closed");
        return;
      }

      if (id === "shop:toggle:buy") {
        state.view = "buy";
        state.page = 0;
        await refresh();
        return;
      }

      if (id === "shop:toggle:sell") {
        state.view = "sell";
        state.page = 0;
        await refresh();
        return;
      }

      if (id === "shop:prev") {
        state.page = Math.max(0, state.page - 1);
        await refresh();
        return;
      }

      if (id === "shop:next") {
        state.page = state.page + 1;
        await refresh();
        return;
      }

      // Buy buttons
      if (id.startsWith("shop:buy:")) {
        const n = Number(id.split(":")[2]);
        const item = findBuyItemByIndex(n);
        if (!item) return;
        await showQtyModal(btn, "buy", item);
        return;
      }

      // Sell buttons
      if (id.startsWith("shop:sell:")) {
        const n = Number(id.split(":")[2]);
        const item = findSellItemByIndex(n);
        if (!item) return;
        await showQtyModal(btn, "sell", item);
        return;
      }
    });

    collector.on("end", async () => {
      // disable components at end
      await interaction.editReply({ components: [] }).catch(() => {});
    });
  },
};
