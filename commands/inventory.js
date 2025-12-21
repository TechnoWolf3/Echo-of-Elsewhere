// commands/inventory.js
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require("discord.js");
const { getInventory } = require("../utils/store");
const { guardNotJailed } = require("../utils/jail");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("inventory")
    .setDescription("View your inventory.")
    .addUserOption((opt) =>
      opt.setName("user").setDescription("View someone else (optional)").setRequired(false)
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: "❌ Server only.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    if (await guardNotJailed(interaction)) return;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
    const target = interaction.options.getUser("user", false) || interaction.user;

    const rows = await getInventory(interaction.guildId, target.id);
    if (!rows.length) {
      return interaction.editReply(target.id === interaction.user.id
        ? "🎒 Your inventory is empty."
        : `🎒 ${target.username}'s inventory is empty.`
      );
    }

    const lines = rows.slice(0, 25).map((r) => {
      const name = r.name ? `**${r.name}**` : `\`${r.item_id}\``;
      const uses = Number(r.max_uses || 0) > 0 ? ` — uses: **${r.uses_remaining}/${r.max_uses}**` : "";
      return `• ${name} — x${r.qty}${uses}`;
    });

    const embed = new EmbedBuilder()
      .setTitle(`🎒 Inventory — ${target.username}`)
      .setDescription(lines.join("\n"))
      .setFooter({ text: rows.length > 25 ? `Showing 25 of ${rows.length}` : " " });

    return interaction.editReply({ embeds: [embed] });
  },
};
