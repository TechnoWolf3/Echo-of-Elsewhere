const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder
} = require("discord.js");

const rituals = require("../data/rituals");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("rituals")
    .setDescription("Visit Echo's ritual hub."),

  async execute(interaction) {

    const embed = new EmbedBuilder()
      .setColor(0x7A2BFF)
      .setTitle("🜂 Echo Rituals")
      .setDescription(
        "Some habits bring comfort.\n" +
        "Others bring profit.\n\n" +
        "Choose a ritual below."
      );

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("ritual_daily")
        .setLabel("Daily Ritual")
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId("ritual_weekly")
        .setLabel("Weekly Ritual")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("ritual_monthly")
        .setLabel("Monthly Ritual")
        .setStyle(ButtonStyle.Success)
    );

    const others = rituals.getOtherRituals();

    let dropdown;

    if (others.length > 0) {

      dropdown = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("ritual_other")
          .setPlaceholder("Other Rituals")
          .addOptions(
            others.map(r => ({
              label: r.name,
              description: r.description,
              value: r.id
            }))
          )
      );

      return interaction.reply({
        embeds: [embed],
        components: [buttons, dropdown]
      });
    }

    return interaction.reply({
      embeds: [embed],
      components: [buttons]
    });
  }
};