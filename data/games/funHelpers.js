const crypto = require('crypto');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} = require('discord.js');
const { setActiveGame, clearActiveGame, updateActiveGame } = require('../../utils/gamesHubState');
const { guardGamesComponent } = require('../../utils/echoRift/curseGuard');
const { guardNotJailedComponent } = require('../../utils/jail');

function gameId(prefix = 'fun') {
  return `${prefix}_${crypto.randomBytes(4).toString('hex')}`;
}

function normalizeText(input) {
  return String(input || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function mention(userId) {
  return `<@${userId}>`;
}

function closeRow(customId, label = 'Close Game') {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(ButtonStyle.Secondary)
  );
}

function resultRow({ againId, returnId, closeId, againLabel = 'Play Again' }) {
  const row = new ActionRowBuilder();
  if (againId) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(againId)
        .setLabel(againLabel)
        .setEmoji('🔁')
        .setStyle(ButtonStyle.Primary)
    );
  }
  if (returnId) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(returnId)
        .setLabel('Return')
        .setEmoji('↩️')
        .setStyle(ButtonStyle.Secondary)
    );
  }
  if (closeId) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(closeId)
        .setLabel('Close')
        .setEmoji('🗑️')
        .setStyle(ButtonStyle.Danger)
    );
  }
  return row;
}

async function returnToFunHub(interaction, message) {
  try {
    const gamesCmd = require('../../commands/games');
    if (typeof gamesCmd.showFunCategory !== 'function') return false;
    await gamesCmd.showFunCategory(interaction, message);
    return true;
  } catch (err) {
    console.warn('[FUN GAMES] returnToFunHub failed:', err?.message || err);
    return false;
  }
}

async function getOrReuseMessage(interaction, reuseMessage, payload) {
  if (reuseMessage) {
    try {
      await reuseMessage.edit(payload);
      return reuseMessage;
    } catch {}
  }
  return interaction.channel.send(payload);
}

async function safeReply(interaction, payload) {
  try {
    if (interaction.deferred || interaction.replied) return await interaction.followUp(payload);
    return await interaction.reply(payload);
  } catch {}
  return null;
}

function canControl(member, ownerId) {
  return (
    member?.id === ownerId ||
    member?.permissions?.has?.(PermissionFlagsBits.ManageChannels) ||
    member?.permissions?.has?.(PermissionFlagsBits.Administrator)
  );
}

async function guardGameButton(interaction) {
  if (await guardNotJailedComponent(interaction)) return true;
  if (await guardGamesComponent(interaction)) return true;
  return false;
}

function startActive(channelId, key, state, extra = {}) {
  setActiveGame(channelId, { key, type: key, state, ...extra });
}

function patchActive(channelId, patch) {
  return updateActiveGame(channelId, patch);
}

function endActive(channelId) {
  clearActiveGame(channelId);
}

function buildStandardEmbed({ title, description, footer }) {
  const embed = new EmbedBuilder().setTitle(title).setDescription(description);
  if (footer) embed.setFooter({ text: footer });
  return embed;
}

module.exports = {
  gameId,
  normalizeText,
  pick,
  mention,
  closeRow,
  resultRow,
  returnToFunHub,
  getOrReuseMessage,
  safeReply,
  canControl,
  guardGameButton,
  startActive,
  patchActive,
  endActive,
  buildStandardEmbed,
  MessageFlags,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  EmbedBuilder,
};
