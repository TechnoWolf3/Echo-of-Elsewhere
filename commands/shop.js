// commands/shop.js
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require("discord.js");
const { listStoreItems, getStoreItem, purchaseItem } = require("../utils/store");
const { guardNotJailed } = require("../utils/jail");

function money(n) {
  return `$${Number(n || 0).toLocaleString()}`;
}

function formatDuration(sec) {
  sec = Math.max(0, Number(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("shop")
    .setDescription("Browse and buy items from the server shop.")
    .addSubcommand((sub) => sub.setName("list").setDescription("List shop items."))
    .addSubcommand((sub) =>
      sub
        .setName("info")
        .setDescription("View details for a shop item.")
        .addStringOption((opt) => opt.setName("item").setDescription("Item ID").setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName("buy")
        .setDescription("Buy an item from the shop.")
        .addStringOption((opt) => opt.setName("item").setDescription("Item ID").setRequired(true))
        .addIntegerOption((opt) => opt.setName("qty").setDescription("Quantity (if allowed)").setMinValue(1).setRequired(false))
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: "❌ Server only.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    if (await guardNotJailed(interaction)) return;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (sub === "list") {
      const items = await listStoreItems(guildId, { enabledOnly: true });
      if (!items.length) return interaction.editReply("🛒 The shop is empty right now.");

      const lines = items.slice(0, 25).map((it) => {
        const tags = [];
        if (Number(it.daily_stock || 0) > 0) tags.push(`daily:${it.daily_stock}`);
        if (Number(it.cooldown_seconds || 0) > 0) tags.push(`cd:${formatDuration(it.cooldown_seconds)}`);
        if (Number(it.max_owned || 0) > 0) tags.push(`max:${it.max_owned}`);
        if (Number(it.max_purchase_ever || 0) > 0) tags.push(`one-time`);
        if (Number(it.max_uses || 0) > 0) tags.push(`uses:${it.max_uses}`);

        return `• **${it.name}** — \`${it.item_id}\` — ${money(it.price)}${tags.length ? ` _( ${tags.join(" · ")} )_` : ""}`;
      });

      const embed = new EmbedBuilder()
        .setTitle("🛒 Rubicon Royal Store")
        .setDescription(lines.join("\n"))
        .setFooter({ text: "Use /shop info item:<id> or /shop buy item:<id>" });

      return interaction.editReply({ embeds: [embed] });
    }

    if (sub === "info") {
      const itemId = interaction.options.getString("item", true);
      const item = await getStoreItem(guildId, itemId);

      if (!item || !item.enabled) return interaction.editReply("❌ That item doesn’t exist (or is not for sale).");

      const maxOwned = Number(item.max_owned || 0);
      const maxUses = Number(item.max_uses || 0);
      const maxEver = Number(item.max_purchase_ever || 0);
      const cd = Number(item.cooldown_seconds || 0);
      const daily = Number(item.daily_stock || 0);

      const limits = [];
      if (maxEver > 0) limits.push("One-time purchase");
      if (cd > 0) limits.push(`Cooldown: ${formatDuration(cd)}`);
      if (daily > 0) limits.push(`Daily stock: ${daily} (server-wide)`);
      if (maxOwned > 0) limits.push(`Max owned: ${maxOwned}`);
      if (maxUses > 0) limits.push(`Uses: ${maxUses}`);

      const embed = new EmbedBuilder()
        .setTitle(`🧾 ${item.name}`)
        .setDescription(item.description || "_No description._")
        .addFields(
          { name: "Item ID", value: `\`${item.item_id}\``, inline: true },
          { name: "Price", value: money(item.price), inline: true },
          { name: "Type", value: String(item.kind || "item"), inline: true },
          { name: "Limits", value: limits.length ? limits.join("\n") : "None", inline: false }
        );

      return interaction.editReply({ embeds: [embed] });
    }

    if (sub === "buy") {
      const itemId = interaction.options.getString("item", true);
      const qty = interaction.options.getInteger("qty", false) ?? 1;

      const res = await purchaseItem(guildId, interaction.user.id, itemId, qty, {
        by: interaction.user.id,
        channelId: interaction.channelId,
      });

      if (!res.ok) {
        if (res.reason === "not_found" || res.reason === "disabled") {
          return interaction.editReply("❌ That item doesn’t exist (or is not for sale).");
        }
        if (res.reason === "insufficient_funds") {
          return interaction.editReply(`❌ Not enough balance. Your balance is **${money(res.balance)}**.`);
        }
        if (res.reason === "max_owned") {
          return interaction.editReply("❌ You already have the maximum allowed amount of that item.");
        }
        if (res.reason === "max_purchase_ever") {
          return interaction.editReply("❌ That item is a one-time purchase, and you’ve already bought it.");
        }
        if (res.reason === "cooldown") {
          return interaction.editReply(`⏳ You can buy that again in **${formatDuration(res.retryAfterSec)}**.`);
        }
        if (res.reason === "sold_out_daily") {
          return interaction.editReply(`❌ Sold out for today. Remaining stock: **${res.remaining}**.`);
        }
        if (res.reason === "bad_price") {
          return interaction.editReply("❌ That item can’t be purchased right now.");
        }
        return interaction.editReply("❌ Purchase failed.");
      }

      // Role granting happens AFTER purchase commits
      if (res.item.kind === "role") {
        const roleId = res.item.meta?.role_id;
        if (roleId) {
          try {
            const member = await interaction.guild.members.fetch(interaction.user.id);
            await member.roles.add(roleId);
          } catch {
            return interaction.editReply(
              `✅ Purchased **${res.item.name}** for **${money(res.totalPrice)}**.\n` +
              `⚠️ Role grant failed — ask an admin to apply it.\n` +
              `New balance: **${money(res.newBalance)}**`
            );
          }
        }
      }

      const usesLine = typeof res.usesRemaining === "number"
        ? `\nUses remaining: **${res.usesRemaining}**`
        : "";

      return interaction.editReply(
        `✅ Purchased **${res.item.name}** x${res.qtyBought} for **${money(res.totalPrice)}**.\n` +
        `You now have **x${res.newQty}**.${usesLine}\n` +
        `New balance: **${money(res.newBalance)}**`
      );
    }

    return interaction.editReply("❌ Unknown subcommand.");
  },
};
