const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
} = require('discord.js');

const { activeGames } = require('../../utils/gameManager');
const {
  setActiveGame,
  clearActiveGame,
} = require('../../utils/gamesHubState');
const { tryDebitUser } = require('../../utils/economy');
const { bankPayoutWithEffects, handleTriggeredEffectEvent } = require('../../utils/effectSystem');
const { guardNotJailedComponent } = require('../../utils/jail');
const { guardGamesComponent } = require('../../utils/echoRift/curseGuard');
const { loadCategories, getCategory } = require('./index');

const ACTIVITY_EFFECTS = {
  effectsApply: true,
  canAwardEffects: true,
  blockedBlessings: [],
  blockedCurses: [],
  effectAwardPool: {
    nothingWeight: 100,
    blessingWeight: 0,
    curseWeight: 0,
    blessingWeights: {},
    curseWeights: {},
  },
};

const SESSION_IDLE_MS = 30 * 60 * 1000;
const TILE_COUNT = 9;
const HIDDEN_TILE = '░░░';

const CARD_DEFS = {
  pocket: {
    id: 'pocket',
    name: 'Pocket Scratch',
    emoji: '🟩',
    color: 0x63c174,
    cost: 500,
    style: 'Stable • cheaper • friendlier',
    blurb: 'The safer little card. Smaller swings and steadier outcomes.',
    symbolWeights: [
      { emoji: '💵', weight: 34 },
      { emoji: '🍀', weight: 24 },
      { emoji: '⭐', weight: 18 },
      { emoji: '💀', weight: 14 },
      { emoji: '👁️', weight: 10 },
    ],
    payouts: {
      '💵:3': 700,
      '💵:4': 950,
      '💵:5': 1200,
      '🍀:3': 850,
      '🍀:4': 1100,
      '🍀:5': 1450,
      '⭐:3': 1000,
      '⭐:4': 1300,
      '⭐:5': 1700,
      '👁️:3': 900,
      '👁️:4': 1300,
      '👁️:5': 1800,
    },
    loseLines: [
      'Close, but Echo keeps the change.',
      'A dud, but at least it was a cheap dud.',
      'The card hisses, then does absolutely nothing useful.',
    ],
  },
  lucky: {
    id: 'lucky',
    name: 'Lucky Lines',
    emoji: '🟦',
    color: 0x4da3ff,
    cost: 1500,
    style: 'Balanced • mid-risk • most fair',
    blurb: 'Your standard scratchie. Better pops, fairer bruises.',
    symbolWeights: [
      { emoji: '💵', weight: 28 },
      { emoji: '🍀', weight: 22 },
      { emoji: '💎', weight: 13 },
      { emoji: '⭐', weight: 16 },
      { emoji: '💀', weight: 12 },
      { emoji: '👁️', weight: 9 },
    ],
    payouts: {
      '💵:3': 2100,
      '💵:4': 2800,
      '💵:5': 3600,
      '🍀:3': 2400,
      '🍀:4': 3200,
      '🍀:5': 4200,
      '⭐:3': 2600,
      '⭐:4': 3500,
      '⭐:5': 4700,
      '💎:3': 3300,
      '💎:4': 4700,
      '💎:5': 6200,
      '👁️:3': 2500,
      '👁️:4': 3600,
      '👁️:5': 5200,
    },
    loseLines: [
      'Not today. The house wins this one.',
      'All that scratching for a whole lot of pain.',
      'You got lines. They just weren’t lucky ones.',
    ],
  },
  cursed: {
    id: 'cursed',
    name: 'Cursed Card',
    emoji: '🟪',
    color: 0x9b59ff,
    cost: 3000,
    style: 'Swingy • chaotic • Echo-touched',
    blurb: 'Bigger swings, nastier misses, and the occasional Echo grin.',
    symbolWeights: [
      { emoji: '💵', weight: 22 },
      { emoji: '🍀', weight: 15 },
      { emoji: '💎', weight: 15 },
      { emoji: '🔥', weight: 12 },
      { emoji: '💀', weight: 20 },
      { emoji: '👁️', weight: 16 },
    ],
    payouts: {
      '💵:3': 4300,
      '💵:4': 5400,
      '💵:5': 7000,
      '🍀:3': 4700,
      '🍀:4': 6100,
      '🍀:5': 7900,
      '🔥:3': 5200,
      '🔥:4': 7000,
      '🔥:5': 9200,
      '💎:3': 6200,
      '💎:4': 8500,
      '💎:5': 11000,
      '👁️:3': 5600,
      '👁️:4': 7800,
      '👁️:5': 9800,
    },
    loseLines: [
      'Echo licks the card and calls it a loss.',
      'The card crackles, then dies in your hands.',
      'You paid for chaos and, buddy, chaos showed up.',
    ],
  },
};

function money(n) {
  return `$${Number(n || 0).toLocaleString('en-AU')}`;
}

function pickWeighted(list) {
  const total = list.reduce((sum, item) => sum + Number(item.weight || 0), 0);
  let roll = Math.random() * total;
  for (const item of list) {
    roll -= Number(item.weight || 0);
    if (roll <= 0) return item;
  }
  return list[list.length - 1];
}

function buildBoard(card) {
  const board = [];
  for (let i = 0; i < TILE_COUNT; i += 1) {
    board.push(pickWeighted(card.symbolWeights).emoji);
  }
  return board;
}

function countSymbols(board) {
  const counts = new Map();
  for (const symbol of board) counts.set(symbol, (counts.get(symbol) || 0) + 1);
  return counts;
}

function resolveCard(card) {
  let board = buildBoard(card);

  if (card.id === 'cursed') {
    const eyeCount = board.filter((s) => s === '👁️').length;
    const skullCount = board.filter((s) => s === '💀').length;

    if (eyeCount >= 2 && Math.random() < 0.18) {
      const idx = Math.floor(Math.random() * board.length);
      board[idx] = '💎';
    } else if (skullCount >= 3 && Math.random() < 0.22) {
      const idx = Math.floor(Math.random() * board.length);
      board[idx] = '💀';
    }
  }

  const counts = countSymbols(board);
  let best = null;
  for (const [symbol, count] of counts.entries()) {
    if (count < 3) continue;
    const payout = Number(card.payouts[`${symbol}:${count}`] || 0);
    if (!payout) continue;
    if (!best || payout > best.payout) {
      best = { symbol, count, payout };
    }
  }

  const skulls = Number(counts.get('💀') || 0);
  const eyes = Number(counts.get('👁️') || 0);
  const fire = Number(counts.get('🔥') || 0);

  let payout = best?.payout || 0;
  const notes = [];

  if (payout > 0) {
    if (card.id === 'pocket' && eyes >= 3) {
      payout += 250;
      notes.push('👁️ Echo peeks over your shoulder and tosses in a small bonus.');
    }
    if (card.id === 'lucky' && counts.get('🍀') >= 2) {
      payout += 300;
      notes.push('🍀 A lucky kicker bumps the payout a little higher.');
    }
    if (card.id === 'cursed' && fire >= 2 && Math.random() < 0.35) {
      payout += 900;
      notes.push('🔥 The cursed card flares up and overpays. That seems bad long-term.');
    }
    if (card.id === 'cursed' && skulls >= 2 && Math.random() < 0.28) {
      payout = Math.max(0, payout - 1200);
      notes.push('💀 The skulls bite a chunk out of your prize.');
    }
  } else {
    if (card.id === 'cursed' && eyes >= 3 && Math.random() < 0.12) {
      payout = 4500;
      best = { symbol: '👁️', count: eyes, payout };
      notes.push('👁️ Echo changes its mind at the last second. Against all reason, that wins.');
    }
  }

  return {
    board,
    counts,
    payout: Math.floor(Math.max(0, payout)),
    win: payout > 0,
    best,
    notes,
  };
}

function boardLines(board) {
  const rows = [];
  for (let i = 0; i < board.length; i += 3) {
    rows.push(board.slice(i, i + 3).join('  '));
  }
  return rows.join('\n');
}

function cardSummary(card) {
  return [
    `**Cost:** ${money(card.cost)}`,
    `**Style:** ${card.style}`,
    `**Best launch payout:** ${money(Math.max(...Object.values(card.payouts)))}`,
    card.blurb,
  ].join('\n');
}

function buildCardHubEmbed(session) {
  const selected = CARD_DEFS[session.selectedCardId] || CARD_DEFS.pocket;
  const cardFields = Object.values(CARD_DEFS).map((card) => ({
    name: `${card.emoji} ${card.name}`,
    value: `${money(card.cost)} • ${card.style}`,
    inline: true,
  }));

  return new EmbedBuilder()
    .setColor(selected.color)
    .setTitle('🎟️ Scratch Cards')
    .setDescription(
      'Pick a card below, check the vibe, then buy it and start scratching. You can peel it back one scratch at a time or just reveal the whole thing if patience is not your ministry.\n\n' +
      `**Selected:** ${selected.emoji} **${selected.name}**\n${cardSummary(selected)}`
    )
    .addFields(cardFields)
    .setFooter({ text: 'Scratch cards are fixed-price gambles with modest long-term returns.' });
}

function buildHubComponents(session) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`scratch:${session.id}:pick:pocket`)
        .setLabel('Pocket')
        .setEmoji('🟩')
        .setStyle(session.selectedCardId === 'pocket' ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`scratch:${session.id}:pick:lucky`)
        .setLabel('Lucky Lines')
        .setEmoji('🟦')
        .setStyle(session.selectedCardId === 'lucky' ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`scratch:${session.id}:pick:cursed`)
        .setLabel('Cursed')
        .setEmoji('🟪')
        .setStyle(session.selectedCardId === 'cursed' ? ButtonStyle.Success : ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`scratch:${session.id}:buy`)
        .setLabel(`Buy ${money((CARD_DEFS[session.selectedCardId] || CARD_DEFS.pocket).cost)}`)
        .setEmoji('🎟️')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`scratch:${session.id}:casino`)
        .setLabel('Return to Casino')
        .setEmoji('🎰')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`scratch:${session.id}:close`)
        .setLabel('Close')
        .setEmoji('🗑️')
        .setStyle(ButtonStyle.Danger),
    ),
  ];
}

function getProgressLine(session) {
  const round = session.currentRound;
  if (!round) return '';

  const revealedSymbols = round.revealed
    .map((isOpen, index) => (isOpen ? round.result.board[index] : null))
    .filter(Boolean);

  const seenCounts = new Map();
  for (const symbol of revealedSymbols) {
    seenCounts.set(symbol, (seenCounts.get(symbol) || 0) + 1);
  }

  const bestSeen = [...seenCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!bestSeen) {
    return 'Fresh card. Nothing revealed yet.';
  }

  return `Best seen so far: **${bestSeen[1]}x ${bestSeen[0]}** • ${round.revealedCount}/${TILE_COUNT} scratched`;
}

function buildScratchEmbed(session) {
  const round = session.currentRound;
  const card = round.card;
  const left = TILE_COUNT - round.revealedCount;
  const line = left > 0
    ? left === TILE_COUNT
      ? 'The foil is still intact. Start scratching.'
      : `Silver flakes everywhere. **${left}** spot${left === 1 ? '' : 's'} left.`
    : 'Card fully uncovered.';

  return new EmbedBuilder()
    .setColor(card.color)
    .setTitle(`🎟️ ${card.name}`)
    .setDescription(
      `**Cost:** ${money(card.cost)}\n` +
      `**Rule:** Match **3 or more** of the same symbol to win.\n\n` +
      `${line}\n${getProgressLine(session)}`
    )
    .setFooter({ text: 'Use Scratch to reveal one panel, or Reveal All to flip the whole card.' });
}

function buildScratchComponents(session) {
  const round = session.currentRound;
  const rows = [];

  for (let row = 0; row < 3; row += 1) {
    const actionRow = new ActionRowBuilder();
    for (let col = 0; col < 3; col += 1) {
      const index = row * 3 + col;
      const isOpen = !!round.revealed[index];
      actionRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`scratch:${session.id}:tile:${index}`)
          .setLabel(isOpen ? round.result.board[index] : HIDDEN_TILE)
          .setStyle(isOpen ? ButtonStyle.Secondary : ButtonStyle.Primary)
          .setDisabled(true)
      );
    }
    rows.push(actionRow);
  }

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`scratch:${session.id}:scratch`)
        .setLabel('Scratch')
        .setEmoji('🪙')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(round.revealedCount >= TILE_COUNT),
      new ButtonBuilder()
        .setCustomId(`scratch:${session.id}:reveal`)
        .setLabel('Reveal All')
        .setEmoji('👀')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(round.revealedCount >= TILE_COUNT),
      new ButtonBuilder()
        .setCustomId(`scratch:${session.id}:hub`)
        .setLabel('Cards Hub')
        .setEmoji('🎟️')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`scratch:${session.id}:casino`)
        .setLabel('Casino')
        .setEmoji('🎰')
        .setStyle(ButtonStyle.Secondary),
    )
  );

  return rows;
}

function buildResultEmbed(session, card, result, finalPayout, options = {}) {
  const title = result.win ? '🎉 Scratchcard Winner' : '💀 Scratchcard Dud';
  const desc = [];
  desc.push(`**Card:** ${card.emoji} ${card.name}`);
  desc.push(`**Cost:** ${money(card.cost)}`);
  desc.push(`**Board:**\n${boardLines(result.board)}`);

  if (options.autoRevealReason) {
    desc.push(`\n_${options.autoRevealReason}_`);
  }

  if (result.win && result.best) {
    desc.push(`\nMatched **${result.counts.get(result.best.symbol)}x ${result.best.symbol}** for **${money(finalPayout)}**.`);
  } else {
    desc.push(`\n${card.loseLines[Math.floor(Math.random() * card.loseLines.length)]}`);
  }

  if (result.notes.length) {
    desc.push(`\n${result.notes.join('\n')}`);
  }

  const profit = finalPayout - card.cost;
  desc.push(`\n**Net:** ${profit >= 0 ? '+' : ''}${money(profit)}`);

  return new EmbedBuilder()
    .setColor(result.win ? 0x34c759 : 0xbd2d2d)
    .setTitle(title)
    .setDescription(desc.join('\n'))
    .setFooter({ text: 'Play again or head back to the casino list.' });
}

function buildResultComponents(session) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`scratch:${session.id}:again`)
        .setLabel('Play Again')
        .setEmoji('🔁')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`scratch:${session.id}:hub`)
        .setLabel('Cards Hub')
        .setEmoji('🎟️')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`scratch:${session.id}:casino`)
        .setLabel('Return to Casino')
        .setEmoji('🎰')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function buildCasinoEmbed(channelId) {
  const categories = loadCategories();
  const cat = getCategory(categories, 'casino');
  const list = (cat?.games?.length || 0)
    ? cat.games.map((g) => `${g.emoji || '🎮'} **${g.name}** — ${g.description || '—'}`).join('\n')
    : '_No games in this category yet._';

  return new EmbedBuilder()
    .setTitle(`${cat?.emoji || '🎰'} ${cat?.name || 'Casino'}`)
    .setDescription(`🟢 **No active game in this channel**\n\n${cat?.description || ''}\n\n**Available:**\n${list}`);
}

function buildCasinoComponents() {
  const categories = loadCategories();
  const cat = getCategory(categories, 'casino');
  const options = (cat?.games || []).map((g) => ({
    label: g.name,
    value: g.id,
    description: String(g.description || 'Launch').slice(0, 100),
    emoji: g.emoji,
  }));

  const { StringSelectMenuBuilder } = require('discord.js');
  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('games:game')
        .setPlaceholder(options.length ? 'Choose a game…' : 'No games available')
        .setDisabled(options.length === 0)
        .addOptions(options)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('games:back')
        .setLabel('Back')
        .setEmoji('⬅️')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('games:home')
        .setLabel('Home')
        .setEmoji('🏠')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('games:refresh')
        .setLabel('Refresh')
        .setEmoji('🔄')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('games:close')
        .setLabel('Close')
        .setEmoji('🗑️')
        .setStyle(ButtonStyle.Danger),
    ),
  ];
}

async function restoreCasino(session) {
  activeGames.delete(session.channelId);
  clearActiveGame(session.channelId);
  await session.message.edit({
    embeds: [buildCasinoEmbed(session.channelId)],
    components: buildCasinoComponents(),
  }).catch(() => {});
}

async function sendEphemeral(interaction, content) {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  } catch {}
}

function createRound(card) {
  return {
    card,
    result: resolveCard(card),
    revealed: Array(TILE_COUNT).fill(false),
    revealedCount: 0,
    settled: false,
  };
}

function revealRandomTile(round) {
  const hidden = [];
  for (let i = 0; i < TILE_COUNT; i += 1) {
    if (!round.revealed[i]) hidden.push(i);
  }
  if (!hidden.length) return null;
  const pick = hidden[Math.floor(Math.random() * hidden.length)];
  round.revealed[pick] = true;
  round.revealedCount += 1;
  return pick;
}

async function settleRound(interaction, session, options = {}) {
  const round = session.currentRound;
  if (!round || round.settled) return;

  round.revealed = Array(TILE_COUNT).fill(true);
  round.revealedCount = TILE_COUNT;
  round.settled = true;

  let finalPayout = 0;
  let payoutNote = null;

  if (round.result.payout > 0) {
    const payout = await bankPayoutWithEffects({
      guildId: session.guildId,
      userId: session.hostId,
      amount: round.result.payout,
      type: 'scratchcard_payout',
      meta: {
        channelId: session.channelId,
        cardId: round.card.id,
        cardName: round.card.name,
        payoutWanted: round.result.payout,
      },
      activityEffects: ACTIVITY_EFFECTS,
      awardSource: 'scratchcards',
    });

    if (payout?.ok) {
      finalPayout = Number(payout.finalAmount || round.result.payout);
    } else {
      payoutNote = '⚠️ The server bank could not cover the win, so the card pays out nothing this time.';
      finalPayout = 0;
    }
  } else {
    const triggerJail = await handleTriggeredEffectEvent({
      guildId: session.guildId,
      userId: session.hostId,
      eventKey: 'casino_loss',
      context: { source: 'scratchcards', cardId: round.card.id },
    }).catch(() => null);
    if (triggerJail?.triggered && triggerJail.notice) {
      payoutNote = triggerJail.notice;
    }
  }

  session.lastMode = 'result';
  await session.message.edit({
    embeds: [buildResultEmbed(session, round.card, round.result, finalPayout, options)],
    components: buildResultComponents(session),
  }).catch(() => {});

  if (interaction && payoutNote) {
    await sendEphemeral(interaction, payoutNote);
  }
}

async function startScratchRound(interaction, session) {
  if (await guardGamesComponent(interaction)) return;
  if (await guardNotJailedComponent(interaction)) return;

  const card = CARD_DEFS[session.selectedCardId] || CARD_DEFS.pocket;
  const debit = await tryDebitUser(session.guildId, interaction.user.id, card.cost, 'scratchcard_buy', {
    channelId: session.channelId,
    cardId: card.id,
    cardName: card.name,
  });

  if (!debit?.ok) {
    await sendEphemeral(interaction, `❌ You need **${money(card.cost)}** in your wallet to buy **${card.name}**.`);
    return;
  }

  session.currentRound = createRound(card);
  session.lastMode = 'scratching';
  activeGames.set(session.channelId, { type: 'scratchcards', state: 'scratching', hostId: session.hostId });
  setActiveGame(session.channelId, { type: 'scratchcards', state: 'scratching', tableId: session.id });

  await session.message.edit({
    embeds: [buildScratchEmbed(session)],
    components: buildScratchComponents(session),
  }).catch(() => {});
}

async function scratchOnce(interaction, session) {
  const round = session.currentRound;
  if (!round || round.settled) return;

  revealRandomTile(round);

  if (round.revealedCount >= TILE_COUNT) {
    await settleRound(interaction, session);
    return;
  }

  await session.message.edit({
    embeds: [buildScratchEmbed(session)],
    components: buildScratchComponents(session),
  }).catch(() => {});
}

async function startFromHub(interaction, ctx = {}) {
  const channelId = interaction.channelId;
  const guildId = interaction.guildId;
  const message = ctx.reuseMessage || interaction.message;

  if (!message) {
    await interaction.followUp({ content: '❌ Could not open scratch cards.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  if (activeGames.has(channelId)) {
    const existing = activeGames.get(channelId);
    await interaction.followUp({
      content: `❌ There is already an active game in this channel: **${existing.type || 'game'}**.`,
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return;
  }

  const session = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    guildId,
    channelId,
    message,
    hostId: interaction.user.id,
    selectedCardId: 'pocket',
    lastMode: 'hub',
    collector: null,
    currentRound: null,
  };

  activeGames.set(channelId, { type: 'scratchcards', state: 'hub', hostId: session.hostId });
  setActiveGame(channelId, { type: 'scratchcards', state: 'hub', tableId: session.id });

  await message.edit({
    embeds: [buildCardHubEmbed(session)],
    components: buildHubComponents(session),
  }).catch(() => {});

  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    idle: SESSION_IDLE_MS,
    filter: (i) => String(i.customId || '').startsWith(`scratch:${session.id}:`),
  });

  session.collector = collector;

  collector.on('collect', async (i) => {
    const [, , action, value] = String(i.customId || '').split(':');

    try {
      if (i.user.id !== session.hostId) {
        await i.reply({
          content: '❌ Only the player who opened this scratchcard panel can use it.',
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
        return;
      }

      await i.deferUpdate().catch(() => {});

      if (action === 'pick' && CARD_DEFS[value]) {
        session.selectedCardId = value;
        session.lastMode = 'hub';
        await message.edit({
          embeds: [buildCardHubEmbed(session)],
          components: buildHubComponents(session),
        }).catch(() => {});
        return;
      }

      if (action === 'buy' || action === 'again') {
        await startScratchRound(i, session);
        return;
      }

      if (action === 'scratch') {
        await scratchOnce(i, session);
        return;
      }

      if (action === 'reveal') {
        await settleRound(i, session, { autoRevealReason: 'You gave up on the gentle art of scratching and ripped the whole thing open.' });
        return;
      }

      if (action === 'hub') {
        session.currentRound = null;
        session.lastMode = 'hub';
        setActiveGame(channelId, { type: 'scratchcards', state: 'hub', tableId: session.id });
        activeGames.set(channelId, { type: 'scratchcards', state: 'hub', hostId: session.hostId });
        await message.edit({
          embeds: [buildCardHubEmbed(session)],
          components: buildHubComponents(session),
        }).catch(() => {});
        return;
      }

      if (action === 'casino') {
        collector.stop('casino');
        await restoreCasino(session);
        return;
      }

      if (action === 'close') {
        collector.stop('closed');
        activeGames.delete(channelId);
        clearActiveGame(channelId);
        await message.delete().catch(async () => {
          await message.edit({ components: [] }).catch(() => {});
        });
      }
    } catch (err) {
      console.error('[scratchcards] button error:', err);
      await sendEphemeral(i, '❌ Scratch cards tripped over themselves.');
    }
  });

  collector.on('end', async (_collected, reason) => {
    if (reason === 'casino' || reason === 'closed') {
      activeGames.delete(channelId);
      clearActiveGame(channelId);
      return;
    }

    try {
      if (session.currentRound && !session.currentRound.settled) {
        await settleRound(null, session, { autoRevealReason: 'The card timed out, so Echo peeled the rest back for you.' });
      }

      activeGames.delete(channelId);
      clearActiveGame(channelId);

      await message.edit({
        embeds: [buildCasinoEmbed(channelId)],
        components: buildCasinoComponents(),
      });
    } catch {}
  });
}

module.exports = { startFromHub };
