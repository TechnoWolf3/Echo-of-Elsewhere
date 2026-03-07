const {
  gameId,
  getOrReuseMessage,
  safeReply,
  canControl,
  guardGameButton,
  startActive,
  patchActive,
  endActive,
  buildStandardEmbed,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  mention,
} = require('./funHelpers');

const PROMPTS = [
  'A dragon lands in the middle of a Brisbane servo.',
  'The paramedic opens the ambulance and finds a penguin driving.',
  'Echo becomes sentient and demands a coffee before every game.',
  'A taxi driver accidentally picks up a wizard on night shift.',
  'You wake up and the moon is parked in your driveway.',
];

async function startFromHub(interaction, opts = {}) {
  const opponent = interaction.guild.members.cache.filter((m) => !m.user.bot && m.id !== interaction.user.id).first();
  if (!opponent) {
    await safeReply(interaction, { content: '❌ I need at least one other human in the server for Story Builder.', flags: MessageFlags.Ephemeral });
    return null;
  }

  const sessionId = gameId('story');
  const ids = {
    accept: `${sessionId}:accept`,
    decline: `${sessionId}:decline`,
    close: `${sessionId}:close`,
    voteA: `${sessionId}:votea`,
    voteB: `${sessionId}:voteb`,
  };
  const players = { a: interaction.user.id, b: opponent.id };
  const scores = { a: 0, b: 0 };
  const voterRound = new Set();
  let phase = 'challenge';
  let round = 0;
  let roundData = null;
  let message;
  let ended = false;
  let roundTimer = null;

  startActive(interaction.channelId, 'storybuilder', 'challenge', { startedBy: interaction.user.id, opponentId: opponent.id, sessionId });

  message = await getOrReuseMessage(interaction, opts.reuseMessage, {
    embeds: [buildStandardEmbed({ title: '📖 Story Builder', description: `${mention(players.a)} has challenged ${mention(players.b)}.\n\n${mention(players.b)}, accept or decline.` })],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(ids.accept).setLabel('Accept').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(ids.decline).setLabel('Decline').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(ids.close).setLabel('Close').setStyle(ButtonStyle.Secondary),
    )],
  });

  const componentCollector = message.createMessageComponentCollector({ time: 15 * 60_000 });
  const msgCollector = interaction.channel.createMessageCollector({ time: 15 * 60_000, filter: (m) => [players.a, players.b].includes(m.author.id) && !m.author.bot });

  async function nextRound() {
    round += 1;
    if (round > 3) return finish('done');
    roundData = { prompt: PROMPTS[Math.floor(Math.random() * PROMPTS.length)], a: null, b: null };
    voterRound.clear();
    phase = 'writing';
    patchActive(interaction.channelId, { state: `round_${round}` });
    clearTimeout(roundTimer);
    roundTimer = setTimeout(async () => {
      phase = 'voting';
      await showVoting(true);
    }, 60_000);
    await message.edit({
      embeds: [buildStandardEmbed({
        title: `📖 Story Builder — Round ${round}`,
        description: [
          `**Prompt:** ${roundData.prompt}`,
          '',
          `${mention(players.a)} and ${mention(players.b)}, send **one single sentence** in chat.`,
          'Funniest / best line gets the round when people vote.',
          '',
          `Score — ${mention(players.a)}: **${scores.a}** | ${mention(players.b)}: **${scores.b}**`,
        ].join('\n'),
      })],
      components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(ids.close).setLabel('Close').setStyle(ButtonStyle.Secondary))],
    }).catch(() => {});
  }

  async function showVoting(fromTimeout = false) {
    clearTimeout(roundTimer);
    phase = 'voting';
    if (!roundData.a) roundData.a = '_No line submitted._';
    if (!roundData.b) roundData.b = '_No line submitted._';
    await message.edit({
      embeds: [buildStandardEmbed({
        title: `📖 Story Builder — Vote (Round ${round})`,
        description: [
          `**Prompt:** ${roundData.prompt}`,
          '',
          `**${interaction.member?.displayName || interaction.user.username}:** ${roundData.a}`,
          `**${opponent.displayName || opponent.user.username}:** ${roundData.b}`,
          '',
          fromTimeout ? '⌛ Writing time ended. Vote for the better line.' : 'Vote for the better line.',
          `Score — ${mention(players.a)}: **${scores.a}** | ${mention(players.b)}: **${scores.b}**`,
        ].join('\n'),
      })],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(ids.voteA).setLabel(interaction.member?.displayName || interaction.user.username).setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(ids.voteB).setLabel(opponent.displayName || opponent.user.username).setStyle(ButtonStyle.Success),
        ),
        new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(ids.close).setLabel('Close').setStyle(ButtonStyle.Secondary)),
      ],
    }).catch(() => {});

    roundTimer = setTimeout(async () => {
      const aVotes = [...voterRound].filter((v) => v.endsWith(':a')).length;
      const bVotes = [...voterRound].filter((v) => v.endsWith(':b')).length;
      if (aVotes > bVotes) scores.a += 1;
      else if (bVotes > aVotes) scores.b += 1;
      await nextRound();
    }, 25_000);
  }

  async function finish(reason) {
    if (ended) return;
    ended = true;
    clearTimeout(roundTimer);
    componentCollector.stop(reason);
    msgCollector.stop(reason);
    endActive(interaction.channelId);
    let description = '🛑 Game closed.';
    if (reason === 'declined') description = `${mention(players.b)} declined the challenge.`;
    else if (reason === 'timeout') description = '⌛ Game timed out.';
    else if (reason === 'done') {
      description = [
        `Final score — ${mention(players.a)}: **${scores.a}** | ${mention(players.b)}: **${scores.b}**`,
        '',
        scores.a === scores.b ? '🤝 It ends in a draw.' : `🏆 ${mention(scores.a > scores.b ? players.a : players.b)} wins Story Builder.`,
      ].join('\n');
    }
    await message.edit({ embeds: [buildStandardEmbed({ title: '📖 Story Builder', description })], components: [] }).catch(() => {});
  }

  componentCollector.on('collect', async (btn) => {
    if (await guardGameButton(btn)) return;
    if (btn.customId === ids.close) {
      if (!canControl(btn.member, interaction.user.id)) return safeReply(btn, { content: '❌ Only the challenger or a channel manager can close this.', flags: MessageFlags.Ephemeral });
      await btn.deferUpdate().catch(() => {});
      return finish('closed');
    }
    if (phase === 'challenge') {
      if (btn.user.id !== players.b) return safeReply(btn, { content: '❌ This challenge is not for you.', flags: MessageFlags.Ephemeral });
      await btn.deferUpdate().catch(() => {});
      if (btn.customId === ids.decline) return finish('declined');
      return nextRound();
    }
    if (phase === 'voting' && [ids.voteA, ids.voteB].includes(btn.customId)) {
      const side = btn.customId === ids.voteA ? 'a' : 'b';
      voterRound.forEach((v) => { if (v.startsWith(`${btn.user.id}:`)) voterRound.delete(v); });
      voterRound.add(`${btn.user.id}:${side}`);
      return safeReply(btn, { content: `✅ Vote locked for ${side === 'a' ? mention(players.a) : mention(players.b)}.`, flags: MessageFlags.Ephemeral });
    }
  });

  msgCollector.on('collect', async (msg) => {
    if (phase !== 'writing') return;
    const side = msg.author.id === players.a ? 'a' : 'b';
    if (roundData[side]) return;
    roundData[side] = msg.content.trim().slice(0, 180);
    if (roundData.a && roundData.b) await showVoting(false);
  });

  componentCollector.on('end', async (_, reason) => {
    if (!ended && reason !== 'done') await finish('timeout');
  });

  return message;
}

module.exports = { startFromHub };
