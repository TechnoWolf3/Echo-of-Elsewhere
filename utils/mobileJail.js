const appLinking = require("./appLinking");
const jail = require("./jail");
const { pool } = require("./db");
const config = require("../data/jail/config");
const npcs = require("../data/jail/npcs");

const WORK_KEY = "jail:work";
const ESCAPE_KEY = "jail:escape";

function ok(body) {
  return { ok: true, body };
}

function fail(statusCode, message, extra = {}) {
  return { ok: false, statusCode, message, ...extra };
}

function money(value) {
  return `$${Number(value || 0).toLocaleString("en-AU")}`;
}

function iso(date) {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function remainingSeconds(session) {
  return session?.jailedUntil ? Math.max(0, Math.ceil((session.jailedUntil.getTime() - Date.now()) / 1000)) : 0;
}

async function ensureSchema() {
  await jail.ensureJailSchema();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cooldowns (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      key TEXT NOT NULL,
      next_claim_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (guild_id, user_id, key)
    );
  `);
}

async function getCooldown(guildId, userId, key) {
  await ensureSchema();
  const res = await pool.query(
    `SELECT next_claim_at FROM cooldowns WHERE guild_id=$1 AND user_id=$2 AND key=$3`,
    [String(guildId), String(userId), String(key)]
  );
  const date = res.rows?.[0]?.next_claim_at ? new Date(res.rows[0].next_claim_at) : null;
  if (!date || Number.isNaN(date.getTime()) || date <= new Date()) return null;
  return date;
}

async function setCooldown(guildId, userId, key, seconds) {
  await ensureSchema();
  const next = new Date(Date.now() + Math.max(0, Number(seconds || 0)) * 1000);
  await pool.query(
    `INSERT INTO cooldowns (guild_id, user_id, key, next_claim_at)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (guild_id, user_id, key)
     DO UPDATE SET next_claim_at=EXCLUDED.next_claim_at`,
    [String(guildId), String(userId), String(key), next]
  );
  return next;
}

async function profile(ctx) {
  return appLinking.buildProfileSnapshot(ctx.profileId);
}

async function requireJailed(ctx) {
  await ensureSchema();
  if (!ctx?.guildId || !ctx?.discordUserId) {
    return { error: fail(401, "Discord-linked session required.") };
  }
  const session = await jail.fetchJailSession(ctx.guildId, ctx.discordUserId);
  if (!session) {
    return { error: fail(403, "You are not currently jailed.", { body: { status: "not_jailed", jailed: false, session: null, profile: await profile(ctx) } }) };
  }
  return { session };
}

function itemUseMode(itemId, item) {
  if (itemId === "energy_drink") return "instant_effect";
  if (["guard_snack", "broken_laptop", "fake_id_band", "burner_phone"].includes(itemId)) return "instant_use";
  if (item?.type === "escape") return "escape_consumed";
  if (item?.type === "unlock") return "passive_unlock";
  return item?.type || "unknown";
}

function shopItem(itemId, session) {
  const item = config.shop.items[itemId];
  if (!item) return null;
  const owned = Number(session?.items?.[itemId] || 0);
  const mode = itemUseMode(itemId, item);
  return {
    id: itemId,
    name: item.name,
    price: Number(item.price || 0),
    type: item.type,
    description: item.description,
    owned,
    affordable: Number(session?.prisonMoney || 0) >= Number(item.price || 0),
    usable: mode === "instant_effect" || mode === "instant_use" || owned > 0,
    useMode: mode,
    use_mode: mode,
    passive: mode === "passive_unlock",
  };
}

function workActions(session, workCooldown = null) {
  const cooldownUntil = iso(workCooldown);
  return Object.entries(config.work.tasks).map(([id, task]) => ({
    id,
    taskId: id,
    name: task.name,
    label: task.name,
    description: task.description,
    payoutRange: task.payoutRange || config.work.payoutRange,
    reductionSecondsRange: task.reductionSecondsRange || config.work.reductionSecondsRange,
    available: !workCooldown,
    playable: !workCooldown,
    cooldownKey: WORK_KEY,
    cooldownUntil,
    disabledReason: workCooldown ? "Work detail is cooling down." : null,
    status: workCooldown ? "cooldown" : "available",
  }));
}

async function deckProvider(ctx, session) {
  if (session?.items?.deck_of_cards) {
    return { available: true, enabledByUserId: ctx.discordUserId, enabledByDisplayName: ctx.displayName || "You" };
  }

  const res = await pool.query(
    `SELECT j.user_id, COALESCE(li.display_name, p.display_name, j.user_id) AS display_name
     FROM jail j
     LEFT JOIN linked_identities li
       ON li.provider='discord'
      AND li.provider_user_id=j.user_id
     LEFT JOIN profiles p
       ON p.id=li.profile_id
     WHERE j.guild_id=$1
       AND j.jailed_until > NOW()
       AND COALESCE((j.items ->> 'deck_of_cards')::int, 0) > 0
     ORDER BY CASE WHEN j.user_id=$2 THEN 0 ELSE 1 END, j.updated_at DESC
     LIMIT 1`,
    [ctx.guildId, ctx.discordUserId]
  );
  const row = res.rows?.[0];
  if (!row) {
    return { available: false, reason: "Nobody in prison has a deck of cards." };
  }
  return {
    available: true,
    enabledByUserId: String(row.user_id),
    enabledByDisplayName: String(row.display_name || row.user_id),
  };
}

async function serializeSession(ctx, session) {
  if (!session) return null;
  const [workCooldown, escapeCooldown] = await Promise.all([
    getCooldown(ctx.guildId, ctx.discordUserId, WORK_KEY),
    getCooldown(ctx.guildId, ctx.discordUserId, ESCAPE_KEY),
  ]);
  const gambling = await deckProvider(ctx, session);
  return {
    guildId: session.guildId,
    userId: session.userId,
    jailedUntil: iso(session.jailedUntil),
    createdAt: iso(session.createdAt),
    remainingSeconds: remainingSeconds(session),
    originalSentenceSeconds: session.originalSentenceSeconds,
    prisonMoney: session.prisonMoney,
    prison_money: session.prisonMoney,
    sentenceReducedSeconds: session.sentenceReducedSeconds,
    sentence_reduced_seconds: session.sentenceReducedSeconds,
    workCount: session.workCount,
    work_count: session.workCount,
    reductionCapSeconds: session.reductionCapSeconds,
    reduction_cap_seconds: session.reductionCapSeconds,
    maxReducibleRemaining: session.maxReducibleRemaining,
    max_reducible_remaining: session.maxReducibleRemaining,
    items: session.items || {},
    effects: session.effects || {},
    escapeAttempts: session.escapeAttempts,
    escape_attempts: session.escapeAttempts,
    lastEventAt: iso(session.lastEventAt),
    bailCost: jail.getBailCost(session),
    bail_cost: jail.getBailCost(session),
    cooldowns: {
      work: workCooldown ? iso(workCooldown) : null,
      escape: escapeCooldown ? iso(escapeCooldown) : null,
    },
    workActions: workActions(session, workCooldown),
    work_actions: workActions(session, workCooldown),
    gambling,
  };
}

async function overview(ctx) {
  const gate = await requireJailed(ctx);
  if (gate.error) return gate.error;
  const session = await serializeSession(ctx, gate.session);
  return ok({
    status: "active",
    jailed: true,
    session,
    profile: await profile(ctx),
    message: "Jail session loaded.",
  });
}

function resolveWorkOutcome(taskId, body = {}) {
  const choice = String(body.choice || body.choiceId || body.optionId || "").toLowerCase();
  if (body.success === true || body.success === false) return { success: Boolean(body.success) };

  if (taskId === "workshop") {
    const clean = choice.replace(/[^a-z>]/g, "");
    if (clean.includes("bolt") && clean.includes("sand") && clean.includes("paint") && clean.includes("inspect")) {
      return { success: clean.indexOf("bolt") < clean.indexOf("sand") && clean.indexOf("sand") < clean.indexOf("paint") && clean.indexOf("paint") < clean.indexOf("inspect") };
    }
  }

  const chances = {
    kitchen: 0.78,
    laundry: 0.78,
    cells: 0.75,
    supply: 0.72,
    workshop: 0.8,
    yard: 0.72,
  };
  return { success: Math.random() < Number(chances[taskId] || 0.75) };
}

async function work(ctx, body = {}) {
  const gate = await requireJailed(ctx);
  if (gate.error) return gate.error;
  const taskId = String(body.taskId || body.task_id || body.id || "kitchen").trim();
  const task = config.work.tasks[taskId];
  if (!task) return fail(400, "Unknown jail work task.");

  const cooldown = await getCooldown(ctx.guildId, ctx.discordUserId, WORK_KEY);
  if (cooldown) {
    return fail(429, "Work detail is cooling down.", {
      body: {
        status: "cooldown",
        session: await serializeSession(ctx, gate.session),
        profile: await profile(ctx),
        result: { cooldownUntil: iso(cooldown), cooldownKey: WORK_KEY },
        message: `Work detail is cooling down until ${iso(cooldown)}.`,
      },
    });
  }

  const outcome = resolveWorkOutcome(taskId, body);
  const result = await jail.recordWorkResult(ctx.guildId, ctx.discordUserId, taskId, outcome);
  if (!result.ok) return fail(400, "Could not complete jail work.");
  const cd = await setCooldown(ctx.guildId, ctx.discordUserId, WORK_KEY, result.cooldownSeconds || config.work.baseCooldownSeconds);
  const session = await serializeSession(ctx, result.session);
  const message = outcome.success
    ? `${task.name} completed. You earned ${money(result.payout)} Prison Money and reduced your sentence by ${jail.formatDuration(result.appliedReductionSeconds)}.`
    : `${task.name} went sideways. You earned ${money(result.payout)} Prison Money, but no sentence time came off.`;
  return ok({
    status: "completed",
    session,
    profile: await profile(ctx),
    result: {
      taskId,
      success: outcome.success,
      payout: result.payout,
      sentenceReductionSeconds: result.requestedReductionSeconds,
      appliedReductionSeconds: result.appliedReductionSeconds,
      reductionCapped: result.reductionCapped,
      cooldownSeconds: result.cooldownSeconds,
      cooldownUntil: iso(cd),
      diminishing: result.diminishing,
    },
    message,
  });
}

async function escape(ctx, body = {}) {
  const gate = await requireJailed(ctx);
  if (gate.error) return gate.error;
  const cooldown = await getCooldown(ctx.guildId, ctx.discordUserId, ESCAPE_KEY);
  if (cooldown) {
    return fail(429, "Escape attempt is cooling down.", {
      body: {
        status: "cooldown",
        session: await serializeSession(ctx, gate.session),
        profile: await profile(ctx),
        result: { cooldownUntil: iso(cooldown), cooldownKey: ESCAPE_KEY },
        message: `Escape attempt is cooling down until ${iso(cooldown)}.`,
      },
    });
  }
  const result = await jail.attemptEscape(ctx.guildId, ctx.discordUserId, { route: body.route || body.choice || "quiet" });
  if (!result.ok) return fail(400, "Could not attempt escape.");
  await setCooldown(ctx.guildId, ctx.discordUserId, ESCAPE_KEY, config.escape.cooldownSeconds);
  const prof = await profile(ctx);
  if (result.success) {
    return ok({
      status: "escaped",
      session: null,
      profile: prof,
      result: {
        success: true,
        chance: result.chance,
        route: result.route,
        consumed: result.consumed || [],
        convertedMoney: result.released?.convertedMoney || 0,
      },
      message: `Escape succeeded via ${result.route}. Normal Echo life is back, technically.`,
    });
  }
  return ok({
    status: "failed",
    session: await serializeSession(ctx, result.session),
    profile: prof,
    result: {
      success: false,
      chance: result.chance,
      route: result.route,
      consumed: result.consumed || [],
      extraMinutes: result.extraMinutes,
      fine: result.fine,
      finePaid: result.finePaid,
    },
    message: `Escape failed. ${result.extraMinutes} minutes were added and ${money(result.finePaid)} was taken from your wallet.`,
  });
}

async function bail(ctx) {
  const gate = await requireJailed(ctx);
  if (gate.error) return gate.error;
  const result = await jail.payBail(ctx.guildId, ctx.discordUserId);
  if (!result.ok) {
    if (result.reason === "insufficient_wallet") {
      return fail(400, "Not enough wallet cash for bail.", {
        body: {
          status: "insufficient_wallet",
          session: await serializeSession(ctx, result.session || gate.session),
          profile: await profile(ctx),
          result: { bailCost: result.cost },
          message: `You need ${money(result.cost)} wallet cash for bail.`,
        },
      });
    }
    return fail(400, "Could not pay bail.");
  }
  return ok({
    status: "released",
    session: null,
    profile: await profile(ctx),
    result: {
      bailCost: result.cost,
      convertedMoney: result.released?.convertedMoney || 0,
    },
    message: `Bail paid: ${money(result.cost)}. You are released.${result.released?.message ? ` ${result.released.message}` : ""}`,
  });
}

async function shop(ctx) {
  const gate = await requireJailed(ctx);
  if (gate.error) return gate.error;
  const session = gate.session;
  return ok({
    status: "loaded",
    prisonMoney: session.prisonMoney,
    prison_money: session.prisonMoney,
    items: Object.keys(config.shop.items).map((itemId) => shopItem(itemId, session)).filter(Boolean),
    ownedItems: session.items || {},
    owned_items: session.items || {},
    effects: session.effects || {},
    session: await serializeSession(ctx, session),
    profile: await profile(ctx),
    message: "Contraband shop loaded.",
  });
}

async function buy(ctx, body = {}) {
  const gate = await requireJailed(ctx);
  if (gate.error) return gate.error;
  const itemId = String(body.itemId || body.item_id || body.id || "").trim();
  if (!itemId) return fail(400, "itemId is required.");
  const result = await jail.buyContraband(ctx.guildId, ctx.discordUserId, itemId);
  if (!result.ok) {
    const status = result.reason === "insufficient_prison_money" ? 400 : result.reason === "unknown_item" ? 404 : 400;
    return fail(status, result.reason === "insufficient_prison_money" ? "Not enough Prison Money." : "Contraband item unavailable.");
  }
  return ok({
    status: "purchased",
    session: await serializeSession(ctx, result.session),
    profile: await profile(ctx),
    result: {
      itemId,
      item: shopItem(itemId, result.session),
      useMode: itemUseMode(itemId, result.item),
    },
    message: String(result.message || `Bought ${result.item?.name || itemId}.`).replace(/\*\*/g, ""),
  });
}

async function use(ctx, body = {}) {
  const gate = await requireJailed(ctx);
  if (gate.error) return gate.error;
  const itemId = String(body.itemId || body.item_id || body.id || "").trim();
  const item = config.shop.items[itemId];
  if (!item) return fail(404, "Contraband item unavailable.");
  const mode = itemUseMode(itemId, item);
  const session = gate.session;
  if (mode === "instant_use" || mode === "instant_effect") {
    return ok({
      status: "info",
      session: await serializeSession(ctx, session),
      profile: await profile(ctx),
      result: { itemId, useMode: mode },
      message: `${item.name} is used immediately when bought from the contraband shop.`,
    });
  }
  if (mode === "escape_consumed") {
    return ok({
      status: "info",
      session: await serializeSession(ctx, session),
      profile: await profile(ctx),
      result: { itemId, useMode: mode, owned: Number(session.items?.[itemId] || 0) },
      message: `${item.name} is consumed automatically when you attempt an escape.`,
    });
  }
  return ok({
    status: "info",
    session: await serializeSession(ctx, session),
    profile: await profile(ctx),
    result: { itemId, useMode: mode, owned: Number(session.items?.[itemId] || 0) },
    message: `${item.name} is a passive jail-session unlock.`,
  });
}

async function gambleView(ctx) {
  const gate = await requireJailed(ctx);
  if (gate.error) return gate.error;
  const session = gate.session;
  const gambling = await deckProvider(ctx, session);
  return ok({
    status: "loaded",
    available: gambling.available,
    reason: gambling.reason || null,
    enabledBy: gambling.available
      ? { userId: gambling.enabledByUserId, displayName: gambling.enabledByDisplayName }
      : null,
    minBet: config.gambling.minBet,
    maxBet: config.gambling.maxBet,
    games: gambling.available ? [{ id: "high_card", name: "High Card" }] : [],
    npcs: gambling.available ? npcs.map(({ id, name, personality, risk, flavor }) => ({ id, name, personality, risk, flavor })) : [],
    session: await serializeSession(ctx, session),
    profile: await profile(ctx),
    message: gambling.available ? "Card table loaded." : "Nobody in prison has a deck of cards.",
  });
}

async function gamble(ctx, body = {}) {
  const gate = await requireJailed(ctx);
  if (gate.error) return gate.error;
  const session = gate.session;
  const gambling = await deckProvider(ctx, session);
  if (!gambling.available) return fail(403, "Nobody in prison has a deck of cards.");
  const npc = npcs.find((entry) => entry.id === String(body.npcId || body.npc_id || "")) || npcs[0];
  const bet = Number(body.bet || body.amount || config.gambling.minBet);
  const result = await jail.gambleNpc(ctx.guildId, ctx.discordUserId, npc, "high_card", bet, {
    allowSharedDeck: Boolean(gambling.available && !session.items?.deck_of_cards),
  });
  if (!result.ok) {
    return fail(400, result.reason === "insufficient_prison_money" ? "Not enough Prison Money for that bet." : "Could not use the card table.");
  }
  const outcome = result.tied ? "push" : result.won ? "win" : "loss";
  return ok({
    status: "resolved",
    session: await serializeSession(ctx, result.session),
    profile: await profile(ctx),
    result: {
      game: "high_card",
      npcId: npc.id,
      npcName: npc.name,
      bet: result.wager,
      wager: result.wager,
      playerRoll: result.playerRoll,
      npcRoll: result.npcRoll,
      outcome,
      delta: result.delta,
    },
    message: outcome === "push"
      ? `Push. You rolled ${result.playerRoll}, ${npc.name} rolled ${result.npcRoll}.`
      : `${outcome === "win" ? "You won" : "You lost"} ${money(Math.abs(result.delta))} Prison Money. You rolled ${result.playerRoll}, ${npc.name} rolled ${result.npcRoll}.`,
  });
}

module.exports = {
  ensureSchema,
  overview,
  work,
  escape,
  bail,
  shop,
  buy,
  use,
  gambleView,
  gamble,
};
