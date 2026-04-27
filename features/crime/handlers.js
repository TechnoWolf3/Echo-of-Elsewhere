const { MessageFlags } = require("discord.js");

const startStoreRobbery = require("../../data/work/categories/crime/storeRobbery");
const startHeist = require("../../data/work/categories/crime/heist");
const startScamCall = require("../../data/work/categories/crime/scamCall");
const startBribeOfficer = require("../../data/work/categories/crime/bribeOfficer");
const startLayLow = require("../../data/work/categories/crime/layLow");
const {
  getCrimeHeat,
  setCrimeHeat,
  heatTTLMinutesForOutcome,
} = require("../../utils/crimeHeat");
const {
  CRIME_GLOBAL_KEY,
  CRIME_KEYS,
  heatTTLMinutesForHeistOutcome,
} = require("./constants");

function isCrimeInteraction(actionId) {
  return actionId.startsWith("crime:");
}

async function handleCrimeInteraction({
  actionId,
  interaction,
  session,
  guildId,
  userId,
  boardAdapter,
  pool,
  redraw,
  resetInactivity,
}) {
  if (!isCrimeInteraction(actionId)) return false;

  const key = actionId.split(":")[1];

  if (key === "store") {
    if (await checkCrimeCooldownOrTell({ interaction, pool, guildId, userId, jobKey: CRIME_KEYS.store, jobLabel: "Store Robbery" })) return true;

    const lingeringHeat = await getCrimeHeat(guildId, userId);
    session.view = "crime_run";

    await startStoreRobbery(boardAdapter, {
      lingeringHeat,
      onStoreRobberyComplete: async ({ outcome, finalHeat, identified }) => {
        const ttlMins = heatTTLMinutesForOutcome(outcome, { identified });
        await setCrimeHeat(guildId, userId, finalHeat, ttlMins);
      },
    });

    await returnToCrime({ session, redraw, resetInactivity });
    return true;
  }

  if (key === "scam") {
    if (await checkCrimeCooldownOrTell({ interaction, pool, guildId, userId, jobKey: CRIME_KEYS.scam, jobLabel: "Scam Call" })) return true;

    const lingeringHeat = await getCrimeHeat(guildId, userId);
    session.view = "crime_run";

    await startScamCall(boardAdapter, {
      lingeringHeat,
      onScamCallComplete: async ({ outcome, finalHeat, identified }) => {
        const ttlMins = heatTTLMinutesForOutcome(outcome, { identified });
        await setCrimeHeat(guildId, userId, finalHeat, ttlMins);
      },
    });

    await returnToCrime({ session, redraw, resetInactivity });
    return true;
  }

  if (key === "heist") {
    if (await checkCrimeCooldownOrTell({ interaction, pool, guildId, userId, jobKey: CRIME_KEYS.heist, jobLabel: "Heist" })) return true;
    await startHeistRun({ mode: "heist", guildId, userId, session, boardAdapter, redraw, resetInactivity });
    return true;
  }

  if (key === "major") {
    if (await checkCrimeCooldownOrTell({ interaction, pool, guildId, userId, jobKey: CRIME_KEYS.major, jobLabel: "Major Heist" })) return true;
    await startHeistRun({ mode: "major", guildId, userId, session, boardAdapter, redraw, resetInactivity });
    return true;
  }

  if (key === "bribe") {
    if (await checkCrimeCooldownOrTell({ interaction, pool, guildId, userId, jobKey: CRIME_KEYS.bribe, jobLabel: "Bribe The Officer", skipGlobal: true })) return true;
    const lingeringHeat = await getCrimeHeat(guildId, userId);
    session.view = "crime_run";
    await startBribeOfficer(boardAdapter, { lingeringHeat });
    await returnToCrime({ session, redraw, resetInactivity });
    return true;
  }

  if (key === "laylow") {
    if (await checkCrimeCooldownOrTell({ interaction, pool, guildId, userId, jobKey: CRIME_KEYS.layLow, jobLabel: "Lay Low", skipGlobal: true })) return true;
    const lingeringHeat = await getCrimeHeat(guildId, userId);
    session.view = "crime_run";
    await startLayLow(boardAdapter, { lingeringHeat });
    await returnToCrime({ session, redraw, resetInactivity });
    return true;
  }

  if (key === "chase") {
    if (await checkCrimeCooldownOrTell({ interaction, pool, guildId, userId, jobKey: CRIME_KEYS.chase, jobLabel: "Car Chase" })) return true;
    await interaction
      .followUp({ content: "🚗 Car Chase is coming soon.", flags: MessageFlags.Ephemeral })
      .catch(() => {});
    return true;
  }

  if (key === "drugs") {
    await interaction
      .followUp({ content: "💊 Drug Pushing is a placeholder for now.", flags: MessageFlags.Ephemeral })
      .catch(() => {});
    return true;
  }

  return true;
}

async function startHeistRun({
  mode,
  guildId,
  userId,
  session,
  boardAdapter,
  redraw,
  resetInactivity,
}) {
  const lingeringHeat = await getCrimeHeat(guildId, userId);
  session.view = "crime_run";

  await startHeist(boardAdapter, {
    mode,
    lingeringHeat,
    onHeistComplete: async ({ outcome, finalHeat, identified, mode: completedMode }) => {
      const ttlMins = heatTTLMinutesForHeistOutcome(outcome, {
        identified,
        mode: completedMode,
      });
      await setCrimeHeat(guildId, userId, finalHeat, ttlMins);
    },
  });

  await returnToCrime({ session, redraw, resetInactivity });
}

async function checkCrimeCooldownOrTell({
  interaction,
  pool,
  guildId,
  userId,
  jobKey,
  jobLabel,
  skipGlobal = false,
}) {
  const now = new Date();

  const globalNext = skipGlobal ? null : await getCooldown(pool, guildId, userId, CRIME_GLOBAL_KEY);
  if (!skipGlobal && globalNext && now < globalNext) {
    await interaction
      .followUp({
        content: `⏳ Crime lockout active. Try again <t:${toUnix(globalNext)}:R>.`,
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
    return true;
  }

  const jobNext = await getCooldown(pool, guildId, userId, jobKey);
  if (jobNext && now < jobNext) {
    await interaction
      .followUp({
        content: `⏳ **${jobLabel}** cooldown. Try again <t:${toUnix(jobNext)}:R>.`,
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
    return true;
  }

  return false;
}

async function getCooldown(pool, guildId, userId, key) {
  const cd = await pool.query(
    `SELECT next_claim_at FROM cooldowns WHERE guild_id=$1 AND user_id=$2 AND key=$3`,
    [guildId, userId, key]
  );
  if (cd.rowCount === 0) return null;

  const next = new Date(cd.rows[0].next_claim_at);
  if (Number.isNaN(next.getTime())) return null;
  return next;
}

async function returnToCrime({ session, redraw, resetInactivity }) {
  await new Promise((resolve) => setTimeout(resolve, 5_000));
  resetInactivity();
  session.view = "crime";
  await redraw();
}

function toUnix(date) {
  return Math.floor(date.getTime() / 1000);
}

module.exports = {
  handleCrimeInteraction,
  isCrimeInteraction,
};
