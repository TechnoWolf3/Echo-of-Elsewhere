const crypto = require("crypto");
const { pool } = require("./db");
const appLinking = require("./appLinking");
const contracts = require("./contracts");

const MIN_BET = 500;
const MAX_BET = 250000;
const GAME_TTL_MS = 15 * 60 * 1000;

const SUITS = ["Clubs", "Diamonds", "Hearts", "Spades"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

function requirePool() {
  if (!pool || typeof pool.query !== "function") {
    throw new Error("DATABASE_URL is not configured.");
  }
  return pool;
}

function makeGameId() {
  return `bj_${crypto.randomBytes(10).toString("hex")}`;
}

function makeDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) deck.push({ rank, suit });
  }
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

function isBlackjack(cards) {
  return Array.isArray(cards) && cards.length === 2 && handValue(cards) === 21;
}

function allowedActionsFor(row) {
  if (!row || row.status !== "playing") return [];
  const value = handValue(row.player_cards_json || []);
  if (value >= 21) return ["stand"];
  return ["hit", "stand"];
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
  const cards = row.player_cards_json || [];
  return {
    cards,
    value: handValue(cards),
  };
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
    `SELECT jailed_until
     FROM jail
     WHERE guild_id=$1 AND user_id=$2 AND jailed_until > NOW()
     LIMIT 1`,
    [ctx.guildId, ctx.discordUserId]
  );
  if (jail.rows?.[0]) {
    return { ok: false, statusCode: 403, message: "You cannot play Blackjack while jailed." };
  }

  return { ok: true };
}

async function hydrateResponse(row, message, revealDealer = false) {
  const profile = await appLinking.buildProfileSnapshot(row.profile_id);
  return {
    gameId: row.id,
    status: row.status,
    result: row.status === "resolved" ? row.result : undefined,
    bet: Number(row.bet || 0),
    payout: row.status === "resolved" ? Number(row.payout || 0) : undefined,
    profit: row.status === "resolved" ? Number(row.profit || 0) : undefined,
    dealer: publicDealer(row, revealDealer || row.status !== "playing"),
    player: publicPlayer(row),
    allowedActions: allowedActionsFor(row),
    profile,
    message,
  };
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

    const active = await client.query(
      `SELECT id FROM casino_blackjack_games
       WHERE profile_id=$1 AND status='playing'
       LIMIT 1`,
      [ctx.profileId]
    );
    if (active.rows?.[0]) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 409, message: "You already have an active Blackjack round." };
    }

    await client.query(`INSERT INTO guilds (guild_id) VALUES ($1) ON CONFLICT (guild_id) DO NOTHING`, [ctx.guildId]);
    await client.query(
      `INSERT INTO user_balances (guild_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (guild_id, user_id) DO NOTHING`,
      [ctx.guildId, ctx.discordUserId]
    );

    const debit = await client.query(
      `UPDATE user_balances
       SET balance = balance - $3
       WHERE guild_id=$1 AND user_id=$2 AND balance >= $3
       RETURNING balance`,
      [ctx.guildId, ctx.discordUserId, bet]
    );
    if (debit.rowCount === 0) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 402, message: "Not enough wallet funds for that Blackjack bet." };
    }

    await client.query(
      `UPDATE guilds SET bank_balance = bank_balance + $2 WHERE guild_id=$1`,
      [ctx.guildId, bet]
    );

    const deck = makeDeck();
    const playerCards = [draw(deck), draw(deck)];
    const dealerCards = [draw(deck), draw(deck)];
    const gameId = makeGameId();
    const expiresAt = new Date(Date.now() + GAME_TTL_MS);

    const game = await client.query(
      `INSERT INTO casino_blackjack_games
       (id, profile_id, guild_id, user_id, status, bet, deck_json, player_cards_json, dealer_cards_json, expires_at)
       VALUES ($1, $2, $3, $4, 'playing', $5, $6::jsonb, $7::jsonb, $8::jsonb, $9)
       RETURNING *`,
      [
        gameId,
        ctx.profileId,
        ctx.guildId,
        ctx.discordUserId,
        bet,
        JSON.stringify(deck),
        JSON.stringify(playerCards),
        JSON.stringify(dealerCards),
        expiresAt,
      ]
    );

    await client.query(
      `INSERT INTO transactions (guild_id, user_id, amount, type, meta)
       VALUES ($1, $2, $3, 'blackjack_buyin', $4)`,
      [ctx.guildId, ctx.discordUserId, -bet, { gameId, source: "mobile_blackjack" }]
    );
    await client.query(
      `INSERT INTO transactions (guild_id, user_id, amount, type, meta)
       VALUES ($1, NULL, $2, 'blackjack_buyin_bank', $3)`,
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

  return {
    ok: true,
    statusCode: 200,
    body: await hydrateResponse(inserted, "Cards dealt. The dealer is watching."),
  };
}

async function loadActiveGame(client, ctx, gameId) {
  await expireOldGames(client);
  const res = await client.query(
    `SELECT *
     FROM casino_blackjack_games
     WHERE id=$1 AND profile_id=$2 AND status='playing'
     FOR UPDATE`,
    [String(gameId), ctx.profileId]
  );
  return res.rows?.[0] || null;
}

async function resolveGame(client, row, result, payout, message) {
  const bet = Number(row.bet || 0);
  let paid = 0;
  if (payout > 0) {
    const bank = await client.query(
      `SELECT bank_balance FROM guilds WHERE guild_id=$1 FOR UPDATE`,
      [row.guild_id]
    );
    const available = Number(bank.rows?.[0]?.bank_balance || 0);
    paid = Math.max(0, Math.min(Number(payout || 0), available));
    if (paid > 0) {
      await client.query(
        `UPDATE guilds SET bank_balance = bank_balance - $2 WHERE guild_id=$1`,
        [row.guild_id, paid]
      );
      await client.query(
        `UPDATE user_balances SET balance = balance + $3 WHERE guild_id=$1 AND user_id=$2`,
        [row.guild_id, row.user_id, paid]
      );
      await client.query(
        `INSERT INTO transactions (guild_id, user_id, amount, type, meta)
         VALUES ($1, $2, $3, 'blackjack_payout', $4)`,
        [row.guild_id, row.user_id, paid, { gameId: row.id, result, profit: paid - bet, source: "mobile_blackjack" }]
      );
      await client.query(
        `INSERT INTO transactions (guild_id, user_id, amount, type, meta)
         VALUES ($1, NULL, $2, 'blackjack_payout_bank', $3)`,
        [row.guild_id, -paid, { gameId: row.id, userId: row.user_id, result, source: "mobile_blackjack" }]
      );
    }
  }

  const profit = paid - bet;
  const updated = await client.query(
    `UPDATE casino_blackjack_games
     SET status='resolved',
         result=$2,
         payout=$3,
         profit=$4,
         updated_at=NOW(),
         resolved_at=NOW()
     WHERE id=$1
     RETURNING *`,
    [row.id, result, paid, profit]
  );

  return { row: updated.rows[0], message: paid < payout && payout > 0 ? `${message} Server bank could only cover $${paid.toLocaleString()}.` : message };
}

async function recordCasinoProgress(row) {
  try {
    await contracts.recordProgress({ guildId: row.guild_id, userId: row.user_id, metric: "casino_games_played", amount: 1 });
    if (Number(row.payout || 0) > Number(row.bet || 0)) {
      await contracts.recordProgress({ guildId: row.guild_id, userId: row.user_id, metric: "casino_wins", amount: 1 });
    }
    if (Number(row.profit || 0) > 0) {
      await contracts.recordProgress({ guildId: row.guild_id, userId: row.user_id, metric: "casino_profit", amount: Number(row.profit || 0) });
    }
  } catch {}
}

async function hit(ctx, gameId) {
  await ensureSchema();
  const db = requirePool();
  const client = await db.connect();
  let finalRow = null;
  let progressRow = null;
  let message = "Hit. The dealer says nothing.";
  let reveal = false;
  try {
    await client.query("BEGIN");
    const row = await loadActiveGame(client, ctx, gameId);
    if (!row) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 404, message: "Active Blackjack game not found." };
    }

    const deck = row.deck_json || [];
    const playerCards = row.player_cards_json || [];
    playerCards.push(draw(deck));

    let updated = await client.query(
      `UPDATE casino_blackjack_games
       SET deck_json=$2::jsonb, player_cards_json=$3::jsonb, updated_at=NOW()
       WHERE id=$1
       RETURNING *`,
      [row.id, JSON.stringify(deck), JSON.stringify(playerCards)]
    );
    finalRow = updated.rows[0];

    if (handValue(playerCards) > 21) {
      const resolved = await resolveGame(client, finalRow, "loss", 0, "Bust. The dealer swept the chips.");
      finalRow = resolved.row;
      progressRow = finalRow;
      message = resolved.message;
      reveal = true;
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  if (progressRow) await recordCasinoProgress(progressRow);

  return { ok: true, statusCode: 200, body: await hydrateResponse(finalRow, message, reveal) };
}

function settleResult(playerCards, dealerCards) {
  const playerValue = handValue(playerCards);
  const dealerValue = handValue(dealerCards);
  const playerBj = isBlackjack(playerCards);
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
  if (result === "push") return bet;
  if (result === "win") return bet * 2;
  if (result === "blackjack") return Math.floor(bet * 2.5);
  return 0;
}

function resultMessage(result, payout) {
  if (result === "blackjack") return `Blackjack paid $${Number(payout || 0).toLocaleString()}. The dealer became very still.`;
  if (result === "win") return `Blackjack paid $${Number(payout || 0).toLocaleString()}. The table exhales.`;
  if (result === "push") return "Push. Your stake comes back with no apology.";
  return "Loss. The dealer swept the chips.";
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

    const deck = row.deck_json || [];
    const dealerCards = row.dealer_cards_json || [];
    while (handValue(dealerCards) < 17) {
      dealerCards.push(draw(deck));
    }

    const result = settleResult(row.player_cards_json || [], dealerCards);
    const payout = payoutFor(result, Number(row.bet || 0));

    const updatedCards = await client.query(
      `UPDATE casino_blackjack_games
       SET deck_json=$2::jsonb, dealer_cards_json=$3::jsonb, updated_at=NOW()
       WHERE id=$1
       RETURNING *`,
      [row.id, JSON.stringify(deck), JSON.stringify(dealerCards)]
    );

    const resolved = await resolveGame(client, updatedCards.rows[0], result, payout, resultMessage(result, payout));
    finalRow = resolved.row;
    progressRow = finalRow;
    message = resolved.message;
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  if (progressRow) await recordCasinoProgress(progressRow);

  return { ok: true, statusCode: 200, body: await hydrateResponse(finalRow, message, true) };
}

module.exports = {
  ensureSchema,
  startGame,
  hit,
  stand,
};
