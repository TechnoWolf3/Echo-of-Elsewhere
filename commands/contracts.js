
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const contracts = require('../utils/contracts');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('contracts')
    .setDescription('View the active community contract and your personal contracts.'),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: '❌ Server only.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    const payload = await contracts.buildDashboardPayload(interaction.guildId, interaction.user.id);
    return interaction.reply(payload).catch(() => {});
  },

  async handleInteraction(interaction) {
    return contracts.handleInteraction(interaction);
  },
};
