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

const WORDS = ['galaxy', 'outback', 'rescue', 'discord', 'penguin', 'thunder', 'station', 'biscuit', 'hangar', 'rocket'];

function maskWord(word, guessed) {
  return word.split('').map((c) => (guessed.has(c) ? c.toUpperCase() : '_')).join(' ');
}

async function startFromHub(interaction, opts = {}) {
  const opponent = interaction.guild.members.cache.filter((m) => !m.user.bot && m.id !== interaction.user.id).first();
  if (!opponent) {
    await safeReply(interaction, { content: '❌ I need at least one other human in the server for Hangman.', flags: MessageFlags.Ephemeral });
    return null;
  }

  const word = WORDS[Math.floor(Math.random() * WORDS.length)];
  const guessed = new Set();
  const wrong = [];
  const sessionId = gameId('hangman');
  const acceptId = `${sessionId}:accept`;
  const declineId = `${sessionId}:decline`;
  const closeId = `${sessionId}:close`;
  const players = [interaction.user.id, opponent.id];
  let turn = 0;
  let phase = 'challenge';
  let ended = false;
  let turnTimer = null;

  startActive(interaction.channelId, 'hangman', 'challenge', { startedBy: interaction.user.id, opponentId: opponent.id, sessionId });

  const message = await getOrReuseMessage(interaction, opts.reuseMessage, {
    embeds: [buildStandardEmbed({
      title: '🎯 Hangman',
      description: `${mention(players[0])} has challenged ${mention(players[1])}.\n\n${mention(players[1])}, accept or decline.`,
    })],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(acceptId).setLabel('Accept').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(declineId).setLabel('Decline').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(closeId).setLabel('Close').setStyle(ButtonStyle.Secondary),
    )],
  });

  const componentCollector = message.createMessageComponentCollector({ time: 12 * 60_000 });
  const msgCollector = interaction.channel.createMessageCollector({ time: 12 * 60_000, filter: (m) => players.includes(m.author.id) && !m.author.bot });

  async function render(status) {
    await message.edit({
      embeds: [buildStandardEmbed({
        title: '🎯 Hangman',
        description: [
          `${mention(players[0])} vs ${mention(players[1])}`,
          '',
          `Word: **${maskWord(word, guessed)}**`,
          `Wrong guesses: **${wrong.length}/6** ${wrong.length ? `(${wrong.join(', ').toUpperCase()})` : ''}`,
          phase === 'playing' ? `🎤 ${mention(players[turn])}'s turn. Type a single letter or the full word.` : status,
          status && phase !== 'playing' ? status : '',
        ].filter(Boolean).join('\n'),
      })],
      components: phase === 'ended' ? [] : [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(closeId).setLabel('Close').setStyle(ButtonStyle.Secondary))],
    }).catch(() => {});
  }

  async function finish(reason, winnerId = null) {
    if (ended) return;
    ended = true;
    phase = 'ended';
    clearTimeout(turnTimer);
    componentCollector.stop(reason);
    msgCollector.stop(reason);
    endActive(interaction.channelId);
    let status = '🛑 Game closed.';
    if (reason === 'declined') status = `${mention(players[1])} declined the challenge.`;
    if (reason === 'timeout') status = '⌛ Game timed out.';
    if (reason === 'solved') status = `🏆 ${mention(winnerId)} solved the word: **${word.toUpperCase()}**`;
    if (reason === 'failed') status = `💀 The word was **${word.toUpperCase()}**. Nobody escaped the noose.`;
    await render(status);
  }

  function bumpTurnTimer() {
    clearTimeout(turnTimer);
    if (phase !== 'playing') return;
    turnTimer = setTimeout(async () => {
      turn = turn === 0 ? 1 : 0;
      patchActive(interaction.channelId, { state: 'live' });
      await render('⌛ Turn skipped for taking too long.');
      bumpTurnTimer();
    }, 45_000);
  }

  componentCollector.on('collect', async (btn) => {
    if (await guardGameButton(btn)) return;
    if (btn.customId === closeId) {
      if (!canControl(btn.member, interaction.user.id)) {
        return safeReply(btn, { content: '❌ Only the challenger or a channel manager can close this.', flags: MessageFlags.Ephemeral });
      }
      await btn.deferUpdate().catch(() => {});
      return finish('closed');
    }
    if (phase !== 'challenge') return;
    if (![acceptId, declineId].includes(btn.customId)) return;
    if (btn.user.id !== players[1]) {
      return safeReply(btn, { content: '❌ This challenge is not for you.', flags: MessageFlags.Ephemeral });
    }
    await btn.deferUpdate().catch(() => {});
    if (btn.customId === declineId) return finish('declined');
    phase = 'playing';
    patchActive(interaction.channelId, { state: 'live' });
    await render();
    bumpTurnTimer();
  });

  msgCollector.on('collect', async (msg) => {
    if (phase !== 'playing') return;
    if (msg.author.id !== players[turn]) return;
    const raw = normalizeText(msg.content).replace(/\s+/g, '');
    if (!raw) return;
    clearTimeout(turnTimer);

    if (raw.length === 1) {
      const letter = raw;
      if (!/[a-z]/.test(letter) || guessed.has(letter) || wrong.includes(letter)) {
        await msg.reply('That letter has already been used or is invalid.').catch(() => {});
        bumpTurnTimer();
        return;
      }
      if (word.includes(letter)) guessed.add(letter);
      else wrong.push(letter);
    } else {
      if (raw === word) return finish('solved', msg.author.id);
      wrong.push(`"${raw}"`);
    }

    if (word.split('').every((c) => guessed.has(c))) return finish('solved', msg.author.id);
    if (wrong.length >= 6) return finish('failed');

    turn = turn === 0 ? 1 : 0;
    await render();
    bumpTurnTimer();
  });

  componentCollector.on('end', async (_, reason) => {
    if (!ended && reason !== 'closed' && reason !== 'declined' && reason !== 'solved' && reason !== 'failed') await finish('timeout');
  });

  return message;
}

module.exports = { startFromHub };
