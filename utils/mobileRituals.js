const appLinking = require("./appLinking");
const ritualsRegistry = require("../data/rituals");
const { getRitualStatus, claimRitual } = require("./rituals");
const { pool } = require("./db");
const gameConfig = require("./gameConfig");

function requirePool() {
  if (!pool || typeof pool.query !== "function") throw new Error("DATABASE_URL is not configured.");
  return pool;
}

async function assertPlayable(ctx) {
  if (!ctx?.profileId || !ctx.guildId || !ctx.discordUserId) {
    return { ok: false, statusCode: 401, message: "Linked Discord profile is required." };
  }

  const db = requirePool();
  const jail = await db.query(
    `SELECT jailed_until
     FROM jail
     WHERE guild_id=$1 AND user_id=$2 AND jailed_until > NOW()
     LIMIT 1`,
    [ctx.guildId, ctx.discordUserId]
  );
  if (jail.rows?.[0]) {
    return { ok: false, statusCode: 403, message: "You cannot perform rituals while jailed." };
  }

  return { ok: true };
}

function publicStatus(ritual, status) {
  return {
    id: ritual.id,
    name: ritual.name,
    shortName: ritual.shortName || ritual.name,
    placement: ritual.placement,
    interactive: Boolean(ritual.interactive),
    available: Boolean(status.available),
    nextClaimAt: status.nextClaimAt ? new Date(status.nextClaimAt).toISOString() : null,
    unix: status.unix || null,
  };
}

async function list(ctx) {
  const playable = await assertPlayable(ctx);
  if (!playable.ok && playable.statusCode !== 403) return playable;

  const rituals = [];
  for (const ritual of ritualsRegistry.rituals || []) {
    const status = await getRitualStatus(ctx.guildId, ctx.discordUserId, ritual);
    rituals.push(publicStatus(ritual, status));
  }

  return {
    ok: true,
    body: {
      configVersion: gameConfig.CONFIG_VERSION,
      rituals,
      profile: await appLinking.buildProfileSnapshot(ctx.profileId),
      jailed: playable.statusCode === 403,
    },
  };
}

async function claim(ctx, ritualId) {
  const playable = await assertPlayable(ctx);
  if (!playable.ok) return playable;

  const ritual = ritualsRegistry.getRitual(String(ritualId || ""));
  if (!ritual) return { ok: false, statusCode: 404, message: "Ritual not found." };
  if (ritual.interactive) {
    return {
      ok: false,
      statusCode: 409,
      message: "That ritual has interactive server-owned gameplay and needs its own action endpoint.",
    };
  }

  const result = await claimRitual({
    guildId: ctx.guildId,
    userId: ctx.discordUserId,
    ritual,
  });

  if (!result.ok) {
    return { ok: false, statusCode: 409, message: result.message, body: { message: result.message, status: result.status } };
  }

  return {
    ok: true,
    body: {
      configVersion: gameConfig.CONFIG_VERSION,
      status: "claimed",
      ritualId: ritual.id,
      configSource: "railway",
      payout: {
        baseAmount: Number(result.payout?.baseAmount || result.payout?.amount || 0),
        finalAmount: Number(result.payout?.finalAmount || 0),
        creditedAmount: Number(result.payout?.payoutResult?.creditedAmount || result.payout?.finalAmount || 0),
      },
      cooldown: {
        nextClaimAt: result.status.nextClaimAt ? new Date(result.status.nextClaimAt).toISOString() : null,
        unix: result.status.unix || null,
      },
      message: result.message,
      profile: await appLinking.buildProfileSnapshot(ctx.profileId),
    },
  };
}

module.exports = {
  list,
  claim,
};
