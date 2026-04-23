const { ChannelType, EmbedBuilder } = require("discord.js");

const BRISBANE_OFFSET_MS = 10 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

let loopHandle = null;
let running = false;

function getNowMs() {
  return Date.now();
}

function toBrisbaneLocalMs(utcMs) {
  return utcMs + BRISBANE_OFFSET_MS;
}

function fromBrisbaneLocalMs(localMs) {
  return localMs - BRISBANE_OFFSET_MS;
}

function computeNextBoundaryUtcMs(frequencyHours, fromUtcMs = getNowMs()) {
  const intervalMs = Number(frequencyHours) * HOUR_MS;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error("Frequency hours must be a positive number.");
  }

  const localNowMs = toBrisbaneLocalMs(fromUtcMs);
  const startOfDayLocalMs = Math.floor(localNowMs / DAY_MS) * DAY_MS;
  const elapsedTodayMs = localNowMs - startOfDayLocalMs;
  const nextSlotIndex = Math.floor(elapsedTodayMs / intervalMs) + 1;
  const nextLocalMs = startOfDayLocalMs + (nextSlotIndex * intervalMs);
  return fromBrisbaneLocalMs(nextLocalMs);
}

async function ensureSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS channel_purge_schedules (
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      frequency_hours INTEGER NOT NULL,
      mode TEXT NOT NULL DEFAULT 'recurring',
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      next_run_at TIMESTAMPTZ NOT NULL,
      last_run_at TIMESTAMPTZ NULL,
      created_by TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, channel_id)
    );

    ALTER TABLE channel_purge_schedules
    ADD COLUMN IF NOT EXISTS frequency_hours INTEGER NOT NULL DEFAULT 24;

    ALTER TABLE channel_purge_schedules
    ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'recurring';

    ALTER TABLE channel_purge_schedules
    ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE;

    ALTER TABLE channel_purge_schedules
    ADD COLUMN IF NOT EXISTS next_run_at TIMESTAMPTZ;

    ALTER TABLE channel_purge_schedules
    ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMPTZ NULL;

    ALTER TABLE channel_purge_schedules
    ADD COLUMN IF NOT EXISTS created_by TEXT NULL;

    ALTER TABLE channel_purge_schedules
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

    ALTER TABLE channel_purge_schedules
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

    CREATE INDEX IF NOT EXISTS idx_channel_purge_schedules_enabled_next
    ON channel_purge_schedules (enabled, next_run_at);
  `);

  await db.query(`
    UPDATE channel_purge_schedules
    SET next_run_at = COALESCE(next_run_at, NOW() + INTERVAL '1 hour')
    WHERE next_run_at IS NULL
  `);
}

async function upsertSchedule({ db, guildId, channelId, frequencyHours, mode = 'recurring', actorId = null }) {
  const normalizedMode = String(mode).trim().toLowerCase() === 'once' ? 'once' : 'recurring';
  const nextRunUtcMs = computeNextBoundaryUtcMs(Number(frequencyHours));
  const res = await db.query(
    `INSERT INTO channel_purge_schedules (
       guild_id, channel_id, frequency_hours, mode, enabled, next_run_at, created_by, updated_at
     ) VALUES ($1, $2, $3, $4, TRUE, TO_TIMESTAMP($5 / 1000.0), $6, NOW())
     ON CONFLICT (guild_id, channel_id)
     DO UPDATE SET
       frequency_hours = EXCLUDED.frequency_hours,
       mode = EXCLUDED.mode,
       enabled = TRUE,
       next_run_at = EXCLUDED.next_run_at,
       created_by = EXCLUDED.created_by,
       updated_at = NOW()
     RETURNING *`,
    [guildId, channelId, Number(frequencyHours), normalizedMode, nextRunUtcMs, actorId]
  );
  return res.rows[0] ?? null;
}

async function getSchedulesForGuild(db, guildId) {
  const res = await db.query(
    `SELECT *
     FROM channel_purge_schedules
     WHERE guild_id = $1
     ORDER BY enabled DESC, next_run_at ASC, channel_id ASC`,
    [guildId]
  );
  return res.rows;
}

async function getSchedule(db, guildId, channelId) {
  const res = await db.query(
    `SELECT * FROM channel_purge_schedules WHERE guild_id = $1 AND channel_id = $2 LIMIT 1`,
    [guildId, channelId]
  );
  return res.rows[0] ?? null;
}

async function disableSchedule(db, guildId, channelId) {
  const res = await db.query(
    `UPDATE channel_purge_schedules
     SET enabled = FALSE, updated_at = NOW()
     WHERE guild_id = $1 AND channel_id = $2
     RETURNING *`,
    [guildId, channelId]
  );
  return res.rows[0] ?? null;
}

function formatMode(mode) {
  return String(mode).toLowerCase() === 'once' ? 'Once' : 'Recurring';
}

function formatNextRun(row) {
  const unix = row?.next_run_at ? Math.floor(new Date(row.next_run_at).getTime() / 1000) : null;
  return unix ? `<t:${unix}:F> (<t:${unix}:R>)` : 'Not scheduled';
}

function formatLastRun(row) {
  const unix = row?.last_run_at ? Math.floor(new Date(row.last_run_at).getTime() / 1000) : null;
  return unix ? `<t:${unix}:F> (<t:${unix}:R>)` : 'Never';
}

function buildStatusEmbed(rows, guild) {
  const embed = new EmbedBuilder()
    .setColor(0x0875AF)
    .setTitle('🧹 Scheduled Channel Purges')
    .setDescription(rows.length ? 'Configured purge schedules for this server.' : 'No scheduled purges are configured yet.')
    .setFooter({ text: `Brisbane time alignment • ${guild?.name || 'Server'}` })
    .setTimestamp();

  for (const row of rows.slice(0, 10)) {
    embed.addFields({
      name: `${row.enabled ? '✅' : '⏸️'} <#${row.channel_id}>`,
      value: [
        `**Mode:** ${formatMode(row.mode)}`,
        `**Frequency:** every ${row.frequency_hours} hour${Number(row.frequency_hours) === 1 ? '' : 's'}`,
        `**Next purge:** ${formatNextRun(row)}`,
        `**Last purge:** ${formatLastRun(row)}`,
      ].join('\n'),
      inline: false,
    });
  }

  if (rows.length > 10) {
    embed.addFields({ name: 'More', value: `Showing 10 of ${rows.length} configured schedules.`, inline: false });
  }

  return embed;
}

async function recreateChannel(channel, reason) {
  if (!channel || typeof channel.clone !== 'function') {
    throw new Error('Channel could not be cloned.');
  }

  const guild = channel.guild;
  const clone = await channel.clone({
    name: channel.name,
    reason,
  });

  try {
    await clone.setPosition(channel.position).catch(() => null);
    if (channel.parentId && clone.parentId !== channel.parentId) {
      await clone.setParent(channel.parentId).catch(() => null);
    }
    if ('topic' in channel && channel.topic !== clone.topic) {
      await clone.setTopic(channel.topic ?? null).catch(() => null);
    }
    if ('rateLimitPerUser' in channel && clone.rateLimitPerUser !== channel.rateLimitPerUser) {
      await clone.setRateLimitPerUser(channel.rateLimitPerUser).catch(() => null);
    }
    if ('nsfw' in channel && clone.nsfw !== channel.nsfw && typeof clone.setNSFW === 'function') {
      await clone.setNSFW(channel.nsfw).catch(() => null);
    }
  } catch (_) {}

  await channel.delete(reason).catch(async (err) => {
    await clone.delete('Rollback failed channel purge clone').catch(() => null);
    throw err;
  });

  return guild.channels.fetch(clone.id).catch(() => clone);
}

async function executeDueSchedule(client, row) {
  const guild = await client.guilds.fetch(row.guild_id).catch(() => null);
  if (!guild) {
    await client.db.query(
      `UPDATE channel_purge_schedules SET enabled = FALSE, updated_at = NOW() WHERE guild_id = $1 AND channel_id = $2`,
      [row.guild_id, row.channel_id]
    );
    return;
  }

  const channel = await guild.channels.fetch(row.channel_id).catch(() => null);
  if (!channel) {
    await client.db.query(
      `UPDATE channel_purge_schedules SET enabled = FALSE, updated_at = NOW() WHERE guild_id = $1 AND channel_id = $2`,
      [row.guild_id, row.channel_id]
    );
    return;
  }

  if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
    await client.db.query(
      `UPDATE channel_purge_schedules SET enabled = FALSE, updated_at = NOW() WHERE guild_id = $1 AND channel_id = $2`,
      [row.guild_id, row.channel_id]
    );
    return;
  }

  const reason = `Scheduled channel purge (${row.mode}, every ${row.frequency_hours}h)`;
  const replacement = await recreateChannel(channel, reason);
  const nextRunMs = computeNextBoundaryUtcMs(Number(row.frequency_hours), Math.max(getNowMs(), new Date(row.next_run_at).getTime() + 1000));

  if (String(row.mode).toLowerCase() === 'once') {
    await client.db.query(
      `DELETE FROM channel_purge_schedules WHERE guild_id = $1 AND channel_id = $2`,
      [row.guild_id, row.channel_id]
    );
    return;
  }

  await client.db.query(
    `DELETE FROM channel_purge_schedules WHERE guild_id = $1 AND channel_id = $2`,
    [row.guild_id, row.channel_id]
  );

  await client.db.query(
    `INSERT INTO channel_purge_schedules (
       guild_id, channel_id, frequency_hours, mode, enabled, next_run_at, last_run_at, created_by, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, TRUE, TO_TIMESTAMP($5 / 1000.0), NOW(), $6, COALESCE($7, NOW()), NOW()
     )`,
    [row.guild_id, replacement.id, Number(row.frequency_hours), row.mode, nextRunMs, row.created_by, row.created_at]
  );
}

async function tick(client) {
  if (running || !client?.db) return;
  running = true;
  try {
    const due = await client.db.query(
      `SELECT *
       FROM channel_purge_schedules
       WHERE enabled = TRUE
         AND next_run_at <= NOW()
       ORDER BY next_run_at ASC
       LIMIT 10`
    );

    for (const row of due.rows) {
      try {
        await executeDueSchedule(client, row);
      } catch (err) {
        console.error('[CHANNEL PURGER] Failed to execute schedule:', err);
      }
    }
  } finally {
    running = false;
  }
}

function startScheduler(client) {
  if (loopHandle) clearInterval(loopHandle);
  loopHandle = setInterval(() => {
    tick(client).catch((err) => console.error('[CHANNEL PURGER] Tick failed:', err));
  }, 30_000);

  setTimeout(() => {
    tick(client).catch((err) => console.error('[CHANNEL PURGER] Initial tick failed:', err));
  }, 5_000);
}

module.exports = {
  ensureSchema,
  upsertSchedule,
  getSchedule,
  getSchedulesForGuild,
  disableSchedule,
  buildStatusEmbed,
  computeNextBoundaryUtcMs,
  startScheduler,
};
