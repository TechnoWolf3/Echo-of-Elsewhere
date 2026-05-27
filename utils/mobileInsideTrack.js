const crypto = require("crypto");
const { pool } = require("./db");
const appLinking = require("./appLinking");
const contracts = require("./contracts");
const config = require("../data/games/casino/insideTrackConfig");
const engine = require("./games/insideTrackEngine");
const gameConfig = require("./gameConfig");

const BETTING_MS = gameConfig.CONFIG.casino.insideTrack.mobileTimingSeconds.betting * 1000;
const RACING_MS = gameConfig.CONFIG.casino.insideTrack.mobileTimingSeconds.racing * 1000;
const RESULTS_MS = gameConfig.CONFIG.casino.insideTrack.mobileTimingSeconds.results * 1000;
const RACE_TICK_MS = gameConfig.CONFIG.casino.insideTrack.mobileTimingSeconds.tick * 1000;

function requirePool() {
  if (!pool || typeof pool.query !== "function") {
    throw new Error("DATABASE_URL is not configured.");
  }
  return pool;
}

function makeRaceId() {
  return `it_${crypto.randomBytes(10).toString("hex")}`;
}

function makeTicketId() {
  return `itt_${crypto.randomBytes(10).toString("hex")}`;
}

function iso(value) {
  return value ? new Date(value).toISOString() : null;
}

function parseAmount(raw) {
  const amount = Math.floor(Number(raw));
  if (!Number.isFinite(amount)) return null;
  return amount;
}

function publicHorse(horse) {
  return {
    number: Number(horse.number || 0),
    name: horse.name,
    odds: Number(horse.odds || 0),
    placeOdds: engine.payoutMultiplierForBet("place", horse.odds),
    showOdds: engine.payoutMultiplierForBet("show", horse.odds),
    form: horse.form,
    progress: Number(horse.progress || 0),
    velocity: Number(horse.velocity || 0),
  };
}

function publicTicket(row) {
  if (!row) return null;
  return {
    raceId: row.race_id,
    horseNumber: Number(row.horse_number || 0),
    horseName: row.horse_name,
    betType: row.bet_type,
    amount: Number(row.amount || 0),
    feeAmount: Number(row.fee_amount || 0),
    potentialMultiplier: Number(row.payout_multiplier || 0),
    potentialPayout: Number(row.potential_payout || 0),
    status: row.status,
    payout: Number(row.payout || 0),
    profit: Number(row.profit || 0),
  };
}

function publicRace(row, { ticket = null, profile = null } = {}) {
  const horses = (row.horses_json || []).map(publicHorse);
  const ordered = [...horses].sort((a, b) => b.progress - a.progress);
  const leader = row.phase === "racing" && ordered[0]
    ? { number: ordered[0].number, name: ordered[0].name }
    : null;
  const finalOrder = (row.final_order_json || []).map((horse, index) => ({
    position: index + 1,
    number: Number(horse.number || 0),
    name: horse.name,
  }));

  const body = {
    configVersion: gameConfig.CONFIG_VERSION,
    raceId: row.id,
    raceNumber: Number(row.race_number || 0),
    phase: row.phase,
    raceName: row.race_name,
    type: row.type,
    isMajor: Boolean(row.is_major),
    trackCondition: row.track_condition_json,
    bettingClosesAt: iso(row.betting_closes_at),
    raceStartsAt: iso(row.race_starts_at),
    raceEndsAt: iso(row.race_ends_at),
    nextRaceAt: iso(row.next_race_at),
    horses,
    leader,
    commentary: row.commentary_json || [],
    myTicket: publicTicket(ticket),
    profile,
  };

  if (finalOrder.length) body.finalOrder = finalOrder;
  return body;
}

async function ensureSchema() {
  await appLinking.ensureSchema();
  const db = requirePool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS casino_inside_track_races (
      id TEXT PRIMARY KEY,
      race_number BIGINT NOT NULL UNIQUE,
      race_name TEXT NOT NULL,
      type TEXT NOT NULL,
      is_major BOOLEAN NOT NULL DEFAULT FALSE,
      phase TEXT NOT NULL DEFAULT 'betting',
      track_condition_json JSONB NOT NULL,
      horses_json JSONB NOT NULL,
      commentary_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      final_order_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      betting_closes_at TIMESTAMPTZ NOT NULL,
      race_starts_at TIMESTAMPTZ NOT NULL,
      race_ends_at TIMESTAMPTZ NOT NULL,
      next_race_at TIMESTAMPTZ NOT NULL,
      last_tick_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at TIMESTAMPTZ NULL
    );

    ALTER TABLE casino_inside_track_races ADD COLUMN IF NOT EXISTS last_tick_at TIMESTAMPTZ NULL;

    CREATE INDEX IF NOT EXISTS idx_citr_phase_next
    ON casino_inside_track_races (phase, next_race_at);

    CREATE TABLE IF NOT EXISTS casino_inside_track_tickets (
      id TEXT PRIMARY KEY,
      race_id TEXT NOT NULL REFERENCES casino_inside_track_races(id) ON DELETE CASCADE,
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      horse_number INT NOT NULL,
      horse_name TEXT NOT NULL,
      bet_type TEXT NOT NULL,
      amount BIGINT NOT NULL,
      fee_amount BIGINT NOT NULL DEFAULT 0,
      odds NUMERIC NOT NULL,
      payout_multiplier NUMERIC NOT NULL,
      potential_payout BIGINT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      payout BIGINT NOT NULL DEFAULT 0,
      profit BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at TIMESTAMPTZ NULL,
      UNIQUE (race_id, profile_id)
    );

    CREATE INDEX IF NOT EXISTS idx_citt_profile_created
    ON casino_inside_track_tickets (profile_id, created_at DESC);
  `);
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
    return { ok: false, statusCode: 403, message: "You cannot bet Inside Track while jailed." };
  }

  return { ok: true };
}

async function createRace(client, raceNumber) {
  const race = engine.generateRace(raceNumber);
  race.durationMs = RACING_MS;
  race.bettingMs = BETTING_MS;
  race.startedAt = null;

  const now = Date.now();
  const bettingClosesAt = new Date(now + BETTING_MS);
  const raceStartsAt = bettingClosesAt;
  const raceEndsAt = new Date(raceStartsAt.getTime() + RACING_MS);
  const nextRaceAt = new Date(raceEndsAt.getTime() + RESULTS_MS);

  const inserted = await client.query(
    `INSERT INTO casino_inside_track_races
     (id, race_number, race_name, type, is_major, phase, track_condition_json, horses_json,
      commentary_json, betting_closes_at, race_starts_at, race_ends_at, next_race_at)
     VALUES ($1, $2, $3, $4, $5, 'betting', $6::jsonb, $7::jsonb, $8::jsonb, $9, $10, $11, $12)
     RETURNING *`,
    [
      makeRaceId(),
      raceNumber,
      race.raceName,
      race.isMajor ? "major" : "standard",
      Boolean(race.isMajor),
      JSON.stringify(race.condition),
      JSON.stringify(race.horses),
      JSON.stringify(race.commentary || []),
      bettingClosesAt,
      raceStartsAt,
      raceEndsAt,
      nextRaceAt,
    ]
  );
  return inserted.rows[0];
}

async function latestRaceForUpdate(client) {
  const res = await client.query(
    `SELECT *
     FROM casino_inside_track_races
     ORDER BY race_number DESC
     LIMIT 1
     FOR UPDATE`
  );
  return res.rows?.[0] || null;
}

async function currentTicket(client, ctx, raceId) {
  if (!ctx?.profileId) return null;
  const res = await client.query(
    `SELECT *
     FROM casino_inside_track_tickets
     WHERE race_id=$1 AND profile_id=$2
     LIMIT 1`,
    [raceId, ctx.profileId]
  );
  return res.rows?.[0] || null;
}

function raceObjectFromRow(row) {
  return {
    raceNumber: Number(row.race_number || 0),
    raceName: row.race_name,
    isMajor: Boolean(row.is_major),
    type: row.is_major ? "Major" : "Standard",
    condition: row.track_condition_json,
    horses: row.horses_json || [],
    durationMs: RACING_MS,
    bettingMs: BETTING_MS,
    startedAt: new Date(row.race_starts_at).getTime(),
    finished: Boolean((row.final_order_json || []).length),
    order: row.final_order_json || [],
    commentary: row.commentary_json || [],
    previousOrder: [],
  };
}

async function tickRaceRow(client, row, now = Date.now()) {
  const lastTickAt = row.last_tick_at ? new Date(row.last_tick_at).getTime() : new Date(row.race_starts_at).getTime();
  const tickCount = Math.floor((now - lastTickAt) / RACE_TICK_MS);
  if (now < new Date(row.race_starts_at).getTime()) return row;
  if (tickCount <= 0 && row.phase === "racing") return row;

  const race = raceObjectFromRow(row);
  let tick = null;
  for (let i = 0; i < tickCount && !race.finished; i += 1) {
    const tickAt = Math.min(now, lastTickAt + (i + 1) * RACE_TICK_MS);
    tick = engine.tickRace(race, tickAt);
  }

  const updated = await client.query(
    `UPDATE casino_inside_track_races
     SET horses_json=$2::jsonb,
         commentary_json=$3::jsonb,
         final_order_json=$4::jsonb,
         last_tick_at=$5,
         updated_at=NOW()
     WHERE id=$1
     RETURNING *`,
    [
      row.id,
      JSON.stringify(race.horses),
      JSON.stringify(race.commentary || tick?.commentary || []),
      JSON.stringify(race.finished ? race.order : []),
      new Date(now),
    ]
  );
  return updated.rows[0];
}

function ticketWins(ticket, order) {
  const idx = order.findIndex((horse) => Number(horse.number) === Number(ticket.horse_number));
  if (idx < 0) return false;
  if (ticket.bet_type === "win") return idx === 0;
  if (ticket.bet_type === "place") return idx <= 1;
  if (ticket.bet_type === "show") return idx <= 2;
  return false;
}

async function recordCasinoProgress(row) {
  try {
    await contracts.recordProgress({ guildId: row.guild_id, userId: row.user_id, metric: "casino_games_played", amount: 1 });
    if (Number(row.profit || 0) > 0) {
      await contracts.recordProgress({ guildId: row.guild_id, userId: row.user_id, metric: "casino_wins", amount: 1 });
      await contracts.recordProgress({ guildId: row.guild_id, userId: row.user_id, metric: "casino_profit", amount: Number(row.profit || 0) });
    }
  } catch {}
}

async function resolveRace(client, row) {
  if (row.phase === "results" && row.resolved_at) return row;

  let raceRow = row;
  if (!(row.final_order_json || []).length) {
    raceRow = await tickRaceRow(client, row, new Date(row.race_ends_at).getTime());
  }

  const finalOrder = (raceRow.final_order_json || []).length
    ? raceRow.final_order_json
    : [...(raceRow.horses_json || [])].sort((a, b) => Number(b.progress || 0) - Number(a.progress || 0));

  const tickets = await client.query(
    `SELECT *
     FROM casino_inside_track_tickets
     WHERE race_id=$1 AND status='active'
     FOR UPDATE`,
    [raceRow.id]
  );

  const progressRows = [];
  for (const ticket of tickets.rows) {
    const won = ticketWins(ticket, finalOrder);
    if (!won) {
      const updated = await client.query(
        `UPDATE casino_inside_track_tickets
         SET status='lost', payout=0, profit=$2, resolved_at=NOW()
         WHERE id=$1
         RETURNING *`,
        [ticket.id, -Number(ticket.amount || 0) - Number(ticket.fee_amount || 0)]
      );
      progressRows.push(updated.rows[0]);
      continue;
    }

    const payoutWanted = Math.floor(Number(ticket.amount || 0) * Number(ticket.payout_multiplier || 0));
    const bank = await client.query(`SELECT bank_balance FROM guilds WHERE guild_id=$1 FOR UPDATE`, [ticket.guild_id]);
    const available = Number(bank.rows?.[0]?.bank_balance || 0);
    const payout = Math.max(0, Math.min(payoutWanted, available));
    const profit = payout - Number(ticket.amount || 0) - Number(ticket.fee_amount || 0);
    const status = payout >= payoutWanted ? "won" : payout > 0 ? "partial" : "payout_failed";

    if (payout > 0) {
      await client.query(`UPDATE guilds SET bank_balance = bank_balance - $2 WHERE guild_id=$1`, [ticket.guild_id, payout]);
      await client.query(
        `UPDATE user_balances SET balance = balance + $3 WHERE guild_id=$1 AND user_id=$2`,
        [ticket.guild_id, ticket.user_id, payout]
      );
      await client.query(
        `INSERT INTO transactions (guild_id, user_id, amount, type, meta)
         VALUES ($1, $2, $3, 'inside_track_win', $4)`,
        [ticket.guild_id, ticket.user_id, payout, {
          raceId: ticket.race_id,
          ticketId: ticket.id,
          betType: ticket.bet_type,
          horse: ticket.horse_name,
          horseNumber: ticket.horse_number,
          odds: Number(ticket.odds || 0),
          payoutMultiplier: Number(ticket.payout_multiplier || 0),
          source: "mobile_inside_track",
        }]
      );
      await client.query(
        `INSERT INTO transactions (guild_id, user_id, amount, type, meta)
         VALUES ($1, NULL, $2, 'inside_track_win_bank', $3)`,
        [ticket.guild_id, -payout, {
          raceId: ticket.race_id,
          ticketId: ticket.id,
          userId: ticket.user_id,
          source: "mobile_inside_track",
        }]
      );
    }

    const updated = await client.query(
      `UPDATE casino_inside_track_tickets
       SET status=$2, payout=$3, profit=$4, resolved_at=NOW()
       WHERE id=$1
       RETURNING *`,
      [ticket.id, status, payout, profit]
    );
    progressRows.push(updated.rows[0]);
  }

  const resolved = await client.query(
    `UPDATE casino_inside_track_races
     SET phase='results',
         final_order_json=$2::jsonb,
         commentary_json=$3::jsonb,
         updated_at=NOW(),
         resolved_at=COALESCE(resolved_at, NOW())
     WHERE id=$1
     RETURNING *`,
    [
      raceRow.id,
      JSON.stringify(finalOrder),
      JSON.stringify([
        `${finalOrder[0]?.name || "The field"} wins Race ${raceRow.race_number}!`,
        "The result is official.",
      ]),
    ]
  );

  return resolved.rows[0];
}

async function reconcileCurrentRace(client) {
  const now = Date.now();
  let row = await latestRaceForUpdate(client);
  if (!row) return createRace(client, 1);

  if (row.phase === "results" && new Date(row.next_race_at).getTime() <= now) {
    return createRace(client, Number(row.race_number || 0) + 1);
  }

  if (row.phase === "betting" && new Date(row.race_starts_at).getTime() <= now) {
    const started = await client.query(
      `UPDATE casino_inside_track_races
       SET phase='racing', last_tick_at=$2, updated_at=NOW()
       WHERE id=$1
       RETURNING *`,
      [row.id, row.race_starts_at]
    );
    row = started.rows[0];
  }

  if (row.phase === "racing") {
    row = await tickRaceRow(client, row, now);
    if (new Date(row.race_ends_at).getTime() <= now || (row.final_order_json || []).length) {
      row = await resolveRace(client, row);
    }
  }

  return row;
}

async function getCurrent(ctx) {
  await ensureSchema();
  const db = requirePool();
  const client = await db.connect();
  let row = null;
  let ticket = null;
  try {
    await client.query("BEGIN");
    row = await reconcileCurrentRace(client);
    ticket = await currentTicket(client, ctx, row.id);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  return {
    ok: true,
    body: publicRace(row, {
      ticket,
      profile: await appLinking.buildProfileSnapshot(ctx.profileId),
    }),
  };
}

async function getRace(ctx, raceId) {
  await ensureSchema();
  const db = requirePool();
  const client = await db.connect();
  let row = null;
  let ticket = null;
  try {
    await client.query("BEGIN");
    await reconcileCurrentRace(client);
    const res = await client.query(
      `SELECT *
       FROM casino_inside_track_races
       WHERE id=$1
       LIMIT 1`,
      [String(raceId)]
    );
    row = res.rows?.[0] || null;
    if (!row) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 404, message: "Inside Track race not found." };
    }
    ticket = await currentTicket(client, ctx, row.id);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  return {
    ok: true,
    body: publicRace(row, {
      ticket,
      profile: await appLinking.buildProfileSnapshot(ctx.profileId),
    }),
  };
}

async function placeBet(ctx, body) {
  await ensureSchema();
  const amount = parseAmount(body?.amount);
  const betType = String(body?.betType || "").trim().toLowerCase();
  const horseNumber = Number.parseInt(String(body?.horseNumber || ""), 10);
  const raceId = String(body?.raceId || "").trim();

  if (!raceId) return { ok: false, statusCode: 400, message: "raceId is required." };
  if (!["win", "place", "show"].includes(betType)) return { ok: false, statusCode: 400, message: "betType must be win, place, or show." };
  if (!Number.isInteger(horseNumber)) return { ok: false, statusCode: 400, message: "horseNumber is required." };
  if (!amount || amount < config.minBet || amount > config.maxBet) {
    return { ok: false, statusCode: 400, message: `Bet must be between ${config.minBet} and ${config.maxBet}.` };
  }

  const db = requirePool();
  const client = await db.connect();
  let ticket = null;
  try {
    await client.query("BEGIN");
    const playable = await assertPlayableContext(client, ctx);
    if (!playable.ok) {
      await client.query("ROLLBACK");
      return playable;
    }

    const current = await reconcileCurrentRace(client);
    if (current.id !== raceId) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 409, message: "That Inside Track race is no longer current." };
    }
    if (current.phase !== "betting" || new Date(current.betting_closes_at).getTime() <= Date.now()) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 409, message: "Betting is closed for this race." };
    }

    const horse = (current.horses_json || []).find((h) => Number(h.number) === horseNumber);
    if (!horse) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 400, message: "Invalid horse number for this race." };
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
      [ctx.guildId, ctx.discordUserId, amount]
    );
    if (debit.rowCount === 0) {
      await client.query("ROLLBACK");
      return { ok: false, statusCode: 402, message: "Not enough wallet funds for that Inside Track ticket." };
    }

    const multiplier = engine.payoutMultiplierForBet(betType, horse.odds);
    const potentialPayout = Math.floor(amount * multiplier);

    await client.query(`UPDATE guilds SET bank_balance = bank_balance + $2 WHERE guild_id=$1`, [ctx.guildId, amount]);
    await client.query(
      `INSERT INTO transactions (guild_id, user_id, amount, type, meta)
       VALUES ($1, $2, $3, 'inside_track_bet', $4)`,
      [ctx.guildId, ctx.discordUserId, -amount, {
        raceId,
        betType,
        horse: horse.name,
        horseNumber,
        stake: amount,
        feeAmount: 0,
        source: "mobile_inside_track",
      }]
    );
    await client.query(
      `INSERT INTO transactions (guild_id, user_id, amount, type, meta)
       VALUES ($1, NULL, $2, 'inside_track_bet_bank', $3)`,
      [ctx.guildId, amount, {
        raceId,
        betType,
        horse: horse.name,
        horseNumber,
        userId: ctx.discordUserId,
        source: "mobile_inside_track",
      }]
    );

    const inserted = await client.query(
      `INSERT INTO casino_inside_track_tickets
       (id, race_id, profile_id, guild_id, user_id, horse_number, horse_name, bet_type,
        amount, fee_amount, odds, payout_multiplier, potential_payout)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, $10, $11, $12)
       RETURNING *`,
      [
        makeTicketId(),
        raceId,
        ctx.profileId,
        ctx.guildId,
        ctx.discordUserId,
        horseNumber,
        horse.name,
        betType,
        amount,
        Number(horse.odds || 0),
        multiplier,
        potentialPayout,
      ]
    );
    ticket = inserted.rows[0];
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error?.code === "23505") {
      return { ok: false, statusCode: 409, message: "You already have a ticket locked in for this race." };
    }
    throw error;
  } finally {
    client.release();
  }

  return {
    ok: true,
    body: {
      configVersion: gameConfig.CONFIG_VERSION,
      status: "accepted",
      ticket: publicTicket(ticket),
      profile: await appLinking.buildProfileSnapshot(ctx.profileId),
    },
  };
}

module.exports = {
  ensureSchema,
  getCurrent,
  getRace,
  placeBet,
};
