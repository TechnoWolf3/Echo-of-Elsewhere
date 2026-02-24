// commands/lottery.js
const { SlashCommandBuilder, MessageFlags, EmbedBuilder } = require("discord.js");
const config = require("../data/lottery/config");
const lottery = require("../utils/lottery");

function formatMoney(n) {
  const v = Math.max(0, Math.floor(Number(n) || 0));
  return `$${v.toLocaleString("en-AU")}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("lottery")
    .setDescription("Weekly Echo Powerball lottery")
    .addSubcommand(sub =>
      sub.setName("info").setDescription("Show current jackpot and draw info")
    ),

  async execute(interaction) {
    const guildId = interaction.guildId;
    const drawUtc = lottery.nextDrawUtcMs();
    const drawKey = lottery.drawKeyFromDrawUtc(drawUtc);
    const closeUtc = lottery.salesCloseUtcMs(drawUtc);

    const drawUnix = Math.floor(drawUtc / 1000);
    const closeUnix = Math.floor(closeUtc / 1000);

    const st = await lottery.getState(guildId);
    const sold = await lottery.countTickets(guildId, drawKey);

    const e = new EmbedBuilder()
      .setTitle(config.embed.title)
      .setDescription([
        `**Next Draw:** <t:${drawUnix}:F> • <t:${drawUnix}:R>`,
        `**Sales Close:** <t:${closeUnix}:F> • <t:${closeUnix}:R>`,
        ``,
        `**Jackpot:** ${formatMoney(st.jackpot)}`,
        `**Tickets Sold:** ${sold.toLocaleString("en-AU")}`,
        ``,
        `Ticket Price: ${formatMoney(config.ticketPrice)} • Cap: ${config.maxTicketsPerUser}`
      ].join("\n"))
      .setFooter({ text: config.embed.footer });

    return interaction.reply({ embeds: [e], flags: MessageFlags.Ephemeral });
  }
};
