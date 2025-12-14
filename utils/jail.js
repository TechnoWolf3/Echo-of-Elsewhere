// utils/jail.js
const { pool } = require("./db");

const JAIL_KEY = "jail";

function toUnix(date) {
  return Math.floor(date.getTime() / 1000);
}

function formatJailBlockMessage(releaseAt, commandCooldownAt = null) {
  const jailUnix = toUnix(releaseAt);

  if (commandCooldownAt) {
    const cdUnix = toUnix(commandCooldownAt);
    return (
      `🚔 You’re in **jail**.\n` +
      `⛓️ Release: <t:${jailUnix}:R>\n` +
      `⏳ Command cooldown: <t:${cdUnix}:R>\n` +
      `\nYou can’t use economy commands while jailed.`
    );
  }

  return (
    `🚔 You’re in **jail**.\n` +
    `⛓️ Release: <t:${jailUnix}:R>\n` +
    `\nYou can’t use economy commands while jailed.`
  );
}

async function getJailRelease(guildId, userId) {
  const res = await pool.query(
    `SELECT next_claim_at FROM cooldowns WHERE guild_id=$1 AND user_id=$2 AND key=$3`,
    [guildId, userId, JAIL_KEY]
  );

  if (res.rowCount === 0) return null;

  const next = new Date(res.rows[0].next_claim_at);
  if (Number.isNaN(next.getTime())) return null;
  return next;
}

async function isJailed(guildId, userId) {
  const releaseAt = await getJailRelease(guildId, userId);
  if (!releaseAt) return { jailed: false, releaseAt: null };

  const now = new Date();
  if (now >= releaseAt) return { jailed: false, releaseAt: null };

  return { jailed: true, releaseAt };
}

async function setJail(guildId, userId, releaseAt) {
  await pool.query(
    `INSERT INTO cooldowns (guild_id, user_id, key, next_claim_at)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (guild_id, user_id, key)
     DO UPDATE SET next_claim_at = EXCLUDED.next_claim_at`,
    [guildId, userId, JAIL_KEY, releaseAt]
  );

  return releaseAt;
}

/**
 * Guard helper for slash commands:
 * - If jailed, edits the deferred reply with a helpful message and returns true.
 * - If not jailed, returns false.
 */
async function guardNotJailed(interaction, commandCooldownAt = null) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;

  const jail = await isJailed(guildId, userId);
  if (!jail.jailed) return false;

  const msg = formatJailBlockMessage(jail.releaseAt, commandCooldownAt);
  await interaction.editReply(msg);
  return true;
}

/**
 * Guard helper for button interactions (roulette/blackjack panels, etc.)
 */
async function guardNotJailedComponent(componentInteraction) {
  const guildId = componentInteraction.guildId;
  const userId = componentInteraction.user.id;

  const jail = await isJailed(guildId, userId);
  if (!jail.jailed) return false;

  const msg = formatJailBlockMessage(jail.releaseAt);
  if (componentInteraction.deferred || componentInteraction.replied) {
    await componentInteraction.editReply(msg);
  } else {
    await componentInteraction.reply({ content: msg, ephemeral: true });
  }
  return true;
}

module.exports = {
  getJailRelease,
  isJailed,
  setJail,
  guardNotJailed,
  guardNotJailedComponent,
};
