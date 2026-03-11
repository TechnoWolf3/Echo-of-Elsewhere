const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require("discord.js");

const config = require("../data/ese/config");
const {
  getSnapshot,
  getTopMovers,
  getCompanyHistory,
} = require("../utils/ese/engine");
const { buildChartUrl } = require("../utils/ese/chartRenderer");

function money(n) {
  return `$${Number(n || 0).toLocaleString("en-AU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function pct(n) {
  const num = Number(n || 0);
  return `${num >= 0 ? "+" : ""}${num.toFixed(2)}%`;
}

function buildOverviewEmbed() {
  const snap = getSnapshot();
  const { topGainer, topLoser } = getTopMovers(snap);

  return new EmbedBuilder()
    .setColor(0x0875af)
    .setTitle("📈 Echo Stock Exchange")
    .setThumbnail(config.logo)
    .setDescription("A live simulated exchange shaped by market sentiment, player pressure, and server activity.")
    .addFields(
      {
        name: "Market State",
        value: `**${snap.marketState || "Stable Session"}**`,
        inline: true,
      },
      {
        name: "Top Gainer",
        value: topGainer
          ? `**${topGainer.symbol}** • ${money(topGainer.price)} (${pct(topGainer.dayChangePercent)})`
          : "N/A",
        inline: true,
      },
      {
        name: "Top Loser",
        value: topLoser
          ? `**${topLoser.symbol}** • ${money(topLoser.price)} (${pct(topLoser.dayChangePercent)})`
          : "N/A",
        inline: true,
      }
    )
    .setFooter({ text: "Use the menu below to inspect a listing." })
    .setTimestamp();
}

function buildListingEmbed(symbol) {
  const snap = getSnapshot();
  const company = snap.companies.find((c) => c.symbol === symbol);
  if (!company) return null;

  const history = getCompanyHistory(symbol, 48);
  const chartUrl = buildChartUrl(symbol, history);

  return new EmbedBuilder()
    .setColor(0x0875af)
    .setTitle(`${company.symbol} • ${company.name}`)
    .setThumbnail(config.logo)
    .setImage(chartUrl)
    .addFields(
      { name: "Sector", value: company.sector, inline: true },
      { name: "Price", value: money(company.price), inline: true },
      { name: "24H", value: pct(company.dayChangePercent), inline: true },
      { name: "Open", value: money(company.open), inline: true },
      { name: "High", value: money(company.high), inline: true },
      { name: "Low", value: money(company.low), inline: true },
      { name: "Volume", value: `${Number(company.volume || 0).toLocaleString("en-AU")}`, inline: true },
      { name: "Dividend", value: company.dividend ? "Yes" : "No", inline: true },
      { name: "Sentiment", value: `${Number(company.sentiment || 0).toFixed(3)}`, inline: true }
    )
    .setFooter({ text: "Trading terminal wiring comes next." })
    .setTimestamp();
}

function buildMenu() {
  const snap = getSnapshot();

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("ese-view-stock")
      .setPlaceholder("Select a stock to view")
      .addOptions(
        snap.companies.map((c) => ({
          label: `${c.symbol} • ${c.name}`,
          description: `${c.sector} • ${money(c.price)}`,
          value: c.symbol,
        }))
      )
  );
}

function buildButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ese-home")
      .setLabel("Overview")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("ese-refresh")
      .setLabel("Refresh")
      .setStyle(ButtonStyle.Secondary)
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("ese")
    .setDescription("Open the Echo Stock Exchange hub."),

  async execute(interaction) {
    const embed = buildOverviewEmbed();

    await interaction.reply({
      embeds: [embed],
      components: [buildMenu(), buildButtons()],
    });
  },

  async handleComponent(interaction) {
    if (interaction.customId === "ese-home" || interaction.customId === "ese-refresh") {
      return interaction.update({
        embeds: [buildOverviewEmbed()],
        components: [buildMenu(), buildButtons()],
      });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === "ese-view-stock") {
      const symbol = interaction.values[0];
      const embed = buildListingEmbed(symbol);

      if (!embed) {
        return interaction.reply({
          content: "That stock could not be found.",
          ephemeral: true,
        });
      }

      return interaction.update({
        embeds: [embed],
        components: [buildMenu(), buildButtons()],
      });
    }
  },
};