const {
  SlashCommandBuilder,
  MessageFlags,
} = require('discord.js');

const { buildPanelMessage } = require('../utils/adminPanel');

const BOT_MASTER_ROLE_ID = '741251069002121236';

function hasBotMaster(member) {
  return member?.roles?.cache?.has?.(BOT_MASTER_ROLE_ID) === true;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('adminpanel')
    .setDescription('Bot Master control panel'),

  async execute(interaction) {
    try {
      if (!interaction.inGuild()) {
        return interaction.reply({
          content: '❌ This only works inside a server.',
          flags: MessageFlags.Ephemeral,
        });
      }

      if (!hasBotMaster(interaction.member)) {
        return interaction.reply({
          content: '😇 Nice try. This panel is for **Bot Masters** only — don’t be naughty.',
          flags: MessageFlags.Ephemeral,
        });
      }

      const payload = buildPanelMessage({ category: 'economy' });
      return interaction.reply(payload);
    } catch (e) {
      console.error('[ADMINPANEL] command failed:', e);
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({ content: '❌ Admin panel failed to open. Check logs.', flags: MessageFlags.Ephemeral });
        } else {
          await interaction.reply({ content: '❌ Admin panel failed to open. Check logs.', flags: MessageFlags.Ephemeral });
        }
      } catch (_) {}
    }
  },
};
