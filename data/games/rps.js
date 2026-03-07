const {
  gameId,
  getOrReuseMessage,
  safeReply,
  canControl,
  guardGameButton,
  startActive,
  endActive,
  buildStandardEmbed,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  mention,
} = require('./funHelpers');

const CHOICES = {
  rock: { label: 'Rock', emoji: '🪨' },
  paper: { label: 'Paper', emoji: '📄' },
  scissors: { label: 'Scissors', emoji: '✂️' },
};

function winner(a, b) {
  if (a === b) return 'draw';
  if ((a === 'rock' && b === 'scissors') || (a === 'paper' && b === 'rock') || (a === 'scissors' && b === 'paper')) return 'a';
  return 'b';
}

async function startFromHub(interaction, opts = {}) {
  const opponent = interaction.guild.members.cache.filter((m) => !m.user.bot && m.id !== interaction.user.id).first();
  if (!opponent) {
    await safeReply(interaction, { content: '❌ I need at least one other human in the server for multiplayer RPS.', flags: MessageFlags.Ephemeral });
    return null;
  }

  const sessionId = gameId('rps');
  const acceptId = `${sessionId}:accept`;
  const declineId = `${sessionId}:decline`;
  const closeId = `${sessionId}:close`;
  const chooseIds = {
    rock: `${sessionId}:rock`,
    paper: `${sessionId}:paper`,
    scissors: `${sessionId}:scissors`,
  };

  const players = { a: interaction.user.id, b: opponent.id };
  const picks = new Map();
  let phase = 'challenge';
  let ended = false;

  startActive(interaction.channelId, 'rps', 'challenge', { startedBy: interaction.user.id, opponentId: opponent.id, sessionId });

  const message = await getOrReuseMessage(interaction, opts.reuseMessage, {
    embeds: [buildStandardEmbed({
      title: '🪨📄✂️ Rock Paper Scissors',
      description: `${mention(players.a)} has challenged ${mention(players.b)}.\n\n${mention(players.b)}, accept or decline the duel.`,
    })],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(acceptId).setLabel('Accept').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(declineId).setLabel('Decline').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(closeId).setLabel('Close').setStyle(ButtonStyle.Secondary),
      ),
    ],
  });

  const collector = message.createMessageComponentCollector({ time: 5 * 60_000 });

  async function finish(reason) {
    if (ended) return;
    ended = true;
    collector.stop(reason);
    endActive(interaction.channelId);
    let description = '🛑 Game closed.';
    if (reason === 'declined') description = `${mention(players.b)} declined the challenge.`;
    if (reason === 'timeout') description = '⌛ The duel timed out.';
    if (reason === 'done') {
      const a = picks.get(players.a);
      const b = picks.get(players.b);
      const w = winner(a, b);
      description = [
        `${mention(players.a)} chose ${CHOICES[a].emoji} **${CHOICES[a].label}**`,
        `${mention(players.b)} chose ${CHOICES[b].emoji} **${CHOICES[b].label}**`,
        '',
        w === 'draw' ? '🤝 It is a draw.' : `🏆 ${mention(w === 'a' ? players.a : players.b)} wins.`,
      ].join('\n');
    }
    await message.edit({
      embeds: [buildStandardEmbed({ title: '🪨📄✂️ Rock Paper Scissors', description })],
      components: [],
    }).catch(() => {});
  }

  collector.on('collect', async (btn) => {
    if (await guardGameButton(btn)) return;
    if (btn.customId === closeId) {
      if (!canControl(btn.member, interaction.user.id)) {
        return safeReply(btn, { content: '❌ Only the challenger or a channel manager can close this.', flags: MessageFlags.Ephemeral });
      }
      await btn.deferUpdate().catch(() => {});
      return finish('closed');
    }

    if (phase === 'challenge') {
      if (btn.customId === acceptId || btn.customId === declineId) {
        if (btn.user.id !== players.b) {
          return safeReply(btn, { content: '❌ This challenge is not for you.', flags: MessageFlags.Ephemeral });
        }
        await btn.deferUpdate().catch(() => {});
        if (btn.customId === declineId) return finish('declined');
        phase = 'picking';
        await message.edit({
          embeds: [buildStandardEmbed({
            title: '🪨📄✂️ Rock Paper Scissors',
            description: `${mention(players.a)} vs ${mention(players.b)}\n\nBoth players: click your choice. Picks stay hidden until both have locked in.`,
          })],
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(chooseIds.rock).setLabel('Rock').setEmoji('🪨').setStyle(ButtonStyle.Secondary),
              new ButtonBuilder().setCustomId(chooseIds.paper).setLabel('Paper').setEmoji('📄').setStyle(ButtonStyle.Primary),
              new ButtonBuilder().setCustomId(chooseIds.scissors).setLabel('Scissors').setEmoji('✂️').setStyle(ButtonStyle.Danger),
            ),
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(closeId).setLabel('Close').setStyle(ButtonStyle.Secondary),
            ),
          ],
        }).catch(() => {});
        return;
      }
    }

    if (phase === 'picking' && Object.values(chooseIds).includes(btn.customId)) {
      if (![players.a, players.b].includes(btn.user.id)) {
        return safeReply(btn, { content: '❌ This duel is only for the two players.', flags: MessageFlags.Ephemeral });
      }
      const choice = Object.entries(chooseIds).find(([, v]) => v === btn.customId)?.[0];
      picks.set(btn.user.id, choice);
      await safeReply(btn, { content: `✅ You locked in **${CHOICES[choice].label}**.`, flags: MessageFlags.Ephemeral });
      if (picks.size >= 2) return finish('done');
      return;
    }
  });

  collector.on('end', async (_, reason) => {
    if (!ended) await finish(reason === 'done' ? 'done' : 'timeout');
  });

  return message;
}

module.exports = { startFromHub };
