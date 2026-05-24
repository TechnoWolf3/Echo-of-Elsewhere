const { ChannelType } = require("discord.js");
const { pool } = require("../db");
const community = require("./communityService");

let intervalHandle = null;

function db() {
  return pool && typeof pool.query === "function" ? pool : null;
}

function isVoiceChannel(channel) {
  return channel?.type === ChannelType.GuildVoice || channel?.type === ChannelType.GuildStageVoice;
}

async function memberIsEligible(member, channel, settings, voiceState = null) {
  if (!member || member.user?.bot || !channel || !isVoiceChannel(channel)) return false;
  if (!settings.enabled) return false;
  if (settings.ignoredVoiceChannelIds.includes(String(channel.id))) return false;
  if (channel.guild?.afkChannelId && String(channel.id) === String(channel.guild.afkChannelId)) return false;
  if (community.hasIgnoredRole(member, settings)) return false;

  const voice = voiceState || member.voice;
  if (voice?.selfDeaf || voice?.serverDeaf) return false;

  const humans = channel.members?.filter((m) => !m.user?.bot) ?? new Map();
  return humans.size >= 2;
}

async function upsertSession(member, channel) {
  const database = db();
  if (!database || !member?.guild || !channel) return;
  await community.ensureSchema();
  await database.query(
    `INSERT INTO community_voice_active (guild_id, user_id, channel_id, joined_at, last_awarded_at, updated_at)
     VALUES ($1,$2,$3,NOW(),NOW(),NOW())
     ON CONFLICT (guild_id, user_id)
     DO UPDATE SET channel_id = EXCLUDED.channel_id, updated_at = NOW()`,
    [String(member.guild.id), String(member.id), String(channel.id)]
  );
}

async function deleteSession(guildId, userId) {
  const database = db();
  if (!database) return;
  await database.query(
    `DELETE FROM community_voice_active WHERE guild_id=$1 AND user_id=$2`,
    [String(guildId), String(userId)]
  );
}

async function processSession(client, row, { removeIfIneligible = true, memberOverride = null, channelOverride = null, voiceStateOverride = null } = {}) {
  const database = db();
  if (!database) return;

  const guild = client.guilds.cache.get(String(row.guild_id)) || await client.guilds.fetch(String(row.guild_id)).catch(() => null);
  if (!guild) {
    await deleteSession(row.guild_id, row.user_id);
    return;
  }

  const settings = await community.getSettings(guild.id);
  const member = memberOverride || await guild.members.fetch(String(row.user_id)).catch(() => null);
  const channel = channelOverride || (
    member?.voice?.channelId
      ? member.voice.channel
      : await guild.channels.fetch(String(row.channel_id)).catch(() => null)
  );

  const eligible = await memberIsEligible(member, channel, settings, voiceStateOverride);
  if (!eligible) {
    if (removeIfIneligible) await deleteSession(guild.id, row.user_id);
    return;
  }

  if (String(channel.id) !== String(row.channel_id)) {
    await database.query(
      `UPDATE community_voice_active SET channel_id=$3, updated_at=NOW() WHERE guild_id=$1 AND user_id=$2`,
      [String(guild.id), String(row.user_id), String(channel.id)]
    );
  }

  const intervalSeconds = Math.max(60, Number(settings.voiceXpIntervalSeconds || 300));
  const lastAwardedMs = new Date(row.last_awarded_at || Date.now()).getTime();
  const elapsedSeconds = Math.floor((Date.now() - lastAwardedMs) / 1000);
  const chunks = Math.floor(elapsedSeconds / intervalSeconds);
  if (chunks <= 0) return;

  const voiceSeconds = chunks * intervalSeconds;
  let xp = 0;
  for (let i = 0; i < chunks; i += 1) {
    xp += community.intInRange(settings.voiceXpMin, settings.voiceXpMax);
  }

  const result = await community.addXp({
    guildId: guild.id,
    userId: row.user_id,
    amount: xp,
    source: "voice",
    voiceSeconds,
  });

  await database.query(
    `UPDATE community_voice_active
     SET last_awarded_at = last_awarded_at + ($3::int * INTERVAL '1 second'),
         eligible_seconds_accumulated = eligible_seconds_accumulated + $3,
         updated_at = NOW()
     WHERE guild_id=$1 AND user_id=$2`,
    [String(guild.id), String(row.user_id), voiceSeconds]
  );

  if (result?.leveledUp) {
    await community.announceLevelUp({
      guild,
      channel,
      userId: row.user_id,
      level: result.newLevel,
      oldLevel: result.oldLevel,
      settings,
    });
  }
}

async function processAllSessions(client) {
  const database = db();
  if (!database) return;
  await community.ensureSchema();
  const res = await database.query(`SELECT * FROM community_voice_active ORDER BY updated_at ASC LIMIT 500`);
  for (const row of res.rows || []) {
    try {
      await processSession(client, row);
    } catch (error) {
      console.error("[community] voice session processing failed:", error);
    }
  }
}

async function syncGuildVoiceState(guild) {
  const settings = await community.getSettings(guild.id);
  for (const channel of guild.channels.cache.values()) {
    if (!isVoiceChannel(channel)) continue;
    for (const member of channel.members.values()) {
      if (await memberIsEligible(member, channel, settings)) {
        await upsertSession(member, channel);
      }
    }
  }
}

async function syncChannelVoiceState(channel) {
  if (!channel?.guild || !isVoiceChannel(channel)) return;
  const settings = await community.getSettings(channel.guild.id);
  for (const member of channel.members.values()) {
    if (member.user?.bot) continue;
    if (await memberIsEligible(member, channel, settings)) {
      await upsertSession(member, channel);
    } else {
      await deleteSession(channel.guild.id, member.id);
    }
  }
}

async function start(client) {
  if (!db()) return;
  await community.ensureSchema();

  for (const guild of client.guilds.cache.values()) {
    await syncGuildVoiceState(guild).catch((error) => {
      console.error("[community] voice sync failed:", error);
    });
  }

  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = setInterval(() => {
    processAllSessions(client).catch((error) => console.error("[community] voice tick failed:", error));
  }, 60 * 1000);
  intervalHandle.unref?.();
}

async function handleVoiceStateUpdate(oldState, newState) {
  const database = db();
  if (!database) return;
  await community.ensureSchema();

  const guild = newState.guild || oldState.guild;
  const member = newState.member || oldState.member;
  if (!guild || !member || member.user?.bot) return;

  const existing = await database.query(
    `SELECT * FROM community_voice_active WHERE guild_id=$1 AND user_id=$2`,
    [String(guild.id), String(member.id)]
  );
  if (existing.rows?.[0]) {
    await processSession(guild.client, existing.rows[0], {
      memberOverride: oldState.member || member,
      channelOverride: oldState.channel || null,
      voiceStateOverride: oldState,
    });
  }

  await syncChannelVoiceState(oldState.channel).catch((error) => console.error("[community] old voice channel sync failed:", error));
  await syncChannelVoiceState(newState.channel).catch((error) => console.error("[community] new voice channel sync failed:", error));
  if (!newState.channel) await deleteSession(guild.id, member.id);
}

module.exports = {
  start,
  handleVoiceStateUpdate,
  processAllSessions,
};
