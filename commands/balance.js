const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { getEconomySnapshot } = require("../utils/economy");
const { getDisplayEconomySnapshot } = require("../utils/displayProfile");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("balance")
    .setDescription("Show your wallet, bank, and total wealth."),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.inGuild()) return interaction.editReply("❌ Server only.");

    const realSnap = await getEconomySnapshot(interaction.guildId, interaction.user.id);
    const snap = await getDisplayEconomySnapshot(interaction.guildId, interaction.user.id, realSnap);
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
