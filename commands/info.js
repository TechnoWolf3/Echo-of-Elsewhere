const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

const INFO_COLOR = 0x7c5cff;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("info")
    .setDescription("Show general Echo information."),

  async execute(interaction) {
    const serverName = interaction.guild?.name || "The Place";
    const icon = interaction.guild?.iconURL?.({ size: 256 }) || null;

    const embed = new EmbedBuilder()
      .setColor(INFO_COLOR)
      .setTitle("Echo of Elsewhere")
      .setDescription(
        [
          "A server companion for The Place, built around economy, jobs, games, progression, and strange little Echo-flavoured systems.",
          "",
          "Edit this command later in `commands/info.js` to replace this placeholder text with your final server info.",
        ].join("\n")
      )
      .addFields(
        {
          name: "What Echo Does",
          value: [
            "- Economy, banking, shop, inventory, and player profiles",
            "- Jobs, crime, jail, farming, manufacturing, and Underworld systems",
            "- Casino games, social games, rituals, events, achievements, and community levels",
          ].join("\n"),
          inline: false,
        },
        {
          name: "Useful Commands",
          value: [
            "`/help` - browse commands",
            "`/profile` - view a player profile",
            "`/bank` - open The Echo Reserve",
            "`/job` - open work and enterprise systems",
            "`/games` - open the games hub",
          ].join("\n"),
          inline: false,
        },
        {
          name: "Server",
          value: serverName,
          inline: true,
        }
      )
      .setFooter({ text: "Echo of Elsewhere" })
      .setTimestamp();

    if (icon) embed.setThumbnail(icon);

    return interaction.reply({ embeds: [embed] });
  },
};
