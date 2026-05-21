const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const community = require("../utils/community/communityService");
const { renderLevelProfileEmbed } = require("../utils/community/renderLevelProfile");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("level")
    .setDescription("Show an Echo Resonance level profile.")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("User to view (defaults to you)")
        .setRequired(false)
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: "This command can only be used in a server.", flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply();

    const user = interaction.options.getUser("user") || interaction.user;
    const profile = await community.getLevelProfile({ guild: interaction.guild, user });
    const embed = renderLevelProfileEmbed(profile);

    return interaction.editReply({ embeds: [embed] });
  },
};
