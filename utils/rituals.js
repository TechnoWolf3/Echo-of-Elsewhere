const { pool } = require('./db');
const { ensureUser } = require('./economy');
const { creditUserWithEffects } = require('./effectSystem');
const { recordProgress: recordContractProgress } = require('./contracts');

function getSydneyParts(date = new Date(), extra = {}) {
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    ...extra,
  })
    .formatToParts(date)
    .reduce((acc, p) => {
      acc[p.type] = p.value;
      return acc;
    }, {});
}

function sydneyLocalToUTC(year, month, day, hour = 0, minute = 0, second = 0) {
  const approx = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const sydneyAtUTC = new Date(approx.toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
  const utcAtUTC = new Date(approx.toLocaleString('en-US', { timeZone: 'UTC' }));
  const offsetMs = sydneyAtUTC.getTime() - utcAtUTC.getTime();
  return new Date(approx.getTime() - offsetMs);
}

function nextSydneyMidnightUTC() {
  const parts = getSydneyParts();
  return sydneyLocalToUTC(Number(parts.year), Number(parts.month), Number(parts.day) + 1, 0, 0, 0);
}

function nextSydneyMondayMidnightUTC() {
  const parts = getSydneyParts(new Date(), { weekday: 'short' });
  const map = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const isoDow = map[parts.weekday] || 1;
  const daysUntilNextMonday = ((8 - isoDow) % 7) || 7;
  return sydneyLocalToUTC(Number(parts.year), Number(parts.month), Number(parts.day) + daysUntilNextMonday, 0, 0, 0);
}

function nextSydneyMonthMidnightUTC() {
  const parts = getSydneyParts();
  let year = Number(parts.year);
  let month = Number(parts.month) + 1;
  if (month > 12) {
    month = 1;
    year += 1;
  }
  return sydneyLocalToUTC(year, month, 1, 0, 0, 0);
}

function randomInt(min, max) {
  const lo = Math.floor(Number(min || 0));
  const hi = Math.floor(Number(max || 0));
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return 0;
  if (hi <= lo) return lo;
  return Math.floor(lo + Math.random() * (hi - lo + 1));
}

async function getCooldownRow(guildId, userId, cooldownKey) {
  const res = await pool.query(
    `SELECT next_claim_at FROM cooldowns WHERE guild_id=$1 AND user_id=$2 AND key=$3`,
    [String(guildId), String(userId), String(cooldownKey)]
  );
  return res.rows?.[0] || null;
}

async function getRitualStatus(guildId, userId, ritual) {
  await ensureUser(guildId, userId);
  const row = await getCooldownRow(guildId, userId, ritual.cooldownKey);
  const now = new Date();
  const nextClaimAt = row?.next_claim_at ? new Date(row.next_claim_at) : null;
  const available = !nextClaimAt || now >= nextClaimAt;
  return {
    ritualId: ritual.id,
    available,
    nextClaimAt,
    unix: nextClaimAt ? Math.floor(nextClaimAt.getTime() / 1000) : null,
  };
}

async function setNextClaim(guildId, userId, cooldownKey, nextClaimAt) {
  await pool.query(
    `INSERT INTO cooldowns (guild_id, user_id, key, next_claim_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (guild_id, user_id, key) DO UPDATE SET next_claim_at=EXCLUDED.next_claim_at`,
    [String(guildId), String(userId), String(cooldownKey), nextClaimAt]
  );
}

async function claimRitual({ guildId, userId, ritual }) {
  await ensureUser(guildId, userId);

  const status = await getRitualStatus(guildId, userId, ritual);
  if (!status.available) {
    return {
      ok: false,
      status,
      message: ritual.cooldownText({ unix: status.unix, nextClaimAt: status.nextClaimAt }),
    };
  }

  const amount = randomInt(ritual.payout?.min, ritual.payout?.max);
  const nextClaimAt = ritual.nextClaimAt();

  await setNextClaim(guildId, userId, ritual.cooldownKey, nextClaimAt);

  const payout = await creditUserWithEffects({
    guildId,
    userId,
    amount,
    type: ritual.type || ritual.id,
    meta: { ritual: ritual.id, reset: ritual.cooldownKey },
    activityEffects: ritual.activityEffects,
    awardSource: ritual.awardSource || ritual.id,
  });

  await recordContractProgress({ guildId, userId, metric: 'rituals_completed', amount: 1 }).catch(() => {});
  await recordContractProgress({ guildId, userId, metric: 'ritual_earnings', amount: payout.finalAmount || amount }).catch(() => {});

  const lines = [ritual.claimText({ amount: payout.finalAmount, baseAmount: amount, nextClaimAt })];
  if (payout?.awardResult?.notice) lines.push('', payout.awardResult.notice);

  return {
    ok: true,
    status: {
      ritualId: ritual.id,
      available: false,
      nextClaimAt,
      unix: Math.floor(nextClaimAt.getTime() / 1000),
    },
    payout,
    message: lines.join('\n'),
  };
}

function buildStatusLine(ritual, status) {
  if (status?.available) {
    return `✨ **${ritual.name}** — Ready now`;
  }
  return `🌘 **${ritual.name}** — Returns <t:${status.unix}:R>`;
}

module.exports = {
  getSydneyParts,
  sydneyLocalToUTC,
  nextSydneyMidnightUTC,
  nextSydneyMondayMidnightUTC,
  nextSydneyMonthMidnightUTC,
  getRitualStatus,
  claimRitual,
  buildStatusLine,
};
