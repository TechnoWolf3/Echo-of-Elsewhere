// data/games/higherLower.js
// Higher or Lower (Casino) — modular game for /games hub
// Pattern-matched to blackjack.js / roulette.js in this repo.
// - Lobby: Join / Leave / Set Bet (modal) / Start / End
// - Game: Higher / Lower / Cash Out
// - Ties are a loss (house edge)
// - Debits on bet placement (plus casino fee). Payouts use bankToUserIfEnough.

const crypto = require("crypto");
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ComponentType,
} = require("discord.js");

const { activeGames } = require("../../utils/gameManager");
const { setActiveGame, updateActiveGame, clearActiveGame } = require("../../utils/gamesHubState");

const {
  tryDebitUser,
  addServerBank,
  bankToUserIfEnough,
  getBalance,
} = require("../../utils/economy");

const {
  getUserCasinoSecurity,
  getHostBaseSecurity,
  getEffectiveFeePct,
  computeFeeForBet,
  maybeAnnounceCasinoSecurity,
} = require("../../utils/casinoSecurity");

const { awardProgress } = require("../../utils/achievementEngine");
const { isUserJailed } = require("../../utils/jail");

const MIN_BET = 500;
const MAX_BET = 250000;

// tableId -> table (so index.js can route modal submits if you do that style)
const tablesById = new Map();

function makeId(prefix) {
  return `${prefix}:${crypto.randomBytes(6).toString("hex")}`;
}

function parseBetAmount(raw) {
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/[$,\s_]/g, "").trim();
  if (!cleaned) return null;
  // allow decimals but round down to int
  const num = Number(cleaned);
  if (!Number.isFinite(num)) return null;
  const amt = Math.floor(num);
  if (!Number.isSafeInteger(amt)) return null;
  return amt;
}

function cardRank(n) {
  // 2..14 (A)
  if (n === 14) return "A";
  if (n === 13) return "K";
  if (n === 12) return "Q";
  if (n === 11) return "J";
  return String(n);
}
function cardSuit(n) {
  return ["♠", "♥", "♦", "♣"][n % 4];
}
function drawCard() {
  // rank 2..14 and suit 0..3
  const rank = 2 + Math.floor(Math.random() * 13);
  const suit = Math.floor(Math.random() * 4);
  return { rank, suit, label: `${cardRank(rank)}${["♠", "♥", "♦", "♣"][suit]}` };
}

function compareNext(prev, next) {
  // returns "higher" | "lower" | "tie"
  if (next.rank > prev.rank) return "higher";
  if (next.rank < prev.rank) return "lower";
  return "tie";
}

function streakMultiplier(streak) {
  // start 1.0, +0.5 per correct, cap 10x
  const m = 1 + 0.5 * Math.max(0, streak);
  return Math.min(10, Math.round(m * 10) / 10);
}

async function ensureHostSecurity(table, guildId, hostId) {
  if (table.hostSecurity) return table.hostSecurity;
  try {
    table.hostSecurity = await getHostBaseSecurity(guildId, hostId);
  } catch (e) {
    console.error("[higherLower] failed to get host base security:", e);
    table.hostSecurity = { level: 0, label: "Normal", feePct: 0 };
  }
  return table.hostSecurity;
}

async function getPlayerSecuritySafe(guildId, userId) {
  try {
    return await getUserCasinoSecurity(guildId, userId);
  } catch (e) {
    console.error("[higherLower] get user casino security failed:", e);
    return { level: 0, label: "Normal", feePct: 0 };
  }
}

function playersList(table) {
  const arr = Array.from(table.players.values());
  arr.sort((a, b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0));
  return arr;
}

function buildLobbyEmbed(table, guildId) {
  const e = new EmbedBuilder().setTitle("🔼🔽 Higher or Lower");

  e.setDescription(
    [
      `Dealer: ${table.state === "lobby" ? "*Not dealt yet*" : `**${table.currentCard?.label ?? "?"}**`}`,
      `Players (${table.players.size}/10):`,
    ].join("\n")
  );

  const lines = [];
  for (const p of playersList(table)) {
    const paid = p.paid ? "✅" : "❌";
    lines.push(`${paid} <@${p.userId}> — Bet: **$${p.bet ?? MIN_BET}**`);
  }
  if (!lines.length) lines.push("*No players yet.*");

  e.addFields(
    { name: "Lobby", value: lines.join("\n") },
    { name: "Rules", value: `Minimum bet: **$${MIN_BET}** • Ties are a loss.` }
  );

  e.setFooter({ text: `Table ID: ${table.tableId}` });
  return e;
}

function buildPlayEmbed(table) {
  const e = new EmbedBuilder().setTitle("🔼🔽 Higher or Lower");

  const cardLine = table.currentCard ? `Current card: **${table.currentCard.label}**` : "Current card: *Not dealt yet*";
  const streakLine = `Streak: **${table.streak}** • Multiplier: **x${streakMultiplier(table.streak)}**`;
  const potLine = `Base bet: **$${table.bet}** • Potential cashout: **$${Math.floor(table.bet * streakMultiplier(table.streak))}**`;

  const alive = table.alive.size ? Array.from(table.alive).map((id) => `<@${id}>`).join(", ") : "*None*";
  e.setDescription([cardLine, streakLine, potLine, "", `Alive: ${alive}`].join("\n"));

  return e;
}

function lobbyComponents(table, isHost) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`hol:join:${table.tableId}`).setStyle(ButtonStyle.Success).setLabel("Join"),
    new ButtonBuilder().setCustomId(`hol:leave:${table.tableId}`).setStyle(ButtonStyle.Secondary).setLabel("Leave"),
    new ButtonBuilder().setCustomId(`hol:setbet:${table.tableId}`).setStyle(ButtonStyle.Primary).setLabel("Set Bet"),
    new ButtonBuilder().setCustomId(`hol:start:${table.tableId}`).setStyle(ButtonStyle.Success).setLabel("Start").setDisabled(!isHost),
    new ButtonBuilder().setCustomId(`hol:end:${table.tableId}`).setStyle(ButtonStyle.Danger).setLabel("End").setDisabled(!isHost)
  );
  return [row];
}

function playComponents(table, isHost) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`hol:higher:${table.tableId}`).setStyle(ButtonStyle.Primary).setLabel("Higher 🔼"),
    new ButtonBuilder().setCustomId(`hol:lower:${table.tableId}`).setStyle(ButtonStyle.Primary).setLabel("Lower 🔽"),
    new ButtonBuilder().setCustomId(`hol:cashout:${table.tableId}`).setStyle(ButtonStyle.Success).setLabel("Cash Out 💰"),
    new ButtonBuilder().setCustomId(`hol:end:${table.tableId}`).setStyle(ButtonStyle.Danger).setLabel("End").setDisabled(!isHost)
  );
  return [row];
}

async function render(table, message, guildId) {
  const isHost = true; // host-only buttons are set per-interaction, but message components can be host-enabled always; we enforce in handler
  const embed =
    table.state === "lobby" ? buildLobbyEmbed(table, guildId) : buildPlayEmbed(table);

  const components = table.state === "lobby" ? lobbyComponents(table, true) : playComponents(table, true);

  await message.edit({ embeds: [embed], components }).catch(() => {});
}

async function chargeWithCasinoFee(table, guildId, userId, betAmount, channelId) {
  const hostSec = await ensureHostSecurity(table, guildId, table.hostId);
  const playerSec = await getPlayerSecuritySafe(guildId, userId);

  const effectiveFeePct = getEffectiveFeePct(hostSec, playerSec);
  const feeCalc = computeFeeForBet(betAmount, effectiveFeePct);

  // Debit user total charge
  const meta = { channelId, tableId: table.tableId, userId, game: "higherlower" };
  await tryDebitUser(guildId, userId, feeCalc.totalCharge, "higherlower_buyin", {
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

  // Add to server bank
  await addServerBank(guildId, feeCalc.totalCharge, "higherlower_bank_buyin", meta);

  // Optional security announce (same vibe as roulette)
  await maybeAnnounceCasinoSecurity(guildId, channelId, hostSec, playerSec, effectiveFeePct).catch(() => {});

  return feeCalc;
}

async function placeBet(table, interaction, userId, betAmount) {
  const guildId = interaction.guildId;
  const channelId = interaction.channelId;

  const p = table.players.get(userId);
  if (!p) throw new Error("You are not in this table.");

  if (await isUserJailed(guildId, userId)) {
    throw new Error("You can't gamble while jailed.");
  }

  const amt = betAmount;
  if (!Number.isInteger(amt) || amt < MIN_BET || amt > MAX_BET) {
    throw new Error(`Bet must be an integer between $${MIN_BET} and $${MAX_BET}.`);
  }

  // If they already paid, do not double-charge — just update their preferred bet for next round (if you extend later)
  if (p.paid) {
    p.bet = amt;
    return { feeCalc: null, alreadyPaid: true };
  }

  // Check balance early for nicer UX
  const bal = await getBalance(guildId, userId);
  // compute total charge to verify affordability (uses same fee calc)
  const hostSec = await ensureHostSecurity(table, guildId, table.hostId);
  const playerSec = await getPlayerSecuritySafe(guildId, userId);
  const effectiveFeePct = getEffectiveFeePct(hostSec, playerSec);
  const feeCalc = computeFeeForBet(amt, effectiveFeePct);

  if (bal < feeCalc.totalCharge) {
    throw new Error(`Insufficient funds. Need **$${feeCalc.totalCharge}**, you have **$${bal}**.`);
  }

  const charged = await chargeWithCasinoFee(table, guildId, userId, amt, channelId);

  p.bet = amt;
  p.paid = true;

  // Table uses a single base bet: host's bet, or first paid bet.
  // If you want per-player bets later, we can extend — for now keep it simple & consistent.
  if (!table.bet) table.bet = amt;

  // Achievements (safe/no-op if IDs not configured)
  awardProgress(guildId, userId, "hol_first_cashout", 0).catch(() => {});
  // High roller tracking on bet placement
  if (amt >= 50000) {
    awardProgress(guildId, userId, "hol_high_roller", 1).catch(() => {});
  }

  return { feeCalc: charged, alreadyPaid: false };
}

function allPaid(table) {
  if (!table.players.size) return false;
  for (const p of table.players.values()) {
    if (!p.paid) return false;
  }
  return true;
}

async function startRound(table, message) {
  table.state = "play";
  table.streak = 0;
  table.currentCard = drawCard();
  table.alive = new Set(Array.from(table.players.keys())); // everyone who joined is alive
  table.finished = false;

  await render(table, message, message.guildId);
}

async function endTable(table, message, reason = "Table ended.") {
  table.finished = true;
  tablesById.delete(table.tableId);
  activeGames.delete(message.channelId);
  clearActiveGame(message.channelId);

  // Disable components
  await message.edit({
    embeds: [
      new EmbedBuilder()
        .setTitle("🔼🔽 Higher or Lower")
        .setDescription(reason)
        .setFooter({ text: `Table ID: ${table.tableId}` }),
    ],
    components: [],
  }).catch(() => {});
}

async function resolveChoice(table, message, choice) {
  const next = drawCard();
  const result = compareNext(table.currentCard, next);
  table.currentCard = next;

  if (result === "tie") {
    // tie is a loss: everyone dies
    table.alive.clear();
  } else if (result !== choice) {
    // wrong guess: everyone dies (shared table)
    table.alive.clear();
  } else {
    table.streak += 1;
  }

  // If nobody alive, table ends with no payout
  if (!table.alive.size) {
    table.state = "lobby";
    // reset paid flags so they must pay again (new hand)
    for (const p of table.players.values()) {
      p.paid = false;
    }
    table.bet = null;
    table.streak = 0;
    table.currentCard = null;

    await message.edit({
      embeds: [
        new EmbedBuilder()
          .setTitle("🔼🔽 Higher or Lower")
          .setDescription(`**${next.label}** — ${result.toUpperCase()}.\nEveryone lost. Ties are a loss.`),
      ],
      components: lobbyComponents(table, true),
    }).catch(() => {});
    return;
  }

  await render(table, message, message.guildId);

  // Achievements for streak
  if (table.streak >= 5) {
    for (const id of table.alive) {
      awardProgress(message.guildId, id, "hol_streak_5", 1).catch(() => {});
    }
  }
}

async function cashOut(table, message, interactionUserId) {
  const guildId = message.guildId;
  const channelId = message.channelId;

  if (!table.alive.has(interactionUserId)) {
    throw new Error("You are not currently alive in this round.");
  }
  if (!table.bet || !table.players.get(interactionUserId)?.bet) {
    throw new Error("No bet found to cash out.");
  }

  const payout = Math.floor(table.bet * streakMultiplier(table.streak));
  const meta = { channelId, tableId: table.tableId, userId: interactionUserId, game: "higherlower", payout, streak: table.streak };

  await bankToUserIfEnough(guildId, interactionUserId, payout, "higherlower_cashout", meta);

  // Achievements
  awardProgress(guildId, interactionUserId, "hol_first_cashout", 1).catch(() => {});
  if (payout >= 100000) awardProgress(guildId, interactionUserId, "hol_high_roller", 1).catch(() => {});

  // End round back to lobby
  table.state = "lobby";
  for (const p of table.players.values()) p.paid = false;
  table.bet = null;
  table.streak = 0;
  table.currentCard = null;
  table.alive.clear();

  await message.edit({
    embeds: [
      new EmbedBuilder()
        .setTitle("🔼🔽 Higher or Lower")
        .setDescription(`<@${interactionUserId}> cashed out **$${payout}**!`)
        .setFooter({ text: `Table ID: ${table.tableId}` }),
      buildLobbyEmbed(table, guildId),
    ],
    components: lobbyComponents(table, true),
  }).catch(() => {});
}

async function startFromHub(interaction) {
  const channelId = interaction.channelId;
  const guildId = interaction.guildId;

  // If hub enforces active game, this is redundant, but keep safe:
  if (activeGames.has(channelId)) {
    await interaction.reply({
      content: "There is already an active game in this channel.",
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return;
  }

  const tableId = makeId("hol");
  const table = {
    tableId,
    hostId: interaction.user.id,
    state: "lobby",
    players: new Map(), // userId -> { userId, bet, paid, joinedAt }
    bet: null,
    currentCard: null,
    streak: 0,
    alive: new Set(),
    finished: false,
    hostSecurity: null,
  };

  tablesById.set(tableId, table);

  // register under gameManager map so hub knows channel is busy
  activeGames.set(channelId, { type: "higherlower", tableId });

  setActiveGame(channelId, { type: "higherlower", state: "lobby", gameId: tableId, hostId: table.hostId });

  const embed = buildLobbyEmbed(table, guildId);
  const comps = lobbyComponents(table, true);

  // Post the table message
  const message = await interaction.channel.send({ embeds: [embed], components: comps }).catch(() => null);
  if (!message) return;

  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 30 * 60 * 1000,
  });

  collector.on("collect", async (i) => {
    const [prefix, action, tid] = (i.customId || "").split(":");
    if (prefix !== "hol" || tid !== tableId) return;

    // ACK immediately so Discord doesn't complain
    if (!i.deferred && !i.replied) await i.deferUpdate().catch(() => {});

    try {
      const isHost = i.user.id === table.hostId;

      if (action === "end") {
        if (!isHost) throw new Error("Only the host can end the table.");
        collector.stop("ended");
        await endTable(table, message, "Table ended by host.");
        return;
      }

      if (action === "join") {
        if (table.players.size >= 10) throw new Error("Table is full (10 players).");
        if (!table.players.has(i.user.id)) {
          table.players.set(i.user.id, { userId: i.user.id, bet: MIN_BET, paid: false, joinedAt: Date.now() });
        }
        await render(table, message, guildId);
        return;
      }

      if (action === "leave") {
        table.players.delete(i.user.id);
        table.alive.delete(i.user.id);
        await render(table, message, guildId);
        return;
      }

      if (action === "setbet") {
        if (!table.players.has(i.user.id)) throw new Error("Join the table first.");
        const modal = new ModalBuilder()
          .setCustomId(`holbet:${tableId}`)
          .setTitle("Set Higher or Lower Bet")
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                // MUST match blackjack/roulette: "amount"
                .setCustomId("amount")
                .setLabel(`Bet amount (min ${MIN_BET})`)
                .setPlaceholder(`e.g. 5000`)
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
            )
          );

        await i.showModal(modal).catch(() => {});
        return;
      }

      if (action === "start") {
        if (!isHost) throw new Error("Only the host can start the table.");
        if (!table.players.size) throw new Error("No players have joined.");
        if (!allPaid(table)) throw new Error("All joined players must Set Bet first.");
        await startRound(table, message);
        updateActiveGame(channelId, { state: "play" });
        return;
      }

      if (action === "higher") {
        if (table.state !== "play") throw new Error("Round hasn't started yet.");
        if (!table.alive.has(i.user.id)) throw new Error("You're not alive in this round.");
        await resolveChoice(table, message, "higher");
        return;
      }

      if (action === "lower") {
        if (table.state !== "play") throw new Error("Round hasn't started yet.");
        if (!table.alive.has(i.user.id)) throw new Error("You're not alive in this round.");
        await resolveChoice(table, message, "lower");
        return;
      }

      if (action === "cashout") {
        if (table.state !== "play") throw new Error("Round hasn't started yet.");
        await cashOut(table, message, i.user.id);
        updateActiveGame(channelId, { state: "lobby" });
        return;
      }
    } catch (err) {
      await i.followUp({
        content: err?.message || "Something went wrong.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
    }
  });

  // Modal submit handler (scoped to this tableId)
  const modalCollector = message.channel.createMessageComponentCollector({
    componentType: ComponentType.ModalSubmit,
    time: 30 * 60 * 1000,
  });

  modalCollector.on("collect", async (i) => {
    if (i.customId !== `holbet:${tableId}`) return;

    // Always ACK the modal quickly (ephemeral), then do work
    await i.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

    try {
      const p = table.players.get(i.user.id);
      if (!p) throw new Error("Join the table first.");
      if (table.state !== "lobby") throw new Error("You can only set your bet in the lobby.");

      const raw = i.fields.getTextInputValue("amount"); // MUST be "amount"
      const amt = parseBetAmount(raw);

      if (!amt) throw new Error("Please enter a valid whole number bet amount.");
      if (amt < MIN_BET) throw new Error(`Minimum bet is $${MIN_BET}.`);
      if (amt > MAX_BET) throw new Error(`Maximum bet is $${MAX_BET}.`);

      await placeBet(table, i, i.user.id, amt);

      await i.editReply({ content: `✅ Bet set to **$${amt}**.` }).catch(() => {});
      await render(table, message, guildId);
    } catch (err) {
      console.warn("[HigherLower] placeBet failed:", err?.message || err);
      await i.editReply({ content: `⚠️ ${err?.message || "Bet failed."}` }).catch(() => {});
    }
  });

  collector.on("end", async () => {
    modalCollector.stop();
    if (!table.finished) {
      await endTable(table, message, "Table timed out due to inactivity.");
    }
  });
}

module.exports = {
  startFromHub,
  tablesById,
};
