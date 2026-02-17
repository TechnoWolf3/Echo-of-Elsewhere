// data/games/higherLower.js
// Higher or Lower game module used by /games hub (NOT a slash command).
// Multiplayer lobby (up to 10) with shared draw, individual guesses, and optional cash out.
// Bets are debited on placement (like Blackjack/Roulette).

const crypto = require("crypto");
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
  addServerBank,
  bankToUserIfEnough,
  getServerBank,
} = require("../../utils/economy");

const { unlockAchievement } = require("../../utils/achievementEngine");
const { guardNotJailedComponent } = require("../../utils/jail");

const {
  getUserCasinoSecurity,
  getHostBaseSecurity,
  getEffectiveFeePct,
  computeFeeForBet,
  maybeAnnounceCasinoSecurity,
} = require("../../utils/casinoSecurity");

const MIN_BET = 500;
const MAX_BET = 250000;

/* =========================================================
   🏆 ACHIEVEMENTS (HIGHER/LOWER)
   Safe even if you haven't added these IDs yet.
========================================================= */
const HOL_ACH = {
  FIRST_CASHOUT: "hol_first_cashout",
  FIRST_BUST: "hol_first_bust",
  STREAK_5: "hol_streak_5",
  HIGH_ROLLER: "hol_high_roller",
};
const HOL_RULES = { HIGH_ROLLER_BET: 50_000, MULTIPLIER_CAP: 10 };

async function holFetchAchievementInfo(db, achievementId) {
  if (!db) return null;
  try {
    const res = await db.query(
      `SELECT id, name, description, category, hidden, reward_coins, reward_role_id
       FROM achievements
       WHERE id = $1`,
      [achievementId]
    );
    return res.rows?.[0] ?? null;
  } catch (e) {
    console.error("holFetchAchievementInfo failed:", e);
    return null;
  }
}

async function holAnnounceAchievement(channel, userId, info) {
  if (!channel?.send || !info) return;
  const rewardCoins = Number(info.reward_coins || 0);
  const embed = new EmbedBuilder()
    .setTitle("🏆 Achievement Unlocked!")
    .setDescription(`**<@${userId}>** unlocked **${info.name}**`)
    .addFields(
      { name: "Description", value: info.description || "—" },
      { name: "Category", value: info.category || "General", inline: true },
      { name: "Reward", value: rewardCoins > 0 ? `+$${rewardCoins.toLocaleString()}` : "None", inline: true }
    )
    .setFooter({ text: `Achievement ID: ${info.id}` });

  await channel.send({ embeds: [embed] }).catch(() => {});
}

async function holUnlock(thingOrChannel, guildId, userId, achievementId) {
  try {
    const channel = thingOrChannel?.channel || thingOrChannel;
    const db = channel?.client?.db;
    if (!db) return null;

    const cleanUserId = String(userId).replace(/[<@!>]/g, "");
    const res = await unlockAchievement({ db, guildId, userId: cleanUserId, achievementId });
    if (!res?.unlocked) return res;

    const info = await holFetchAchievementInfo(db, achievementId);
    await holAnnounceAchievement(channel, cleanUserId, info);

    return res;
  } catch (e) {
    console.error("[higherLower] holUnlock failed:", e);
    return null;
  }
}

/* ========================================================= */

function parseAmount(raw) {
  const v = Number(String(raw || "").replace(/[^\d]/g, ""));
  return Number.isFinite(v) ? v : 0;
}

function sendEphemeralToast(i, content) {
  return i
    .followUp({ content, flags: MessageFlags.Ephemeral })
    .catch(async () => i.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {}));
}

function buildDeck() {
  const suits = ["♠", "♥", "♦", "♣"];
  const deck = [];
  for (const s of suits) {
    for (let v = 2; v <= 14; v++) {
      deck.push({ v, s });
    }
  }
  // Fisher-Yates shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function cardLabel(card) {
  if (!card) return "?";
  const map = { 11: "J", 12: "Q", 13: "K", 14: "A" };
  const val = map[card.v] || String(card.v);
  return `${val}${card.s}`;
}

function compare(nextV, curV) {
  if (nextV === curV) return 0;
  return nextV > curV ? 1 : -1;
}

function multiplierForStreak(streak) {
  // streak 0 => 1.0x
  // each correct adds +0.5x
  const m = 1 + 0.5 * Number(streak || 0);
  return Math.min(m, HOL_RULES.MULTIPLIER_CAP);
}

// ---------- Casino Security fee helper (same idea as BJ/Rou) ----------
async function ensureHostSecurity(game, guildId, hostId) {
  if (game.hostSecurity) return game.hostSecurity;
  try {
    game.hostSecurity = await getHostBaseSecurity(guildId, hostId);
  } catch (e) {
    console.error("[higherLower] failed to get host base security:", e);
    game.hostSecurity = { level: 0, label: "Normal", feePct: 0 };
  }
  return game.hostSecurity;
}

async function getPlayerSecuritySafe(guildId, userId) {
  try {
    return await getUserCasinoSecurity(guildId, userId);
  } catch (e) {
    console.error("[higherLower] failed to get player security:", e);
    return { level: 0, label: "Normal", feePct: 0 };
  }
}

async function chargeWithCasinoFee({ guildId, userId, amountStake, type, meta, game, channel, hostId }) {
  const hostSec = await ensureHostSecurity(game, guildId, hostId);
  const playerSec = await getPlayerSecuritySafe(guildId, userId);
  const effectiveFeePct = getEffectiveFeePct(hostSec, playerSec);
  const feeAmount = computeFeeForBet(Number(amountStake || 0), effectiveFeePct);
  const total = Number(amountStake || 0) + Number(feeAmount || 0);

  const ok = await tryDebitUser(guildId, userId, total, type, {
    ...meta,
    stake: Number(amountStake || 0),
    feeAmount: Number(feeAmount || 0),
    effectiveFeePct,
    hostSecurityLevel: hostSec?.level ?? 0,
    playerSecurityLevel: playerSec?.level ?? 0,
  });

  return { ok, feeAmount: Number(feeAmount || 0), effectiveFeePct, hostSec, playerSec };
}

function buildLobbyEmbed(game) {
  const players = [...game.players.values()];
  const list = players.length
    ? players
        .map((p) => {
          const paid = p.paid ? "✅" : "❌";
          const bet = p.betAmount ? `$${Number(p.betAmount).toLocaleString()}` : "—";
          return `${paid} ${p.user} — Bet: **${bet}**`;
        })
        .join("\n")
    : "_No players yet. Hit **Join** to sit down._";

  return new EmbedBuilder()
    .setTitle("🔼🔽 Higher or Lower")
    .setDescription(
      [
        `Dealer: _Not dealt yet_`,
        `Players (${players.length}/${game.maxPlayers}):`,
        list,
        "",
        `Minimum bet: **$${MIN_BET.toLocaleString()}** • Ties are a **loss**.`,
      ].join("\n")
    )
    .setFooter({ text: `Table ID: ${game.gameId}` });
}

function buildPlayEmbed(game) {
  const cur = game.currentCard;
  const next = game.revealedNext ? game.nextCard : null;

  const alive = [...game.players.values()].filter((p) => p.status === "alive");
  const out = [...game.players.values()].filter((p) => p.status !== "alive");

  const aliveLines = alive.length
    ? alive
        .map((p) => {
          const m = multiplierForStreak(p.streak);
          const guess = p.guess ? ` • Guess: **${p.guess.toUpperCase()}**` : " • Guess: _pending_";
          return `🟢 ${p.user} — Bet: **$${Number(p.betAmount).toLocaleString()}** • Streak: **${p.streak}** • Cashout: **x${m.toFixed(1)}**${guess}`;
        })
        .join("\n")
    : "_No one left in the round._";

  const outLines = out.length
    ? out
        .slice(0, 10)
        .map((p) => {
          const why =
            p.status === "cashed"
              ? `💰 Cashed out x${Number(p.cashoutMult || 0).toFixed(1)}`
              : p.status === "spectator"
              ? "👀 Spectating"
              : "💀 Busted";
          return `⚪ ${p.user} — ${why}`;
        })
        .join("\n")
    : "_—_";

  const lines = [];
  lines.push(`**Current card:** ${cardLabel(cur)}`);
  lines.push(`**Next card:** ${next ? cardLabel(next) : "❓"}`);
  if (game.lastRevealNote) lines.push(`\n${game.lastRevealNote}`);
  lines.push("\n**Players still in:**");
  lines.push(aliveLines);
  lines.push("\n**Out:**");
  lines.push(outLines);

  return new EmbedBuilder().setTitle("🔼🔽 Higher or Lower").setDescription(lines.join("\n"));
}

function buildLobbyComponents(game) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`hol:${game.gameId}:join`).setLabel("Join").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`hol:${game.gameId}:leave`).setLabel("Leave").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`hol:${game.gameId}:setbet`).setLabel("Set Bet").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`hol:${game.gameId}:start`).setLabel("Start").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`hol:${game.gameId}:end`).setLabel("End").setStyle(ButtonStyle.Danger)
    ),
  ];
}

function buildPlayComponents(game) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`hol:${game.gameId}:higher`).setLabel("Higher").setEmoji("🔼").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`hol:${game.gameId}:lower`).setLabel("Lower").setEmoji("🔽").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`hol:${game.gameId}:cashout`).setLabel("Cash Out").setEmoji("💰").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`hol:${game.gameId}:end`).setLabel("End").setStyle(ButtonStyle.Danger)
  );
  return [row];
}

async function render(game) {
  if (!game.message) return;

  if (game.state === "lobby") {
    await game.message
      .edit({ embeds: [buildLobbyEmbed(game)], components: buildLobbyComponents(game) })
      .catch(() => {});
    updateActiveGame(game.channelId, { type: "higherlower", state: "lobby" });
    return;
  }

  if (game.state === "playing") {
    await game.message
      .edit({ embeds: [buildPlayEmbed(game)], components: buildPlayComponents(game) })
      .catch(() => {});
    updateActiveGame(game.channelId, { type: "higherlower", state: "playing" });
    return;
  }

  // ended
  await game.message.edit({ components: [] }).catch(() => {});
}

async function promptBetModal(i, gameId) {
  const modal = new ModalBuilder()
    .setCustomId(`holbet:${gameId}`)
    .setTitle("Set Higher/Lower Bet")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("amount")
          .setLabel(`Bet amount (min ${MIN_BET})`)
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("e.g. 5000")
          .setRequired(true)
      )
    );

  await i.showModal(modal);

  const submitted = await i
    .awaitModalSubmit({
      time: 60_000,
      filter: (m) => m.customId === `holbet:${gameId}` && m.user.id === i.user.id,
    })
    .catch(() => null);

  return submitted;
}

async function placeBet({ interaction, game, amount }) {
  const userId = interaction.user.id;
  const guildId = interaction.guildId;

  const p = game.players.get(userId);
  if (!p) return { ok: false, msg: "You need to **Join** first." };
  if (game.state !== "lobby") return { ok: false, msg: "You can’t change your bet once the round starts." };

  const bet = Number(amount || 0);
  if (!Number.isFinite(bet) || bet < MIN_BET) return { ok: false, msg: `Minimum bet is $${MIN_BET.toLocaleString()}.` };
  if (bet > MAX_BET) return { ok: false, msg: `Maximum bet is $${MAX_BET.toLocaleString()}.` };

  // If previously paid, refund the stake (not the fee) before re-betting.
  if (p.paid && p.betAmount) {
    await bankToUserIfEnough(guildId, userId, Number(p.betAmount), "higherlower_rebet_refund", {
      channelId: game.channelId,
      gameId: game.gameId,
      userId,
      prevBet: Number(p.betAmount),
    }).catch(() => {});
    p.paid = false;
  }

  const charge = await chargeWithCasinoFee({
    guildId,
    userId,
    amountStake: bet,
    type: "higherlower_bet",
    meta: {
      channelId: game.channelId,
      gameId: game.gameId,
      username: interaction.user.username,
      displayName: interaction.member?.displayName || interaction.user.globalName || interaction.user.username,
      bet,
    },
    game,
    channel: interaction.channel,
    hostId: game.hostId,
  });

  if (!charge.ok) return { ok: false, msg: "Not enough balance to place that bet (including table fee)." };

  await addServerBank(guildId, bet, "higherlower_bank_bet", { channelId: game.channelId, gameId: game.gameId, userId, bet });
  if (charge.feeAmount > 0) {
    await addServerBank(guildId, charge.feeAmount, "higherlower_fee_bank_bet", {
      channelId: game.channelId,
      gameId: game.gameId,
      userId,
      feeAmount: charge.feeAmount,
      effectiveFeePct: charge.effectiveFeePct,
    });
  }

  p.betAmount = bet;
  p.paid = true;

  // Achievements (safe if not defined)
  if (bet >= HOL_RULES.HIGH_ROLLER_BET) {
    await holUnlock(interaction, guildId, userId, HOL_ACH.HIGH_ROLLER);
  }

  const bankNow = await getServerBank(guildId).catch(() => null);
  await render(game);

  return {
    ok: true,
    msg: `✅ Bet set: **$${bet.toLocaleString()}** (buy-in paid)\n🛡️ Fee: **$${charge.feeAmount.toLocaleString()}**${
      Number.isFinite(bankNow) ? `\n🏦 Server bank: **$${Number(bankNow).toLocaleString()}**` : ""
    }`,
  };
}

function allAliveHaveGuessed(game) {
  for (const p of game.players.values()) {
    if (p.status === "alive" && !p.guess) return false;
  }
  return true;
}

async function revealNext(game) {
  // draw next
  game.nextCard = game.deck.pop() || null;
  game.revealedNext = true;

  const cur = game.currentCard;
  const next = game.nextCard;
  if (!next) {
    game.lastRevealNote = "🃏 Deck is empty — ending table.";
    game.state = "ended";
    return;
  }

  const cmp = compare(next.v, cur.v);
  const isTie = cmp === 0;

  let survived = 0;
  for (const p of game.players.values()) {
    if (p.status !== "alive") continue;

    const g = p.guess;
    p.guess = null;

    // tie = loss
    let ok = false;
    if (!isTie) {
      if (g === "higher" && cmp === 1) ok = true;
      if (g === "lower" && cmp === -1) ok = true;
    }

    if (ok) {
      p.streak += 1;
      survived += 1;
    } else {
      p.status = "busted";
    }
  }

  game.lastRevealNote = isTie
    ? `😬 **Tie!** Next card was ${cardLabel(next)} — ties are a **loss**.`
    : `Next card was **${cardLabel(next)}**. ${survived} player(s) survived.`;

  game.currentCard = next;
  game.revealedNext = false;

  // If nobody alive, end.
  const anyAlive = [...game.players.values()].some((p) => p.status === "alive");
  if (!anyAlive) {
    game.state = "ended";
  }
}

async function cashOut(interaction, game) {
  const userId = interaction.user.id;
  const guildId = interaction.guildId;
  const p = game.players.get(userId);
  if (!p) return sendEphemeralToast(interaction, "❌ You’re not in this table.");
  if (game.state !== "playing") return sendEphemeralToast(interaction, "❌ You can only cash out during a round.");
  if (p.status !== "alive") return sendEphemeralToast(interaction, "❌ You’re not alive in the round.");
  if (!p.paid || !p.betAmount) return sendEphemeralToast(interaction, "❌ You haven’t placed a bet.");

  const mult = multiplierForStreak(p.streak);
  const payout = Math.floor(Number(p.betAmount) * mult);

  const ok = await bankToUserIfEnough(guildId, userId, payout, "higherlower_cashout", {
    channelId: game.channelId,
    gameId: game.gameId,
    userId,
    bet: Number(p.betAmount),
    streak: p.streak,
    multiplier: mult,
    payout,
  }).catch(() => false);

  if (!ok) {
    return sendEphemeralToast(interaction, "❌ The server bank can’t cover that cashout right now.");
  }

  p.status = "cashed";
  p.cashoutMult = mult;

  // Achievements
  await holUnlock(interaction, guildId, userId, HOL_ACH.FIRST_CASHOUT);
  if (p.streak >= 5) await holUnlock(interaction, guildId, userId, HOL_ACH.STREAK_5);

  await render(game);
  return sendEphemeralToast(
    interaction,
    `💰 Cashed out for **$${payout.toLocaleString()}** (x${mult.toFixed(1)}).\nStreak: **${p.streak}**`
  );
}

async function endTable(game) {
  game.state = "ended";
  await render(game);

  activeGames.delete(game.channelId);
  clearActiveGame(game.channelId);

  setTimeout(() => {
    game.message?.delete().catch(() => {});
  }, 15_000);
}

// ---------- lifecycle ----------
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

  // Block if already running
  if (activeGames.has(channelId)) {
    await interaction.editReply("❌ There’s already an active game in this channel.").catch(() => {});
    return;
  }

  const game = {
    type: "higherlower",
    state: "lobby",
    gameId: crypto.randomBytes(6).toString("hex"),
    channelId,
    guildId,
    hostId: interaction.user.id,
    maxPlayers: 10,
    hostSecurity: null,
    players: new Map(), // userId -> player
    deck: [],
    currentCard: null,
    nextCard: null,
    revealedNext: false,
    lastRevealNote: null,
    message: null,
  };

  await ensureHostSecurity(game, guildId, game.hostId);

  // register under gameManager map so hub knows channel is busy
  activeGames.set(channelId, game);
  setActiveGame(channelId, { type: "higherlower", state: "lobby", gameId: game.gameId, hostId: game.hostId });

  // host auto-joins (no bet paid yet)
  game.players.set(interaction.user.id, {
    userId: interaction.user.id,
    user: `<@${interaction.user.id}>`,
    betAmount: MIN_BET,
    paid: false,
    status: "alive",
    streak: 0,
    guess: null,
    cashoutMult: null,
  });

  game.message = await interaction.channel.send({
    embeds: [buildLobbyEmbed(game)],
    components: buildLobbyComponents(game),
  });

  const collector = game.message.createMessageComponentCollector({ time: 30 * 60 * 60_000 });

  collector.on("collect", async (i) => {
    const cid = String(i.customId || "");
    const [prefix, gameId, action] = cid.split(":");
    if (prefix !== "hol" || gameId !== game.gameId) return;

    // Set Bet is modal-based and must happen BEFORE defer/update.
    if (action === "setbet") {
      if (await guardNotJailedComponent(i)) return;
      if (!game.players.has(i.user.id)) {
        return i.reply({ content: "❌ You need to **Join** first.", flags: MessageFlags.Ephemeral }).catch(() => {});
      }

      const submitted = await promptBetModal(i, game.gameId);
      if (!submitted) return;

      await submitted.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
      const amount = parseAmount(submitted.fields.getTextInputValue("amount"));
      const res = await placeBet({ interaction: submitted, game, amount });
      if (!res.ok) {
        await submitted.editReply(`❌ ${res.msg}`).catch(() => {});
      } else {
        await submitted.editReply(res.msg).catch(() => {});
      }
      return;
    }

    if (await guardNotJailedComponent(i)) return;
    await i.deferUpdate().catch(() => {});

    const isHost = i.user.id === game.hostId;

    if (action === "join") {
      if (game.players.has(i.user.id)) return sendEphemeralToast(i, "ℹ️ You’re already in.");
      if (game.players.size >= game.maxPlayers) return sendEphemeralToast(i, "❌ Table is full.");

      game.players.set(i.user.id, {
        userId: i.user.id,
        user: `<@${i.user.id}>`,
        betAmount: MIN_BET,
        paid: false,
        status: "alive",
        streak: 0,
        guess: null,
        cashoutMult: null,
      });

      await render(game);
      return sendEphemeralToast(i, `✅ Joined. Default bet is **$${MIN_BET.toLocaleString()}** — hit **Set Bet** to pay in.`);
    }

    if (action === "leave") {
      const p = game.players.get(i.user.id);
      if (!p) return sendEphemeralToast(i, "ℹ️ You’re not in this table.");

      // refund stake only if paid
      if (p.paid && p.betAmount) {
        await bankToUserIfEnough(guildId, i.user.id, Number(p.betAmount), "higherlower_leave_refund", {
          channelId,
          gameId: game.gameId,
          userId: i.user.id,
        }).catch(() => {});
      }

      game.players.delete(i.user.id);
      if (i.user.id === game.hostId) {
        collector.stop("host_left");
        return;
      }

      await render(game);
      return sendEphemeralToast(i, "✅ Left the table.");
    }

    if (action === "start") {
      if (!isHost) return sendEphemeralToast(i, "❌ Only the host can start the round.");
      if (game.state !== "lobby") return sendEphemeralToast(i, "ℹ️ Round already started.");

      // Require at least 1 paid player
      const paidPlayers = [...game.players.values()].filter((p) => p.paid);
      if (paidPlayers.length === 0) return sendEphemeralToast(i, "❌ At least one player must **Set Bet** (pay in) before starting.");

      // Announce casino security once per table
      await maybeAnnounceCasinoSecurity(i.channel, guildId, game.hostId).catch(() => {});

      // Reset round state
      game.deck = buildDeck();
      game.currentCard = game.deck.pop();
      game.nextCard = null;
      game.revealedNext = false;
      game.lastRevealNote = null;
      game.state = "playing";

      for (const p of game.players.values()) {
        p.status = p.paid ? "alive" : "spectator";
        p.streak = 0;
        p.guess = null;
        p.cashoutMult = null;
      }

      await render(game);
      return sendEphemeralToast(i, "🃏 Round started! Pick **Higher** or **Lower**.");
    }

    if (action === "higher" || action === "lower") {
      if (game.state !== "playing") return;
      const p = game.players.get(i.user.id);
      if (!p) return sendEphemeralToast(i, "❌ You’re not in this table.");
      if (p.status !== "alive") return sendEphemeralToast(i, "❌ You’re not alive in this round.");

      p.guess = action;
      await render(game);

      if (allAliveHaveGuessed(game)) {
        await revealNext(game);

        // Bust achievements
        for (const pl of game.players.values()) {
          if (pl.status === "busted") {
            await holUnlock(i, guildId, pl.userId, HOL_ACH.FIRST_BUST);
          }
        }

        if (game.state === "ended") {
          collector.stop("round_over");
          return;
        }

        await render(game);
      }
      return;
    }

    if (action === "cashout") {
      await cashOut(i, game);

      // If no alive players remain, end.
      const anyAlive = [...game.players.values()].some((p) => p.status === "alive");
      if (!anyAlive) collector.stop("no_alive");
      return;
    }

    if (action === "end") {
      if (!isHost) return sendEphemeralToast(i, "❌ Only the host can end the table.");
      collector.stop("ended_by_host");
      return;
    }
  });

  collector.on("end", async () => {
    // Mark ended and clean up
    game.state = "ended";
    await render(game);
    await endTable(game);
  });

  await interaction.editReply("🔼🔽 Higher or Lower table launched. Players: **Join** then **Set Bet**.").catch(() => {});
}

module.exports = {
  startFromHub,
};
