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
  normalizeText,
} = require('./funHelpers');

const MEMES = [
  'A blurry photo of a possum stealing hot chips outside a servo.',
  'A cat wearing sunglasses captioned: “I know a shortcut” while sitting in traffic.',
  'A forklift carrying one single grape with inspirational music.',
  'An ambulance parked outside Bunnings with the caption: “medical sausage run”.',
  'A dragon trying to pay rent in Monopoly money.',
  'A screenshot of 73 browser tabs and one playing mystery audio.',
];

async function startFromHub(interaction, opts = {}) {
  const opponent = interaction.guild.members.cache.filter((m) => !m.user.bot && m.id !== interaction.user.id).first();
  if (!opponent) {
    await safeReply(interaction, { content: '❌ I need at least one other human in the server for Meme Rating.', flags: MessageFlags.Ephemeral });
    return null;
  }

  const sessionId = gameId('meme');
  const ids = {
    accept: `${sessionId}:accept`,
    decline: `${sessionId}:decline`,
    close: `${sessionId}:close`,
    voteA: `${sessionId}:votea`,
    voteB: `${sessionId}:voteb`,
  };
  const players = { a: interaction.user.id, b: opponent.id };
  const scores = { a: 0, b: 0 };
  let round = 0;
  let phase = 'challenge';
  let roundData = null;
  let voters = new Set();
  let ended = false;
  let timer = null;
  let message;

  startActive(interaction.channelId, 'memerating', 'challenge', { startedBy: interaction.user.id, opponentId: opponent.id, sessionId });

  message = await getOrReuseMessage(interaction, opts.reuseMessage, {
    embeds: [buildStandardEmbed({ title: '🧻 Meme Rating Game', description: `${mention(players.a)} has challenged ${mention(players.b)}.\n\n${mention(players.b)}, accept or decline.` })],
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
    roundData = { meme: MEMES[Math.floor(Math.random() * MEMES.length)], a: null, b: null };
    voters = new Set();
    phase = 'rating';
    patchActive(interaction.channelId, { state: `round_${round}` });
    clearTimeout(timer);
    timer = setTimeout(async () => {
      phase = 'voting';
      await showVoting(true);
    }, 45_000);
    await message.edit({
      embeds: [buildStandardEmbed({
        title: `🧻 Meme Rating — Round ${round}`,
        description: [
          `**Meme:** ${roundData.meme}`,
          '',
          `${mention(players.a)} and ${mention(players.b)}, type a rating from **1 to 10** in chat.`,
          `Score — ${mention(players.a)}: **${scores.a}** | ${mention(players.b)}: **${scores.b}**`,
        ].join('\n'),
      })],
      components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(ids.close).setLabel('Close').setStyle(ButtonStyle.Secondary))],
    }).catch(() => {});
  }

  async function showVoting(fromTimeout = false) {
    clearTimeout(timer);
    phase = 'voting';
    if (!roundData.a) roundData.a = 'No rating';
    if (!roundData.b) roundData.b = 'No rating';
    await message.edit({
      embeds: [buildStandardEmbed({
        title: `🧻 Meme Rating — Vote (Round ${round})`,
        description: [
          `**Meme:** ${roundData.meme}`,
          '',
          `${mention(players.a)} rated it: **${roundData.a}/10**`,
          `${mention(players.b)} rated it: **${roundData.b}/10**`,
          '',
          fromTimeout ? '⌛ Rating time ended. Vote for the better rating.' : 'Vote for the better rating.',
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
    timer = setTimeout(async () => {
      const aVotes = [...voters].filter((v) => v.endsWith(':a')).length;
      const bVotes = [...voters].filter((v) => v.endsWith(':b')).length;
      if (aVotes > bVotes) scores.a += 1;
      else if (bVotes > aVotes) scores.b += 1;
      await nextRound();
    }, 20_000);
  }

  async function finish(reason) {
    if (ended) return;
    ended = true;
    clearTimeout(timer);
    componentCollector.stop(reason);
    msgCollector.stop(reason);
    endActive(interaction.channelId);
    let description = '🛑 Game closed.';
    if (reason === 'declined') description = `${mention(players.b)} declined the challenge.`;
    else if (reason === 'timeout') description = '⌛ Game timed out.';
    else if (reason === 'done') description = scores.a === scores.b ? `Final score — ${scores.a} : ${scores.b}\n\n🤝 It is a draw.` : `Final score — ${mention(players.a)}: **${scores.a}** | ${mention(players.b)}: **${scores.b}**\n\n🏆 ${mention(scores.a > scores.b ? players.a : players.b)} wins Meme Rating.`;
    await message.edit({ embeds: [buildStandardEmbed({ title: '🧻 Meme Rating Game', description })], components: [] }).catch(() => {});
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
      voters.forEach((v) => { if (v.startsWith(`${btn.user.id}:`)) voters.delete(v); });
      voters.add(`${btn.user.id}:${side}`);
      return safeReply(btn, { content: `✅ Vote locked for ${side === 'a' ? mention(players.a) : mention(players.b)}.`, flags: MessageFlags.Ephemeral });
    }
  });

  msgCollector.on('collect', async (msg) => {
    if (phase !== 'rating') return;
    const score = Number.parseInt(normalizeText(msg.content), 10);
    if (!Number.isFinite(score) || score < 1 || score > 10) return;
    const side = msg.author.id === players.a ? 'a' : 'b';
    if (roundData[side] != null) return;
    roundData[side] = score;
    if (roundData.a != null && roundData.b != null) await showVoting(false);
  });

  componentCollector.on('end', async (_, reason) => {
    if (!ended && reason !== 'done') await finish('timeout');
  });

  return message;
}

module.exports = { startFromHub };
