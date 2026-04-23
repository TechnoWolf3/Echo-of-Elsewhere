const { ChannelType, PermissionFlagsBits } = require('discord.js');

const BRISBANE_OFFSET_MS = 10 * 60 * 60 * 1000;
const MIN_FREQUENCY_HOURS = 1;
const MAX_FREQUENCY_HOURS = 24 * 30;
const POLL_MS = 60 * 1000;
const BULK_DELETE_MAX_AGE_MS = 13.5 * 24 * 60 * 60 * 1000;

let pollHandle = null;
let activeRun = false;

function assertDb(client) {
  if (!client?.db) throw new Error('Database is not available.');
  return client.db;
}

function cleanId(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function parseMode(value) {
  const mode = String(value || 'recurring').trim().toLowerCase();
  if (!['once', 'recurring'].includes(mode)) {
    throw new Error('Mode must be once or recurring.');
  }
  return mode;
}

function parseFrequencyHours(value) {
  const hours = Number(value);
  if (!Number.isInteger(hours) || hours < MIN_FREQUENCY_HOURS || hours > MAX_FREQUENCY_HOURS) {
    throw new Error(`Frequency must be a whole number between ${MIN_FREQUENCY_HOURS} and ${MAX_FREQUENCY_HOURS} hours.`);
  }
  return hours;
}

function nowMs() {
  return Date.now();
}

function computeNextRunMs({ fromMs = nowMs(), frequencyHours }) {
  const intervalMs = frequencyHours * 60 * 60 * 1000;
  const localMs = fromMs + BRISBANE_OFFSET_MS;
  const dayStartLocalMs = Math.floor(localMs / 86400000) * 86400000;
  const elapsedTodayMs = localMs - dayStartLocalMs;
  const stepIndex = Math.floor(elapsedTodayMs / intervalMs) + 1;
  const nextLocalMs = dayStartLocalMs + (stepIndex * intervalMs);
  return nextLocalMs - BRISBANE_OFFSET_MS;
}

function formatMode(mode) {
  return mode === 'once' ? 'Once' : 'Recurring';
}

function formatScheduleLine(row) {
  const nextUnix = row?.next_run_at ? Math.floor(new Date(row.next_run_at).getTime() / 1000) : null;
  const lastUnix = row?.last_run_at ? Math.floor(new Date(row.last_run_at).getTime() / 1000) : null;
  return [
    `Channel: <#${row.channel_id}> (\`${row.channel_id}\`)`,
    `Frequency: **${row.frequency_hours}h**`,
    `Mode: **${formatMode(row.mode)}**`,
    `Status: **${row.active ? 'Active' : 'Disabled'}**`,
    nextUnix ? `Next purge: <t:${nextUnix}:F> (<t:${nextUnix}:R>)` : 'Next purge: —',
    lastUnix ? `Last purge: <t:${lastUnix}:F> (<t:${lastUnix}:R>)` : 'Last purge: Never',
    row.last_error ? `Last error: ${row.last_error}` : null,
  ].filter(Boolean).join('\n');
}

async function ensureSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS channel_purge_jobs (
      guild_id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      frequency_hours INTEGER NOT NULL,
      mode TEXT NOT NULL DEFAULT 'recurring',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      next_run_at TIMESTAMPTZ NOT NULL,
      last_run_at TIMESTAMPTZ NULL,
      last_error TEXT NULL,
      created_by TEXT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE channel_purge_jobs
      ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'recurring';

    ALTER TABLE channel_purge_jobs
      ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;

    ALTER TABLE channel_purge_jobs
      ADD COLUMN IF NOT EXISTS next_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

    ALTER TABLE channel_purge_jobs
      ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMPTZ NULL;

    ALTER TABLE channel_purge_jobs
      ADD COLUMN IF NOT EXISTS last_error TEXT NULL;

    ALTER TABLE channel_purge_jobs
      ADD COLUMN IF NOT EXISTS created_by TEXT NULL;

    ALTER TABLE channel_purge_jobs
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

    CREATE INDEX IF NOT EXISTS idx_channel_purge_jobs_next_run
      ON channel_purge_jobs (active, next_run_at);
  `);
}

async function getJob(db, guildId) {
  const res = await db.query(
    `SELECT *
       FROM channel_purge_jobs
      WHERE guild_id = $1`,
    [String(guildId)]
  );
  return res.rows[0] ?? null;
}

async function saveJob(client, { guildId, channelId, frequencyHours, mode, createdBy }) {
  const db = assertDb(client);
  const nextRunMs = computeNextRunMs({ frequencyHours });
  const res = await db.query(
    `INSERT INTO channel_purge_jobs (
        guild_id, channel_id, frequency_hours, mode, active, next_run_at, last_run_at, last_error, created_by, updated_at
      ) VALUES ($1, $2, $3, $4, TRUE, TO_TIMESTAMP($5 / 1000.0), NULL, NULL, $6, NOW())
      ON CONFLICT (guild_id)
      DO UPDATE SET
        channel_id = EXCLUDED.channel_id,
        frequency_hours = EXCLUDED.frequency_hours,
        mode = EXCLUDED.mode,
        active = TRUE,
        next_run_at = EXCLUDED.next_run_at,
        last_error = NULL,
        created_by = EXCLUDED.created_by,
        updated_at = NOW()
      RETURNING *`,
    [String(guildId), String(channelId), frequencyHours, mode, nextRunMs, createdBy ? String(createdBy) : null]
  );
  return res.rows[0];
}

async function disableJob(client, guildId) {
  const db = assertDb(client);
  const res = await db.query(
    `UPDATE channel_purge_jobs
        SET active = FALSE,
            updated_at = NOW()
      WHERE guild_id = $1
      RETURNING *`,
    [String(guildId)]
  );
  return res.rows[0] ?? null;
}

async function clearJobError(db, guildId) {
  await db.query(
    `UPDATE channel_purge_jobs
        SET last_error = NULL,
            updated_at = NOW()
      WHERE guild_id = $1`,
    [String(guildId)]
  );
}

async function recordJobFailure(db, guildId, error) {
  const message = String(error?.message || error || 'Unknown purge error').slice(0, 500);
  await db.query(
    `UPDATE channel_purge_jobs
        SET last_error = $2,
            updated_at = NOW()
      WHERE guild_id = $1`,
    [String(guildId), message]
  );
}

async function markJobRun(db, row) {
  const nextRunMs = row.mode === 'once'
    ? null
    : computeNextRunMs({ fromMs: nowMs(), frequencyHours: Number(row.frequency_hours) });

  await db.query(
    `UPDATE channel_purge_jobs
        SET last_run_at = NOW(),
            next_run_at = COALESCE(TO_TIMESTAMP($2 / 1000.0), next_run_at),
            active = CASE WHEN $3 = 'once' THEN FALSE ELSE TRUE END,
            last_error = NULL,
            updated_at = NOW()
      WHERE guild_id = $1`,
    [String(row.guild_id), nextRunMs, String(row.mode)]
  );
}

function canPurgeChannel(channel) {
  return !!channel && [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type);
}

async function verifyPermissions(channel) {
  const me = channel.guild.members.me ?? await channel.guild.members.fetchMe().catch(() => null);
  if (!me) throw new Error('Could not resolve the bot member in this guild.');

  const perms = channel.permissionsFor(me);
  if (!perms?.has(PermissionFlagsBits.ViewChannel)) throw new Error('Bot cannot view the target channel.');
  if (!perms?.has(PermissionFlagsBits.ManageMessages)) throw new Error('Bot needs Manage Messages in the target channel.');
  if (!perms?.has(PermissionFlagsBits.ReadMessageHistory)) throw new Error('Bot needs Read Message History in the target channel.');
}

async function deleteOldMessagesIndividually(messages) {
  let deleted = 0;
  for (const message of messages.values()) {
    if (!message.deletable) continue;
    try {
      await message.delete();
      deleted += 1;
    } catch (error) {
      // Keep going; one stubborn message should not kill the whole purge.
    }
  }
  return deleted;
}

async function purgeChannelMessages(channel) {
  await verifyPermissions(channel);

  let totalDeleted = 0;
  let batches = 0;
  let before;
  const seenOldest = new Set();

  while (batches < 1000) {
    const fetched = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!fetched || fetched.size === 0) break;

    const oldest = fetched.last();
    if (!oldest) break;
    if (seenOldest.has(oldest.id)) break;
    seenOldest.add(oldest.id);
    before = oldest.id;

    const recent = fetched.filter((message) => message.deletable && (nowMs() - message.createdTimestamp) < BULK_DELETE_MAX_AGE_MS);
    const older = fetched.filter((message) => message.deletable && !recent.has(message.id));

    if (recent.size) {
      const bulkResult = await channel.bulkDelete(recent, true).catch(() => null);
      totalDeleted += bulkResult?.size ?? 0;
    }

    if (older.size) {
      totalDeleted += await deleteOldMessagesIndividually(older);
    }

    batches += 1;

    if (fetched.size < 100) break;
  }

  return { totalDeleted, batches };
}

async function runJob(client, row) {
  const guild = await client.guilds.fetch(String(row.guild_id)).catch(() => null);
  if (!guild) throw new Error('Guild could not be resolved.');

  const channel = await guild.channels.fetch(String(row.channel_id)).catch(() => null);
  if (!channel) throw new Error('Configured channel could not be resolved.');
  if (!canPurgeChannel(channel)) throw new Error('Target channel must be a standard text or announcement channel.');

  return purgeChannelMessages(channel);
}

async function tick(client) {
  if (activeRun) return;
  activeRun = true;
  const db = assertDb(client);

  try {
    const due = await db.query(
      `SELECT *
         FROM channel_purge_jobs
        WHERE active = TRUE
          AND next_run_at <= NOW()
        ORDER BY next_run_at ASC
        LIMIT 10`
    );

    for (const row of due.rows) {
      try {
        await runJob(client, row);
        await markJobRun(db, row);
      } catch (error) {
        console.error('[channelPurger] purge failed:', error);
        await recordJobFailure(db, row.guild_id, error);
      }
    }
  } finally {
    activeRun = false;
  }
}

function startScheduler(client) {
  if (!client?.db) return;
  if (pollHandle) clearInterval(pollHandle);
  pollHandle = setInterval(() => {
    tick(client).catch((error) => console.error('[channelPurger] scheduler tick failed:', error));
  }, POLL_MS);

  tick(client).catch((error) => console.error('[channelPurger] initial tick failed:', error));
}

async function scheduleFromAdmin(interaction, { channel, frequencyHours, mode }) {
  if (!interaction?.guild) throw new Error('This can only be used in a server.');
  if (!channel) throw new Error('A valid channel is required.');
  if (!canPurgeChannel(channel)) throw new Error('Target channel must be a standard text or announcement channel.');

  const parsedHours = parseFrequencyHours(frequencyHours);
  const parsedMode = parseMode(mode);
  await verifyPermissions(channel);

  const row = await saveJob(interaction.client, {
    guildId: interaction.guild.id,
    channelId: channel.id,
    frequencyHours: parsedHours,
    mode: parsedMode,
    createdBy: interaction.user?.id,
  });

  await clearJobError(assertDb(interaction.client), interaction.guild.id);
  return row;
}

async function getStatus(client, guildId) {
  const db = assertDb(client);
  return getJob(db, guildId);
}

module.exports = {
  ensureSchema,
  startScheduler,
  scheduleFromAdmin,
  disableJob,
  getStatus,
  formatScheduleLine,
  computeNextRunMs,
  parseFrequencyHours,
  parseMode,
};
