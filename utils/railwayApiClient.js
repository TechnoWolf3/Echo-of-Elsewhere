class RailwayApiError extends Error {
  constructor(message, statusCode = 500, body = null) {
    super(message);
    this.name = "RailwayApiError";
    this.statusCode = statusCode;
    this.body = body;
  }
}

const GET_CACHE_TTL_MS = Number(process.env.ECHO_DISCORD_API_GET_CACHE_MS || 15_000);
const getCache = new Map();
const inFlight = new Map();

function apiBaseUrl() {
  return String(
    process.env.ECHO_API_URL ||
      process.env.EXPO_PUBLIC_ECHO_API_URL ||
      `http://127.0.0.1:${process.env.PORT || 3000}`
  ).replace(/\/+$/g, "");
}

function cacheKey(baseUrl, path, headers) {
  return [
    baseUrl,
    path,
    headers["X-Echo-Guild-Id"] || "",
    headers["X-Echo-Discord-User-Id"] || "",
  ].join("|");
}

function pruneCache(now = Date.now()) {
  if (getCache.size <= 100) return;
  for (const [key, entry] of getCache) {
    if (!entry || entry.expiresAt <= now) getCache.delete(key);
  }
}

function internalApiToken() {
  return String(process.env.ECHO_INTERNAL_API_TOKEN || process.env.ECHO_API_INTERNAL_TOKEN || "").trim();
}

function canUseRailwayApi() {
  return Boolean(apiBaseUrl() && internalApiToken());
}

function displayNameFor(source) {
  return (
    source?.displayName ||
    source?.member?.displayName ||
    source?.user?.globalName ||
    source?.user?.username ||
    "Echo Player"
  );
}

function guildIdFor(source) {
  return source?.guildId || source?.guild?.id || "";
}

function userIdFor(source) {
  return source?.userId || source?.user?.id || "";
}

async function readResponse(response) {
  const text = await response.text().catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

async function discordRequest(source, path, options = {}) {
  const baseUrl = apiBaseUrl();
  const token = internalApiToken();
  if (!baseUrl || !token) {
    throw new RailwayApiError("Railway API is not configured for Discord settlement.", 500);
  }

  const guildId = guildIdFor(source);
  const userId = userIdFor(source);
  if (!guildId || !userId) {
    throw new RailwayApiError("Discord guild and user context are required.", 400);
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    "X-Echo-Guild-Id": String(guildId),
    "X-Echo-Discord-User-Id": String(userId),
    "X-Echo-Display-Name": displayNameFor(source),
    ...(options.headers || {}),
  };

  let body = options.body;
  if (body && typeof body !== "string") {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(body);
  }

  const method = String(options.method || "GET").toUpperCase();
  const useGetCache = method === "GET" && GET_CACHE_TTL_MS > 0 && options.cache !== false;
  const key = useGetCache ? cacheKey(baseUrl, path, headers) : null;
  const now = Date.now();

  if (key) {
    const cached = getCache.get(key);
    if (cached && cached.expiresAt > now) return cached.payload;
    if (inFlight.has(key)) return inFlight.get(key);
  }

  const request = (async () => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body,
    });
    const payload = await readResponse(response);

    if (!response.ok) {
      throw new RailwayApiError(
        payload?.message || payload?.error || `Railway API returned ${response.status}.`,
        response.status,
        payload
      );
    }

    if (key) {
      pruneCache();
      getCache.set(key, { payload, expiresAt: Date.now() + GET_CACHE_TTL_MS });
    }
    return payload;
  })();

  if (key) inFlight.set(key, request);
  try {
    return await request;
  } finally {
    if (key) inFlight.delete(key);
  }
}

function listRituals(source) {
  return discordRequest(source, "/v1/rituals");
}

function claimRitual(source, ritualId) {
  return discordRequest(source, `/v1/rituals/${encodeURIComponent(String(ritualId))}/claim`, {
    method: "POST",
  });
}

function startRitualSession(source, ritualId) {
  return discordRequest(source, `/v1/rituals/${encodeURIComponent(String(ritualId))}/start`, {
    method: "POST",
  });
}

function getRitualSession(source, sessionId) {
  return discordRequest(source, `/v1/rituals/sessions/${encodeURIComponent(String(sessionId))}`);
}

function ritualSessionAction(source, sessionId, body = {}) {
  return discordRequest(source, `/v1/rituals/sessions/${encodeURIComponent(String(sessionId))}/action`, {
    method: "POST",
    body,
  });
}

function getGameConfig(source) {
  if (source) return discordRequest(source, "/v1/game-config");
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new RailwayApiError("Railway API URL is not configured.", 500);
  const path = "/v1/game-config";
  const key = GET_CACHE_TTL_MS > 0 ? cacheKey(baseUrl, path, {}) : null;
  const cached = key ? getCache.get(key) : null;
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.payload);
  if (key && inFlight.has(key)) return inFlight.get(key);

  const request = fetch(`${baseUrl}${path}`).then(async (response) => {
    const payload = await readResponse(response);
    if (!response.ok) {
      throw new RailwayApiError(payload?.message || `Railway API returned ${response.status}.`, response.status, payload);
    }
    if (key) {
      pruneCache();
      getCache.set(key, { payload, expiresAt: Date.now() + GET_CACHE_TTL_MS });
    }
    return payload;
  });
  if (key) inFlight.set(key, request);
  return request.finally(() => {
    if (key) inFlight.delete(key);
  });
}

module.exports = {
  RailwayApiError,
  apiBaseUrl,
  canUseRailwayApi,
  discordRequest,
  listRituals,
  claimRitual,
  startRitualSession,
  getRitualSession,
  ritualSessionAction,
  getGameConfig,
};
