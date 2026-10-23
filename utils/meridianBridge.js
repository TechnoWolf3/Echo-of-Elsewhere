"use strict";

const { timingSafeEqual } = require("node:crypto");

const LIVE_CHANNEL = "1562601698315206726";
const EVENTS_CHANNEL = "1562601993556594729";
const TYPES = new Set(["chat", "player_join", "player_leave", "server_start", "server_stop", "restart_notice", "shiny_capture", "legendary_capture", "legendary_spawn", "game_event"]);
const clean = (value, max = 400) => String(value ?? "").replace(/[\u0000-\u001f\u007f§]/g, " ").slice(0, max);
const markdown = (value, max = 400) => clean(value, max).replace(/([\\*_~`>|])/g, "\\$1");

function createMeridianBridge({ client, token = process.env.MERIDIAN_BRIDGE_TOKEN || "", now = Date.now, liveChannel = LIVE_CHANNEL, eventsChannel = EVENTS_CHANNEL, log = console } = {}) {
  // Queues deliberately expire: never replay old Discord chat into a new play session.
  const queue = [];
  const seen = new Map();
  let serial = 0;
  let lastHeartbeat = 0;
  let connected = false;
  let warnedOffline = false;
  let bucketStart = 0;
  let requests = 0;
  let processing = Promise.resolve();
  const enabled = token.length >= 32;

  function reply(res, status, body) {
    const data = JSON.stringify(body);
    res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), "Cache-Control": "no-store" });
    res.end(data);
  }

  function authorized(req) {
    const supplied = Buffer.from(String(req.headers.authorization || ""));
    const expected = Buffer.from(`Bearer ${token}`);
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  }

  async function post(channelId, content) {
    if (!client?.isReady()) throw new Error("Echo is not connected to Discord");
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased() || typeof channel.send !== "function") throw new Error("Meridian channel is unavailable");
    await channel.send({ content: content.slice(0, 1900), allowedMentions: { parse: [], repliedUser: false } });
  }

  function render(event) {
    const player = markdown(event.player || "A player");
    const pokemon = markdown(event.pokemon || "Pokémon");
    switch (event.type) {
      case "chat": return [liveChannel, `**${player}** » ${markdown(event.message)}`];
      case "player_join": return [liveChannel, `→ **${player}** joined Meridian.`];
      case "player_leave": return [liveChannel, `← **${player}** left Meridian.`];
      case "server_start": return [eventsChannel, "🟢 **Meridian is online.**"];
      case "server_stop": return [eventsChannel, "🔴 **Meridian has stopped.**"];
      case "restart_notice": return [eventsChannel, `🔄 **Meridian restart:** ${markdown(event.message)}`];
      case "game_event": return [eventsChannel, `🎮 **Echo Event · Minecraft only**\n${markdown(event.message, 1000)}`];
      case "shiny_capture": return [eventsChannel, `✨ **${player}** caught a shiny **${pokemon}**!`];
      case "legendary_capture": return [eventsChannel, `🏆 **${player}** caught ${event.shiny ? "a shiny " : ""}legendary **${pokemon}**!`];
      case "legendary_spawn": return [eventsChannel, `🌌 A ${event.shiny ? "shiny " : ""}legendary **${pokemon}** has appeared in Meridian!`];
      default: throw new Error("Unknown event type");
    }
  }

  async function readBody(req) {
    let raw = "";
    let size = 0;
    for await (const chunk of req) {
      size += Buffer.byteLength(chunk);
      if (size > 16384) throw Object.assign(new Error("Body too large"), { status: 413 });
      raw += chunk;
    }
    try { return JSON.parse(raw); }
    catch { throw Object.assign(new Error("Invalid JSON"), { status: 400 }); }
  }

  async function accept(event) {
    if (!event || !TYPES.has(event.type) || !/^[a-zA-Z0-9:_-]{1,160}$/.test(event.id || "")) {
      throw Object.assign(new Error("Invalid event"), { status: 400 });
    }
    if ((event.type === "chat" || event.type === "restart_notice" || event.type === "game_event") && (typeof event.message !== "string" || !event.message.trim() || event.message.length > 1000)) {
      throw Object.assign(new Error("Invalid message"), { status: 400 });
    }
    if (seen.has(event.id)) return;
    const [channel, text] = render(event);
    await post(channel, text);
    seen.set(event.id, now());
    while (seen.size > 4000) seen.delete(seen.keys().next().value);
    if (event.type === "server_start") { connected = true; lastHeartbeat = now(); warnedOffline = false; queue.length = 0; }
    if (event.type === "server_stop") { connected = false; queue.length = 0; }
  }

  async function handle(req, res) {
    const url = new URL(req.url, "http://localhost");
    if (!url.pathname.startsWith("/v1/meridian/")) return false;
    try {
      if (!enabled) { reply(res, 503, { error: "Meridian bridge is disabled" }); return true; }
      if (!authorized(req)) { reply(res, 401, { error: "Unauthorized" }); return true; }
      if (now() - bucketStart >= 60000) { bucketStart = now(); requests = 0; }
      if (++requests > 180) { reply(res, 429, { error: "Rate limit" }); return true; }
      if (req.method === "POST" && url.pathname === "/v1/meridian/heartbeat") {
        await readBody(req);
        const wasLost = warnedOffline;
        lastHeartbeat = now(); connected = true; warnedOffline = false;
        if (wasLost) await post(eventsChannel, "🟢 **The connection to Meridian has been restored.**");
        reply(res, 200, { ok: true }); return true;
      }
      if (req.method === "POST" && url.pathname === "/v1/meridian/events") {
        const event = await readBody(req);
        // Serialize deliveries so retries of a concurrent ID cannot produce duplicates.
        const task = processing.then(() => accept(event));
        processing = task.catch(() => {});
        await task;
        reply(res, 200, { ok: true }); return true;
      }
      if (req.method === "GET" && url.pathname === "/v1/meridian/messages") {
        const after = Number(url.searchParams.get("after") || 0);
        if (!Number.isSafeInteger(after) || after < 0) { reply(res, 400, { error: "Invalid cursor" }); return true; }
        while (queue.length && queue[0].expiresAt <= now()) queue.shift();
        reply(res, 200, { messages: queue.filter(item => item.id > after).slice(0, 30).map(({ id, author, text }) => ({ id, author, text })) });
        return true;
      }
      reply(res, 404, { error: "Not found" });
    } catch (error) {
      if (!error.status) log.error("[Meridian] Delivery failed; server may retry.");
      if (!res.headersSent) reply(res, error.status || 503, { error: error.status ? error.message : "Delivery temporarily unavailable" });
    }
    return true;
  }

  function onMessage(message) {
    if (!enabled || message.channelId !== liveChannel || !message.guildId || message.author?.bot || message.webhookId || message.system) return;
    if (!connected || now() - lastHeartbeat > 90000) return;
    const text = clean(message.cleanContent, 500).trim();
    if (!text) return;
    if (/^[!/]guess(?:\s|$)/i.test(text)) return;
    serial = Math.max(serial + 1, now() * 1000);
    queue.push({ id: serial, author: clean(message.member?.displayName || message.author?.username || "Discord", 40), text, expiresAt: now() + 120000 });
    while (queue.length > 200) queue.shift();
  }

  async function checkConnection() {
    if (!enabled || !connected || warnedOffline || now() - lastHeartbeat <= 90000) return;
    await post(eventsChannel, "⚠️ **Echo lost contact with Meridian.** The server or bridge may be offline.");
    warnedOffline = true;
    queue.length = 0;
  }

  function attach() {
    if (!enabled) { log.info("[Meridian] Disabled: set MERIDIAN_BRIDGE_TOKEN (at least 32 characters) to enable."); return () => {}; }
    if (!client) { log.info("[Meridian] No Discord client attached; bridge delivery is unavailable in API-only mode."); return () => {}; }
    client.on("messageCreate", onMessage);
    const timer = setInterval(() => checkConnection().catch(() => log.error("[Meridian] Could not send connection notice.")), 30000);
    timer.unref();
    return () => { clearInterval(timer); client.off("messageCreate", onMessage); };
  }

  return { handle, attach, onMessage, checkConnection };
}

let activeBridge;
function start(client) {
  if (activeBridge) throw new Error("Meridian bridge already started");
  activeBridge = createMeridianBridge({ client });
  const detach = activeBridge.attach();
  return () => { detach(); activeBridge = null; };
}
async function handle(req, res) {
  if (activeBridge) return activeBridge.handle(req, res);
  return false;
}
module.exports = { createMeridianBridge, start, handle };
