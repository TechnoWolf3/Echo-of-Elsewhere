"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const { createMeridianBridge } = require("./meridianBridge");
const TOKEN = "test-secret-".repeat(4);
const LIVE = "1562601698315206726";
const EVENTS = "1562601993556594729";
function fixture() {
  let clock = 1700000000000;
  const posts = [];
  const client = { isReady: () => true, channels: { fetch: async id => ({ isTextBased: () => true, send: async payload => posts.push({ id, ...payload }) }) } };
  const bridge = createMeridianBridge({ client, token: TOKEN, now: () => clock, log: { error() {} } });
  async function call(path, body, token = TOKEN) {
    const request = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
    Object.assign(request, { url: "/v1/meridian/" + path, method: body === undefined ? "GET" : "POST", headers: { authorization: `Bearer ${token}` } });
    const response = { headersSent: false, writeHead(status) { this.status = status; this.headersSent = true; }, end(raw) { this.body = JSON.parse(raw); } };
    assert.equal(await bridge.handle(request, response), true);
    return response;
  }
  return { bridge, posts, call, advance: ms => { clock += ms; } };
}
test("bad credentials cannot post or read chat", async () => {
  const f = fixture();
  assert.equal((await f.call("events", { type: "server_start", id: "one" }, "wrong")).status, 401);
  assert.equal((await f.call("messages", undefined, "wrong")).status, 401);
  assert.equal(f.posts.length, 0);
});
test("chat routes to Live Feed and cannot ping Discord roles or everyone", async () => {
  const f = fixture();
  const result = await f.call("events", { id: "chat1", type: "chat", player: "Techno", message: "@everyone <@&123> **hello**" });
  assert.equal(result.status, 200);
  assert.equal(f.posts[0].id, LIVE);
  assert.deepEqual(f.posts[0].allowedMentions.parse, []);
  assert.match(f.posts[0].content, /\\\*\\\*hello/);
});
test("simultaneous event retries deliver only once", async () => {
  const f = fixture();
  const event = { id: "catch1", type: "legendary_capture", player: "Techno", pokemon: "Mew", shiny: true };
  await Promise.all([f.call("events", event), f.call("events", event)]);
  assert.equal(f.posts.length, 1);
  assert.equal(f.posts[0].id, EVENTS);
  assert.match(f.posts[0].content, /shiny/);
});
test("only human text from Live Feed enters the Minecraft queue", async () => {
  const f = fixture();
  await f.call("heartbeat", {});
  const message = { channelId: LIVE, guildId: "guild", author: { username: "Shey", bot: false }, cleanContent: "/op me", member: { displayName: "Shey" } };
  f.bridge.onMessage({ ...message, author: { bot: true } });
  f.bridge.onMessage({ ...message, webhookId: "webhook" });
  f.bridge.onMessage({ ...message, channelId: EVENTS });
  f.bridge.onMessage(message);
  const messages = (await f.call("messages")).body.messages;
  assert.equal(messages.length, 1);
  assert.equal(messages[0].text, "/op me"); // Data only: the Minecraft adapter uses literal chat components.
  assert.deepEqual((await f.call("messages?after=" + messages[0].id)).body.messages, []);
});
test("chat expires and unavailable servers do not receive a backlog", async () => {
  const f = fixture();
  const message = { channelId: LIVE, guildId: "guild", author: { username: "Shey" }, cleanContent: "hello" };
  f.bridge.onMessage(message);
  assert.deepEqual((await f.call("messages")).body.messages, []);
  await f.call("heartbeat", {});
  f.bridge.onMessage(message);
  f.advance(121000);
  assert.deepEqual((await f.call("messages")).body.messages, []);
  f.bridge.onMessage(message);
  assert.deepEqual((await f.call("messages")).body.messages, []);
});
test("disconnect notice is sent once, then restoration is announced", async () => {
  const f = fixture();
  await f.call("heartbeat", {});
  f.advance(91000);
  await f.bridge.checkConnection();
  await f.bridge.checkConnection();
  assert.equal(f.posts.length, 1);
  assert.match(f.posts[0].content, /lost contact/);
  await f.call("heartbeat", {});
  assert.match(f.posts[1].content, /restored/);
});
test("unknown events, empty messages and invalid cursors are rejected", async () => {
  const f = fixture();
  assert.equal((await f.call("events", { id: "x", type: "command", message: "op user" })).status, 400);
  assert.equal((await f.call("events", { id: "x", type: "chat", message: "" })).status, 400);
  assert.equal((await f.call("messages?after=NaN")).status, 400);
  assert.equal(f.posts.length, 0);
});
test("failed Discord delivery can be retried", async () => {
  let attempts = 0;
  const posts = [];
  const bridge = createMeridianBridge({ token: TOKEN, log: { error() {} }, client: { isReady: () => true, channels: { fetch: async () => ({ isTextBased: () => true, send: async body => { if (++attempts === 1) throw new Error("unavailable"); posts.push(body); } }) } } });
  async function send() {
    const req = Readable.from([JSON.stringify({ id: "retry", type: "server_start" })]);
    Object.assign(req, { url: "/v1/meridian/events", method: "POST", headers: { authorization: `Bearer ${TOKEN}` } });
    const res = { writeHead(status) { this.status = status; }, end() {} };
    await bridge.handle(req, res); return res.status;
  }
  assert.equal(await send(), 503);
  assert.equal(await send(), 200);
  assert.equal(posts.length, 1);
});

test("event announcements go only to Meridian Events and Discord guesses never enter Minecraft", async () => {
  const f = fixture();
  assert.equal((await f.call("events", { id: "event:start", type: "game_event", message: "Who's that Pokémon? @everyone" })).status, 200);
  assert.equal(f.posts[0].id, EVENTS);
  assert.match(f.posts[0].content, /Minecraft only/);
  assert.deepEqual(f.posts[0].allowedMentions.parse, []);
  await f.call("heartbeat", {});
  for (const channelId of [LIVE, EVENTS]) for (const cleanContent of ["/guess Pikachu", "!guess Pikachu"]) {
    f.bridge.onMessage({ channelId, cleanContent, guildId: "guild", author: { username: "Shey" } });
  }
  assert.deepEqual((await f.call("messages")).body.messages, []);
  assert.equal((await f.call("events", { id: "invalid", type: "game_event", message: "" })).status, 400);
});
