require("dotenv").config();

const http = require("http");
const { URL } = require("url");
const appLinking = require("../utils/appLinking");
const mobileBlackjack = require("../utils/mobileBlackjack");

const DEFAULT_PORT = 3000;
const MAX_BODY_BYTES = 1024 * 1024;
const rateBuckets = new Map();

function json(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Access-Control-Allow-Origin": process.env.ECHO_API_CORS_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  });
  res.end(payload);
}

function notFound(res) {
  json(res, 404, { message: "Not found." });
}

function rateLimit(req, res) {
  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown")
    .split(",")[0]
    .trim();
  const now = Date.now();
  const windowMs = 60 * 1000;
  const max = 90;
  const bucket = rateBuckets.get(ip) || { count: 0, resetAt: now + windowMs };

  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + windowMs;
  }

  bucket.count += 1;
  rateBuckets.set(ip, bucket);

  if (bucket.count > max) {
    json(res, 429, { message: "Too many requests. Try again shortly." });
    return true;
  }

  return false;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let raw = "";

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Request body too large."), { statusCode: 413 }));
        req.destroy();
        return;
      }
      raw += chunk;
    });

    req.on("end", () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error("Invalid JSON body."), { statusCode: 400 }));
      }
    });

    req.on("error", reject);
  });
}

function bearerToken(req) {
  const header = String(req.headers.authorization || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

async function authContext(req, res) {
  const token = bearerToken(req);
  if (!token) {
    json(res, 401, { message: "Missing bearer token." });
    return null;
  }
  const ctx = await appLinking.getSessionContext(token);
  if (!ctx) {
    json(res, 401, { message: "Invalid or expired session token." });
    return null;
  }
  return ctx;
}

async function handler(req, res) {
  if (req.method === "OPTIONS") {
    json(res, 204, {});
    return;
  }

  if (rateLimit(req, res)) return;

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname.replace(/\/+$/g, "") || "/";

  try {
    if (req.method === "GET" && pathname === "/health") {
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && pathname === "/v1/link-codes") {
      const body = await readJson(req);
      if (body.client && String(body.client).length > 80) {
        json(res, 400, { message: "Invalid client." });
        return;
      }
      const created = await appLinking.createLinkCode();
      json(res, 200, created);
      return;
    }

    const claimMatch = pathname.match(/^\/v1\/link-codes\/([^/]+)\/claim$/);
    if (req.method === "POST" && claimMatch) {
      const body = await readJson(req);
      const discordUserId = String(body.discord_user_id || "").trim();
      const displayName = String(body.display_name || "").trim();
      const guildId = String(body.guild_id || "").trim();

      if (!discordUserId) {
        json(res, 400, { message: "discord_user_id is required." });
        return;
      }

      const result = await appLinking.claimLinkCode(decodeURIComponent(claimMatch[1]), {
        discordUserId,
        displayName: displayName || "Echo Player",
        guildId,
      });

      if (!result.ok) {
        json(res, result.statusCode || 400, { message: result.message });
        return;
      }

      json(res, 200, { status: "linked", message: result.message });
      return;
    }

    const statusMatch = pathname.match(/^\/v1\/link-codes\/([^/]+)$/);
    if (req.method === "GET" && statusMatch) {
      const result = await appLinking.getLinkCodeStatus(decodeURIComponent(statusMatch[1]));
      if (!result.ok) {
        json(res, result.statusCode || 400, { message: result.message });
        return;
      }
      json(res, 200, result.body);
      return;
    }

    if (req.method === "GET" && pathname === "/v1/me") {
      const token = bearerToken(req);
      if (!token) {
        json(res, 401, { message: "Missing bearer token." });
        return;
      }

      const profile = await appLinking.getProfileForSessionToken(token);
      if (!profile) {
        json(res, 401, { message: "Invalid or expired session token." });
        return;
      }

      json(res, 200, profile);
      return;
    }

    if (req.method === "POST" && pathname === "/v1/casino/blackjack/start") {
      const ctx = await authContext(req, res);
      if (!ctx) return;
      const body = await readJson(req);
      const result = await mobileBlackjack.startGame(ctx, body.bet);
      if (!result.ok) {
        json(res, result.statusCode || 400, { message: result.message });
        return;
      }
      json(res, 200, result.body);
      return;
    }

    const blackjackActionMatch = pathname.match(/^\/v1\/casino\/blackjack\/([^/]+)\/(hit|stand)$/);
    if (req.method === "POST" && blackjackActionMatch) {
      const ctx = await authContext(req, res);
      if (!ctx) return;
      const gameId = decodeURIComponent(blackjackActionMatch[1]);
      const action = blackjackActionMatch[2];
      const result = action === "hit"
        ? await mobileBlackjack.hit(ctx, gameId)
        : await mobileBlackjack.stand(ctx, gameId);

      if (!result.ok) {
        json(res, result.statusCode || 400, { message: result.message });
        return;
      }
      json(res, 200, result.body);
      return;
    }

    notFound(res);
  } catch (error) {
    const statusCode = error?.statusCode || 500;
    if (statusCode >= 500) console.error("[API] request failed:", error);
    json(res, statusCode, { message: statusCode >= 500 ? "Internal server error." : error.message });
  }
}

async function startApiServer({ port = process.env.PORT || DEFAULT_PORT } = {}) {
  await appLinking.ensureSchema();
  await mobileBlackjack.ensureSchema();

  const server = http.createServer((req, res) => {
    handler(req, res).catch((error) => {
      console.error("[API] unhandled request error:", error);
      json(res, 500, { message: "Internal server error." });
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(Number(port), () => {
      server.off("error", reject);
      resolve();
    });
  });

  console.log(`[API] Echo API listening on port ${port}`);
  return server;
}

module.exports = {
  startApiServer,
  handler,
};
