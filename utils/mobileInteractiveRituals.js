const crypto = require("crypto");
const appLinking = require("./appLinking");
const economy = require("./economy");
const { pool } = require("./db");
const { nextSydneyMidnightUTC, getRitualStatus, getSydneyParts } = require("./rituals");
const { creditUserWithEffects, awardEffect } = require("./effectSystem");
const { setJail } = require("./jail");
const { grantInventoryQty } = require("./store");
const lottery = require("./lottery");
const scenarios = require("../data/rituals/echoArrangementScenarios");
const ritualsRegistry = require("../data/rituals");
const gameConfig = require("./gameConfig");

const SESSION_TTL_MS = {
  echo_wheel: 30 * 60 * 1000,
  echo_cipher: 30 * 60 * 1000,
  veil_sequence: 30 * 60 * 1000,
  blade_grid: 20 * 60 * 1000,
  echo_arrangement: 30 * 60 * 1000,
};

const ECHO_WHEEL_COST = 10000;
const CIPHER_CODE_LENGTH = 5;
const CIPHER_MAX_ATTEMPTS = 6;
const CIPHER_REWARD_BY_ATTEMPT = [100000, 85000, 70000, 55000, 45000, 35000];
const VEIL_SLOT_COUNT = 5;
const VEIL_REWARD_BY_SCORE = { 5: 85000, 3: 55000, 2: 30000, 1: 12000, 0: 0 };
const BLADE_ROWS = 3;
const BLADE_COLS = 5;
const BLADE_REWARD_MIN = 60000;
const BLADE_REWARD_MAX = 90000;

let schemaReady = false;

function requirePool() {
  if (!pool || typeof pool.query !== "function") throw new Error("DATABASE_URL is not configured.");
  return pool;
}

function normalizeRitualId(value) {
  return String(value || "").trim().toLowerCase().replace(/-/g, "_");
}

function sessionId() {
  return `ritual_${crypto.randomBytes(12).toString("hex")}`;
}

function iso(value) {
  const date = value instanceof Date ? value : value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

function randInt(min, max) {
  const lo = Math.ceil(Number(min || 0));
  const hi = Math.floor(Number(max || 0));
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return lo || 0;
  if (hi <= lo) return lo;
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

function weightedPick(entries) {
  const valid = entries.filter((entry) => Number(entry.weight || 0) > 0);
  const total = valid.reduce((sum, entry) => sum + Number(entry.weight || 0), 0);
  let roll = Math.random() * total;
  for (const entry of valid) {
    roll -= Number(entry.weight || 0);
    if (roll <= 0) return entry;
  }
  return valid[valid.length - 1] || null;
}

function money(n) {
  return `$${Number(n || 0).toLocaleString("en-AU")}`;
}

function publicMessage(text) {
  return String(text || "").replace(/<@!?(\d+)>/g, "another player").slice(0, 2000);
}

async function ensureSchema() {
  if (schemaReady) return;
  const db = requirePool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS ritual_sessions (
      id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      ritual_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      result_json JSONB NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      resolved_at TIMESTAMPTZ NULL
    );

    CREATE INDEX IF NOT EXISTS idx_ritual_sessions_owner_active
    ON ritual_sessions (guild_id, user_id, ritual_id, status, expires_at DESC);
  `);
  schemaReady = true;
}

async function assertPlayable(ctx) {
  if (!ctx?.profileId || !ctx.guildId || !ctx.discordUserId) {
    return { ok: false, statusCode: 401, message: "Linked Discord profile is required." };
  }

  const jailed = await pool.query(
    `SELECT jailed_until
       FROM jail
      WHERE guild_id=$1 AND user_id=$2 AND jailed_until > NOW()
      LIMIT 1`,
    [ctx.guildId, ctx.discordUserId]
  ).catch(() => ({ rows: [] }));

  if (jailed.rows?.[0]) {
    return { ok: false, statusCode: 403, message: "You cannot perform rituals while jailed." };
  }
  return { ok: true };
}

async function profile(ctx) {
  return appLinking.buildProfileSnapshot(ctx.profileId);
}

async function setCooldown(guildId, userId, key, nextClaimAt = nextSydneyMidnightUTC()) {
  await pool.query(
    `INSERT INTO cooldowns (guild_id, user_id, key, next_claim_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (guild_id, user_id, key) DO UPDATE SET next_claim_at = EXCLUDED.next_claim_at`,
    [String(guildId), String(userId), String(key), nextClaimAt]
  );
  return nextClaimAt;
}

async function findActiveSession(ctx, ritualId) {
  await ensureSchema();
  const res = await pool.query(
    `SELECT *
       FROM ritual_sessions
      WHERE guild_id=$1
        AND user_id=$2
        AND ritual_id=$3
        AND status='active'
        AND expires_at > NOW()
      ORDER BY updated_at DESC
      LIMIT 1`,
    [ctx.guildId, ctx.discordUserId, ritualId]
  );
  return res.rows?.[0] ? normalizeRow(res.rows[0]) : null;
}

async function getSessionRow(sessionIdValue) {
  await ensureSchema();
  const res = await pool.query(`SELECT * FROM ritual_sessions WHERE id=$1 LIMIT 1`, [String(sessionIdValue)]);
  return res.rows?.[0] ? normalizeRow(res.rows[0]) : null;
}

function normalizeRow(row) {
  return {
    id: String(row.id),
    guildId: String(row.guild_id),
    profileId: String(row.profile_id),
    userId: String(row.user_id),
    ritualId: String(row.ritual_id),
    status: String(row.status),
    state: row.state_json || {},
    result: row.result_json || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    resolvedAt: row.resolved_at,
  };
}

async function insertSession(ctx, ritualId, state) {
  await ensureSchema();
  const ttl = SESSION_TTL_MS[ritualId] || 30 * 60 * 1000;
  const id = sessionId();
  const expiresAt = new Date(Date.now() + ttl);
  const res = await pool.query(
    `INSERT INTO ritual_sessions (id, guild_id, profile_id, user_id, ritual_id, status, state_json, expires_at)
     VALUES ($1,$2,$3,$4,$5,'active',$6::jsonb,$7)
     RETURNING *`,
    [id, ctx.guildId, ctx.profileId, ctx.discordUserId, ritualId, state, expiresAt]
  );
  return normalizeRow(res.rows[0]);
}

async function updateSession(row, patch = {}) {
  const status = patch.status || row.status;
  const state = patch.state || row.state;
  const result = Object.prototype.hasOwnProperty.call(patch, "result") ? patch.result : row.result;
  const resolved = status === "resolved" || status === "expired" || status === "abandoned";
  const res = await pool.query(
    `UPDATE ritual_sessions
        SET status=$2,
            state_json=$3::jsonb,
            result_json=$4::jsonb,
            updated_at=NOW(),
            resolved_at=CASE WHEN $5 THEN COALESCE(resolved_at, NOW()) ELSE resolved_at END
      WHERE id=$1
      RETURNING *`,
    [row.id, status, state, result, resolved]
  );
  return normalizeRow(res.rows[0]);
}

function baseSession(row, extra = {}) {
  return {
    sessionId: row.id,
    ritualId: row.ritualId,
    status: row.status,
    configVersion: gameConfig.CONFIG_VERSION,
    expiresAt: iso(row.expiresAt),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    resolvedAt: iso(row.resolvedAt),
    ...extra,
  };
}

function renderEchoWheel(row) {
  const state = row.state || {};
  return baseSession(row, {
    ritualName: "Echo Wheel",
    cost: ECHO_WHEEL_COST,
    canRespin: Boolean(state.canRespin),
    lastResult: state.lastResult || row.result || null,
    allowedActions: row.status === "active" ? ["spin"] : [],
    outcomePreview: [
      "small_win",
      "neutral",
      "bad",
      "big_win",
      "chaos",
    ],
  });
}

function randomCode(length = CIPHER_CODE_LENGTH) {
  let out = "";
  for (let i = 0; i < length; i += 1) out += String(Math.floor(Math.random() * 10));
  return out;
}

function buildCipherFeedback(secret, guess) {
  const markers = new Array(guess.length).fill("black");
  const secretCounts = new Map();
  let correctSpot = 0;
  let wrongSpot = 0;

  for (let i = 0; i < guess.length; i += 1) {
    if (guess[i] === secret[i]) {
      markers[i] = "green";
      correctSpot += 1;
    } else {
      secretCounts.set(secret[i], (secretCounts.get(secret[i]) || 0) + 1);
    }
  }

  for (let i = 0; i < guess.length; i += 1) {
    if (markers[i] === "green") continue;
    const count = secretCounts.get(guess[i]) || 0;
    if (count > 0) {
      markers[i] = "yellow";
      wrongSpot += 1;
      secretCounts.set(guess[i], count - 1);
    }
  }

  return { markers, correctSpot, wrongSpot };
}

function renderEchoCipher(row, reveal = false) {
  const state = row.state || {};
  const history = Array.isArray(state.history) ? state.history : [];
  return baseSession(row, {
    ritualName: "Echo Cipher",
    codeLength: CIPHER_CODE_LENGTH,
    maxAttempts: CIPHER_MAX_ATTEMPTS,
    attemptsUsed: history.length,
    attemptsRemaining: Math.max(0, CIPHER_MAX_ATTEMPTS - history.length),
    history,
    secret: reveal ? state.secret : undefined,
    result: row.result || null,
    allowedActions: row.status === "active" ? ["guess", "give_up"] : [],
  });
}

function getSydneyDateKey(date = new Date()) {
  const parts = getSydneyParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function hashHex(input) {
  return crypto.createHash("sha256").update(String(input)).digest("hex");
}

function seededNumber(seed, salt, min, max) {
  const range = Math.max(1, max - min + 1);
  const value = parseInt(hashHex(`${seed}:${salt}`).slice(0, 12), 16);
  return min + (value % range);
}

function veilPuzzle(userId) {
  const dateKey = getSydneyDateKey();
  const seed = `veil_sequence:${userId}:${dateKey}`;
  const chosen = new Set();
  const numbers = [];
  for (let i = 0; numbers.length < VEIL_SLOT_COUNT && i < 200; i += 1) {
    const candidate = seededNumber(seed, `num:${i}`, 1, 100);
    if (chosen.has(candidate)) continue;
    chosen.add(candidate);
    numbers.push(candidate);
  }
  const ascending = [...numbers].sort((a, b) => a - b);
  const revealOrder = [...ascending]
    .map((value, idx) => ({ value, sortKey: seededNumber(seed, `reveal:${idx}:${value}`, 1, 1000000) }))
    .sort((a, b) => a.sortKey - b.sortKey)
    .map((entry) => entry.value);
  return { dateKey, ascending, revealOrder };
}

function renderVeilSequence(row, reveal = false) {
  const state = row.state || {};
  const step = Number(state.step || 0);
  return baseSession(row, {
    ritualName: "Veil Sequence",
    slotCount: VEIL_SLOT_COUNT,
    placements: Array.isArray(state.placements) ? state.placements : new Array(VEIL_SLOT_COUNT).fill(null),
    step,
    currentFragment: row.status === "active" ? state.revealOrder?.[step] ?? null : null,
    remaining: Math.max(0, VEIL_SLOT_COUNT - step),
    correctOrder: reveal ? state.ascending : undefined,
    result: row.result || null,
    allowedActions: row.status === "active" ? ["place"] : [],
  });
}

function createBladeState() {
  return {
    rows: BLADE_ROWS,
    cols: BLADE_COLS,
    selectedTile: null,
    selectedRow: null,
    selectedCol: null,
    strikeRow: null,
    strikeCol: null,
  };
}

function renderBladeGrid(row) {
  const state = row.state || {};
  return baseSession(row, {
    ritualName: "Blade Grid",
    rows: BLADE_ROWS,
    cols: BLADE_COLS,
    tileCount: BLADE_ROWS * BLADE_COLS,
    selectedTile: state.selectedTile ?? null,
    selectedRow: state.selectedRow ?? null,
    selectedCol: state.selectedCol ?? null,
    strikeRow: row.status === "active" ? null : state.strikeRow ?? null,
    strikeCol: row.status === "active" ? null : state.strikeCol ?? null,
    result: row.result || null,
    rewardRange: { min: BLADE_REWARD_MIN, max: BLADE_REWARD_MAX },
    allowedActions: row.status === "active" ? ["choose_tile"] : [],
  });
}

function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = randInt(0, i);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function pick(list, fallback = "") {
  return Array.isArray(list) && list.length ? list[randInt(0, list.length - 1)] || fallback : fallback;
}

function mistakeLimit(seatCount) {
  if (seatCount <= 5) return 2;
  if (seatCount <= 7) return 3;
  return 4;
}

function arrangementClueTarget(seatCount) {
  if (seatCount <= 5) return randInt(4, 5);
  if (seatCount <= 7) return randInt(5, 7);
  return randInt(7, 9);
}

function minimumArrangementClues(seatCount) {
  if (seatCount <= 5) return 4;
  if (seatCount <= 7) return 5;
  return 7;
}

function maxArrangementClues(seatCount) {
  if (seatCount <= 5) return 6;
  if (seatCount <= 7) return 8;
  return 10;
}

function maxSameClueType(seatCount) {
  return seatCount <= 5 ? 2 : 3;
}

function minimumDistinctClueTypes(seatCount) {
  return seatCount <= 5 ? 3 : 4;
}

function formatArrangementClue(scenario, clue) {
  const templates = scenario.lines?.[clue.type] || [];
  return pick(templates, "{a} knows where to sit.")
    .replaceAll("{a}", clue.a)
    .replaceAll("{b}", clue.b || "")
    .replaceAll("{c}", clue.c || "")
    .replaceAll("{pos}", String(Number(clue.pos || 0) + 1));
}

function arrangementPositions(order) {
  return new Map(order.map((name, idx) => [name, idx]));
}

function arrangementClueSatisfied(order, clue) {
  const pos = arrangementPositions(order);
  const a = pos.get(clue.a);
  const b = clue.b ? pos.get(clue.b) : null;
  const c = clue.c ? pos.get(clue.c) : null;
  const last = order.length - 1;

  if (clue.type === "edge") return a === 0 || a === last;
  if (clue.type === "notEdge") return a > 0 && a < last;
  if (clue.type === "exact") return a === clue.pos;
  if (clue.type === "leftOf") return a < b;
  if (clue.type === "rightOf") return a > b;
  if (clue.type === "adjacent") return Math.abs(a - b) === 1;
  if (clue.type === "notAdjacent") return Math.abs(a - b) !== 1;
  if (clue.type === "between") return (b < a && a < c) || (c < a && a < b);
  if (clue.type === "distance") return Math.abs(a - b) === clue.distance;
  return true;
}

function arrangementPartialOk(assign, clue, seatCount) {
  const a = assign.get(clue.a);
  const b = clue.b ? assign.get(clue.b) : null;
  const c = clue.c ? assign.get(clue.c) : null;
  const last = seatCount - 1;

  if (a != null) {
    if (clue.type === "edge" && a !== 0 && a !== last) return false;
    if (clue.type === "notEdge" && (a === 0 || a === last)) return false;
    if (clue.type === "exact" && a !== clue.pos) return false;
  }
  if (a != null && b != null) {
    if (clue.type === "leftOf" && !(a < b)) return false;
    if (clue.type === "rightOf" && !(a > b)) return false;
    if (clue.type === "adjacent" && Math.abs(a - b) !== 1) return false;
    if (clue.type === "notAdjacent" && Math.abs(a - b) === 1) return false;
    if (clue.type === "distance" && Math.abs(a - b) !== clue.distance) return false;
  }
  if (a != null && b != null && c != null && clue.type === "between") {
    if (!((b < a && a < c) || (c < a && a < b))) return false;
  }
  return true;
}

function countArrangementSolutions(names, clues, limit = 2) {
  const seatCount = names.length;
  const assignment = new Map();
  const usedSeats = new Set();
  const domains = new Map(names.map((name) => [name, Array.from({ length: seatCount }, (_, idx) => idx)]));

  for (const clue of clues) {
    if (clue.type === "exact") domains.set(clue.a, [clue.pos]);
    if (clue.type === "edge") domains.set(clue.a, domains.get(clue.a).filter((idx) => idx === 0 || idx === seatCount - 1));
    if (clue.type === "notEdge") domains.set(clue.a, domains.get(clue.a).filter((idx) => idx > 0 && idx < seatCount - 1));
  }

  const orderedNames = [...names].sort((a, b) => domains.get(a).length - domains.get(b).length);
  let found = 0;

  function search(depth) {
    if (found >= limit) return;
    if (depth >= orderedNames.length) {
      const order = new Array(seatCount);
      for (const [name, seat] of assignment.entries()) order[seat] = name;
      if (clues.every((clue) => arrangementClueSatisfied(order, clue))) found += 1;
      return;
    }

    const name = orderedNames[depth];
    for (const seat of domains.get(name)) {
      if (usedSeats.has(seat)) continue;
      assignment.set(name, seat);
      usedSeats.add(seat);
      if (clues.every((clue) => arrangementPartialOk(assignment, clue, seatCount))) search(depth + 1);
      usedSeats.delete(seat);
      assignment.delete(name);
      if (found >= limit) return;
    }
  }

  search(0);
  return found;
}

function arrangementClueKey(clue) {
  return [clue.type, clue.a, clue.b || "", clue.c || "", clue.pos ?? "", clue.distance ?? ""].join(":");
}

function arrangementClueFamily(clue) {
  if (clue.type === "leftOf" || clue.type === "rightOf") return "order";
  if (clue.type === "edge" || clue.type === "notEdge" || clue.type === "exact") return "position";
  if (clue.type === "adjacent" || clue.type === "notAdjacent" || clue.type === "distance") return "near";
  if (clue.type === "between") return "between";
  return clue.type;
}

function clueTypeCounts(clues) {
  const counts = new Map();
  for (const clue of clues) counts.set(clue.type, (counts.get(clue.type) || 0) + 1);
  return counts;
}

function distinctClueTypes(clues) {
  return new Set(clues.map((clue) => clue.type)).size;
}

function arrangementClueWeight(clue, seatCount, chosen = []) {
  const counts = clueTypeCounts(chosen);
  let weight = 4;
  if (clue.type === "between" || clue.type === "distance") weight = seatCount >= 8 ? 11 : 9;
  else if (clue.type === "adjacent" || clue.type === "notAdjacent") weight = 8;
  else if (clue.type === "edge" || clue.type === "notEdge") weight = 7;
  else if (clue.type === "exact") weight = seatCount <= 5 ? 5 : 3;
  else if (clue.type === "leftOf" || clue.type === "rightOf") weight = 2;

  if (!counts.has(clue.type)) weight += 8;
  if (arrangementClueFamily(clue) !== "order") weight += 2;
  weight -= (counts.get(clue.type) || 0) * 5;
  return weight + randInt(-2, 2);
}

function makeArrangementCandidateClues(answer) {
  const clues = [];
  const pos = arrangementPositions(answer);
  const n = answer.length;

  for (const name of answer) {
    const idx = pos.get(name);
    clues.push(idx === 0 || idx === n - 1 ? { type: "edge", a: name } : { type: "notEdge", a: name });
    clues.push({ type: "exact", a: name, pos: idx });
  }

  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      if (i === j) continue;
      const a = answer[i];
      const b = answer[j];
      if (i < j) clues.push({ type: "leftOf", a, b });
      if (i > j) clues.push({ type: "rightOf", a, b });
      if (Math.abs(i - j) === 1) clues.push({ type: "adjacent", a, b });
      else clues.push({ type: "notAdjacent", a, b });
      const distance = Math.abs(i - j);
      if (distance === 2 || (n >= 8 && distance === 3)) clues.push({ type: "distance", a, b, distance });
    }
  }

  for (let i = 1; i < n - 1; i += 1) {
    for (let left = 0; left < i; left += 1) {
      for (let right = i + 1; right < n; right += 1) {
        clues.push({ type: "between", a: answer[i], b: answer[left], c: answer[right] });
      }
    }
  }

  return shuffle(clues);
}

function wouldCreateOrderChain(chosen, clue) {
  if (clue.type !== "leftOf" && clue.type !== "rightOf") return false;
  const directOrder = chosen.filter((entry) => entry.type === "leftOf" || entry.type === "rightOf");
  if (directOrder.length >= 2) return true;

  const edges = new Map();
  for (const entry of [...directOrder, clue]) {
    const left = entry.type === "leftOf" ? entry.a : entry.b;
    const right = entry.type === "leftOf" ? entry.b : entry.a;
    if (!edges.has(left)) edges.set(left, new Set());
    edges.get(left).add(right);
  }

  function longestFrom(name, seen = new Set()) {
    if (seen.has(name)) return 0;
    seen.add(name);
    let best = 0;
    for (const next of edges.get(name) || []) {
      best = Math.max(best, 1 + longestFrom(next, new Set(seen)));
    }
    return best;
  }

  for (const name of edges.keys()) {
    if (longestFrom(name) >= 2) return true;
  }
  return false;
}

function canUseArrangementClue(chosen, clue, seatCount, target) {
  const counts = clueTypeCounts(chosen);
  if ((counts.get(clue.type) || 0) >= maxSameClueType(seatCount)) return false;
  if (wouldCreateOrderChain(chosen, clue)) return false;
  const family = arrangementClueFamily(clue);
  const familyCount = chosen.filter((entry) => arrangementClueFamily(entry) === family).length;
  if (family === "order" && familyCount >= 2) return false;
  if (familyCount >= Math.max(2, Math.ceil(target / 2))) return false;
  if (clue.type === "exact" && counts.get("exact") >= (seatCount <= 5 ? 1 : 2)) return false;
  return true;
}

function pruneArrangementClues(names, clues, seatCount) {
  let current = [...clues];
  const minClues = minimumArrangementClues(seatCount);
  const minTypes = Math.min(minimumDistinctClueTypes(seatCount), distinctClueTypes(current));

  for (const clue of shuffle(current)) {
    if (current.length <= minClues) break;
    const next = current.filter((entry) => entry !== clue);
    if (distinctClueTypes(next) < minTypes) continue;
    if (countArrangementSolutions(names, next, 2) === 1) current = next;
  }

  return current;
}

function buildArrangementPuzzle() {
  for (let attempt = 0; attempt < 220; attempt += 1) {
    const scenario = pick(scenarios, scenarios[0]);
    const seatCount = randInt(5, 10);
    const names = shuffle(scenario.names).slice(0, seatCount);
    const answer = shuffle(names);
    const target = arrangementClueTarget(seatCount);
    const maxClues = maxArrangementClues(seatCount);
    const minTypes = minimumDistinctClueTypes(seatCount);
    const candidates = makeArrangementCandidateClues(answer);
    const chosen = [];
    const used = new Set();

    for (let round = 0; round < maxClues * 3 && chosen.length < maxClues; round += 1) {
      const sorted = candidates
        .filter((clue) => !used.has(arrangementClueKey(clue)) && canUseArrangementClue(chosen, clue, seatCount, target))
        .sort((a, b) => arrangementClueWeight(b, seatCount, chosen) - arrangementClueWeight(a, seatCount, chosen));

      const clue = sorted[0];
      if (!clue) break;
      used.add(arrangementClueKey(clue));
      const next = [...chosen, clue];
      if (!next.every((entry) => arrangementClueSatisfied(answer, entry))) continue;
      chosen.push(clue);

      const hasEnough =
        chosen.length >= minimumArrangementClues(seatCount) &&
        distinctClueTypes(chosen) >= Math.min(minTypes, chosen.length);
      if (hasEnough && countArrangementSolutions(names, chosen, 2) === 1) {
        const pruned = pruneArrangementClues(names, chosen, seatCount);
        if (distinctClueTypes(pruned) < Math.min(minTypes, pruned.length)) continue;
        const finalClues = shuffle(pruned);
        return {
          scenario: { id: scenario.id, name: scenario.name, intro: scenario.intro },
          seatCount,
          names,
          answer,
          clueData: finalClues,
          clues: finalClues.map((entry) => formatArrangementClue(scenario, entry)),
          mistakesAllowed: mistakeLimit(seatCount),
          mistakesUsed: 0,
          lastSubmittedOrder: null,
          lastFeedback: null,
        };
      }
    }
  }

  throw Object.assign(new Error("Echo failed to generate a unique seating chart. Try again."), { statusCode: 503 });
}

function simpleArrangementPuzzle() {
  return buildArrangementPuzzle();
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

function parseArrangementOrder(orderInput, names) {
  const parts = Array.isArray(orderInput)
    ? orderInput.map((part) => String(part).trim()).filter(Boolean)
    : String(orderInput || "").split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length !== names.length) return { ok: false, message: `Enter exactly ${names.length} names.` };
  const byName = new Map(names.map((name) => [normalizeName(name), name]));
  const seen = new Set();
  const order = [];
  for (const part of parts) {
    const name = byName.get(normalizeName(part));
    if (!name) return { ok: false, message: `Unknown name: ${part}.` };
    const key = normalizeName(name);
    if (seen.has(key)) return { ok: false, message: `Duplicate name: ${name}.` };
    seen.add(key);
    order.push(name);
  }
  return { ok: true, order };
}

function correctPositions(guess, answer) {
  let count = 0;
  for (let i = 0; i < answer.length; i += 1) {
    if (guess[i] === answer[i]) count += 1;
  }
  return count;
}

function arrangementReward(state) {
  const base = 8000 + Number(state.seatCount || 0) * 6500;
  const perfect = Number(state.mistakesUsed || 0) === 0 ? 1.25 : 1;
  const mistakeMult = Math.max(0.65, 1 - Number(state.mistakesUsed || 0) * 0.12);
  return Math.round(base * perfect * mistakeMult);
}

function renderEchoArrangement(row, reveal = false) {
  const state = row.state || {};
  return baseSession(row, {
    ritualName: "Echo Arrangement",
    shortName: "Echo Seating",
    scenario: state.scenario,
    seatCount: state.seatCount,
    seats: Array.from({ length: Number(state.seatCount || 0) }, (_, idx) => idx + 1),
    names: state.names || [],
    clues: state.clues || [],
    mistakesUsed: Number(state.mistakesUsed || 0),
    mistakesAllowed: Number(state.mistakesAllowed || 0),
    lastSubmittedOrder: state.lastSubmittedOrder || null,
    lastFeedback: state.lastFeedback || null,
    correctOrder: reveal ? state.answer : undefined,
    result: row.result || null,
    allowedActions: row.status === "active" ? ["submit", "give_up"] : [],
  });
}

function renderSession(row, options = {}) {
  if (row.ritualId === "echo_wheel") return renderEchoWheel(row);
  if (row.ritualId === "echo_cipher") return renderEchoCipher(row, options.reveal);
  if (row.ritualId === "veil_sequence") return renderVeilSequence(row, options.reveal);
  if (row.ritualId === "blade_grid") return renderBladeGrid(row);
  if (row.ritualId === "echo_arrangement") return renderEchoArrangement(row, options.reveal);
  return baseSession(row);
}

async function drawRandomStoreItem(guildId) {
  const res = await pool.query(
    `SELECT item_id, name
       FROM store_items
      WHERE guild_id=$1 AND enabled=true
      ORDER BY RANDOM()
      LIMIT 1`,
    [String(guildId)]
  ).catch(() => ({ rows: [] }));
  if (res.rows?.[0]?.item_id) return { itemId: String(res.rows[0].item_id), name: String(res.rows[0].name || res.rows[0].item_id) };
  const fallbacks = [
    { itemId: "mystery_crate", name: "Mystery Crate" },
    { itemId: "lotto_ticket_bundle", name: "Lottery Bundle" },
    { itemId: "repair_kit", name: "Repair Kit" },
    { itemId: "lucky_charm", name: "Lucky Charm" },
  ];
  return pick(fallbacks, fallbacks[0]);
}

async function debitUpTo(guildId, userId, target, type, meta = {}) {
  const balance = await economy.getWalletBalance(guildId, userId);
  const take = Math.max(0, Math.min(Number(target || 0), balance));
  if (take > 0) await economy.tryDebitUser(guildId, userId, take, type, meta).catch(() => {});
  return take;
}

async function pickRandomRecipient(guildId, userId) {
  const res = await pool.query(
    `SELECT user_id FROM user_balances WHERE guild_id=$1 AND user_id <> $2 ORDER BY RANDOM() LIMIT 1`,
    [String(guildId), String(userId)]
  ).catch(() => ({ rows: [] }));
  return res.rows?.[0]?.user_id ? String(res.rows[0].user_id) : null;
}

const ECHO_WHEEL_OUTCOMES = [
  { id: "cash_10000", weight: 24, category: "small_win", label: "+$10,000", resolve: async (ctx) => {
    await economy.creditUser(ctx.guildId, ctx.userId, 10000, "echo_wheel_small_cash", { ritual: "echo_wheel" });
    return { title: "+$10,000", message: "$10,000 added to your wallet.", contractEarnings: 10000 };
  } },
  { id: "cash_25000", weight: 18, category: "small_win", label: "+$25,000", resolve: async (ctx) => {
    await economy.creditUser(ctx.guildId, ctx.userId, 25000, "echo_wheel_cash", { ritual: "echo_wheel" });
    return { title: "+$25,000", message: "$25,000 added to your wallet.", contractEarnings: 25000 };
  } },
  { id: "random_item", weight: 8, category: "small_win", label: "1 Random Item", resolve: async (ctx) => {
    const item = await drawRandomStoreItem(ctx.guildId);
    await grantInventoryQty(ctx.guildId, ctx.userId, item.itemId, 1, { source: "echo_wheel" });
    return { title: "1 Random Item", message: `Received ${item.name}.` };
  } },
  { id: "free_lottery", weight: 7, category: "small_win", label: "Free 5 Lottery Tickets", resolve: async (ctx) => {
    const grant = await lottery.grantQuickPickTickets(ctx.guildId, ctx.userId, 5, { source: "echo_wheel" }).catch(() => ({ ok: false, granted: 0 }));
    return { title: "Free Lottery Tickets", message: grant?.ok ? `Granted ${grant.granted} free lottery ticket(s).` : "Lottery tickets were unavailable." };
  } },
  { id: "wheel_jam", weight: 20, category: "neutral", label: "The wheel jams", resolve: async () => ({ title: "The Wheel Jams", message: "The wheel stops on nothing of value." }) },
  { id: "spin_again", weight: 8, category: "neutral", label: "Spin Again", resolve: async (_ctx, state) => {
    state.canRespin = true;
    return { title: "Spin Again", message: "Echo grants a free extra spin." };
  } },
  { id: "wheel_damage", weight: 8, category: "bad", label: "Damage the wheel", resolve: async (ctx) => {
    const taken = await debitUpTo(ctx.guildId, ctx.userId, 7500, "echo_wheel_damage", { ritual: "echo_wheel" });
    return { title: "Wheel Damage", message: `${money(taken)} removed from your wallet.` };
  } },
  { id: "jail", weight: 5, category: "bad", label: "Thrown in Jail", resolve: async (ctx) => {
    const minutes = randInt(5, 10);
    const jailedUntil = await setJail(ctx.guildId, ctx.userId, minutes);
    return { title: "Jail", message: `Echo sends you to jail for ${minutes} minute${minutes === 1 ? "" : "s"}.`, jailedUntil: iso(jailedUntil) };
  } },
  { id: "account_frozen", weight: 4, category: "bad", label: "Account Frozen", resolve: async (ctx) => {
    const award = await awardEffect(ctx.guildId, ctx.userId, "echo_curse_account_frozen", { source: "echo_wheel" });
    return { title: "Account Frozen", message: award?.notice || "Your next eligible earnings have been frozen." };
  } },
  { id: "give_random_player", weight: 2, category: "bad", label: "Give $2,500 away", resolve: async (ctx) => {
    const targetId = await pickRandomRecipient(ctx.guildId, ctx.userId);
    const taken = await debitUpTo(ctx.guildId, ctx.userId, 2500, "echo_wheel_charity", { ritual: "echo_wheel" });
    if (targetId && taken > 0) await economy.creditUser(ctx.guildId, targetId, taken, "echo_wheel_received", { ritual: "echo_wheel", fromUserId: ctx.userId });
    return { title: "Forced Generosity", message: targetId ? `${money(taken)} was given to another player.` : `${money(taken)} disappeared.` };
  } },
  { id: "split_cash", weight: 1, category: "bad", label: "Split $5,000", resolve: async (ctx) => {
    const targetId = await pickRandomRecipient(ctx.guildId, ctx.userId);
    const taken = await debitUpTo(ctx.guildId, ctx.userId, 5000, "echo_wheel_split", { ritual: "echo_wheel" });
    const gift = Math.floor(taken / 2);
    if (targetId && gift > 0) await economy.creditUser(ctx.guildId, targetId, gift, "echo_wheel_split_received", { ritual: "echo_wheel", fromUserId: ctx.userId });
    return { title: "Split Decision", message: targetId ? `You lose ${money(taken)} and another player receives ${money(gift)}.` : `${money(taken)} disappears.` };
  } },
  { id: "jackpot", weight: 4, category: "big_win", label: "Jackpot +$125,000", resolve: async (ctx) => {
    await economy.creditUser(ctx.guildId, ctx.userId, 125000, "echo_wheel_jackpot", { ritual: "echo_wheel" });
    return { title: "Jackpot", message: "$125,000 added to your wallet.", contractEarnings: 125000 };
  } },
  { id: "bank_error", weight: 2, category: "big_win", label: "Bank Error +$175,000", resolve: async (ctx) => {
    await economy.creditBank(ctx.guildId, ctx.userId, 175000, "echo_wheel_bank_error", { ritual: "echo_wheel" });
    return { title: "Bank Error", message: "$175,000 deposited into your bank.", contractEarnings: 175000 };
  } },
  { id: "mystery_crate", weight: 1, category: "big_win", label: "Mystery Crate", resolve: async (ctx) => {
    const crate = weightedPick([{ id: "coins_40000", weight: 50 }, { id: "coins_70000", weight: 25 }, { id: "item", weight: 15 }, { id: "lotto", weight: 10 }]);
    if (crate.id === "item") {
      const item = await drawRandomStoreItem(ctx.guildId);
      await grantInventoryQty(ctx.guildId, ctx.userId, item.itemId, 1, { source: "echo_wheel_mystery_crate" });
      return { title: "Mystery Crate", message: `The crate contained ${item.name}.` };
    }
    if (crate.id === "lotto") {
      const grant = await lottery.grantQuickPickTickets(ctx.guildId, ctx.userId, 3, { source: "echo_wheel_mystery_crate" }).catch(() => ({ ok: false, granted: 0 }));
      return { title: "Mystery Crate", message: grant?.ok ? `The crate contained ${grant.granted} quick-pick lottery tickets.` : "The crate contained expired lottery slips." };
    }
    const amount = crate.id === "coins_70000" ? 70000 : 40000;
    await economy.creditUser(ctx.guildId, ctx.userId, amount, "echo_wheel_mystery_crate", { ritual: "echo_wheel" });
    return { title: "Mystery Crate", message: `The crate contained ${money(amount)}.`, contractEarnings: amount };
  } },
  { id: "server_bank_blessing", weight: 1, category: "big_win", label: "Server Bank Blessing +$250,000", resolve: async (ctx) => {
    await economy.creditUser(ctx.guildId, ctx.userId, 250000, "echo_wheel_server_blessing", { ritual: "echo_wheel" });
    return { title: "Server Bank Blessing", message: "$250,000 added to your wallet.", contractEarnings: 250000 };
  } },
  { id: "casino_voucher", weight: 2, category: "big_win", label: "Casino Voucher", resolve: async (ctx) => {
    const award = await awardEffect(ctx.guildId, ctx.userId, "echo_blessing_casino_voucher", { source: "echo_wheel" });
    return { title: "Casino Voucher", message: award?.notice || "Your next casino loss will be refunded." };
  } },
  { id: "lucky_multiplier", weight: 1, category: "chaos", label: "Lucky Multiplier x2", resolve: async (ctx) => {
    const award = await awardEffect(ctx.guildId, ctx.userId, "echo_blessing_lucky_multiplier", { source: "echo_wheel" });
    return { title: "Lucky Multiplier", message: award?.notice || "Your next eligible reward has been doubled." };
  } },
  { id: "echo_blessing_cash", weight: 1, category: "big_win", label: "Echo's Blessing +$90,000", resolve: async (ctx) => {
    await economy.creditUser(ctx.guildId, ctx.userId, 90000, "echo_wheel_echo_blessing", { ritual: "echo_wheel" });
    return { title: "Echo's Blessing", message: "$90,000 added to your wallet.", contractEarnings: 90000 };
  } },
  { id: "void_spin", weight: 0.35, category: "chaos", label: "Void Spin", resolve: async (ctx) => {
    const balance = await economy.getWalletBalance(ctx.guildId, ctx.userId);
    const taken = Math.max(0, Math.floor(balance));
    if (taken > 0) await economy.tryDebitUser(ctx.guildId, ctx.userId, taken, "echo_wheel_void_spin", { ritual: "echo_wheel" }).catch(() => {});
    return { title: "Void Spin", message: `${money(taken)} was consumed by the void.` };
  } },
  { id: "echo_prank", weight: 1.65, category: "chaos", label: "Echo's Prank", resolve: async (ctx) => {
    const prank = weightedPick([{ id: "blessing_percent", weight: 45 }, { id: "blessing_flat", weight: 25 }, { id: "curse_percent", weight: 20 }, { id: "curse_flat", weight: 10 }]);
    const map = {
      blessing_percent: "echo_blessing_minor_percent",
      blessing_flat: "echo_blessing_minor_flat",
      curse_percent: "echo_curse_minor_percent",
      curse_flat: "echo_curse_minor_flat",
    };
    const award = await awardEffect(ctx.guildId, ctx.userId, map[prank.id], { source: "echo_wheel_echo_prank" });
    return { title: "Echo's Prank", message: award?.notice || "Echo changes the air and refuses to explain." };
  } },
];

async function start(ctx, ritualIdInput) {
  const playable = await assertPlayable(ctx);
  if (!playable.ok) return playable;

  const ritualId = normalizeRitualId(ritualIdInput);
  const ritual = ritualsRegistry.getRitual(ritualId);
  if (!ritual || ritual.placement !== "other" || !ritual.interactive) {
    return { ok: false, statusCode: 404, message: "Interactive ritual not found." };
  }

  const status = await getRitualStatus(ctx.guildId, ctx.discordUserId, ritual);
  if (!status.available) {
    return {
      ok: false,
      statusCode: 409,
      message: ritual.cooldownText ? publicMessage(ritual.cooldownText(status)) : "That ritual is on cooldown.",
      body: { status: "cooldown", nextClaimAt: iso(status.nextClaimAt), unix: status.unix || null },
    };
  }

  const existing = await findActiveSession(ctx, ritualId);
  if (existing) {
    return {
      ok: true,
      body: {
        session: renderSession(existing),
        profile: await profile(ctx),
        message: "Existing ritual session restored.",
      },
    };
  }

  let state = {};
  if (ritualId === "echo_wheel") state = { canRespin: false, lastResult: null };
  else if (ritualId === "echo_cipher") state = { secret: randomCode(), history: [] };
  else if (ritualId === "veil_sequence") state = { ...veilPuzzle(ctx.discordUserId), placements: new Array(VEIL_SLOT_COUNT).fill(null), step: 0, history: [] };
  else if (ritualId === "blade_grid") state = createBladeState();
  else if (ritualId === "echo_arrangement") state = simpleArrangementPuzzle();

  const row = await insertSession(ctx, ritualId, state);
  return {
    ok: true,
    body: {
      session: renderSession(row),
      profile: await profile(ctx),
      message: `${ritual.name} started.`,
    },
  };
}

async function get(ctx, sessionIdValue) {
  const row = await getOwnedSession(ctx, sessionIdValue);
  if (!row.ok) return row;
  return {
    ok: true,
    body: {
      session: renderSession(row.session, { reveal: row.session.status !== "active" }),
      profile: await profile(ctx),
      message: "Ritual session loaded.",
    },
  };
}

async function getOwnedSession(ctx, sessionIdValue) {
  const row = await getSessionRow(sessionIdValue);
  if (!row) return { ok: false, statusCode: 404, message: "Ritual session not found." };
  if (row.guildId !== String(ctx.guildId) || row.userId !== String(ctx.discordUserId)) {
    return { ok: false, statusCode: 403, message: "That ritual session belongs to another player." };
  }
  if (row.status === "active" && new Date(row.expiresAt).getTime() <= Date.now()) {
    const expired = await updateSession(row, { status: "expired", result: { result: "expired", payout: 0 } });
    return { ok: true, session: expired };
  }
  return { ok: true, session: row };
}

async function action(ctx, sessionIdValue, body = {}) {
  const playable = await assertPlayable(ctx);
  if (!playable.ok) return playable;

  const owned = await getOwnedSession(ctx, sessionIdValue);
  if (!owned.ok) return owned;
  let row = owned.session;
  if (row.status !== "active") {
    return {
      ok: true,
      body: {
        session: renderSession(row, { reveal: true }),
        profile: await profile(ctx),
        message: "That ritual session has already ended.",
      },
    };
  }

  const actionName = normalizeRitualId(body.action || body.type || "");
  if (row.ritualId === "echo_wheel") return echoWheelAction(ctx, row, actionName);
  if (row.ritualId === "echo_cipher") return echoCipherAction(ctx, row, actionName, body);
  if (row.ritualId === "veil_sequence") return veilSequenceAction(ctx, row, actionName, body);
  if (row.ritualId === "blade_grid") return bladeGridAction(ctx, row, actionName, body);
  if (row.ritualId === "echo_arrangement") return echoArrangementAction(ctx, row, actionName, body);
  return { ok: false, statusCode: 400, message: "Unsupported ritual action." };
}

async function response(ctx, row, message, options = {}) {
  return {
    ok: true,
    body: {
      session: renderSession(row, options),
      profile: await profile(ctx),
      message: publicMessage(message),
    },
  };
}

async function echoWheelAction(ctx, row, actionName) {
  if (actionName !== "spin") return { ok: false, statusCode: 400, message: "Unsupported Echo Wheel action." };
  const state = { ...(row.state || {}) };
  if (!state.canRespin) {
    const charge = await economy.tryDebitUser(ctx.guildId, ctx.discordUserId, ECHO_WHEEL_COST, "echo_wheel_spin", { ritual: "echo_wheel" });
    if (!charge?.ok) return { ok: false, statusCode: 402, message: `You need ${money(ECHO_WHEEL_COST)} in your wallet to spin the wheel.` };
  } else {
    state.canRespin = false;
  }

  const outcome = weightedPick(ECHO_WHEEL_OUTCOMES);
  const result = await outcome.resolve({ guildId: ctx.guildId, userId: ctx.discordUserId }, state);
  const final = {
    result: outcome.id,
    category: outcome.category,
    label: outcome.label,
    title: result.title,
    message: result.message,
    contractEarnings: Math.max(0, Math.floor(Number(result.contractEarnings || 0))),
    jailedUntil: result.jailedUntil || null,
  };
  state.lastResult = final;

  let patch = { state };
  if (!state.canRespin) {
    const nextClaimAt = await setCooldown(ctx.guildId, ctx.discordUserId, "echo_wheel");
    final.nextClaimAt = iso(nextClaimAt);
    patch = { status: "resolved", state, result: final };
  }

  const updated = await updateSession(row, patch);
  return response(ctx, updated, `${result.title}. ${result.message}`, { reveal: true });
}

async function echoCipherAction(ctx, row, actionName, body) {
  const state = { ...(row.state || {}), history: [...(row.state?.history || [])] };
  if (actionName === "give_up") return failCipher(ctx, row, state, "You abandoned the cipher. Echo decides that counts as failure.");
  if (actionName !== "guess") return { ok: false, statusCode: 400, message: "Unsupported Echo Cipher action." };

  const guess = String(body.guess || "").trim();
  if (!/^\d{5}$/.test(guess)) return { ok: false, statusCode: 400, message: "Enter exactly 5 digits." };
  if (state.history.some((entry) => entry.guess === guess)) return { ok: false, statusCode: 409, message: "You already tried that code. Use a different guess." };

  const feedback = buildCipherFeedback(state.secret, guess);
  state.history.push({ guess, ...feedback });

  if (guess === state.secret) {
    const attemptsUsed = Math.max(1, state.history.length);
    const amount = CIPHER_REWARD_BY_ATTEMPT[Math.min(CIPHER_REWARD_BY_ATTEMPT.length - 1, attemptsUsed - 1)] || 35000;
    const nextClaimAt = await setCooldown(ctx.guildId, ctx.discordUserId, "echo_cipher");
    const payout = await creditUserWithEffects({
      guildId: ctx.guildId,
      userId: ctx.discordUserId,
      amount,
      type: "echo_cipher",
      meta: { ritual: "echo_cipher", reset: "daily", attemptsUsed },
      activityEffects: ritualsRegistry.getRitual("echo_cipher")?.successEffects,
      awardSource: "echo_cipher",
    });
    const result = {
      result: "solved",
      attemptsUsed,
      payout: Number(payout.finalAmount || amount),
      nextClaimAt: iso(nextClaimAt),
      awardNotice: payout?.awardResult?.notice || null,
    };
    const updated = await updateSession(row, { status: "resolved", state, result });
    return response(ctx, updated, `The vault opens. Echo grants ${money(result.payout)}.`, { reveal: true });
  }

  if (state.history.length >= CIPHER_MAX_ATTEMPTS) {
    return failCipher(ctx, row, state, "Six attempts spent. The lock slams shut.");
  }

  const updated = await updateSession(row, { state });
  return response(ctx, updated, `${guess} checked. Exact: ${feedback.correctSpot}. Misplaced: ${feedback.wrongSpot}.`);
}

async function failCipher(ctx, row, state, reason) {
  const minutes = randInt(5, 10);
  const jailedUntil = await setJail(ctx.guildId, ctx.discordUserId, minutes);
  let curseNotice = null;
  if (Math.random() < 0.85) {
    const effectId = pick(["echo_curse_minor_percent", "echo_curse_minor_flat"], "echo_curse_minor_percent");
    const award = await awardEffect(ctx.guildId, ctx.discordUserId, effectId, { source: "echo_cipher_fail" });
    curseNotice = award?.notice || null;
  }
  const nextClaimAt = await setCooldown(ctx.guildId, ctx.discordUserId, "echo_cipher");
  const result = { result: "failed", payout: 0, reason, jailedUntil: iso(jailedUntil), jailMinutes: minutes, curseNotice, nextClaimAt: iso(nextClaimAt) };
  const updated = await updateSession(row, { status: "resolved", state, result });
  return response(ctx, updated, `${reason} Echo sends you to jail for ${minutes} minutes.`, { reveal: true });
}

async function veilSequenceAction(ctx, row, actionName, body) {
  if (actionName !== "place") return { ok: false, statusCode: 400, message: "Unsupported Veil Sequence action." };
  const state = { ...(row.state || {}), placements: [...(row.state?.placements || new Array(VEIL_SLOT_COUNT).fill(null))], history: [...(row.state?.history || [])] };
  const slot = Number(body.slot);
  if (!Number.isInteger(slot) || slot < 1 || slot > VEIL_SLOT_COUNT) return { ok: false, statusCode: 400, message: "Choose a slot from 1 to 5." };
  if (state.placements[slot - 1] != null) return { ok: false, statusCode: 409, message: "That slot is already sealed." };
  const number = state.revealOrder?.[Number(state.step || 0)];
  if (number == null) return { ok: false, statusCode: 400, message: "No active fragment to place." };

  state.placements[slot - 1] = number;
  state.history.push({ step: Number(state.step || 0), number, slot });
  state.step = Number(state.step || 0) + 1;

  if (state.step >= VEIL_SLOT_COUNT) {
    const correct = correctPositions(state.placements, state.ascending);
    const amount = VEIL_REWARD_BY_SCORE[correct] || 0;
    let payout = null;
    if (amount > 0) {
      payout = await creditUserWithEffects({
        guildId: ctx.guildId,
        userId: ctx.discordUserId,
        amount,
        type: "veil_sequence",
        meta: { ritual: "veil_sequence", reset: "daily", score: correct },
        activityEffects: ritualsRegistry.getRitual("veil_sequence")?.successEffects,
        awardSource: "veil_sequence",
      });
    }
    const nextClaimAt = await setCooldown(ctx.guildId, ctx.discordUserId, "veil_sequence");
    const finalPayout = Number(payout?.finalAmount || amount);
    const result = { result: "complete", correctPositions: correct, payout: finalPayout, correctOrder: state.ascending, nextClaimAt: iso(nextClaimAt), awardNotice: payout?.awardResult?.notice || null };
    const updated = await updateSession(row, { status: "resolved", state, result });
    return response(ctx, updated, `Sequence complete. ${correct}/5 positions correct. Payout: ${money(finalPayout)}.`, { reveal: true });
  }

  const updated = await updateSession(row, { state });
  return response(ctx, updated, "The fragment settles into place.");
}

async function bladeGridAction(ctx, row, actionName, body) {
  if (actionName !== "choose_tile") return { ok: false, statusCode: 400, message: "Unsupported Blade Grid action." };
  const tile = Number(body.tile);
  const tileCount = BLADE_ROWS * BLADE_COLS;
  if (!Number.isInteger(tile) || tile < 1 || tile > tileCount) return { ok: false, statusCode: 400, message: `Choose a tile from 1 to ${tileCount}.` };
  const zero = tile - 1;
  const state = {
    ...(row.state || {}),
    selectedTile: tile,
    selectedRow: Math.floor(zero / BLADE_COLS),
    selectedCol: zero % BLADE_COLS,
    strikeRow: randInt(0, BLADE_ROWS - 1),
    strikeCol: randInt(0, BLADE_COLS - 1),
  };
  const hit = state.selectedRow === state.strikeRow || state.selectedCol === state.strikeCol;
  let payout = null;
  let amount = 0;
  if (!hit) {
    amount = randInt(BLADE_REWARD_MIN, BLADE_REWARD_MAX);
    payout = await creditUserWithEffects({
      guildId: ctx.guildId,
      userId: ctx.discordUserId,
      amount,
      type: "blade_grid",
      meta: { ritual: "blade_grid", reset: "daily" },
      activityEffects: ritualsRegistry.getRitual("blade_grid")?.successEffects,
      awardSource: "blade_grid",
    });
  }
  const nextClaimAt = await setCooldown(ctx.guildId, ctx.discordUserId, "blade_grid");
  const finalPayout = Number(payout?.finalAmount || amount || 0);
  const result = { result: hit ? "hit" : "survived", hit, payout: finalPayout, nextClaimAt: iso(nextClaimAt), awardNotice: payout?.awardResult?.notice || null };
  const updated = await updateSession(row, { status: "resolved", state, result });
  return response(ctx, updated, hit ? "The blades found your square. No payout." : `Safe passage. ${money(finalPayout)} added to your wallet.`, { reveal: true });
}

async function echoArrangementAction(ctx, row, actionName, body) {
  const state = { ...(row.state || {}) };
  if (actionName === "give_up") {
    const nextClaimAt = await setCooldown(ctx.guildId, ctx.discordUserId, "echo_arrangement");
    const result = { result: "gave_up", payout: 0, correctOrder: state.answer, nextClaimAt: iso(nextClaimAt) };
    const updated = await updateSession(row, { status: "resolved", state, result });
    return response(ctx, updated, "You gave up. The seating chart collapses.", { reveal: true });
  }
  if (actionName !== "submit") return { ok: false, statusCode: 400, message: "Unsupported Echo Seating action." };

  const parsed = parseArrangementOrder(body.order || body.answer, state.names || []);
  if (!parsed.ok) return { ok: false, statusCode: 400, message: parsed.message };
  state.lastSubmittedOrder = parsed.order;
  const solved = parsed.order.join("|") === (state.answer || []).join("|");

  if (solved) {
    const amount = arrangementReward(state);
    const payout = await creditUserWithEffects({
      guildId: ctx.guildId,
      userId: ctx.discordUserId,
      amount,
      type: "echo_arrangement",
      meta: { ritual: "echo_arrangement", reset: "daily", seatCount: state.seatCount, mistakesUsed: state.mistakesUsed },
      activityEffects: ritualsRegistry.getRitual("echo_arrangement")?.successEffects,
      awardSource: "echo_arrangement",
    });
    const nextClaimAt = await setCooldown(ctx.guildId, ctx.discordUserId, "echo_arrangement");
    const finalPayout = Number(payout?.finalAmount || amount);
    const result = { result: "solved", payout: finalPayout, correctOrder: state.answer, mistakesUsed: state.mistakesUsed, nextClaimAt: iso(nextClaimAt), awardNotice: payout?.awardResult?.notice || null };
    const updated = await updateSession(row, { status: "resolved", state, result });
    return response(ctx, updated, `Correct. Echo pays ${money(finalPayout)}.`, { reveal: true });
  }

  state.mistakesUsed = Number(state.mistakesUsed || 0) + 1;
  const correct = correctPositions(parsed.order, state.answer || []);
  state.lastFeedback = { correctPositions: correct, message: `${correct} position${correct === 1 ? "" : "s"} correct.` };
  if (state.mistakesUsed >= Number(state.mistakesAllowed || 0)) {
    const nextClaimAt = await setCooldown(ctx.guildId, ctx.discordUserId, "echo_arrangement");
    const result = { result: "failed", payout: 0, correctOrder: state.answer, mistakesUsed: state.mistakesUsed, nextClaimAt: iso(nextClaimAt) };
    const updated = await updateSession(row, { status: "resolved", state, result });
    return response(ctx, updated, "No mistakes remain. The seating chart fails.", { reveal: true });
  }

  const updated = await updateSession(row, { state });
  return response(ctx, updated, `The arrangement wobbles. ${correct} position${correct === 1 ? "" : "s"} correct.`);
}

module.exports = {
  ensureSchema,
  start,
  get,
  action,
  normalizeRitualId,
};
