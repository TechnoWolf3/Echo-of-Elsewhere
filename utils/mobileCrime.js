const crypto = require("crypto");
const { pool } = require("./db");
const appLinking = require("./appLinking");
const economy = require("./economy");
const { setJail } = require("./jail");
const crimeHeat = require("./crimeHeat");
const standingService = require("./community/standing");
const { creditUserWithEffects } = require("./effectSystem");

const storeScenarios = require("../data/work/categories/crime/storeRobbery.scenarios");
const heistScenarios = require("../data/work/categories/crime/heist.scenarios");
const scamData = require("../data/work/categories/crime/scamCall.data");

const THEFT_KIT_ITEM_ID = "Crime_Kit";
const SESSION_TTL_MS = {
  store_robbery: 3 * 60 * 1000,
  scam_call: Number(scamData.settings.timeoutMs || 4 * 60 * 1000),
  heist: 6 * 60 * 1000,
  major_heist: 6 * 60 * 1000,
  bribe_officer: 90 * 1000,
  lay_low: 2 * 60 * 1000,
};

const CRIME_KEYS = {
  store_robbery: "crime_store",
  scam_call: "crime_scam",
  heist: "crime_heist",
  major_heist: "crime_heist_major",
  bribe_officer: "crime_bribe_officer",
  lay_low: "crime_lay_low",
  crime_chase: "crime_chase",
  crime_drugs: "crime_drugs",
};

const ACTIONS = [
  { id: "store_robbery", name: "Store Robbery", label: "Store Robbery", description: "Risky grab-and-go.", cooldownKey: CRIME_KEYS.store_robbery, playable: true },
  { id: "scam_call", name: "Scam Call", label: "Scam Call", description: "Manipulate the mark and time your push.", cooldownKey: CRIME_KEYS.scam_call, playable: true },
  { id: "heist", name: "Heist", label: "Heist", description: "Big job, big heat.", cooldownKey: CRIME_KEYS.heist, playable: true },
  { id: "major_heist", name: "Major Heist", label: "Major Heist", description: "High stakes.", cooldownKey: CRIME_KEYS.major_heist, playable: true },
  { id: "bribe_officer", name: "Bribe Officer", label: "Bribe Officer", description: "Lower heat with cash.", cooldownKey: CRIME_KEYS.bribe_officer, playable: true },
  { id: "lay_low", name: "Lay Low", label: "Lay Low", description: "Lower heat with quiet choices.", cooldownKey: CRIME_KEYS.lay_low, playable: true },
  { id: "car_chase", name: "Car Chase", label: "Car Chase", description: "Coming soon.", cooldownKey: CRIME_KEYS.crime_chase, playable: false, status: "coming_soon" },
  { id: "drug_pushing", name: "Drug Pushing", label: "Drug Pushing", description: "Coming soon.", cooldownKey: CRIME_KEYS.crime_drugs, playable: false, status: "placeholder" },
];

const STORE = {
  globalCooldownMinutes: 15,
  cooldownMinutes: 15,
  payout: [9000, 18000],
  fine: [3000, 8000],
  jailChance: { busted: 0.18, busted_hard: 0.28 },
  jailMinutes: [5, 15],
  heatTiers: { clean: 20, spotted: 35, partial: 60, bustedHard: 90 },
  postDrift: { clean: -8, spotted: 5, partial: 12, busted: 22, busted_hard: 35 },
};

const HEIST = {
  heist: {
    title: "Heist",
    crimeKey: CRIME_KEYS.heist,
    cooldownMinutes: 12 * 60,
    heatTiers: { clean: 25, spotted: 50, partial: 75, bustedHard: 85 },
    payouts: { clean: [39900, 59850], spotted: [29260, 47880], partial: [7980, 23940] },
    fine: [12000, 30000],
    jailChance: { busted: 0.45, busted_hard: 0.65 },
    jailMinutes: [20, 35],
    ttl: { clean: 30, spotted: 60, partial: 180, busted: 720, busted_hard: 720 },
  },
  major_heist: {
    title: "Major Heist",
    crimeKey: CRIME_KEYS.major_heist,
    cooldownMinutes: 24 * 60,
    heatTiers: { clean: 15, spotted: 30, partial: 55, bustedHard: 85 },
    payouts: { clean: [73150, 133000], spotted: [63840, 99750], partial: [33250, 53200] },
    fine: [12000, 30000],
    jailChance: { busted: 0.55, busted_hard: 0.75 },
    jailMinutes: [45, 60],
    ttl: { clean: 60, spotted: 120, partial: 240, busted: 720, busted_hard: 1440 },
  },
};

const BRIBE_TARGETS = {
  patrol: { id: "patrol", label: "Patrol Officer", description: "Cheap, common, unreliable.", success: { low: 0.58, medium: 0.72, high: 0.82 }, heatDrop: { low: [5, 7], medium: [8, 12], high: [12, 16] }, failHeat: [5, 10], jailChance: 0.01 },
  evidence: { id: "evidence", label: "Evidence Clerk", description: "High reward, moderate risk.", success: { low: 0.34, medium: 0.56, high: 0.72 }, heatDrop: { low: [10, 14], medium: [18, 24], high: [28, 35] }, failHeat: [7, 12], jailChance: 0.025 },
  sergeant: { id: "sergeant", label: "Desk Sergeant", description: "Balanced option.", success: { low: 0.46, medium: 0.66, high: 0.80 }, heatDrop: { low: [7, 10], medium: [14, 20], high: [22, 28] }, failHeat: [5, 10], jailChance: 0.015 },
};
const BRIBE_TIERS = {
  low: { id: "low", label: "Low", amount: 5000 },
  medium: { id: "medium", label: "Medium", amount: 12500 },
  high: { id: "high", label: "High", amount: 25000 },
};

const LAY_LOW_SCENARIOS = [
  { prompt: "Police presence has increased around your block. What's your first move?", options: [{ label: "Stay inside with lights off", tier: "green" }, { label: "Move through back streets", tier: "yellow" }, { label: "Visit a friend nearby", tier: "yellow" }, { label: "Go for a late-night drive", tier: "red" }] },
  { prompt: "A patrol car slows near your usual hangout.", options: [{ label: "Leave separately and quietly", tier: "green" }, { label: "Wait it out in the alley", tier: "yellow" }, { label: "Call someone for a pickup", tier: "yellow" }, { label: "Wave and act normal", tier: "red" }] },
  { prompt: "Your phone starts buzzing with people asking where you are.", options: [{ label: "Turn it off for the night", tier: "green" }, { label: "Answer only trusted contacts", tier: "yellow" }, { label: "Send short vague replies", tier: "yellow" }, { label: "Post a story to look casual", tier: "red" }] },
  { prompt: "Someone says they saw officers asking questions nearby.", options: [{ label: "Change clothes and stay put", tier: "green" }, { label: "Move to a quiet safe room", tier: "yellow" }, { label: "Ask around for details", tier: "yellow" }, { label: "Confront the person talking", tier: "red" }] },
  { prompt: "A familiar car idles outside longer than it should.", options: [{ label: "Kill the lights and wait", tier: "green" }, { label: "Exit through the back", tier: "yellow" }, { label: "Text a lookout", tier: "yellow" }, { label: "Step outside to check plates", tier: "red" }] },
  { prompt: "The night is nearly over, but your name is still warm.", options: [{ label: "Sleep somewhere quiet", tier: "green" }, { label: "Move once before sunrise", tier: "yellow" }, { label: "Split your cash and phone", tier: "yellow" }, { label: "Head to your regular spot", tier: "red" }] },
];

let schemaReady = false;

function db() {
  if (!pool?.query) throw new Error("DATABASE_URL is not configured.");
  return pool;
}

function id() {
  return `crime_${crypto.randomBytes(12).toString("hex")}`;
}

function normalizeCtx(ctx) {
  return { ...ctx, userId: String(ctx.userId || ctx.discordUserId || "") };
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, Number(n) || 0));
}

function randInt(min, max) {
  return Math.floor(Number(min) + Math.random() * (Number(max) - Number(min) + 1));
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function weightedPick(items, weightKey = "weight") {
  const total = items.reduce((sum, item) => sum + Math.max(0, Number(item?.[weightKey] || 0)), 0);
  if (total <= 0) return pick(items);
  let roll = Math.random() * total;
  for (const item of items) {
    roll -= Math.max(0, Number(item?.[weightKey] || 0));
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}

function iso(value) {
  const date = value instanceof Date ? value : value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

function publicChoice(choice, idx) {
  return {
    id: choice?.id || String(idx),
    label: choice?.label || choice?.title || `Option ${idx + 1}`,
    title: choice?.title || choice?.label || `Option ${idx + 1}`,
    text: choice?.text || choice?.line || "",
    description: choice?.description || "",
    disabled: Boolean(choice?.disabled),
  };
}

async function ensureSchema() {
  if (schemaReady) return;
  await appLinking.ensureSchema();
  await db().query(`
    CREATE TABLE IF NOT EXISTS cooldowns (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      key TEXT NOT NULL,
      next_claim_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (guild_id, user_id, key)
    );

    CREATE TABLE IF NOT EXISTS crime_sessions (
      id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      profile_id TEXT NULL,
      crime_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      result_json JSONB NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      resolved_at TIMESTAMPTZ NULL
    );
    CREATE INDEX IF NOT EXISTS idx_crime_sessions_user_status ON crime_sessions (guild_id, user_id, status);
    CREATE INDEX IF NOT EXISTS idx_crime_sessions_expires ON crime_sessions (expires_at);
  `);
  schemaReady = true;
}

async function getCooldown(guildId, userId, key) {
  const res = await db().query(`SELECT next_claim_at FROM cooldowns WHERE guild_id=$1 AND user_id=$2 AND key=$3`, [guildId, userId, key]);
  const date = res.rows?.[0]?.next_claim_at ? new Date(res.rows[0].next_claim_at) : null;
  return date && date.getTime() > Date.now() ? date : null;
}

async function setCooldown(guildId, userId, key, minutes) {
  const next = new Date(Date.now() + Number(minutes || 0) * 60_000);
  await db().query(
    `INSERT INTO cooldowns (guild_id, user_id, key, next_claim_at)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (guild_id, user_id, key)
     DO UPDATE SET next_claim_at=EXCLUDED.next_claim_at`,
    [guildId, userId, key, next]
  );
}

async function cooldowns(ctx) {
  const keys = { store: CRIME_KEYS.store_robbery, scam: CRIME_KEYS.scam_call, heist: CRIME_KEYS.heist, major: CRIME_KEYS.major_heist, bribe: CRIME_KEYS.bribe_officer, layLow: CRIME_KEYS.lay_low, chase: CRIME_KEYS.crime_chase, drugs: CRIME_KEYS.crime_drugs };
  const out = {};
  for (const [name, key] of Object.entries(keys)) {
    out[name] = iso(await getCooldown(ctx.guildId, ctx.userId, key));
  }
  return out;
}

async function jailed(ctx) {
  const res = await db().query(`SELECT jailed_until FROM jail WHERE guild_id=$1 AND user_id=$2 AND jailed_until > NOW() LIMIT 1`, [ctx.guildId, ctx.userId]);
  return res.rows?.[0]?.jailed_until ? iso(res.rows[0].jailed_until) : null;
}

async function heatInfo(ctx) {
  const info = await crimeHeat.getCrimeHeatInfo(ctx.guildId, ctx.userId);
  return {
    heat: Number(info.heat || 0),
    rawHeat: Number(info.rawHeat || 0),
    displayHeat: Number(info.heat || 0),
    expiresAt: iso(info.expiresAt),
    remainingMs: Number(info.remainingMs || 0),
  };
}

async function profile(ctx) {
  return appLinking.buildProfileSnapshot(ctx.profileId);
}

async function applyCrimePayout(ctx, amount, type, meta = {}, awardSource = "crime") {
  const standing = await standingService.getStanding(ctx.guildId, ctx.userId).catch(() => null);
  const modified = standingService.applyCrimePayoutModifier(amount, standing?.standing || 0);
  await creditUserWithEffects({
    guildId: ctx.guildId,
    userId: ctx.userId,
    amount: modified.amount,
    type,
    meta: { ...meta, destination: "wallet", standingCrimePayoutPct: modified.pct },
    activityEffects: {
      effectsApply: true,
      canAwardEffects: true,
      blockedBlessings: [],
      blockedCurses: [],
      effectAwardPool: { nothingWeight: 100, blessingWeight: 0, curseWeight: 0, blessingWeights: {}, curseWeights: {} },
    },
    awardSource,
  });
  return modified.amount;
}

async function debitWalletToBank(ctx, amount, type, meta = {}) {
  const current = await economy.getWalletBalance(ctx.guildId, ctx.userId);
  const take = Math.min(current, Math.max(0, Math.floor(Number(amount || 0))));
  if (take <= 0) return 0;
  const debit = await economy.tryDebitUser(ctx.guildId, ctx.userId, take, type, { ...meta, source: "wallet" });
  if (!debit?.ok) return 0;
  await economy.addServerBank(ctx.guildId, take, `${type}_bank`, { ...meta, source: "wallet", userId: ctx.userId });
  return take;
}

async function theftKitState(ctx) {
  const res = await db().query(
    `SELECT qty, uses_remaining FROM user_inventory WHERE guild_id=$1 AND user_id=$2 AND item_id=$3`,
    [ctx.guildId, ctx.userId, THEFT_KIT_ITEM_ID]
  );
  const qty = Number(res.rows?.[0]?.qty || 0);
  const uses = Number(res.rows?.[0]?.uses_remaining || 0);
  return { active: qty > 0 && uses > 0, usesStart: uses, bonusTotal: 0, lastBonus: null, consumed: false, usesRemainingAfter: null };
}

async function consumeTheftKit(ctx, state) {
  if (!state?.theftKit?.active || state.theftKit.consumed) return state;
  const res = await db().query(
    `UPDATE user_inventory
     SET uses_remaining = uses_remaining - 1, updated_at=NOW()
     WHERE guild_id=$1 AND user_id=$2 AND item_id=$3 AND uses_remaining >= 1
     RETURNING uses_remaining`,
    [ctx.guildId, ctx.userId, THEFT_KIT_ITEM_ID]
  );
  if (res.rows?.[0]) {
    const left = Number(res.rows[0].uses_remaining || 0);
    if (left <= 0) await db().query(`DELETE FROM user_inventory WHERE guild_id=$1 AND user_id=$2 AND item_id=$3`, [ctx.guildId, ctx.userId, THEFT_KIT_ITEM_ID]);
    state.theftKit.consumed = true;
    state.theftKit.usesRemainingAfter = left;
  }
  return state;
}

async function overview(ctx) {
  ctx = normalizeCtx(ctx);
  await ensureSchema();
  const [p, h, cds, jailedUntil] = await Promise.all([profile(ctx), heatInfo(ctx), cooldowns(ctx), jailed(ctx)]);
  const now = Date.now();
  const actionCooldown = {
    store_robbery: cds.store,
    scam_call: cds.scam,
    heist: cds.heist,
    major_heist: cds.major,
    bribe_officer: cds.bribe,
    lay_low: cds.layLow,
  };
  return {
    ok: true,
    body: {
      profile: p,
      heatInfo: h,
      jailed: Boolean(jailedUntil),
      jailedUntil,
      cooldowns: cds,
      actions: ACTIONS.map((action) => {
        const own = actionCooldown[action.id];
        const blockedUntil = own ? new Date(own).getTime() : 0;
        const available = action.playable && !jailedUntil && (!blockedUntil || blockedUntil <= now);
        return {
          ...action,
          available,
          disabledReason: !action.playable ? "coming_soon" : jailedUntil ? "jailed" : blockedUntil > now ? "cooldown" : null,
          status: action.status || (available ? "available" : "locked"),
        };
      }).filter((action) => action.playable),
    },
  };
}

function buildStorePlan() {
  const phases = ["approach", "method", "greed", "exit", "aftermath"].slice(0, randInt(3, 5));
  return phases.map((phase) => {
    const scenario = pick(storeScenarios[phase] || []);
    return { phase, scenario };
  }).filter((entry) => entry.scenario);
}

function buildHeistPlan() {
  const phases = ["scout", "entry", "inside", "vault", "loot", "escape", "cleanUp"];
  const plan = [];
  const used = new Set();
  for (const phase of phases) {
    const list = heistScenarios[phase] || [];
    for (let i = 0; i < randInt(2, 3); i += 1) {
      const available = list.filter((s) => !used.has(s.id));
      const scenario = pick(available.length ? available : list);
      if (scenario) {
        used.add(scenario.id);
        plan.push({ phase, scenario });
      }
    }
  }
  return plan;
}

function renderSession(row) {
  const state = row.state_json || {};
  const current = state.plan?.[state.step || 0] || null;
  let prompt = current?.scenario?.prompt || current?.scenario?.text || state.prompt || "";
  let choices = (current?.scenario?.choices || state.choices || []).map(publicChoice);
  let availableActions = [];

  if (state.kind === "scam") {
    prompt = "You've got a live one on the line. Read the room, build the lie, then decide when to go in for the scam.";
    choices = (state.visibleOptions || []).map(publicChoice);
    availableActions = ["hangup"];
    if (state.canGo) availableActions.push("go");
  }
  if (state.kind === "bribe" && !state.targetId) {
    prompt = "You're looking to make a problem disappear. Who do you approach?";
    choices = Object.values(BRIBE_TARGETS).map((t) => publicChoice({ id: t.id, label: t.label, description: t.description }));
  }
  if (state.kind === "bribe" && state.targetId) {
    const target = BRIBE_TARGETS[state.targetId];
    prompt = `Target: ${target?.label || "Unknown"}. How much are you willing to offer?`;
    choices = Object.values(BRIBE_TIERS).map((t) => publicChoice({ id: t.id, label: `${t.label} ($${t.amount.toLocaleString("en-AU")})` }));
  }
  if (state.kind === "lay_low") {
    const scenario = state.scenarios?.[state.step || 0];
    prompt = scenario?.prompt || "";
    choices = (scenario?.options || []).map((option, idx) => publicChoice({ ...option, id: String(idx) }));
  }

  return {
    id: row.id,
    sessionId: row.id,
    crimeId: row.crime_id,
    status: row.status,
    title: state.title || ACTIONS.find((a) => a.id === row.crime_id)?.label || row.crime_id,
    phase: current?.phase || state.phase || null,
    step: Number(state.step || 0),
    prompt,
    message: state.message || null,
    choices,
    availableActions,
    currentHeat: Number(state.heat ?? state.currentHeat ?? 0),
    heat: Number(state.heat ?? state.currentHeat ?? 0),
    state: {
      currentHeat: Number(state.heat ?? state.currentHeat ?? 0),
      heat: Number(state.heat ?? state.currentHeat ?? 0),
      persuasion: state.persuasion,
      suspicion: state.suspicion,
      turn: state.turn,
      maxTurns: state.maxTurns,
      score: state.score,
      theftKit: state.theftKit ? {
        active: Boolean(state.theftKit.active),
        bonusTotal: Number(state.theftKit.bonusTotal || 0),
        lastBonus: state.theftKit.lastBonus,
        usesRemainingAfter: state.theftKit.usesRemainingAfter,
      } : undefined,
      log: state.log,
    },
    result: row.result_json || null,
    expiresAt: iso(row.expires_at),
  };
}

async function insertSession(ctx, crimeId, state) {
  const sessionId = id();
  const expiresAt = new Date(Date.now() + (SESSION_TTL_MS[crimeId] || 10 * 60 * 1000));
  const res = await db().query(
    `INSERT INTO crime_sessions (id, guild_id, user_id, profile_id, crime_id, status, state_json, expires_at)
     VALUES ($1,$2,$3,$4,$5,'active',$6::jsonb,$7)
     RETURNING *`,
    [sessionId, ctx.guildId, ctx.userId, ctx.profileId, crimeId, JSON.stringify(state), expiresAt]
  );
  return res.rows[0];
}

async function validateStart(ctx, crimeId) {
  if (!ACTIONS.find((a) => a.id === crimeId && a.playable)) return { ok: false, statusCode: 404, message: "Crime action not found." };
  const jailUntil = await jailed(ctx);
  if (jailUntil) return { ok: false, statusCode: 403, message: "You cannot start crime jobs while jailed." };
  const cds = await cooldowns(ctx);
  const ownMap = { store_robbery: cds.store, scam_call: cds.scam, heist: cds.heist, major_heist: cds.major, bribe_officer: cds.bribe, lay_low: cds.layLow };
  if (ownMap[crimeId]) return { ok: false, statusCode: 429, message: "That crime action is on cooldown." };
  const active = await db().query(`SELECT id FROM crime_sessions WHERE guild_id=$1 AND user_id=$2 AND status='active' AND expires_at > NOW() LIMIT 1`, [ctx.guildId, ctx.userId]);
  if (active.rows?.[0]) return { ok: false, statusCode: 409, message: "You already have an active crime session." };
  return { ok: true };
}

async function start(ctx, crimeIdRaw) {
  ctx = normalizeCtx(ctx);
  await ensureSchema();
  const crimeId = String(crimeIdRaw || "").trim().toLowerCase().replace(/-/g, "_");
  const valid = await validateStart(ctx, crimeId);
  if (!valid.ok) return valid;
  const h = await heatInfo(ctx);
  let state;
  if (crimeId === "store_robbery") {
    state = { kind: "store", title: "Store Robbery", plan: buildStorePlan(), step: 0, heat: h.heat, flags: {}, theftKit: await theftKitState(ctx) };
  } else if (crimeId === "heist" || crimeId === "major_heist") {
    state = { kind: "heist", title: crimeId === "major_heist" ? "Major Heist" : "Heist", mode: crimeId, plan: buildHeistPlan(), step: 0, heat: h.heat, flags: {}, lootAddTotal: 0, theftKit: await theftKitState(ctx) };
  } else if (crimeId === "scam_call") {
    const target = weightedPick(scamData.targetTypes);
    state = scamState(target, h.heat);
  } else if (crimeId === "bribe_officer") {
    state = { kind: "bribe", title: "Bribe Officer", heat: h.heat };
  } else if (crimeId === "lay_low") {
    state = { kind: "lay_low", title: "Lay Low", startingHeat: h.heat, heat: h.heat, step: 0, score: 0, scenarios: layLowScenarios(h.heat) };
  }
  const row = await insertSession(ctx, crimeId, state);
  return { ok: true, body: { session: renderSession(row), profile: await profile(ctx), heatInfo: h, cooldowns: await cooldowns(ctx), message: "Crime session started." } };
}

function scamState(target, heat) {
  const state = {
    kind: "scam",
    title: "Scam Call",
    targetId: target.id,
    target,
    heat,
    heatStart: heat,
    turn: 0,
    maxTurns: scamData.settings.maxTurns,
    persuasion: Number(target.basePersuasion || 0),
    suspicion: 0,
    usedOptions: [],
    jackpotMultiplier: 1,
    heatBonus: 0,
    traceFlag: false,
    log: [`Target: ${pick(target.openings || ["Hello?"])}`],
  };
  state.visibleOptions = scamVisibleOptions(state);
  state.canGo = false;
  return state;
}

function scamVisibleOptions(state) {
  const used = new Set(state.usedOptions || []);
  const available = scamData.dialogueOptions.filter((opt) => !used.has(opt.id) && (!opt.minTurn || state.turn >= opt.minTurn) && (!opt.maxTurn || state.turn <= opt.maxTurn));
  return shuffle(available).slice(0, 4).map((opt) => ({ id: opt.id, label: opt.label, text: opt.line }));
}

function layLowScenarios(heat) {
  const picked = shuffle(LAY_LOW_SCENARIOS).slice(0, 4);
  if (heat < 60) return picked;
  return picked.map((scenario) => ({
    ...scenario,
    options: scenario.options.map((option) => option.tier === "green" && Math.random() <= 0.35 ? { ...option, tier: "yellow" } : option),
  }));
}

async function getSession(ctx, sessionId) {
  ctx = normalizeCtx(ctx);
  await ensureSchema();
  const row = await loadSession(ctx, sessionId);
  if (!row.ok) return row;
  return { ok: true, body: { session: renderSession(row.row), profile: await profile(ctx), heatInfo: await heatInfo(ctx), cooldowns: await cooldowns(ctx) } };
}

async function loadSession(ctx, sessionId, lock = false) {
  const res = await db().query(
    `SELECT * FROM crime_sessions WHERE id=$1 AND guild_id=$2 AND user_id=$3 ${lock ? "FOR UPDATE" : ""}`,
    [sessionId, ctx.guildId, ctx.userId]
  );
  const row = res.rows?.[0];
  if (!row) return { ok: false, statusCode: 404, message: "Crime session not found." };
  if (row.status === "active" && new Date(row.expires_at).getTime() <= Date.now()) {
    const expired = await db().query(`UPDATE crime_sessions SET status='expired', updated_at=NOW(), resolved_at=NOW() WHERE id=$1 RETURNING *`, [row.id]);
    return { ok: true, row: expired.rows[0] };
  }
  return { ok: true, row };
}

async function updateSession(row, state, result = null, status = "active") {
  const res = await db().query(
    `UPDATE crime_sessions
     SET status=$2, state_json=$3::jsonb, result_json=$4::jsonb, updated_at=NOW(), resolved_at=CASE WHEN $2 <> 'active' THEN NOW() ELSE resolved_at END
     WHERE id=$1
     RETURNING *`,
    [row.id, status, JSON.stringify(state), result ? JSON.stringify(result) : row.result_json ? JSON.stringify(row.result_json) : null]
  );
  return res.rows[0];
}

async function action(ctx, sessionId, body = {}) {
  ctx = normalizeCtx(ctx);
  await ensureSchema();
  const loaded = await loadSession(ctx, sessionId);
  if (!loaded.ok) return loaded;

  let row = loaded.row;
  if (row.status !== "active") {
    return {
      ok: true,
      body: {
        session: renderSession(row),
        result: row.result_json,
        message: "Crime session is no longer active.",
      },
    };
  }

  const state = row.state_json || {};
  let result;
  if (state.kind === "store") result = await actionStore(ctx, state, body);
  else if (state.kind === "heist") result = await actionHeist(ctx, row.crime_id, state, body);
  else if (state.kind === "scam") result = await actionScam(ctx, state, body);
  else if (state.kind === "bribe") result = await actionBribe(ctx, state, body);
  else if (state.kind === "lay_low") result = await actionLayLow(ctx, state, body);
  else result = { state, message: "Unknown crime session." };

  row = await updateSession(row, result.state, result.result || null, result.status || "active");
  const bodyOut = {
    session: renderSession(row),
    result: result.result || null,
    message: result.message || null,
  };

  if (row.status !== "active" || result.includeProfile) {
    const [nextProfile, nextHeatInfo, nextCooldowns] = await Promise.all([
      profile(ctx),
      heatInfo(ctx),
      cooldowns(ctx),
    ]);
    bodyOut.profile = nextProfile;
    bodyOut.heatInfo = nextHeatInfo;
    bodyOut.cooldowns = nextCooldowns;
  }

  return { ok: true, body: bodyOut };
}

function applyChoiceFlags(state, choice, mode = "normal") {
  const heatDelta = mode === "major" && typeof choice.heatMajor === "number" ? Number(choice.heatMajor) : Number(choice.heat || 0);
  state.heat = clamp(Number(state.heat || 0) + heatDelta, 0, 100);
  if (state.theftKit?.active) {
    const extra = randInt(1, 2);
    state.heat = clamp(state.heat - extra, 0, 100);
    state.theftKit.bonusTotal = Number(state.theftKit.bonusTotal || 0) + extra;
    state.theftKit.lastBonus = extra;
  }
  const lootDelta = mode === "major" && typeof choice.lootAddMajor === "number" ? Number(choice.lootAddMajor) : Number(choice.lootAdd || 0);
  state.lootAddTotal = Number(state.lootAddTotal || 0) + lootDelta;
  for (const key of ["evidenceRisk", "evidenceClear", "usedCar", "timerRisk", "witnessRisk", "crowdBlend", "leftEvidence", "timeOverrun", "usedGetawayCar", "witnesses", "camerasSeenYou", "maskless", "shotsFired", "alarmTriggered", "scrubbedFootage", "changedClothes", "ditchedTools", "routeSwapped", "jammedCameras"]) {
    if (choice[key]) state.flags[key] = true;
  }
}

async function actionStore(ctx, state, body) {
  const current = state.plan[state.step];
  const choice = current?.scenario?.choices?.[Number(body.choiceIndex)];
  if (!choice) return { state, message: "Choose a valid option." };
  applyChoiceFlags(state, choice);
  state.step += 1;
  if (state.step < state.plan.length) return { state, message: "Choice recorded." };
  return resolveStore(ctx, state);
}

function storeOutcome(heat) {
  if (heat < STORE.heatTiers.clean) return "clean";
  if (heat < STORE.heatTiers.spotted) return "spotted";
  if (heat < STORE.heatTiers.partial) return "partial";
  if (heat >= STORE.heatTiers.bustedHard) return "busted_hard";
  return "busted";
}

function storeIdentified(flags) {
  let chance = 0.05;
  if (flags.evidenceRisk) chance += 0.18;
  if (flags.timerRisk) chance += 0.10;
  if (flags.usedCar) chance += 0.10;
  if (flags.witnessRisk) chance += 0.08;
  if (flags.crowdBlend) chance -= 0.08;
  if (flags.evidenceClear) chance -= 0.12;
  return Math.random() < clamp(chance, 0, 0.6);
}

async function resolveStore(ctx, state) {
  await setCooldown(ctx.guildId, ctx.userId, CRIME_KEYS.store_robbery, STORE.cooldownMinutes);
  await consumeTheftKit(ctx, state);
  let outcome = storeOutcome(state.heat);
  const identified = storeIdentified(state.flags || {});
  if (identified && outcome === "clean") outcome = "spotted";
  let payout = 0;
  let fine = 0;
  let paidFine = 0;
  let jailMinutes = 0;
  if (["clean", "spotted", "partial"].includes(outcome)) {
    payout = randInt(STORE.payout[0], STORE.payout[1]);
    if (outcome === "partial") payout = Math.floor(payout * 0.75);
    if (Math.random() < 0.12) payout -= randInt(300, 1200);
    if (Math.random() < 0.10) payout += randInt(250, 1500);
    payout = Math.max(0, payout);
    payout = await applyCrimePayout(ctx, payout, "crime_store_success", { job: "store_robbery", outcome }, "crime_store_robbery");
  } else {
    fine = randInt(STORE.fine[0], STORE.fine[1]);
    if (outcome === "busted_hard") fine = Math.floor(fine * 1.1);
    paidFine = await debitWalletToBank(ctx, fine, "crime_store_fine", { job: "store_robbery", outcome });
    if (Math.random() < STORE.jailChance[outcome]) {
      jailMinutes = randInt(STORE.jailMinutes[0], STORE.jailMinutes[1]);
      await setJail(ctx.guildId, ctx.userId, jailMinutes);
    }
  }
  state.heat = clamp(state.heat + STORE.postDrift[outcome], 0, 100);
  await crimeHeat.setCrimeHeat(ctx.guildId, ctx.userId, state.heat, crimeHeat.heatTTLMinutesForOutcome(outcome, { identified }));
  const result = { outcome, identified, payout, fine, paidFine, jailMinutes, finalHeat: state.heat };
  state.result = result;
  return { state, result, status: "resolved", message: "Store Robbery complete." };
}

async function actionHeist(ctx, crimeId, state, body) {
  const current = state.plan[state.step];
  const choice = current?.scenario?.choices?.[Number(body.choiceIndex)];
  if (!choice) return { state, message: "Choose a valid option." };
  applyChoiceFlags(state, choice, crimeId === "major_heist" ? "major" : "normal");
  state.step += 1;
  if (state.step < state.plan.length) return { state, message: "Choice recorded." };
  return resolveHeist(ctx, crimeId, state);
}

function heistOutcome(heat, tiers) {
  if (heat < tiers.clean) return "clean";
  if (heat < tiers.spotted) return "spotted";
  if (heat < tiers.partial) return "partial";
  if (heat >= tiers.bustedHard) return "busted_hard";
  return "busted";
}

function heistIdentified(flags) {
  let chance = 0.08;
  const plus = { leftEvidence: 0.20, timeOverrun: 0.12, usedGetawayCar: 0.10, witnesses: 0.10, camerasSeenYou: 0.10, maskless: 0.10, shotsFired: 0.18, alarmTriggered: 0.14 };
  const minus = { scrubbedFootage: 0.12, changedClothes: 0.08, ditchedTools: 0.08, routeSwapped: 0.06, jammedCameras: 0.06 };
  for (const [k, v] of Object.entries(plus)) if (flags[k]) chance += v;
  for (const [k, v] of Object.entries(minus)) if (flags[k]) chance -= v;
  return Math.random() < clamp(chance, 0, 0.7);
}

async function resolveHeist(ctx, crimeId, state) {
  const cfg = HEIST[crimeId];
  await setCooldown(ctx.guildId, ctx.userId, cfg.crimeKey, cfg.cooldownMinutes);
  await consumeTheftKit(ctx, state);
  let outcome = heistOutcome(state.heat, cfg.heatTiers);
  const identified = heistIdentified(state.flags || {});
  if (identified && outcome === "clean") outcome = "spotted";
  let payout = 0;
  let fine = 0;
  let paidFine = 0;
  let jailMinutes = 0;
  if (["clean", "spotted", "partial"].includes(outcome)) {
    const range = cfg.payouts[outcome];
    payout = randInt(range[0], range[1]) + Number(state.lootAddTotal || 0);
    if (Math.random() < 0.14) payout -= randInt(1500, 6000);
    if (Math.random() < 0.12) payout += randInt(1200, 6500);
    payout = Math.max(0, payout);
    payout = await applyCrimePayout(ctx, payout, crimeId === "major_heist" ? "crime_major_heist_success" : "crime_heist_success", { job: crimeId, outcome }, "crime_heist");
  } else {
    fine = randInt(cfg.fine[0], cfg.fine[1]);
    paidFine = await debitWalletToBank(ctx, fine, crimeId === "major_heist" ? "crime_major_heist_fine" : "crime_heist_fine", { job: crimeId, outcome });
    if (Math.random() < cfg.jailChance[outcome]) {
      jailMinutes = randInt(cfg.jailMinutes[0], cfg.jailMinutes[1]);
      await setJail(ctx.guildId, ctx.userId, jailMinutes);
    }
  }
  const drift = { clean: -10, spotted: 8, partial: 18, busted: 30, busted_hard: 40 };
  state.heat = clamp(state.heat + drift[outcome], 0, 100);
  await crimeHeat.setCrimeHeat(ctx.guildId, ctx.userId, state.heat, cfg.ttl[outcome]);
  const result = { outcome, identified, payout, fine, paidFine, jailMinutes, finalHeat: state.heat };
  state.result = result;
  return { state, result, status: "resolved", message: `${cfg.title} complete.` };
}

function scamOptionByInput(body, state) {
  if (body.optionId) return scamData.dialogueOptions.find((opt) => opt.id === body.optionId);
  if (body.optionIndex !== undefined) {
    const visible = state.visibleOptions || [];
    const selected = visible[Number(body.optionIndex)];
    return selected ? scamData.dialogueOptions.find((opt) => opt.id === selected.id) : null;
  }
  return null;
}

async function actionScam(ctx, state, body) {
  if (body.action === "hangup") return resolveScam(ctx, state, "hangup");
  if (body.action === "go") return resolveScam(ctx, state, "go");
  const option = scamOptionByInput(body, state);
  if (!option) return { state, message: "Choose a valid line." };
  const target = state.target;
  const affinity = (option.tags || []).reduce((sum, tag) => sum + Number(target.persuasionByTag?.[tag] || 0), 0);
  let persuasionDelta = randInt(option.persuasion[0], option.persuasion[1]) + affinity;
  let suspicionDelta = randInt(option.suspicion[0], option.suspicion[1]);
  const backfireChance = clamp(Number(target.backfireBase || 0) + Number(option.risk || 0), 2, 60);
  if (Math.random() < backfireChance / 100) {
    persuasionDelta = -Math.max(5, Math.round(Math.abs(persuasionDelta) * randInt(45, 80) / 100));
    suspicionDelta += randInt(10, 18);
  } else if (persuasionDelta < 0) {
    suspicionDelta += randInt(2, 6);
  }
  state.persuasion = clamp(Number(state.persuasion || 0) + persuasionDelta, 0, 100);
  state.suspicion = clamp(Number(state.suspicion || 0) + suspicionDelta, 0, 100);
  state.turn += 1;
  state.usedOptions = [...(state.usedOptions || []), option.id];
  state.log = [...(state.log || []), `You: ${option.line}`].slice(-8);
  if (Math.random() <= Number(scamData.settings.rareEventChance || 0)) {
    const event = weightedPick(scamData.rareEvents);
    if (event?.id === "supervisor_boost") state.persuasion = clamp(state.persuasion + 10, 0, 100);
    if (event?.id === "victim_calls_out") { state.persuasion = clamp(state.persuasion - 12, 0, 100); state.suspicion = clamp(state.suspicion + 8, 0, 100); }
    if (event?.id === "scam_jackpot") state.jackpotMultiplier = Number(state.jackpotMultiplier || 1) + 0.5;
    if (event?.id === "police_trace") { state.suspicion = clamp(state.suspicion + 20, 0, 100); state.heatBonus = Number(state.heatBonus || 0) + 20; state.traceFlag = true; }
    if (event?.id === "script_fumble") state.persuasion = clamp(state.persuasion - 8, 0, 100);
    state.log.push(event.text);
  }
  if (state.suspicion >= 100 || state.turn >= Number(scamData.settings.maxTurns || 5)) return resolveScam(ctx, state, "go");
  state.visibleOptions = scamVisibleOptions(state);
  state.canGo = state.turn >= Number(scamData.settings.goInForScamMinTurn || 2) && Math.random() < Number(scamData.settings.goInForScamChance || 0.42);
  return { state, message: "Line delivered." };
}

async function resolveScam(ctx, state, reason) {
  await setCooldown(ctx.guildId, ctx.userId, CRIME_KEYS.scam_call, Number(scamData.settings.scamCooldownMinutes || 45));
  const target = state.target;
  let outcome = "spotted";
  let identified = false;
  let payout = 0;
  let loss = 0;
  let jailMinutes = 0;
  if (reason === "hangup") {
    outcome = "clean";
  } else {
    const success = Math.random() * 100 <= clamp(state.persuasion, 1, 100);
    if (success) {
      const band = scamData.settings.payoutBands.find((b) => state.persuasion >= b.min && state.persuasion <= b.max);
      if (band) payout = Math.round(randInt(band.range[0], band.range[1]) * Number(target.rewardMultiplier || 1) * Number(state.jackpotMultiplier || 1));
      if (payout > 0) payout = await applyCrimePayout(ctx, payout, "crime_scam_payout", { targetType: target.id, persuasion: state.persuasion }, "crime_scam_call");
      const addedHeat = Math.max(0, Math.round((state.persuasion - target.basePersuasion) * Number(target.heatMultiplier || 1))) + Number(state.heatBonus || 0);
      state.heat = clamp(Number(state.heatStart || state.heat || 0) + addedHeat, 0, 100);
      outcome = addedHeat <= 10 ? "clean" : addedHeat <= 30 ? "spotted" : addedHeat <= 55 ? "partial" : state.traceFlag ? "busted_hard" : "busted";
      identified = state.heat >= 50 || Boolean(state.traceFlag);
    } else {
      const failKind = state.traceFlag || state.suspicion >= 100 ? "trace" : pick(target.failOutcomes || ["hangup"]);
      if (failKind === "reversed") {
        loss = await debitWalletToBank(ctx, randInt(6000, 18000), "crime_scam_reversed", { targetType: target.id });
        outcome = "partial";
        state.heat = clamp(Number(state.heatStart || 0) + randInt(18, 30) + Number(state.heatBonus || 0), 0, 100);
        identified = true;
      } else if (failKind === "trace") {
        outcome = "busted_hard";
        state.heat = clamp(Number(state.heatStart || 0) + randInt(45, 65) + Number(state.heatBonus || 0), 0, 100);
        identified = true;
        if (Math.random() < 0.5) {
          jailMinutes = randInt(20, 35);
          await setJail(ctx.guildId, ctx.userId, jailMinutes);
        }
      } else if (failKind === "reported") {
        outcome = "busted";
        state.heat = clamp(Number(state.heatStart || 0) + randInt(28, 42) + Number(state.heatBonus || 0), 0, 100);
        identified = true;
      } else {
        outcome = "spotted";
        state.heat = clamp(Number(state.heatStart || 0) + randInt(10, 20) + Number(state.heatBonus || 0), 0, 100);
      }
    }
  }
  await crimeHeat.setCrimeHeat(ctx.guildId, ctx.userId, state.heat || 0, crimeHeat.heatTTLMinutesForOutcome(outcome, { identified }));
  const result = { outcome, identified, payout, loss, jailMinutes, finalHeat: state.heat || 0, persuasion: Math.round(state.persuasion || 0), suspicion: Math.round(state.suspicion || 0), targetType: target.id };
  state.result = result;
  return { state, result, status: "resolved", message: "Scam Call complete." };
}

async function actionBribe(ctx, state, body) {
  if (!state.targetId) {
    if (!BRIBE_TARGETS[body.targetId]) return { state, message: "Choose a valid target." };
    state.targetId = body.targetId;
    return { state, message: "Target selected." };
  }
  const target = BRIBE_TARGETS[state.targetId];
  const tier = BRIBE_TIERS[body.tierId];
  if (!tier) return { state, message: "Choose a valid bribe tier." };
  const debit = await economy.tryDebitUser(ctx.guildId, ctx.userId, tier.amount, "crime_bribe_officer", { target: target.id, tier: tier.id, source: "wallet" });
  if (!debit.ok) return { state, message: `You need $${tier.amount.toLocaleString("en-AU")} in your wallet for that offer.` };
  await economy.addServerBank(ctx.guildId, tier.amount, "crime_bribe_officer_bank", { target: target.id, tier: tier.id, userId: ctx.userId });
  await setCooldown(ctx.guildId, ctx.userId, CRIME_KEYS.bribe_officer, 30);
  const trustedContact = Math.random() < 0.08;
  const successChance = Math.min(0.95, Number(target.success[tier.id] || 0) + (trustedContact ? 0.12 : 0));
  const success = Math.random() < successChance;
  let delta;
  if (success) {
    delta = randInt(target.heatDrop[tier.id][0], target.heatDrop[tier.id][1]);
    state.heat = clamp(state.heat - delta, 0, 100);
  } else {
    delta = randInt(target.failHeat[0], target.failHeat[1]);
    state.heat = clamp(state.heat + delta, 0, 100);
    if (Math.random() < target.jailChance) await setJail(ctx.guildId, ctx.userId, randInt(5, 15));
  }
  await crimeHeat.setCrimeHeat(ctx.guildId, ctx.userId, state.heat, 12 * 60);
  const result = { outcome: success ? "success" : "failed", targetId: target.id, tierId: tier.id, amount: tier.amount, heatDelta: success ? -delta : delta, finalHeat: state.heat, trustedContact };
  state.result = result;
  return { state, result, status: "resolved", message: "Bribe resolved." };
}

function layLowScore(tier, heat) {
  const penalty = heat >= 75 ? 1 : heat >= 50 ? 0.5 : 0;
  if (tier === "green") return randInt(4, 6);
  if (tier === "yellow") return Math.max(0, randInt(1, 3) - Math.floor(penalty));
  return -randInt(2, heat >= 65 ? 4 : 3);
}

async function actionLayLow(ctx, state, body) {
  const scenario = state.scenarios[state.step];
  const option = scenario?.options?.[Number(body.optionIndex)];
  if (!option) return { state, message: "Choose a valid option." };
  const gained = layLowScore(option.tier, state.startingHeat);
  state.score = Number(state.score || 0) + gained;
  state.step += 1;
  state.message = gained >= 4 ? `Good move. +${gained}` : gained >= 0 ? `It helps a little. +${gained}` : `Bad look. ${gained}`;
  if (state.step < state.scenarios.length) return { state, message: state.message };
  await setCooldown(ctx.guildId, ctx.userId, CRIME_KEYS.lay_low, 30);
  const delta = Number(state.score || 0);
  state.heat = delta >= 0 ? clamp(state.startingHeat - delta, 0, 100) : clamp(state.startingHeat + Math.abs(delta), 0, 100);
  await crimeHeat.setCrimeHeat(ctx.guildId, ctx.userId, state.heat, 12 * 60);
  const result = { outcome: delta >= 0 ? "reduced" : "increased", score: delta, startingHeat: state.startingHeat, finalHeat: state.heat };
  state.result = result;
  return { state, result, status: "resolved", message: "Lay Low complete." };
}

module.exports = {
  overview,
  start,
  getSession,
  action,
};
