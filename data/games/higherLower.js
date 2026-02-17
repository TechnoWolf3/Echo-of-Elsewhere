// data/games/higherLower.js
// Higher or Lower (casino) game module used by /games hub (NOT a slash command).
// Patterned after blackjack/roulette modules: lobby panel + buttons + bet modal + collector routing.

const {
  MessageFlags,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const { activeGames } = require("../../utils/gameManager");
const { setActiveGame, updateActiveGame, clearActiveGame } = require("../../utils/gamesHubState");

const {
  tryDebitUser,
  creditUser,
  addServerBank,
  bankToUserIfEnough,
  getBalance,
} = require("../../utils/economy");

const { unlockAchievement } = require("../../utils/achievementEngine");
const { guardNotJailedComponent } = require("../../utils/jail");

// Casino security / fee helpers (mirrors roulette implementation)
const {
  ensureHostSecurity,
  getPlayerSecuritySafe,
  maybeAnnounceCasinoSecurity,
  getEffectiveFeePct,
  computeFeeForBet,
} = require("../../utils/casinoSecurity");

// -------------------- Rules / constants --------------------
const RULES = {
  MIN_BET: 500,
  MAX_PLAYERS: 10,
  ROUND_TIMEOUT_MS: 60_000,
  // payout multiplier based on current streak when cashing out
  // streak 0 => 1.0x (you get your bet back)
  // streak 1 => 1.5x, streak 2 => 2.0x ... capped
  MULTIPLIER_BASE: 1.0,
  MULTIPLIER_STEP: 0.5,
  MULTIPLIER_CAP: 10.0,

  HIGH_ROLLER_BET: 50_000, // for achievement hook
};

// Cards: 2..14 where 11=J 12=Q 13=K 14=A
const RANKS = [
  { v: 2, s: "2" },
  { v: 3, s: "3" },
  { v: 4, s: "4" },
  { v: 5, s: "5" },
  { v: 6, s: "6" },
  { v: 7, s: "7" },
  { v: 8, s: "8" },
  { v: 9, s: "9" },
  { v: 10, s: "10" },
  { v: 11, s: "J" },
  { v: 12, s: "Q" },
  { v: 13, s: "K" },
  { v: 14, s: "A" },
];

function drawCard() {
  const r = RANKS[Math.floor(Math.random() * RANKS.length)];
  // Suit is cosmetic only
  const suits = ["♠️", "♥️", "♦️", "♣️"];
  const suit = suits[Math.floor(Math.random() * suits.length)];
  return { value: r.v, label: `${r.s}${suit}` };
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function formatMoney(n) {
  const x = Number(n || 0);
  return `$${x.toLocaleString("en-US")}`;
}

function safeParseBet(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return { ok: false, amount: 0 };
  const cleaned = s.replace(/[$,\s]/g, "");
  const amount = Number(cleaned);
  if (!Number.isFinite(amount)) return { ok: false, amount: 0 };
  const whole = Math.floor(amount);
  return { ok: true, amount: whole };
}

async function sendEphemeralToast(i, content) {
  if (!i) return;
  const payload = { content, flags: MessageFlags.Ephemeral };
  if (i.deferred || i.replied) return i.followUp(payload).catch(() => {});
  return i.reply(payload).catch(() => {});
}

async function showBetModal(i, tableId) {
  const modal = new ModalBuilder()
    .setCustomId(`holbet:${tableId}`)
    .setTitle("Set Higher or Lower Bet")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("amount") // MUST match blackjack/roulette convention
          .setLabel(`Bet amount (min ${RULES.MIN_BET})`)
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("e.g. 5000")
          .setRequired(true)
      )
    );

  await i.showModal(modal);

  const submitted = await i
    .awaitModalSubmit({
      time: 60_000,
      filter: (m) => m.customId === `holbet:${tableId}` && m.user.id === i.user.id,
    })
    .catch(() => null);

  return submitted;
}

async function chargeWithCasinoFee({ guildId, userId, amountStake, type, meta, table, channel, hostId }) {
  const hostSec = await ensureHostSecurity(table, guildId, hostId);
  const playerSec = await getPlayerSecuritySafe(guildId, userId);

  try {
    const db = channel?.client?.db;
    const displayName = meta?.displayName || meta?.username || "Unknown";
    await maybeAnnounceCasinoSecurity({ db, channel, guildId, userId, displayName, current: playerSec });
  } catch {}

  const effectiveFeePct = getEffectiveFeePct({
    playerFeePct: playerSec.feePct,
    hostBaseFeePct: hostSec.feePct,
  });

  const feeCalc = computeFeeForBet(amountStake, effectiveFeePct);

  const debit = await tryDebitUser(guildId, userId, feeCalc.totalCharge, type, {
    ...meta,
    casinoSecurity: {
      hostBaseLevel: hostSec.level,
      hostBaseFeePct: hostSec.feePct,
      playerLevel: playerSec.level,
      playerFeePct: playerSec.feePct,
      effectiveFeePct,
      feeAmount: feeCalc.feeAmount,
      betAmount: feeCalc.betAmount,
      totalCharge: feeCalc.totalCharge,
    },
  });

  return {
    ok: debit.ok,
    betAmount: feeCalc.betAmount,
    feeAmount: feeCalc.feeAmount,
    totalCharge: feeCalc.totalCharge,
    effectiveFeePct,
    playerSec,
  };
}

// -------------------- Session --------------------
class HigherLowerTable {
  constructor({ guildId, channel, hostId }) {
    this.guildId = guildId;
    this.channel = channel;
    this.hostId = hostId;
    this.channelId = channel.id;

    this.tableId = `hol${Math.random().toString(16).slice(2, 10)}`;
    this.state = "lobby"; // lobby | playing | ended
    this.message = null;
    this.endHandled = false;

    this.players = new Map(); // userId -> { userId, tag, betAmount, paid, alive, streak, choice, lastResult }
    this.currentCard = null;
    this.round = 0;
  }

  get playerList() {
    return [...this.players.values()];
  }

  isHost(userId) {
    return userId === this.hostId;
  }

  addPlayer(user) {
    if (this.players.size >= RULES.MAX_PLAYERS) return false;
    if (this.players.has(user.id)) return true;

    this.players.set(user.id, {
      userId: user.id,
      tag: user.tag || `<@${user.id}>`,
      betAmount: 0,
      paid: false,
      alive: true,
      streak: 0,
      choice: null,
      lastResult: null,
    });
    return true;
  }

  removePlayer(userId) {
    this.players.delete(userId);
  }

  resetChoices() {
    for (const p of this.players.values()) p.choice = null;
  }

  buildEmbed() {
    const e = new EmbedBuilder().setTitle("🔼🔽 Higher or Lower");

    if (this.state === "lobby") {
      e.setDescription("Dealer: *Not dealt yet*");
    } else if (this.state === "playing") {
      e.setDescription(`Current card: **${this.currentCard?.label || "?"}**`);
    } else {
      e.setDescription("Table ended.");
    }

    const lines = [];
    const alive = this.playerList.filter((p) => p.alive);
    e.addFields(
      {
        name: `Players (${this.players.size}/${RULES.MAX_PLAYERS}):`,
        value:
          this.players.size === 0
            ? "*None yet*"
            : this.playerList
                .map((p) => {
                  const status = p.alive ? "✅" : "❌";
                  const bet = p.betAmount ? formatMoney(p.betAmount) : "No bet";
                  const streak = p.streak || 0;
                  return `${status} <@${p.userId}> — Bet: **${bet}** — Streak: **${streak}**`;
                })
                .join("\n"),
      },
      {
        name: "Rules",
        value: `Minimum bet: **${formatMoney(RULES.MIN_BET)}**\nTies are a loss.`,
      }
    );

    if (this.state === "playing") {
      e.addFields({
        name: "Round",
        value: `#${this.round}\nAlive: **${alive.length}**`,
        inline: true,
      });
    }

    e.setFooter({ text: `Table ID: ${this.tableId}` });
    return e;
  }

  buildComponents() {
    const baseRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`hol:join:${this.tableId}`).setLabel("Join").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`hol:leave:${this.tableId}`).setLabel("Leave").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`hol:setbet:${this.tableId}`).setLabel("Set Bet").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`hol:start:${this.tableId}`).setLabel("Start").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`hol:end:${this.tableId}`).setLabel("End").setStyle(ButtonStyle.Danger)
    );

    if (this.state !== "playing") return [baseRow];

    const playRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`hol:pick:higher:${this.tableId}`).setLabel("Higher").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`hol:pick:lower:${this.tableId}`).setLabel("Lower").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`hol:cashout:${this.tableId}`).setLabel("Cash Out").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`hol:refresh:${this.tableId}`).setLabel("Refresh").setStyle(ButtonStyle.Secondary)
    );

    return [baseRow, playRow];
  }

  async postOrEditPanel() {
    const payload = {
      embeds: [this.buildEmbed()],
      components: this.buildComponents(),
    };

    if (!this.message) {
      this.message = await this.channel.send(payload);
      return;
    }
    await this.message.edit(payload).catch(() => {});
  }

  async startGame() {
    this.state = "playing";
    this.currentCard = drawCard();
    this.round = 1;
    this.resetChoices();
    // everyone alive at start
    for (const p of this.players.values()) {
      p.alive = true;
      p.streak = 0;
      p.lastResult = null;
    }
    await this.postOrEditPanel();
  }

  multiplierFor(streak) {
    const m = RULES.MULTIPLIER_BASE + RULES.MULTIPLIER_STEP * Number(streak || 0);
    return clamp(m, RULES.MULTIPLIER_BASE, RULES.MULTIPLIER_CAP);
  }

  async resolveRound() {
    const next = drawCard();
    const prevVal = this.currentCard?.value ?? 0;

    // higher means next.value > prevVal
    // lower means next.value < prevVal
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      if (!p.choice) continue; // unanswered stay pending

      const cmp = next.value === prevVal ? "tie" : next.value > prevVal ? "higher" : "lower";
      const correct = cmp !== "tie" && p.choice === cmp;

      if (correct) {
        p.streak += 1;
        p.lastResult = "✅ Correct";
      } else {
        p.alive = false;
        p.lastResult = cmp === "tie" ? "❌ Tie (loss)" : "❌ Wrong";
        // achievement: first bust
        await safeUnlock(this.channel, "hol_first_bust", { tableId: this.tableId, userId: p.userId }).catch(() => {});
      }
      p.choice = null;
    }

    this.currentCard = next;
    this.round += 1;
    await this.postOrEditPanel();

    // auto-unlock streak 5 for anyone still alive with streak>=5
    for (const p of this.players.values()) {
      if (p.alive && p.streak >= 5) {
        await safeUnlock(this.channel, "hol_streak_5", { tableId: this.tableId, userId: p.userId, streak: p.streak }).catch(() => {});
      }
    }
  }
}

// achievements helper: do not break if missing
async function safeUnlock(channel, achievementId, meta) {
  try {
    if (!channel?.guildId) return;
    await unlockAchievement(channel.guildId, meta?.userId, achievementId, meta);
  } catch {}
}

// -------------------- Interaction handlers --------------------
async function startFromHub(interaction, ctx = {}) {
  return startLobbyFromHub(interaction);
}

async function startLobbyFromHub(interaction) {
  if (!interaction.inGuild()) {
    return interaction.reply({ content: "❌ Server only.", flags: MessageFlags.Ephemeral }).catch(() => {});
  }

  if (await guardNotJailedComponent(interaction)) return;

  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
  }

  const channel = interaction.channel;
  const guildId = interaction.guildId;
  const channelId = channel.id;

  // One active game per channel (enforced by hub state)
  const existing = activeGames.get(channelId);
  if (existing) {
    await interaction.editReply("⚠️ A game is already active in this channel. End it first.");
    return;
  }

  const table = new HigherLowerTable({ guildId, channel, hostId: interaction.user.id });

  activeGames.set(channelId, table);
  setActiveGame(channelId, { type: "higherlower", state: "lobby", tableId: table.tableId, hostId: table.hostId });

  table.addPlayer(interaction.user);
  await table.postOrEditPanel();

  const collector = table.message.createMessageComponentCollector({ time: 30 * 60_000 });
  wireCollectorHandlers({ collector, table, guildId, channelId });

  await interaction.editReply("🔼🔽 Higher or Lower table launched. Players: **Join** then **Set Bet**.");
}

function wireCollectorHandlers({ collector, table, guildId, channelId }) {
  const tableId = table.tableId;

  async function endTable(triggerInteraction) {
    if (table.endHandled) return;
    table.endHandled = true;
    table.state = "ended";

    activeGames.delete(channelId);
    clearActiveGame(channelId);

    // disable components
    const payload = {
      embeds: [table.buildEmbed()],
      components: [],
    };
    await table.message.edit(payload).catch(() => {});
    collector.stop("ended");

    if (triggerInteraction) {
      await sendEphemeralToast(triggerInteraction, "🛑 Table ended.").catch(() => {});
    }
  }

  async function placeBet(i) {
    // Jail gate for component actions
    if (await guardNotJailedComponent(i)) return;

    const p = table.players.get(i.user.id);
    if (!p) {
      await sendEphemeralToast(i, "❌ You need to **Join** first.");
      return;
    }

    // show modal
    const submitted = await showBetModal(i, tableId);
    if (!submitted) {
      await sendEphemeralToast(i, "⏱️ Bet modal timed out.");
      return;
    }

    // Always ACK modal submit quickly
    if (!submitted.deferred && !submitted.replied) {
      await submitted.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    try {
      const raw = submitted.fields.getTextInputValue("amount");
      const parsed = safeParseBet(raw);

      if (!parsed.ok) {
        await submitted.editReply("❌ Invalid bet amount. Use numbers only (e.g. 5000).");
        return;
      }

      const amount = parsed.amount;

      if (amount < RULES.MIN_BET) {
        await submitted.editReply(`❌ Minimum bet is ${formatMoney(RULES.MIN_BET)}.`);
        return;
      }

      // if already paid, let them change bet? We'll require clearing by ending & relaunching for simplicity.
      // But we *can* support overwrite by debiting the difference. Keep it safe: do not allow changes once paid.
      if (p.paid) {
        await submitted.editReply("⚠️ You already placed a bet for this table.");
        return;
      }

      const charge = await chargeWithCasinoFee({
        guildId,
        userId: i.user.id,
        amountStake: amount,
        type: "hol_bank_buyin",
        meta: { channelId, tableId, userId: i.user.id, displayName: i.user.username },
        table,
        channel: i.channel,
        hostId: table.hostId,
      });

      if (!charge.ok) {
        await submitted.editReply("❌ Not enough balance for that bet + table fee.");
        return;
      }

      // credit house bank (bet + fee separately)
      await addServerBank(guildId, amount, "hol_bank_buyin", { channelId, tableId, userId: i.user.id });
      if (charge.feeAmount > 0) {
        await addServerBank(guildId, charge.feeAmount, "hol_fee_bank_buyin", {
          channelId,
          tableId,
          userId: i.user.id,
          feeAmount: charge.feeAmount,
          effectiveFeePct: charge.effectiveFeePct,
        });
      }

      p.betAmount = amount;
      p.paid = true;

      // achievements
      await safeUnlock(i.channel, "hol_first_cashout", { tableId, userId: i.user.id, event: "bet_placed" }).catch(() => {});
      if (amount >= RULES.HIGH_ROLLER_BET) {
        await safeUnlock(i.channel, "hol_high_roller", { tableId, userId: i.user.id, bet: amount }).catch(() => {});
      }

      await submitted.editReply(`✅ Bet set: **${formatMoney(amount)}**`);
      await table.postOrEditPanel();
    } catch (err) {
      // prevent "interaction wasn't handled"
      try {
        await submitted.editReply("❌ Something went wrong setting your bet. Try again.");
      } catch {}
      console.warn("[HigherLower] placeBet failed:", err?.rawError?.message || err?.message || err);
    }
  }

  async function onPick(i, pick) {
    if (await guardNotJailedComponent(i)) return;
    if (table.state !== "playing") {
      await sendEphemeralToast(i, "⚠️ The game hasn't started yet.");
      return;
    }

    const p = table.players.get(i.user.id);
    if (!p) return sendEphemeralToast(i, "❌ You must Join first.");
    if (!p.paid) return sendEphemeralToast(i, "❌ Set your bet first.");
    if (!p.alive) return sendEphemeralToast(i, "⚠️ You're busted. Wait for the next table.");

    p.choice = pick; // "higher" | "lower"
    await i.deferUpdate().catch(() => {});
    await table.postOrEditPanel();

    // If all alive players with bets have chosen, resolve immediately
    const alive = table.playerList.filter((x) => x.alive && x.paid);
    const allPicked = alive.length > 0 && alive.every((x) => !!x.choice);
    if (allPicked) {
      await table.resolveRound();
    }
  }

  async function cashOut(i) {
    if (await guardNotJailedComponent(i)) return;
    const p = table.players.get(i.user.id);
    if (!p) return sendEphemeralToast(i, "❌ You must Join first.");
    if (!p.paid) return sendEphemeralToast(i, "❌ Set your bet first.");
    if (!p.alive) return sendEphemeralToast(i, "⚠️ You're busted. No cash out.");

    const mult = table.multiplierFor(p.streak);
    const payoutWanted = Math.floor(p.betAmount * mult);

    // House pays from bank if possible
    const paid = await bankToUserIfEnough(guildId, i.user.id, payoutWanted, "hol_payout", {
      channelId,
      tableId,
      userId: i.user.id,
      betAmount: p.betAmount,
      streak: p.streak,
      multiplier: mult,
      payoutWanted,
    });

    if (!paid?.ok) {
      await sendEphemeralToast(i, "🏦 House bank can't cover that payout right now. Try a smaller cashout later.");
      return;
    }

    p.alive = false; // cashing out removes you from current run
    p.lastResult = `💰 Cashed out: ${formatMoney(payoutWanted)} (x${mult.toFixed(1)})`;

    await safeUnlock(i.channel, "hol_first_cashout", { tableId, userId: i.user.id, payout: payoutWanted }).catch(() => {});
    await i.deferUpdate().catch(() => {});
    await table.postOrEditPanel();
  }

  collector.on("collect", async (i) => {
    try {
      // Only handle this table's components
      if (!i.customId || !i.customId.includes(`:${tableId}`)) return;

      const [prefix, action, a2, a3] = i.customId.split(":");

      if (prefix !== "hol") return;

      if (action === "join") {
        if (await guardNotJailedComponent(i)) return;
        table.addPlayer(i.user);
        await i.deferUpdate().catch(() => {});
        await table.postOrEditPanel();
        return;
      }

      if (action === "leave") {
        if (await guardNotJailedComponent(i)) return;
        table.removePlayer(i.user.id);
        await i.deferUpdate().catch(() => {});
        await table.postOrEditPanel();
        return;
      }

      if (action === "setbet") {
        // NOTE: showModal counts as acknowledgment for the original interaction
        await placeBet(i);
        return;
      }

      if (action === "start") {
        if (!table.isHost(i.user.id)) return sendEphemeralToast(i, "❌ Only the host can start.");
        if (table.players.size === 0) return sendEphemeralToast(i, "❌ No players.");
        // require all players to have bets? We'll allow start if host wants, but warn.
        const paid = table.playerList.filter((p) => p.paid).length;
        if (paid === 0) return sendEphemeralToast(i, "❌ At least one player must Set Bet.");
        await i.deferUpdate().catch(() => {});
        await table.startGame();
        updateActiveGame(channelId, { state: "playing" });
        return;
      }

      if (action === "end") {
        if (!table.isHost(i.user.id)) return sendEphemeralToast(i, "❌ Only the host can end.");
        await i.deferUpdate().catch(() => {});
        await endTable(i);
        return;
      }

      if (action === "refresh") {
        await i.deferUpdate().catch(() => {});
        await table.postOrEditPanel();
        return;
      }

      if (action === "pick") {
        const pick = a2; // higher/lower
        await onPick(i, pick);
        return;
      }

      if (action === "cashout") {
        await cashOut(i);
        return;
      }
    } catch (err) {
      console.warn("[HigherLower] collector handler error:", err?.rawError?.message || err?.message || err);
      // Try to acknowledge so Discord doesn't complain
      try {
        if (i.isRepliable() && !i.deferred && !i.replied) {
          await i.reply({ content: "❌ Something went wrong.", flags: MessageFlags.Ephemeral }).catch(() => {});
        }
      } catch {}
    }
  });

  collector.on("end", async () => {
    if (!table.endHandled) {
      // auto-end on timeout
      await endTable().catch(() => {});
    }
  });
}

module.exports = {
  startFromHub,
};
