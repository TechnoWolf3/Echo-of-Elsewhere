const { pool } = require("./db");
const config = require("../data/jail/config");

let schemaReady = false;

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function randInt(min, max) {
  const lo = Math.floor(Number(min || 0));
  const hi = Math.floor(Number(max || 0));
  if (hi <= lo) return lo;
  return Math.floor(lo + Math.random() * (hi - lo + 1));
}

function nowDate() {
  return new Date();
}

function toDate(value) {
  if (value instanceof Date) return value;
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeItems(items) {
  const out = parseJson(items, {});
  return out && typeof out === "object" && !Array.isArray(out) ? out : {};
}

function normalizeEffects(effects) {
  const out = parseJson(effects, {});
  return out && typeof out === "object" && !Array.isArray(out) ? out : {};
}

async function ensureJailSchema() {
  if (schemaReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS jail (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      jailed_until TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );

    ALTER TABLE IF EXISTS jail ADD COLUMN IF NOT EXISTS original_sentence_seconds BIGINT NOT NULL DEFAULT 0;
    ALTER TABLE IF EXISTS jail ADD COLUMN IF NOT EXISTS prison_money BIGINT NOT NULL DEFAULT 0;
    ALTER TABLE IF EXISTS jail ADD COLUMN IF NOT EXISTS sentence_reduced_seconds BIGINT NOT NULL DEFAULT 0;
    ALTER TABLE IF EXISTS jail ADD COLUMN IF NOT EXISTS work_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE IF EXISTS jail ADD COLUMN IF NOT EXISTS reduction_cap_seconds BIGINT NOT NULL DEFAULT 0;
    ALTER TABLE IF EXISTS jail ADD COLUMN IF NOT EXISTS items JSONB NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE IF EXISTS jail ADD COLUMN IF NOT EXISTS effects JSONB NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE IF EXISTS jail ADD COLUMN IF NOT EXISTS escape_attempts INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE IF EXISTS jail ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    ALTER TABLE IF EXISTS jail ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    ALTER TABLE IF EXISTS jail ADD COLUMN IF NOT EXISTS last_event_at TIMESTAMPTZ NULL;

    UPDATE jail
    SET original_sentence_seconds = GREATEST(60, CEIL(EXTRACT(EPOCH FROM (jailed_until - NOW()))))::BIGINT
    WHERE original_sentence_seconds IS NULL OR original_sentence_seconds <= 0;

    UPDATE jail
    SET reduction_cap_seconds = CEIL(original_sentence_seconds * ${Number(config.sentence.reductionCapPercent || 0.55)})::BIGINT
    WHERE reduction_cap_seconds IS NULL OR reduction_cap_seconds <= 0;

    CREATE INDEX IF NOT EXISTS idx_jail_jailed_until ON jail (jailed_until);
  `);
  schemaReady = true;
}

function normalizeSession(row) {
  if (!row) return null;
  const jailedUntil = toDate(row.jailed_until);
  const createdAt = toDate(row.created_at);
  const originalSeconds = Number(row.original_sentence_seconds || 0);
  const reductionCapSeconds = Number(row.reduction_cap_seconds || Math.ceil(originalSeconds * config.sentence.reductionCapPercent));
  const reducedSeconds = Number(row.sentence_reduced_seconds || 0);
  return {
    guildId: String(row.guild_id),
    userId: String(row.user_id),
    jailedUntil,
    createdAt,
    originalSentenceSeconds: originalSeconds,
    prisonMoney: Number(row.prison_money || 0),
    sentenceReducedSeconds: reducedSeconds,
    workCount: Number(row.work_count || 0),
    reductionCapSeconds,
    maxReducibleRemaining: Math.max(0, reductionCapSeconds - reducedSeconds),
    items: normalizeItems(row.items),
    effects: normalizeEffects(row.effects),
    escapeAttempts: Number(row.escape_attempts || 0),
    lastEventAt: toDate(row.last_event_at),
  };
}

async function fetchJailSession(guildId, userId, { releaseExpired = true } = {}) {
  await ensureJailSchema();
  const { rows } = await pool.query(
    `SELECT * FROM jail WHERE guild_id=$1 AND user_id=$2`,
    [String(guildId), String(userId)]
  );
  const session = normalizeSession(rows[0]);
  if (!session) return null;
  if (session.jailedUntil && session.jailedUntil <= nowDate()) {
    if (releaseExpired) await releaseJail(guildId, userId, "served");
    return null;
  }
  return session;
}

async function countOtherJailedPlayers(guildId, userId) {
  await ensureJailSchema();
  const res = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM jail
     WHERE guild_id=$1
       AND user_id <> $2
       AND jailed_until > NOW()`,
    [String(guildId), String(userId)]
  );
  return Number(res.rows?.[0]?.count || 0);
}

async function getJailRelease(guildId, userId) {
  const session = await fetchJailSession(guildId, userId);
  return session?.jailedUntil || null;
}

function secondsFromInput(minutesOrReleaseAt) {
  if (minutesOrReleaseAt instanceof Date || typeof minutesOrReleaseAt === "string") {
    const releaseAt = toDate(minutesOrReleaseAt);
    if (!releaseAt) throw new Error(`setJail: invalid release date "${minutesOrReleaseAt}"`);
    return Math.max(0, Math.ceil((releaseAt.getTime() - Date.now()) / 1000));
  }

  const minutes = Number(minutesOrReleaseAt);
  if (!Number.isFinite(minutes) || minutes < 0) {
    throw new Error(`setJail: invalid minutes value "${minutesOrReleaseAt}"`);
  }
  return Math.ceil(minutes * 60);
}

async function setJail(guildId, userId, minutesOrReleaseAt, options = {}) {
  await ensureJailSchema();
  const sentenceSeconds = Math.max(60, secondsFromInput(minutesOrReleaseAt));
  const jailedUntil = new Date(Date.now() + sentenceSeconds * 1000);
  const capPercent = Number(options.reductionCapPercent ?? config.sentence.reductionCapPercent);
  const reductionCapSeconds = Math.ceil(sentenceSeconds * clamp(capPercent, 0, 0.9));

  await pool.query(
    `
    INSERT INTO jail (
      guild_id, user_id, jailed_until, original_sentence_seconds, prison_money,
      sentence_reduced_seconds, work_count, reduction_cap_seconds, items, effects,
      escape_attempts, created_at, updated_at
    )
    VALUES ($1,$2,$3,$4,0,0,0,$5,'{}'::jsonb,$6::jsonb,0,NOW(),NOW())
    ON CONFLICT (guild_id, user_id)
    DO UPDATE SET
      jailed_until = EXCLUDED.jailed_until,
      original_sentence_seconds = EXCLUDED.original_sentence_seconds,
      prison_money = 0,
      sentence_reduced_seconds = 0,
      work_count = 0,
      reduction_cap_seconds = EXCLUDED.reduction_cap_seconds,
      items = '{}'::jsonb,
      effects = EXCLUDED.effects,
      escape_attempts = 0,
      created_at = NOW(),
      updated_at = NOW(),
      last_event_at = NULL
    `,
    [
      String(guildId),
      String(userId),
      jailedUntil,
      sentenceSeconds,
      reductionCapSeconds,
      JSON.stringify(options.effects || {}),
    ]
  );

  return jailedUntil;
}

async function releaseJail(guildId, userId, reason = "released") {
  await ensureJailSchema();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await client.query(
      `DELETE FROM jail WHERE guild_id=$1 AND user_id=$2 RETURNING *`,
      [String(guildId), String(userId)]
    );
    const row = res.rows?.[0];
    if (!row) {
      await client.query("COMMIT");
      return { ok: false, convertedMoney: 0 };
    }

    const convertedMoney = Math.max(0, Number(row.prison_money || 0));
    if (convertedMoney > 0) {
      await client.query(
        `INSERT INTO user_balances (guild_id, user_id)
         VALUES ($1,$2)
         ON CONFLICT (guild_id, user_id) DO NOTHING`,
        [String(guildId), String(userId)]
      );
      await client.query(
        `UPDATE user_balances SET balance = balance + $3::bigint WHERE guild_id=$1 AND user_id=$2`,
        [String(guildId), String(userId), convertedMoney]
      );
      await client.query(
        `INSERT INTO transactions (guild_id, user_id, amount, type, meta)
         VALUES ($1,$2,$3,$4,$5::jsonb)`,
        [
          String(guildId),
          String(userId),
          convertedMoney,
          "jail_prison_money_conversion",
          JSON.stringify({ reason, balance_type: "wallet" }),
        ]
      );
    }

    await client.query("COMMIT");
    return {
      ok: true,
      convertedMoney,
      session: normalizeSession(row),
      message: convertedMoney > 0
        ? `Your remaining Prison Money was converted into $${convertedMoney.toLocaleString("en-AU")} wallet cash.`
        : null,
    };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

function getDiminishing(workCount) {
  const tiers = config.work.diminishingReturns || [];
  return tiers.reduce((best, tier) => {
    return Number(workCount || 0) >= Number(tier.afterTasks || 0) ? tier : best;
  }, tiers[0] || { payoutMultiplier: 1, reductionMultiplier: 1 });
}

function getCooldownSeconds(session) {
  const effects = session?.effects || {};
  let mult = 1;
  if (effects.energy_drink?.workUses > 0) mult *= Number(effects.energy_drink.cooldownMultiplier || 0.6);
  if (effects.quiet_cellblock) mult *= Number(config.effects.blessings.quiet_cellblock.cooldownMultiplier || 0.85);
  if (effects.marked_inmate) mult *= Number(config.effects.curses.marked_inmate.cooldownMultiplier || 1.2);
  const extra = Math.max(0, Number(session?.workCount || 0) - Number(config.work.heavyWorkCount || 16)) * 5;
  return clamp(Math.round(Number(config.work.baseCooldownSeconds || 75) * mult + extra), 20, Number(config.work.maxCooldownSeconds || 180));
}

function getReductionMultiplier(session) {
  const effects = session?.effects || {};
  let mult = 1;
  if (effects.good_behaviour) mult *= Number(config.effects.blessings.good_behaviour.reductionMultiplier || 1.12);
  if (effects.strict_warden) mult *= Number(config.effects.curses.strict_warden.reductionMultiplier || 0.85);
  return mult;
}

async function addPrisonMoney(guildId, userId, amount, meta = {}) {
  await ensureJailSchema();
  const delta = Math.floor(Number(amount || 0));
  if (!Number.isFinite(delta) || delta === 0) return fetchJailSession(guildId, userId);
  const res = await pool.query(
    `UPDATE jail
     SET prison_money = GREATEST(0, prison_money + $3::bigint), updated_at=NOW()
     WHERE guild_id=$1 AND user_id=$2
     RETURNING *`,
    [String(guildId), String(userId), delta]
  );
  return normalizeSession(res.rows?.[0]);
}

async function reduceSentence(guildId, userId, seconds, source = "jail_reduction") {
  await ensureJailSchema();
  const current = await fetchJailSession(guildId, userId);
  if (!current) return { ok: false, reason: "not_jailed", appliedSeconds: 0 };

  const requested = Math.max(0, Math.floor(Number(seconds || 0)));
  const capRemaining = Math.max(0, current.reductionCapSeconds - current.sentenceReducedSeconds);
  const remainingSeconds = Math.max(0, Math.ceil((current.jailedUntil.getTime() - Date.now()) / 1000));
  const appliedSeconds = Math.min(requested, capRemaining, Math.max(0, remainingSeconds - 1));
  if (appliedSeconds <= 0) {
    return { ok: false, reason: "cap_reached", appliedSeconds: 0, session: current };
  }

  const res = await pool.query(
    `UPDATE jail
     SET jailed_until = jailed_until - ($3::bigint || ' seconds')::interval,
         sentence_reduced_seconds = sentence_reduced_seconds + $3::bigint,
         updated_at = NOW()
     WHERE guild_id=$1 AND user_id=$2
     RETURNING *`,
    [String(guildId), String(userId), appliedSeconds]
  );
  return { ok: true, appliedSeconds, source, session: normalizeSession(res.rows?.[0]) };
}

async function recordWorkResult(guildId, userId, taskId, outcome) {
  await ensureJailSchema();
  const session = await fetchJailSession(guildId, userId);
  if (!session) return { ok: false, reason: "not_jailed" };

  const taskCfg = config.work.tasks[taskId] || {};
  const dim = getDiminishing(session.workCount);
  const payoutRange = outcome.success ? (taskCfg.payoutRange || config.work.payoutRange) : config.work.failurePayoutRange;
  let payout = randInt(payoutRange[0], payoutRange[1]);
  if (session.items.contraband_radio) payout = Math.round(payout * 1.1);
  payout = Math.max(0, Math.round(payout * Number(dim.payoutMultiplier || 1) * Number(outcome.payoutMultiplier || 1)));

  const redRange = taskCfg.reductionSecondsRange || config.work.reductionSecondsRange;
  let reduction = outcome.success ? randInt(redRange[0], redRange[1]) : 0;
  reduction = Math.round(reduction * Number(dim.reductionMultiplier || 1) * getReductionMultiplier(session) * Number(outcome.reductionMultiplier || 1));

  let effects = { ...session.effects };
  if (effects.energy_drink?.workUses > 0) {
    const nextUses = Number(effects.energy_drink.workUses || 0) - 1;
    if (nextUses > 0) effects.energy_drink = { ...effects.energy_drink, workUses: nextUses };
    else delete effects.energy_drink;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const updated = await client.query(
      `UPDATE jail
       SET prison_money = prison_money + $3::bigint,
           work_count = work_count + 1,
           effects = $4::jsonb,
           updated_at = NOW()
       WHERE guild_id=$1 AND user_id=$2
       RETURNING *`,
      [String(guildId), String(userId), payout, JSON.stringify(effects)]
    );
    await client.query("COMMIT");
    const afterMoney = normalizeSession(updated.rows?.[0]);
    const reductionResult = reduction > 0
      ? await reduceSentence(guildId, userId, reduction, `work:${taskId}`)
      : { ok: false, appliedSeconds: 0, reason: "failed_task", session: afterMoney };
    return {
      ok: true,
      payout,
      requestedReductionSeconds: reduction,
      appliedReductionSeconds: Number(reductionResult.appliedSeconds || 0),
      reductionCapped: reduction > 0 && Number(reductionResult.appliedSeconds || 0) < reduction,
      cooldownSeconds: getCooldownSeconds(reductionResult.session || afterMoney),
      session: reductionResult.session || afterMoney,
      diminishing: dim,
    };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function buyContraband(guildId, userId, itemId) {
  await ensureJailSchema();
  const item = config.shop.items[itemId];
  if (!item) return { ok: false, reason: "unknown_item" };
  const session = await fetchJailSession(guildId, userId);
  if (!session) return { ok: false, reason: "not_jailed" };
  if (session.prisonMoney < Number(item.price || 0)) {
    return { ok: false, reason: "insufficient_prison_money", item, session };
  }

  const items = { ...session.items };
  const effects = { ...session.effects };
  let message = `Bought **${item.name}** for $${Number(item.price).toLocaleString("en-AU")} Prison Money.`;

  if (item.type === "unlock" || item.type === "escape") {
    items[itemId] = Number(items[itemId] || 0) + 1;
  } else if (itemId === "energy_drink") {
    effects.energy_drink = { ...(item.effect || {}) };
  } else if (itemId === "broken_laptop") {
    const seconds = randInt(120, 300);
    const result = await reduceSentence(guildId, userId, seconds, "contraband:broken_laptop");
    message += result.appliedSeconds > 0
      ? ` The report glitched: **${formatDuration(result.appliedSeconds)}** removed.`
      : " The paperwork bounced. Your reduction cap is already spent.";
  } else if (itemId === "fake_id_band") {
    const result = await reduceSentence(guildId, userId, randInt(90, 180), "contraband:fake_id_band");
    message += result.appliedSeconds > 0
      ? ` The band fooled someone: **${formatDuration(result.appliedSeconds)}** removed.`
      : " Nobody bought it. Your reduction cap is already spent.";
  } else if (itemId === "guard_snack") {
    const roll = Math.random();
    if (roll < 0.45) {
      const result = await reduceSentence(guildId, userId, randInt(45, 120), "contraband:guard_snack");
      message += result.appliedSeconds > 0 ? ` The guard looked away: **${formatDuration(result.appliedSeconds)}** removed.` : " The guard shrugged. Cap reached.";
    } else if (roll < 0.75) {
      message += " It was confiscated immediately. Painfully educational.";
    } else {
      const bonus = randInt(25, 75);
      await addPrisonMoney(guildId, userId, bonus, { source: "guard_snack" });
      message += ` The guard kicked back **$${bonus}** Prison Money. Weird economy.`;
    }
  } else if (itemId === "burner_phone") {
    const roll = Math.random();
    if (roll < 0.35) {
      const result = await reduceSentence(guildId, userId, randInt(60, 180), "contraband:burner_phone");
      message += result.appliedSeconds > 0 ? ` A favour landed: **${formatDuration(result.appliedSeconds)}** removed.` : " The favour hit the cap wall.";
    } else if (roll < 0.65) {
      const bonus = randInt(80, 160);
      await addPrisonMoney(guildId, userId, bonus, { source: "burner_phone" });
      message += ` Someone sent **$${bonus}** Prison Money. Nobody asks how.`;
    } else {
      effects.watched_closely = true;
      message += " The call got traced. **Watched Closely** is now active.";
    }
  }

  const res = await pool.query(
    `UPDATE jail
     SET prison_money = GREATEST(0, prison_money - $3::bigint),
         items = $4::jsonb,
         effects = $5::jsonb,
         updated_at = NOW()
     WHERE guild_id=$1 AND user_id=$2
     RETURNING *`,
    [String(guildId), String(userId), Number(item.price || 0), JSON.stringify(items), JSON.stringify(effects)]
  );

  return { ok: true, item, message, session: normalizeSession(res.rows?.[0]) };
}

async function payBail(guildId, userId) {
  await ensureJailSchema();
  const session = await fetchJailSession(guildId, userId);
  if (!session) return { ok: false, reason: "not_jailed" };
  const cost = getBailCost(session);
  const economy = require("./economy");
  const debit = await economy.tryDebitUser(guildId, userId, cost, "jail_bail", {
    originalSentenceSeconds: session.originalSentenceSeconds,
  });
  if (!debit?.ok) return { ok: false, reason: "insufficient_wallet", cost, session };
  const released = await releaseJail(guildId, userId, "bail");
  return { ok: true, cost, released };
}

function getBailCost(session) {
  const originalMinutes = Math.ceil(Number(session.originalSentenceSeconds || 0) / 60);
  let multiplier = 1;
  if (session.effects?.greased_palms) multiplier *= Number(config.effects.blessings.greased_palms.bailMultiplier || 0.9);
  if (session.effects?.bad_paperwork) multiplier *= Number(config.effects.curses.bad_paperwork.bailMultiplier || 1.15);
  return Math.max(
    Number(config.bail.minimumCost || 0),
    Math.ceil(originalMinutes * Number(config.bail.baseCostPerMinute || 900) * multiplier)
  );
}

async function attemptEscape(guildId, userId, choices = {}) {
  await ensureJailSchema();
  const session = await fetchJailSession(guildId, userId);
  if (!session) return { ok: false, reason: "not_jailed" };

  const route = String(choices.route || "quiet");
  const routes = {
    quiet: { label: "Quiet Route", chance: 0.04, failMult: 0.9 },
    quick: { label: "Quick Route", chance: 0.0, failMult: 1.0 },
    reckless: { label: "Reckless Route", chance: 0.08, failMult: 1.25 },
  };
  const routeCfg = routes[route] || routes.quiet;
  const items = { ...session.items };
  let itemBonus = 0;
  let failMult = routeCfg.failMult;
  const consumed = [];

  for (const itemId of ["loose_vent_cover", "escape_kit"]) {
    if (Number(items[itemId] || 0) > 0) {
      const item = config.shop.items[itemId];
      itemBonus += Number(item.escapeBonus || 0);
      failMult *= Number(item.failurePenaltyMultiplier || 1);
      items[itemId] = Number(items[itemId] || 0) - 1;
      if (items[itemId] <= 0) delete items[itemId];
      consumed.push(item.name);
      break;
    }
  }

  let chance = Number(config.escape.baseChance || 0.18) + routeCfg.chance + itemBonus;
  chance -= Number(session.escapeAttempts || 0) * Number(config.escape.attemptsPenalty || 0.04);
  if (session.effects?.watched_closely) chance -= Number(config.effects.curses.watched_closely.escapePenalty || 0.08);
  chance = clamp(chance, 0.03, Number(config.escape.maxChance || 0.65));

  const success = Math.random() < chance;
  const crimeHeat = require("./crimeHeat");

  if (success) {
    await crimeHeat.setCrimeHeat(guildId, userId, Number(config.escape.heatOnSuccess || 45), 180).catch(() => {});
    const released = await releaseJail(guildId, userId, "escape");
    return { ok: true, success: true, chance, route: routeCfg.label, consumed, released };
  }

  const extraMinutes = Math.ceil(randInt(config.escape.failureExtraMinutesRange[0], config.escape.failureExtraMinutesRange[1]) * failMult);
  const fine = Math.ceil(randInt(config.escape.failureFineRange[0], config.escape.failureFineRange[1]) * failMult);
  const economy = require("./economy");
  const wallet = await economy.getWalletBalance(guildId, userId).catch(() => 0);
  const taken = Math.min(wallet, fine);
  if (taken > 0) {
    await economy.tryDebitUser(guildId, userId, taken, "jail_escape_fine", { requestedFine: fine }).catch(() => {});
    await economy.addServerBank(guildId, taken, "jail_escape_fine_bank", { userId }).catch(() => {});
  }
  await crimeHeat.setCrimeHeat(guildId, userId, Number(config.escape.heatOnFailure || 75), 240).catch(() => {});

  const res = await pool.query(
    `UPDATE jail
     SET jailed_until = jailed_until + ($3::bigint || ' minutes')::interval,
         original_sentence_seconds = original_sentence_seconds + ($3::bigint * 60),
         reduction_cap_seconds = reduction_cap_seconds + CEIL($3::numeric * 60 * $6::numeric)::BIGINT,
         items = $4::jsonb,
         escape_attempts = escape_attempts + 1,
         updated_at = NOW()
     WHERE guild_id=$1 AND user_id=$2
     RETURNING *`,
    [String(guildId), String(userId), extraMinutes, JSON.stringify(items), fine, Number(config.sentence.reductionCapPercent || 0.55)]
  );

  return {
    ok: true,
    success: false,
    chance,
    route: routeCfg.label,
    consumed,
    extraMinutes,
    fine,
    finePaid: taken,
    session: normalizeSession(res.rows?.[0]),
  };
}

async function gambleNpc(guildId, userId, npc, game, bet, options = {}) {
  await ensureJailSchema();
  const session = await fetchJailSession(guildId, userId);
  if (!session) return { ok: false, reason: "not_jailed" };
  if (!session.items.deck_of_cards && !options.allowSharedDeck) {
    return { ok: false, reason: "needs_deck_or_inmates", session };
  }

  const wager = clamp(Math.floor(Number(bet || 0)), config.gambling.minBet, config.gambling.maxBet);
  if (wager > session.prisonMoney) return { ok: false, reason: "insufficient_prison_money", session };

  const playerRoll = randInt(1, game === "dice" ? 6 : 13);
  let npcRoll = randInt(1, game === "dice" ? 6 : 13);
  if (Math.random() < clamp(Number(npc?.bias || 0) + Number(config.gambling.houseEdgeChance || 0.05), 0, 0.2)) {
    npcRoll = Math.min(game === "dice" ? 6 : 13, npcRoll + 1);
  }

  const won = playerRoll > npcRoll;
  const tied = playerRoll === npcRoll;
  const delta = tied ? 0 : won ? wager : -wager;
  const next = await addPrisonMoney(guildId, userId, delta, { source: "jail_gambling", game, npc: npc?.id });
  return { ok: true, won, tied, wager, delta, playerRoll, npcRoll, session: next };
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds || 0)));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  if (mins <= 0) return `${secs}s`;
  if (secs <= 0) return `${mins}m`;
  return `${mins}m ${secs}s`;
}

async function guardNotJailed(interaction) {
  const jailedUntil = await getJailRelease(interaction.guildId, interaction.user.id);
  if (!jailedUntil) return false;
  const ts = Math.floor(jailedUntil.getTime() / 1000);
  const message = `You are jailed in Echo's finest concrete timeout box until <t:${ts}:R>. Use **/jail** for bail, work detail, contraband, escape, or cards.`;
  try {
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content: message, flags: 64 });
    else await interaction.reply({ content: message, flags: 64 });
  } catch {}
  return true;
}

async function guardNotJailedComponent(interaction) {
  const jailedUntil = await getJailRelease(interaction.guildId, interaction.user.id);
  if (!jailedUntil) return false;
  const ts = Math.floor(jailedUntil.getTime() / 1000);
  try {
    await interaction.reply({
      content: `You are jailed until <t:${ts}:R>. Use **/jail** for prison actions.`,
      flags: 64,
    });
  } catch {}
  return true;
}

module.exports = {
  ensureJailSchema,
  guardNotJailed,
  guardNotJailedComponent,
  setJail,
  getJailRelease,
  countOtherJailedPlayers,
  fetchJailSession,
  releaseJail,
  reduceSentence,
  recordWorkResult,
  addPrisonMoney,
  buyContraband,
  payBail,
  getBailCost,
  attemptEscape,
  gambleNpc,
  getCooldownSeconds,
  formatDuration,
};
