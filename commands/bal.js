const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { getEconomySnapshot } = require("../utils/economy");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("bal")
    .setDescription("Show your wallet, bank, and total wealth."),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.inGuild()) return interaction.editReply("❌ Server only.");

    const snap = await getEconomySnapshot(interaction.guildId, interaction.user.id);
    return interaction.editReply(
      `💵 Wallet: **$${snap.wallet.toLocaleString()}**
` +
      `🏦 Bank: **$${snap.bank.toLocaleString()}**
` +
      `💰 Total Wealth: **$${snap.total.toLocaleString()}**
` +
      `🔢 Account Number: \`${snap.accountNumber}\``
    );
  },
};
