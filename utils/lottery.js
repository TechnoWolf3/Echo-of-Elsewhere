// utils/lottery.js
// Weekly AU Powerball-style lottery (7/35 + PB 1/20), progressive jackpot, restart-safe.

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags
} = require("discord.js");

const { pool } = require("./db");
const economy = require("./economy");
const config = require("../data/lottery/config");

function tzParts(dateMs = Date.now(), timeZone = config.timezone) {
  const d = new Date(dateMs);
  const fmt = new Intl.DateTimeFormat("en-AU", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map(p => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second)
  };
}

// Convert a local time in the configured timeZone into a UTC epoch (ms)
function localToUtcMs({ year, month, day, hour, minute, second = 0 }, timeZone = config.timezone) {
  const assumedUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const asLocal = tzParts(assumedUtc, timeZone);
  const localAsUtc = Date.UTC(asLocal.year, asLocal.month - 1, asLocal.day, asLocal.hour, asLocal.minute, asLocal.second);
  const offsetMs = localAsUtc - assumedUtc;
  return assumedUtc - offsetMs;
}

function weekdayAEST(dateMs = Date.now()) {
  const p = tzParts(dateMs);
  const utc = Date.UTC(p.year, p.month - 1, p.day, 12, 0, 0);
  return new Date(utc).getUTCDay();
}

function nextDrawUtcMs(nowMs = Date.now()) {
  const nowP = tzParts(nowMs);
  const nowW = weekdayAEST(nowMs);
  const targetW = config.drawWeekday;
  let delta = (targetW - nowW + 7) % 7;
  if (delta === 0) {
    if (nowP.hour > config.drawHour || (nowP.hour === config.drawHour && nowP.minute >= config.drawMinute)) {
      delta = 7;
    }
  }
  const baseUtc = localToUtcMs({ year: nowP.year, month: nowP.month, day: nowP.day, hour: 12, minute: 0, second: 0 });
  const targetMidLocal = tzParts(baseUtc + delta * 86400000);
  return localToUtcMs({
    year: targetMidLocal.year,
    month: targetMidLocal.month,
    day: targetMidLocal.day,
    hour: config.drawHour,
    minute: config.drawMinute,
    second: 0
  });
}

function drawKeyFromDrawUtc(drawUtcMs) {
  const p = tzParts(drawUtcMs);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function salesCloseUtcMs(drawUtcMs) {
  return drawUtcMs - config.salesCloseHoursBefore * 3600000;
}

function formatMoney(n) {
  const v = Math.max(0, Math.floor(Number(n) || 0));
  return `$${v.toLocaleString("en-AU")}`;
}

async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lottery_state (
      guild_id TEXT PRIMARY KEY,
      jackpot BIGINT NOT NULL DEFAULT 0,
      reserve BIGINT NOT NULL DEFAULT 0,
      div_carry BIGINT NOT NULL DEFAULT 0,
      last_seed_month TEXT,
      last_draw_key TEXT,
      post_channel_id TEXT,
      post_message_id TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS lottery_tickets (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      draw_key TEXT NOT NULL,
      numbers JSONB NOT NULL,
      purchased_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_lottery_tickets_draw ON lottery_tickets (guild_id, draw_key);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_lottery_tickets_user ON lottery_tickets (guild_id, user_id, draw_key);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS lottery_draws (
      guild_id TEXT NOT NULL,
      draw_key TEXT NOT NULL,
      draw_utc TIMESTAMPTZ NOT NULL,
      sales_close_utc TIMESTAMPTZ NOT NULL,
      winning JSONB,
      tickets_sold INT NOT NULL DEFAULT 0,
      sales_total BIGINT NOT NULL DEFAULT 0,
      divisional_total BIGINT NOT NULL DEFAULT 0,
      divisional_paid BIGINT NOT NULL DEFAULT 0,
      jackpot_before BIGINT NOT NULL DEFAULT 0,
      jackpot_paid BIGINT NOT NULL DEFAULT 0,
      jackpot_after BIGINT NOT NULL DEFAULT 0,
      seeded BIGINT NOT NULL DEFAULT 0,
      winners JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, draw_key)
    );
  `);
}

async function getState(guildId) {
  await ensureTables();
  await pool.query(
    `INSERT INTO lottery_state (guild_id, post_channel_id) VALUES ($1, $2)
     ON CONFLICT (guild_id) DO NOTHING`,
    [guildId, config.channelId]
  );
  const res = await pool.query(`SELECT * FROM lottery_state WHERE guild_id=$1`, [guildId]);
  return res.rows[0];
}

async function setState(guildId, patch) {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  const sets = keys.map((k, i) => `${k}=$${i + 2}`).join(", ");
  const vals = keys.map(k => patch[k]);
  await pool.query(`UPDATE lottery_state SET ${sets}, updated_at=NOW() WHERE guild_id=$1`, [guildId, ...vals]);
}

function pickUnique(count, max) {
  const set = new Set();
  while (set.size < count) set.add(1 + Math.floor(Math.random() * max));
  return Array.from(set).sort((a, b) => a - b);
}

function quickPick() {
  return {
    main: pickUnique(config.balls.mainPick, config.balls.mainMax),
    power: 1 + Math.floor(Math.random() * config.balls.powerMax)
  };
}

function divisionForTicket(ticketNums, winningNums) {
  const mainMatches = ticketNums.main.filter(n => winningNums.main.includes(n)).length;
  const pbMatch = ticketNums.power === winningNums.power;

  if (mainMatches === 7 && pbMatch) return "D1";
  if (mainMatches === 7 && !pbMatch) return "D2";
  if (mainMatches === 6 && pbMatch) return "D3";
  if (mainMatches === 6 && !pbMatch) return "D4";
  if (mainMatches === 5 && pbMatch) return "D5";
  if (mainMatches === 5 && !pbMatch) return "D6";
  if (mainMatches === 4 && pbMatch) return "D7";
  if (mainMatches === 4 && !pbMatch) return "D8";
  if (mainMatches === 3 && pbMatch) return "D9";
  return null;
}

function buildWeeklyEmbed({ drawUtc, closeUtc, jackpot, ticketsSold }) {
  const drawUnix = Math.floor(drawUtc / 1000);
  const closeUnix = Math.floor(closeUtc / 1000);

  const e = new EmbedBuilder()
    .setTitle(config.embed.title)
    .setDescription([
      `**Next Draw:** <t:${drawUnix}:F>  •  <t:${drawUnix}:R>`,
      `**Sales Close:** <t:${closeUnix}:F>  •  <t:${closeUnix}:R>`,
      ``,
      `**Jackpot:** ${formatMoney(jackpot)}`,
      `**Tickets Sold:** **${ticketsSold.toLocaleString("en-AU")}**`,
      ``,
      `**How to enter:**`,
      ...config.embed.howTo.map(x => `• ${x}`)
    ].join("\n"))
    .setFooter({ text: config.embed.footer });

  return e;
}

function buildButtons(disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("lotto:buy:1")
      .setLabel("Buy 1 Ticket")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`lotto:buy:${config.maxTicketsPerUser}`)
      .setLabel(`Buy ${config.maxTicketsPerUser} Tickets`)
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId("lotto:my")
      .setLabel("My Tickets")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled)
  );
}

async function getDrawRow(guildId, drawKey, drawUtc, closeUtc) {
  await pool.query(
    `INSERT INTO lottery_draws (guild_id, draw_key, draw_utc, sales_close_utc)
     VALUES ($1,$2,to_timestamp($3),to_timestamp($4))
     ON CONFLICT (guild_id, draw_key) DO NOTHING`,
    [guildId, drawKey, drawUtc / 1000, closeUtc / 1000]
  );
  const res = await pool.query(`SELECT * FROM lottery_draws WHERE guild_id=$1 AND draw_key=$2`, [guildId, drawKey]);
  return res.rows[0];
}

async function countTickets(guildId, drawKey) {
  const res = await pool.query(`SELECT COUNT(*)::int AS c FROM lottery_tickets WHERE guild_id=$1 AND draw_key=$2`, [guildId, drawKey]);
  return res.rows[0]?.c ?? 0;
}

async function countUserTickets(guildId, userId, drawKey) {
  const res = await pool.query(
    `SELECT COUNT(*)::int AS c FROM lottery_tickets WHERE guild_id=$1 AND user_id=$2 AND draw_key=$3`,
    [guildId, userId, drawKey]
  );
  return res.rows[0]?.c ?? 0;
}

async function listUserTickets(guildId, userId, drawKey, limit = 10) {
  const res = await pool.query(
    `SELECT numbers FROM lottery_tickets WHERE guild_id=$1 AND user_id=$2 AND draw_key=$3 ORDER BY id DESC LIMIT $4`,
    [guildId, userId, drawKey, limit]
  );
  return res.rows.map(r => r.numbers);
}

async function maybeSeedJackpot(guildId, nowMs, drawUtcMs) {
  const closeMs = salesCloseUtcMs(drawUtcMs);
  if (nowMs < closeMs) return { seeded: 0 };

  const st = await getState(guildId);
  const seedMonth = (() => {
    const p = tzParts(nowMs);
    return `${p.year}-${String(p.month).padStart(2, "0")}`;
  })();

  if (st.last_seed_month === seedMonth) return { seeded: 0 };

  const need = Math.max(0, config.seed.minJackpot - Number(st.jackpot || 0));
  if (need <= 0) return { seeded: 0 };

  let seeded = 0;
  let reserve = Number(st.reserve || 0);
  let jackpot = Number(st.jackpot || 0);

  const fromReserve = Math.min(need, reserve);
  if (fromReserve > 0) {
    reserve -= fromReserve;
    jackpot += fromReserve;
    seeded += fromReserve;
  }

  const remaining = need - seeded;
  if (remaining > 0) {
    const bank = await economy.getServerBank(guildId);
    const fromBank = Math.min(remaining, bank);
    if (fromBank > 0) {
      await economy.addServerBank(guildId, -fromBank, "lottery_seed", { draw: drawKeyFromDrawUtc(drawUtcMs) });
      jackpot += fromBank;
      seeded += fromBank;
    }
  }

  if (seeded > 0) {
    await setState(guildId, { reserve, jackpot, last_seed_month: seedMonth });
  }

  return { seeded };
}

async function upsertWeeklyPost(client, guildId) {
  if (!config.enabled) return;

  const drawUtc = nextDrawUtcMs();
  const drawKey = drawKeyFromDrawUtc(drawUtc);
  const closeUtc = salesCloseUtcMs(drawUtc);

  await getDrawRow(guildId, drawKey, drawUtc, closeUtc);
  const st = await getState(guildId);
  const ticketsSold = await countTickets(guildId, drawKey);

  const channelId = st.post_channel_id || config.channelId;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return;

  const embed = buildWeeklyEmbed({
    drawUtc,
    closeUtc,
    jackpot: Number(st.jackpot || 0),
    ticketsSold
  });

  const disabled = Date.now() >= closeUtc;
  const row = buildButtons(disabled);

  let oldMessageId = st.post_message_id;
  try {
    const msg = await channel.send({ embeds: [embed], components: [row] });
    await setState(guildId, { post_message_id: msg.id, post_channel_id: channelId });
    if (oldMessageId) await channel.messages.delete(oldMessageId).catch(() => {});
  } catch (e) {
    console.error("[LOTTERY] post failed:", e);
  }
}

function msUntilNextRefresh(nowMs = Date.now()) {
  const nowP = tzParts(nowMs);
  const times = config.refreshTimesAEST
    .map(t => localToUtcMs({ year: nowP.year, month: nowP.month, day: nowP.day, hour: t.hour, minute: t.minute, second: 0 }))
    .sort((a, b) => a - b);

  for (const ts of times) {
    if (ts > nowMs + 1000) return ts - nowMs;
  }

  const tomorrowNoonUtc = localToUtcMs({ year: nowP.year, month: nowP.month, day: nowP.day, hour: 12, minute: 0, second: 0 }) + 86400000;
  const tomP = tzParts(tomorrowNoonUtc);
  const first = config.refreshTimesAEST[0];
  const ts = localToUtcMs({ year: tomP.year, month: tomP.month, day: tomP.day, hour: first.hour, minute: first.minute, second: 0 });
  return ts - nowMs;
}

let _refreshTimer = null;
let _drawTimer = null;

async function scheduleLoop(client) {
  for (const gid of client.guilds.cache.map(g => g.id)) {
    await upsertWeeklyPost(client, gid);
  }

  const refreshTick = async () => {
    const delay = msUntilNextRefresh();
    _refreshTimer = setTimeout(async () => {
      try {
        for (const gid of client.guilds.cache.map(g => g.id)) {
          await upsertWeeklyPost(client, gid);
        }
      } finally {
        refreshTick();
      }
    }, delay);
    _refreshTimer.unref?.();
  };
  refreshTick();

  const drawTick = async () => {
    const now = Date.now();
    const drawUtc = nextDrawUtcMs(now);
    const delay = Math.max(1000, drawUtc - now);
    _drawTimer = setTimeout(async () => {
      try {
        for (const gid of client.guilds.cache.map(g => g.id)) {
          await runDraw(client, gid);
        }
      } finally {
        drawTick();
      }
    }, delay);
    _drawTimer.unref?.();
  };
  drawTick();
}

async function buyTickets(interaction, count) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;

  const drawUtc = nextDrawUtcMs();
  const drawKey = drawKeyFromDrawUtc(drawUtc);
  const closeUtc = salesCloseUtcMs(drawUtc);

  if (Date.now() >= closeUtc) {
    await interaction.reply({ content: "⛔ Ticket sales are closed for this draw (closes 3 hours before draw).", flags: MessageFlags.Ephemeral });
    return true;
  }

  const current = await countUserTickets(guildId, userId, drawKey);
  const remaining = Math.max(0, config.maxTicketsPerUser - current);
  const toBuy = Math.min(count, remaining);

  if (toBuy <= 0) {
    await interaction.reply({ content: `You’ve already hit the **${config.maxTicketsPerUser}** ticket cap for this draw.`, flags: MessageFlags.Ephemeral });
    return true;
  }

  const totalCost = config.ticketPrice * toBuy;
  const bal = await economy.getBalance(guildId, userId);
  if (bal < totalCost) {
    await interaction.reply({ content: `Not enough balance. Need **${formatMoney(totalCost)}**.`, flags: MessageFlags.Ephemeral });
    return true;
  }

  const debit = await economy.tryDebitUser(guildId, userId, totalCost, "lottery_ticket", { draw: drawKey, count: toBuy });
  if (!debit.ok) {
    await interaction.reply({ content: "Not enough balance.", flags: MessageFlags.Ephemeral });
    return true;
  }

  const reserveAdd = Math.floor(totalCost * config.allocation.reserve);
  const divAdd = Math.floor(totalCost * config.allocation.divisional);
  const jackpotAdd = totalCost - reserveAdd - divAdd;

  const st = await getState(guildId);
  await setState(guildId, {
    reserve: Number(st.reserve || 0) + reserveAdd,
    jackpot: Number(st.jackpot || 0) + jackpotAdd
  });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (let i = 0; i < toBuy; i++) {
      await client.query(
        `INSERT INTO lottery_tickets (guild_id, user_id, draw_key, numbers)
         VALUES ($1,$2,$3,$4)`,
        [guildId, userId, drawKey, quickPick()]
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }

  // update draw row info (divisional total includes carry)
  const ticketsSold = await countTickets(guildId, drawKey);
  const perTicketDiv = Math.floor(config.ticketPrice * config.allocation.divisional);
  await pool.query(
    `UPDATE lottery_draws
     SET tickets_sold=$3, sales_total=$4, divisional_total=$5
     WHERE guild_id=$1 AND draw_key=$2`,
    [guildId, drawKey, ticketsSold, ticketsSold * config.ticketPrice, ticketsSold * perTicketDiv + Number(st.div_carry || 0)]
  );

  await upsertWeeklyPost(interaction.client, guildId);

  await interaction.reply({
    content: `✅ Bought **${toBuy}** ticket(s) for **${formatMoney(totalCost)}**. Good luck.`,
    flags: MessageFlags.Ephemeral
  });
  return true;
}

async function showMyTickets(interaction) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;

  const drawUtc = nextDrawUtcMs();
  const drawKey = drawKeyFromDrawUtc(drawUtc);
  const closeUtc = salesCloseUtcMs(drawUtc);

  const current = await countUserTickets(guildId, userId, drawKey);
  const list = await listUserTickets(guildId, userId, drawKey, 10);

  const drawUnix = Math.floor(drawUtc / 1000);
  const closeUnix = Math.floor(closeUtc / 1000);

  const lines = list.map(t => `• **${(t.main || []).join(", ")}** | PB **${t.power}**`);

  await interaction.reply({
    content: [
      `🎟 **Your tickets for draw** <t:${drawUnix}:F> (sales close <t:${closeUnix}:R>)`,
      `You have **${current}/${config.maxTicketsPerUser}** ticket(s).`,
      lines.length ? lines.join("\n") : "_No tickets yet. Use the buttons on the weekly post._"
    ].join("\n"),
    flags: MessageFlags.Ephemeral
  });
  return true;
}

async function runDraw(client, guildId) {
  const now = Date.now();
  const drawUtc = nextDrawUtcMs(now - 1000);
  const drawKey = drawKeyFromDrawUtc(drawUtc);
  const closeUtc = salesCloseUtcMs(drawUtc);

  const row = await getDrawRow(guildId, drawKey, drawUtc, closeUtc);
  if (row.winning) return;

  const seedRes = await maybeSeedJackpot(guildId, now, drawUtc);

  const st = await getState(guildId);
  const jackpotBefore = Number(st.jackpot || 0);

  const winning = quickPick();

  const ticketsRes = await pool.query(
    `SELECT user_id, numbers FROM lottery_tickets WHERE guild_id=$1 AND draw_key=$2`,
    [guildId, drawKey]
  );

  const winnersByDiv = { D1: [], D2: [], D3: [], D4: [], D5: [], D6: [], D7: [], D8: [], D9: [] };
  for (const r of ticketsRes.rows) {
    const div = divisionForTicket(r.numbers, winning);
    if (div) winnersByDiv[div].push(r.user_id);
  }

  const ticketsSold = ticketsRes.rows.length;
  const salesTotal = ticketsSold * config.ticketPrice;

  const perTicketDiv = Math.floor(config.ticketPrice * config.allocation.divisional);
  const divThisWeek = ticketsSold * perTicketDiv;
  const divTotal = Number(st.div_carry || 0) + divThisWeek;

  let divPaid = 0;
  const weights = config.divisionWeights;
  const weightTotal = Object.values(weights).reduce((a, b) => a + b, 0);
  const paidOut = {};

  for (const [div, w] of Object.entries(weights)) {
    const winners = winnersByDiv[div] || [];
    const poolShare = Math.floor(divTotal * (w / weightTotal));
    if (!winners.length) {
      paidOut[div] = { winners: 0, paid: 0 };
      continue;
    }
    const each = Math.floor(poolShare / winners.length);
    const pay = each * winners.length;
    if (each > 0) {
      for (const uid of winners) {
        await economy.creditUser(guildId, uid, each, "lottery_win", { draw: drawKey, division: div });
      }
    }
    divPaid += pay;
    paidOut[div] = { winners: winners.length, paid: pay };
  }

  const divLeftover = Math.max(0, divTotal - divPaid);
  const toJackpot = Math.floor(divLeftover * config.rollover.toJackpotRatio);
  const toCarry = divLeftover - toJackpot;

  const jackpotWinners = winnersByDiv.D1 || [];
  let jackpotPaid = 0;
  let jackpotAfter = jackpotBefore + toJackpot;

  if (jackpotWinners.length) {
    const each = Math.floor(jackpotAfter / jackpotWinners.length);
    jackpotPaid = each * jackpotWinners.length;
    if (each > 0) {
      for (const uid of jackpotWinners) {
        await economy.creditUser(guildId, uid, each, "lottery_jackpot", { draw: drawKey });
      }
    }
    const remainder = Math.max(0, jackpotAfter - jackpotPaid);
    const reserve = Number(st.reserve || 0) + remainder;
    jackpotAfter = 0;
    await setState(guildId, { jackpot: jackpotAfter, div_carry: toCarry, reserve });
  } else {
    await setState(guildId, { jackpot: jackpotAfter, div_carry: toCarry });
  }

  await pool.query(
    `UPDATE lottery_draws
     SET winning=$3,
         tickets_sold=$4,
         sales_total=$5,
         divisional_total=$6,
         divisional_paid=$7,
         jackpot_before=$8,
         jackpot_paid=$9,
         jackpot_after=$10,
         seeded=$11,
         winners=$12
     WHERE guild_id=$1 AND draw_key=$2`,
    [
      guildId,
      drawKey,
      winning,
      ticketsSold,
      salesTotal,
      divTotal,
      divPaid,
      jackpotBefore,
      jackpotPaid,
      jackpotAfter,
      seedRes.seeded,
      { winning, winnersByDiv, paidOut, divLeftover, toJackpot, toCarry }
    ]
  );

  const channelId = (await getState(guildId)).post_channel_id || config.channelId;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return;

  const drawUnix = Math.floor(drawUtc / 1000);

  const desc = [];
  desc.push(`**Draw:** <t:${drawUnix}:F>`);
  desc.push(`**Winning Numbers:** **${winning.main.join(", ")}**  |  **PB ${winning.power}**`);
  desc.push("");
  desc.push(`**Tickets Sold:** ${ticketsSold.toLocaleString("en-AU")}`);
  desc.push(`**Jackpot:** ${formatMoney(jackpotBefore)}${seedRes.seeded ? ` (seeded +${formatMoney(seedRes.seeded)})` : ""}`);

  if (jackpotWinners.length) {
    desc.push("");
    desc.push(`🏆 **JACKPOT WINNER(S):** ${jackpotWinners.length}`);
  } else {
    desc.push("");
    desc.push("No Division 1 winner — jackpot rolls over.");
  }

  const e = new EmbedBuilder()
    .setTitle("🎟 Powerball Results")
    .setDescription(desc.join("\n"));

  const ping = config.pingRoleId ? `<@&${config.pingRoleId}>` : "";
  await channel.send({ content: ping || undefined, embeds: [e] });

  await upsertWeeklyPost(client, guildId);
}

async function handleInteraction(interaction) {
  if (!interaction.isButton?.()) return false;
  if (typeof interaction.customId !== "string") return false;
  if (!interaction.customId.startsWith("lotto:")) return false;
  if (!interaction.inGuild?.() || !interaction.guildId) return false;

  const parts = interaction.customId.split(":");
  const action = parts[1];

  try {
    if (action === "buy") {
      const count = Math.max(1, Math.min(config.maxTicketsPerUser, Number(parts[2] || 1)));
      return await buyTickets(interaction, count);
    }
    if (action === "my") {
      return await showMyTickets(interaction);
    }
    await interaction.reply({ content: "Unknown lottery action.", flags: MessageFlags.Ephemeral });
    return true;
  } catch (e) {
    console.error("[LOTTERY] interaction failed:", e);
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: "❌ Lottery action failed.", flags: MessageFlags.Ephemeral });
      } else {
        await interaction.reply({ content: "❌ Lottery action failed.", flags: MessageFlags.Ephemeral });
      }
    } catch (_) {}
    return true;
  }
}

async function startScheduler(client) {
  if (!config.enabled) return;
  try {
    await ensureTables();
  } catch (e) {
    console.error("[LOTTERY] ensureTables failed:", e);
    return;
  }
  scheduleLoop(client).catch(e => console.error("[LOTTERY] scheduleLoop failed:", e));
}

module.exports = {
  startScheduler,
  handleInteraction,
  getState,
  nextDrawUtcMs,
  drawKeyFromDrawUtc,
  salesCloseUtcMs,
  countTickets,
  countUserTickets,
  listUserTickets,
  runDraw
};
