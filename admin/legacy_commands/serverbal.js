const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { getServerBank } = require("../../utils/economy");

const BOT_MASTER_ROLE_ID = "741251069002121236";

function isBotMaster(member) {
  return member?.roles?.cache?.has?.(BOT_MASTER_ROLE_ID);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("serverbal")
    .setDescription("Show the server bank balance (admin only).")
    // NOTE: This file is no longer deployed as a slash command.
    // Permissions are enforced by the Admin Panel + this role gate.

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.inGuild()) return interaction.editReply("❌ Server only.");

    if (!isBotMaster(interaction.member)) {
      return interaction.editReply("❌ You don’t have permission to do that.");
    }

    const bank = await getServerBank(interaction.guildId);
    return interaction.editReply(`🏦 Server bank balance: **$${bank.toLocaleString()}**`);
  },
};
