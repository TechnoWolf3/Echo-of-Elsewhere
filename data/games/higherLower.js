// data/games/higherLower.js
// Higher or Lower game module used by /games hub (NOT a slash command).
// Buttons are handled via message component collector.
// Modals are routed via root index.js calling handleInteraction(interaction).

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
const { setActiveGame, clearActiveGame } = require("../../utils/gamesHubState");
const { tryDebitUser, bankToUserIfEnough } = require("../../utils/economy");

const { unlockAchievement } = require("../../utils/achievementEngine");
const { guardNotJailedComponent } = require("../../utils/jail");
const { guardGamesComponent } = require("../../utils/echoRift/curseGuard");

const {
  getUserCasinoSecurity,
  getHostBaseSecurity,
  getEffectiveFeePct,
  computeFeeForBet,
  maybeAnnounceCasinoSecurity,
} = require("../../utils/casinoSecurity");

const MIN_BET = 500;
const MAX_BET = 250000;

const tablesById = new Map(); // tableId -> table

const ACH = {
  FIRST_CASHOUT: "hol_first_cashout",
  FIRST_BUST: "hol_first_bust",
  STREAK_5: "hol_streak_5",
  HIGH_ROLLER: "hol_high_roller",
};
const RULES = { HIGH_ROLLER_BET: 50_000 };

// IMPORTANT:
// Custom IDs use colon delimiters. Do NOT put colons inside tableId itself.
function makeTableId() {
  return `${Math.random().toString(16).slice(2, 10)}${Math.random().toString(16).slice(2, 6)}`;
}

function parseAmount(input) {
  const raw = String(input || "").trim();
  if (!raw) return NaN;
  const cleaned = raw.replace(/[$,\s]/g, "");
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return NaN;
  return Math.floor(n);
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

// ---------- Casino Security fee helper ----------
async function ensureHostSecurity(table, guildId, hostId) {
  if (table.hostSecurity) return table.hostSecurity;
  try {
    table.hostSecurity = await getHostBaseSecurity(guildId, hostId);
  } catch (e) {
    console.error("[higherlower] failed to get host base security:", e);
    table.hostSecurity = { level: 0, label: "Normal", feePct: 0 };
  }
  return table.hostSecurity;
}

async function getPlayerSecuritySafe(guildId, userId) {
  try {
    return await getUserCasinoSecurity(guildId, userId);
  } catch (e) {
    console.error("[higherlower] failed to get player security:", e);
    return { level: 0, label: "Normal", feePct: 0 };
  }
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

// ---------- Cards ----------
const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
function rankValue(r) {
  if (r === "A") return 14;
  if (r === "K") return 13;
  if (r === "Q") return 12;
  if (r === "J") return 11;
  return Number(r);
}
function newDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ r, s, v: rankValue(r) });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
function cardStr(c) {
  return `**${c.r}${c.s}**`;
}

function buildLobbyEmbed(table) {
  const lines = [];
  for (const p of table.players.values()) {
    const paid = p.paid ? "✅" : "❌";
    const bet = p.betAmount ? `$${Number(p.betAmount).toLocaleString()}` : `$${MIN_BET.toLocaleString()}`;
    lines.push(`${paid} <@${p.userId}> — Bet: **${bet}**`);
  }
  const playersBlock = lines.length ? lines.join("\n") : "_No players yet._";

  return new EmbedBuilder()
    .setTitle("🔼🔽 Higher or Lower")
    .setDescription(
      `Dealer: ${table.currentCard ? cardStr(table.currentCard) : "*Not dealt yet*"}\n` +
      `Players (${table.players.size}/${table.maxPlayers}):\n${playersBlock}\n\n` +
      `**Rules**\nMinimum bet: **$${MIN_BET.toLocaleString()}** • Ties are a loss.`
    )
    .setFooter({ text: `Table ID: hol${table.tableId}` });
}

function buildRoundEmbed(table) {
  const alive = [...table.players.values()].filter((p) => p.alive);
  const lines = alive.map((p) => {
    const pick = p.pick ? (p.pick === "higher" ? "🔼" : "🔽") : "…";
    return `${pick} <@${p.userId}> — streak **${p.streak || 0}**`;
  });

  const status = table.currentCard ? `Current card: ${cardStr(table.currentCard)}` : "Current card: —";

  return new EmbedBuilder()
    .setTitle("🔼🔽 Higher or Lower")
    .setDescription(
      `${status}\n\n` +
      `**Alive (${alive.length})**\n${lines.join("\n") || "_Nobody alive._"}\n\n` +
      `Pick **Higher (🔼)** or **Lower (🔽)**.`
    )
    .setFooter({ text: `Table ID: hol${table.tableId}` });
}

function btn(tableId, action, label, style, extra = {}) {
  const b = new ButtonBuilder()
    .setCustomId(`hol:${tableId}:${action}`)
    .setStyle(style);
  if (label) b.setLabel(label);
  if (extra.emoji) b.setEmoji(extra.emoji);
  if (typeof extra.disabled === "boolean") b.setDisabled(extra.disabled);
  return b;
}

function buildLobbyComponents(table) {
  return [
    new ActionRowBuilder().addComponents(
      btn(table.tableId, "join", "Join", ButtonStyle.Success),
      btn(table.tableId, "leave", "Leave", ButtonStyle.Secondary),
      btn(table.tableId, "setbet", "Set Bet", ButtonStyle.Primary),
      btn(table.tableId, "start", "Start", ButtonStyle.Success, { disabled: table.players.size === 0 || !allPlayersPaid(table) }),
      btn(table.tableId, "end", "End", ButtonStyle.Danger)
    ),
  ];
}

function buildRoundComponents(table) {
  const anyAlive = [...table.players.values()].some((p) => p.alive);
  return [
    new ActionRowBuilder().addComponents(
      btn(table.tableId, "higher", "Higher", ButtonStyle.Primary, { emoji: "🔼", disabled: !anyAlive }),
      btn(table.tableId, "lower", "Lower", ButtonStyle.Primary, { emoji: "🔽", disabled: !anyAlive }),
      btn(table.tableId, "cashout", "Cash Out", ButtonStyle.Success, { disabled: !anyAlive }),
      btn(table.tableId, "end", "End", ButtonStyle.Danger)
    ),
  ];
}

function allPlayersPaid(table) {
  if (table.players.size === 0) return false;
  for (const p of table.players.values()) if (!p.paid || !p.betAmount) return false;
  return true;
}

async function render(table) {
  if (!table.message) return;
  const payload =
    table.state === "round"
      ? { embeds: [buildRoundEmbed(table)], components: buildRoundComponents(table) }
      : { embeds: [buildLobbyEmbed(table)], components: buildLobbyComponents(table) };

  await table.message.edit(payload).catch(() => {});
}

async function promptAmountModal(i, tableId) {
  const modal = new ModalBuilder()
    .setCustomId(`holbet:${tableId}`)
    .setTitle("Set Higher or Lower Bet")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("amount")
          .setLabel("Bet amount (min 500)")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("e.g. 5000")
          .setRequired(true)
      )
    );

  await i.showModal(modal);
}

async function placeBet({ interaction, table, amount }) {
  const guildId = table.guildId;
  const channelId = table.channelId;
  const userId = interaction.user.id;

  if (!Number.isFinite(amount) || Number.isNaN(amount)) {
    await sendEphemeral(interaction, "❌ Please enter a valid number (e.g. 5000).");
    return false;
  }
  if (amount < MIN_BET) {
    await sendEphemeral(interaction, `❌ Minimum bet is **$${MIN_BET.toLocaleString()}**.`);
    return false;
  }
  if (amount > MAX_BET) {
    await sendEphemeral(interaction, `❌ Max bet is **$${MAX_BET.toLocaleString()}**.`);
    return false;
  }

  const p = table.players.get(userId);
  if (!p) {
    await sendEphemeral(interaction, "❌ You must **Join** the table first.");
    return false;
  }

  const charge = await chargeWithCasinoFee({
    guildId,
    userId,
    amountStake: amount,
    type: "higherlower_bet",
    meta: { channelId, tableId: `hol${table.tableId}` },
    table,
    channel: interaction.channel,
    hostId: table.hostId,
  });

  if (!charge.ok) {
    await sendEphemeral(interaction, "❌ You don’t have enough funds for that bet (including casino fee).");
    return false;
  }

  p.betAmount = charge.betAmount;
  p.paid = true;

  try {
    if (charge.betAmount >= RULES.HIGH_ROLLER_BET) {
      await unlockAchievement(interaction.channel, guildId, userId, ACH.HIGH_ROLLER);
    }
  } catch {}

  await render(table);
  return true;
}

function payoutMultiplier(streak) {
  const m = 1 + 0.5 * Math.max(0, Number(streak || 0));
  return Math.min(10, m);
}

async function cashOut(interaction, table) {
  const guildId = table.guildId;
  const userId = interaction.user.id;

  const p = table.players.get(userId);
  if (!p || !p.alive) return;

  const streak = Number(p.streak || 0);
  const mult = payoutMultiplier(streak);
  const stake = Number(p.betAmount || 0);
  const wanted = Math.floor(stake * mult);

  const pay = await bankToUserIfEnough(guildId, userId, wanted, "higherlower_payout", {
    channelId: table.channelId,
    tableId: `hol${table.tableId}`,
    streak,
    multiplier: mult,
  });

  if (!pay?.ok) {
    await bankToUserIfEnough(guildId, userId, stake, "higherlower_refund", {
      channelId: table.channelId,
      tableId: `hol${table.tableId}`,
      reason: "bank_insufficient",
    });
    await sendEphemeral(interaction, "⚠️ Server bank couldn’t cover the payout — your stake was refunded.");
  } else {
    await sendEphemeral(
      interaction,
      `✅ Cashed out! Streak **${streak}** → **x${mult.toFixed(1)}** payout: **$${wanted.toLocaleString()}**`
    );
    try {
      await unlockAchievement(interaction.channel, guildId, userId, ACH.FIRST_CASHOUT);
      if (streak >= 5) await unlockAchievement(interaction.channel, guildId, userId, ACH.STREAK_5);
    } catch {}
  }

  p.alive = false;
  p.pick = null;

  await render(table);
}

async function resolveRound(table) {
  const alive = [...table.players.values()].filter((p) => p.alive);
  if (alive.length === 0) {
    table.state = "lobby";
    table.currentCard = null;
    for (const p of table.players.values()) {
      p.paid = false;
      p.pick = null;
      p.streak = 0;
      p.alive = true;
    }
    return;
  }

  if (alive.some((p) => !p.pick)) return;

  const next = table.deck.pop() || (table.deck = newDeck(), table.deck.pop());
  const prev = table.currentCard;
  table.currentCard = next;

  for (const p of alive) {
    const correct =
      (p.pick === "higher" && next.v > prev.v) || (p.pick === "lower" && next.v < prev.v);
    if (correct) {
      p.streak = (p.streak || 0) + 1;
      p.pick = null;
    } else {
      p.alive = false;
      p.pick = null;
      try { await unlockAchievement(table.channel, table.guildId, p.userId, ACH.FIRST_BUST); } catch {}
    }
  }
}

async function startRound(interaction, table) {
  if (table.players.size === 0) {
    await sendEphemeral(interaction, "❌ No players to start.");
    return;
  }
  if (!allPlayersPaid(table)) {
    await sendEphemeral(interaction, "❌ Waiting for everyone to place a bet.");
    return;
  }

  table.state = "round";
  table.deck = newDeck();
  table.currentCard = table.deck.pop();

  for (const p of table.players.values()) {
    p.alive = true;
    p.pick = null;
    p.streak = 0;
  }

  await render(table);
}

// ---------- Hub entry ----------
async function startFromHub(interaction, { reuseMessage } = {}) {
  const channelId = interaction.channelId;

  if (activeGames.has(channelId)) {
    await interaction.followUp({ content: "❌ There’s already an active game in this channel.", flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  const tableId = makeTableId();
  const table = {
    tableId,
    guildId: interaction.guildId,
    channelId,
    hostId: interaction.user.id,
    maxPlayers: 10,
    players: new Map(),
    state: "lobby",
    deck: [],
    currentCard: null,
    message: null,
    channel: interaction.channel,
    hostSecurity: null,
  };

  tablesById.set(tableId, table);
  activeGames.set(channelId, { type: "higherlower", state: "lobby" });
  setActiveGame(channelId, { type: "higherlower", state: "lobby" });

  const msg = await interaction.channel.send({
    embeds: [buildLobbyEmbed(table)],
    components: buildLobbyComponents(table),
  });

  table.message = msg;

  const collector = msg.createMessageComponentCollector({ idle: 30 * 60 * 1000 });

  collector.on("collect", async (i) => {
    if (await guardGamesComponent(i)) return;
    if (await guardNotJailedComponent(i)) return;

    const cid = String(i.customId || "");
    if (!cid.startsWith(`hol:${tableId}:`)) return;

    const parts = cid.split(":"); // hol, <tableId>, <action>
    const action = parts[2];

    try {
      if (action === "join") {
        await i.deferUpdate().catch(() => {});
        if (table.players.has(i.user.id)) return;

        table.players.set(i.user.id, {
          userId: i.user.id,
          paid: false,
          betAmount: MIN_BET,
          alive: true,
          pick: null,
          streak: 0,
        });

        await render(table);
        return;
      }

      if (action === "leave") {
        await i.deferUpdate().catch(() => {});
        const p = table.players.get(i.user.id);
        if (!p) return;

        if (p.paid && p.betAmount) {
          await bankToUserIfEnough(table.guildId, i.user.id, Number(p.betAmount), "higherlower_leave_refund", {
            channelId: table.channelId,
            tableId: `hol${table.tableId}`,
          }).catch(() => {});
        }

        table.players.delete(i.user.id);
        await render(table);
        return;
      }

      if (action === "setbet") {
        if (!table.players.has(i.user.id)) {
          await i.reply({ content: "❌ You must **Join** first.", flags: MessageFlags.Ephemeral }).catch(() => {});
          return;
        }
        await promptAmountModal(i, tableId);
        return;
      }

      if (action === "start") {
        await i.deferUpdate().catch(() => {});
        await startRound(i, table);
        return;
      }

      if (action === "end") {
        await i.deferUpdate().catch(() => {});
        collector.stop("ended");
        return;
      }

      if (action === "higher" || action === "lower") {
        await i.deferUpdate().catch(() => {});
        const p = table.players.get(i.user.id);
        if (!p || !p.alive) return;
        p.pick = action;
        await resolveRound(table);
        await render(table);
        return;
      }

      if (action === "cashout") {
        await i.deferUpdate().catch(() => {});
        await cashOut(i, table);
        return;
      }

      // If we reached here, we did not handle it — ACK to avoid "interaction failed"
      await i.deferUpdate().catch(() => {});
    } catch (e) {
      console.error("[HigherLower] button handler error:", e);
      try {
        if (!i.deferred && !i.replied) {
          await i.reply({ content: "❌ That interaction failed.", flags: MessageFlags.Ephemeral });
        }
      } catch {}
    }
  });

  collector.on("end", async () => {
    tablesById.delete(table.tableId);
    activeGames.delete(channelId);
    clearActiveGame(channelId);

    setTimeout(() => {
      table.message?.delete().catch(() => {});
    }, 15_000);
  });

  await interaction.editReply("✅ Higher or Lower table launched. Use **Join** then **Set Bet**.");
}

// ---------- Global routing for modal submits ----------
async function handleInteraction(interaction) {
  const cid = String(interaction.customId || "");

  if (interaction.isModalSubmit?.() && cid.startsWith("holbet:")) {
    const tableId = cid.split(":")[1];
    const table = tablesById.get(tableId);
    if (!table) {
      await interaction.reply({ content: "❌ That Higher or Lower table is no longer active.", flags: MessageFlags.Ephemeral }).catch(() => {});
      return true;
    }

    if (await guardGamesComponent(interaction)) return true;
    if (await guardNotJailedComponent(interaction)) return true;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
    const amountStr = interaction.fields.getTextInputValue("amount") || "";
    const amount = parseAmount(amountStr);

    try {
      const ok = await placeBet({ interaction, table, amount });
      await interaction.editReply(ok ? "✅ Bet placed." : "❌ Bet not placed.").catch(() => {});
    } catch (e) {
      console.error("[HigherLower] placeBet failed:", e);
      await interaction.editReply("❌ Bet failed. Please try again.").catch(() => {});
    }
    return true;
  }

  return false;
}

module.exports = { startFromHub, handleInteraction };
