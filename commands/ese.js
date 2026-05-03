const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require("discord.js");

const config = require("../data/ese/config");
const {
  getSnapshot,
  getTopMovers,
  getCompany,
  getCompanyHistory,
  getTradeFeeRate,
  getTradeCooldown,
  getUserHolding,
  getUserPortfolio,
  applyBuy,
  applySell,
  getLatestNews,
  getRumorBoard,
  getDividendRule,
} = require("../utils/ese/engine");
const { buildChartUrl } = require("../utils/ese/chartRenderer");
const {
  ensureUser,
  getWalletBalance,
  tryDebitUser,
  creditUser,
} = require("../utils/economy");
const { recordProgress: recordContractProgress } = require("../utils/contracts");

async function recordStockContractProgress(guildId, userId, gross) {
  await recordContractProgress({ guildId, userId, metric: "stock_trades", amount: 1 }).catch(() => {});
  await recordContractProgress({
    guildId,
    userId,
    metric: "stock_volume",
    amount: Math.round(Math.max(0, Number(gross) || 0)),
  }).catch(() => {});
}

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

function formatShares(n) {
  return Number(n || 0).toLocaleString("en-AU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

async function buildOverviewEmbed(interaction) {
  const snap = await getSnapshot();
  const { topGainer, topLoser } = getTopMovers(snap);
  const portfolio = await getUserPortfolio(interaction.guildId, interaction.user.id);
  const news = await getLatestNews(2);

  const newsText =
    news.length > 0
      ? news.map((n) => `• ${n.headline}`).join("\n")
      : "No market bulletins yet.";

  return new EmbedBuilder()
    .setColor(0x0875af)
    .setTitle("📈 Echo Stock Exchange")
    .setThumbnail(config.logo)
    .setDescription(
      "A live simulated exchange shaped by market sentiment, player pressure, and server activity."
    )
    .addFields(
      {
        name: "Market State",
        value: `**${snap.marketState || "Stable Session"}**`,
        inline: true,
      },
      {
        name: "Top Gainer",
        value: topGainer
          ? `**${topGainer.symbol}** • ${money(topGainer.price)} (${pct(
              topGainer.dayChangePercent
            )})`
          : "N/A",
        inline: true,
      },
      {
        name: "Top Loser",
        value: topLoser
          ? `**${topLoser.symbol}** • ${money(topLoser.price)} (${pct(
              topLoser.dayChangePercent
            )})`
          : "N/A",
        inline: true,
      },
      {
        name: "Your Portfolio",
        value:
          portfolio.holdings.length > 0
            ? `Holdings: **${portfolio.holdings.length}**\nValue: **${money(
                portfolio.summary.totalValue
              )}**\nP/L: **${pct(
                portfolio.summary.totalCost
                  ? (portfolio.summary.unrealized / portfolio.summary.totalCost) * 100
                  : 0
              )}**`
            : "No holdings yet.",
        inline: false,
      },
      {
        name: "Latest News",
        value: newsText,
        inline: false,
      }
    )
    .setFooter({ text: "Use the menu below to inspect a listing." })
    .setTimestamp();
}

async function buildListingEmbed(interaction, symbol) {
  const company = await getCompany(symbol);
  if (!company) return null;

  const history = await getCompanyHistory(symbol, 48);
  const chartUrl = buildChartUrl(symbol, history);
  const holding = await getUserHolding(interaction.guildId, interaction.user.id, symbol);
  const dividendRule = getDividendRule(symbol);

  let dividendText = "No";
  if (dividendRule?.enabled) {
    dividendText = `Yes • ${(Number(dividendRule.payoutRate || 0) * 100).toFixed(2)}% / ${Number(
      dividendRule.intervalTicks || 0
    )} ticks`;
  }

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
      {
        name: "Volume",
        value: `${Number(company.volume || 0).toLocaleString("en-AU")}`,
        inline: true,
      },
      { name: "Dividend", value: dividendText, inline: true },
      {
        name: "Sentiment",
        value: `${Number(company.sentiment || 0).toFixed(3)}`,
        inline: true,
      },
      {
        name: "You Own",
        value: holding
          ? `${formatShares(holding.shares)} shares @ avg ${money(holding.avgPrice)}`
          : "No shares",
        inline: false,
      }
    )
    .setFooter({ text: "Trades include fees and affect the next market tick." })
    .setTimestamp();
}

async function buildPortfolioEmbed(interaction) {
  const portfolio = await getUserPortfolio(interaction.guildId, interaction.user.id);

  const lines =
    portfolio.holdings.length > 0
      ? portfolio.holdings
          .slice(0, 10)
          .map(
            (h) =>
              `**${h.symbol}** • ${formatShares(h.shares)} shares\nAvg: ${money(
                h.avgPrice
              )} • Now: ${money(h.currentPrice)} • P/L: ${money(h.unrealized)}`
          )
          .join("\n\n")
      : "You do not currently hold any ESE listings.";

  return new EmbedBuilder()
    .setColor(0x0875af)
    .setTitle("💼 Your ESE Portfolio")
    .setThumbnail(config.logo)
    .setDescription(lines)
    .addFields(
      {
        name: "Portfolio Value",
        value: money(portfolio.summary.totalValue),
        inline: true,
      },
      {
        name: "Cost Basis",
        value: money(portfolio.summary.totalCost),
        inline: true,
      },
      {
        name: "Unrealized P/L",
        value: money(portfolio.summary.unrealized),
        inline: true,
      }
    )
    .setFooter({ text: "Open a listing to buy or sell shares." })
    .setTimestamp();
}

async function buildRumorsEmbed() {
  const rumors = await getRumorBoard();
  const news = await getLatestNews(5);

  const rumorText =
    rumors.length > 0
      ? rumors.map((r) => `• **${r.symbol}** — ${r.text}`).join("\n\n")
      : "No active rumors.";

  const newsText =
    news.length > 0
      ? news.slice(0, 3).map((n) => `• ${n.headline}`).join("\n")
      : "No recent news.";

  return new EmbedBuilder()
    .setColor(0x0875af)
    .setTitle("🕵️ ESE Rumors & Market Chatter")
    .setThumbnail(config.logo)
    .addFields(
      { name: "Rumor Board", value: rumorText, inline: false },
      { name: "Recent Bulletins", value: newsText, inline: false }
    )
    .setFooter({ text: "Rumors are directionally useful, not guarantees." })
    .setTimestamp();
}

async function buildMenu() {
  const snap = await getSnapshot();

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

function buildOverviewButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ese-home")
      .setLabel("Overview")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("ese-portfolio")
      .setLabel("Portfolio")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("ese-rumors")
      .setLabel("Rumors")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("ese-refresh")
      .setLabel("Refresh")
      .setStyle(ButtonStyle.Secondary)
  );
}

function buildListingButtons(symbol) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ese-buy:${symbol}`)
      .setLabel("Buy")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`ese-sell:${symbol}`)
      .setLabel("Sell")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("ese-portfolio")
      .setLabel("Portfolio")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("ese-home")
      .setLabel("Overview")
      .setStyle(ButtonStyle.Primary)
  );
}

function buildPortfolioButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ese-home")
      .setLabel("Overview")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("ese-rumors")
      .setLabel("Rumors")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("ese-refresh-portfolio")
      .setLabel("Refresh Portfolio")
      .setStyle(ButtonStyle.Secondary)
  );
}

function buildRumorButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ese-home")
      .setLabel("Overview")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("ese-portfolio")
      .setLabel("Portfolio")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("ese-refresh-rumors")
      .setLabel("Refresh Rumors")
      .setStyle(ButtonStyle.Secondary)
  );
}

function buildTradeModal(side, symbol) {
  return new ModalBuilder()
    .setCustomId(`ese-trade-modal:${side}:${symbol}`)
    .setTitle(`${side === "buy" ? "Buy" : "Sell"} ${symbol}`)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("shares")
          .setLabel("How many shares?")
          .setPlaceholder("Example: 10")
          .setRequired(true)
          .setStyle(TextInputStyle.Short)
      )
    );
}

async function showOverview(interaction) {
  return interaction.update({
    embeds: [await buildOverviewEmbed(interaction)],
    components: [await buildMenu(), buildOverviewButtons()],
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("ese")
    .setDescription("Open the Echo Stock Exchange hub."),

  async execute(interaction) {
    await interaction.deferReply().catch(() => {});
    await ensureUser(interaction.guildId, interaction.user.id);

    await interaction.editReply({
      embeds: [await buildOverviewEmbed(interaction)],
      components: [await buildMenu(), buildOverviewButtons()],
    });
  },

  async handleComponent(interaction) {
    if (interaction.customId === "ese-home" || interaction.customId === "ese-refresh") {
      return showOverview(interaction);
    }

    if (interaction.customId === "ese-portfolio" || interaction.customId === "ese-refresh-portfolio") {
      return interaction.update({
        embeds: [await buildPortfolioEmbed(interaction)],
        components: [buildPortfolioButtons()],
      });
    }

    if (interaction.customId === "ese-rumors" || interaction.customId === "ese-refresh-rumors") {
      return interaction.update({
        embeds: [await buildRumorsEmbed()],
        components: [buildRumorButtons()],
      });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === "ese-view-stock") {
      const symbol = interaction.values[0];
      const embed = await buildListingEmbed(interaction, symbol);

      if (!embed) {
        return interaction.reply({
          content: "That stock could not be found.",
          flags: MessageFlags.Ephemeral,
        });
      }

      return interaction.update({
        embeds: [embed],
        components: [await buildMenu(), buildListingButtons(symbol)],
      });
    }

    if (interaction.isButton() && interaction.customId.startsWith("ese-buy:")) {
      const symbol = interaction.customId.split(":")[1];
      return interaction.showModal(buildTradeModal("buy", symbol));
    }

    if (interaction.isButton() && interaction.customId.startsWith("ese-sell:")) {
      const symbol = interaction.customId.split(":")[1];
      return interaction.showModal(buildTradeModal("sell", symbol));
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith("ese-trade-modal:")) {
      const [, side, symbol] = interaction.customId.split(":");
      const rawShares = interaction.fields.getTextInputValue("shares");
      const shares = Number(rawShares);

      if (!Number.isFinite(shares) || shares <= 0) {
        return interaction.reply({
          content: "Enter a valid share amount greater than 0.",
          flags: MessageFlags.Ephemeral,
        });
      }

      const cooldown = await getTradeCooldown(interaction.guildId, interaction.user.id);
      if (cooldown) {
        const ts = Math.floor(cooldown / 1000);
        return interaction.reply({
          content: `You need to wait until <t:${ts}:T> before making another ESE trade.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      const company = await getCompany(symbol);
      if (!company) {
        return interaction.reply({
          content: "That stock could not be found.",
          flags: MessageFlags.Ephemeral,
        });
      }

      const feeRate = getTradeFeeRate();
      const gross = Number((shares * Number(company.price)).toFixed(2));
      const fee = Number((gross * feeRate).toFixed(2));

      if (side === "buy") {
        const total = Number((gross + fee).toFixed(2));
        const wallet = await getWalletBalance(interaction.guildId, interaction.user.id);

        if (wallet < total) {
          return interaction.reply({
            content: `You need ${money(total)} to buy ${formatShares(shares)} ${symbol} shares, including ${money(fee)} in fees.`,
            flags: MessageFlags.Ephemeral,
          });
        }

        const debit = await tryDebitUser(
          interaction.guildId,
          interaction.user.id,
          Math.round(total),
          "ese_buy",
          { symbol, shares, gross, fee, price: company.price }
        );

        if (!debit?.ok) {
          return interaction.reply({
            content: "Your wallet could not cover that trade.",
            flags: MessageFlags.Ephemeral,
          });
        }

        await applyBuy(
          interaction.guildId,
          interaction.user.id,
          symbol,
          shares,
          company.price
        );
        await recordStockContractProgress(interaction.guildId, interaction.user.id, gross);

        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x2ecc71)
              .setTitle(`✅ Bought ${symbol}`)
              .setThumbnail(config.logo)
              .setDescription(
                `You bought **${formatShares(shares)}** shares of **${symbol}** at **${money(company.price)}** each.`
              )
              .addFields(
                { name: "Gross", value: money(gross), inline: true },
                { name: "Fee", value: money(fee), inline: true },
                { name: "Total", value: money(total), inline: true }
              ),
          ],
          flags: MessageFlags.Ephemeral,
        });
      }

      const holding = await getUserHolding(interaction.guildId, interaction.user.id, symbol);
      if (!holding || Number(holding.shares) < shares) {
        return interaction.reply({
          content: `You do not own enough ${symbol} shares to sell that amount.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      const payout = Number((gross - fee).toFixed(2));
      await applySell(
        interaction.guildId,
        interaction.user.id,
        symbol,
        shares,
        company.price
      );

      await creditUser(
        interaction.guildId,
        interaction.user.id,
        Math.round(payout),
        "ese_sell",
        { symbol, shares, gross, fee, price: company.price }
      );
      await recordStockContractProgress(interaction.guildId, interaction.user.id, gross);

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xe67e22)
            .setTitle(`💸 Sold ${symbol}`)
            .setThumbnail(config.logo)
            .setDescription(
              `You sold **${formatShares(shares)}** shares of **${symbol}** at **${money(company.price)}** each.`
            )
            .addFields(
              { name: "Gross", value: money(gross), inline: true },
              { name: "Fee", value: money(fee), inline: true },
              { name: "Payout", value: money(payout), inline: true }
            ),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
