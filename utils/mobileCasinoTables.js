const crypto = require("crypto");
const { pool } = require("./db");
const appLinking = require("./appLinking");
const contracts = require("./contracts");
const casinoSecurity = require("./casinoSecurity");
const gameConfig = require("./gameConfig");

const { minBet: MIN_BET, maxBet: MAX_BET } = gameConfig.getCasinoBetLimits("higherLower");
const MAX_PLAYERS = gameConfig.CONFIG.casino.higherLower.maxPlayers;
const TABLE_TTL_MS = gameConfig.CONFIG.casino.higherLower.tableTtlSeconds * 1000;
const TURN_MS = gameConfig.CONFIG.casino.blackjack.turnTimeoutSeconds * 1000;
const SUITS = ["Clubs", "Diamonds", "Hearts", "Spades"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const ROULETTE_WHEEL_ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const ROULETTE_REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

function requirePool() {
  if (!pool || typeof pool.query !== "function") throw new Error("DATABASE_URL is not configured.");
  return pool;
}

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}

function makeDeck() {
  const deck = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ rank, suit, value: rankValue({ rank }) });
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function draw(deck) {
  const card = deck.pop();
  if (!card) throw new Error("Deck is empty.");
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

function handValue(cards) {
  let total = 0;
  let aces = 0;
  for (const card of cards || []) {
    if (card.rank === "A") {
      aces += 1;
      total += 11;
    } else if (["J", "Q", "K"].includes(card.rank)) total += 10;
    else total += Number(card.rank);
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

function isNaturalBlackjack(hand) {
  return !hand?.fromSplit && Array.isArray(hand?.cards) && hand.cards.length === 2 && handValue(hand.cards) === 21;
}

function canSplitCards(cards) {
  if (!Array.isArray(cards) || cards.length !== 2) return false;
  const [a, b] = cards;
  const faces = new Set(["J", "Q", "K"]);
  if (faces.has(a?.rank) && faces.has(b?.rank)) return true;
  return a?.rank && a.rank === b?.rank;
}

function cashoutValue(bet, streak) {
  return gameConfig.higherLowerCashoutValue(bet, streak);
}

function iso(value) {
  return value ? new Date(value).toISOString() : null;
}

function rouletteColor(n) {
  if (Number(n) === 0) return "green";
  return ROULETTE_REDS.has(Number(n)) ? "red" : "black";
}

function rouletteMultiplier(type) {
  return type === "number" ? Number(gameConfig.CONFIG.casino.roulette.payouts.number || 36) : Number(gameConfig.CONFIG.casino.roulette.payouts.evenMoney || 2);
}

function validateRouletteBet(betType, betValue) {
  const type = String(betType || "").toLowerCase();
  if (!["red", "black", "odd", "even", "low", "high", "number"].includes(type)) {
    return { ok: false, message: "Invalid Roulette bet type." };
  }
  if (type === "number") {
    const n = Math.floor(Number(betValue));
    if (!Number.isFinite(n) || n < 0 || n > 36) return { ok: false, message: "Number bet must be 0-36." };
    return { ok: true, betType: type, betValue: n };
  }
  return { ok: true, betType: type, betValue: null };
}

function rouletteWins(betType, betValue, pocket) {
  const n = Number(pocket);
  const color = rouletteColor(n);
  if (betType === "red") return color === "red";
  if (betType === "black") return color === "black";
  if (betType === "odd") return n !== 0 && n % 2 === 1;
  if (betType === "even") return n !== 0 && n % 2 === 0;
  if (betType === "low") return n >= 1 && n <= 18;
  if (betType === "high") return n >= 19 && n <= 36;
  if (betType === "number") return n === Number(betValue);
  return false;
}

async function ensureSchema() {
  await appLinking.ensureSchema();
  const db = requirePool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS casino_tables (
      id TEXT PRIMARY KEY,
      game_type TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      host_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      host_user_id TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'app',
      discord_channel_id TEXT NULL,
      discord_message_id TEXT NULL,
      status TEXT NOT NULL,
      min_players INT NOT NULL DEFAULT 1,
      max_players INT NOT NULL DEFAULT 10,
      host_security_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      started_at TIMESTAMPTZ NULL,
      resolved_at TIMESTAMPTZ NULL,
      expires_at TIMESTAMPTZ NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_casino_tables_game_status
    ON casino_tables (game_type, status, updated_at DESC);

    CREATE TABLE IF NOT EXISTS casino_table_players (
      id TEXT PRIMARY KEY,
      table_id TEXT NOT NULL REFERENCES casino_tables(id) ON DELETE CASCADE,
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      seat_index INT NOT NULL,
      status TEXT NOT NULL,
      bet BIGINT NULL,
      fee_amount BIGINT NOT NULL DEFAULT 0,
      paid BOOLEAN NOT NULL DEFAULT FALSE,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      left_at TIMESTAMPTZ NULL,
      result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      UNIQUE (table_id, profile_id)
    );

    CREATE INDEX IF NOT EXISTS idx_casino_table_players_table
    ON casino_table_players (table_id, seat_index);

    CREATE TABLE IF NOT EXISTS casino_table_events (
      id BIGSERIAL PRIMARY KEY,
      table_id TEXT NOT NULL REFERENCES casino_tables(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      actor_profile_id TEXT NULL,
      payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await db.query(`ALTER TABLE casino_tables ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'app'`);
  await db.query(`ALTER TABLE casino_tables ADD COLUMN IF NOT EXISTS discord_channel_id TEXT NULL`);
  await db.query(`ALTER TABLE casino_tables ADD COLUMN IF NOT EXISTS discord_message_id TEXT NULL`);
  await db.query(`ALTER TABLE casino_tables ADD COLUMN IF NOT EXISTS min_players INT NOT NULL DEFAULT 1`);
}

async function expireOldTables(client = requirePool()) {
  await client.query(
    `UPDATE casino_tables
     SET status='expired', updated_at=NOW(), resolved_at=COALESCE(resolved_at, NOW())
     WHERE status IN ('lobby','playing') AND expires_at <= NOW()`
  );
}

async function event(client, tableId, eventType, actorProfileId, payload = {}) {
  await client.query(
    `INSERT INTO casino_table_events (table_id, event_type, actor_profile_id, payload_json)
     VALUES ($1, $2, $3, $4)`,
    [tableId, eventType, actorProfileId || null, payload]
  );
}

async function assertCtx(client, ctx) {
  if (!ctx?.profileId || !ctx.guildId || !ctx.discordUserId) {
    return { ok: false, statusCode: 401, message: "Linked Discord profile is required." };
  }
  const jail = await client.query(
    `SELECT jailed_until FROM jail WHERE guild_id=$1 AND user_id=$2 AND jailed_until > NOW() LIMIT 1`,
    [ctx.guildId, ctx.discordUserId]
  );
  if (jail.rows?.[0]) return { ok: false, statusCode: 403, message: "You cannot use casino tables while jailed." };
  return { ok: true };
}

function parseBet(raw) {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < MIN_BET || n > MAX_BET) return null;
  return n;
}

async function loadTable(client, tableId, gameType, lock = true) {
  const res = await client.query(
    `SELECT * FROM casino_tables WHERE id=$1 AND game_type=$2 ${lock ? "FOR UPDATE" : ""}`,
    [String(tableId), gameType]
  );
  return res.rows?.[0] || null;
}

async function playersFor(client, tableId, lock = false) {
  const res = await client.query(
    `SELECT * FROM casino_table_players WHERE table_id=$1 AND left_at IS NULL ORDER BY seat_index ASC ${lock ? "FOR UPDATE" : ""}`,
    [tableId]
  );
  return res.rows || [];
}

async function playerFor(client, tableId, ctx, lock = false) {
  const res = await client.query(
    `SELECT * FROM casino_table_players WHERE table_id=$1 AND profile_id=$2 AND left_at IS NULL ${lock ? "FOR UPDATE" : ""}`,
    [tableId, ctx.profileId]
  );
  return res.rows?.[0] || null;
}

async function lockHostSecurity(ctx) {
  return casinoSecurity.getHostBaseSecurity(ctx.guildId, ctx.discordUserId).catch(() => ({ level: 0, label: "Normal", feePct: 0 }));
}

async function feeFor(ctx, hostSecurity, stake) {
  const player = await casinoSecurity.getUserCasinoSecurity(ctx.guildId, ctx.discordUserId).catch(() => ({ level: 0, label: "Normal", feePct: 0 }));
  const effectiveFeePct = casinoSecurity.getEffectiveFeePct({
    playerFeePct: player.feePct,
    hostBaseFeePct: hostSecurity?.feePct || 0,
  });
  return casinoSecurity.computeFeeForBet(stake, effectiveFeePct);
}

async function chargeBet(client, ctx, table, stake, types, meta = {}) {
  const fee = await feeFor(ctx, table.host_security_json || {}, stake);
  const total = Number(fee.totalCharge || 0);
  const debit = await client.query(
    `UPDATE user_balances SET balance = balance - $3 WHERE guild_id=$1 AND user_id=$2 AND balance >= $3 RETURNING balance`,
    [ctx.guildId, ctx.discordUserId, total]
  );
  if (debit.rowCount === 0) return { ok: false };

  await client.query(`UPDATE guilds SET bank_balance = bank_balance + $2 WHERE guild_id=$1`, [ctx.guildId, total]);
  await client.query(
    `INSERT INTO transactions (guild_id, user_id, amount, type, meta) VALUES ($1, $2, $3, $4, $5)`,
    [ctx.guildId, ctx.discordUserId, -total, types.user, { ...meta, stake, feeAmount: fee.feeAmount, totalCharge: total }]
  );
  await client.query(
    `INSERT INTO transactions (guild_id, user_id, amount, type, meta) VALUES ($1, NULL, $2, $3, $4)`,
    [ctx.guildId, stake, types.bank, { ...meta, userId: ctx.discordUserId, stake }]
  );
  if (fee.feeAmount > 0) {
    await client.query(
      `INSERT INTO transactions (guild_id, user_id, amount, type, meta) VALUES ($1, NULL, $2, $3, $4)`,
      [ctx.guildId, fee.feeAmount, types.feeBank, { ...meta, userId: ctx.discordUserId, feeAmount: fee.feeAmount }]
    );
  }
  return { ok: true, feeAmount: Number(fee.feeAmount || 0), totalCharge: total };
}

async function refundStake(client, table, player, type, meta = {}) {
  const stake = Number(player.bet || 0);
  if (stake <= 0) return { ok: true, amount: 0 };
  const bank = await client.query(`SELECT bank_balance FROM guilds WHERE guild_id=$1 FOR UPDATE`, [table.guild_id]);
  if (Number(bank.rows?.[0]?.bank_balance || 0) < stake) return { ok: false, amount: 0 };
  await client.query(`UPDATE guilds SET bank_balance = bank_balance - $2 WHERE guild_id=$1`, [table.guild_id, stake]);
  await client.query(`UPDATE user_balances SET balance = balance + $3 WHERE guild_id=$1 AND user_id=$2`, [table.guild_id, player.user_id, stake]);
  await client.query(
    `INSERT INTO transactions (guild_id, user_id, amount, type, meta) VALUES ($1, $2, $3, $4, $5)`,
    [table.guild_id, player.user_id, stake, type, { ...meta, tableId: table.id }]
  );
  return { ok: true, amount: stake };
}

async function payPlayer(client, table, player, payout, type, meta = {}) {
  const wanted = Math.max(0, Math.floor(Number(payout || 0)));
  const bank = await client.query(`SELECT bank_balance FROM guilds WHERE guild_id=$1 FOR UPDATE`, [table.guild_id]);
  const available = Number(bank.rows?.[0]?.bank_balance || 0);
  const paid = Math.min(wanted, available);
  if (paid <= 0) return { ok: false, paid: 0, wanted };
  await client.query(`UPDATE guilds SET bank_balance = bank_balance - $2 WHERE guild_id=$1`, [table.guild_id, paid]);
  await client.query(`UPDATE user_balances SET balance = balance + $3 WHERE guild_id=$1 AND user_id=$2`, [table.guild_id, player.user_id, paid]);
  await client.query(
    `INSERT INTO transactions (guild_id, user_id, amount, type, meta) VALUES ($1, $2, $3, $4, $5)`,
    [table.guild_id, player.user_id, paid, type, { ...meta, tableId: table.id, wanted }]
  );
  return { ok: paid >= wanted, paid, wanted };
}

async function recordCasinoProgress(guildId, userId, { played = 0, wins = 0, profit = 0 } = {}) {
  try {
    if (played) await contracts.recordProgress({ guildId, userId, metric: "casino_games_played", amount: played });
    if (wins) await contracts.recordProgress({ guildId, userId, metric: "casino_wins", amount: wins });
    if (profit > 0) await contracts.recordProgress({ guildId, userId, metric: "casino_profit", amount: profit });
  } catch {}
}

function basePlayer(row) {
  const r = row.result_json || {};
  return {
    profileId: row.profile_id,
    userId: row.user_id,
    displayName: row.display_name,
    seatIndex: Number(row.seat_index || 0),
    status: row.status,
    bet: row.bet == null ? null : Number(row.bet || 0),
    feeAmount: Number(row.fee_amount || 0),
    paid: Boolean(row.paid),
    alive: Boolean(r.alive),
    streak: Number(r.streak || 0),
    pick: r.pick || null,
    payout: Number(r.payout || 0),
    profit: Number(r.profit || 0),
    result: r.result || null,
  };
}

function roulettePlayer(row) {
  const r = row.result_json || {};
  const lastBet = r.lastBet || null;
  const betType = r.betType || null;
  const betValue = r.betValue ?? null;
  return {
    profileId: row.profile_id,
    userId: row.user_id,
    displayName: row.display_name,
    seatIndex: Number(row.seat_index || 0),
    status: row.status,
    bet: row.bet == null ? null : Number(row.bet || 0),
    betAmount: row.bet == null ? null : Number(row.bet || 0),
    betType,
    betValue,
    feeAmount: Number(row.fee_amount || 0),
    totalCharge: row.bet == null ? null : Number(row.bet || 0) + Number(row.fee_amount || 0),
    paid: Boolean(row.paid),
    lastBet,
    payout: Number(r.payout || 0),
    profit: Number(r.profit || 0),
    result: r.result || null,
  };
}

function publicHigherLower(table, players, profile = null) {
  const state = table.state_json || {};
  return {
    configVersion: gameConfig.CONFIG_VERSION,
    tableId: table.id,
    gameType: "higher_lower",
    status: table.status,
    source: table.source || "app",
    discordChannelId: table.discord_channel_id || null,
    discordMessageId: table.discord_message_id || null,
    hostUserId: table.host_user_id,
    hostProfileId: table.host_profile_id,
    hostDisplayName: players.find((p) => p.profile_id === table.host_profile_id)?.display_name || null,
    minPlayers: Number(table.min_players || 1),
    maxPlayers: Number(table.max_players || MAX_PLAYERS),
    currentCard: state.currentCard || null,
    previousCard: state.previousCard || null,
    lastResult: state.lastResult || null,
    players: players.map(basePlayer),
    timestamps: { createdAt: iso(table.created_at), updatedAt: iso(table.updated_at), expiresAt: iso(table.expires_at) },
    profile,
  };
}

function bjHandPublic(hand) {
  return {
    id: hand.id,
    cards: hand.cards || [],
    value: handValue(hand.cards || []),
    bet: Number(hand.bet || 0),
    status: hand.status,
    doubled: Boolean(hand.doubled),
    result: hand.result || null,
    payout: Number(hand.payout || 0),
    profit: Number(hand.profit || 0),
  };
}

function bjAllowed(table, playerRow) {
  if (table.status !== "playing" || !playerRow) return [];
  const state = table.state_json || {};
  if (state.turnUserId !== playerRow.user_id) return [];
  const r = playerRow.result_json || {};
  const hand = (r.hands || [])[Number(r.activeHandIndex || 0)];
  if (!hand || hand.status !== "playing") return [];
  const value = handValue(hand.cards || []);
  if (value >= 21) return ["stand"];
  const actions = ["hit", "stand"];
  if ((hand.cards || []).length === 2 && !hand.doubled) actions.push("double");
  if ((r.hands || []).length === 1 && (hand.cards || []).length === 2 && canSplitCards(hand.cards)) actions.push("split");
  return actions;
}

function publicBlackjack(table, players, profile = null, currentProfileId = null) {
  const state = table.state_json || {};
  const reveal = table.status === "resolved";
  const dealerCards = state.dealerCards || [];
  const currentPlayer = players.find((p) => p.user_id === state.turnUserId) || null;
  const me = players.find((p) => p.profile_id === currentProfileId) || null;
  return {
    configVersion: gameConfig.CONFIG_VERSION,
    tableId: table.id,
    gameType: "blackjack",
    status: table.status,
    source: table.source || "app",
    discordChannelId: table.discord_channel_id || null,
    discordMessageId: table.discord_message_id || null,
    hostUserId: table.host_user_id,
    hostProfileId: table.host_profile_id,
    hostDisplayName: players.find((p) => p.profile_id === table.host_profile_id)?.display_name || null,
    minPlayers: Number(table.min_players || 1),
    maxPlayers: Number(table.max_players || MAX_PLAYERS),
    dealer: {
      visibleCards: reveal ? dealerCards : dealerCards.slice(0, 1),
      hiddenCount: reveal ? 0 : Math.max(0, dealerCards.length - 1),
      value: reveal ? handValue(dealerCards) : null,
    },
    currentTurn: table.status === "playing" ? {
      profileId: currentPlayer?.profile_id || null,
      userId: state.turnUserId || null,
      activeHandIndex: currentPlayer ? Number(currentPlayer.result_json?.activeHandIndex || 0) : null,
      turnExpiresAt: state.turnExpiresAt || null,
    } : null,
    players: players.map((p) => {
      const r = p.result_json || {};
      return {
        ...basePlayer(p),
        activeHandIndex: r.activeHandIndex ?? null,
        hands: (r.hands || []).map(bjHandPublic),
        totalPayout: Number(r.totalPayout || 0),
      };
    }),
    resultSummary: state.resultSummary || [],
    allowedActions: bjAllowed(table, me),
    timestamps: { createdAt: iso(table.created_at), updatedAt: iso(table.updated_at), expiresAt: iso(table.expires_at) },
    profile,
  };
}

function publicRoulette(table, players, profile = null, currentProfileId = null) {
  const state = table.state_json || {};
  const me = players.find((p) => p.profile_id === currentProfileId) || null;
  const readyToSpin = players.length > 0 && players.every((p) => p.paid && p.bet && p.result_json?.betType);
  const allowedActions = [];
  if (table.status === "lobby") {
    if (!me) allowedActions.push("join");
    if (me) {
      allowedActions.push("leave", "bet");
      if (me.result_json?.lastBet) allowedActions.push("last_bet");
      if (me.paid) allowedActions.push("clear_bet");
    }
    if (readyToSpin) allowedActions.push("spin");
    if (table.host_profile_id === currentProfileId) allowedActions.push("end");
  }
  return {
    configVersion: gameConfig.CONFIG_VERSION,
    tableId: table.id,
    gameType: "roulette",
    status: table.status,
    source: table.source || "app",
    discordChannelId: table.discord_channel_id || null,
    discordMessageId: table.discord_message_id || null,
    hostUserId: table.host_user_id,
    hostProfileId: table.host_profile_id,
    hostDisplayName: players.find((p) => p.profile_id === table.host_profile_id)?.display_name || null,
    minPlayers: Number(table.min_players || 1),
    maxPlayers: Number(table.max_players || MAX_PLAYERS),
    minBet: MIN_BET,
    maxBet: MAX_BET,
    wheel: {
      type: "european",
      numbers: Array.from({ length: 37 }, (_, i) => i),
      order: ROULETTE_WHEEL_ORDER,
      redNumbers: [...ROULETTE_REDS],
      hasDoubleZero: false,
    },
    players: players.map(roulettePlayer),
    readyToSpin,
    allowedActions,
    lastResult: state.lastResult || null,
    spin: state.spin || null,
    timestamps: { createdAt: iso(table.created_at), updatedAt: iso(table.updated_at), expiresAt: iso(table.expires_at) },
    profile,
  };
}

async function renderTable(client, table, ctx = null, includeProfile = false) {
  const players = await playersFor(client, table.id);
  const profile = includeProfile && ctx ? await appLinking.buildProfileSnapshot(ctx.profileId) : undefined;
  if (table.game_type === "higher_lower") return publicHigherLower(table, players, profile);
  if (table.game_type === "roulette") return publicRoulette(table, players, profile, ctx?.profileId);
  return publicBlackjack(table, players, profile, ctx?.profileId);
}

async function listTables(ctx, gameType) {
  await ensureSchema();
  const db = requirePool();
  await expireOldTables(db);
  const res = await db.query(
    `SELECT * FROM casino_tables
     WHERE game_type=$1 AND status IN ('lobby','playing')
     ORDER BY created_at DESC
     LIMIT 25`,
    [gameType]
  );
  const tables = [];
  for (const table of res.rows || []) {
    const players = await playersFor(db, table.id);
    if (gameType === "higher_lower") tables.push(publicHigherLower(table, players));
    else if (gameType === "roulette") tables.push(publicRoulette(table, players, null, ctx?.profileId));
    else tables.push(publicBlackjack(table, players, null, ctx?.profileId));
  }
  return { ok: true, body: { tables } };
}

async function listOpenTables(ctx) {
  await ensureSchema();
  const db = requirePool();
  await expireOldTables(db);
  const res = await db.query(
    `SELECT * FROM casino_tables
     WHERE status IN ('lobby','playing')
     ORDER BY created_at DESC
     LIMIT 50`
  );
  const tables = [];
  for (const table of res.rows || []) {
    const players = await playersFor(db, table.id);
    if (table.game_type === "higher_lower") tables.push(publicHigherLower(table, players));
    else if (table.game_type === "roulette") tables.push(publicRoulette(table, players, null, ctx?.profileId));
    else tables.push(publicBlackjack(table, players, null, ctx?.profileId));
  }
  return { ok: true, body: { tables } };
}

async function reconcileBlackjackTimeout(tableId) {
  const db = requirePool();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    let table = await loadTable(client, tableId, "blackjack");
    if (!table || table.status !== "playing") {
      await client.query("ROLLBACK");
      return table;
    }
    const state = table.state_json || {};
    if (!state.turnExpiresAt || new Date(state.turnExpiresAt).getTime() > Date.now()) {
      await client.query("ROLLBACK");
      return table;
    }
    const players = await playersFor(client, table.id, true);
    const player = players.find((p) => p.user_id === state.turnUserId);
    if (!player) {
      await client.query("ROLLBACK");
      return table;
    }
    const r = player.result_json || {};
    const hands = r.hands || [];
    const idx = Number(r.activeHandIndex || 0);
    if (hands[idx]?.status === "playing") {
      hands[idx].status = "stood";
      await client.query(`UPDATE casino_table_players SET result_json=$2::jsonb WHERE id=$1`, [player.id, JSON.stringify({ ...r, hands })]);
      const advanced = await advanceBj(client, table, player, state, hands, Number(state.turnIndex || 0));
      table = advanced.table || table;
      await event(client, table.id, "timeout_auto_stand", player.profile_id, { userId: player.user_id, handIndex: idx });
    }
    await client.query("COMMIT");
    return table;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function getTable(ctx, gameType, tableId) {
  await ensureSchema();
  const db = requirePool();
  await expireOldTables(db);
  if (gameType === "blackjack") await reconcileBlackjackTimeout(tableId);
  const table = await loadTable(db, tableId, gameType, false);
  if (!table) return { ok: false, statusCode: 404, message: "Casino table not found." };
  return { ok: true, body: await renderTable(db, table, ctx, true) };
}

async function createTable(ctx, gameType, options = {}) {
  await ensureSchema();
  const db = requirePool();
  const client = await db.connect();
  let table = null;
  try {
    await client.query("BEGIN");
    await expireOldTables(client);
    const valid = await assertCtx(client, ctx);
    if (!valid.ok) {
      await client.query("ROLLBACK");
      return valid;
    }
    await client.query(`INSERT INTO guilds (guild_id) VALUES ($1) ON CONFLICT (guild_id) DO NOTHING`, [ctx.guildId]);
    const hostSecurity = await lockHostSecurity(ctx);
    const tableId = id(gameType === "higher_lower" ? "hlt" : gameType === "roulette" ? "rou" : "bjt");
    const state = gameType === "higher_lower"
      ? { deck: [], currentCard: null, previousCard: null, lastResult: null }
      : gameType === "roulette"
        ? { wheelType: "european", lastResult: null, spin: null }
        : { deck: [], dealerCards: [], turnOrder: [], turnIndex: 0, turnUserId: null, turnExpiresAt: null, resultSummary: [] };
    const source = options.source === "discord" ? "discord" : "app";
    const minPlayers = Math.max(1, Number(options.minPlayers || 1));
    const inserted = await client.query(
      `INSERT INTO casino_tables
       (id, game_type, guild_id, host_profile_id, host_user_id, source, status, min_players, max_players, host_security_json, state_json, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,'lobby',$7,$8,$9::jsonb,$10::jsonb,$11)
       RETURNING *`,
      [tableId, gameType, ctx.guildId, ctx.profileId, ctx.discordUserId, source, minPlayers, MAX_PLAYERS, JSON.stringify(hostSecurity), JSON.stringify(state), new Date(Date.now() + TABLE_TTL_MS)]
    );
    table = inserted.rows[0];
    await client.query(
      `INSERT INTO casino_table_players
       (id, table_id, profile_id, user_id, display_name, seat_index, status, result_json)
       VALUES ($1,$2,$3,$4,$5,0,'joined',$6::jsonb)`,
      [id("ctp"), tableId, ctx.profileId, ctx.discordUserId, ctx.displayName, gameType === "higher_lower" ? JSON.stringify({ alive: false, streak: 0 }) : gameType === "roulette" ? JSON.stringify({}) : JSON.stringify({ hands: [] })]
    );
    await event(client, tableId, "create", ctx.profileId, { gameType, source });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return { ok: true, body: await renderTable(db, table, ctx, true) };
}

async function setDiscordMessage(tableId, channelId, messageId) {
  await ensureSchema();
  const db = requirePool();
  const res = await db.query(
    `UPDATE casino_tables
     SET discord_channel_id=$2, discord_message_id=$3, updated_at=NOW()
     WHERE id=$1
     RETURNING *`,
    [String(tableId), String(channelId || ""), String(messageId || "")]
  );
  return res.rows?.[0] || null;
}

async function joinTable(ctx, gameType, tableId) {
  await ensureSchema();
  const db = requirePool();
  const client = await db.connect();
  let table = null;
  try {
    await client.query("BEGIN");
    const valid = await assertCtx(client, ctx);
    if (!valid.ok) {
      await client.query("ROLLBACK");
      return valid;
    }
    table = await loadTable(client, tableId, gameType);
    if (!table) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 404, message: "Casino table not found." };
    }
    if (table.status !== "lobby") {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 409, message: "You can only join during lobby." };
    }
    const players = await playersFor(client, table.id, true);
    if (players.some((p) => p.profile_id === ctx.profileId)) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 409, message: "You are already at this table." };
    }
    if (players.length >= Number(table.max_players || MAX_PLAYERS)) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 409, message: "This table is full." };
    }
    await client.query(
      `INSERT INTO casino_table_players
       (id, table_id, profile_id, user_id, display_name, seat_index, status, result_json)
       VALUES ($1,$2,$3,$4,$5,$6,'joined',$7::jsonb)`,
      [id("ctp"), table.id, ctx.profileId, ctx.discordUserId, ctx.displayName, players.length, gameType === "higher_lower" ? JSON.stringify({ alive: false, streak: 0 }) : gameType === "roulette" ? JSON.stringify({}) : JSON.stringify({ hands: [] })]
    );
    await event(client, table.id, "join", ctx.profileId);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return { ok: true, body: await renderTable(db, table, ctx, true) };
}

async function leaveTable(ctx, gameType, tableId) {
  await ensureSchema();
  const db = requirePool();
  const client = await db.connect();
  let table = null;
  try {
    await client.query("BEGIN");
    table = await loadTable(client, tableId, gameType);
    if (!table) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 404, message: "Casino table not found." };
    }
    if (table.status !== "lobby") {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 409, message: "You can only leave during lobby." };
    }
    const player = await playerFor(client, table.id, ctx, true);
    if (!player) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 404, message: "You are not at this table." };
    }
    if (player.paid) {
      const refundType = gameType === "higher_lower" ? "higherlower_table_leave_refund" : gameType === "roulette" ? "roulette_leave_refund" : "blackjack_table_leave_refund";
      const refund = await refundStake(client, table, player, refundType);
      if (!refund.ok) {
        await client.query("ROLLBACK");
        return { ok: false, statusCode: 409, message: "Server bank cannot cover that refund right now." };
      }
    }
    await client.query(`UPDATE casino_table_players SET left_at=NOW(), status='left' WHERE id=$1`, [player.id]);
    await event(client, table.id, "leave", ctx.profileId);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return { ok: true, body: await renderTable(db, table, ctx, true) };
}

async function setTableBet(ctx, gameType, tableId, amountInput) {
  await ensureSchema();
  const stake = parseBet(amountInput);
  if (!stake) return { ok: false, statusCode: 400, message: `Bet must be between ${MIN_BET} and ${MAX_BET}.` };
  const db = requirePool();
  const client = await db.connect();
  let table = null;
  try {
    await client.query("BEGIN");
    const valid = await assertCtx(client, ctx);
    if (!valid.ok) {
      await client.query("ROLLBACK");
      return valid;
    }
    table = await loadTable(client, tableId, gameType);
    if (!table) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 404, message: "Casino table not found." };
    }
    if (table.status !== "lobby") {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 409, message: "Bets are locked after start." };
    }
    const player = await playerFor(client, table.id, ctx, true);
    if (!player) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 409, message: "Join this table before betting." };
    }
    if (player.paid) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 409, message: "Clear or leave before changing a paid bet." };
    }
    const prefix = gameType === "higher_lower" ? "higherlower_table" : "blackjack_table";
    const charge = await chargeBet(client, ctx, table, stake, {
      user: `${prefix}_bet`,
      bank: `${prefix}_bet_bank`,
      feeBank: `${prefix}_fee_bank`,
    }, { tableId: table.id });
    if (!charge.ok) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 402, message: "Not enough wallet funds for that bet plus fee." };
    }
    await client.query(
      `UPDATE casino_table_players SET bet=$2, fee_amount=$3, paid=TRUE, status='paid' WHERE id=$1`,
      [player.id, stake, charge.feeAmount]
    );
    await event(client, table.id, "bet", ctx.profileId, { stake, feeAmount: charge.feeAmount });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return { ok: true, body: await renderTable(db, table, ctx, true) };
}

async function clearBlackjackBet(ctx, tableId) {
  await ensureSchema();
  const db = requirePool();
  const client = await db.connect();
  let table = null;
  try {
    await client.query("BEGIN");
    table = await loadTable(client, tableId, "blackjack");
    if (!table) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 404, message: "Casino table not found." };
    }
    if (table.status !== "lobby") {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 409, message: "Bets are locked after start." };
    }
    const player = await playerFor(client, table.id, ctx, true);
    if (!player?.paid) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 409, message: "You do not have a paid bet to clear." };
    }
    const refund = await refundStake(client, table, player, "blackjack_table_clearbet_refund");
    if (!refund.ok) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 409, message: "Server bank cannot cover that refund right now." };
    }
    await client.query(`UPDATE casino_table_players SET bet=NULL, paid=FALSE, fee_amount=0, status='joined' WHERE id=$1`, [player.id]);
    await event(client, table.id, "clear_bet", ctx.profileId);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return { ok: true, body: await renderTable(db, table, ctx, true) };
}

async function setRouletteBet(ctx, tableId, body = {}) {
  await ensureSchema();
  const stake = parseBet(body.amount);
  if (!stake) return { ok: false, statusCode: 400, message: `Bet must be between ${MIN_BET} and ${MAX_BET}.` };
  const parsed = validateRouletteBet(body.betType || body.bet_type, body.betValue ?? body.bet_value);
  if (!parsed.ok) return { ok: false, statusCode: 400, message: parsed.message };
  const db = requirePool();
  const client = await db.connect();
  let table = null;
  try {
    await client.query("BEGIN");
    const valid = await assertCtx(client, ctx);
    if (!valid.ok) {
      await client.query("ROLLBACK");
      return valid;
    }
    table = await loadTable(client, tableId, "roulette");
    if (!table) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 404, message: "Casino table not found." };
    }
    if (table.status !== "lobby") {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 409, message: "This Roulette table is closed." };
    }
    const player = await playerFor(client, table.id, ctx, true);
    if (!player) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 409, message: "Join this table before betting." };
    }
    if (player.paid) {
      const refund = await refundStake(client, table, player, "roulette_rebet_refund", { reason: "change_bet" });
      if (!refund.ok) {
        await client.query("ROLLBACK");
        return { ok: false, statusCode: 409, message: "Server bank cannot cover the old stake refund right now." };
      }
    }
    const charge = await chargeBet(client, ctx, table, stake, {
      user: "roulette_bet",
      bank: "roulette_bank_buyin",
      feeBank: "roulette_fee_bank_buyin",
    }, { tableId: table.id, betType: parsed.betType, betValue: parsed.betValue });
    if (!charge.ok) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 402, message: "Not enough wallet funds for that bet plus fee." };
    }
    const result = {
      betType: parsed.betType,
      betValue: parsed.betValue,
      lastBet: { betAmount: stake, betType: parsed.betType, betValue: parsed.betValue },
      payout: 0,
      profit: 0,
      result: null,
    };
    await client.query(
      `UPDATE casino_table_players SET bet=$2, fee_amount=$3, paid=TRUE, status='paid', result_json=result_json || $4::jsonb WHERE id=$1`,
      [player.id, stake, charge.feeAmount, JSON.stringify(result)]
    );
    await event(client, table.id, "roulette_bet", ctx.profileId, { stake, feeAmount: charge.feeAmount, betType: parsed.betType, betValue: parsed.betValue });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return { ok: true, body: await renderTable(db, table, ctx, true) };
}

async function rouletteLastBet(ctx, tableId) {
  await ensureSchema();
  const db = requirePool();
  const table = await loadTable(db, tableId, "roulette", false);
  if (!table) return { ok: false, statusCode: 404, message: "Casino table not found." };
  const player = await playerFor(db, table.id, ctx, false);
  const last = player?.result_json?.lastBet;
  if (!last) return { ok: false, statusCode: 409, message: "No last Roulette bet is saved for you at this table." };
  return setRouletteBet(ctx, tableId, { amount: last.betAmount, betType: last.betType, betValue: last.betValue });
}

async function clearRouletteBet(ctx, tableId) {
  await ensureSchema();
  const db = requirePool();
  const client = await db.connect();
  let table = null;
  try {
    await client.query("BEGIN");
    table = await loadTable(client, tableId, "roulette");
    if (!table) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 404, message: "Casino table not found." };
    }
    if (table.status !== "lobby") {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 409, message: "This Roulette table is closed." };
    }
    const player = await playerFor(client, table.id, ctx, true);
    if (!player?.paid) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 409, message: "You do not have a paid bet to clear." };
    }
    const refund = await refundStake(client, table, player, "roulette_clearbet_refund");
    if (!refund.ok) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 409, message: "Server bank cannot cover that refund right now." };
    }
    const r = player.result_json || {};
    await client.query(
      `UPDATE casino_table_players SET bet=NULL, paid=FALSE, fee_amount=0, status='joined', result_json=$2::jsonb WHERE id=$1`,
      [player.id, JSON.stringify({ ...r, betType: null, betValue: null, payout: 0, profit: 0, result: null })]
    );
    await event(client, table.id, "roulette_clear_bet", ctx.profileId);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return { ok: true, body: await renderTable(db, table, ctx, true) };
}

async function spinRoulette(ctx, tableId) {
  await ensureSchema();
  const db = requirePool();
  const client = await db.connect();
  let table = null;
  try {
    await client.query("BEGIN");
    table = await loadTable(client, tableId, "roulette");
    if (!table) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 404, message: "Casino table not found." };
    }
    if (table.status !== "lobby") {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 409, message: "This Roulette table is closed." };
    }
    const players = await playersFor(client, table.id, true);
    if (!players.length || players.some((p) => !p.paid || !p.bet || !p.result_json?.betType)) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 409, message: "Everyone at the table must have a paid bet before spinning." };
    }
    const pocket = crypto.randomInt(0, 37);
    const color = rouletteColor(pocket);
    const spinId = id("spin");
    const results = [];
    for (const p of players) {
      const r = p.result_json || {};
      const stake = Number(p.bet || 0);
      const win = rouletteWins(r.betType, r.betValue, pocket);
      const multiplier = rouletteMultiplier(r.betType);
      const payout = win ? Math.floor(stake * multiplier) : 0;
      let paid = 0;
      if (payout > 0) {
        const pay = await payPlayer(client, table, p, payout, "roulette_payout", {
          spinId,
          pocket,
          color,
          betType: r.betType,
          betValue: r.betValue,
        });
        paid = pay.paid;
      }
      const profit = paid - stake;
      const playerResult = {
        profileId: p.profile_id,
        userId: p.user_id,
        displayName: p.display_name,
        betAmount: stake,
        betType: r.betType,
        betValue: r.betValue ?? null,
        won: win && paid > 0,
        multiplier,
        payout: paid,
        profit,
      };
      results.push(playerResult);
      await client.query(
        `UPDATE casino_table_players
         SET paid=FALSE,
             status='joined',
             bet=NULL,
             fee_amount=0,
             result_json=$2::jsonb
         WHERE id=$1`,
        [p.id, JSON.stringify({ ...r, betType: null, betValue: null, payout: paid, profit, result: playerResult.won ? "win" : "loss" })]
      );
      await recordCasinoProgress(table.guild_id, p.user_id, { played: 1, wins: playerResult.won ? 1 : 0, profit: Math.max(0, profit) });
    }
    const now = new Date().toISOString();
    const lastResult = {
      spinId,
      pocket,
      color,
      colour: color,
      durationMs: 4200,
      results,
      notes: [],
      settledAt: now,
    };
    const spin = {
      spinId,
      pocket,
      color,
      colour: color,
      durationMs: 4200,
      startedAt: now,
      settledAt: now,
    };
    const state = { ...(table.state_json || {}), lastResult, spin };
    const updated = await client.query(
      `UPDATE casino_tables SET state_json=$2::jsonb, updated_at=NOW() WHERE id=$1 RETURNING *`,
      [table.id, JSON.stringify(state)]
    );
    table = updated.rows[0];
    await event(client, table.id, "roulette_spin", ctx.profileId, lastResult);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return { ok: true, body: await renderTable(db, table, ctx, true) };
}

async function endRoulette(ctx, tableId) {
  await ensureSchema();
  const db = requirePool();
  const client = await db.connect();
  let table = null;
  try {
    await client.query("BEGIN");
    table = await loadTable(client, tableId, "roulette");
    if (!table) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 404, message: "Casino table not found." };
    }
    if (table.host_profile_id !== ctx.profileId) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 403, message: "Only the host can end this table." };
    }
    const players = await playersFor(client, table.id, true);
    for (const p of players.filter((row) => row.paid)) {
      const refund = await refundStake(client, table, p, "roulette_leave_refund", { reason: "table_end" });
      if (!refund.ok) {
        await client.query("ROLLBACK");
        return { ok: false, statusCode: 409, message: "Server bank cannot cover all paid stake refunds right now." };
      }
    }
    const updated = await client.query(
      `UPDATE casino_tables SET status='closed', resolved_at=NOW(), updated_at=NOW() WHERE id=$1 RETURNING *`,
      [table.id]
    );
    table = updated.rows[0];
    await client.query(`UPDATE casino_table_players SET paid=FALSE, bet=NULL, fee_amount=0, status='left', left_at=COALESCE(left_at, NOW()) WHERE table_id=$1`, [table.id]);
    await event(client, table.id, "roulette_end", ctx.profileId);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return { ok: true, body: await renderTable(db, table, ctx, true) };
}

async function startHigherLower(ctx, tableId) {
  await ensureSchema();
  const db = requirePool();
  const client = await db.connect();
  let table = null;
  try {
    await client.query("BEGIN");
    table = await loadTable(client, tableId, "higher_lower");
    if (!table) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 404, message: "Casino table not found." };
    }
    if (table.host_profile_id !== ctx.profileId) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 403, message: "Only the host can start this table." };
    }
    if (table.status !== "lobby") {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 409, message: "This table has already started." };
    }
    const players = await playersFor(client, table.id, true);
    if (players.length < Number(table.min_players || 1)) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 409, message: `This table needs ${Number(table.min_players || 1)} player(s) to start.` };
    }
    if (!players.length || players.some((p) => !p.paid || !p.bet)) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 409, message: "All joined players must pay before starting." };
    }
    const deck = makeDeck();
    const currentCard = draw(deck);
    const state = { deck, currentCard, previousCard: null, lastResult: null };
    await client.query(
      `UPDATE casino_table_players SET status='alive', result_json=$2::jsonb WHERE table_id=$1 AND left_at IS NULL`,
      [table.id, JSON.stringify({ alive: true, streak: 0, pick: null, payout: 0, profit: 0, result: null })]
    );
    const updated = await client.query(
      `UPDATE casino_tables SET status='playing', state_json=$2::jsonb, started_at=NOW(), updated_at=NOW() WHERE id=$1 RETURNING *`,
      [table.id, JSON.stringify(state)]
    );
    table = updated.rows[0];
    await event(client, table.id, "start", ctx.profileId);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return { ok: true, body: await renderTable(db, table, ctx, true) };
}

function higherLowerCorrect(pick, fromCard, toCard) {
  const a = rankValue(fromCard);
  const b = rankValue(toCard);
  return (pick === "higher" && b > a) || (pick === "lower" && b < a) || (pick === "same" && b === a);
}

async function guessHigherLower(ctx, tableId, pickInput) {
  await ensureSchema();
  const pick = String(pickInput || "").toLowerCase();
  if (!["higher", "lower", "same"].includes(pick)) return { ok: false, statusCode: 400, message: "Pick must be higher, lower, or same." };
  const db = requirePool();
  const client = await db.connect();
  let table = null;
  try {
    await client.query("BEGIN");
    table = await loadTable(client, tableId, "higher_lower");
    if (!table || table.status !== "playing") {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: table ? 409 : 404, message: table ? "Table is not playing." : "Casino table not found." };
    }
    const player = await playerFor(client, table.id, ctx, true);
    const pr = player?.result_json || {};
    if (!player || !pr.alive) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 409, message: "You are not alive at this table." };
    }
    await client.query(
      `UPDATE casino_table_players SET result_json = result_json || $2::jsonb WHERE id=$1`,
      [player.id, JSON.stringify({ pick })]
    );

    let players = await playersFor(client, table.id, true);
    const alive = players.filter((p) => p.result_json?.alive);
    if (alive.length && alive.every((p) => p.result_json?.pick)) {
      const state = table.state_json || {};
      const deck = state.deck || [];
      const fromCard = state.currentCard;
      const toCard = draw(deck);
      const resolvedPlayers = [];
      for (const p of alive) {
        const r = p.result_json || {};
        const correct = higherLowerCorrect(r.pick, fromCard, toCard);
        const next = correct
          ? { ...r, streak: Number(r.streak || 0) + 1, pick: null, result: "correct", alive: true }
          : { ...r, pick: null, result: "bust", alive: false, payout: 0, profit: -Number(p.bet || 0) };
        await client.query(`UPDATE casino_table_players SET status=$2, result_json=$3::jsonb WHERE id=$1`, [p.id, correct ? "alive" : "busted", JSON.stringify(next)]);
        resolvedPlayers.push({ profileId: p.profile_id, userId: p.user_id, displayName: p.display_name, pick: r.pick, result: next.result, streak: next.streak || 0 });
        if (!correct) await recordCasinoProgress(table.guild_id, p.user_id, { played: 1 });
      }
      const lastResult = { fromCard, toCard, resolvedPlayers };
      const updated = await client.query(
        `UPDATE casino_tables SET state_json=$2::jsonb, updated_at=NOW() WHERE id=$1 RETURNING *`,
        [table.id, JSON.stringify({ ...state, deck, previousCard: fromCard, currentCard: toCard, lastResult })]
      );
      table = updated.rows[0];
      players = await playersFor(client, table.id, true);
      if (!players.some((p) => p.result_json?.alive)) {
        const resolved = await client.query(
          `UPDATE casino_tables SET status='resolved', resolved_at=NOW(), updated_at=NOW() WHERE id=$1 RETURNING *`,
          [table.id]
        );
        table = resolved.rows[0];
      }
      await event(client, table.id, "resolve_guess", ctx.profileId, lastResult);
    } else {
      await event(client, table.id, "guess", ctx.profileId, { pick });
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return { ok: true, body: await renderTable(db, table, ctx, true) };
}

async function cashoutHigherLower(ctx, tableId) {
  await ensureSchema();
  const db = requirePool();
  const client = await db.connect();
  let table = null;
  try {
    await client.query("BEGIN");
    table = await loadTable(client, tableId, "higher_lower");
    if (!table || table.status !== "playing") {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: table ? 409 : 404, message: table ? "Table is not playing." : "Casino table not found." };
    }
    const player = await playerFor(client, table.id, ctx, true);
    const r = player?.result_json || {};
    if (!player || !r.alive) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 409, message: "You are not alive at this table." };
    }
    const payout = cashoutValue(player.bet, r.streak);
    const paid = await payPlayer(client, table, player, payout, "higherlower_table_payout", { streak: r.streak, multiplier: gameConfig.higherLowerMultiplier(r.streak) });
    if (!paid.ok && paid.paid <= 0) {
      const refund = await refundStake(client, table, player, "higherlower_table_refund", { reason: "payout_failed" });
      await client.query(
        `UPDATE casino_table_players SET status='payout_failed', result_json=result_json || $2::jsonb WHERE id=$1`,
        [player.id, JSON.stringify({ alive: false, result: "payout_failed", payout: refund.amount || 0, profit: (refund.amount || 0) - Number(player.bet || 0) })]
      );
    } else {
      const profit = paid.paid - Number(player.bet || 0);
      await client.query(
        `UPDATE casino_table_players SET status='cashed_out', result_json=result_json || $2::jsonb WHERE id=$1`,
        [player.id, JSON.stringify({ alive: false, result: paid.ok ? "cashout" : "partial_cashout", payout: paid.paid, profit })]
      );
      await recordCasinoProgress(table.guild_id, player.user_id, { played: 1, wins: profit > 0 ? 1 : 0, profit: Math.max(0, profit) });
    }
    const players = await playersFor(client, table.id, true);
    if (!players.some((p) => p.id !== player.id ? p.result_json?.alive : false)) {
      const resolved = await client.query(`UPDATE casino_tables SET status='resolved', resolved_at=NOW(), updated_at=NOW() WHERE id=$1 RETURNING *`, [table.id]);
      table = resolved.rows[0];
    }
    await event(client, table.id, "cashout", ctx.profileId);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return { ok: true, body: await renderTable(db, table, ctx, true) };
}

function nextBjTurn(players, state, fromIndex = 0) {
  const order = state.turnOrder || [];
  for (let i = fromIndex; i < order.length; i += 1) {
    const p = players.find((row) => row.user_id === order[i]);
    const hands = p?.result_json?.hands || [];
    const idx = hands.findIndex((h) => h.status === "playing");
    if (idx >= 0) return { turnIndex: i, userId: order[i], handIndex: idx };
  }
  return null;
}

async function startBlackjack(ctx, tableId) {
  await ensureSchema();
  const db = requirePool();
  const client = await db.connect();
  let table = null;
  try {
    await client.query("BEGIN");
    table = await loadTable(client, tableId, "blackjack");
    if (!table) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 404, message: "Casino table not found." };
    }
    if (table.host_profile_id !== ctx.profileId) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 403, message: "Only the host can start this table." };
    }
    if (table.status !== "lobby") {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 409, message: "This table has already started." };
    }
    const players = await playersFor(client, table.id, true);
    if (players.length < Number(table.min_players || 1)) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 409, message: `This table needs ${Number(table.min_players || 1)} player(s) to start.` };
    }
    if (!players.length || players.some((p) => !p.paid || !p.bet)) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 409, message: "All joined players must pay before starting." };
    }
    const deck = makeDeck();
    const dealerCards = [draw(deck), draw(deck)];
    for (const p of players) {
      const cards = [draw(deck), draw(deck)];
      const hand = { id: "hand_1", cards, status: isNaturalBlackjack({ cards }) ? "blackjack" : "playing", bet: Number(p.bet || 0), doubled: false, result: null, payout: 0, profit: 0, fromSplit: false };
      await client.query(`UPDATE casino_table_players SET status=$2, result_json=$3::jsonb WHERE id=$1`, [p.id, hand.status === "blackjack" ? "blackjack" : "playing", JSON.stringify({ hands: [hand], activeHandIndex: 0, totalPayout: 0 })]);
    }
    const updatedPlayers = await playersFor(client, table.id, true);
    const state = { deck, dealerCards, turnOrder: updatedPlayers.map((p) => p.user_id), turnIndex: 0, turnUserId: null, turnExpiresAt: null, resultSummary: [] };
    const next = nextBjTurn(updatedPlayers, state, 0);
    if (next) {
      state.turnIndex = next.turnIndex;
      state.turnUserId = next.userId;
      state.turnExpiresAt = new Date(Date.now() + TURN_MS).toISOString();
      const turnPlayer = updatedPlayers.find((p) => p.user_id === next.userId);
      await client.query(`UPDATE casino_table_players SET result_json=result_json || $2::jsonb WHERE id=$1`, [turnPlayer.id, JSON.stringify({ activeHandIndex: next.handIndex })]);
    }
    const updated = await client.query(`UPDATE casino_tables SET status='playing', state_json=$2::jsonb, started_at=NOW(), updated_at=NOW() WHERE id=$1 RETURNING *`, [table.id, JSON.stringify(state)]);
    table = updated.rows[0];
    await event(client, table.id, "start", ctx.profileId);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  const body = await getTable(ctx, "blackjack", table.id);
  if (body.body?.players?.every((p) => !p.hands?.some((h) => h.status === "playing"))) return resolveBlackjack(ctx, table.id);
  return { ok: true, body: body.body };
}

function settleBj(hand, dealerCards) {
  const pv = handValue(hand.cards);
  const dv = handValue(dealerCards);
  if (pv > 21) return "lose";
  if (isNaturalBlackjack(hand)) return "blackjack";
  if (dv > 21) return "win";
  if (pv > dv) return "win";
  if (pv < dv) return "lose";
  return "push";
}

function bjPayout(result, bet) {
  return gameConfig.blackjackPayout(result, bet);
}

async function resolveBlackjack(ctx, tableId, clientArg = null, tableArg = null) {
  const own = !clientArg;
  const db = requirePool();
  const client = clientArg || await db.connect();
  let table = tableArg;
  try {
    if (own) await client.query("BEGIN");
    table = table || await loadTable(client, tableId, "blackjack");
    const state = table.state_json || {};
    const dealerCards = state.dealerCards || [];
    while (handValue(dealerCards) < 17) dealerCards.push(draw(state.deck));
    const players = await playersFor(client, table.id, true);
    const resultSummary = [];
    for (const p of players) {
      const r = p.result_json || {};
      let totalPayout = 0;
      let totalBet = 0;
      const hands = (r.hands || []).map((h) => {
        const result = settleBj(h, dealerCards);
        const payout = bjPayout(result, Number(h.bet || 0));
        totalPayout += payout;
        totalBet += Number(h.bet || 0);
        return { ...h, status: "resolved", result, payout, profit: payout - Number(h.bet || 0) };
      });
      let paid = 0;
      if (totalPayout > 0) {
        const pay = await payPlayer(client, table, p, totalPayout, "blackjack_table_payout", {});
        paid = pay.paid;
      }
      const profit = paid - totalBet;
      await client.query(`UPDATE casino_table_players SET status='resolved', result_json=$2::jsonb WHERE id=$1`, [p.id, JSON.stringify({ ...r, hands, totalPayout: paid, profit })]);
      resultSummary.push({ profileId: p.profile_id, userId: p.user_id, displayName: p.display_name, totalBet, totalPayout: paid, profit });
      await recordCasinoProgress(table.guild_id, p.user_id, { played: 1, wins: profit > 0 ? 1 : 0, profit: Math.max(0, profit) });
    }
    const updated = await client.query(
      `UPDATE casino_tables SET status='resolved', state_json=$2::jsonb, resolved_at=NOW(), updated_at=NOW() WHERE id=$1 RETURNING *`,
      [table.id, JSON.stringify({ ...state, dealerCards, resultSummary, turnUserId: null, turnExpiresAt: null })]
    );
    table = updated.rows[0];
    if (own) await client.query("COMMIT");
  } catch (error) {
    if (own) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    if (own) client.release();
  }
  return { ok: true, table, body: await renderTable(db, table, ctx, true) };
}

async function advanceBj(client, table, player, state, hands, startFromTurnIndex) {
  const players = await playersFor(client, table.id, true);
  const next = nextBjTurn(players, state, startFromTurnIndex);
  if (!next) return resolveBlackjack(null, table.id, client, table);
  const nextPlayer = players.find((p) => p.user_id === next.userId);
  await client.query(`UPDATE casino_table_players SET result_json=result_json || $2::jsonb WHERE id=$1`, [nextPlayer.id, JSON.stringify({ activeHandIndex: next.handIndex })]);
  const updated = await client.query(
    `UPDATE casino_tables SET state_json=$2::jsonb, updated_at=NOW() WHERE id=$1 RETURNING *`,
    [table.id, JSON.stringify({ ...state, turnIndex: next.turnIndex, turnUserId: next.userId, turnExpiresAt: new Date(Date.now() + TURN_MS).toISOString() })]
  );
  return { ok: true, table: updated.rows[0] };
}

async function bjAction(ctx, tableId, action) {
  await ensureSchema();
  const db = requirePool();
  const client = await db.connect();
  let table = null;
  try {
    await client.query("BEGIN");
    table = await loadTable(client, tableId, "blackjack");
    if (!table || table.status !== "playing") {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: table ? 409 : 404, message: table ? "Table is not playing." : "Casino table not found." };
    }
    const state = table.state_json || {};
    if (state.turnUserId !== ctx.discordUserId) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 409, message: "It is not your turn." };
    }
    const player = await playerFor(client, table.id, ctx, true);
    const r = player.result_json || {};
    const hands = r.hands || [];
    const idx = Number(r.activeHandIndex || 0);
    const hand = hands[idx];
    if (!hand || hand.status !== "playing") {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 409, message: "No playable hand." };
    }
    if (action === "hit") {
      if (handValue(hand.cards) >= 21) {
        await client.query("ROLLBACK");
        return { ok: false, statusCode: 409, message: "This hand should stand." };
      }
      hand.cards.push(draw(state.deck));
      const value = handValue(hand.cards);
      if (value > 21) hand.status = "busted";
      else if (value === 21) hand.status = "stood";
    } else if (action === "stand") {
      hand.status = "stood";
    } else if (action === "double") {
      if ((hand.cards || []).length !== 2 || hand.doubled || handValue(hand.cards) >= 21) {
        await client.query("ROLLBACK");
        return { ok: false, statusCode: 409, message: "Double is not allowed." };
      }
      const charge = await chargeBet(client, ctx, table, Number(hand.bet || 0), { user: "blackjack_table_double", bank: "blackjack_table_double_bank", feeBank: "blackjack_table_double_fee_bank" }, { tableId: table.id, handId: hand.id });
      if (!charge.ok) {
        await client.query("ROLLBACK");
        return { ok: false, statusCode: 402, message: "Not enough wallet funds to double." };
      }
      hand.bet = Number(hand.bet || 0) * 2;
      hand.doubled = true;
      hand.cards.push(draw(state.deck));
      hand.status = handValue(hand.cards) > 21 ? "busted" : "stood";
    } else if (action === "split") {
      if (hands.length !== 1 || !canSplitCards(hand.cards)) {
        await client.query("ROLLBACK");
        return { ok: false, statusCode: 409, message: "Split is not allowed." };
      }
      const charge = await chargeBet(client, ctx, table, Number(hand.bet || 0), { user: "blackjack_table_split", bank: "blackjack_table_split_bank", feeBank: "blackjack_table_split_fee_bank" }, { tableId: table.id, handId: hand.id });
      if (!charge.ok) {
        await client.query("ROLLBACK");
        return { ok: false, statusCode: 402, message: "Not enough wallet funds to split." };
      }
      const [a, b] = hand.cards;
      hands.splice(0, 1,
        { id: "hand_1", cards: [a, draw(state.deck)], status: "playing", bet: Number(hand.bet || 0), doubled: false, result: null, payout: 0, profit: 0, fromSplit: true },
        { id: "hand_2", cards: [b, draw(state.deck)], status: "playing", bet: Number(hand.bet || 0), doubled: false, result: null, payout: 0, profit: 0, fromSplit: true }
      );
    }
    await client.query(`UPDATE casino_table_players SET result_json=$2::jsonb WHERE id=$1`, [player.id, JSON.stringify({ ...r, hands })]);
    const startIndex = Number(state.turnIndex || 0);
    const adv = await advanceBj(client, table, player, state, hands, startIndex);
    table = adv.table || table;
    await event(client, table.id, action, ctx.profileId);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return { ok: true, body: await renderTable(db, table, ctx, true) };
}

module.exports = {
  ensureSchema,
  listTables,
  listOpenTables,
  getTable,
  createTable,
  setDiscordMessage,
  joinTable,
  leaveTable,
  setTableBet,
  clearBlackjackBet,
  setRouletteBet,
  rouletteLastBet,
  clearRouletteBet,
  spinRoulette,
  endRoulette,
  startHigherLower,
  guessHigherLower,
  cashoutHigherLower,
  startBlackjack,
  bjAction,
};
