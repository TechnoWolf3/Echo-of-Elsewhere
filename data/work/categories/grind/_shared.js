// data/work/categories/grind/_shared.js
// Shared helpers for Grind job modules.

const { EmbedBuilder } = require("discord.js");
const { creditUserWithEffects } = require("../../../../utils/effectSystem");

function money(n) {
  return `$${Number(n || 0).toLocaleString()}`;
}

function clamp(n, a, b) {
  const x = Number(n);
  if (!Number.isFinite(x)) return a;
  return Math.max(a, Math.min(b, x));
}

function bar10(pct) {
  const p = clamp(pct, 0, 100);
  const blocks = 10;
  const filled = Math.round((p / 100) * blocks);
  return "█".repeat(filled) + "░".repeat(blocks - filled);
}

async function mintUser(db, guildId, userId, amount, type, meta = {}, options = {}) {
  const amt = Math.max(0, Math.floor(Number(amount || 0)));
  if (amt <= 0) return;
  return creditUserWithEffects({
    guildId,
    userId,
    amount: amt,
    type,
    meta,
    activityEffects: options.activityEffects || null,
    awardSource: options.awardSource || type,
  });
}

async function setJobCooldownSeconds(db, guildId, userId, seconds) {
  const sec = Math.max(0, Math.floor(Number(seconds || 0)));
  const next = new Date(Date.now() + sec * 1000);
  await db.query(
    `INSERT INTO cooldowns (guild_id, user_id, key, next_claim_at)
     VALUES ($1,$2,'job',$3)
     ON CONFLICT (guild_id, user_id, key)
     DO UPDATE SET next_claim_at = EXCLUDED.next_claim_at`,
    [guildId, userId, next.toISOString()]
  );
  return next;
}

function envPlaygroundChannelId() {
  const raw = String(process.env.PLAYGROUND_CHANNEL_ID || "").trim();
  return raw || null;
}

async function postUltraToPlayground(client, guildId, embed) {
  const channelId = envPlaygroundChannelId();
  if (!channelId) return false;

  try {
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return false;
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased?.()) return false;
    await channel.send({ embeds: [embed] }).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

function ultraEmbed({ title, description, userTag, amount, extraLines = [] }) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription([`👤 **${userTag}**`, description, "", ...extraLines, "", `💰 Reward: **${money(amount)}**`].filter(Boolean).join("\n"))
    .setTimestamp(new Date());
}

module.exports = {
  money,
  clamp,
  bar10,
  mintUser,
  setJobCooldownSeconds,
  postUltraToPlayground,
  ultraEmbed,
};
