const { pool } = require("./db");
const profileIllusions = require("./profileIllusions");

function isActiveIllusion(profile) {
  const illusion = profile?.illusion;
  if (!illusion?.active) return false;

  const expiresAt = illusion.expiresAt || illusion.endsAt;
  if (!expiresAt) return true;

  return new Date(expiresAt).getTime() > Date.now();
}

function getDisplayProfile(profile) {
  if (!isActiveIllusion(profile)) return profile;

  const display = profile.illusion.display || {};

  return {
    ...profile,

    walletBalance: display.walletBalance ?? 0,
    bankBalance: display.bankBalance ?? 0,
    serverBankBalance: display.serverBankBalance ?? 0,
    jobLevel: display.jobLevel ?? 0,
    jobXp: display.jobXp ?? 0,
    heat: display.heat ?? 0,
    jailedUntil: display.jailedUntil ?? null,
    accountNumber: display.accountNumber ?? display.account_number ?? null,
    account_number: display.account_number ?? display.accountNumber ?? null,

    illusion: profile.illusion,
  };
}

async function getProfileIdForDiscordUser(guildId, userId) {
  if (!pool?.query || !userId) return null;

  const res = await pool.query(
    `SELECT p.id
     FROM linked_identities li
     JOIN profiles p ON p.id = li.profile_id
     WHERE li.provider='discord'
       AND li.provider_user_id=$1
       AND (p.primary_guild_id=$2 OR p.primary_guild_id IS NULL OR p.primary_guild_id='')
     ORDER BY li.linked_at ASC
     LIMIT 1`,
    [String(userId), String(guildId || "")]
  );

  return res.rows?.[0]?.id || null;
}

async function getDisplayProfileForUser(guildId, userId, profile = {}) {
  const profileId = profile.profileId || await getProfileIdForDiscordUser(guildId, userId).catch(() => null);
  const illusion = profile.illusion || await profileIllusions.getActiveIllusion(profileId).catch(() => null);
  return getDisplayProfile({
    ...profile,
    profileId,
    discordUserId: profile.discordUserId ?? (userId ? String(userId) : null),
    illusion,
  });
}

async function getDisplayEconomySnapshot(guildId, userId, snapshot = {}) {
  const display = await getDisplayProfileForUser(guildId, userId, {
    walletBalance: snapshot.wallet ?? snapshot.walletBalance ?? 0,
    bankBalance: snapshot.bank ?? snapshot.bankBalance ?? 0,
    accountNumber: snapshot.accountNumber ?? snapshot.account_number ?? null,
    account_number: snapshot.account_number ?? snapshot.accountNumber ?? null,
  });

  const wallet = Number(display.walletBalance ?? snapshot.wallet ?? 0);
  const bank = Number(display.bankBalance ?? snapshot.bank ?? 0);

  return {
    ...snapshot,
    wallet,
    bank,
    total: wallet + bank,
    accountNumber: display.accountNumber ?? snapshot.accountNumber ?? null,
    account_number: display.account_number ?? snapshot.account_number ?? null,
    illusion: display.illusion,
  };
}

module.exports = {
  isActiveIllusion,
  getDisplayProfile,
  getDisplayProfileForUser,
  getDisplayEconomySnapshot,
};
