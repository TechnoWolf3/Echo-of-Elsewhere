const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require("discord.js");

const { pool } = require("../../utils/db");
const economy = require("../../utils/economy");
const { awardEffect } = require("../../utils/effectSystem");
const { nextSydneyMidnightUTC, getRitualStatus } = require("../../utils/rituals");
const { setJail } = require("../../utils/jail");
const { grantInventoryQty } = require("../../utils/store");
const lottery = require("../../utils/lottery");

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

const COST = 30000;
const BTN_SPIN = "rituals:wheel:spin";
const BTN_BACK = "rituals:wheel:back";
const SESSION_TTL_MS = 30 * 60 * 1000;

const sessions = new Map();

const SPINNER_FRAMES = [
  "💸 +$100", "🎟️ 5 Lottery Tickets", "💥 Wheel Jam", "💰 +$3,000", "🎁 Random Item", "🎰 Jackpot", "🚓 Jail", "🌌 Void Spin",
  "🎟️ Casino Voucher", "🪄 Lucky Multiplier", "📦 Mystery Crate", "🔁 Spin Again", "🏦 Bank Error", "🌠 Echo's Blessing", "🏛️ Server Bank Blessing", "🃏 Echo's Prank"
];

const RANDOM_ITEM_FALLBACKS = [
  { itemId: 'mystery_crate', name: 'Mystery Crate' },
  { itemId: 'lotto_ticket_bundle', name: 'Lottery Bundle' },
  { itemId: 'repair_kit', name: 'Repair Kit' },
  { itemId: 'lucky_charm', name: 'Lucky Charm' },
];

function money(n) {
  return `$${Number(n || 0).toLocaleString("en-AU")}`;
}

function randInt(min, max) {
  const lo = Math.ceil(Number(min || 0));
  const hi = Math.floor(Number(max || 0));
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return 0;
  if (hi <= lo) return lo;
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function weightedPick(entries) {
  const valid = entries.filter((entry) => Number(entry.weight || 0) > 0);
  const total = valid.reduce((sum, entry) => sum + Number(entry.weight || 0), 0);
  let roll = Math.random() * total;
  for (const entry of valid) {
    roll -= Number(entry.weight || 0);
    if (roll <= 0) return entry;
  }
  return valid[valid.length - 1] || null;
}

const OUTCOMES = [
  {
    id: 'cash_100', weight: 24, category: 'small_win', label: '+$100',
    resolve: async ({ guildId, userId }) => {
      await economy.creditUser(guildId, userId, 100, 'echo_wheel_small_cash', { ritual: 'echo_wheel' });
      return { title: '💸 +$100', body: `A suspiciously small but very real payout drops into your hands.\n\n**${money(100)}** added to your wallet.` };
    },
  },
  {
    id: 'cash_3000', weight: 18, category: 'small_win', label: '+$3,000',
    resolve: async ({ guildId, userId }) => {
      await economy.creditUser(guildId, userId, 3000, 'echo_wheel_cash', { ritual: 'echo_wheel' });
      return { title: '💰 +$3,000', body: `Not a life-changing spin, but definitely not embarrassing.\n\n**${money(3000)}** added to your wallet.` };
    },
  },
  {
    id: 'random_item', weight: 8, category: 'small_win', label: '1 Random Item',
    resolve: async ({ guildId, userId }) => {
      const item = await drawRandomStoreItem(guildId);
      await grantInventoryQty(guildId, userId, item.itemId, 1, { source: 'echo_wheel' });
      return { title: '🎁 1 Random Item', body: `The wheel spits something out from behind a hidden panel.\n\nReceived **${item.name}**.` };
    },
  },
  {
    id: 'free_lottery', weight: 7, category: 'small_win', label: 'Free 5 Lottery Tickets',
    resolve: async ({ guildId, userId }) => {
      const grant = await lottery.grantQuickPickTickets(guildId, userId, 5, { source: 'echo_wheel' }).catch(() => ({ ok: false, reason: 'failed', granted: 0 }));
      if (grant?.ok) {
        const drawUnix = Math.floor(Number(grant.drawUtc || Date.now()) / 1000);
        return { title: '🎟️ Free 5 Lottery Tickets', body: `Echo feeds five quick picks into the machine for you.\n\nGranted **${grant.granted}** free ticket(s) for the draw <t:${drawUnix}:F>.` };
      }
      return { title: '🎟️ Lottery Tickets', body: `Echo tried to feed you free tickets, but the draw wasn’t taking entries. The spin fizzles into nothing useful.` };
    },
  },
  {
    id: 'wheel_jam', weight: 20, category: 'neutral', label: 'The wheel jams',
    resolve: async () => ({ title: '🛠️ The Wheel Jams', body: 'The wheel clicks, groans, and stops on absolutely nothing of value. Echo refuses to elaborate.' }),
  },
  {
    id: 'spin_again', weight: 8, category: 'neutral', label: 'Spin Again',
    resolve: async ({ session }) => {
      session.canRespin = true;
      return { title: '🔁 Spin Again', body: 'Echo flicks the wheel with one finger.\n\n**This spin did not consume your daily attempt.** Take another shot.' };
    },
  },
  {
    id: 'wheel_damage', weight: 8, category: 'bad', label: 'Damage the wheel',
    resolve: async ({ guildId, userId }) => {
      await debitUpTo(guildId, userId, 10000, 'echo_wheel_damage', { ritual: 'echo_wheel' });
      return { title: '🥃 You Damage the Wheel', body: `You spill your drink all through the mechanism and cop the repair bill.\n\n**${money(10000)}** removed from your wallet.` };
    },
  },
  {
    id: 'jail', weight: 5, category: 'bad', label: 'Thrown in Jail',
    resolve: async ({ guildId, userId }) => {
      const minutes = randInt(5, 10);
      const jailedUntil = await setJail(guildId, userId, minutes);
      const ts = Math.floor(jailedUntil.getTime() / 1000);
      return { title: '🚓 Echo Hands You Over', body: `The wheel lands… and the room goes quiet.\n\nEcho tilts its head slightly. “Interesting choice.”\n\nYou are jailed for **${minutes} minute${minutes === 1 ? '' : 's'}**. Release <t:${ts}:R>.` };
    },
  },
  {
    id: 'account_frozen', weight: 4, category: 'bad', label: 'Account Frozen',
    resolve: async ({ guildId, userId }) => {
      const award = await awardEffect(guildId, userId, 'echo_curse_account_frozen', { source: 'echo_wheel' });
      return { title: '🧊 Account Frozen', body: award?.notice || 'Your next eligible earnings have been frozen for a while.' };
    },
  },
  {
    id: 'give_random_player', weight: 2, category: 'bad', label: 'Give $1,000 away',
    resolve: async ({ guildId, userId }) => {
      const targetId = await pickRandomRecipient(guildId, userId);
      const taken = await debitUpTo(guildId, userId, 1000, 'echo_wheel_charity', { ritual: 'echo_wheel' });
      if (targetId && taken > 0) {
        await economy.creditUser(guildId, targetId, taken, 'echo_wheel_received', { ritual: 'echo_wheel', fromUserId: userId });
        return { title: '🎁 Forced Generosity', body: `Echo decides your money looks better in someone else’s hands.\n\n**${money(taken)}** was given to <@${targetId}>.` };
      }
      return { title: '🎁 Forced Generosity', body: `Echo reaches into your wallet and pockets **${money(taken)}** just to prove a point.` };
    },
  },
  {
    id: 'split_cash', weight: 1, category: 'bad', label: 'Split $2,000',
    resolve: async ({ guildId, userId }) => {
      const targetId = await pickRandomRecipient(guildId, userId);
      const taken = await debitUpTo(guildId, userId, 2000, 'echo_wheel_split', { ritual: 'echo_wheel' });
      const gift = Math.floor(taken / 2);
      if (targetId && gift > 0) {
        await economy.creditUser(guildId, targetId, gift, 'echo_wheel_split_received', { ritual: 'echo_wheel', fromUserId: userId });
      }
      return { title: '🤝 Split Decision', body: targetId ? `Echo forces you to share.\n\nYou lose **${money(taken)}** and <@${targetId}> receives **${money(gift)}**.` : `Echo forces a split with the void itself.\n\n**${money(taken)}** disappears.` };
    },
  },
  {
    id: 'jackpot', weight: 4, category: 'big_win', label: 'Jackpot +$50,000',
    resolve: async ({ guildId, userId }) => {
      await economy.creditUser(guildId, userId, 50000, 'echo_wheel_jackpot', { ritual: 'echo_wheel' });
      return { title: '🎰 Jackpot +$50,000', body: `The wheel hits hard enough to shake the floor.\n\n**${money(50000)}** slams into your wallet.` };
    },
  },
  {
    id: 'bank_error', weight: 2, category: 'big_win', label: 'Bank Error +$85,000',
    resolve: async ({ guildId, userId }) => {
      await economy.creditBank(guildId, userId, 85000, 'echo_wheel_bank_error', { ritual: 'echo_wheel' });
      return { title: '🏦 Bank Error +$85,000', body: `The wheel slows to a stop. For a moment, everything feels perfectly aligned.\n\nEcho whispers softly: “Yes… this outcome feels correct.”\n\n**${money(85000)}** was deposited into your **bank**.` };
    },
  },
  {
    id: 'mystery_crate', weight: 1, category: 'big_win', label: 'Mystery Crate',
    resolve: async ({ guildId, userId }) => {
      const crate = weightedPick([
        { id: 'coins_15000', weight: 50 },
        { id: 'coins_30000', weight: 25 },
        { id: 'item', weight: 15 },
        { id: 'lotto', weight: 10 },
      ]);
      if (crate.id === 'item') {
        const item = await drawRandomStoreItem(guildId);
        await grantInventoryQty(guildId, userId, item.itemId, 1, { source: 'echo_wheel_mystery_crate' });
        return { title: '📦 Mystery Crate', body: `The crate cracks open and spits out **${item.name}**.` };
      }
      if (crate.id === 'lotto') {
        const grant = await lottery.grantQuickPickTickets(guildId, userId, 3, { source: 'echo_wheel_mystery_crate' }).catch(() => ({ ok: false, granted: 0 }));
        return { title: '📦 Mystery Crate', body: grant?.ok ? `Inside the crate: **${grant.granted}** quick-pick lottery tickets.` : `The crate contained lottery slips, but sales were already closed.` };
      }
      const amount = crate.id === 'coins_30000' ? 30000 : 15000;
      await economy.creditUser(guildId, userId, amount, 'echo_wheel_mystery_crate', { ritual: 'echo_wheel' });
      return { title: '📦 Mystery Crate', body: `The crate opens with a soft hiss.\n\nInside: **${money(amount)}**.` };
    },
  },
  {
    id: 'server_bank_blessing', weight: 1, category: 'big_win', label: 'Server Bank Blessing +$100,000',
    resolve: async ({ guildId, userId }) => {
      await economy.creditUser(guildId, userId, 100000, 'echo_wheel_server_blessing', { ritual: 'echo_wheel' });
      return { title: '🏛️ Server Bank Blessing', body: `Somehow, the server bank smiles on you.\n\n**${money(100000)}** is transferred into your wallet.` };
    },
  },
  {
    id: 'casino_voucher', weight: 2, category: 'big_win', label: 'Casino Voucher',
    resolve: async ({ guildId, userId }) => {
      const award = await awardEffect(guildId, userId, 'echo_blessing_casino_voucher', { source: 'echo_wheel' });
      return { title: '🎟️ Casino Voucher', body: award?.notice || 'Your next casino loss will be refunded.' };
    },
  },
  {
    id: 'lucky_multiplier', weight: 1, category: 'chaos', label: 'Lucky Multiplier x2',
    resolve: async ({ guildId, userId }) => {
      const award = await awardEffect(guildId, userId, 'echo_blessing_lucky_multiplier', { source: 'echo_wheel' });
      return { title: '🪄 Lucky Multiplier', body: award?.notice || 'Your next eligible reward has been doubled.' };
    },
  },
  {
    id: 'echo_blessing_cash', weight: 1, category: 'big_win', label: `Echo's Blessing +$35,000`,
    resolve: async ({ guildId, userId }) => {
      await economy.creditUser(guildId, userId, 35000, 'echo_wheel_echo_blessing', { ritual: 'echo_wheel' });
      return { title: `🌠 Echo's Blessing +$35,000`, body: `Reality bends around the result and decides you deserve a clean win.\n\n**${money(35000)}** added to your wallet.` };
    },
  },
  {
    id: 'void_spin', weight: 0.35, category: 'chaos', label: 'Void Spin',
    resolve: async ({ guildId, userId }) => {
      const balance = await economy.getWalletBalance(guildId, userId);
      const taken = Math.max(0, Math.floor(balance));
      if (taken > 0) await economy.tryDebitUser(guildId, userId, taken, 'echo_wheel_void_spin', { ritual: 'echo_wheel' }).catch(() => {});
      return { title: '🌌 Void Spin', body: `The symbols vanish. The lights die. When they come back, your wallet is gone.\n\n**${money(taken)}** was consumed by the void.` };
    },
  },
  {
    id: 'echo_prank', weight: 1.65, category: 'chaos', label: `Echo's Prank`,
    resolve: async ({ guildId, userId }) => {
      const prank = weightedPick([
        { id: 'blessing_percent', weight: 45 },
        { id: 'blessing_flat', weight: 25 },
        { id: 'curse_percent', weight: 20 },
        { id: 'curse_flat', weight: 10 },
      ]);
      const map = {
        blessing_percent: 'echo_blessing_minor_percent',
        blessing_flat: 'echo_blessing_minor_flat',
        curse_percent: 'echo_curse_minor_percent',
        curse_flat: 'echo_curse_minor_flat',
      };
      const award = await awardEffect(guildId, userId, map[prank.id], { source: 'echo_wheel_echo_prank' });
      return { title: `🃏 Echo's Prank`, body: award?.notice || 'Echo does something deeply unhelpful and then refuses to explain itself.' };
    },
  },
];

function getSession(guildId, userId) {
  pruneSessions();
  return sessions.get(`${guildId}:${userId}`) || null;
}

function setSession(session) {
  session.updatedAt = Date.now();
  sessions.set(`${session.guildId}:${session.userId}`, session);
  return session;
}

function clearSession(guildId, userId) {
  sessions.delete(`${guildId}:${userId}`);
}

function pruneSessions() {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [key, session] of sessions.entries()) {
    if (!session || Number(session.updatedAt || 0) < cutoff) sessions.delete(key);
  }
}

async function setCooldown(guildId, userId, nextClaimAt) {
  await pool.query(
    `INSERT INTO cooldowns (guild_id, user_id, key, next_claim_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (guild_id, user_id, key) DO UPDATE SET next_claim_at = EXCLUDED.next_claim_at`,
    [String(guildId), String(userId), 'echo_wheel', nextClaimAt]
  );
}

function buildIntroEmbed(session, statusText = null) {
  const embed = new EmbedBuilder()
    .setColor(0x7a2bff)
    .setTitle('🎡 Echo Wheel')
    .setDescription(
      `Step up, pay **${money(COST)}**, and let Echo decide what kind of day you're having.\n\n` +
      `**Outcome spread**\n• Small wins\n• Neutrals\n• Bad outcomes\n• Big wins\n• Rare chaos`
    )
    .addFields(
      { name: 'Cost', value: `${money(COST)} from your **wallet**`, inline: true },
      { name: 'Limit', value: 'Once per Sydney day\n_(unless the wheel grants a free spin)_', inline: true },
      { name: 'Examples', value: '+$3,000 • Random item • Jackpot • Jail • Account Frozen • Casino Voucher • Void Spin', inline: false },
    )
    .setFooter({ text: 'Good outcomes never auto-curse you. Bad outcomes never auto-bless you.' });

  if (statusText) embed.addFields({ name: 'Latest Result', value: String(statusText).slice(0, 1024) });
  return embed;
}

function buildSpinEmbed(text) {
  return new EmbedBuilder()
    .setColor(0x7a2bff)
    .setTitle('🎡 Echo Wheel')
    .setDescription(text)
    .setFooter({ text: 'The wheel is in motion… probably.' });
}

function buildResultEmbed(result, session) {
  const colors = {
    small_win: 0x4caf50,
    neutral: 0x95a5a6,
    bad: 0xe74c3c,
    big_win: 0xf1c40f,
    chaos: 0x9b59ff,
  };
  return new EmbedBuilder()
    .setColor(colors[result.category] || 0x7a2bff)
    .setTitle(`🎡 Echo Wheel — ${result.title}`)
    .setDescription(result.body)
    .addFields(
      { name: 'Spin Cost', value: money(COST), inline: true },
      { name: 'Outcome Tier', value: formatCategory(result.category), inline: true },
      { name: 'Next Step', value: session.canRespin ? 'Echo granted you a free extra spin.' : `Return <t:${Math.floor(nextSydneyMidnightUTC().getTime()/1000)}:R>.`, inline: false },
    );
}

function buildComponents(session, mode = 'intro') {
  if (mode === 'spinning') {
    return [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(BTN_SPIN).setLabel('Spinning…').setStyle(ButtonStyle.Secondary).setDisabled(true)
    )];
  }

  if (mode === 'result') {
    return [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(BTN_SPIN).setLabel(session.canRespin ? 'Use Free Spin' : 'Spin Used').setStyle(session.canRespin ? ButtonStyle.Success : ButtonStyle.Secondary).setDisabled(!session.canRespin),
      new ButtonBuilder().setCustomId(BTN_BACK).setLabel('Back to Rituals').setStyle(ButtonStyle.Secondary),
    )];
  }

  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(BTN_SPIN).setLabel(session.canRespin ? 'Use Free Spin' : `Spin for ${money(COST)}`).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(BTN_BACK).setLabel('Back to Rituals').setStyle(ButtonStyle.Secondary),
  )];
}

function formatCategory(category) {
  return {
    small_win: 'Small Win',
    neutral: 'Neutral',
    bad: 'Bad Outcome',
    big_win: 'Big Win',
    chaos: 'Chaos',
  }[category] || 'Unknown';
}

async function debitUpTo(guildId, userId, target, type, meta = {}) {
  const balance = await economy.getWalletBalance(guildId, userId);
  const take = Math.max(0, Math.min(Number(target || 0), balance));
  if (take > 0) {
    await economy.tryDebitUser(guildId, userId, take, type, meta).catch(() => {});
  }
  return take;
}

async function pickRandomRecipient(guildId, userId) {
  const res = await pool.query(
    `SELECT user_id
       FROM user_balances
      WHERE guild_id=$1 AND user_id <> $2
      ORDER BY RANDOM()
      LIMIT 1`,
    [String(guildId), String(userId)]
  ).catch(() => ({ rows: [] }));
  return res.rows?.[0]?.user_id ? String(res.rows[0].user_id) : null;
}

async function drawRandomStoreItem(guildId) {
  const res = await pool.query(
    `SELECT item_id, name
       FROM store_items
      WHERE guild_id=$1 AND enabled=true
      ORDER BY RANDOM()
      LIMIT 1`,
    [String(guildId)]
  ).catch(() => ({ rows: [] }));

  if (res.rows?.[0]?.item_id) {
    return { itemId: String(res.rows[0].item_id), name: String(res.rows[0].name || res.rows[0].item_id) };
  }
  return RANDOM_ITEM_FALLBACKS[Math.floor(Math.random() * RANDOM_ITEM_FALLBACKS.length)];
}

function pickOutcome() {
  return weightedPick(OUTCOMES);
}

async function animateSpin(interaction) {
  const steps = [
    `The wheel shudders to life…\n\n**${SPINNER_FRAMES[0]}**`,
    `Echo leans in. The symbols blur.\n\n**${SPINNER_FRAMES[randInt(0, SPINNER_FRAMES.length - 1)]}**`,
    `The room tilts. The wheel keeps running.\n\n**${SPINNER_FRAMES[randInt(0, SPINNER_FRAMES.length - 1)]}**`,
    `It slows just enough to feel cruel.\n\n**${SPINNER_FRAMES[randInt(0, SPINNER_FRAMES.length - 1)]}**`,
  ];

  for (const frame of steps) {
    await interaction.editReply({ embeds: [buildSpinEmbed(frame)], components: buildComponents({}, 'spinning') }).catch(() => {});
    await wait(650);
  }
}

async function resolveSpin({ interaction, session }) {
  await animateSpin(interaction);

  const outcome = pickOutcome();
  const result = await outcome.resolve({ guildId: session.guildId, userId: session.userId, interaction, session });
  const final = {
    id: outcome.id,
    category: outcome.category,
    title: result.title,
    body: result.body,
    contractEarnings: Math.max(0, Math.floor(Number(result?.contractEarnings || 0))),
  };

  if (!session.canRespin) {
    await setCooldown(session.guildId, session.userId, nextSydneyMidnightUTC());
  }

  await recordRitualContractProgress(session.guildId, session.userId, final.contractEarnings || 0);

  session.lastResult = final;
  setSession(session);

  await interaction.editReply({
    embeds: [buildResultEmbed(final, session)],
    components: buildComponents(session, 'result'),
  }).catch(() => {});
}

module.exports = {
  id: 'echo_wheel',
  placement: 'other',
  interactive: true,
  type: 'echo_wheel',
  awardSource: 'echo_wheel',
  cooldownKey: 'echo_wheel',
  name: 'Echo Wheel',
  shortName: 'Echo Wheel',
  description: 'Pay for a single daily spin and let Echo hand you a perk, a setback, or something much stranger.',
  nextClaimAt: nextSydneyMidnightUTC,
  claimText: () => '',
  cooldownText: ({ unix }) => `⏳ **Echo Wheel** has already been spun today. Return <t:${unix}:R>.`,

  async begin(interaction, { buildHubPayload } = {}) {
    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    const status = await getRitualStatus(guildId, userId, module.exports);
    let session = getSession(guildId, userId);

    if (!session) {
      session = setSession({ guildId, userId, canRespin: false, lastResult: null, updatedAt: Date.now() });
    }

    if (!status.available && !session.canRespin) {
      await interaction.deferUpdate().catch(() => {});
      await interaction.editReply({
        embeds: [buildIntroEmbed(session, module.exports.cooldownText({ unix: status.unix, nextClaimAt: status.nextClaimAt }))],
        components: buildComponents({ canRespin: false }, 'result'),
      }).catch(() => {});
      return true;
    }

    await interaction.deferUpdate().catch(() => {});
    await interaction.editReply({
      embeds: [buildIntroEmbed(session, session.lastResult?.title ? `${session.lastResult.title}\n${session.lastResult.body}` : null)],
      components: buildComponents(session, 'intro'),
    }).catch(() => {});
    return true;
  },

  async handleInteraction(interaction, { buildHubPayload } = {}) {
    const cid = String(interaction.customId || '');
    if (!interaction.isButton?.() || (cid !== BTN_SPIN && cid !== BTN_BACK)) return false;
    if (!interaction.inGuild()) {
      await interaction.reply({ content: '❌ Server only.', flags: MessageFlags.Ephemeral }).catch(() => {});
      return true;
    }

    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    let session = getSession(guildId, userId) || setSession({ guildId, userId, canRespin: false, lastResult: null, updatedAt: Date.now() });

    if (cid === BTN_BACK) {
      await interaction.deferUpdate().catch(() => {});
      const payload = await buildHubPayload(guildId, userId, session.lastResult ? `${session.lastResult.title}\n${session.lastResult.body}` : null);
      await interaction.editReply(payload).catch(() => {});
      return true;
    }

    const status = await getRitualStatus(guildId, userId, module.exports);
    if (!status.available && !session.canRespin) {
      await interaction.reply({ content: module.exports.cooldownText({ unix: status.unix, nextClaimAt: status.nextClaimAt }), flags: MessageFlags.Ephemeral }).catch(() => {});
      return true;
    }

    if (!session.canRespin) {
      const charge = await economy.tryDebitUser(guildId, userId, COST, 'echo_wheel_spin', { ritual: 'echo_wheel' });
      if (!charge?.ok) {
        await interaction.reply({ content: `❌ You need **${money(COST)}** in your wallet to spin the wheel.`, flags: MessageFlags.Ephemeral }).catch(() => {});
        return true;
      }
    } else {
      session.canRespin = false;
      setSession(session);
    }

    await interaction.deferUpdate().catch(() => {});
    await resolveSpin({ interaction, session });
    return true;
  },
};
