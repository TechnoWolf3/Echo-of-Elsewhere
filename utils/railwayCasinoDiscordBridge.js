const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require("discord.js");
const appLinking = require("./appLinking");
const guildConfig = require("./guildConfig");
const mobileCasinoTables = require("./mobileCasinoTables");

const PREFIX = "railcasino";

function gameName(gameType) {
  if (gameType === "higher_lower") return "Higher or Lower";
  if (gameType === "blackjack") return "Blackjack";
  return String(gameType || "Casino").replace(/_/g, " ");
}

function compactId(action, gameType, tableId) {
  return `${PREFIX}:${action}:${gameType}:${tableId}`;
}

async function discordCtx(interaction) {
  const displayName = interaction.member?.displayName || interaction.user?.globalName || interaction.user?.username || "Echo Player";
  return appLinking.getOrCreateDiscordContext({
    discordUserId: interaction.user.id,
    displayName,
    guildId: interaction.guildId,
  });
}

function money(n) {
  return `$${Number(n || 0).toLocaleString()}`;
}

function cardLabel(card) {
  if (!card) return "None";
  return `${card.rank}${card.suit ? ` of ${card.suit}` : ""}`;
}

function playerLine(player, gameType) {
  const paid = player.paid ? money(player.bet) : "unpaid";
  if (gameType === "higher_lower") {
    const pick = player.pick ? `, pick: ${player.pick}` : "";
    return `${player.seatIndex + 1}. ${player.displayName} - ${player.status}, ${paid}, streak ${player.streak || 0}${pick}`;
  }
  const hand = player.hands?.[player.activeHandIndex || 0];
  const handText = hand ? `, hand ${hand.value}` : "";
  return `${player.seatIndex + 1}. ${player.displayName} - ${player.status}, ${paid}${handText}`;
}

function tableEmbed(table, notice = null) {
  const isHl = table.gameType === "higher_lower";
  const title = `${gameName(table.gameType)} Table`;
  const lines = [
    `Host: ${table.hostDisplayName || table.hostUserId || "Unknown"}`,
    `Status: ${table.status}`,
    `Players: ${(table.players || []).length}/${table.maxPlayers || 10}`,
  ];

  if (isHl) {
    lines.push(`Current card: ${cardLabel(table.currentCard)}`);
    if (table.lastResult?.toCard) lines.push(`Last draw: ${cardLabel(table.lastResult.fromCard)} -> ${cardLabel(table.lastResult.toCard)}`);
  } else {
    const dealer = table.dealer;
    if (dealer) lines.push(`Dealer: ${(dealer.visibleCards || []).map(cardLabel).join(", ")}${dealer.hiddenCount ? ` (+${dealer.hiddenCount} hidden)` : ""}`);
    if (table.currentTurn?.userId) {
      const current = table.players?.find((p) => p.userId === table.currentTurn.userId);
      lines.push(`Turn: ${current?.displayName || table.currentTurn.userId}`);
    }
  }

  const embed = new EmbedBuilder()
    .setColor(table.status === "resolved" ? 0x6f8f72 : 0x7b61ff)
    .setTitle(title)
    .setDescription(lines.join("\n"))
    .addFields({
      name: "Players",
      value: (table.players || []).map((p) => playerLine(p, table.gameType)).join("\n").slice(0, 1024) || "No players yet.",
    })
    .setFooter({ text: `Railway table ${table.tableId}` })
    .setTimestamp();

  if (notice) embed.addFields({ name: "Update", value: String(notice).slice(0, 1024) });
  if (table.resultSummary?.length) {
    embed.addFields({
      name: "Results",
      value: table.resultSummary.map((r) => `${r.displayName}: ${money(r.totalPayout)} (${r.profit >= 0 ? "+" : ""}${money(r.profit)})`).join("\n").slice(0, 1024),
    });
  }
  return embed;
}

function actionRows(table) {
  const disabled = ["resolved", "closed", "expired"].includes(table.status);
  const rows = [];

  if (table.status === "lobby") {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(compactId("join", table.gameType, table.tableId)).setLabel("Join Table").setStyle(ButtonStyle.Primary).setDisabled(disabled),
      new ButtonBuilder().setCustomId(compactId("bet500", table.gameType, table.tableId)).setLabel("Bet $500").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
      new ButtonBuilder().setCustomId(compactId("start", table.gameType, table.tableId)).setLabel("Start").setStyle(ButtonStyle.Success).setDisabled(disabled),
      new ButtonBuilder().setCustomId(compactId("leave", table.gameType, table.tableId)).setLabel("Leave").setStyle(ButtonStyle.Danger).setDisabled(disabled)
    ));
    return rows;
  }

  if (table.status === "playing" && table.gameType === "higher_lower") {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(compactId("higher", table.gameType, table.tableId)).setLabel("Higher").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(compactId("lower", table.gameType, table.tableId)).setLabel("Lower").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(compactId("same", table.gameType, table.tableId)).setLabel("Same").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(compactId("cashout", table.gameType, table.tableId)).setLabel("Cash Out").setStyle(ButtonStyle.Success)
    ));
  }

  if (table.status === "playing" && table.gameType === "blackjack") {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(compactId("hit", table.gameType, table.tableId)).setLabel("Hit").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(compactId("stand", table.gameType, table.tableId)).setLabel("Stand").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(compactId("double", table.gameType, table.tableId)).setLabel("Double").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(compactId("split", table.gameType, table.tableId)).setLabel("Split").setStyle(ButtonStyle.Secondary)
    ));
  }

  return rows;
}

function messagePayload(table, notice = null, content = null) {
  return {
    content,
    embeds: [tableEmbed(table, notice)],
    components: actionRows(table),
  };
}

async function resolveAnnouncementChannel(client, guildId) {
  const envId = process.env.ECHO_CASINO_CHANNEL_ID || process.env.ECHO_GAMES_CHANNEL_ID || process.env.GAMES_CHANNEL_ID;
  if (envId) {
    const channel = await client.channels.fetch(String(envId)).catch(() => null);
    if (channel?.isTextBased?.()) return channel;
  }
  const botChannel = await guildConfig.resolveGuildTextChannel(client, guildId, "bot_channel_id");
  if (botChannel) return botChannel;
  return guildConfig.resolveGuildTextChannel(client, guildId, "feature_hub_channel_id");
}

async function announceTable(client, table, ctx) {
  if (!client || !table?.tableId || !ctx?.guildId) return { posted: false, reason: "Discord client or guild missing." };
  const channel = await resolveAnnouncementChannel(client, ctx.guildId);
  if (!channel) return { posted: false, reason: "No casino/games channel configured." };
  const content = `${table.hostDisplayName || ctx.displayName || "Someone"} has started a ${gameName(table.gameType)} table.`;
  const message = await channel.send(messagePayload(table, null, content));
  await mobileCasinoTables.setDiscordMessage(table.tableId, channel.id, message.id);
  return { posted: true, channelId: channel.id, messageId: message.id };
}

async function startTableFromDiscord(interaction, gameType) {
  if (!interaction.inGuild?.() || !interaction.channel?.send) {
    await interaction.reply({ content: "Casino tables can only be created inside a server channel.", ephemeral: true }).catch(() => {});
    return true;
  }
  const ctx = await discordCtx(interaction);
  const result = await mobileCasinoTables.createTable(ctx, gameType, { source: "discord" });
  if (!result.ok) {
    const payload = { content: result.message || "Railway could not create that table.", ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => {});
    else await interaction.reply(payload).catch(() => {});
    return true;
  }

  const content = `${result.body.hostDisplayName || ctx.displayName || "Someone"} has started a ${gameName(gameType)} table.`;
  const message = await interaction.channel.send(messagePayload(result.body, null, content));
  await mobileCasinoTables.setDiscordMessage(result.body.tableId, interaction.channel.id, message.id);
  const refreshed = await mobileCasinoTables.getTable(ctx, gameType, result.body.tableId);
  if (refreshed.ok) await message.edit(messagePayload(refreshed.body, null, content)).catch(() => {});

  const ack = { content: "Railway table created. It is now visible to the app and Discord.", ephemeral: true };
  if (interaction.deferred || interaction.replied) await interaction.followUp(ack).catch(() => {});
  else await interaction.reply(ack).catch(() => {});
  return true;
}

async function updateTableMessage(client, table, notice = null) {
  if (!client || !table?.discordChannelId || !table?.discordMessageId) return false;
  const channel = await client.channels.fetch(table.discordChannelId).catch(() => null);
  if (!channel?.messages?.fetch) return false;
  const message = await channel.messages.fetch(table.discordMessageId).catch(() => null);
  if (!message) return false;
  await message.edit(messagePayload(table, notice, null));
  return true;
}

async function dispatch(ctx, gameType, tableId, action) {
  if (action === "join") return mobileCasinoTables.joinTable(ctx, gameType, tableId);
  if (action === "leave") return mobileCasinoTables.leaveTable(ctx, gameType, tableId);
  if (action === "bet500") return mobileCasinoTables.setTableBet(ctx, gameType, tableId, 500);
  if (action === "start") return gameType === "higher_lower"
    ? mobileCasinoTables.startHigherLower(ctx, tableId)
    : mobileCasinoTables.startBlackjack(ctx, tableId);
  if (gameType === "higher_lower" && ["higher", "lower", "same"].includes(action)) return mobileCasinoTables.guessHigherLower(ctx, tableId, action);
  if (gameType === "higher_lower" && action === "cashout") return mobileCasinoTables.cashoutHigherLower(ctx, tableId);
  if (gameType === "blackjack" && ["hit", "stand", "double", "split"].includes(action)) return mobileCasinoTables.bjAction(ctx, tableId, action);
  return { ok: false, statusCode: 400, message: "Unknown table action." };
}

async function handleInteraction(interaction) {
  if (!interaction.isButton?.() || !String(interaction.customId || "").startsWith(`${PREFIX}:`)) return false;
  const [, action, gameType, tableId] = String(interaction.customId).split(":");
  await interaction.deferReply({ ephemeral: true });
  try {
    const ctx = await discordCtx(interaction);
    const result = await dispatch(ctx, gameType, tableId, action);
    if (!result.ok) {
      await interaction.editReply({ content: result.message || "That table action failed." });
      return true;
    }
    await updateTableMessage(interaction.client, result.body, `${interaction.member?.displayName || interaction.user.username}: ${action}`);
    await interaction.editReply({ content: "Railway table updated." });
    return true;
  } catch (error) {
    console.error("[railcasino] interaction failed:", error);
    await interaction.editReply({ content: "Railway could not handle that table action." }).catch(() => {});
    return true;
  }
}

module.exports = {
  announceTable,
  startTableFromDiscord,
  updateTableMessage,
  handleInteraction,
  messagePayload,
  gameName,
};
