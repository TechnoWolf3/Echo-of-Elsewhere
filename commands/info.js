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
          "Echo is a funny little thing, explore and interact with Echo to discover its secrets.",
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
          name: "Echo's Tale",
          value: [
            "For the website version of Echo's story, see [here](https://echos-tale.vercel.app/).",
            "Echo's Tale is a web based companion for Echo of Elsewhere, providing a cleaner interface for Echo's trials and games, as well as a more detailed interaction."
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
