const crypto = require("crypto");
const { pool } = require("./db");
const appLinking = require("./appLinking");
const contracts = require("./contracts");
const gameConfig = require("./gameConfig");

const { minBet: MIN_BET, maxBet: MAX_BET } = gameConfig.getCasinoBetLimits("blackjack");
const GAME_TTL_MS = gameConfig.CONFIG.casino.blackjack.ttlSeconds * 1000;

const SUITS = ["Clubs", "Diamonds", "Hearts", "Spades"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

function requirePool() {
  if (!pool || typeof pool.query !== "function") throw new Error("DATABASE_URL is not configured.");
  return pool;
}

function makeGameId() {
  return `bj_${crypto.randomBytes(10).toString("hex")}`;
}

function makeHandId(index) {
  return `hand_${index + 1}`;
}

function makeDeck() {
  const deck = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ rank, suit });
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function draw(deck) {
  const card = deck.pop();
  if (!card) throw new Error("Blackjack deck is empty.");
  return card;
}

function handValue(cards) {
  let total = 0;
  let aces = 0;
  for (const card of cards || []) {
    if (card.rank === "A") {
      aces += 1;
      total += 11;
    } else if (["J", "Q", "K"].includes(card.rank)) {
      total += 10;
    } else {
      total += Number(card.rank);
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

function isBlackjack(cards, hand = null) {
  if (hand?.fromSplit) return false;
  return Array.isArray(cards) && cards.length === 2 && handValue(cards) === 21;
}

function canSplitCards(cards) {
  if (!Array.isArray(cards) || cards.length !== 2) return false;
  const [a, b] = cards;
  if (!a?.rank || !b?.rank) return false;
  const face = new Set(["J", "Q", "K"]);
  if (face.has(a.rank) && face.has(b.rank)) return true;
  return a.rank === b.rank;
}

function normalizeHands(row) {
  if (Array.isArray(row.hands_json) && row.hands_json.length) return row.hands_json;
  return [{
    id: "hand_1",
    cards: row.player_cards_json || [],
    bet: Number(row.bet || 0),
    status: "playing",
    doubled: false,
    result: null,
    payout: 0,
    fromSplit: false,
  }];
}

function activeHandIndex(row, hands = normalizeHands(row)) {
  if (row.status !== "playing") return null;
  const idx = Number(row.active_hand_index ?? 0);
  if (hands[idx]?.status === "playing") return idx;
  const next = hands.findIndex((hand) => hand.status === "playing");
  return next >= 0 ? next : null;
}

function publicHands(row) {
  return normalizeHands(row).map((hand) => ({
    id: hand.id,
    cards: hand.cards || [],
    value: handValue(hand.cards || []),
    bet: Number(hand.bet || 0),
    status: hand.status,
    doubled: Boolean(hand.doubled),
    result: hand.result || null,
    payout: Number(hand.payout || 0),
  }));
}

function allowedActionsFor(row) {
  if (!row || row.status !== "playing") return [];
  const hands = normalizeHands(row);
  const idx = activeHandIndex(row, hands);
  const hand = idx == null ? null : hands[idx];
  if (!hand || hand.status !== "playing") return [];

  const value = handValue(hand.cards || []);
  if (value >= 21) return ["stand"];

  const actions = ["hit", "stand"];
  if ((hand.cards || []).length === 2 && !hand.doubled) actions.push("double");
  if (hands.length === 1 && (hand.cards || []).length === 2 && !hand.doubled && canSplitCards(hand.cards)) actions.push("split");
  return actions;
}

function publicDealer(row, reveal = false) {
  const cards = row.dealer_cards_json || [];
  return {
    visibleCards: reveal ? cards : cards.slice(0, 1),
    hiddenCount: reveal ? 0 : Math.max(0, cards.length - 1),
    value: reveal ? handValue(cards) : null,
  };
}

function publicPlayer(row) {
  const hands = publicHands(row);
  const idx = activeHandIndex(row, normalizeHands(row));
  const hand = hands[idx ?? 0] || hands[0] || { cards: [], value: 0 };
  return { cards: hand.cards, value: hand.value };
}

async function ensureSchema() {
  await appLinking.ensureSchema();
  const db = requirePool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS casino_blackjack_games (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'playing',
      bet BIGINT NOT NULL,
      deck_json JSONB NOT NULL,
      player_cards_json JSONB NOT NULL,
      dealer_cards_json JSONB NOT NULL,
      result TEXT NULL,
      payout BIGINT NOT NULL DEFAULT 0,
      profit BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at TIMESTAMPTZ NULL,
      expires_at TIMESTAMPTZ NOT NULL
    );

    ALTER TABLE casino_blackjack_games ADD COLUMN IF NOT EXISTS hands_json JSONB NULL;
    ALTER TABLE casino_blackjack_games ADD COLUMN IF NOT EXISTS active_hand_index INT NULL DEFAULT 0;

    CREATE INDEX IF NOT EXISTS idx_cbj_profile_status
    ON casino_blackjack_games (profile_id, status);

    CREATE INDEX IF NOT EXISTS idx_cbj_expires
    ON casino_blackjack_games (expires_at);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_cbj_one_active_per_profile
    ON casino_blackjack_games (profile_id)
    WHERE status = 'playing';
  `);
}

function parseBet(rawBet) {
  const bet = Math.floor(Number(rawBet));
  if (!Number.isFinite(bet)) return null;
  return bet;
}

async function expireOldGames(client) {
  await client.query(
    `UPDATE casino_blackjack_games
     SET status='expired', updated_at=NOW(), resolved_at=NOW()
     WHERE status='playing' AND expires_at <= NOW()`
  );
}

async function assertPlayableContext(client, ctx) {
  if (!ctx?.profileId || !ctx.guildId || !ctx.discordUserId) {
    return { ok: false, statusCode: 401, message: "Linked Discord profile is required." };
  }
  const jail = await client.query(
    `SELECT jailed_until FROM jail WHERE guild_id=$1 AND user_id=$2 AND jailed_until > NOW() LIMIT 1`,
    [ctx.guildId, ctx.discordUserId]
  );
  if (jail.rows?.[0]) return { ok: false, statusCode: 403, message: "You cannot play Blackjack while jailed." };
  return { ok: true };
}

async function hydrateResponse(row, message, revealDealer = false) {
  const profile = await appLinking.buildProfileSnapshot(row.profile_id);
  const hands = publicHands(row);
  const activeIndex = activeHandIndex(row, normalizeHands(row));
  return {
    configVersion: gameConfig.CONFIG_VERSION,
    gameId: row.id,
    status: row.status,
    result: row.status === "resolved" ? row.result : undefined,
    bet: Number(row.bet || 0),
    dealer: publicDealer(row, revealDealer || row.status !== "playing"),
    hands,
    activeHandIndex: activeIndex,
    player: publicPlayer(row),
    allowedActions: allowedActionsFor(row),
    totalPayout: row.status === "resolved" ? Number(row.payout || 0) : undefined,
    payout: row.status === "resolved" ? Number(row.payout || 0) : undefined,
    profit: row.status === "resolved" ? Number(row.profit || 0) : undefined,
    profile,
    message,
  };
}

async function debitExtraStake(client, row, amount, type, meta) {
  const debit = await client.query(
    `UPDATE user_balances
     SET balance = balance - $3
     WHERE guild_id=$1 AND user_id=$2 AND balance >= $3
     RETURNING balance`,
    [row.guild_id, row.user_id, amount]
  );
  if (debit.rowCount === 0) return false;

  await client.query(`UPDATE guilds SET bank_balance = bank_balance + $2 WHERE guild_id=$1`, [row.guild_id, amount]);
  await client.query(
    `INSERT INTO transactions (guild_id, user_id, amount, type, meta)
     VALUES ($1, $2, $3, $4, $5)`,
    [row.guild_id, row.user_id, -amount, type, meta]
  );
  await client.query(
    `INSERT INTO transactions (guild_id, user_id, amount, type, meta)
     VALUES ($1, NULL, $2, $3, $4)`,
    [row.guild_id, amount, `${type}_bank`, meta]
  );
  return true;
}

async function startGame(ctx, betInput) {
  await ensureSchema();
  const db = requirePool();
  const bet = parseBet(betInput);
  if (!bet || bet < MIN_BET || bet > MAX_BET) {
    return { ok: false, statusCode: 400, message: `Bet must be between ${MIN_BET} and ${MAX_BET}.` };
  }

  const client = await db.connect();
  let inserted = null;
  try {
    await client.query("BEGIN");
    await expireOldGames(client);
    const playable = await assertPlayableContext(client, ctx);
    if (!playable.ok) {
      await client.query("ROLLBACK");
      return playable;
    }

    const active = await client.query(`SELECT id FROM casino_blackjack_games WHERE profile_id=$1 AND status='playing' LIMIT 1`, [ctx.profileId]);
    if (active.rows?.[0]) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 409, message: "You already have an active Blackjack round." };
    }

    await client.query(`INSERT INTO guilds (guild_id) VALUES ($1) ON CONFLICT (guild_id) DO NOTHING`, [ctx.guildId]);
    await client.query(
      `INSERT INTO user_balances (guild_id, user_id) VALUES ($1, $2) ON CONFLICT (guild_id, user_id) DO NOTHING`,
      [ctx.guildId, ctx.discordUserId]
    );

    const debit = await client.query(
      `UPDATE user_balances SET balance = balance - $3 WHERE guild_id=$1 AND user_id=$2 AND balance >= $3 RETURNING balance`,
      [ctx.guildId, ctx.discordUserId, bet]
    );
    if (debit.rowCount === 0) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 402, message: "Not enough wallet funds for that Blackjack bet." };
    }

    await client.query(`UPDATE guilds SET bank_balance = bank_balance + $2 WHERE guild_id=$1`, [ctx.guildId, bet]);

    const deck = makeDeck();
    const playerCards = [draw(deck), draw(deck)];
    const dealerCards = [draw(deck), draw(deck)];
    const hands = [{ id: "hand_1", cards: playerCards, bet, status: "playing", doubled: false, result: null, payout: 0, fromSplit: false }];
    const gameId = makeGameId();
    const expiresAt = new Date(Date.now() + GAME_TTL_MS);

    const game = await client.query(
      `INSERT INTO casino_blackjack_games
       (id, profile_id, guild_id, user_id, status, bet, deck_json, player_cards_json, dealer_cards_json, hands_json, active_hand_index, expires_at)
       VALUES ($1, $2, $3, $4, 'playing', $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, 0, $10)
       RETURNING *`,
      [gameId, ctx.profileId, ctx.guildId, ctx.discordUserId, bet, JSON.stringify(deck), JSON.stringify(playerCards), JSON.stringify(dealerCards), JSON.stringify(hands), expiresAt]
    );

    await client.query(
      `INSERT INTO transactions (guild_id, user_id, amount, type, meta) VALUES ($1, $2, $3, 'blackjack_buyin', $4)`,
      [ctx.guildId, ctx.discordUserId, -bet, { gameId, source: "mobile_blackjack" }]
    );
    await client.query(
      `INSERT INTO transactions (guild_id, user_id, amount, type, meta) VALUES ($1, NULL, $2, 'blackjack_buyin_bank', $3)`,
      [ctx.guildId, bet, { gameId, userId: ctx.discordUserId, source: "mobile_blackjack" }]
    );

    inserted = game.rows[0];
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  return { ok: true, statusCode: 200, body: await hydrateResponse(inserted, "Cards dealt. The dealer is watching.") };
}

async function loadActiveGame(client, ctx, gameId) {
  await expireOldGames(client);
  const res = await client.query(
    `SELECT * FROM casino_blackjack_games WHERE id=$1 AND profile_id=$2 AND status='playing' FOR UPDATE`,
    [String(gameId), ctx.profileId]
  );
  return res.rows?.[0] || null;
}

function nextPlayingIndex(hands, fromIndex = 0) {
  for (let i = fromIndex; i < hands.length; i += 1) {
    if (hands[i]?.status === "playing") return i;
  }
  return null;
}

function settleHandResult(hand, dealerCards) {
  const playerValue = handValue(hand.cards);
  const dealerValue = handValue(dealerCards);
  const playerBj = isBlackjack(hand.cards, hand);
  const dealerBj = isBlackjack(dealerCards);
  if (playerValue > 21) return "loss";
  if (playerBj && dealerBj) return "push";
  if (playerBj) return "blackjack";
  if (dealerBj) return "loss";
  if (dealerValue > 21) return "win";
  if (playerValue > dealerValue) return "win";
  if (playerValue < dealerValue) return "loss";
  return "push";
}

function payoutFor(result, bet) {
  return gameConfig.blackjackPayout(result, bet);
}

async function resolveAllHands(client, row, hands, deck, dealerCards, fallbackMessage = "") {
  while (handValue(dealerCards) < 17) dealerCards.push(draw(deck));

  let payoutWanted = 0;
  let totalStake = 0;
  const resolvedHands = hands.map((hand) => {
    const result = settleHandResult(hand, dealerCards);
    const payout = payoutFor(result, Number(hand.bet || 0));
    payoutWanted += payout;
    totalStake += Number(hand.bet || 0);
    return { ...hand, status: "resolved", result, payout };
  });

  let paid = 0;
  if (payoutWanted > 0) {
    const bank = await client.query(`SELECT bank_balance FROM guilds WHERE guild_id=$1 FOR UPDATE`, [row.guild_id]);
    const available = Number(bank.rows?.[0]?.bank_balance || 0);
    paid = Math.max(0, Math.min(payoutWanted, available));
    if (paid > 0) {
      await client.query(`UPDATE guilds SET bank_balance = bank_balance - $2 WHERE guild_id=$1`, [row.guild_id, paid]);
      await client.query(`UPDATE user_balances SET balance = balance + $3 WHERE guild_id=$1 AND user_id=$2`, [row.guild_id, row.user_id, paid]);
      await client.query(
        `INSERT INTO transactions (guild_id, user_id, amount, type, meta) VALUES ($1, $2, $3, 'blackjack_payout', $4)`,
        [row.guild_id, row.user_id, paid, { gameId: row.id, payoutWanted, profit: paid - totalStake, source: "mobile_blackjack" }]
      );
      await client.query(
        `INSERT INTO transactions (guild_id, user_id, amount, type, meta) VALUES ($1, NULL, $2, 'blackjack_payout_bank', $3)`,
        [row.guild_id, -paid, { gameId: row.id, userId: row.user_id, payoutWanted, source: "mobile_blackjack" }]
      );
    }
  }

  const profit = paid - totalStake;
  const result = resolvedHands.some((h) => h.result === "blackjack") ? "blackjack"
    : resolvedHands.some((h) => h.result === "win") ? "win"
    : resolvedHands.every((h) => h.result === "push") ? "push"
    : "loss";

  const updated = await client.query(
    `UPDATE casino_blackjack_games
     SET status='resolved',
         result=$2,
         payout=$3,
         profit=$4,
         deck_json=$5::jsonb,
         dealer_cards_json=$6::jsonb,
         hands_json=$7::jsonb,
         player_cards_json=$8::jsonb,
         active_hand_index=NULL,
         updated_at=NOW(),
         resolved_at=NOW()
     WHERE id=$1
     RETURNING *`,
    [row.id, result, paid, profit, JSON.stringify(deck), JSON.stringify(dealerCards), JSON.stringify(resolvedHands), JSON.stringify(resolvedHands[0]?.cards || [])]
  );

  const dealerBust = handValue(dealerCards) > 21;
  let message = fallbackMessage || (dealerBust ? "Dealer bust. The table pays what survived." : "The dealer settles the table.");
  if (resolvedHands.length > 1 && dealerBust && resolvedHands.filter((h) => h.result === "win").length === resolvedHands.length) {
    message = "Dealer bust. Both hands paid.";
  }
  if (paid < payoutWanted && payoutWanted > 0) message += ` Server bank could only cover $${paid.toLocaleString()}.`;
  return { row: updated.rows[0], message };
}

async function recordCasinoProgress(row) {
  try {
    await contracts.recordProgress({ guildId: row.guild_id, userId: row.user_id, metric: "casino_games_played", amount: 1 });
    if (Number(row.profit || 0) > 0) await contracts.recordProgress({ guildId: row.guild_id, userId: row.user_id, metric: "casino_wins", amount: 1 });
    if (Number(row.profit || 0) > 0) await contracts.recordProgress({ guildId: row.guild_id, userId: row.user_id, metric: "casino_profit", amount: Number(row.profit || 0) });
  } catch {}
}

async function updatePlayingRow(client, row, hands, deck, activeIdx, message) {
  const updated = await client.query(
    `UPDATE casino_blackjack_games
     SET hands_json=$2::jsonb,
         deck_json=$3::jsonb,
         player_cards_json=$4::jsonb,
         active_hand_index=$5,
         updated_at=NOW()
     WHERE id=$1
     RETURNING *`,
    [row.id, JSON.stringify(hands), JSON.stringify(deck), JSON.stringify(hands[activeIdx ?? 0]?.cards || hands[0]?.cards || []), activeIdx]
  );
  return { row: updated.rows[0], message };
}

async function completeOrContinue(client, row, hands, deck, dealerCards, nextIndex, message) {
  const idx = nextPlayingIndex(hands, nextIndex ?? 0);
  if (idx == null) return resolveAllHands(client, row, hands, deck, dealerCards, message);
  return updatePlayingRow(client, row, hands, deck, idx, message);
}

async function hit(ctx, gameId) {
  await ensureSchema();
  const db = requirePool();
  const client = await db.connect();
  let finalRow = null;
  let progressRow = null;
  let message = "Hit. The dealer says nothing.";
  try {
    await client.query("BEGIN");
    const row = await loadActiveGame(client, ctx, gameId);
    if (!row) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 404, message: "Active Blackjack game not found." };
    }
    const deck = row.deck_json || [];
    const dealerCards = row.dealer_cards_json || [];
    const hands = normalizeHands(row);
    const idx = activeHandIndex(row, hands);
    if (idx == null) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 409, message: "No playable Blackjack hand found." };
    }
    if (handValue(hands[idx].cards || []) >= 21) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 409, message: "This Blackjack hand should stand." };
    }

    hands[idx].cards.push(draw(deck));
    const value = handValue(hands[idx].cards);
    if (value > 21) hands[idx].status = "busted";
    else if (value === 21) hands[idx].status = "stood";

    const next = hands[idx].status === "playing" ? idx : idx + 1;
    const result = hands[idx].status === "playing"
      ? await updatePlayingRow(client, row, hands, deck, idx, message)
      : await completeOrContinue(client, row, hands, deck, dealerCards, next, value > 21 ? "Bust. Moving along." : "Twenty-one. The hand stands.");
    finalRow = result.row;
    message = result.message;
    if (finalRow.status === "resolved") progressRow = finalRow;
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  if (progressRow) await recordCasinoProgress(progressRow);
  return { ok: true, statusCode: 200, body: await hydrateResponse(finalRow, message, finalRow.status !== "playing") };
}

async function stand(ctx, gameId) {
  await ensureSchema();
  const db = requirePool();
  const client = await db.connect();
  let finalRow = null;
  let progressRow = null;
  let message = "";
  try {
    await client.query("BEGIN");
    const row = await loadActiveGame(client, ctx, gameId);
    if (!row) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 404, message: "Active Blackjack game not found." };
    }
    const hands = normalizeHands(row);
    const idx = activeHandIndex(row, hands);
    if (idx == null) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 409, message: "No playable Blackjack hand found." };
    }
    hands[idx].status = "stood";
    const result = await completeOrContinue(client, row, hands, row.deck_json || [], row.dealer_cards_json || [], idx + 1, "Stood. The table waits.");
    finalRow = result.row;
    message = result.message;
    if (finalRow.status === "resolved") progressRow = finalRow;
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  if (progressRow) await recordCasinoProgress(progressRow);
  return { ok: true, statusCode: 200, body: await hydrateResponse(finalRow, message, finalRow.status !== "playing") };
}

async function doubleDown(ctx, gameId) {
  await ensureSchema();
  const db = requirePool();
  const client = await db.connect();
  let finalRow = null;
  let progressRow = null;
  let message = "";
  try {
    await client.query("BEGIN");
    const row = await loadActiveGame(client, ctx, gameId);
    if (!row) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 404, message: "Active Blackjack game not found." };
    }
    const hands = normalizeHands(row);
    const idx = activeHandIndex(row, hands);
    const hand = idx == null ? null : hands[idx];
    if (!hand || hand.status !== "playing" || hand.doubled || (hand.cards || []).length !== 2 || handValue(hand.cards || []) >= 21) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 409, message: "Double Down is not allowed for this hand." };
    }
    const extraStake = Number(hand.bet || 0);
    const ok = await debitExtraStake(client, row, extraStake, "blackjack_double_down", { gameId: row.id, handId: hand.id, source: "mobile_blackjack" });
    if (!ok) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 402, message: "Not enough wallet funds to double down." };
    }
    const deck = row.deck_json || [];
    hand.bet = extraStake * 2;
    hand.doubled = true;
    hand.cards.push(draw(deck));
    hand.status = handValue(hand.cards) > 21 ? "busted" : "stood";
    const result = await completeOrContinue(client, row, hands, deck, row.dealer_cards_json || [], idx + 1, hand.status === "busted" ? "Double down busted." : "Double down locked. One card, no regrets.");
    finalRow = result.row;
    message = result.message;
    if (finalRow.status === "resolved") progressRow = finalRow;
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  if (progressRow) await recordCasinoProgress(progressRow);
  return { ok: true, statusCode: 200, body: await hydrateResponse(finalRow, message, finalRow.status !== "playing") };
}

async function split(ctx, gameId) {
  await ensureSchema();
  const db = requirePool();
  const client = await db.connect();
  let finalRow = null;
  try {
    await client.query("BEGIN");
    const row = await loadActiveGame(client, ctx, gameId);
    if (!row) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 404, message: "Active Blackjack game not found." };
    }
    const hands = normalizeHands(row);
    const hand = hands[activeHandIndex(row, hands) ?? 0];
    if (hands.length !== 1 || !hand || hand.status !== "playing" || hand.doubled || (hand.cards || []).length !== 2 || !canSplitCards(hand.cards)) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 409, message: "Split is not allowed for this hand." };
    }
    const extraStake = Number(hand.bet || 0);
    const ok = await debitExtraStake(client, row, extraStake, "blackjack_split", {
      gameId: row.id,
      originalHandId: hand.id,
      newHandIds: ["hand_1", "hand_2"],
      source: "mobile_blackjack",
    });
    if (!ok) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 402, message: "Not enough wallet funds to split." };
    }
    const deck = row.deck_json || [];
    const [cardA, cardB] = hand.cards;
    const splitHands = [
      { id: makeHandId(0), cards: [cardA, draw(deck)], bet: extraStake, status: "playing", doubled: false, result: null, payout: 0, fromSplit: true },
      { id: makeHandId(1), cards: [cardB, draw(deck)], bet: extraStake, status: "playing", doubled: false, result: null, payout: 0, fromSplit: true },
    ];
    const result = await updatePlayingRow(client, row, splitHands, deck, 0, "Split accepted. Two hands, twice the paperwork.");
    finalRow = result.row;
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return { ok: true, statusCode: 200, body: await hydrateResponse(finalRow, "Split accepted. Two hands, twice the paperwork.") };
}

module.exports = {
  ensureSchema,
  startGame,
  hit,
  stand,
  doubleDown,
  split,
};
