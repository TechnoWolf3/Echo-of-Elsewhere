// data/games/bullshit.js
// Bullshit (Liar's Bar style) — Multiplayer casino game for /games hub.
// - 3–10 players (normal)
// - Host-only TEST MODE: add bot players so you can start solo for testing
// - Random Table Rank (A–K) changes after each BULLSHIT resolution
// - Players play 1–4 cards face-down, always CLAIMING they match the Table Rank
// - Call BULLSHIT: liar fails (or caller fails if truthful) -> revolver shot
// - Revolver persists per player: bullet position 1–6, shotsTaken increments each fail
// - Last alive wins pot (REAL buy-ins only) minus table fee (if applicable)

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
} = require("discord.js");

const { activeGames } = require("../../utils/gameManager");
const { setActiveGame, updateActiveGame, clearActiveGame } = require("../../utils/gamesHubState");

const { tryDebitUser, creditUser, addServerBank, bankToUserIfEnough } = require("../../utils/economy");
const { guardNotJailedComponent } = require("../../utils/jail");

const {
  getHostBaseSecurity,
  computeFeeForBet,
} = require("../../utils/casinoSecurity");

const MIN_BUYIN = 500;
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 10;

const REVEAL_STAGE_DELAY_MS = 2200;
const REVOLVER_STAGE_DELAY_MS = 2800;


const BOT_PREFIX = "bsbot_";

// tableId -> table
const tablesById = new Map();

const RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];

function pickTableRank() {
  return RANKS[Math.floor(Math.random() * RANKS.length)];
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function buildDeckRanks() {
  // 52 ranks only (suits irrelevant for this ruleset)
  const deck = [];
  for (const r of RANKS) deck.push(r, r, r, r);
  return shuffle(deck);
}

function chancePercent(shotsTakenBefore) {
  const remaining = Math.max(0, 6 - Number(shotsTakenBefore || 0));
  if (remaining <= 0) return 100;
  return Math.round((1 / remaining) * 100);
}

function isBotId(userId) {
  return String(userId || "").startsWith(BOT_PREFIX);
}

function potTotalReal(table) {
  // Only real paid buy-ins contribute to pot
  let sum = 0;
  for (const p of table.players.values()) {
    if (p.paid && !isBotId(p.userId)) sum += Number(p.buyIn) || 0;
  }
  return sum;
}

function aliveIds(table) {
  return table.turnOrder.filter((id) => table.players.get(id)?.alive);
}

function winnerId(table) {
  const alive = [...table.players.values()].filter((p) => p.alive);
  return alive.length === 1 ? alive[0].userId : null;
}

function nextAlive(table) {
  if (!table.turnOrder.length) return null;

  const alive = aliveIds(table);
  if (alive.length === 0) return null;

  let idx = Number(table.currentIndex || 0);
  for (let step = 0; step < table.turnOrder.length + 1; step++) {
    idx = (idx + 1) % table.turnOrder.length;
    const id = table.turnOrder[idx];
    if (table.players.get(id)?.alive) {
      table.currentIndex = idx;
      table.currentPlayerId = id;
      return id;
    }
  }
  return null;
}

function bsId(tableId, action) {
  return `bs:${tableId}:${action}`;
}

function modalId(kind, tableId) {
  return `bs${kind}:${tableId}`;
}

function formatHand(hand, tableRank) {
  const counts = hand.reduce((acc, r) => {
    acc[r] = (acc[r] || 0) + 1;
    return acc;
  }, {});
  const tr = String(tableRank || "");
  const trCount = counts[tr] || 0;

  const lines = hand.map((r, idx) => `**${idx + 1}.** ${r}`).join("\n") || "(empty)";
  return {
    summary: `You have **${hand.length}** cards. Table Rank: **${tr}** (you hold **${trCount}**).`,
    lines,
  };
}

function buildLobbyEmbed(table) {
  const players = [...table.players.values()].map((p) => {
    const paid = p.paid ? "✅" : "❌";
    const buyIn = p.buyIn ? `$${Number(p.buyIn).toLocaleString()}` : "—";
    const tag = isBotId(p.userId) ? " 🤖" : "";
    return `${paid} ${p.user}${tag} • Buy-in: **${buyIn}**`;
  }).join("\n") || "(none)";

  const pot = potTotalReal(table);

  const e = new EmbedBuilder()
    .setTitle("🧢 Bullshit — The Place Edition")
    .setDescription(
      `**${MIN_PLAYERS}–${MAX_PLAYERS} players** • Last standing wins\n\n` +
      `Each player chooses their own buy-in (**min $${MIN_BUYIN.toLocaleString()}**) and pays **before** the game starts.\n` +
      `Winner takes the pot (minus table fee if applicable).\n\n` +
      (table.testMode ? "🧪 **TEST MODE**: bots are allowed and do **not** add money to the pot.\n" : "")
    )
    .addFields(
      { name: "Host", value: `<@${table.hostId}>`, inline: true },
      { name: "Players", value: `${table.players.size}/${table.maxPlayers}`, inline: true },
      { name: "Real Pot", value: `$${pot.toLocaleString()}`, inline: true },
      { name: "Joined", value: players }
    );

  const feePct = Math.round(Number(table.hostSecurity?.feePct || 0) * 100);
  e.addFields({ name: "Table Fee", value: feePct > 0 ? `**${feePct}%** (withheld from pot)` : "None", inline: true });

  e.setFooter({ text: "Hands are private via ‘View Hand’ (ephemeral, on-demand)." });
  return e;
}

function buildLobbyComponents(table) {
  const tableId = table.tableId;

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(bsId(tableId, "join")).setLabel("Join").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(bsId(tableId, "leave")).setLabel("Leave").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(bsId(tableId, "buyin")).setLabel("Set Buy-in").setStyle(ButtonStyle.Primary)
  );

  const allPaidRealPlayers =
    table.players.size >= 1 &&
    [...table.players.values()].every((p) => isBotId(p.userId) || p.paid);

  const enoughPlayersNormal = table.players.size >= MIN_PLAYERS;
  const enoughPlayersTest = table.players.size >= 1; // host + bots allowed

  const canStart =
    allPaidRealPlayers &&
    (table.testMode ? enoughPlayersTest : enoughPlayersNormal);

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(bsId(tableId, "start")).setLabel("Start").setStyle(ButtonStyle.Success).setDisabled(!canStart),
    new ButtonBuilder().setCustomId(bsId(tableId, "cancel")).setLabel("Cancel").setStyle(ButtonStyle.Danger)
  );

  // Host-only test controls (subtle)
  const botCount = [...table.players.keys()].filter(isBotId).length;
  const canAddBots = table.players.size < table.maxPlayers;

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(bsId(tableId, "addbots"))
      .setLabel(botCount > 0 ? `Test: Add Bot (${botCount})` : "Test: Add Bots")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!canAddBots),
    new ButtonBuilder()
      .setCustomId(bsId(tableId, "clearbots"))
      .setLabel("Test: Clear Bots")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(botCount === 0)
  );

  return [row1, row2, row3];
}

function buildGameEmbed(table, stage = "turn") {
  const alive = aliveIds(table);
  const aliveMentions = alive
    .map((id) => table.players.get(id)?.user || `<@${id}>`)
    .join(" • ") || "(none)";

  const pot = potTotalReal(table);
  const pileSize = table.pile.length;

  const e = new EmbedBuilder()
    .setTitle("🧢 Bullshit — Liar’s Bar Edition")
    .setDescription(
      `**Table Rank:** **${table.tableRank || "—"}**\n` +
      `**Current turn:** ${table.currentPlayerId ? (table.players.get(table.currentPlayerId)?.user || `<@${table.currentPlayerId}>`) : "—"}\n\n` +
      `Alive: ${aliveMentions}`
    )
    .addFields(
      { name: "Real Pot", value: `$${pot.toLocaleString()}`, inline: true },
      { name: "Pile", value: `${pileSize} card(s)`, inline: true },
      { name: "Round", value: `${table.round || 1}`, inline: true }
    );

  if (table.pendingPlay) {
    const pp = table.pendingPlay;
    const pl = table.players.get(pp.playerId);
    const who = pl?.user || `<@${pp.playerId}>`;
    e.addFields({
      name: "🕵️ Pending Play",
      value: `${who} claimed **${pp.cards.length}× ${table.tableRank}**. It’s now the next player’s turn: **Call BULLSHIT!** or **Play Cards** to accept.`,
      inline: false,
    });
  }

  if (table.testMode) {
    e.addFields({ name: "🧪 Test Mode", value: "Bots are active (no money added by bots).", inline: false });
  }

  if (stage === "reveal" && table.lastReveal) {
    e.addFields(
      { name: "💥 BULLSHIT!", value: table.lastReveal.banner || "—" },
      { name: "Claim", value: table.lastReveal.claim || "—", inline: true },
      { name: "Actual", value: table.lastReveal.actual || "—", inline: true }
    );
  }

  if (stage === "revolver" && table.lastRevolver) {
    e.addFields({ name: "🔫 Revolver", value: table.lastRevolver.text || "—" });
  }

  const feePct = Math.round(Number(table.hostSecurity?.feePct || 0) * 100);
  if (feePct > 0) e.setFooter({ text: `Table fee withheld from pot: ${feePct}%` });

  return e;
}

function buildGameComponents(table) {
  const tableId = table.tableId;
  const currentIsBot = table.currentPlayerId && isBotId(table.currentPlayerId);
  const hasPending = Boolean(table.pendingPlay);

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(bsId(tableId, "hand"))
        .setLabel("View Hand")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!table.currentPlayerId || currentIsBot),

      new ButtonBuilder()
        .setCustomId(bsId(tableId, "call"))
        .setLabel("BULLSHIT!")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!hasPending || currentIsBot),

      new ButtonBuilder()
        .setCustomId(bsId(tableId, "play"))
        .setLabel("Play Cards")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(!table.currentPlayerId || currentIsBot)
    ),
  ];
}


async function render(table, embed = null, components = null) {
  if (!table.message) return;
  try {
    await table.message.edit({
      embeds: [embed || (table.state === "lobby" ? buildLobbyEmbed(table) : buildGameEmbed(table))],
      components: components || (table.state === "lobby" ? buildLobbyComponents(table) : buildGameComponents(table)),
    });
  } catch {
    // ignore edit failures
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseIndices(raw) {
  const parts = String(raw || "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const idxs = parts
    .map((p) => Number(p))
    .filter((n) => Number.isFinite(n))
    .map((n) => Math.floor(n));

  // 1-based, unique
  return [...new Set(idxs)].filter((n) => n >= 1);
}

function addBotsUpToMin(table) {
  // Add enough bots to hit MIN_PLAYERS, but never exceed MAX_PLAYERS.
  const current = table.players.size;
  const needed = Math.max(0, MIN_PLAYERS - current);
  const slots = Math.min(needed, table.maxPlayers - current);
  if (slots <= 0) return 0;

  let added = 0;
  for (let i = 0; i < slots; i++) {
    const botId = `${BOT_PREFIX}${crypto.randomBytes(4).toString("hex")}`;
    const botNum = [...table.players.keys()].filter(isBotId).length + 1;

    table.players.set(botId, {
      userId: botId,
      user: `🤖 BS Bot #${botNum}`,
      buyIn: 0,
      paid: true,
      alive: true,
      hand: [],
      bulletPos: null,
      shotsTaken: 0,
    });
    added++;
  }
  return added;
}

function clearBots(table) {
  for (const id of [...table.players.keys()]) {
    if (isBotId(id)) table.players.delete(id);
  }
}

function pickBotPlay(p, tableRank) {
  // Simple AI:
  // - Prefer truthful plays using tableRank cards if available (70% if has any)
  // - Otherwise lie with random cards
  const hand = p.hand || [];
  if (hand.length === 0) return [];

  const matchingIdx = [];
  for (let i = 0; i < hand.length; i++) {
    if (hand[i] === tableRank) matchingIdx.push(i);
  }

  const canTruth = matchingIdx.length > 0;
  const truthBias = canTruth ? 0.7 : 0.0;
  const willTruth = Math.random() < truthBias;

  const count = Math.min(1 + Math.floor(Math.random() * 4), hand.length);

  const chosenIdx = [];
  if (willTruth) {
    // choose up to count from matching
    shuffle(matchingIdx);
    for (let i = 0; i < Math.min(count, matchingIdx.length); i++) chosenIdx.push(matchingIdx[i]);
    // if not enough matching, fill with random (this becomes partially lying, intentionally)
    while (chosenIdx.length < count) {
      const r = Math.floor(Math.random() * hand.length);
      if (!chosenIdx.includes(r)) chosenIdx.push(r);
    }
  } else {
    // choose random indices (likely lying)
    while (chosenIdx.length < count) {
      const r = Math.floor(Math.random() * hand.length);
      if (!chosenIdx.includes(r)) chosenIdx.push(r);
    }
  }

  // remove selected cards from hand (highest first)
  chosenIdx.sort((a, b) => b - a);
  const played = [];
  for (const idx0 of chosenIdx) {
    played.push(hand[idx0]);
    hand.splice(idx0, 1);
  }
  played.reverse();
  return played;
}

async function botMaybeCall(table) {
  // Called after a human play is pending. A bot might call with a probability.
  // This is intentionally "dumb": it doesn't know the truth, it just adds chaos for testing.
  if (!table.pendingPlay) return;
  const pending = table.pendingPlay;

  // Find any alive bot who isn't the pending player
  const aliveBotIds = table.turnOrder.filter((id) => {
    const p = table.players.get(id);
    return p?.alive && isBotId(id) && id !== pending.playerId;
  });
  if (aliveBotIds.length === 0) return;

  // 35% chance a bot calls within the window
  if (Math.random() > 0.35) return;

  // pick a random bot to be the caller
  const callerId = aliveBotIds[Math.floor(Math.random() * aliveBotIds.length)];

  await resolveBullshit(table, callerId);
}

async function cancelTable(table, reason) {
  // Refund paid buy-ins (real players only)
  for (const p of table.players.values()) {
    if (p.paid && Number(p.buyIn) > 0 && !isBotId(p.userId)) {
      const amt = Number(p.buyIn);
      try {
        await creditUser(table.guildId, p.userId, amt, "bullshit_refund", { tableId: table.tableId });
        await addServerBank(table.guildId, -amt, "bullshit_refund_bank", { tableId: table.tableId, userId: p.userId });
      } catch (e) {
        console.error("[Bullshit] refund failed:", e);
      }
    }
  }

  table.state = "ended";
  updateActiveGame(table.channelId, { state: "ended" });

  const embed = new EmbedBuilder().setTitle("🧢 Bullshit — Cancelled").setDescription(reason || "Table cancelled.");
  await render(table, embed, []);

  activeGames.delete(table.channelId);
  clearActiveGame(table.channelId);
  tablesById.delete(table.tableId);
}

async function endGame(table, winId) {
  table.state = "ended";
  updateActiveGame(table.channelId, { state: "ended" });

  const pot = potTotalReal(table);
  const feePct = Number(table.hostSecurity?.feePct || 0);
  const fee = feePct > 0 ? computeFeeForBet(pot, feePct) : 0;
  const payout = Math.max(0, pot - fee);

  const winnerLabel = winId
    ? (isBotId(winId) ? table.players.get(winId)?.user || "🤖 Bot" : `<@${winId}>`)
    : null;

  const embed = new EmbedBuilder()
    .setTitle("🧢 Bullshit — Game Over")
    .setDescription(
      winnerLabel
        ? `🏆 Winner: ${winnerLabel}\nReal Pot: **$${pot.toLocaleString()}**${fee > 0 ? `\nTable fee withheld: **$${fee.toLocaleString()}**` : ""}\nPayout: **$${payout.toLocaleString()}**`
        : "Game ended."
    );

  await render(table, embed, []);

  // Only pay out to a real player (bots don't get paid)
  if (winId && payout > 0 && !isBotId(winId)) {
    try {
      await bankToUserIfEnough(table.guildId, winId, payout, "bullshit_payout", {
        tableId: table.tableId,
        pot,
        fee,
      });
    } catch (e) {
      console.error("[Bullshit] payout failed:", e);
    }
  }

  activeGames.delete(table.channelId);
  clearActiveGame(table.channelId);
  tablesById.delete(table.tableId);
}

async function startGame(table) {
  table.state = "playing";
  updateActiveGame(table.channelId, { state: "playing" });

  table.tableRank = pickTableRank();
  table.round = 1;
  table.pile = [];
  table.pendingPlay = null;
  table.lastReveal = null;
  table.lastRevolver = null;
  if (table.challengeTimer) {
    clearTimeout(table.challengeTimer);
    table.challengeTimer = null;
  }

  table.turnOrder = [...table.players.keys()];
  table.currentIndex = 0;
  table.currentPlayerId = table.turnOrder[0];

  // Deal all cards across alive players
  const deck = buildDeckRanks();
  let ptr = 0;
  while (ptr < deck.length) {
    for (const id of table.turnOrder) {
      if (ptr >= deck.length) break;
      const p = table.players.get(id);
      if (p?.alive) {
        p.hand.push(deck[ptr]);
        ptr++;
      }
    }
  }

  // Revolver init per player
  for (const id of table.turnOrder) {
    const p = table.players.get(id);
    if (!p) continue;
    p.bulletPos = 1 + Math.floor(Math.random() * 6);
    p.shotsTaken = 0;
  }

  await render(table);

  // If a bot starts, play automatically
  await maybeAutoBotTurn(table);
}

async function resolveBullshit(table, callerId) {
  const pending = table.pendingPlay;
  if (!pending) return;

  if (table.challengeTimer) {
    clearTimeout(table.challengeTimer);
    table.challengeTimer = null;
  }

  const playerId = pending.playerId;
  const played = pending.cards;
  const rank = table.tableRank;

  const liar = played.some((r) => r !== rank);
  const failedId = liar ? playerId : callerId;

  const callerLabel = isBotId(callerId) ? (table.players.get(callerId)?.user || "🤖 Bot") : `<@${callerId}>`;
  const playerLabel = isBotId(playerId) ? (table.players.get(playerId)?.user || "🤖 Bot") : `<@${playerId}>`;

  table.lastReveal = {
    banner: `Caller: ${callerLabel} • Played by: ${playerLabel}`,
    claim: `Claimed **${played.length}× ${rank}**`,
    actual: played.map((r) => `\`${r}\``).join(" "),
  };

  await render(table, buildGameEmbed(table, "reveal"));
  await sleep(REVEAL_STAGE_DELAY_MS);

  const fp = table.players.get(failedId);
  if (fp && fp.alive) {
    const chance = chancePercent(fp.shotsTaken);
    fp.shotsTaken += 1;

    const deadNow = fp.shotsTaken === fp.bulletPos;
    if (deadNow) fp.alive = false;

    const failedLabel = isBotId(failedId) ? (fp.user || "🤖 Bot") : `<@${failedId}>`;

    table.lastRevolver = {
      text:
        `**${failedLabel}** pulls the trigger...\n` +
        `Shots taken: **${Math.min(fp.shotsTaken, 6)}/6** • Chance this shot: **${chance}%**\n\n` +
        (deadNow ? "💥 **BANG!** They’re out." : "*click* ... survived."),
    };
  }

  await render(table, buildGameEmbed(table, "revolver"));
  await sleep(REVOLVER_STAGE_DELAY_MS);

  // After a call: discard pile, reroll rank, advance turn
  table.pile = [];
  table.pendingPlay = null;
  table.lastReveal = null;
  table.lastRevolver = null;

  table.tableRank = pickTableRank();
  table.round += 1;

  const winId = winnerId(table);
  if (winId) {
    await endGame(table, winId);
    return;
  }

  const next = nextAlive(table);
  if (!next) {
    await endGame(table, null);
    return;
  }

  await render(table);
  await maybeAutoBotTurn(table);
}

async function maybeAutoBotTurn(table) {
  if (table.state !== "playing") return;
  if (!table.currentPlayerId) return;
  if (!isBotId(table.currentPlayerId)) return;

  const botId = table.currentPlayerId;
  const bot = table.players.get(botId);
  if (!bot?.alive) return;

  // tiny delay so it feels human-ish
  await sleep(900);

  // If there is a pending play from the previous player, the bot must decide:
  // - Call BULLSHIT (challenge) OR
  // - Play cards (accept and continue)
  if (table.pendingPlay && table.pendingPlay.playerId !== botId) {
    if (Math.random() < 0.35) {
      await resolveBullshit(table, botId);
      return;
    }
    // accept previous play by simply continuing (playing) — clears the pending window
    table.pendingPlay = null;
  }

  // Bot plays 1–4 cards and immediately passes turn to the next player
  const played = pickBotPlay(bot, table.tableRank);
  table.pendingPlay = { playerId: botId, cards: played, count: played.length };
  table.pile.push(...played);

  // advance turn immediately
  const winId = winnerId(table);
  if (winId) {
    await endGame(table, winId);
    return;
  }

  const next = nextAlive(table);
  if (!next) {
    await endGame(table, null);
    return;
  }

  await render(table);

  // If the next player is also a bot, keep the table moving
  await maybeAutoBotTurn(table);
}


async function handleButton(interaction, table, action) {
  const userId = interaction.user.id;

  if (await guardNotJailedComponent(interaction)) return;

  // Lobby
  if (table.state === "lobby") {
    if (action === "join") {
      if (table.players.has(userId)) {
        await interaction.reply({ content: "ℹ️ You’re already in.", flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
      }
      if (table.players.size >= table.maxPlayers) {
        await interaction.reply({ content: "❌ Table is full.", flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
      }

      table.players.set(userId, {
        userId,
        user: `<@${userId}>`,
        buyIn: null,
        paid: false,
        alive: true,
        hand: [],
        bulletPos: null,
        shotsTaken: 0,
      });

      await render(table);
      await interaction.reply({ content: "✅ Joined. Use **Set Buy-in** to pay in.", flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }

    if (action === "leave") {
      const p = table.players.get(userId);
      if (!p) {
        await interaction.reply({ content: "ℹ️ You’re not in this table.", flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
      }

      // Host leaving cancels
      if (userId === table.hostId) {
        await interaction.deferUpdate().catch(() => {});
        await cancelTable(table, "Host left — table cancelled.");
        return;
      }

      // Refund if paid (real players only)
      if (p.paid && Number(p.buyIn) > 0 && !isBotId(p.userId)) {
        const amt = Number(p.buyIn);
        try {
          await creditUser(table.guildId, userId, amt, "bullshit_refund", { tableId: table.tableId });
          await addServerBank(table.guildId, -amt, "bullshit_refund_bank", { tableId: table.tableId, userId });
        } catch (e) {
          console.error("[Bullshit] refund failed:", e);
        }
      }

      table.players.delete(userId);
      await render(table);
      await interaction.reply({ content: "✅ Left the table.", flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }

    if (action === "buyin") {
      if (!table.players.has(userId)) {
        await interaction.reply({ content: "❌ Join first.", flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
      }

      const modal = new ModalBuilder()
        .setCustomId(modalId("buyin", table.tableId))
        .setTitle("Set Buy-in");

      const amount = new TextInputBuilder()
        .setCustomId("amount")
        .setLabel(`Buy-in amount (min ${MIN_BUYIN})`)
        .setPlaceholder("500")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(amount));
      await interaction.showModal(modal);
      return;
    }

    if (action === "addbots") {
      if (userId !== table.hostId) {
        await interaction.reply({ content: "❌ Host only.", flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
      }

      table.testMode = true;
      const added = addBotsUpToMin(table);
      await render(table);

      await interaction.reply({
        content: added > 0 ? `🧪 Added **${added}** test bot(s).` : "🧪 No bot slots available (table full or already at minimum).",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    if (action === "clearbots") {
      if (userId !== table.hostId) {
        await interaction.reply({ content: "❌ Host only.", flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
      }
      clearBots(table);
      // Keep testMode true if you want it on; or disable if no bots:
      table.testMode = [...table.players.keys()].some(isBotId);
      await render(table);
      await interaction.reply({ content: "🧪 Cleared test bots.", flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }

    if (action === "start") {
      if (userId !== table.hostId) {
        await interaction.reply({ content: "❌ Only the host can start.", flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
      }

      if (!table.testMode && table.players.size < MIN_PLAYERS) {
        await interaction.reply({ content: `❌ Need at least **${MIN_PLAYERS}** players.`, flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
      }

      if (![...table.players.values()].every((p) => isBotId(p.userId) || p.paid)) {
        await interaction.reply({ content: "❌ Everyone must set & pay a buy-in before starting.", flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
      }

      // If testMode is enabled but still below MIN_PLAYERS, auto-top-up to MIN_PLAYERS
      if (table.testMode && table.players.size < MIN_PLAYERS) {
        addBotsUpToMin(table);
      }

      await interaction.deferUpdate().catch(() => {});
      await startGame(table);
      return;
    }

    if (action === "cancel") {
      if (userId !== table.hostId) {
        await interaction.reply({ content: "❌ Only the host can cancel.", flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
      }
      await interaction.deferUpdate().catch(() => {});
      await cancelTable(table, "Table cancelled.");
      return;
    }

    return;
  }

  // In-game
  if (table.state === "playing") {
    if (action === "hand") {
      if (userId !== table.currentPlayerId) {
        await interaction.reply({ content: "❌ Not your turn.", flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
      }
      if (isBotId(userId)) {
        await interaction.reply({ content: "🤖 Bots don’t need hands.", flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
      }

      const p = table.players.get(userId);
      const { summary, lines } = formatHand(p?.hand || [], table.tableRank);
      await interaction.reply({
        content: `${summary}\n\n${lines}\n\nUse **Play Cards** and enter the card numbers (1-based).`,
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    if (action === "play") {
      if (userId !== table.currentPlayerId) {
        await interaction.reply({ content: "❌ Not your turn.", flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
      }
      if (isBotId(userId)) {
        await interaction.reply({ content: "🤖 Bots play automatically.", flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
      }

      const modal = new ModalBuilder()
        .setCustomId(modalId("play", table.tableId))
        .setTitle("Play Cards");

      const cards = new TextInputBuilder()
        .setCustomId("cards")
        .setLabel("Card numbers to play (e.g. 1,3,4)")
        .setPlaceholder("1,2")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(cards));
      await interaction.showModal(modal);
      return;
    }

    if (action === "call") {
      if (userId !== table.currentPlayerId) {
        await interaction.reply({ content: "❌ Not your turn.", flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
      }
      if (!table.pendingPlay) {
        await interaction.reply({ content: "ℹ️ There’s nothing to call yet.", flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
      }
      if (userId === table.pendingPlay.playerId) {
        await interaction.reply({ content: "❌ You can’t call on your own play.", flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
      }
      if (!table.players.get(userId)?.alive) {
        await interaction.reply({ content: "❌ You’re not alive in this game.", flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
      }

      await interaction.deferUpdate().catch(() => {});
      await resolveBullshit(table, userId);
      return;
    }
  }
}

async function handleBuyInModal(interaction, table) {
  const userId = interaction.user.id;

  if (!table.players.has(userId)) {
    await interaction.reply({ content: "❌ Join the table first.", flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  const raw = interaction.fields.getTextInputValue("amount");
  const amount = Number(String(raw || "").replace(/[^\d]/g, ""));
  const buyIn = Number.isFinite(amount) ? amount : 0;

  if (buyIn < MIN_BUYIN) {
    await interaction.reply({ content: `❌ Buy-in must be at least **$${MIN_BUYIN.toLocaleString()}**.`, flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  const p = table.players.get(userId);

  // Bots shouldn't set buy-ins (but they also won't trigger this modal)
  if (isBotId(userId)) {
    await interaction.reply({ content: "🤖 Bots can’t set buy-ins.", flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  // If already paid: only allow increasing
  if (p.paid && Number(p.buyIn) > 0) {
    const prev = Number(p.buyIn);
    if (buyIn <= prev) {
      await interaction.reply({
        content: `ℹ️ You already paid **$${prev.toLocaleString()}**. You can only increase your buy-in before start.`,
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    const diff = buyIn - prev;
    const debit = await tryDebitUser(table.guildId, userId, diff, "bullshit_buyin", { tableId: table.tableId, step: "increase" });
    if (!debit.ok) {
      await interaction.reply({ content: "❌ Not enough balance to increase.", flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }

    await addServerBank(table.guildId, diff, "bullshit_buyin_bank", { tableId: table.tableId, userId });

    p.buyIn = buyIn;
    await render(table);
    await interaction.reply({ content: `✅ Buy-in increased to **$${buyIn.toLocaleString()}**.`, flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  // First payment
  const debit = await tryDebitUser(table.guildId, userId, buyIn, "bullshit_buyin", { tableId: table.tableId });
  if (!debit.ok) {
    await interaction.reply({ content: "❌ Not enough balance.", flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  await addServerBank(table.guildId, buyIn, "bullshit_buyin_bank", { tableId: table.tableId, userId });

  p.buyIn = buyIn;
  p.paid = true;

  await render(table);
  await interaction.reply({ content: `✅ Buy-in set to **$${buyIn.toLocaleString()}**.`, flags: MessageFlags.Ephemeral }).catch(() => {});
}

async function handlePlayModal(interaction, table) {
  const userId = interaction.user.id;

  if (table.state !== "playing") {
    await interaction.reply({ content: "❌ Game isn’t running.", flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  if (userId !== table.currentPlayerId) {
    await interaction.reply({ content: "❌ Not your turn.", flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  if (isBotId(userId)) {
    await interaction.reply({ content: "🤖 Bots play automatically.", flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  const p = table.players.get(userId);
  if (!p?.alive) {
    await interaction.reply({ content: "❌ You’re not alive in this game.", flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  const idxs = parseIndices(interaction.fields.getTextInputValue("cards"));
  if (idxs.length < 1 || idxs.length > 4) {
    await interaction.reply({ content: "❌ You must play **1–4** cards.", flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  const hand = p.hand || [];
  if (idxs.some((n) => n > hand.length)) {
    await interaction.reply({ content: "❌ One or more card numbers are out of range. Use **View Hand** first.", flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  // remove selected cards from hand (highest first)
  const sorted = [...idxs].sort((a, b) => b - a);
  const played = [];
  for (const n of sorted) {
    const idx0 = n - 1;
    played.push(hand[idx0]);
    hand.splice(idx0, 1);
  }
  played.reverse();

  // If there is a pending play from the previous player, choosing to play now implicitly accepts it.
  if (table.pendingPlay && table.pendingPlay.playerId !== userId) {
    table.pendingPlay = null;
  }

  // Record this player's play and immediately advance turn to the next player.
  table.pendingPlay = { playerId: userId, cards: played, count: played.length };
  table.pile.push(...played);

  const winId = winnerId(table);
  if (winId) {
    await endGame(table, winId);
    return;
  }

  const next = nextAlive(table);
  if (!next) {
    await endGame(table, null);
    return;
  }

  await render(table);
  await maybeAutoBotTurn(table);


  await interaction.reply({
    content: `✅ Played **${played.length}** card(s), claiming **${played.length}× ${table.tableRank}**.`,
    flags: MessageFlags.Ephemeral,
  }).catch(() => {});
}

async function startFromHub(interaction, opts = {}) {
  if (!interaction.inGuild()) {
    return interaction.reply({ content: "❌ Server only.", flags: MessageFlags.Ephemeral }).catch(() => {});
  }

  if (await guardNotJailedComponent(interaction)) return;

  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
  }

  const channelId = interaction.channelId;
  const guildId = interaction.guildId;

  const existing = activeGames.get(channelId);
  if (existing && existing.type === "bullshit" && existing.state !== "ended") {
    await interaction.editReply("❌ A Bullshit table is already active in this channel.");
    return;
  }

  const table = {
    type: "bullshit",
    state: "lobby",
    tableId: crypto.randomBytes(6).toString("hex"),
    channelId,
    guildId,
    hostId: interaction.user.id,
    maxPlayers: MAX_PLAYERS,
    players: new Map(),
    hostSecurity: null,
    message: null,
    testMode: false,

    // game runtime
    tableRank: null,
    round: 0,
    pile: [],
    pendingPlay: null,
    challengeTimer: null,
    turnOrder: [],
    currentIndex: 0,
    currentPlayerId: null,
    lastReveal: null,
    lastRevolver: null,
  };

  tablesById.set(table.tableId, table);

  // mark channel busy
  activeGames.set(channelId, table);
  setActiveGame(channelId, { type: "bullshit", state: "lobby", gameId: table.tableId, hostId: table.hostId });

  // host auto joins (still must set buy-in)
  table.players.set(interaction.user.id, {
    userId: interaction.user.id,
    user: `<@${interaction.user.id}>`,
    buyIn: null,
    paid: false,
    alive: true,
    hand: [],
    bulletPos: null,
    shotsTaken: 0,
  });

  // lock host security snapshot
  try {
    table.hostSecurity = await getHostBaseSecurity(guildId, table.hostId);
  } catch {
    table.hostSecurity = { level: 0, label: "Normal", feePct: 0 };
  }

  table.message = await interaction.channel.send({
    embeds: [buildLobbyEmbed(table)],
    components: buildLobbyComponents(table),
  });

  const collector = table.message.createMessageComponentCollector({ time: 30 * 60 * 60_000 });

  collector.on("collect", async (i) => {
    const cid = String(i.customId || "");
    const [prefix, tId, action] = cid.split(":");
    if (prefix !== "bs" || tId !== table.tableId) return;

    // IMPORTANT: only deferUpdate on actions that do NOT need a reply/showModal
    const noDeferActions = new Set(["buyin", "play", "join", "leave", "addbots", "clearbots", "hand"]);
    if (!noDeferActions.has(action)) {
      await i.deferUpdate().catch(() => {});
    }

try {
      await handleButton(i, table, action);
    } catch (e) {
      console.error("[Bullshit] button handler error:", e);
      try {
        if (!i.deferred && !i.replied) {
          await i.reply({ content: "❌ Something went wrong.", flags: MessageFlags.Ephemeral });
        }
      } catch {}
    }
  });

  collector.on("end", () => {
    if (tablesById.get(table.tableId)) {
      cancelTable(table, "Table expired due to inactivity.").catch(() => {});
    }
  });

  await interaction.editReply("✅ Bullshit table created.");
}

async function handleInteraction(interaction) {
  // We only need global routing for modals (same pattern as your other games)
  if (!interaction.isModalSubmit?.()) return false;

  const cid = String(interaction.customId || "");
  const [kind, tableId] = cid.split(":");
  if (!tableId) return false;

  const table = tablesById.get(tableId);
  if (!table) return false;

  if (kind === "bsbuyin") {
    await handleBuyInModal(interaction, table);
    return true;
  }

  if (kind === "bsplay") {
    await handlePlayModal(interaction, table);
    return true;
  }

  return false;
}

module.exports = {
  startFromHub,
  handleInteraction,
};