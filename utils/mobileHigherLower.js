const crypto = require("crypto");
const { pool } = require("./db");
const appLinking = require("./appLinking");
const contracts = require("./contracts");
const gameConfig = require("./gameConfig");

const { minBet: MIN_BET, maxBet: MAX_BET } = gameConfig.getCasinoBetLimits("higherLower");
const GAME_TTL_MS = gameConfig.CONFIG.casino.higherLower.ttlSeconds * 1000;

const SUITS = ["Clubs", "Diamonds", "Hearts", "Spades"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

function requirePool() {
  if (!pool || typeof pool.query !== "function") {
    throw new Error("DATABASE_URL is not configured.");
  }
  return pool;
}

function makeGameId() {
  return `hl_${crypto.randomBytes(10).toString("hex")}`;
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
  if (!card) throw new Error("Higher or Lower deck is empty.");
  return card;
}

function rankValue(card) {
  if (!card) return 0;
  if (card.rank === "A") return 14;
  if (card.rank === "K") return 13;
  if (card.rank === "Q") return 12;
  if (card.rank === "J") return 11;
  return Number(card.rank);
}

function cashoutValue(bet, streak) {
  return gameConfig.higherLowerCashoutValue(bet, streak);
}

function allowedActionsFor(row) {
  return row?.status === "playing" ? ["higher", "lower", "same", "cashout"] : [];
}

async function ensureSchema() {
  await appLinking.ensureSchema();
  const db = requirePool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS casino_higher_lower_games (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'playing',
      result TEXT NULL,
      bet BIGINT NOT NULL,
      deck_json JSONB NOT NULL,
      current_card_json JSONB NOT NULL,
      previous_card_json JSONB NULL,
      last_pick TEXT NULL,
      streak BIGINT NOT NULL DEFAULT 0,
      payout BIGINT NOT NULL DEFAULT 0,
      profit BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at TIMESTAMPTZ NULL,
      expires_at TIMESTAMPTZ NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_chl_profile_status
    ON casino_higher_lower_games (profile_id, status);

    CREATE INDEX IF NOT EXISTS idx_chl_expires
    ON casino_higher_lower_games (expires_at);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_chl_one_active_per_profile
    ON casino_higher_lower_games (profile_id)
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
    `UPDATE casino_higher_lower_games
     SET status='expired',
         result='bust',
         payout=0,
         profit=-bet,
         updated_at=NOW(),
         resolved_at=NOW()
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
    return { ok: false, statusCode: 403, message: "You cannot play Higher or Lower while jailed." };
  }

  return { ok: true };
}

async function hydrateResponse(row, message) {
  const profile = await appLinking.buildProfileSnapshot(row.profile_id);
  const bet = Number(row.bet || 0);
  const streak = Number(row.streak || 0);
  const status = row.status;
  const payout = Number(row.payout || 0);
  const profit = Number(row.profit || 0);
  return {
    configVersion: gameConfig.CONFIG_VERSION,
    gameId: row.id,
    status,
    result: status === "playing" ? null : row.result,
    bet,
    previousCard: row.previous_card_json || null,
    currentCard: row.current_card_json,
    lastPick: row.last_pick || null,
    streak,
    cashoutValue: status === "playing" ? cashoutValue(bet, streak) : payout,
    payout: status === "playing" ? 0 : payout,
    profit: status === "playing" ? 0 : profit,
    allowedActions: allowedActionsFor(row),
    profile,
    message,
  };
}

async function recordCasinoProgress(row) {
  try {
    await contracts.recordProgress({ guildId: row.guild_id, userId: row.user_id, metric: "casino_games_played", amount: 1 });
    if (row.result === "cashout" && Number(row.payout || 0) > Number(row.bet || 0)) {
      await contracts.recordProgress({ guildId: row.guild_id, userId: row.user_id, metric: "casino_wins", amount: 1 });
    }
    if (Number(row.profit || 0) > 0) {
      await contracts.recordProgress({ guildId: row.guild_id, userId: row.user_id, metric: "casino_profit", amount: Number(row.profit || 0) });
    }
  } catch {}
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
      `SELECT id FROM casino_higher_lower_games
       WHERE profile_id=$1 AND status='playing'
       LIMIT 1`,
      [ctx.profileId]
    );
    if (active.rows?.[0]) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 409, message: "You already have an active Higher or Lower round." };
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
      return { ok: false, statusCode: 402, message: "Not enough wallet funds for that Higher or Lower bet." };
    }

    await client.query(`UPDATE guilds SET bank_balance = bank_balance + $2 WHERE guild_id=$1`, [ctx.guildId, bet]);

    const deck = makeDeck();
    const currentCard = draw(deck);
    const gameId = makeGameId();
    const expiresAt = new Date(Date.now() + GAME_TTL_MS);

    const game = await client.query(
      `INSERT INTO casino_higher_lower_games
       (id, profile_id, guild_id, user_id, status, result, bet, deck_json, current_card_json, previous_card_json, streak, expires_at)
       VALUES ($1, $2, $3, $4, 'playing', NULL, $5, $6::jsonb, $7::jsonb, NULL, 0, $8)
       RETURNING *`,
      [gameId, ctx.profileId, ctx.guildId, ctx.discordUserId, bet, JSON.stringify(deck), JSON.stringify(currentCard), expiresAt]
    );

    await client.query(
      `INSERT INTO transactions (guild_id, user_id, amount, type, meta)
       VALUES ($1, $2, $3, 'higherlower_bet', $4)`,
      [ctx.guildId, ctx.discordUserId, -bet, { gameId, source: "mobile_higher_lower" }]
    );
    await client.query(
      `INSERT INTO transactions (guild_id, user_id, amount, type, meta)
       VALUES ($1, NULL, $2, 'higherlower_bet_bank', $3)`,
      [ctx.guildId, bet, { gameId, userId: ctx.discordUserId, source: "mobile_higher_lower" }]
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
    body: await hydrateResponse(inserted, "Buy-in accepted. Trust the card. Doubt yourself."),
  };
}

async function loadActiveGame(client, ctx, gameId) {
  await expireOldGames(client);
  const res = await client.query(
    `SELECT *
     FROM casino_higher_lower_games
     WHERE id=$1 AND profile_id=$2 AND status='playing'
     FOR UPDATE`,
    [String(gameId), ctx.profileId]
  );
  return res.rows?.[0] || null;
}

async function guess(ctx, gameId, pickInput) {
  await ensureSchema();
  const pick = String(pickInput || "").trim().toLowerCase();
  if (!["higher", "lower", "same"].includes(pick)) {
    return { ok: false, statusCode: 400, message: "Pick must be higher, lower, or same." };
  }

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
      return { ok: false, statusCode: 404, message: "Active Higher or Lower game not found." };
    }

    const deck = row.deck_json || [];
    const previousCard = row.current_card_json;
    const currentCard = draw(deck);
    const previousValue = rankValue(previousCard);
    const currentValue = rankValue(currentCard);
    const correct =
      (pick === "higher" && currentValue > previousValue) ||
      (pick === "lower" && currentValue < previousValue) ||
      (pick === "same" && currentValue === previousValue);

    if (correct) {
      const nextStreak = Number(row.streak || 0) + 1;
      const updated = await client.query(
        `UPDATE casino_higher_lower_games
         SET deck_json=$2::jsonb,
             previous_card_json=$3::jsonb,
             current_card_json=$4::jsonb,
             last_pick=$5,
             streak=$6,
             updated_at=NOW()
         WHERE id=$1
         RETURNING *`,
        [row.id, JSON.stringify(deck), JSON.stringify(previousCard), JSON.stringify(currentCard), pick, nextStreak]
      );
      finalRow = updated.rows[0];
      if (pick === "higher") message = `Correct. The card climbed. Streak ${nextStreak}.`;
      else if (pick === "lower") message = `Correct. The card fell. Streak ${nextStreak}.`;
      else message = `Dead match. Echo blinked first. Streak ${nextStreak}.`;
    } else {
      const profit = -Number(row.bet || 0);
      const updated = await client.query(
        `UPDATE casino_higher_lower_games
         SET status='resolved',
             result='bust',
             deck_json=$2::jsonb,
             previous_card_json=$3::jsonb,
             current_card_json=$4::jsonb,
             last_pick=$5,
             payout=0,
             profit=$6,
             updated_at=NOW(),
             resolved_at=NOW()
         WHERE id=$1
         RETURNING *`,
        [row.id, JSON.stringify(deck), JSON.stringify(previousCard), JSON.stringify(currentCard), pick, profit]
      );
      finalRow = updated.rows[0];
      progressRow = finalRow;
      await client.query(
        `INSERT INTO transactions (guild_id, user_id, amount, type, meta)
         VALUES ($1, $2, 0, 'higherlower_loss', $3)`,
        [row.guild_id, row.user_id, {
          gameId: row.id,
          streak: Number(row.streak || 0),
          lastPick: pick,
          previousCard,
          currentCard,
          source: "mobile_higher_lower",
        }]
      );
      message = "Wrong call. The streak died and the house kept the stake.";
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  if (progressRow) await recordCasinoProgress(progressRow);
  return { ok: true, statusCode: 200, body: await hydrateResponse(finalRow, message) };
}

async function cashout(ctx, gameId) {
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
      return { ok: false, statusCode: 404, message: "Active Higher or Lower game not found." };
    }

    const bet = Number(row.bet || 0);
    const streak = Number(row.streak || 0);
    const multiplier = gameConfig.higherLowerMultiplier(streak);
    const payoutWanted = Math.floor(bet * multiplier);

    const bank = await client.query(`SELECT bank_balance FROM guilds WHERE guild_id=$1 FOR UPDATE`, [row.guild_id]);
    const available = Number(bank.rows?.[0]?.bank_balance || 0);
    const payout = Math.max(0, Math.min(payoutWanted, available));

    if (payout > 0) {
      await client.query(`UPDATE guilds SET bank_balance = bank_balance - $2 WHERE guild_id=$1`, [row.guild_id, payout]);
      await client.query(
        `UPDATE user_balances SET balance = balance + $3 WHERE guild_id=$1 AND user_id=$2`,
        [row.guild_id, row.user_id, payout]
      );
      await client.query(
        `INSERT INTO transactions (guild_id, user_id, amount, type, meta)
         VALUES ($1, $2, $3, 'higherlower_payout', $4)`,
        [row.guild_id, row.user_id, payout, {
          gameId: row.id,
          streak,
          multiplier,
          profit: payout - bet,
          source: "mobile_higher_lower",
        }]
      );
      await client.query(
        `INSERT INTO transactions (guild_id, user_id, amount, type, meta)
         VALUES ($1, NULL, $2, 'higherlower_payout_bank', $3)`,
        [row.guild_id, -payout, {
          gameId: row.id,
          userId: row.user_id,
          streak,
          multiplier,
          source: "mobile_higher_lower",
        }]
      );
    }

    const profit = payout - bet;
    const updated = await client.query(
      `UPDATE casino_higher_lower_games
       SET status='resolved',
           result='cashout',
           payout=$2,
           profit=$3,
           updated_at=NOW(),
           resolved_at=NOW()
       WHERE id=$1
       RETURNING *`,
      [row.id, payout, profit]
    );

    finalRow = updated.rows[0];
    progressRow = finalRow;
    message = `Cashed out at streak ${streak} for $${payout.toLocaleString()}. Suspiciously mature.`;
    if (payout < payoutWanted) {
      message += ` Server bank could only cover $${payout.toLocaleString()}.`;
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  if (progressRow) await recordCasinoProgress(progressRow);
  return { ok: true, statusCode: 200, body: await hydrateResponse(finalRow, message) };
}

module.exports = {
  ensureSchema,
  startGame,
  guess,
  cashout,
};
