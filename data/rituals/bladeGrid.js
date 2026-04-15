const crypto = require('crypto');
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');

const ui = require('../../utils/ui');
const { pool } = require('../../utils/db');
const { getRitualStatus, nextSydneyMidnightUTC, getSydneyParts } = require('../../utils/rituals');
const { creditUserWithEffects } = require('../../utils/effectSystem');

const BTN_PREFIX = 'rituals:blade_grid:tile:';
const ROWS = 3;
const COLS = 5;
const TILE_COUNT = ROWS * COLS;
const SESSION_TTL_MS = 20 * 60 * 1000;
const CLEANUP_AFTER_COMPLETE_MS = 60 * 1000;
const WIN_REWARD_MIN = 12000;
const WIN_REWARD_MAX = 18000;

const sessions = new Map();

const FLAVOR = {
  intro: [
    'Fifteen tiles lie before you. Pick one and stand your ground.',
    'A steel lattice rises from the floor. Choose your square carefully.',
    'The grid hums beneath your feet. One choice now decides the rest.',
    'Echo marks out the arena. You only get one place to stand.',
  ],
  selected: [
    'You steady yourself and refuse to move.',
    'You plant your feet and wait for the strike.',
    'The grid goes still around you.',
    'The chamber falls silent as you take your place.',
  ],
  survive: [
    'The blades miss you by inches. The grid falls silent.',
    'Steel flashes past, but your square remains untouched.',
    'The strike passes cleanly around you. You survive.',
    'The chamber exhales. Somehow, you are still standing.',
  ],
  hit: [
    'The blades cross through your square without mercy.',
    'Steel tears through the tile you chose. Bad call.',
    'Echo does not flinch as the strike finds you.',
    'You hear the blades before you feel the mistake.',
  ],
};

function sessionKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function getSydneyDateKey(date = new Date()) {
  const parts = getSydneyParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function hashHex(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

function seededNumber(seed, salt, min, max) {
  const range = Math.max(1, (max - min) + 1);
  const hex = hashHex(`${seed}:${salt}`).slice(0, 12);
  const value = parseInt(hex, 16);
  return min + (value % range);
}

function pickFrom(list, session, category) {
  if (!Array.isArray(list) || !list.length) return '';
  const index = seededNumber(session.seedBase, `${category}:${session.history.length}:${session.updatedAt}`, 0, list.length - 1);
  return list[index] || list[0] || '';
}

function randomInt(min, max) {
  const lo = Math.floor(Number(min || 0));
  const hi = Math.floor(Number(max || 0));
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return 0;
  if (hi <= lo) return lo;
  return Math.floor(lo + Math.random() * (hi - lo + 1));
}

function pruneSessions() {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [key, session] of sessions.entries()) {
    if (!session || Number(session.updatedAt || 0) < cutoff) {
      if (session?.messageId) scheduleDelete(session.client, session.channelId, session.messageId, 5000);
      sessions.delete(key);
    }
  }
}

function getSession(guildId, userId) {
  pruneSessions();
  return sessions.get(sessionKey(guildId, userId)) || null;
}

function setSession(session) {
  session.updatedAt = Date.now();
  sessions.set(sessionKey(session.guildId, session.userId), session);
  return session;
}

function clearSession(guildId, userId) {
  sessions.delete(sessionKey(guildId, userId));
}

async function setCooldown(guildId, userId, nextClaimAt) {
  await pool.query(
    `INSERT INTO cooldowns (guild_id, user_id, key, next_claim_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (guild_id, user_id, key) DO UPDATE SET next_claim_at = EXCLUDED.next_claim_at`,
    [String(guildId), String(userId), 'blade_grid', nextClaimAt]
  );
}

function createSession(guildId, userId, channelId) {
  const dateKey = getSydneyDateKey();
  const seedBase = `blade_grid:${userId}:${dateKey}`;
  return {
    guildId,
    userId,
    channelId,
    dateKey,
    seedBase,
    client: null,
    messageId: null,
    history: [],
    selectedTile: null,
    selectedRow: null,
    selectedCol: null,
    strikeRow: null,
    strikeCol: null,
    finished: false,
    cleanupScheduled: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function tileNumberToCoords(tileNumber) {
  const zeroBased = Number(tileNumber) - 1;
  return {
    row: Math.floor(zeroBased / COLS),
    col: zeroBased % COLS,
  };
}

function formatTileNumber(row, col) {
  return String((row * COLS) + col + 1).padStart(2, '0');
}

function renderBoard(session, reveal = false) {
  const lines = [];
  for (let row = 0; row < ROWS; row += 1) {
    const cells = [];
    for (let col = 0; col < COLS; col += 1) {
      const isPlayer = session.selectedRow === row && session.selectedCol === col;
      const inStrike = reveal && (session.strikeRow === row || session.strikeCol === col);
      let symbol = formatTileNumber(row, col);

      if (reveal) {
        if (isPlayer && inStrike) symbol = '💀';
        else if (isPlayer) symbol = '🧍';
        else if (inStrike) symbol = '⚔️';
      } else if (isPlayer) {
        symbol = '🧍';
      }

      cells.push(symbol);
    }
    lines.push(cells.join(' '));
  }
  return `\`${lines.join('\n')}\``;
}

function buildGridRows(session, disabled = false) {
  const rows = [];
  for (let row = 0; row < ROWS; row += 1) {
    rows.push(
      new ActionRowBuilder().addComponents(
        Array.from({ length: COLS }, (_, idx) => {
          const tile = (row * COLS) + idx + 1;
          const selected = session.selectedTile === tile;
          return new ButtonBuilder()
            .setCustomId(`${BTN_PREFIX}${tile}`)
            .setLabel(String(tile))
            .setStyle(selected ? ButtonStyle.Success : ButtonStyle.Secondary)
            .setDisabled(disabled || session.finished);
        })
      )
    );
  }
  return rows;
}

function buildIntroEmbed(session, latestLine = null) {
  const embed = new EmbedBuilder()
    .setTitle('⚔️ Blade Grid')
    .setDescription(pickFrom(FLAVOR.intro, session, 'intro'))
    .addFields(
      { name: 'Grid', value: renderBoard(session, false) },
      { name: 'Rule', value: 'Choose **1** square. One blade will strike an entire **row** and another will strike an entire **column**. If either line crosses your square, you lose.' },
      { name: 'Reward', value: `Survive to earn **${ui.money(WIN_REWARD_MIN)}–${ui.money(WIN_REWARD_MAX)}**.`, inline: true },
      { name: 'Limit', value: 'Once per Sydney day.', inline: true },
    );

  if (latestLine) embed.addFields({ name: 'Latest Echo', value: String(latestLine).slice(0, 1024) });
  ui.applySystemStyle(embed, 'rituals');
  return embed;
}

function buildResultEmbed(session, hit, payoutAmount = 0, awardNotice = '') {
  const struckTile = String((session.strikeRow * COLS) + session.strikeCol + 1);
  const playerTile = String(session.selectedTile);
  const outcomeLine = hit
    ? pickFrom(FLAVOR.hit, session, 'hit')
    : pickFrom(FLAVOR.survive, session, 'survive');

  const embed = new EmbedBuilder()
    .setTitle(`⚔️ Blade Grid — ${hit ? 'Struck Down' : 'Safe Passage'}`)
    .setDescription([pickFrom(FLAVOR.selected, session, 'selected'), '', outcomeLine].join('\n'))
    .addFields(
      { name: 'Revealed Grid', value: renderBoard(session, true) },
      {
        name: 'Strike Pattern',
        value: `Horizontal blade: **Row ${session.strikeRow + 1}**\nVertical blade: **Column ${session.strikeCol + 1}**\nIntersection: **Tile ${struckTile}**`,
        inline: true,
      },
      {
        name: 'Your Square',
        value: `Tile **${playerTile}** (Row **${session.selectedRow + 1}**, Column **${session.selectedCol + 1}**)`,
        inline: true,
      },
      {
        name: 'Outcome',
        value: hit ? '💀 **Hit.** No payout this time.' : `💰 **Survived.** ${ui.money(payoutAmount)} added to your wallet.`,
      }
    );

  if (awardNotice) embed.addFields({ name: 'Echo’s Aftertaste', value: String(awardNotice).slice(0, 1024) });
  ui.applySystemStyle(embed, 'rituals');
  return embed;
}

function scheduleDelete(client, channelId, messageId, delayMs = CLEANUP_AFTER_COMPLETE_MS) {
  if (!client || !channelId || !messageId) return;
  setTimeout(async () => {
    try {
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel?.messages?.fetch) return;
      const message = await channel.messages.fetch(messageId).catch(() => null);
      if (message) await message.delete().catch(() => {});
    } catch (_) {}
  }, delayMs);
}

async function editSessionMessage(interaction, session, payload) {
  const message = await interaction.channel.messages.fetch(session.messageId).catch(() => null);
  if (!message) return false;
  await message.edit(payload).catch(() => {});
  return true;
}

module.exports = {
  id: 'blade_grid',
  placement: 'other',
  interactive: true,
  type: 'blade_grid',
  awardSource: 'blade_grid',
  cooldownKey: 'blade_grid',
  name: 'Blade Grid',
  shortName: 'Blade Grid',
  description: 'Pick one square on a 5x3 grid. One blade strikes a full row and another strikes a full column. Survive both to win.',
  nextClaimAt: nextSydneyMidnightUTC,
  claimText: () => '',
  cooldownText: ({ unix }) => `⏳ **Blade Grid** has already been faced today. Return <t:${unix}:R>.`,
  successEffects: {
    effectsApply: true,
    canAwardEffects: true,
    blockedBlessings: [],
    blockedCurses: [],
    effectAwardPool: {
      nothingWeight: 80,
      blessingWeight: 20,
      curseWeight: 0,
      blessingWeights: {},
      curseWeights: {},
    },
  },

  async begin(interaction) {
    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    const status = await getRitualStatus(guildId, userId, module.exports);

    if (!status.available) {
      await interaction.deferUpdate().catch(() => {});
      await interaction.followUp({
        content: module.exports.cooldownText({ unix: status.unix, nextClaimAt: status.nextClaimAt }),
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return true;
    }

    let session = getSession(guildId, userId);
    if (!session || session.dateKey !== getSydneyDateKey()) {
      session = setSession(createSession(guildId, userId, interaction.channelId));
    }

    if (session.messageId) {
      await interaction.deferUpdate().catch(() => {});
      await interaction.followUp({
        content: '⚔️ Your **Blade Grid** is already open in this channel. Finish it there.',
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return true;
    }

    await interaction.deferUpdate().catch(() => {});
    const message = await interaction.followUp({
      embeds: [buildIntroEmbed(session)],
      components: buildGridRows(session),
      fetchReply: true,
    }).catch(() => null);

    session.messageId = message?.id || null;
    session.channelId = interaction.channelId;
    session.client = interaction.client;
    setSession(session);
    return true;
  },

  async handleInteraction(interaction) {
    const cid = String(interaction.customId || '');
    if (!interaction.isButton?.() || !cid.startsWith(BTN_PREFIX)) return false;

    if (!interaction.inGuild()) {
      await interaction.reply({ content: '❌ Server only.', flags: MessageFlags.Ephemeral }).catch(() => {});
      return true;
    }

    const tile = Number(cid.slice(BTN_PREFIX.length));
    if (!Number.isInteger(tile) || tile < 1 || tile > TILE_COUNT) return false;

    const ownerSession = getSession(interaction.guildId, interaction.user.id);
    const ownerMatch = ownerSession && ownerSession.messageId === interaction.message?.id;

    if (!ownerMatch) {
      let matchedOwner = null;
      for (const session of sessions.values()) {
        if (session?.guildId === interaction.guildId && session?.messageId === interaction.message?.id) {
          matchedOwner = session;
          break;
        }
      }

      if (!matchedOwner) {
        await interaction.reply({
          content: '❌ That Blade Grid is no longer active. Open a new one from **/rituals**.',
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
        return true;
      }

      await interaction.reply({
        content: `❌ This Blade Grid belongs to <@${matchedOwner.userId}>. Open your own from **/rituals**.`,
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return true;
    }

    const session = ownerSession;
    if (!session) {
      await interaction.reply({
        content: '❌ That Blade Grid session has expired. Open it again from **/rituals**.',
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return true;
    }

    if (session.finished) {
      await interaction.reply({
        content: '❌ That Blade Grid has already resolved.',
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return true;
    }

    const coords = tileNumberToCoords(tile);
    session.selectedTile = tile;
    session.selectedRow = coords.row;
    session.selectedCol = coords.col;
    session.strikeRow = randomInt(0, ROWS - 1);
    session.strikeCol = randomInt(0, COLS - 1);
    session.finished = true;
    session.history.push({ tile, strikeRow: session.strikeRow, strikeCol: session.strikeCol });
    setSession(session);

    const hit = session.selectedRow === session.strikeRow || session.selectedCol === session.strikeCol;
    const nextClaimAt = nextSydneyMidnightUTC();
    await setCooldown(session.guildId, session.userId, nextClaimAt);

    let payout = null;
    if (!hit) {
      const amount = randomInt(WIN_REWARD_MIN, WIN_REWARD_MAX);
      payout = await creditUserWithEffects({
        guildId: session.guildId,
        userId: session.userId,
        amount,
        type: 'blade_grid',
        meta: { ritual: 'blade_grid', reset: 'daily' },
        activityEffects: module.exports.successEffects,
        awardSource: 'blade_grid',
      });
    }

    await interaction.deferUpdate().catch(() => {});
    await editSessionMessage(interaction, session, {
      embeds: [buildResultEmbed(session, hit, payout?.finalAmount || 0, payout?.awardResult?.notice || '')],
      components: buildGridRows(session, true),
    });

    if (!session.cleanupScheduled) {
      session.cleanupScheduled = true;
      scheduleDelete(session.client || interaction.client, session.channelId, session.messageId, CLEANUP_AFTER_COMPLETE_MS);
    }

    clearSession(session.guildId, session.userId);
    return true;
  },
};
