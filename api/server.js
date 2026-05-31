require("dotenv").config();

const http = require("http");
const { URL } = require("url");
const appLinking = require("../utils/appLinking");
const mobileBlackjack = require("../utils/mobileBlackjack");
const mobileHigherLower = require("../utils/mobileHigherLower");
const mobileInsideTrack = require("../utils/mobileInsideTrack");
const mobileBank = require("../utils/mobileBank");
const mobileCasinoTables = require("../utils/mobileCasinoTables");
const railwayCasinoDiscordBridge = require("../utils/railwayCasinoDiscordBridge");
const gameConfig = require("../utils/gameConfig");
const mobileRituals = require("../utils/mobileRituals");
const mobileInteractiveRituals = require("../utils/mobileInteractiveRituals");
const mobileFarming = require("../utils/mobileFarming");
const mobileAdminPanel = require("../utils/mobileAdminPanel");

const DEFAULT_PORT = 3000;
const MAX_BODY_BYTES = 1024 * 1024;
const rateBuckets = new Map();
let discordClient = null;

function json(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Access-Control-Allow-Origin": process.env.ECHO_API_CORS_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Echo-Guild-Id,X-Echo-Discord-User-Id,X-Echo-Display-Name",
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

function internalApiToken() {
  return String(process.env.ECHO_INTERNAL_API_TOKEN || process.env.ECHO_API_INTERNAL_TOKEN || "").trim();
}

function headerValue(req, name) {
  return String(req.headers[String(name).toLowerCase()] || "").trim();
}

function devPassword(req) {
  return headerValue(req, "x-echo-dev-password");
}

async function authContext(req, res) {
  const token = bearerToken(req);
  if (!token) {
    json(res, 401, { message: "Missing bearer token." });
    return null;
  }
  const ctx = await appLinking.getSessionContext(token);
  if (ctx) {
    return { ...ctx, source: "app" };
  }

  const internalToken = internalApiToken();
  if (internalToken && token === internalToken) {
    const guildId = headerValue(req, "x-echo-guild-id");
    const discordUserId = headerValue(req, "x-echo-discord-user-id");
    const displayName = headerValue(req, "x-echo-display-name") || "Echo Player";

    if (!guildId || !discordUserId) {
      json(res, 400, { message: "Discord API calls require X-Echo-Guild-Id and X-Echo-Discord-User-Id." });
      return null;
    }

    const discordCtx = await appLinking.getOrCreateDiscordContext({
      discordUserId,
      displayName,
      guildId,
    });
    return { ...discordCtx, source: "discord" };
  }

  json(res, 401, { message: "Invalid or expired session token." });
  return null;
}

async function tableCreateResponse(ctx, tableResult, announceToDiscord) {
  let discordAnnouncement = { posted: false };
  let table = tableResult.body;
  if (announceToDiscord && discordClient) {
    discordAnnouncement = await railwayCasinoDiscordBridge.announceTable(discordClient, table, ctx).catch((error) => {
      console.error("[API] failed to announce Discord table:", error);
      return { posted: false, reason: "Discord announcement failed." };
    });
    if (discordAnnouncement.posted) {
      const refreshed = await mobileCasinoTables.getTable(ctx, table.gameType, table.tableId);
      if (refreshed.ok) table = refreshed.body;
    }
  }
  return { ...table, table, discordAnnouncement };
}

async function maybeUpdateDiscordTable(table, notice = null) {
  if (discordClient && table?.discordChannelId && table?.discordMessageId) {
    await railwayCasinoDiscordBridge.updateTableMessage(discordClient, table, notice).catch((error) => {
      console.error("[API] failed to update Discord table message:", error);
    });
  }
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

    if (req.method === "GET" && pathname === "/v1/game-config") {
      json(res, 200, gameConfig.getPublicGameConfig());
      return;
    }

    if (req.method === "GET" && pathname === "/v1/adminpanel") {
      const ctx = await authContext(req, res);
      if (!ctx) return;
      const result = await mobileAdminPanel.list(ctx, devPassword(req), discordClient);
      if (!result.ok) {
        json(res, result.statusCode || 400, { message: result.message });
        return;
      }
      json(res, 200, result.body);
      return;
    }

    if (req.method === "POST" && pathname === "/v1/adminpanel/failed-unlock") {
      const ctx = await authContext(req, res);
      if (!ctx) return;
      await readJson(req);
      const result = await mobileAdminPanel.failedUnlock(ctx);
      if (!result.ok) {
        json(res, result.statusCode || 400, { message: result.message });
        return;
      }
      json(res, 200, result.body);
      return;
    }

    const adminActionMatch = pathname.match(/^\/v1\/adminpanel\/actions\/(.+)$/);
    if (req.method === "POST" && adminActionMatch) {
      const ctx = await authContext(req, res);
      if (!ctx) return;
      const body = await readJson(req);
      const result = await mobileAdminPanel.run(
        ctx,
        devPassword(req),
        discordClient,
        decodeURIComponent(adminActionMatch[1]),
        body.fields || {}
      );
      if (!result.ok) {
        json(res, result.statusCode || 400, { message: result.message });
        return;
      }
      json(res, 200, result.body);
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

    if (req.method === "GET" && pathname === "/v1/bank") {
      const ctx = await authContext(req, res);
      if (!ctx) return;
      const result = await mobileBank.dashboard(ctx);
      if (!result.ok) {
        json(res, result.statusCode || 400, { message: result.message });
        return;
      }
      json(res, 200, result.body);
      return;
    }

    if (req.method === "POST" && pathname === "/v1/bank/deposit") {
      const ctx = await authContext(req, res);
      if (!ctx) return;
      const body = await readJson(req);
      const result = await mobileBank.deposit(ctx, body.amount);
      if (!result.ok) {
        json(res, result.statusCode || 400, { message: result.message });
        return;
      }
      json(res, 200, result.body);
      return;
    }

    if (req.method === "POST" && pathname === "/v1/bank/withdraw") {
      const ctx = await authContext(req, res);
      if (!ctx) return;
      const body = await readJson(req);
      const result = await mobileBank.withdraw(ctx, body.amount);
      if (!result.ok) {
        json(res, result.statusCode || 400, { message: result.message });
        return;
      }
      json(res, 200, result.body);
      return;
    }

    if (req.method === "POST" && pathname === "/v1/bank/transfer") {
      const ctx = await authContext(req, res);
      if (!ctx) return;
      const body = await readJson(req);
      const result = await mobileBank.transfer(ctx, body);
      if (!result.ok) {
        json(res, result.statusCode || 400, { message: result.message });
        return;
      }
      json(res, 200, result.body);
      return;
    }

    if (req.method === "GET" && pathname === "/v1/bank/transactions") {
      const ctx = await authContext(req, res);
      if (!ctx) return;
      const result = await mobileBank.transactions(ctx, url.searchParams.get("limit") || 10);
      if (!result.ok) {
        json(res, result.statusCode || 400, { message: result.message });
        return;
      }
      json(res, 200, result.body);
      return;
    }

    if (pathname === "/v1/enterprises/farming" && req.method === "GET") {
      const ctx = await authContext(req, res);
      if (!ctx) return;
      const result = await mobileFarming.overview(ctx);
      if (!result.ok) {
        json(res, result.statusCode || 400, { message: result.message });
        return;
      }
      json(res, 200, result.body);
      return;
    }

    if (pathname === "/v1/enterprises/farming/config" && req.method === "GET") {
      const ctx = await authContext(req, res);
      if (!ctx) return;
      const result = await mobileFarming.config(ctx);
      if (!result.ok) {
        json(res, result.statusCode || 400, { message: result.message });
        return;
      }
      json(res, 200, result.body);
      return;
    }

    if (pathname === "/v1/enterprises/farming/fields" && req.method === "POST") {
      const ctx = await authContext(req, res);
      if (!ctx) return;
      const result = await mobileFarming.buyField(ctx);
      if (!result.ok) {
        json(res, result.statusCode || 400, { message: result.message });
        return;
      }
      json(res, 200, result.body);
      return;
    }

    const farmingFieldMatch = pathname.match(/^\/v1\/enterprises\/farming\/fields\/([^/]+)\/([^/]+)$/);
    if (req.method === "POST" && farmingFieldMatch) {
      const ctx = await authContext(req, res);
      if (!ctx) return;
      const fieldIndex = decodeURIComponent(farmingFieldMatch[1]);
      const action = decodeURIComponent(farmingFieldMatch[2]);
      const body = ["plant", "fertilise", "convert-barn"].includes(action) ? await readJson(req) : {};
      const handlers = {
        cultivate: () => mobileFarming.cultivateField(ctx, fieldIndex),
        rest: () => mobileFarming.restField(ctx, fieldIndex),
        plant: () => mobileFarming.plantField(ctx, fieldIndex, body.cropId),
        harvest: () => mobileFarming.harvestField(ctx, fieldIndex),
        fertilise: () => mobileFarming.fertiliseField(ctx, fieldIndex, body.fertiliserId),
        upgrade: () => mobileFarming.upgradeField(ctx, fieldIndex),
        "convert-barn": () => mobileFarming.convertBarn(ctx, fieldIndex, body.livestockType),
      };
      const run = handlers[action];
      if (!run) {
        notFound(res);
        return;
      }
      const result = await run();
      if (!result.ok) {
        json(res, result.statusCode || 400, { message: result.message });
        return;
      }
      json(res, 200, result.body);
      return;
    }

    const farmingBarnMatch = pathname.match(/^\/v1\/enterprises\/farming\/barns\/([^/]+)\/([^/]+)$/);
    if (req.method === "POST" && farmingBarnMatch) {
      const ctx = await authContext(req, res);
      if (!ctx) return;
      const action = decodeURIComponent(farmingBarnMatch[2]);
      const body = action === "breed" ? await readJson(req) : {};
      const allowed = new Set(["collect", "slaughter", "slaughter-elderly", "restock", "upgrade", "demolish", "breed"]);
      if (!allowed.has(action)) {
        notFound(res);
        return;
      }
      const result = await mobileFarming.barnAction(ctx, decodeURIComponent(farmingBarnMatch[1]), action, body);
      if (!result.ok) {
        json(res, result.statusCode || 400, { message: result.message });
        return;
      }
      json(res, 200, result.body);
      return;
    }

    if (pathname === "/v1/enterprises/farming/store" && req.method === "GET") {
      const ctx = await authContext(req, res);
      if (!ctx) return;
      const result = await mobileFarming.store(ctx);
      if (!result.ok) {
        json(res, result.statusCode || 400, { message: result.message });
        return;
      }
      json(res, 200, result.body);
      return;
    }

    if ((pathname === "/v1/enterprises/farming/store/fertiliser" || pathname === "/v1/enterprises/farming/store/husbandry") && req.method === "POST") {
      const ctx = await authContext(req, res);
      if (!ctx) return;
      const body = await readJson(req);
      const result = pathname.endsWith("/fertiliser")
        ? await mobileFarming.buyFertiliser(ctx, body.fertiliserId, body.qty)
        : await mobileFarming.buyHusbandry(ctx, body.itemId, body.qty);
      if (!result.ok) {
        json(res, result.statusCode || 400, { message: result.message });
        return;
      }
      json(res, 200, result.body);
      return;
    }

    if (pathname === "/v1/enterprises/farming/machines" && req.method === "GET") {
      const ctx = await authContext(req, res);
      if (!ctx) return;
      const result = await mobileFarming.machines(ctx);
      if (!result.ok) {
        json(res, result.statusCode || 400, { message: result.message });
        return;
      }
      json(res, 200, result.body);
      return;
    }

    const farmingMachineMatch = pathname.match(/^\/v1\/enterprises\/farming\/machines\/(buy|rent|sell)$/);
    if (req.method === "POST" && farmingMachineMatch) {
      const ctx = await authContext(req, res);
      if (!ctx) return;
      const body = await readJson(req);
      const result = await mobileFarming.machineAction(ctx, decodeURIComponent(farmingMachineMatch[1]), body.machineId);
      if (!result.ok) {
        json(res, result.statusCode || 400, { message: result.message });
        return;
      }
      json(res, 200, result.body);
      return;
    }

    if (pathname === "/v1/enterprises/farming/market" && req.method === "GET") {
      const ctx = await authContext(req, res);
      if (!ctx) return;
      const result = await mobileFarming.marketView(ctx);
      if (!result.ok) {
        json(res, result.statusCode || 400, { message: result.message });
        return;
      }
      json(res, 200, result.body);
      return;
    }

    if (pathname === "/v1/enterprises/farming/market/sell" && req.method === "POST") {
      const ctx = await authContext(req, res);
      if (!ctx) return;
      const body = await readJson(req);
      const result = await mobileFarming.sellMarketItem(ctx, body.itemId);
      if (!result.ok) {
        json(res, result.statusCode || 400, { message: result.message });
        return;
      }
      json(res, 200, result.body);
      return;
    }

    if (req.method === "GET" && pathname === "/v1/rituals") {
      const ctx = await authContext(req, res);
      if (!ctx) return;
      const result = await mobileRituals.list(ctx);
      if (!result.ok) {
        json(res, result.statusCode || 400, { message: result.message });
        return;
      }
      json(res, 200, result.body);
      return;
    }

    const ritualClaimMatch = pathname.match(/^\/v1\/rituals\/([^/]+)\/claim$/);
    if (req.method === "POST" && ritualClaimMatch) {
      const ctx = await authContext(req, res);
      if (!ctx) return;
      const result = await mobileRituals.claim(ctx, decodeURIComponent(ritualClaimMatch[1]));
      if (!result.ok) {
        json(res, result.statusCode || 400, result.body || { message: result.message });
        return;
      }
      json(res, 200, result.body);
      return;
    }

    const ritualStartMatch = pathname.match(/^\/v1\/rituals\/([^/]+)\/start$/);
    if (req.method === "POST" && ritualStartMatch) {
      const ctx = await authContext(req, res);
      if (!ctx) return;
      const result = await mobileInteractiveRituals.start(ctx, decodeURIComponent(ritualStartMatch[1]));
      if (!result.ok) {
        json(res, result.statusCode || 400, result.body || { message: result.message });
        return;
      }
      json(res, 200, result.body);
      return;
    }

    const ritualSessionMatch = pathname.match(/^\/v1\/rituals\/sessions\/([^/]+)$/);
    if (req.method === "GET" && ritualSessionMatch) {
      const ctx = await authContext(req, res);
      if (!ctx) return;
      const result = await mobileInteractiveRituals.get(ctx, decodeURIComponent(ritualSessionMatch[1]));
      if (!result.ok) {
        json(res, result.statusCode || 400, { message: result.message });
        return;
      }
      json(res, 200, result.body);
      return;
    }

    const ritualSessionActionMatch = pathname.match(/^\/v1\/rituals\/sessions\/([^/]+)\/action$/);
    if (req.method === "POST" && ritualSessionActionMatch) {
      const ctx = await authContext(req, res);
      if (!ctx) return;
      const body = await readJson(req);
      const result = await mobileInteractiveRituals.action(ctx, decodeURIComponent(ritualSessionActionMatch[1]), body);
      if (!result.ok) {
        json(res, result.statusCode || 400, result.body || { message: result.message });
        return;
      }
      json(res, 200, result.body);
      return;
    }

    if (req.method === "GET" && pathname === "/v1/casino/tables/open") {
      const ctx = await authContext(req, res);
      if (!ctx) return;
      const result = await mobileCasinoTables.listOpenTables(ctx);
      json(res, 200, result.body);
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

    const blackjackTablesBase = pathname === "/v1/casino/blackjack/tables";
    if (blackjackTablesBase && req.method === "GET") {
      const ctx = await authContext(req, res);
      if (!ctx) return;
      const result = await mobileCasinoTables.listTables(ctx, "blackjack");
      json(res, 200, result.body);
      return;
    }
    if (blackjackTablesBase && req.method === "POST") {
      const ctx = await authContext(req, res);
      if (!ctx) return;
      const body = await readJson(req);
      const result = await mobileCasinoTables.createTable(ctx, "blackjack", { source: body.source || "app" });
      if (!result.ok) {
        json(res, result.statusCode || 400, { message: result.message });
        return;
      }
      json(res, 200, await tableCreateResponse(ctx, result, Boolean(body.announceToDiscord)));
      return;
    }

    const blackjackTableMatch = pathname.match(/^\/v1\/casino\/blackjack\/tables\/([^/]+)(?:\/([^/]+))?$/);
    if (blackjackTableMatch) {
      const ctx = await authContext(req, res);
      if (!ctx) return;
      const tableId = decodeURIComponent(blackjackTableMatch[1]);
      const action = blackjackTableMatch[2] ? decodeURIComponent(blackjackTableMatch[2]) : null;
      let result = null;
      if (req.method === "GET" && !action) result = await mobileCasinoTables.getTable(ctx, "blackjack", tableId);
      else if (req.method === "POST" && action === "join") result = await mobileCasinoTables.joinTable(ctx, "blackjack", tableId);
      else if (req.method === "POST" && action === "leave") result = await mobileCasinoTables.leaveTable(ctx, "blackjack", tableId);
      else if (req.method === "POST" && action === "bet") result = await mobileCasinoTables.setTableBet(ctx, "blackjack", tableId, (await readJson(req)).amount);
      else if (req.method === "POST" && action === "clear-bet") result = await mobileCasinoTables.clearBlackjackBet(ctx, tableId);
      else if (req.method === "POST" && action === "start") result = await mobileCasinoTables.startBlackjack(ctx, tableId);
      else if (req.method === "POST" && ["hit", "stand", "double", "split"].includes(action)) result = await mobileCasinoTables.bjAction(ctx, tableId, action);
      else {
        notFound(res);
        return;
      }
      if (!result.ok) {
        json(res, result.statusCode || 400, { message: result.message });
        return;
      }
      if (req.method === "POST") await maybeUpdateDiscordTable(result.body, action);
      json(res, 200, result.body);
      return;
    }

    const blackjackActionMatch = pathname.match(/^\/v1\/casino\/blackjack\/([^/]+)\/(hit|stand|double|split)$/);
    if (req.method === "POST" && blackjackActionMatch) {
      const ctx = await authContext(req, res);
      if (!ctx) return;
      const gameId = decodeURIComponent(blackjackActionMatch[1]);
      const action = blackjackActionMatch[2];
      const handlers = {
        hit: mobileBlackjack.hit,
        stand: mobileBlackjack.stand,
        double: mobileBlackjack.doubleDown,
        split: mobileBlackjack.split,
      };
      const result = await handlers[action](ctx, gameId);

      if (!result.ok) {
        json(res, result.statusCode || 400, { message: result.message });
        return;
      }
      json(res, 200, result.body);
      return;
    }

    if (req.method === "POST" && pathname === "/v1/casino/higher-lower/start") {
      const ctx = await authContext(req, res);
      if (!ctx) return;
      const body = await readJson(req);
      const result = await mobileHigherLower.startGame(ctx, body.bet);
      if (!result.ok) {
        json(res, result.statusCode || 400, { message: result.message });
        return;
      }
      json(res, 200, result.body);
      return;
    }

    const higherLowerTablesBase = pathname === "/v1/casino/higher-lower/tables";
    if (higherLowerTablesBase && req.method === "GET") {
      const ctx = await authContext(req, res);
      if (!ctx) return;
      const result = await mobileCasinoTables.listTables(ctx, "higher_lower");
      json(res, 200, result.body);
      return;
    }
    if (higherLowerTablesBase && req.method === "POST") {
      const ctx = await authContext(req, res);
      if (!ctx) return;
      const body = await readJson(req);
      const result = await mobileCasinoTables.createTable(ctx, "higher_lower", { source: body.source || "app" });
      if (!result.ok) {
        json(res, result.statusCode || 400, { message: result.message });
        return;
      }
      json(res, 200, await tableCreateResponse(ctx, result, Boolean(body.announceToDiscord)));
      return;
    }

    const higherLowerTableMatch = pathname.match(/^\/v1\/casino\/higher-lower\/tables\/([^/]+)(?:\/([^/]+))?$/);
    if (higherLowerTableMatch) {
      const ctx = await authContext(req, res);
      if (!ctx) return;
      const tableId = decodeURIComponent(higherLowerTableMatch[1]);
      const action = higherLowerTableMatch[2] ? decodeURIComponent(higherLowerTableMatch[2]) : null;
      let result = null;
      if (req.method === "GET" && !action) result = await mobileCasinoTables.getTable(ctx, "higher_lower", tableId);
      else if (req.method === "POST" && action === "join") result = await mobileCasinoTables.joinTable(ctx, "higher_lower", tableId);
      else if (req.method === "POST" && action === "leave") result = await mobileCasinoTables.leaveTable(ctx, "higher_lower", tableId);
      else if (req.method === "POST" && action === "bet") result = await mobileCasinoTables.setTableBet(ctx, "higher_lower", tableId, (await readJson(req)).amount);
      else if (req.method === "POST" && action === "start") result = await mobileCasinoTables.startHigherLower(ctx, tableId);
      else if (req.method === "POST" && action === "guess") result = await mobileCasinoTables.guessHigherLower(ctx, tableId, (await readJson(req)).pick);
      else if (req.method === "POST" && action === "cashout") result = await mobileCasinoTables.cashoutHigherLower(ctx, tableId);
      else {
        notFound(res);
        return;
      }
      if (!result.ok) {
        json(res, result.statusCode || 400, { message: result.message });
        return;
      }
      if (req.method === "POST") await maybeUpdateDiscordTable(result.body, action);
      json(res, 200, result.body);
      return;
    }

    const higherLowerActionMatch = pathname.match(/^\/v1\/casino\/higher-lower\/([^/]+)\/(guess|cashout)$/);
    if (req.method === "POST" && higherLowerActionMatch) {
      const ctx = await authContext(req, res);
      if (!ctx) return;
      const gameId = decodeURIComponent(higherLowerActionMatch[1]);
      const action = higherLowerActionMatch[2];
      const result = action === "guess"
        ? await mobileHigherLower.guess(ctx, gameId, (await readJson(req)).pick)
        : await mobileHigherLower.cashout(ctx, gameId);

      if (!result.ok) {
        json(res, result.statusCode || 400, { message: result.message });
        return;
      }
      json(res, 200, result.body);
      return;
    }

    if (req.method === "GET" && pathname === "/v1/casino/inside-track/current") {
      const ctx = await authContext(req, res);
      if (!ctx) return;
      const result = await mobileInsideTrack.getCurrent(ctx);
      if (!result.ok) {
        json(res, result.statusCode || 400, { message: result.message });
        return;
      }
      json(res, 200, result.body);
      return;
    }

    if (req.method === "POST" && pathname === "/v1/casino/inside-track/bet") {
      const ctx = await authContext(req, res);
      if (!ctx) return;
      const body = await readJson(req);
      const result = await mobileInsideTrack.placeBet(ctx, body);
      if (!result.ok) {
        json(res, result.statusCode || 400, { message: result.message });
        return;
      }
      json(res, 200, result.body);
      return;
    }

    const insideTrackRaceMatch = pathname.match(/^\/v1\/casino\/inside-track\/races\/([^/]+)$/);
    if (req.method === "GET" && insideTrackRaceMatch) {
      const ctx = await authContext(req, res);
      if (!ctx) return;
      const raceId = decodeURIComponent(insideTrackRaceMatch[1]);
      const result = await mobileInsideTrack.getRace(ctx, raceId);
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

async function startApiServer({ port = process.env.PORT || DEFAULT_PORT, client = null } = {}) {
  discordClient = client;
  await appLinking.ensureSchema();
  await mobileInteractiveRituals.ensureSchema();
  await mobileBlackjack.ensureSchema();
  await mobileHigherLower.ensureSchema();
  await mobileInsideTrack.ensureSchema();
  await mobileBank.ensureSchema();
  await mobileCasinoTables.ensureSchema();

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
