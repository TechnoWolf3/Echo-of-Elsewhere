
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');
const { pool } = require('./db');
const economy = require('./economy');
const config = require('../data/contracts/config');

const BTN_OPEN = 'contracts:open';
const BTN_PERSONAL = 'contracts:personal';
const BTN_REFRESH = 'contracts:refresh';
const BTN_OPT_IN = 'contracts:optin';

let schedulerStarted = false;
let schedulerHandle = null;

function clampInt(n, fallback = 0, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(v)));
}

function parseBool(value, fallback = false) {
  if (value === true || value === false) return value;
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  if (['true', '1', 'yes', 'y', 'on', 'enabled'].includes(raw)) return true;
  if (['false', '0', 'no', 'n', 'off', 'disabled'].includes(raw)) return false;
  return fallback;
}

function pickRandom(arr) {
  if (!Array.isArray(arr) || !arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)] || null;
}

function resolveRange(value, fallback = 0) {
  if (value == null) return fallback;
  if (typeof value === 'number') return Math.floor(value);
  if (Array.isArray(value) && value.length >= 2) {
    const lo = clampInt(value[0], fallback);
    const hi = clampInt(value[1], lo);
    return lo + Math.floor(Math.random() * (hi - lo + 1));
  }
  if (typeof value === 'object') {
    const lo = clampInt(value.min, fallback);
    const hi = clampInt(value.max, lo);
    return lo + Math.floor(Math.random() * (hi - lo + 1));
  }
  return clampInt(value, fallback);
}

function formatMetricLabel(metric) {
  switch (String(metric || '')) {
    case 'jobs_completed': return 'Jobs Completed';
    case 'job_earnings': return 'Job Earnings';
    case 'rituals_completed': return 'Rituals Completed';
    case 'ritual_earnings': return 'Ritual Earnings';
    case 'casino_games_played': return 'Casino Games Played';
    case 'casino_wins': return 'Casino Wins';
    case 'casino_profit': return 'Casino Profit';
    case 'farm_crops_harvested': return 'Crops Harvested';
    case 'farm_fields_planted': return 'Fields Planted';
    case 'stock_trades': return 'Stock Trades';
    case 'stock_volume': return 'Stock Volume';
    case 'rift_entries': return 'Rift Entries';
    default: return metric || 'Progress';
  }
}

function formatValue(metric, value) {
  const num = clampInt(value, 0, 0);
  if (String(metric || '').includes('earnings') || ['casino_profit', 'stock_volume'].includes(String(metric || ''))) {
    return `$${num.toLocaleString('en-AU')}`;
  }
  return num.toLocaleString('en-AU');
}

function buildProgressBar(current, target, size = 16) {
  const safeTarget = Math.max(1, Number(target || 1));
  const pct = Math.max(0, Math.min(1, Number(current || 0) / safeTarget));
  const filled = Math.max(0, Math.min(size, Math.round(pct * size)));
  return '▰'.repeat(filled) + '▱'.repeat(Math.max(0, size - filled));
}

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS contract_settings (
      guild_id TEXT PRIMARY KEY,
      auto_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      auto_rotate BOOLEAN NOT NULL DEFAULT TRUE,
      community_mode TEXT NOT NULL DEFAULT 'random',
      daily_post_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      daily_post_channel_id TEXT NULL,
      last_daily_post_at TIMESTAMPTZ NULL,
      personal_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      personal_slots INT NOT NULL DEFAULT 3,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS community_contracts (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      template_id TEXT NULL,
      type TEXT NOT NULL,
      metric TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      target BIGINT NOT NULL DEFAULT 0,
      progress BIGINT NOT NULL DEFAULT 0,
      reward_pool BIGINT NOT NULL DEFAULT 0,
      standings_rewards JSONB NOT NULL DEFAULT '[]'::jsonb,
      opt_in BOOLEAN NOT NULL DEFAULT FALSE,
      penalty_amount BIGINT NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ends_at TIMESTAMPTZ NOT NULL,
      completed_at TIMESTAMPTZ NULL,
      settled_at TIMESTAMPTZ NULL,
      config JSONB NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE INDEX IF NOT EXISTS idx_community_contracts_active ON community_contracts (guild_id, status, ends_at DESC);

    CREATE TABLE IF NOT EXISTS community_contract_participants (
      contract_id BIGINT NOT NULL REFERENCES community_contracts(id) ON DELETE CASCADE,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      progress BIGINT NOT NULL DEFAULT 0,
      opted_in BOOLEAN NOT NULL DEFAULT FALSE,
      rewarded_at TIMESTAMPTZ NULL,
      penalized_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (contract_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_ccp_contract_progress ON community_contract_participants (contract_id, progress DESC);

    CREATE TABLE IF NOT EXISTS personal_contracts (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      template_id TEXT NULL,
      metric TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      target BIGINT NOT NULL,
      progress BIGINT NOT NULL DEFAULT 0,
      reward BIGINT NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ends_at TIMESTAMPTZ NOT NULL,
      completed_at TIMESTAMPTZ NULL,
      rewarded_at TIMESTAMPTZ NULL,
      config JSONB NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE INDEX IF NOT EXISTS idx_personal_contracts_active ON personal_contracts (guild_id, user_id, status, ends_at DESC);
  `);
}

async function ensureSettings(guildId) {
  await ensureSchema();
  await pool.query(
    `INSERT INTO contract_settings (guild_id, auto_enabled, auto_rotate, community_mode, daily_post_enabled, daily_post_channel_id, personal_enabled, personal_slots)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (guild_id) DO NOTHING`,
    [
      String(guildId),
      !!config.DEFAULTS.autoEnabled,
      !!config.DEFAULTS.autoRotate,
      String(config.DEFAULTS.communityMode || 'random'),
      !!config.DEFAULTS.dailyPostEnabled,
      config.DEFAULTS.dailyPostChannelId || null,
      !!config.DEFAULTS.personalEnabled,
      clampInt(config.DEFAULTS.personalSlots, 3, 1, 10),
    ]
  );
}

async function getSettings(guildId) {
  await ensureSettings(guildId);
  const res = await pool.query(`SELECT * FROM contract_settings WHERE guild_id = $1`, [String(guildId)]);
  const row = res.rows?.[0] || {};
  return {
    guildId: String(guildId),
    autoEnabled: row.auto_enabled ?? config.DEFAULTS.autoEnabled,
    autoRotate: row.auto_rotate ?? config.DEFAULTS.autoRotate,
    communityMode: row.community_mode || config.DEFAULTS.communityMode,
    dailyPostEnabled: row.daily_post_enabled ?? config.DEFAULTS.dailyPostEnabled,
    dailyPostChannelId: row.daily_post_channel_id || config.DEFAULTS.dailyPostChannelId || null,
    lastDailyPostAt: row.last_daily_post_at ? new Date(row.last_daily_post_at) : null,
    personalEnabled: row.personal_enabled ?? config.DEFAULTS.personalEnabled,
    personalSlots: clampInt(row.personal_slots, config.DEFAULTS.personalSlots, 1, 10),
  };
}

async function updateSettings(guildId, patch = {}) {
  const current = await getSettings(guildId);
  const next = {
    ...current,
    ...patch,
  };
  await pool.query(
    `UPDATE contract_settings
     SET auto_enabled=$2,
         auto_rotate=$3,
         community_mode=$4,
         daily_post_enabled=$5,
         daily_post_channel_id=$6,
         personal_enabled=$7,
         personal_slots=$8,
         updated_at=NOW()
     WHERE guild_id=$1`,
    [
      String(guildId),
      !!next.autoEnabled,
      !!next.autoRotate,
      String(next.communityMode || 'random'),
      !!next.dailyPostEnabled,
      next.dailyPostChannelId || null,
      !!next.personalEnabled,
      clampInt(next.personalSlots, 3, 1, 10),
    ]
  );
  return getSettings(guildId);
}

async function markDailyPost(guildId) {
  await pool.query(`UPDATE contract_settings SET last_daily_post_at = NOW(), updated_at = NOW() WHERE guild_id = $1`, [String(guildId)]);
}

async function getActiveCommunityContract(guildId) {
  await ensureSchema();
  const res = await pool.query(
    `SELECT * FROM community_contracts WHERE guild_id=$1 AND status='active' ORDER BY id DESC LIMIT 1`,
    [String(guildId)]
  );
  return res.rows?.[0] || null;
}

async function getCommunityParticipants(contractId, limit = 5) {
  const res = await pool.query(
    `SELECT user_id, progress, opted_in
     FROM community_contract_participants
     WHERE contract_id=$1
     ORDER BY progress DESC, updated_at ASC
     LIMIT $2`,
    [Number(contractId), Number(limit)]
  );
  return res.rows || [];
}

async function getUserCommunityContribution(contractId, userId) {
  if (!contractId || !userId) return null;
  const res = await pool.query(
    `SELECT user_id, progress, opted_in, rewarded_at, penalized_at
     FROM community_contract_participants WHERE contract_id=$1 AND user_id=$2`,
    [Number(contractId), String(userId)]
  );
  return res.rows?.[0] || null;
}

function pickCommunityTemplate(mode = 'random') {
  const all = Array.isArray(config.communityTemplates) ? config.communityTemplates : [];
  let pool = all;
  if (mode === 'co_op') pool = all.filter((t) => t.type === 'co_op');
  if (mode === 'competitive') pool = all.filter((t) => t.type === 'competitive');
  return pickRandom(pool.length ? pool : all);
}

function pickPersonalTemplate(excludeMetric = null) {
  let pool = Array.isArray(config.personalTemplates) ? config.personalTemplates : [];
  if (excludeMetric) {
    const filtered = pool.filter((t) => t.metric !== excludeMetric);
    if (filtered.length) pool = filtered;
  }
  return pickRandom(pool);
}

function normalizeCommunityPayload(template, overrides = {}) {
  const picked = template || {};
  const durationHours = clampInt(overrides.durationHours ?? picked.durationHours ?? config.DEFAULTS.defaultCommunityDurationHours, config.DEFAULTS.defaultCommunityDurationHours, 1, 24 * 30);
  const target = clampInt(overrides.target ?? resolveRange(picked.target, 10), 10, 1);
  const rewardPool = clampInt(overrides.rewardPool ?? resolveRange(picked.rewardPool, 1000), 1000, 0);
  const penaltyAmount = clampInt(overrides.penaltyAmount ?? resolveRange(picked.penaltyAmount, 0), 0, 0);
  const standingsRewards = Array.isArray(overrides.standingsRewards)
    ? overrides.standingsRewards.map((n) => clampInt(n, 0, 0))
    : Array.isArray(picked.standingsRewards)
      ? picked.standingsRewards.map((n) => clampInt(n, 0, 0))
      : [];

  return {
    templateId: picked.id || overrides.templateId || null,
    type: overrides.type || picked.type || 'co_op',
    metric: overrides.metric || picked.metric || 'jobs_completed',
    title: String(overrides.title || picked.title || 'Community Contract'),
    description: String(overrides.description || picked.description || 'Work toward a shared objective.'),
    target,
    rewardPool,
    standingsRewards,
    optIn: parseBool(overrides.optIn ?? picked.optIn, false),
    penaltyAmount,
    durationHours,
    config: {
      source: 'contracts',
    },
  };
}

async function createCommunityContract(guildId, overrides = {}) {
  const existing = await getActiveCommunityContract(guildId);
  if (existing) {
    return { ok: false, reason: 'already_active', contract: existing };
  }

  const mode = overrides.mode || overrides.type || 'random';
  let template = null;
  if (overrides.templateId) {
    template = (config.communityTemplates || []).find((t) => t.id === overrides.templateId) || null;
  }
  if (!template) template = pickCommunityTemplate(mode === 'random' ? 'random' : mode);
  if (!template) return { ok: false, reason: 'no_template' };

  const payload = normalizeCommunityPayload(template, overrides);
  const endsAt = new Date(Date.now() + payload.durationHours * 60 * 60 * 1000);

  const res = await pool.query(
    `INSERT INTO community_contracts
      (guild_id, template_id, type, metric, title, description, target, progress, reward_pool, standings_rewards, opt_in, penalty_amount, status, started_at, ends_at, config)
     VALUES ($1,$2,$3,$4,$5,$6,$7,0,$8,$9,$10,$11,'active',NOW(),$12,$13)
     RETURNING *`,
    [
      String(guildId),
      payload.templateId,
      payload.type,
      payload.metric,
      payload.title,
      payload.description,
      payload.target,
      payload.rewardPool,
      JSON.stringify(payload.standingsRewards || []),
      !!payload.optIn,
      payload.penaltyAmount,
      endsAt,
      payload.config || {},
    ]
  );
  return { ok: true, contract: res.rows?.[0] || null };
}

async function stopCommunityContract(guildId) {
  const active = await getActiveCommunityContract(guildId);
  if (!active) return { ok: false, reason: 'none_active' };
  await pool.query(
    `UPDATE community_contracts SET status='stopped', completed_at=NOW(), settled_at=NOW() WHERE id=$1`,
    [Number(active.id)]
  );
  return { ok: true, contractId: Number(active.id) };
}

async function getCommunityLeaderboard(contract) {
  if (!contract) return [];
  return getCommunityParticipants(contract.id, 5);
}

async function finalizeCommunityContract(contract, reason = 'expired') {
  if (!contract || contract.status !== 'active') return { ok: false, reason: 'not_active' };

  const participantsRes = await pool.query(
    `SELECT * FROM community_contract_participants WHERE contract_id=$1 ORDER BY progress DESC, updated_at ASC`,
    [Number(contract.id)]
  );
  const participants = participantsRes.rows || [];

  let success = false;
  if (contract.type === 'co_op') {
    const eligible = participants.filter((p) => !contract.opt_in || p.opted_in);
    const total = eligible.reduce((sum, p) => sum + clampInt(p.progress, 0, 0), 0);
    success = total >= clampInt(contract.target, 0, 1);

    if (success && total > 0 && clampInt(contract.reward_pool, 0, 0) > 0) {
      for (const p of eligible) {
        const contribution = clampInt(p.progress, 0, 0);
        if (contribution <= 0) continue;
        const reward = Math.max(1, Math.floor((Number(contract.reward_pool) * contribution) / total));
        await economy.creditUser(String(contract.guild_id), String(p.user_id), reward, 'contract_coop_reward', {
          contractId: Number(contract.id),
          contractType: contract.type,
          contractTitle: String(contract.title),
          contribution,
        });
        await pool.query(`UPDATE community_contract_participants SET rewarded_at=NOW(), updated_at=NOW() WHERE contract_id=$1 AND user_id=$2`, [Number(contract.id), String(p.user_id)]);
      }
    }

    if (!success && contract.opt_in && clampInt(contract.penalty_amount, 0, 0) > 0) {
      for (const p of participants.filter((row) => row.opted_in)) {
        const penalty = clampInt(contract.penalty_amount, 0, 0);
        const debit = await economy.tryDebitUser(String(contract.guild_id), String(p.user_id), penalty, 'contract_optin_penalty', {
          contractId: Number(contract.id),
          contractTitle: String(contract.title),
        });
        if (debit?.ok) {
          await economy.addServerBank(String(contract.guild_id), penalty, 'contract_optin_penalty_bank', { contractId: Number(contract.id), contractTitle: String(contract.title) });
        }
        await pool.query(`UPDATE community_contract_participants SET penalized_at=NOW(), updated_at=NOW() WHERE contract_id=$1 AND user_id=$2`, [Number(contract.id), String(p.user_id)]);
      }
    }
  } else {
    const rewards = Array.isArray(contract.standings_rewards) ? contract.standings_rewards : [];
    const winnerProgress = clampInt(participants[0]?.progress, 0, 0);
    success = winnerProgress > 0;
    if (success) {
      for (let idx = 0; idx < Math.min(3, participants.length); idx++) {
        const reward = clampInt(rewards[idx], 0, 0);
        if (reward <= 0) continue;
        const p = participants[idx];
        await economy.creditUser(String(contract.guild_id), String(p.user_id), reward, 'contract_competitive_reward', {
          contractId: Number(contract.id),
          contractType: contract.type,
          contractTitle: String(contract.title),
          placement: idx + 1,
          contribution: clampInt(p.progress, 0, 0),
        });
        await pool.query(`UPDATE community_contract_participants SET rewarded_at=NOW(), updated_at=NOW() WHERE contract_id=$1 AND user_id=$2`, [Number(contract.id), String(p.user_id)]);
      }
    }
  }

  await pool.query(
    `UPDATE community_contracts
     SET status=$2, completed_at=NOW(), settled_at=NOW(), progress=$3
     WHERE id=$1`,
    [Number(contract.id), success ? 'completed' : 'failed', clampInt(contract.progress, 0, 0)]
  );

  return { ok: true, success, contractId: Number(contract.id), type: String(contract.type) };
}

async function ensurePersonalContracts(guildId, userId) {
  const settings = await getSettings(guildId);
  if (!settings.personalEnabled) return [];

  await pool.query(
    `UPDATE personal_contracts
     SET status='expired'
     WHERE guild_id=$1 AND user_id=$2 AND status='active' AND ends_at <= NOW()`,
    [String(guildId), String(userId)]
  );

  const activeRes = await pool.query(
    `SELECT * FROM personal_contracts
     WHERE guild_id=$1 AND user_id=$2 AND status='active'
     ORDER BY id ASC`,
    [String(guildId), String(userId)]
  );
  const active = activeRes.rows || [];

  const existingMetrics = new Set(active.map((row) => String(row.metric)));
  let toCreate = Math.max(0, clampInt(settings.personalSlots, 3, 1, 10) - active.length);
  while (toCreate > 0) {
    const template = pickPersonalTemplate(existingMetrics.size < 4 ? [...existingMetrics][existingMetrics.size - 1] : null) || pickPersonalTemplate();
    if (!template) break;
    existingMetrics.add(String(template.metric));
    const durationHours = clampInt(template.durationHours ?? config.DEFAULTS.defaultPersonalDurationHours, config.DEFAULTS.defaultPersonalDurationHours, 1, 72);
    const endsAt = new Date(Date.now() + durationHours * 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO personal_contracts
       (guild_id, user_id, template_id, metric, title, description, target, progress, reward, status, started_at, ends_at, config)
       VALUES ($1,$2,$3,$4,$5,$6,$7,0,$8,'active',NOW(),$9,$10)`,
      [
        String(guildId),
        String(userId),
        template.id || null,
        String(template.metric),
        String(template.title),
        String(template.description),
        clampInt(resolveRange(template.target, 1), 1, 1),
        clampInt(resolveRange(template.reward, 0), 0, 0),
        endsAt,
        { from: 'contracts' },
      ]
    );
    toCreate -= 1;
  }

  const finalRes = await pool.query(
    `SELECT * FROM personal_contracts
     WHERE guild_id=$1 AND user_id=$2
       AND status IN ('active','completed')
     ORDER BY CASE WHEN status='active' THEN 0 ELSE 1 END, id ASC
     LIMIT 6`,
    [String(guildId), String(userId)]
  );
  return finalRes.rows || [];
}

async function recordProgress({ guildId, userId, metric, amount }) {
  const delta = clampInt(amount, 0, 0);
  if (!guildId || !userId || !metric || delta <= 0) return;
  await ensureSchema();

  const contract = await getActiveCommunityContract(guildId);
  if (contract && String(contract.metric) === String(metric)) {
    if (!contract.opt_in || contract.type === 'competitive') {
      await pool.query(
        `INSERT INTO community_contract_participants (contract_id, guild_id, user_id, progress, opted_in, updated_at)
         VALUES ($1,$2,$3,$4,FALSE,NOW())
         ON CONFLICT (contract_id, user_id)
         DO UPDATE SET progress = community_contract_participants.progress + EXCLUDED.progress, updated_at=NOW()`,
        [Number(contract.id), String(guildId), String(userId), delta]
      );
      if (contract.type === 'co_op') {
        await pool.query(`UPDATE community_contracts SET progress = progress + $2 WHERE id=$1`, [Number(contract.id), delta]);
      } else {
        const top = await pool.query(`SELECT COALESCE(MAX(progress), 0) AS max_progress FROM community_contract_participants WHERE contract_id=$1`, [Number(contract.id)]);
        const topProgress = clampInt(top.rows?.[0]?.max_progress, 0, 0);
        await pool.query(`UPDATE community_contracts SET progress=$2 WHERE id=$1`, [Number(contract.id), topProgress]);
      }
    } else {
      const who = await getUserCommunityContribution(contract.id, userId);
      if (who?.opted_in) {
        await pool.query(
          `UPDATE community_contract_participants
           SET progress = progress + $3, updated_at=NOW()
           WHERE contract_id=$1 AND user_id=$2`,
          [Number(contract.id), String(userId), delta]
        );
        await pool.query(`UPDATE community_contracts SET progress = progress + $2 WHERE id=$1`, [Number(contract.id), delta]);
      }
    }

    const refreshed = await getActiveCommunityContract(guildId);
    if (refreshed && clampInt(refreshed.progress, 0, 0) >= clampInt(refreshed.target, 1, 1)) {
      await finalizeCommunityContract(refreshed, 'target_reached');
    }
  }

  const personals = await pool.query(
    `SELECT * FROM personal_contracts
     WHERE guild_id=$1 AND user_id=$2 AND status='active' AND metric=$3`,
    [String(guildId), String(userId), String(metric)]
  );

  for (const row of personals.rows || []) {
    const nextProgress = clampInt(row.progress, 0, 0) + delta;
    const completed = nextProgress >= clampInt(row.target, 1, 1);
    await pool.query(
      `UPDATE personal_contracts
       SET progress=$2,
           status = CASE WHEN $3 THEN 'completed' ELSE status END,
           completed_at = CASE WHEN $3 THEN NOW() ELSE completed_at END
       WHERE id=$1`,
      [Number(row.id), nextProgress, completed]
    );

    if (completed && !row.rewarded_at) {
      const reward = clampInt(row.reward, 0, 0);
      if (reward > 0) {
        await economy.creditUser(String(guildId), String(userId), reward, 'contract_personal_reward', {
          contractId: Number(row.id),
          contractTitle: String(row.title),
          metric: String(metric),
        });
      }
      await pool.query(`UPDATE personal_contracts SET rewarded_at=NOW() WHERE id=$1`, [Number(row.id)]);
    }
  }
}

async function optIntoCommunityContract(guildId, userId) {
  const contract = await getActiveCommunityContract(guildId);
  if (!contract) return { ok: false, reason: 'no_active' };
  if (!contract.opt_in) return { ok: false, reason: 'not_optin' };

  await pool.query(
    `INSERT INTO community_contract_participants (contract_id, guild_id, user_id, progress, opted_in, updated_at)
     VALUES ($1,$2,$3,0,TRUE,NOW())
     ON CONFLICT (contract_id, user_id)
     DO UPDATE SET opted_in=TRUE, updated_at=NOW()`,
    [Number(contract.id), String(guildId), String(userId)]
  );
  return { ok: true, contractId: Number(contract.id) };
}

function buildCommunityButtons(contract, opts = {}) {
  const showOptIn = !!contract?.opt_in && opts.includeOptIn !== false;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(BTN_OPEN).setLabel('Active Contract').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(BTN_PERSONAL).setLabel('My Personal Contracts').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(BTN_REFRESH).setLabel('Refresh').setStyle(ButtonStyle.Secondary),
  );
  if (showOptIn) {
    row.addComponents(new ButtonBuilder().setCustomId(BTN_OPT_IN).setLabel('Opt In').setStyle(ButtonStyle.Danger));
  }
  return [row];
}

async function buildCommunityEmbed(guildId, viewerId = null) {
  const contract = await getActiveCommunityContract(guildId);
  const embed = new EmbedBuilder().setColor(0x0875AF).setTitle('📜 Community Contract');

  if (!contract) {
    embed.setDescription('No community contract is active right now.');
    return { embed, contract: null };
  }

  const leaderboard = await getCommunityLeaderboard(contract);
  const mine = viewerId ? await getUserCommunityContribution(contract.id, viewerId) : null;
  const timeLeft = contract.ends_at ? Math.floor(new Date(contract.ends_at).getTime() / 1000) : null;
  const isCompetitive = String(contract.type) === 'competitive';
  const metricLabel = formatMetricLabel(contract.metric);
  const current = clampInt(contract.progress, 0, 0);
  const target = clampInt(contract.target, 1, 1);

  embed
    .setTitle(`${isCompetitive ? '🏁' : '🤝'} ${contract.title}`)
    .setDescription(contract.description)
    .addFields(
      { name: 'Type', value: isCompetitive ? 'Competitive' : (contract.opt_in ? 'Co-Op • Opt-In Risk' : 'Co-Op'), inline: true },
      { name: 'Metric', value: metricLabel, inline: true },
      { name: 'Ends', value: timeLeft ? `<t:${timeLeft}:R>` : '—', inline: true },
      { name: 'Progress', value: `${buildProgressBar(current, target)}
${formatValue(contract.metric, current)} / ${formatValue(contract.metric, target)}`, inline: false },
    );

  if (isCompetitive) {
    const rewards = Array.isArray(contract.standings_rewards) ? contract.standings_rewards : [];
    embed.addFields({
      name: 'Top Standings',
      value: leaderboard.length
        ? leaderboard.map((row, idx) => `**#${idx + 1}** <@${row.user_id}> — ${formatValue(contract.metric, row.progress)}`).join('\n')
        : '_Nobody has scored yet._',
      inline: false,
    });
    embed.addFields({
      name: 'Prizes',
      value: rewards.length ? rewards.map((v, idx) => `#${idx + 1}: $${clampInt(v,0,0).toLocaleString('en-AU')}`).join('\n') : '_No prizes set._',
      inline: false,
    });
  } else {
    embed.addFields({
      name: contract.opt_in ? 'Top Contributors / Pledges' : 'Top Contributors',
      value: leaderboard.length
        ? leaderboard.map((row, idx) => `**#${idx + 1}** <@${row.user_id}> — ${formatValue(contract.metric, row.progress)}${row.opted_in ? ' • opted in' : ''}`).join('\n')
        : '_Nobody has contributed yet._',
      inline: false,
    });
    embed.addFields({
      name: 'Reward Pool',
      value: `$${clampInt(contract.reward_pool, 0, 0).toLocaleString('en-AU')}${contract.opt_in && clampInt(contract.penalty_amount,0,0) > 0 ? `\nPenalty on failure: $${clampInt(contract.penalty_amount,0,0).toLocaleString('en-AU')}` : ''}`,
      inline: false,
    });
  }

  if (viewerId) {
    embed.addFields({
      name: 'Your Standing',
      value: mine
        ? `${formatValue(contract.metric, mine.progress)}${mine.opted_in ? ' • opted in' : ''}`
        : (contract.opt_in ? 'You have not opted in yet.' : 'You have not contributed yet.'),
      inline: false,
    });
  }

  embed.setFooter({ text: 'Use the button below to view your personal contracts.' }).setTimestamp();
  return { embed, contract, mine };
}

async function buildPersonalEmbed(guildId, userId) {
  const contracts = await ensurePersonalContracts(guildId, userId);
  const embed = new EmbedBuilder()
    .setColor(0x0875AF)
    .setTitle('🧾 Your Personal Contracts')
    .setDescription('Private objectives that tick along quietly in the background. Rewards are paid automatically when completed.');

  if (!contracts.length) {
    embed.addFields({ name: 'No Personal Contracts', value: 'Personal contracts are currently disabled or none could be generated.' });
    return embed;
  }

  for (const row of contracts.slice(0, 6)) {
    const target = clampInt(row.target, 1, 1);
    const progress = Math.min(clampInt(row.progress, 0, 0), target);
    const ends = row.ends_at ? Math.floor(new Date(row.ends_at).getTime() / 1000) : null;
    embed.addFields({
      name: `${row.status === 'completed' ? '✅' : '📌'} ${row.title}`,
      value: [
        row.description,
        `${buildProgressBar(progress, target, 12)} ${formatValue(row.metric, progress)} / ${formatValue(row.metric, target)}`,
        `Reward: $${clampInt(row.reward, 0, 0).toLocaleString('en-AU')}`,
        row.status === 'completed' ? 'Status: Completed' : `Ends: ${ends ? `<t:${ends}:R>` : '—'}`,
      ].join('\n'),
      inline: false,
    });
  }

  embed.setTimestamp();
  return embed;
}

async function buildDashboardPayload(guildId, userId) {
  const { embed, contract } = await buildCommunityEmbed(guildId, userId);
  return {
    embeds: [embed],
    components: buildCommunityButtons(contract),
    flags: MessageFlags.Ephemeral,
  };
}

async function buildDailyPostPayload(guildId) {
  const { embed, contract } = await buildCommunityEmbed(guildId, null);
  embed.setFooter({ text: 'Daily contract update • Use the buttons below to check your own contracts.' });
  return {
    embeds: [embed],
    components: buildCommunityButtons(contract),
  };
}

async function maybeAutoStartCommunity(guildId) {
  const settings = await getSettings(guildId);
  if (!settings.autoEnabled) return { ok: false, reason: 'disabled' };
  const active = await getActiveCommunityContract(guildId);
  if (active) return { ok: false, reason: 'already_active', contract: active };
  const mode = String(settings.communityMode || 'random');
  return createCommunityContract(guildId, { mode });
}

async function forceRotateCommunity(guildId) {
  const active = await getActiveCommunityContract(guildId);
  if (active) {
    await finalizeCommunityContract(active, 'manual_rotate');
  }
  const settings = await getSettings(guildId);
  return createCommunityContract(guildId, { mode: String(settings.communityMode || 'random') });
}

async function postDailyUpdateImpl(client, guildId, force = false) {
  const settings = await getSettings(guildId);
  if (!settings.dailyPostEnabled) return { ok: false, reason: 'daily_disabled' };
  if (!settings.dailyPostChannelId) return { ok: false, reason: 'no_channel' };
  const active = await getActiveCommunityContract(guildId);
  if (!active) return { ok: false, reason: 'no_active' };
  const last = settings.lastDailyPostAt ? new Date(settings.lastDailyPostAt) : null;
  if (!force && last && Date.now() - last.getTime() < 20 * 60 * 60 * 1000) {
    return { ok: false, reason: 'too_soon' };
  }

  const channel = await client.channels.fetch(String(settings.dailyPostChannelId)).catch(() => null);
  if (!channel || !channel.isTextBased?.()) return { ok: false, reason: 'bad_channel' };
  const payload = await buildDailyPostPayload(guildId);
  const sent = await channel.send(payload).catch(() => null);
  if (!sent) return { ok: false, reason: 'send_failed' };
  await markDailyPost(guildId);
  return { ok: true };
}

async function schedulerTick(client) {
  await ensureSchema();
  const settingsRes = await pool.query(`SELECT guild_id FROM contract_settings`);
  const guildIds = [...new Set((settingsRes.rows || []).map((r) => String(r.guild_id)).filter(Boolean))];

  for (const guildId of guildIds) {
    const active = await getActiveCommunityContract(guildId);
    if (active && active.ends_at && new Date(active.ends_at).getTime() <= Date.now()) {
      await finalizeCommunityContract(active, 'expired').catch((err) => console.error('[CONTRACTS] finalize failed:', err));
    }

    const settings = await getSettings(guildId);
    const refreshedActive = await getActiveCommunityContract(guildId);
    if (!refreshedActive && settings.autoEnabled && settings.autoRotate) {
      await maybeAutoStartCommunity(guildId).catch((err) => console.error('[CONTRACTS] auto-start failed:', err));
    }

    await postDailyUpdateImpl(client, guildId, false).catch((err) => console.error('[CONTRACTS] daily post failed:', err));

    await pool.query(`UPDATE personal_contracts SET status='expired' WHERE guild_id=$1 AND status='active' AND ends_at <= NOW()`, [String(guildId)]).catch(() => {});
  }
}

function startScheduler(client) {
  if (schedulerStarted) return;
  schedulerStarted = true;
  schedulerHandle = setInterval(() => {
    schedulerTick(client).catch((err) => console.error('[CONTRACTS] scheduler tick failed:', err));
  }, 15 * 60 * 1000);
  schedulerTick(client).catch((err) => console.error('[CONTRACTS] initial tick failed:', err));
}

async function handleInteraction(interaction) {
  const cid = String(interaction.customId || '');
  if (!cid.startsWith('contracts:')) return false;
  if (!interaction.inGuild?.() || !interaction.guildId) {
    await interaction.reply({ content: '❌ Server only.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }

  try {
    if (cid === BTN_OPEN || cid === BTN_REFRESH) {
      const payload = await buildDashboardPayload(interaction.guildId, interaction.user.id);
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(payload).catch(() => {});
      } else {
        await interaction.reply(payload).catch(() => {});
      }
      return true;
    }

    if (cid === BTN_PERSONAL) {
      const embed = await buildPersonalEmbed(interaction.guildId, interaction.user.id);
      const payload = { embeds: [embed], flags: MessageFlags.Ephemeral };
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(payload).catch(() => {});
      } else {
        await interaction.reply(payload).catch(() => {});
      }
      return true;
    }

    if (cid === BTN_OPT_IN) {
      const res = await optIntoCommunityContract(interaction.guildId, interaction.user.id);
      let content = '❌ No opt-in contract is active right now.';
      if (res.ok) content = '🩸 You are in. If this opt-in community contract fails, your wallet is on the line.';
      else if (res.reason === 'not_optin') content = '⚠️ The current community contract is not an opt-in risk contract.';
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
      } else {
        await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
      }
      return true;
    }
  } catch (err) {
    console.error('[CONTRACTS] interaction failed:', err);
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: '❌ Contracts interaction failed.', flags: MessageFlags.Ephemeral });
      } else {
        await interaction.reply({ content: '❌ Contracts interaction failed.', flags: MessageFlags.Ephemeral });
      }
    } catch (_) {}
    return true;
  }

  return false;
}

module.exports = {
  ensureSchema,
  getSettings,
  updateSettings,
  getActiveCommunityContract,
  createCommunityContract,
  stopCommunityContract,
  forceRotateCommunity,
  maybeAutoStartCommunity,
  buildDashboardPayload,
  buildDailyPostPayload,
  buildPersonalEmbed,
  recordProgress,
  optIntoCommunityContract,
  postDailyUpdate: postDailyUpdateImpl,
  startScheduler,
  handleInteraction,
};
