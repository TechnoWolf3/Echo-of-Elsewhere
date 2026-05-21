const { AttachmentBuilder, SlashCommandBuilder, MessageFlags } = require("discord.js");
const community = require("../utils/community/communityService");
const { renderLevelProfileEmbed } = require("../utils/community/renderLevelProfile");
const { renderLevelCardPng } = require("../utils/community/renderLevelCard");

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

    try {
      const cardBuffer = await renderLevelCardPng(profile);
      const attachment = new AttachmentBuilder(cardBuffer, { name: "echo-resonance-card.png" });
      return interaction.editReply({
        content: "🌌 Echo Resonance",
        files: [attachment],
      });
    } catch (error) {
      console.error("[community] level card render failed; falling back to embed:", error);
      const embed = renderLevelProfileEmbed(profile);
      return interaction.editReply({ embeds: [embed] });
    }
  },
};
