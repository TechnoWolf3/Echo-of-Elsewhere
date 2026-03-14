// data/games/keno.js
// Live Keno Table (Heads/Tails/Draw + Classic Keno ticket)
// Used by /games hub (NOT a slash command).
//
// Key rules (per Shey):
// - Continuous rounds until closed or 15 minutes of no interaction.
// - Each round: 30s betting window (shows previous round results), then draw 20 UNIQUE numbers.
// - Draw animation: reveal 1 number every 2 seconds, placing it into Heads/Tails "boxes".
// - Heads = 1–40, Tails = 41–80.
// - Outcome: Heads if >=11 heads numbers, Tails if >=11 tails numbers, Draw if 10/10.
// - Payouts for Heads/Tails/Draw bets: 2x / 2x / 4x.
// - Only ONE bet per user per round.

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
  PermissionFlagsBits,
} = require("discord.js");

const { activeGames } = require("../../utils/gameManager");
const { setActiveGame, clearActiveGame } = require("../../utils/gamesHubState");
const { guardGamesComponent } = require("../../utils/echoRift/curseGuard");
const { guardNotJailedComponent } = require("../../utils/jail");
const economy = require("../../utils/economy");
const { creditUserWithEffects, handleTriggeredEffectEvent } = require("../../utils/effectSystem");

const ACTIVITY_EFFECTS = {
  effectsApply: true,
  canAwardEffects: true,
  blockedBlessings: [],
  blockedCurses: [],
  effectAwardPool: { nothingWeight: 100, blessingWeight: 0, curseWeight: 0, blessingWeights: {}, curseWeights: {} },
};

const TABLE_IDLE_MS = 15 * 60 * 1000;
const BETTING_MS = 30 * 1000;
const REVEAL_EVERY_MS = 2 * 1000;
const DRAW_COUNT = 20;

const tablesById = new Map(); // tableId -> session

// Classic Keno payout table (multiplier of bet, INCLUDING stake)
const KENO_PAYOUTS = {
  1: { 1: 3.5 },
  2: { 2: 10, 1: 1 },
  3: { 3: 25, 2: 2 },
  4: { 4: 75, 3: 5, 2: 1 },
  5: { 5: 250, 4: 15, 3: 2 },
  6: { 6: 800, 5: 50, 4: 5, 3: 1 },
  7: { 7: 2000, 6: 120, 5: 15, 4: 2 },
  8: { 8: 5000, 7: 400, 6: 50, 5: 10, 4: 2 },
  9: { 9: 10000, 8: 1000, 7: 120, 6: 25, 5: 5, 4: 1 },
  10: { 10: 25000, 9: 2500, 8: 400, 7: 80, 6: 20, 5: 5, 4: 1 },
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function makeTableId() {
  return crypto.randomBytes(6).toString("hex");
}

function clampInt(n, min, max) {
  const x = Number.parseInt(String(n), 10);
  if (!Number.isFinite(x)) return null;
  if (x < min) return min;
  if (x > max) return max;
  return x;
}

function parseNumbersInput(raw) {
  const s = String(raw || "").trim();
  if (!s) return [];
  // Accept: "1 2 3", "1,2,3", "1, 2, 3", "1-3" (basic ranges)
  const parts = s
    .split(/[\s,]+/g)
    .map((p) => p.trim())
    .filter(Boolean);

  const out = [];
  for (const p of parts) {
    if (/^\d+\-\d+$/.test(p)) {
      const [a, b] = p.split("-").map((x) => Number.parseInt(x, 10));
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      for (let n = lo; n <= hi; n++) out.push(n);
    } else {
      const n = Number.parseInt(p, 10);
      if (Number.isFinite(n)) out.push(n);
    }
  }

  // Keep only 1..80, unique, preserve order of first appearance
  const seen = new Set();
  const cleaned = [];
  for (const n of out) {
    if (n < 1 || n > 80) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    cleaned.push(n);
  }
  return cleaned;
}

function formatTime(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function buildBoxes(headsNums, tailsNums) {
  // Up to 20 boxes each side (4 rows of 5) so a round can be all-heads or all-tails.
  const SLOTS = 20;
  const COLS = 5;
  const ROWS = 4;
  const pad2 = (n) => String(n).padStart(2, "0");
  const toCells = (arr) => arr.map((n) => (n == null ? "  " : pad2(n)));

  const Hraw = headsNums.slice(0, SLOTS);
  const Traw = tailsNums.slice(0, SLOTS);
  const H = toCells(Hraw.concat(Array(Math.max(0, SLOTS - Hraw.length)).fill(null))).slice(0, SLOTS);
  const T = toCells(Traw.concat(Array(Math.max(0, SLOTS - Traw.length)).fill(null))).slice(0, SLOTS);

  const row = (cells, start) =>
    `│ ${cells[start]} │ ${cells[start + 1]} │ ${cells[start + 2]} │ ${cells[start + 3]} │ ${cells[start + 4]} │`;
  const top = "┌────┬────┬────┬────┬────┐";
  const mid = "├────┼────┼────┼────┼────┤";
  const bot = "└────┴────┴────┴────┴────┘";

  const lines = [];
  lines.push("HEADS (1–40)                 TAILS (41–80)");
  lines.push(`${top}   ${top}`);
  for (let r = 0; r < ROWS; r++) {
    const start = r * COLS;
    lines.push(`${row(H, start)}   ${row(T, start)}`);
    if (r !== ROWS - 1) lines.push(`${mid}   ${mid}`);
  }
  lines.push(`${bot}   ${bot}`);

  return "```txt\n" + lines.join("\n") + "\n```";
}

function outcomeFromCounts(headsCount, tailsCount) {
  if (headsCount >= 11) return "HEADS";
  if (tailsCount >= 11) return "TAILS";
  return "DRAW"; // must be 10/10 if 20 total
}

function buildComponents(session, { disabled = false } = {}) {
  const tableId = session.tableId;
  // Allow placing bets during DRAWING by queueing them for the NEXT round.
  // Only disable components when the table is closing.
  const canInteract = session.phase !== "closing" && !disabled;
  const canCancel = canInteract; // cancel works for current bet (betting) or queued bet (drawing)
  const canBetNowOrQueue = canInteract; // betting phase = applies now, drawing phase = queues

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`keno:bet:${tableId}:heads`)
      .setLabel("Heads (2x)")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!canBetNowOrQueue),
    new ButtonBuilder()
      .setCustomId(`keno:bet:${tableId}:tails`)
      .setLabel("Tails (2x)")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!canBetNowOrQueue),
    new ButtonBuilder()
      .setCustomId(`keno:bet:${tableId}:draw`)
      .setLabel("Draw (4x)")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!canBetNowOrQueue),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`keno:ticket:${tableId}`)
      .setLabel("Keno Ticket (1–10)")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!canBetNowOrQueue),
    new ButtonBuilder()
      .setCustomId(`keno:quick:${tableId}`)
      .setLabel("Quick Pick")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!canBetNowOrQueue),
    new ButtonBuilder()
      .setCustomId(`keno:cancel:${tableId}`)
      .setLabel("Cancel Bet")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!canCancel),
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`keno:close:${tableId}`)
      .setLabel("Close Table")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
  );

  return [row1, row2, row3];
}

function buildEmbed(session, { now = Date.now() } = {}) {
  const e = new EmbedBuilder()
    .setTitle(`🔢 KENO — Round ${session.round} (${session.phase.toUpperCase()})`)
    .setDescription(
      [
        "**Bet Types**",
        "• **Heads / Tails / Draw** (based on the 20-ball split)",
        "• **Classic Keno Ticket** (pick 1–10 numbers, paid by matches)",
        "",
        session.phase === "betting"
          ? `⏳ Betting closes in: **${formatTime(session.bettingEndsAt - now)}**`
          : session.phase === "drawing"
          ? `🎱 Drawing… next ball in **${Math.max(0, Math.ceil((session.nextRevealAt - now) / 1000))}s**`
          : session.phase === "closing"
          ? "🛑 Closing…"
          : "",
      ].filter(Boolean).join("\n")
    );

  // Previous results (shown during betting)
  if (session.lastResult && session.phase === "betting") {
    const r = session.lastResult;
    const winnersLines = [];
    const maxList = 12;

    const allWinners = r.winners || [];
    for (let i = 0; i < Math.min(maxList, allWinners.length); i++) {
      const w = allWinners[i];
      winnersLines.push(`• <@${w.userId}> — **${w.label}** → **+$${w.profit.toLocaleString()}**`);
    }
    if (allWinners.length > maxList) {
      winnersLines.push(`• …and **${allWinners.length - maxList}** more`);
    }
    if (allWinners.length === 0) winnersLines.push("• _No winners this round._");

    e.addFields(
      {
        name: `Last Result — Round ${r.round}`,
        value: `**${r.outcome}**  (Heads: **${r.headsCount}** | Tails: **${r.tailsCount}**)`,
        inline: false,
      },
      {
        name: "Winners",
        value: winnersLines.join("\n"),
        inline: false,
      }
    );
  }

  // Draw board (shown during drawing)
  if (session.phase === "drawing") {
    const drawnHeads = session.drawnHeads || [];
    const drawnTails = session.drawnTails || [];
    const headsCount = drawnHeads.length;
    const tailsCount = drawnTails.length;

    e.addFields({
      name: "Draw Board",
      value: buildBoxes(drawnHeads, drawnTails) + `\nHeads: **${headsCount}** / ${DRAW_COUNT}   •   Tails: **${tailsCount}** / ${DRAW_COUNT}`,
      inline: false,
    });
  }

  // Round bet count (always useful)
  const betCount = session.bets.size;
  e.setFooter({ text: `Bets this round: ${betCount} • Table closes after 15m inactivity` });

  return e;
}

function buildAmountModal(customId, title = "Place your bet") {
  const modal = new ModalBuilder().setCustomId(customId).setTitle(title);

  const amt = new TextInputBuilder()
    .setCustomId("amt")
    .setLabel("Bet amount")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("e.g. 500")
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(amt));
  return modal;
}

function buildTicketModal(customId) {
  const modal = new ModalBuilder().setCustomId(customId).setTitle("Keno Ticket");

  const nums = new TextInputBuilder()
    .setCustomId("nums")
    .setLabel("Pick 1–10 numbers (1–80)")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("e.g. 3 12 18 27 39 OR 1-5, 12, 44")
    .setRequired(true);

  const amt = new TextInputBuilder()
    .setCustomId("amt")
    .setLabel("Bet amount")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("e.g. 500")
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(nums));
  modal.addComponents(new ActionRowBuilder().addComponents(amt));
  return modal;
}

async function safeEdit(session) {
  try {
    const now = Date.now();
    await session.message.edit({
      embeds: [buildEmbed(session, { now })],
      components: buildComponents(session, { disabled: session.phase === "closing" }),
    });
  } catch (e) {
    console.error("[KENO] message edit failed:", e);
  }
}

function pickUniqueDraw20() {
  // Fisher–Yates shuffle of [1..80], take first 20 (guaranteed unique)
  const arr = Array.from({ length: 80 }, (_, i) => i + 1);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, DRAW_COUNT);
}

function countMatches(ticketNums, drawnSet) {
  let hits = 0;
  for (const n of ticketNums) {
    if (drawnSet.has(n)) hits++;
  }
  return hits;
}

function kenoMultiplier(picks, hits) {
  const m = KENO_PAYOUTS[picks]?.[hits];
  return typeof m === "number" ? m : 0;
}

async function closeSession(session, reason = "closed") {
  if (!session || session.closed) return;
  session.closed = true;
  session.phase = "closing";

  clearTimeout(session._betTickTimer);
  clearTimeout(session._betEndTimer);
  clearTimeout(session._idleTimer);

  try {
    // Disable components + final embed
    const e = new EmbedBuilder()
      .setTitle(`🔢 KENO — Table Closed`)
      .setDescription(
        reason === "idle"
          ? "⏳ Closed due to **15 minutes of inactivity**."
          : "🛑 The table was closed."
      );
    await session.message.edit({ embeds: [e], components: buildComponents(session, { disabled: true }) });
  } catch {}

  try {
    activeGames.delete(session.channelId);
    clearActiveGame(session.channelId);
  } catch {}
  tablesById.delete(session.tableId);
}

function bumpIdle(session) {
  session.lastInteractionAt = Date.now();
  clearTimeout(session._idleTimer);
  session._idleTimer = setTimeout(() => closeSession(session, "idle"), TABLE_IDLE_MS);
}

async function runBettingPhase(session) {
  session.phase = "betting";
  // Carry over any queued bets from the previous DRAWING phase.
  session.bets.clear();
  if (session.queuedBets && session.queuedBets.size) {
    for (const [uid, bet] of session.queuedBets.entries()) {
      // Bet was queued for this round; set it as the active bet.
      session.bets.set(uid, { ...bet, round: session.round });
    }
    session.queuedBets.clear();
  }
  session.bettingEndsAt = Date.now() + BETTING_MS;

  bumpIdle(session);
  await safeEdit(session);

  // Tick countdown every 5 seconds
  const tick = async () => {
    if (session.closed) return;
    const now = Date.now();
    if (now >= session.bettingEndsAt) return;
    await safeEdit(session);
    session._betTickTimer = setTimeout(tick, 5000);
  };
  session._betTickTimer = setTimeout(tick, 5000);

  await new Promise((resolve) => {
    session._betEndTimer = setTimeout(resolve, BETTING_MS);
  });

  clearTimeout(session._betTickTimer);
}

async function runDrawingPhase(session) {
  session.phase = "drawing";
  session.drawnHeads = [];
  session.drawnTails = [];

  // Disable betting while drawing
  session.nextRevealAt = Date.now() + REVEAL_EVERY_MS;
  await safeEdit(session);

  const draw = pickUniqueDraw20();
  session._fullDraw = draw;

  for (let idx = 0; idx < draw.length; idx++) {
    if (session.closed) return;
    const n = draw[idx];
    if (n <= 40) session.drawnHeads.push(n);
    else session.drawnTails.push(n);

    session.nextRevealAt = Date.now() + REVEAL_EVERY_MS;
    await safeEdit(session);
    await sleep(REVEAL_EVERY_MS);
  }
}

async function processResults(session) {
  const draw = session._fullDraw || [];
  const drawnSet = new Set(draw);

  const headsCount = draw.filter((n) => n <= 40).length;
  const tailsCount = DRAW_COUNT - headsCount;
  const outcome = outcomeFromCounts(headsCount, tailsCount);

  const winners = [];
  const lossNotices = [];

  // Resolve each bet
  for (const [userId, bet] of session.bets.entries()) {
    if (bet.kind === "HTD") {
      const win = bet.choice.toUpperCase() === outcome;
      if (win) {
        const mult = bet.choice === "draw" ? 4 : 2;
        const payout = Math.floor(bet.amount * mult);
        const profit = payout - bet.amount;
        await creditUserWithEffects({
          guildId: session.guildId,
          userId,
          amount: payout,
          type: "keno_win",
          meta: {
            game: "keno",
            kind: "HTD",
            choice: bet.choice,
            outcome,
            round: session.round,
          },
          activityEffects: ACTIVITY_EFFECTS,
          awardSource: "keno",
        });
        winners.push({ userId, label: `${bet.choice.toUpperCase()} (x${mult})`, profit });
      } else {
        const triggerJail = await handleTriggeredEffectEvent({
          guildId: session.guildId,
          userId,
          eventKey: 'casino_loss',
          context: { source: 'keno' },
        }).catch(() => null);
        if (triggerJail?.triggered && triggerJail.notice) {
          lossNotices.push(`• <@${userId}> ${triggerJail.notice}`);
        }
      }
    } else if (bet.kind === "KENO") {
      const picks = bet.numbers.length;
      const hits = countMatches(bet.numbers, drawnSet);
      const mult = kenoMultiplier(picks, hits);
      if (mult > 0) {
        const payout = Math.floor(bet.amount * mult);
        const profit = payout - bet.amount;
        await creditUserWithEffects({
          guildId: session.guildId,
          userId,
          amount: payout,
          type: "keno_win",
          meta: {
            game: "keno",
            kind: "KENO",
            picks,
            hits,
            mult,
            round: session.round,
          },
          activityEffects: ACTIVITY_EFFECTS,
          awardSource: "keno",
        });
        winners.push({ userId, label: `${hits}/${picks} (x${mult})`, profit });
      } else {
        const triggerJail = await handleTriggeredEffectEvent({
          guildId: session.guildId,
          userId,
          eventKey: 'casino_loss',
          context: { source: 'keno' },
        }).catch(() => null);
        if (triggerJail?.triggered && triggerJail.notice) {
          lossNotices.push(`• <@${userId}> ${triggerJail.notice}`);
        }
      }
    }
  }

  session.lastResult = {
    round: session.round,
    outcome,
    headsCount,
    tailsCount,
    winners,
    lossNotices,
  };
}

async function gameLoop(session) {
  while (!session.closed) {
    // Betting for current round
    await runBettingPhase(session);
    if (session.closed) break;

    // Drawing for current round
    await runDrawingPhase(session);
    if (session.closed) break;

    // Process results for current round
    try {
      await processResults(session);
    } catch (e) {
      console.error("[KENO] processResults error:", e);
    }

    // Advance round number for next betting window (results shown from previous)
    session.round += 1;

    // Clear draw artifacts for next round
    session._fullDraw = null;
    session.drawnHeads = [];
    session.drawnTails = [];
  }
}

// ---------- Hub entry ----------
async function startFromHub(interaction) {
  if (!interaction.inGuild?.()) {
    return interaction.reply({ content: "❌ Server only.", flags: MessageFlags.Ephemeral }).catch(() => {});
  }

  // Gate the component action
  if (await guardGamesComponent(interaction)) return;
  if (await guardNotJailedComponent(interaction)) return;

  const channelId = interaction.channelId;

  if (activeGames.has(channelId)) {
    await interaction.followUp({
      content: "❌ There’s already an active game in this channel.",
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return;
  }

  const tableId = makeTableId();
  const session = {
    tableId,
    guildId: interaction.guildId,
    channelId,
    hostId: interaction.user.id,
    channel: interaction.channel,
    message: null,

    round: 1,
    phase: "betting",

    bets: new Map(), // userId -> bet
    queuedBets: new Map(), // userId -> bet queued for next round (placed during drawing)
    lastResult: null,

    lastInteractionAt: Date.now(),
    bettingEndsAt: Date.now() + BETTING_MS,
    nextRevealAt: Date.now() + REVEAL_EVERY_MS,

    closed: false,

    _idleTimer: null,
    _betTickTimer: null,
    _betEndTimer: null,
    _fullDraw: null,

    drawnHeads: [],
    drawnTails: [],
  };

  tablesById.set(tableId, session);
  activeGames.set(channelId, { type: "keno", state: "running" });
  setActiveGame(channelId, { type: "keno", state: "running" });

  // Post the table in-channel
  const msg = await interaction.channel
    .send({
      embeds: [buildEmbed(session)],
      components: buildComponents(session),
    })
    .catch((e) => {
      console.error("[KENO] failed to send table message:", e);
      return null;
    });

  if (!msg) {
    activeGames.delete(channelId);
    clearActiveGame(channelId);
    tablesById.delete(tableId);
    return;
  }

  session.message = msg;
  bumpIdle(session);

  // Collector for table buttons (betting actions)
  const collector = msg.createMessageComponentCollector({ idle: TABLE_IDLE_MS });

  collector.on("collect", async (i) => {
    if (session.closed) return;

    // Always refresh idle on any attempt
    bumpIdle(session);

    if (await guardGamesComponent(i)) return;
    if (await guardNotJailedComponent(i)) return;

    const cid = String(i.customId || "");

    // Only allow Keno components for this table
    if (!cid.includes(`:${tableId}`)) {
      return i.reply({ content: "❌ That table isn’t active anymore.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    // Close table (host/admin)
    if (cid.startsWith("keno:close:")) {
      const isHost = i.user.id === session.hostId;
      const isAdmin = i.memberPermissions?.has?.(PermissionFlagsBits.Administrator);
      if (!isHost && !isAdmin) {
        return i.reply({ content: "❌ Only the table host (or an admin) can close this table.", flags: MessageFlags.Ephemeral }).catch(() => {});
      }
      await i.deferUpdate().catch(() => {});
      collector.stop("closed");
      await closeSession(session, "closed");
      return;
    }

    // Cancel bet (refund)
    if (cid.startsWith("keno:cancel:")) {
      const isBetting = session.phase === "betting";
      const isDrawing = session.phase === "drawing";
      if (!isBetting && !isDrawing) {
        return i.reply({ content: "❌ You can’t cancel a bet right now.", flags: MessageFlags.Ephemeral }).catch(() => {});
      }

      const existing = (isBetting ? session.bets : session.queuedBets).get(i.user.id);
      if (!existing) {
        return i.reply({ content: isBetting ? "You don’t have a bet to cancel this round." : "You don’t have a queued bet to cancel.", flags: MessageFlags.Ephemeral }).catch(() => {});
      }
      // Refund bet amount
      await economy.creditUser(session.guildId, i.user.id, existing.amount, "keno_refund", {
        game: "keno",
        round: existing.round ?? (isBetting ? session.round : session.round + 1),
      }).catch(() => {});

      (isBetting ? session.bets : session.queuedBets).delete(i.user.id);
      await i.reply({ content: `✅ ${isBetting ? "Bet" : "Queued bet"} cancelled. Refunded **$${existing.amount.toLocaleString()}**.`, flags: MessageFlags.Ephemeral }).catch(() => {});
      await safeEdit(session);
      return;
    }

    // Betting actions open modals (handled in handleInteraction)
    // If we're drawing, we allow queueing a bet for the next round.
    if (session.phase !== "betting" && session.phase !== "drawing") {
      return i.reply({ content: "❌ This table isn’t accepting bets right now.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    // One bet per user: either placed this round (BETTING) or queued (DRAWING)
    if (session.bets.has(i.user.id) || session.queuedBets.has(i.user.id)) {
      return i.reply({ content: "❌ You already have a bet locked in. (Use **Cancel Bet** if you want to change it.)", flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    if (cid.startsWith("keno:bet:")) {
      const choice = cid.split(":").pop(); // heads|tails|draw
      const modal = buildAmountModal(`keno:modal:htd:${tableId}:${choice}`, `Bet on ${choice.toUpperCase()}`);
      return i.showModal(modal).catch(() => {});
    }

    if (cid.startsWith("keno:ticket:")) {
      const modal = buildTicketModal(`keno:modal:ticket:${tableId}`);
      return i.showModal(modal).catch(() => {});
    }

    if (cid.startsWith("keno:quick:")) {
      const modal = buildAmountModal(`keno:modal:quick:${tableId}`, "Quick Pick Ticket");
      return i.showModal(modal).catch(() => {});
    }

    return i.reply({ content: "❌ Unknown action.", flags: MessageFlags.Ephemeral }).catch(() => {});
  });

  collector.on("end", async (_c, reason) => {
    if (session.closed) return;
    if (reason === "idle") {
      await closeSession(session, "idle");
    }
  });

  // Let the user know it's started (ephemeral)
  await interaction.followUp({
    content: "✅ Keno table opened in this channel.",
    flags: MessageFlags.Ephemeral,
  }).catch(() => {});

  // Run loop
  gameLoop(session).catch((e) => console.error("[KENO] loop error:", e));
}

// ---------- Modal handler (routed from index.js) ----------
async function handleInteraction(interaction) {
  const cid = String(interaction.customId || "");
  if (!cid.startsWith("keno:modal:")) return false;

  // Gate
  if (await guardGamesComponent(interaction)) return true;
  if (await guardNotJailedComponent(interaction)) return true;

  const parts = cid.split(":"); // keno:modal:<type>:<tableId>[:choice]
  const type = parts[2];
  const tableId = parts[3];
  const choice = parts[4]; // heads/tails/draw (for htd)

  const session = tablesById.get(tableId);
  if (!session || session.closed) {
    await interaction.reply({ content: "❌ This Keno table is no longer active.", flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }

  bumpIdle(session);

  const isBetting = session.phase === "betting";
  const isDrawing = session.phase === "drawing";
  if (!isBetting && !isDrawing) {
    await interaction.reply({ content: "❌ This table isn’t accepting bets right now.", flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }

  // One bet per user: either active for this round or queued for next.
  if (session.bets.has(interaction.user.id) || session.queuedBets.has(interaction.user.id)) {
    await interaction.reply({ content: "❌ You already have a bet locked in.", flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }

  const targetRound = isBetting ? session.round : session.round + 1;
  const targetMap = isBetting ? session.bets : session.queuedBets;

  const amtRaw = interaction.fields?.getTextInputValue?.("amt");
  const amt = clampInt(amtRaw, 1, 1_000_000_000);
  if (!amt || amt <= 0) {
    await interaction.reply({ content: "❌ Invalid bet amount.", flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }

  // Ensure user + debit
  await economy.ensureUser(session.guildId, interaction.user.id).catch(() => {});
  const debit = await economy.tryDebitUser(session.guildId, interaction.user.id, amt, "keno_bet", {
    game: "keno",
    round: targetRound,
    kind: type,
    choice: choice || null,
    queued: isDrawing ? true : false,
  });

  if (!debit?.ok) {
    await interaction.reply({ content: "❌ You don’t have enough cash for that bet.", flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }

  if (type === "htd") {
    const c = String(choice || "").toLowerCase();
    if (!["heads", "tails", "draw"].includes(c)) {
      // Refund if something went wrong
      await economy.creditUser(session.guildId, interaction.user.id, amt, "keno_refund", { game: "keno", round: targetRound }).catch(() => {});
      await interaction.reply({ content: "❌ Invalid choice.", flags: MessageFlags.Ephemeral }).catch(() => {});
      return true;
    }

    targetMap.set(interaction.user.id, { kind: "HTD", choice: c, amount: amt, round: targetRound });
    await interaction.reply({
      content: isBetting
        ? `✅ Bet placed: **${c.toUpperCase()}** for **$${amt.toLocaleString()}**.`
        : `✅ Queued for **Round ${targetRound}**: **${c.toUpperCase()}** for **$${amt.toLocaleString()}**.`,
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    await safeEdit(session);
    return true;
  }

  if (type === "quick") {
    const numbers = [];
    const pool = Array.from({ length: 80 }, (_, i) => i + 1);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const picks = 10;
    for (let i = 0; i < picks; i++) numbers.push(pool[i]);

    targetMap.set(interaction.user.id, { kind: "KENO", numbers, amount: amt, round: targetRound });
    await interaction.reply({
      content:
        (isBetting
          ? `✅ Quick Pick placed for **$${amt.toLocaleString()}**.`
          : `✅ Quick Pick queued for **Round ${targetRound}** for **$${amt.toLocaleString()}**.`) +
        `\n🎟️ Numbers: ${numbers.sort((a, b) => a - b).join(", ")}`,
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    await safeEdit(session);
    return true;
  }

  if (type === "ticket") {
    const numsRaw = interaction.fields?.getTextInputValue?.("nums");
    const numbers = parseNumbersInput(numsRaw).slice(0, 10);

    if (numbers.length < 1 || numbers.length > 10) {
      await economy.creditUser(session.guildId, interaction.user.id, amt, "keno_refund", { game: "keno", round: targetRound }).catch(() => {});
      await interaction.reply({ content: "❌ You must pick **1–10** valid numbers (1–80).", flags: MessageFlags.Ephemeral }).catch(() => {});
      return true;
    }

    targetMap.set(interaction.user.id, { kind: "KENO", numbers, amount: amt, round: targetRound });
    await interaction.reply({
      content:
        (isBetting
          ? `✅ Keno ticket placed for **$${amt.toLocaleString()}**.`
          : `✅ Keno ticket queued for **Round ${targetRound}** for **$${amt.toLocaleString()}**.`) +
        `\n🎟️ Numbers: ${numbers.sort((a, b) => a - b).join(", ")}`,
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    await safeEdit(session);
    return true;
  }

  // Unknown modal type -> refund to be safe
  await economy.creditUser(session.guildId, interaction.user.id, amt, "keno_refund", { game: "keno", round: targetRound }).catch(() => {});
  await interaction.reply({ content: "❌ Unknown bet type.", flags: MessageFlags.Ephemeral }).catch(() => {});
  return true;
}

module.exports = {
  startFromHub,
  handleInteraction,
};

module.exports.activityEffects = ACTIVITY_EFFECTS;
