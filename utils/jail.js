// utils/jail.js
const { pool } = require("./db");

const JAIL_KEY = "jail";

/**
 * Get the jail release time for a user.
 * Returns Date or null.
 */
async function getJailRelease(guildId, userId) {
  const res = await pool.query(
    `
    SELECT next_claim_at
    FROM cooldowns
    WHERE guild_id = $1 AND user_id = $2 AND key = $3
    `,
    [guildId, userId, JAIL_KEY]
  );

  if (res.rowCount === 0) return null;

  const releaseAt = new Date(res.rows[0].next_claim_at);
  if (Number.isNaN(releaseAt.getTime())) return null;

  // Expired → cleanup
  if (releaseAt.getTime() <= Date.now()) {
    await pool.query(
      `DELETE FROM cooldowns WHERE guild_id=$1 AND user_id=$2 AND key=$3`,
      [guildId, userId, JAIL_KEY]
    );
    return null;
  }

  return releaseAt;
}

/**
 * Returns detailed jail info or null.
 */
async function getJailInfo(guildId, userId) {
  const releaseAt = await getJailRelease(guildId, userId);
  if (!releaseAt) return null;

  const remainingMs = releaseAt.getTime() - Date.now();
  if (remainingMs <= 0) return null;

  return {
    releaseAt,
    remainingMs,
  };
}

/**
 * Returns true if the user is currently jailed.
 */
async function isJailed(guildId, userId) {
  const releaseAt = await getJailRelease(guildId, userId);
  return Boolean(releaseAt);
}

/**
 * Set jail until a specific Date.
 */
async function setJail(guildId, userId, releaseAt) {
  await pool.query(
    `
    INSERT INTO cooldowns (guild_id, user_id, key, next_claim_at)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (guild_id, user_id, key)
    DO UPDATE SET next_claim_at = EXCLUDED.next_claim_at
    `,
    [guildId, userId, JAIL_KEY, releaseAt]
  );
}

/**
 * Clear jail immediately.
 */
async function clearJail(guildId, userId) {
  await pool.query(
    `DELETE FROM cooldowns WHERE guild_id=$1 AND user_id=$2 AND key=$3`,
    [guildId, userId, JAIL_KEY]
  );
}

/**
 * Slash-command guard — blocks execution if jailed.
 */
async function guardNotJailed(interaction) {
  const jailedUntil = await getJailRelease(interaction.guildId, interaction.user.id);
  if (!jailedUntil) return true;

  await interaction.editReply({
    content: `⛓️ You are jailed until <t:${Math.floor(jailedUntil.getTime() / 1000)}:R>.`,
    ephemeral: true,
  });
  return false;
}

/**
 * Component/button guard — blocks interaction if jailed.
 */
async function guardNotJailedComponent(interaction) {
  const jailedUntil = await getJailRelease(interaction.guildId, interaction.user.id);
  if (!jailedUntil) return true;

  await interaction.reply({
    content: `⛓️ You are jailed until <t:${Math.floor(jailedUntil.getTime() / 1000)}:R>.`,
    ephemeral: true,
  });
  return false;
}

module.exports = {
  getJailRelease,
  getJailInfo,
  isJailed,
  setJail,
  clearJail,
  guardNotJailed,
  guardNotJailedComponent,
};
