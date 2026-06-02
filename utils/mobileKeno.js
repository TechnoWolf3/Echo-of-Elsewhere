const crypto = require("crypto");
const appLinking = require("./appLinking");
const economy = require("./economy");
const contracts = require("./contracts");
const { pool } = require("./db");
const { bankPayoutWithEffects, handleTriggeredEffectEvent } = require("./effectSystem");
const gameConfig = require("./gameConfig");

const DRAW_COUNT = 20;
const NUMBER_MIN = 1;
const NUMBER_MAX = 80;
const DEFAULT_MIN_BET = 500;
const DEFAULT_MAX_BET = 250000;
const PAYOUTS = gameConfig.CONFIG.casino.keno.classicPayouts;
const HTD_PAYOUTS = gameConfig.CONFIG.casino.keno.headsTailsDrawPayouts;

const ACTIVITY_EFFECTS = {
  effectsApply: true,
  canAwardEffects: true,
  blockedBlessings: [],
  blockedCurses: [],
  effectAwardPool: { nothingWeight: 100, blessingWeight: 0, curseWeight: 0, blessingWeights: {}, curseWeights: {} },
};

function fail(statusCode, message) {
  return { ok: false, statusCode, message };
}

function normalizeType(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "quick_pick") return "quickpick";
  return raw;
}

function parseAmount(value) {
  const n = Math.floor(Number(value));
  const min = Number(gameConfig.CONFIG.casino.keno.minBet || DEFAULT_MIN_BET);
  const max = Number(gameConfig.CONFIG.casino.keno.maxBet || DEFAULT_MAX_BET);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

function drawNumbers() {
  const nums = Array.from({ length: NUMBER_MAX }, (_, index) => index + 1);
  for (let i = nums.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [nums[i], nums[j]] = [nums[j], nums[i]];
  }
  return nums.slice(0, DRAW_COUNT);
}

function quickPick(count = 10) {
  const nums = Array.from({ length: NUMBER_MAX }, (_, index) => index + 1);
  for (let i = nums.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [nums[i], nums[j]] = [nums[j], nums[i]];
  }
  return nums.slice(0, Math.max(1, Math.min(10, Number(count) || 10))).sort((a, b) => a - b);
}

function normalizeTicket(input) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(input) ? input : []) {
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n) || n < NUMBER_MIN || n > NUMBER_MAX || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
    if (out.length >= 10) break;
  }
  return out.sort((a, b) => a - b);
}

function countHits(ticket, drawn) {
  const drawnSet = new Set(drawn);
  return ticket.reduce((hits, n) => hits + (drawnSet.has(n) ? 1 : 0), 0);
}

function classicMultiplier(picks, hits) {
  return Number(PAYOUTS?.[String(picks)]?.[String(hits)] || 0);
}

function outcome(heads, tails) {
  if (heads >= 11) return "heads";
  if (tails >= 11) return "tails";
  return "draw";
}

async function ensureSchema() {
  await appLinking.ensureSchema();
}

async function assertPlayable(ctx) {
  if (!ctx?.profileId || !ctx.guildId || !ctx.discordUserId) {
    return fail(401, "Linked Discord profile is required.");
  }
  const jail = await pool.query(
    `SELECT jailed_until FROM jail WHERE guild_id=$1 AND user_id=$2 AND jailed_until > NOW() LIMIT 1`,
    [ctx.guildId, ctx.discordUserId]
  );
  if (jail.rows?.[0]) return fail(403, "You cannot play Keno while jailed.");
  return { ok: true };
}

async function recordCasinoProgress(guildId, userId, { played = 0, wins = 0, profit = 0 } = {}) {
  try {
    if (played) await contracts.recordProgress({ guildId, userId, metric: "casino_games_played", amount: played });
    if (wins) await contracts.recordProgress({ guildId, userId, metric: "casino_wins", amount: wins });
    if (profit > 0) await contracts.recordProgress({ guildId, userId, metric: "casino_profit", amount: Math.floor(profit) });
  } catch {}
}

async function playDraw(ctx, body = {}) {
  await ensureSchema();
  const playable = await assertPlayable(ctx);
  if (!playable.ok) return playable;

  const amount = parseAmount(body.amount);
  if (!amount) {
    const min = Number(gameConfig.CONFIG.casino.keno.minBet || DEFAULT_MIN_BET);
    const max = Number(gameConfig.CONFIG.casino.keno.maxBet || DEFAULT_MAX_BET);
    return fail(400, `Bet must be between ${min} and ${max}.`);
  }

  const type = normalizeType(body.type);
  if (!["heads", "tails", "draw", "quickpick"].includes(type)) {
    return fail(400, "Keno type must be heads, tails, draw, or quickpick.");
  }

  let ticket = [];
  if (type === "quickpick") {
    ticket = normalizeTicket(body.ticket);
    if (!ticket.length) ticket = quickPick(10);
    if (ticket.length < 1 || ticket.length > 10) return fail(400, "Keno ticket must contain 1-10 numbers.");
  }

  const debit = await economy.tryDebitUser(ctx.guildId, ctx.discordUserId, amount, "keno_bet", {
    game: "keno",
    type,
    ticket,
    source: "echo_app",
  });
  if (!debit?.ok) return fail(402, "Not enough wallet funds for that Keno bet.");

  await economy.addServerBank(ctx.guildId, amount, "keno_bet_bank", {
    game: "keno",
    type,
    ticket,
    source: "echo_app",
    userId: ctx.discordUserId,
  });

  const drawn = drawNumbers();
  const heads = drawn.filter((n) => n <= 40).length;
  const tails = DRAW_COUNT - heads;
  const htdOutcome = outcome(heads, tails);

  let hits = 0;
  let multiplier = 0;
  let won = false;
  if (type === "quickpick") {
    hits = countHits(ticket, drawn);
    multiplier = classicMultiplier(ticket.length, hits);
    won = multiplier > 0;
  } else {
    won = type === htdOutcome;
    multiplier = won ? Number(HTD_PAYOUTS[type] || 0) : 0;
  }

  const payout = multiplier > 0 ? Math.floor(amount * multiplier) : 0;
  let paid = 0;
  if (payout > 0) {
    const payment = await bankPayoutWithEffects({
      guildId: ctx.guildId,
      userId: ctx.discordUserId,
      amount: payout,
      type: "keno_win",
      meta: { game: "keno", type, ticket, drawn, heads, tails, hits, multiplier, source: "echo_app" },
      activityEffects: ACTIVITY_EFFECTS,
      awardSource: "keno",
    });
    paid = Number(payment?.creditedAmount || payment?.finalAmount || payout);
  } else {
    await handleTriggeredEffectEvent({
      guildId: ctx.guildId,
      userId: ctx.discordUserId,
      eventKey: "casino_loss",
      context: { source: "keno", refundAmount: amount },
    }).catch(() => null);
  }

  const profit = paid - amount;
  await recordCasinoProgress(ctx.guildId, ctx.discordUserId, {
    played: 1,
    wins: paid > amount ? 1 : 0,
    profit: Math.max(0, profit),
  });

  const message = paid > 0
    ? `Keno paid ${paid.toLocaleString()}. ${heads} heads, ${tails} tails.`
    : `Keno missed. ${heads} heads, ${tails} tails.`;

  return {
    ok: true,
    body: {
      status: "settled",
      amount,
      type,
      drawn,
      heads,
      tails,
      hits,
      ticket,
      payout: paid,
      multiplier,
      won: paid > 0,
      message,
      profile: await appLinking.buildProfileSnapshot(ctx.profileId),
    },
  };
}

module.exports = {
  ensureSchema,
  playDraw,
};
