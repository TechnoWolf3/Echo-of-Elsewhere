const {
  gameId,
  normalizeText,
  getOrReuseMessage,
  safeReply,
  canControl,
  guardGameButton,
  startActive,
  endActive,
  buildStandardEmbed,
  closeRow,
  resultRow,
  returnToFunHub,
  MessageFlags,
} = require('./funHelpers');

async function buildGuessingGame(interaction, opts = {}) {
  const sessionId = gameId(opts.key || 'guess');
  const channel = interaction.channel;
  const starterId = interaction.user.id;
  const prompt = opts.prompt();
  const timeoutMs = Number(opts.timeoutMs || 45_000);
  const closeId = `${sessionId}:close`;
  const againId = `${sessionId}:again`;
  const returnId = `${sessionId}:return`;
  let ended = false;
  let resultCollector = null;

  startActive(channel.id, opts.key || 'guess', 'live', { startedBy: starterId, sessionId });

  const embed = buildStandardEmbed({
    title: opts.title || 'Guessing Game',
    description: [
      opts.description || 'Type your answer in chat.',
      '',
      prompt.ask,
      '',
      `⏳ Ends <t:${Math.floor((Date.now() + timeoutMs) / 1000)}:R>.`,
    ].join('\n'),
    footer: `Started by ${interaction.user.username}`,
  });

  const message = await getOrReuseMessage(interaction, opts.reuseMessage, {
    embeds: [embed],
    components: [closeRow(closeId)],
  });

  const componentCollector = message.createMessageComponentCollector({ time: timeoutMs });
  const answerCollector = channel.createMessageCollector({
    time: timeoutMs,
    filter: (m) => !m.author.bot,
  });

  async function attachResultButtons() {
    if (resultCollector) return;
    resultCollector = message.createMessageComponentCollector({ time: 10 * 60_000 });

    resultCollector.on('collect', async (btn) => {
      if (await guardGameButton(btn)) return;

      if (btn.customId === againId) {
        await btn.deferUpdate().catch(() => {});
        resultCollector.stop('again');
        return opts.restart ? opts.restart(btn, { reuseMessage: message }) : buildGuessingGame(btn, opts);
      }

      if (btn.customId === returnId) {
        await btn.deferUpdate().catch(() => {});
        resultCollector.stop('return');
        return returnToFunHub(btn, message);
      }

      if (btn.customId === closeId) {
        if (!canControl(btn.member, starterId)) {
          return safeReply(btn, { content: '❌ Only the game starter or a channel manager can close this.', flags: MessageFlags.Ephemeral });
        }
        await btn.deferUpdate().catch(() => {});
        resultCollector.stop('closed');
        await message.edit({ components: [] }).catch(() => {});
      }
    });
  }

  async function finish(reason, winner) {
    if (ended) return;
    ended = true;
    componentCollector.stop(reason);
    answerCollector.stop(reason);
    endActive(channel.id);

    const desc = [];
    if (winner) {
      desc.push(`🏆 ${winner} got it first.`);
    } else if (reason === 'closed') {
      desc.push('🛑 Game closed.');
    } else {
      desc.push('⌛ Time is up. Nobody got it in time.');
    }
    desc.push('');
    desc.push(prompt.ask);
    desc.push('');
    desc.push(prompt.reveal);
    desc.push('');
    desc.push('Use **Play Again** for another round, or **Return** to go back to Just for Fun.');

    await message.edit({
      embeds: [buildStandardEmbed({ title: opts.title || 'Guessing Game', description: desc.join('\n') })],
      components: [resultRow({ againId, returnId, closeId, againLabel: 'Play Again' })],
    }).catch(() => {});

    await attachResultButtons();
  }

  componentCollector.on('collect', async (btn) => {
    if (btn.customId !== closeId) return;
    if (await guardGameButton(btn)) return;
    if (!canControl(btn.member, starterId)) {
      return safeReply(btn, { content: '❌ Only the game starter or a channel manager can close this.', flags: MessageFlags.Ephemeral });
    }
    await btn.deferUpdate().catch(() => {});
    await finish('closed');
  });

  answerCollector.on('collect', async (msg) => {
    const value = normalizeText(msg.content);
    const matched = prompt.answers.some((a) => normalizeText(a) === value);
    if (!matched) return;
    await finish('winner', `<@${msg.author.id}>`);
  });

  componentCollector.on('end', async (_, reason) => {
    if (!ended) await finish(reason === 'closed' ? 'closed' : 'timeout');
  });

  answerCollector.on('end', async (_, reason) => {
    if (!ended && reason !== 'winner' && reason !== 'closed') await finish('timeout');
  });

  return message;
}

module.exports = { buildGuessingGame };
