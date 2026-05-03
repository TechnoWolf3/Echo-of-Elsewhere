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
const { nextSydneyMidnightUTC, getRitualStatus, getSydneyParts } = require('../../utils/rituals');
const { creditUserWithEffects } = require('../../utils/effectSystem');

let recordProgress = async () => {};
try {
  ({ recordProgress } = require('../../utils/contracts'));
} catch (_) {}

async function recordRitualContractProgress(guildId, userId, earnings = 0) {
  try {
    await recordProgress({ guildId, userId, metric: 'rituals_completed', amount: 1 });
    const cash = Math.max(0, Math.floor(Number(earnings || 0)));
    if (cash > 0) {
      await recordProgress({ guildId, userId, metric: 'ritual_earnings', amount: cash });
    }
  } catch (_) {}
}

const BTN_PREFIX = 'rituals:veil_sequence:slot:';
const SESSION_TTL_MS = 30 * 60 * 1000;
const CLEANUP_AFTER_COMPLETE_MS = 60 * 1000;
const SLOT_COUNT = 5;

const REWARD_BY_SCORE = {
  5: 85000,
  3: 55000,
  2: 30000,
  1: 12000,
  0: 0,
};

const FLAVOR = {
  open: [
    'Five fragments emerge from the veil. Restore their order.',
    'The sequence arrives fractured. Set each fragment where it belongs.',
    'Echo reveals the pattern in pieces. Decide where each belongs before the whole is known.',
    'Order has been lost. Only the final arrangement will tell whether you understood it.',
    'The veil offers five fragments. Place them without certainty and accept the result.',
  ],
  reveal: [
    'A fragment surfaces: **{number}**',
    'The veil offers: **{number}**',
    'Another piece rises into view: **{number}**',
    'Echo presents the next fragment: **{number}**',
    'The sequence reveals: **{number}**',
  ],
  locked: [
    'The fragment settles into place.',
    'The choice is made.',
    'That position is now sealed.',
    'The veil accepts your placement.',
    'The fragment is fixed where you set it.',
  ],
  invalid: [
    'That position is already claimed.',
    'That place has already been sealed.',
    'A fragment already rests there.',
    'That slot can no longer be chosen.',
  ],
  result: {
    5: [
      'The sequence aligns perfectly.',
      'Order is fully restored.',
      'The veil yields completely.',
      'Every fragment falls into its rightful place.',
    ],
    3: [
      'The veil stabilises… partially.',
      'Some fragments obey your reading of the pattern.',
      'You grasp enough of the sequence to steady it.',
      'The order holds, though not cleanly.',
    ],
    2: [
      'The pattern resists your control.',
      'Only a few fragments align.',
      'The sequence remains unstable in your hands.',
      'The veil gives little away.',
    ],
    1: [
      'Only a single fragment finds its rightful place.',
      'Almost nothing aligns.',
      'The pattern slips from your grasp.',
      'One piece answers you. The rest do not.',
    ],
    0: [
      'The sequence collapses entirely.',
      'Nothing aligns.',
      'The veil rejects your arrangement.',
      'Not a single fragment yields to your reading.',
    ],
  },
  reward: [
    '💰 Echo rewards your effort with **{amount}**.',
    '💰 The veil releases **{amount}** into your wallet.',
    '💰 A reward slips free from the sequence: **{amount}**.',
    '💰 Echo grants **{amount}** for what you restored.',
  ],
  noReward: [
    '💸 No reward emerges from the veil.',
    '💸 Echo offers no payment for this attempt.',
    '💸 The sequence leaves you empty-handed.',
  ],
  expired: [
    'The veil closes before the sequence can be completed.',
    'The fragments fade before you finish arranging them.',
    'The sequence slips away unanswered.',
  ],
};

const sessions = new Map();

function sessionKey(guildId, userId) {
  return `${guildId}:${userId}`;
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

function buildPuzzle(userId, dateKey) {
  const seed = `veil_sequence:${userId}:${dateKey}`;
  const chosen = new Set();
  const numbers = [];

  for (let i = 0; numbers.length < SLOT_COUNT && i < 200; i += 1) {
    const candidate = seededNumber(seed, `num:${i}`, 1, 100);
    if (chosen.has(candidate)) continue;
    chosen.add(candidate);
    numbers.push(candidate);
  }

  const ascending = [...numbers].sort((a, b) => a - b);
  const revealOrder = [...ascending]
    .map((value, idx) => ({ value, sortKey: seededNumber(seed, `reveal:${idx}:${value}`, 1, 1000000) }))
    .sort((a, b) => a.sortKey - b.sortKey)
    .map((entry) => entry.value);

  return {
    dateKey,
    ascending,
    revealOrder,
  };
}

function pickFrom(list, session, category, fallback = '') {
  if (!Array.isArray(list) || !list.length) return fallback;
  const index = seededNumber(session.seedBase, `${category}:${session.step}:${session.history.length}`, 0, list.length - 1);
  return list[index] || fallback;
}

function boardLine(placements = []) {
  return `[${placements.map((value) => (value == null ? '   ' : String(value).padStart(2, ' '))).join('] [')}]`;
}

function availableSlotsRow(session, disabled = false) {
  return new ActionRowBuilder().addComponents(
    Array.from({ length: SLOT_COUNT }, (_, idx) => {
      const slot = idx + 1;
      const occupied = session.placements[idx] != null;
      return new ButtonBuilder()
        .setCustomId(`${BTN_PREFIX}${slot}`)
        .setLabel(String(slot))
        .setStyle(occupied ? ButtonStyle.Secondary : ButtonStyle.Primary)
        .setDisabled(disabled || occupied);
    })
  );
}

function buildEmbed(session, latestLine = null, finished = false) {
  const activeNumber = session.revealOrder[session.step] ?? null;
  const remaining = Math.max(0, SLOT_COUNT - session.step);

  const embed = new EmbedBuilder()
    .setTitle('🔮 Veil Sequence')
    .setDescription(pickFrom(FLAVOR.open, session, 'open', FLAVOR.open[0]))
    .addFields(
      { name: 'Your Order', value: `\`${boardLine(session.placements)}\`` },
      {
        name: finished ? 'Sequence Complete' : 'Current Fragment',
        value: finished
          ? 'All fragments have been placed. The veil now reveals the truth.'
          : pickFrom(FLAVOR.reveal, session, 'reveal', FLAVOR.reveal[0]).replace('{number}', String(activeNumber)),
      },
      {
        name: 'Progress',
        value: `Placed: **${session.step}/${SLOT_COUNT}**\nRemaining: **${remaining}**`,
        inline: true,
      },
      {
        name: 'Rule',
        value: 'Place each number into slots **1–5** in ascending order. Once placed, it cannot be moved.',
        inline: true,
      }
    );

  if (latestLine) {
    embed.addFields({ name: 'Latest Echo', value: String(latestLine).slice(0, 1024) });
  }

  ui.applySystemStyle(embed, 'rituals');
  return embed;
}

function createSession(guildId, userId, channelId) {
  const dateKey = getSydneyDateKey();
  const puzzle = buildPuzzle(userId, dateKey);
  return {
    guildId,
    userId,
    channelId,
    dateKey,
    seedBase: `veil_sequence:${userId}:${dateKey}`,
    ascending: puzzle.ascending,
    revealOrder: puzzle.revealOrder,
    placements: new Array(SLOT_COUNT).fill(null),
    client: null,
    history: [],
    step: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messageId: null,
    cleanupScheduled: false,
    finished: false,
  };
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
    [String(guildId), String(userId), 'veil_sequence', nextClaimAt]
  );
}

function scorePlacements(placements, ascending) {
  let correct = 0;
  for (let i = 0; i < SLOT_COUNT; i += 1) {
    if (placements[i] === ascending[i]) correct += 1;
  }
  return correct;
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

async function finishSession(interaction, session) {
  const correct = scorePlacements(session.placements, session.ascending);
  const amount = REWARD_BY_SCORE[correct] || 0;
  const nextClaimAt = nextSydneyMidnightUTC();

  await setCooldown(session.guildId, session.userId, nextClaimAt);

  let payout = null;
  if (amount > 0) {
    payout = await creditUserWithEffects({
      guildId: session.guildId,
      userId: session.userId,
      amount,
      type: 'veil_sequence',
      meta: { ritual: 'veil_sequence', reset: 'daily', score: correct },
      activityEffects: module.exports.successEffects,
      awardSource: 'veil_sequence',
    });
  }

  await recordRitualContractProgress(session.guildId, session.userId, payout?.finalAmount || 0);

  session.finished = true;
  const resultLine = pickFrom(FLAVOR.result[correct] || FLAVOR.result[0], session, `result:${correct}`);
  const rewardLine = amount > 0
    ? pickFrom(FLAVOR.reward, session, `reward:${correct}`).replace('{amount}', ui.money(payout?.finalAmount || amount))
    : pickFrom(FLAVOR.noReward, session, `noreward:${correct}`);

  const finalEmbed = new EmbedBuilder()
    .setTitle('🔮 Veil Sequence')
    .setDescription(resultLine)
    .addFields(
      { name: 'Your Order', value: `\`${boardLine(session.placements)}\`` },
      { name: 'Correct Order', value: `\`${boardLine(session.ascending)}\`` },
      { name: 'Correct Positions', value: `**${correct} / ${SLOT_COUNT}**` },
      { name: 'Payout', value: rewardLine }
    );

  ui.applySystemStyle(finalEmbed, 'rituals');

  await editSessionMessage(interaction, session, {
    embeds: [finalEmbed],
    components: [availableSlotsRow(session, true)],
  });

  if (!session.cleanupScheduled) {
    session.cleanupScheduled = true;
    scheduleDelete(session.client || interaction.client, session.channelId, session.messageId, CLEANUP_AFTER_COMPLETE_MS);
  }

  clearSession(session.guildId, session.userId);
  return true;
}

module.exports = {
  id: 'veil_sequence',
  placement: 'other',
  interactive: true,
  type: 'veil_sequence',
  awardSource: 'veil_sequence',
  cooldownKey: 'veil_sequence',
  name: 'Veil Sequence',
  shortName: 'Veil Sequence',
  description: 'Arrange five revealed numbers into ascending order. Each placement locks permanently. Public, daily, and unique per player.',
  nextClaimAt: nextSydneyMidnightUTC,
  claimText: () => '',
  cooldownText: ({ unix }) => `⏳ **Veil Sequence** has already been completed. Return <t:${unix}:R>.`,
  successEffects: {
    effectsApply: true,
    canAwardEffects: true,
    blockedBlessings: [],
    blockedCurses: [],
    effectAwardPool: {
      nothingWeight: 70,
      blessingWeight: 30,
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
        content: '🔮 Your **Veil Sequence** is already open in this channel. Continue it there.',
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return true;
    }

    await interaction.deferUpdate().catch(() => {});
    const message = await interaction.followUp({
      embeds: [buildEmbed(session)],
      components: [availableSlotsRow(session)],
      fetchReply: true,
    }).catch(() => null);

    const createdMessage = message;
    session.messageId = createdMessage?.id || null;
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

    const slot = Number(cid.slice(BTN_PREFIX.length));
    if (!Number.isInteger(slot) || slot < 1 || slot > SLOT_COUNT) return false;

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
          content: '❌ That Veil Sequence is no longer active. Open a new one from **/rituals**.',
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
        return true;
      }

      await interaction.reply({
        content: `❌ This Veil Sequence belongs to <@${matchedOwner.userId}>. Open your own from **/rituals**.`,
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return true;
    }

    const session = ownerSession;
    if (!session) {
      await interaction.reply({
        content: '❌ That Veil Sequence session has expired. Open it again from **/rituals**.',
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return true;
    }

    if (session.placements[slot - 1] != null) {
      await interaction.reply({
        content: pickFrom(FLAVOR.invalid, session, 'invalid', FLAVOR.invalid[0]),
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return true;
    }

    const number = session.revealOrder[session.step];
    if (number == null) {
      await interaction.reply({
        content: '❌ There is no active fragment to place right now.',
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return true;
    }

    session.placements[slot - 1] = number;
    session.history.push({ step: session.step, number, slot });
    session.step += 1;
    setSession(session);

    await interaction.deferUpdate().catch(() => {});

    if (session.step >= SLOT_COUNT) {
      return finishSession(interaction, session);
    }

    await editSessionMessage(interaction, session, {
      embeds: [buildEmbed(session, pickFrom(FLAVOR.locked, session, 'locked', FLAVOR.locked[0]))],
      components: [availableSlotsRow(session)],
    });
    return true;
  },
};
