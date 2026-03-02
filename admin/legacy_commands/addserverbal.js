// commands/addserverbal.js
const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { addServerBank } = require("../../utils/economy");

const REQUIRED_ROLE_ID = "741251069002121236";

function hasRequiredRole(member) {
  return member?.roles?.cache?.has(REQUIRED_ROLE_ID);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("addserverbal")
    .setDescription("Add money to the server bank (restricted role only).")
    .addIntegerOption((opt) =>
      opt
        .setName("amount")
        .setDescription("Amount to add")
        .setRequired(true)
        .setMinValue(1)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
    if (!interaction.inGuild()) return interaction.editReply("❌ Server only.");

    // 🔒 Role gate
    if (!hasRequiredRole(interaction.member)) {
      return interaction.editReply("❌ You don’t have permission to use this command.");
    }

    try {
      const amount = interaction.options.getInteger("amount", true);

      const bank = await addServerBank(
        interaction.guildId,
        amount,
        "add_server_bank",
        { by: interaction.user.id, channelId: interaction.channelId }
      );

      return interaction.editReply(
        `✅ Added **$${amount.toLocaleString()}** to the server bank.\n` +
        `🏦 New bank balance: **$${bank.toLocaleString()}**`
      );
    } catch (err) {
      console.error("AddServerBal error:", err);
      return interaction.editReply("❌ Something went wrong. Check Railway logs.");
    }
  },
};
