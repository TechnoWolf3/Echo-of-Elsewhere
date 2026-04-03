// commands/job.js
//Comment to force git push
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  StringSelectMenuBuilder,
} = require("discord.js");

const { pool } = require("../utils/db");
const { ensureUser } = require("../utils/economy");
const { creditUserWithEffects } = require("../utils/effectSystem");
const { guardNotJailed, guardNotJailedComponent } = require("../utils/jail"); // jail blocks ALL jobs while active
const { unlockAchievement } = require("../utils/achievementEngine");

// ✅ UPDATED: add getCrimeHeatInfo for bar + timer UI
const {
  getCrimeHeatInfo,
  getCrimeHeat,
  setCrimeHeat,
  heatTTLMinutesForOutcome,
} = require("../utils/crimeHeat");

// ✅ Grind fatigue (shared across Grind jobs)
const { canGrind: canGrindFatigue, fatigueBar: grindFatigueBar } = require("../utils/grindFatigue");

// ✅ Config imports
const nineToFiveIndex = require("../data/work/categories/nineToFive/index");
const contractCfg = require("../data/work/categories/nineToFive/transportContract");
const skillCfg = require("../data/work/categories/nineToFive/skillCheck");
const shiftCfg = require("../data/work/categories/nineToFive/shift");
const truckerCfg = require("../data/work/categories/nineToFive/trucker");

const nightWalker = require("../data/work/categories/nightwalker/index");

// ✅ Crime
const startStoreRobbery = require("../data/work/categories/crime/storeRobbery");
const startHeist = require("../data/work/categories/crime/heist");
const startScamCall = require("../data/work/categories/crime/scamCall");

// ✅ Grind (NEW)
const grindIndex = require("../data/work/categories/grind/index");
const startStoreClerk = require("../data/work/categories/grind/storeClerk");
const startWarehousing = require("../data/work/categories/grind/warehousing");
const startFishing = require("../data/work/categories/grind/fishing");
const startQuarry = require("../data/work/categories/grind/quarry");
const startTaxiDriver = require("../data/work/categories/grind/taxiDriver");
const { renderProgressBar } = require("../utils/progressBar");

// ✅ Farming
const farming = require("../utils/farming/engine");

/* ============================================================
   CORE TUNING (keep here; configs handle job-specific values)
   ============================================================ */

const JOB_COOLDOWN_SECONDS = 45;
const BOARD_INACTIVITY_MS = 25 * 60_000;

// Legendary (kept in command for now)
const LEGENDARY_CHANCE = 0.012;
const LEGENDARY_TTL_MS = 60_000;
const LEGENDARY_MIN = 50_000;
const LEGENDARY_MAX = 90_000;
const LEGENDARY_SKILL_TIME_MS = 7_000;

// Optional global bonus (kept in command)
const GLOBAL_BONUS_CHANCE = 0.04;
const GLOBAL_BONUS_MIN = 400;
const GLOBAL_BONUS_MAX = 2000;

/* ============================================================
   Crime cooldown keys (Crime-only system)
   ============================================================ */
const CRIME_GLOBAL_KEY = "crime_global";
const CRIME_KEYS = {
  store: "crime_store",
  chase: "crime_chase",
  drugs: "crime_drugs",
  heist: "crime_heist",
  major: "crime_heist_major",
  scam: "crime_scam",
};

/* ============================================================
   Leveling
   ============================================================ */
function xpToNext(level) {
  return 100 + (Math.max(1, level) - 1) * 60;
}
function levelMultiplier(level) {
  const mult = 1 + 0.02 * (Math.max(1, level) - 1);
  return Math.min(mult, 1.6);
}

/* ============================================================
   Helpers
   ============================================================ */
function randInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function progressBar(pct, size = 16) {
  return renderProgressBar(pct, 100, { length: size });
}
function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}
function safeLabel(s) {
  const t = String(s ?? "").trim();
  if (t.length <= 80) return t;
  return t.slice(0, 77) + "...";
}
function safeDesc(s) {
  const t = String(s ?? "").trim();
  if (!t) return "";
  // Discord select option descriptions are capped at 100 chars.
  if (t.length <= 100) return t;
  return t.slice(0, 97) + "...";
}

function sampleUnique(arr, n) {
  const copy = [...arr];
  const out = [];
  while (copy.length && out.length < n) {
    out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
  }
  return out;
}
function toUnix(date) {
  return Math.floor(date.getTime() / 1000);
}

// ✅ Heat bar helpers
function heatBar(value, size = 16) {
  return renderProgressBar(value, 100, { length: size });
}
function unixFromDate(d) {
  if (!d) return null;
  const dt = new Date(d);
  const t = dt.getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor(t / 1000);
}
function cdLine(label, unixTs) {
  return unixTs ? `⏳ ${label}: <t:${unixTs}:R>` : `✅ ${label}: Ready`;
}

/**
 * Ensure the button interaction is acknowledged (prevents "This interaction failed").
 * Safe to call multiple times.
 */
async function ensureAck(i) {
  if (i.deferred || i.replied) return;
  await i.deferUpdate().catch(() => {});
}

/* ============================================================
   Heist Heat TTL (S4/S5)
   - Keep this local for now so you can tweak without touching utils.
   - /job persists heat AFTER the minigame via setCrimeHeat().
   ============================================================ */
function heatTTLMinutesForHeistOutcome(outcome, { mode = "heist" } = {}) {
  const heist = {
    clean: 30,
    spotted: 60,
    partial: 180,
    busted: 720,
    busted_hard: 720,
  };

  const major = {
    clean: 60,
    spotted: 120,
    partial: 240,
    busted: 720,
    busted_hard: 1440, // set to 720 if you want a hard 12h max
  };

  const map = mode === "major" ? major : heist;
  return map[outcome] ?? map.spotted;
}

/* ============================================================
   Cooldowns
   ============================================================ */
async function getCooldown(guildId, userId, key) {
  const cd = await pool.query(
    `SELECT next_claim_at FROM cooldowns WHERE guild_id=$1 AND user_id=$2 AND key=$3`,
    [guildId, userId, key]
  );
  if (cd.rowCount === 0) return null;

  const next = new Date(cd.rows[0].next_claim_at);
  if (Number.isNaN(next.getTime())) return null;
  return next;
}
async function setCooldown(guildId, userId, key, nextClaimAt) {
  await pool.query(
    `INSERT INTO cooldowns (guild_id, user_id, key, next_claim_at)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (guild_id, user_id, key)
     DO UPDATE SET next_claim_at = EXCLUDED.next_claim_at`,
    [guildId, userId, key, nextClaimAt]
  );
}

async function getCooldownUnixIfActive(guildId, userId, key) {
  const next = await getCooldown(guildId, userId, key);
  if (!next) return null;
  const now = new Date();
  if (now >= next) return null;
  return Math.floor(next.getTime() / 1000);
}

/* ============================================================
   Job Progress (xp/level)
   ============================================================ */
async function getJobProgress(guildId, userId) {
  await pool.query(
    `INSERT INTO job_progress (guild_id, user_id, xp, level, total_jobs)
     VALUES ($1,$2,0,1,0)
     ON CONFLICT (guild_id, user_id) DO NOTHING`,
    [guildId, userId]
  );

  const res = await pool.query(
    `SELECT xp, level, total_jobs FROM job_progress WHERE guild_id=$1 AND user_id=$2`,
    [guildId, userId]
  );

  const row = res.rows[0] || { xp: 0, level: 1, total_jobs: 0 };
  return {
    xp: Number(row.xp) || 0,
    level: Number(row.level) || 1,
    totalJobs: Number(row.total_jobs) || 0,
  };
}

async function addXpAndMaybeLevel(guildId, userId, xpGain, countJob = true) {
  const p = await getJobProgress(guildId, userId);
  let xp = p.xp + (xpGain || 0);
  let level = p.level;
  let leveledUp = false;

  while (xp >= xpToNext(level)) {
    xp -= xpToNext(level);
    level += 1;
    leveledUp = true;
  }

  const totalJobs = p.totalJobs + (countJob ? 1 : 0);

  await pool.query(
    `UPDATE job_progress
     SET xp=$1, level=$2, total_jobs=$3
     WHERE guild_id=$4 AND user_id=$5`,
    [xp, level, totalJobs, guildId, userId]
  );

  return { xp, level, totalJobs, leveledUp };
}

/* ============================================================
   Achievements — milestones on total_jobs
   ============================================================ */
const JOB_MILESTONES = [
  { id: "job_first_fin", count: 1 },
  { id: "job_10_fin", count: 10 },
  { id: "job_50_fin", count: 50 },
  { id: "job_100_win", count: 100 },
  { id: "job_250_fin", count: 250 },
];

async function fetchAchievementInfo(achievementId) {
  const res = await pool.query(`SELECT id, name, description FROM achievements WHERE id=$1`, [achievementId]);
  return res.rows[0] || { id: achievementId, name: "Achievement Unlocked", description: "" };
}

async function announceAchievement(channel, userId, info) {
  const embed = new EmbedBuilder()
    .setTitle("🏆 Achievement Unlocked!")
    .setDescription(`<@${userId}> unlocked **${info.name}**\n${info.description || ""}`.trim())
    .setColor(0xffd54a)
    .setFooter({ text: `Achievement ID: ${info.id}` });

  await channel.send({ embeds: [embed] }).catch(() => {});
}

async function handleJobMilestones({ channel, guildId, userId, totalJobs }) {
  const hit = JOB_MILESTONES.find((m) => m.count === totalJobs);
  if (!hit) return;

  const res = await unlockAchievement({
    db: pool,
    guildId,
    userId,
    achievementId: hit.id,
  });

  if (!res?.unlocked) return;

  const info = await fetchAchievementInfo(hit.id);
  await announceAchievement(channel, userId, info);
}

/* ============================================================
   UI: Hub + Category Boards
   ============================================================ */

function statusLineFromCooldown(cooldownUnix) {
  return cooldownUnix ? `⏳ **Next payout** <t:${cooldownUnix}:R>` : `✅ **Ready** — you can work now.`;
}

function buildHubEmbed(user, progress, cooldownUnix) {
  const need = xpToNext(progress.level);
  const mult = levelMultiplier(progress.level);
  const bonusPct = Math.round((mult - 1) * 100);

  return new EmbedBuilder()
    .setTitle("🧰 Job Board")
    .setDescription(
      [
        `Pick what kind of work you want to do, **${user.username}**.`,
        "",
        statusLineFromCooldown(cooldownUnix),
      ].join("\n")
    )
    .addFields(
      {
        name: "Progress",
        value: `Level ${progress.level} • XP ${progress.xp}/${need} • Bonus +${bonusPct}%`,
      },
      {
        name: "Job Type",
        value: [
          "📦 **Work a 9–5** — Classic shift work",
          "🧠 **Night Walker** — Work to please the night",
          "🕒 **Grind** — Jobs that take time",
          "🕶️ **Crime** — High risk, heat & jail",
          "🏭 **Enterprises** — Long-term business systems"
        ].join("\n"),
      },
      {
        name: "Rules",
        value: `Cooldown between payouts: **${JOB_COOLDOWN_SECONDS}s**\nAuto-clears after **3m** inactivity (or **Stop Work**)`,
      }
    )
    .setFooter({ text: "Leveling up increases payout bonus." });
}

function buildHubComponents(disabled = false) {
  const catRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("job_select:category")
      .setPlaceholder("Choose a category...")
      .addOptions(
        { label: "Work a 9–5", value: "job_cat:95", emoji: "📦" },
        { label: "Night Walker", value: "job_cat:nw", emoji: "🧠" },
        { label: "Grind", value: "job_cat:grind", emoji: "🕒" },
        { label: "Crime", value: "job_cat:crime", emoji: "🕶️" },
        { label: "Enterprises", value: "job_cat:enterprises", emoji: "🏭" }
      )
      .setDisabled(disabled)
  );

  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("job_stop").setLabel("🗑 Close").setStyle(ButtonStyle.Danger).setDisabled(disabled)
  );

  return [catRow, navRow];
}

function buildEnterprisesEmbed({ cooldownUnix } = {}) {
  return new EmbedBuilder()
    .setTitle("🏭 Enterprises")
    .setDescription(
      [
        statusLineFromCooldown(cooldownUnix),
        "",
        "Build long-term operations that grow over time.",
        "",
        "🌾 **Farming** — Fields, machinery, contracts, and produce markets.",
        "⛏️ **Mining** — Coming later.",
        "🏭 **Manufacturing** — Coming later.",
      ].join("\n")
    )
    .setColor(0x2b2d31);
}

function buildEnterprisesComponents(disabled = false) {
  const catRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("job_select:category")
      .setPlaceholder("Choose a category...")
      .addOptions(
        { label: "Work a 9–5", value: "job_cat:95", emoji: "📦" },
        { label: "Night Walker", value: "job_cat:nw", emoji: "🧠" },
        { label: "Grind", value: "job_cat:grind", emoji: "🕒" },
        { label: "Crime", value: "job_cat:crime", emoji: "🕶️" },
        { label: "🏭 Enterprises", value: "job_cat:enterprises", emoji: "🏭", default: true }
      )
      .setDisabled(disabled)
  );

  const enterpriseRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("job_select:job")
      .setPlaceholder("Choose an enterprise...")
      .addOptions(
        {
          label: "Farming",
          value: "enterprise:farming",
          emoji: "🌾"
        }
      )
      .setDisabled(disabled)
  );

  return [catRow, enterpriseRow];
}

function buildFarmingPlaceholderEmbed() {
  return new EmbedBuilder()
    .setTitle("🌾 Echo Farming")
    .setDescription(
      "Farming system is being prepared.\n\n" +
      "This will include:\n" +
      "• Fields\n" +
      "• Machines\n" +
      "• Contracts\n" +
      "• Market\n\n" +
      "Coming very soon..."
    )
    .setColor(0x0875AF);
}

function buildNineToFiveEmbed(user, progress, cooldownUnix) {
  const need = xpToNext(progress.level);
  const mult = levelMultiplier(progress.level);
  const bonusPct = Math.round((mult - 1) * 100);

  const jobLines = nineToFiveIndex.jobs
    .map((j) => `${j.title} — ${j.desc}`)
    .join("\n");

  return new EmbedBuilder()
    .setTitle(nineToFiveIndex.category?.title || "📦 Work a 9–5")
    .setDescription([statusLineFromCooldown(cooldownUnix), "", nineToFiveIndex.category?.description || ""].join("\n").trim())
    .addFields(
      { name: "Progress", value: `Level ${progress.level} • XP ${progress.xp}/${need} • Bonus +${bonusPct}%` },
      { name: "Jobs", value: jobLines || "No jobs configured." }
    )
    .setFooter({ text: nineToFiveIndex.category?.footer || "Cooldown blocks payouts, not browsing." });
}

function buildNineToFiveComponents({ disabled = false, legendary = false } = {}) {
  const catRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("job_select:category")
      .setPlaceholder("Choose a category...")
      .addOptions(
        { label: "Work a 9–5", value: "job_cat:95", emoji: "📦", default: true },
        { label: "Night Walker", value: "job_cat:nw", emoji: "🧠" },
        { label: "Grind", value: "job_cat:grind", emoji: "🕒" },
        { label: "Crime", value: "job_cat:crime", emoji: "🕶️" },
        { label: "Enterprises", value: "job_cat:enterprises", emoji: "🏭" }
      )
      .setDisabled(disabled)
  );

  const jobMenu = new StringSelectMenuBuilder()
    .setCustomId("job_select:job")
    .setPlaceholder("Choose a job...")
    .setDisabled(disabled);

  for (const j of nineToFiveIndex.jobs) {
    jobMenu.addOptions({
      label: safeLabel(j.title || j.key),
      value: j.button.id,
      description: j.desc ? safeDesc(j.desc) : undefined,
      emoji: (j.button?.label || "").split(" ")[0] || "🧩",
    });
  }

  if (nineToFiveIndex.legendary?.enabled && legendary) {
    jobMenu.addOptions({
      label: safeLabel("Legendary"),
      value: nineToFiveIndex.legendary.button.id,
      description: safeDesc("Special jobs (when available)."),
      emoji: "🌟",
    });
  }

  const jobRow = new ActionRowBuilder().addComponents(jobMenu);

  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("job_back:hub").setLabel("⬅ Back").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId("job_home").setLabel("🏠 Home").setStyle(ButtonStyle.Primary).setDisabled(disabled),
    new ButtonBuilder().setCustomId("job_stop").setLabel("🗑 Close").setStyle(ButtonStyle.Danger).setDisabled(disabled)
  );

  return [catRow, jobRow, navRow];
}
function buildNightWalkerEmbed(user, progress, cooldownUnix) {
  const need = xpToNext(progress.level);
  const mult = levelMultiplier(progress.level);
  const bonusPct = Math.round((mult - 1) * 100);

  const list = nightWalker?.list || [];
  const jobs = nightWalker?.jobs || {};
  const lines = list
    .map((k) => {
      const cfg = jobs[k];
      if (!cfg) return null;
      return `• **${cfg.title || k}** — ${cfg.rounds ? `${cfg.rounds} rounds` : "interactive"}`;
    })
    .filter(Boolean)
    .join("\n");

  return new EmbedBuilder()
    .setTitle(nightWalker.category?.title || "🧠 Night Walker")
    .setDescription([statusLineFromCooldown(cooldownUnix), "", nightWalker.category?.description || ""].join("\n").trim())
    .addFields(
      { name: "Progress", value: `Level ${progress.level} • XP ${progress.xp}/${need} • Bonus +${bonusPct}%` },
      { name: "Jobs", value: lines || "No jobs configured." }
    )
    .setFooter({ text: nightWalker.category?.footer || "Choices matter." });
}

function buildNightWalkerComponents(disabled = false) {
  const catRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("job_select:category")
      .setPlaceholder("Choose a category...")
      .addOptions(
        { label: "Work a 9–5", value: "job_cat:95", emoji: "📦" },
        { label: "Night Walker", value: "job_cat:nw", emoji: "🧠", default: true },
        { label: "Grind", value: "job_cat:grind", emoji: "🕒" },
        { label: "Crime", value: "job_cat:crime", emoji: "🕶️" },
        { label: "Enterprises", value: "job_cat:enterprises", emoji: "🏭" }
      )
      .setDisabled(disabled)
  );

  const jobMenu = new StringSelectMenuBuilder()
    .setCustomId("job_select:job")
    .setPlaceholder("Choose a job...")
    .setDisabled(disabled);

  const list = nightWalker?.list || Object.keys(nightWalker?.jobs || {});
  for (const k of list) {
    const cfg = nightWalker?.jobs?.[k];
    if (!cfg) continue;
    jobMenu.addOptions({
      label: safeLabel(cfg.title || k),
      value: `job_nw:${k}`,
      description: cfg.desc ? safeDesc(cfg.desc) : undefined,
      emoji: (cfg.title || "🧠").split(" ")[0] || "🧠",
    });
  }

  const jobRow = new ActionRowBuilder().addComponents(jobMenu);

  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("job_back:hub").setLabel("⬅ Back").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId("job_home").setLabel("🏠 Home").setStyle(ButtonStyle.Primary).setDisabled(disabled),
    new ButtonBuilder().setCustomId("job_stop").setLabel("🗑 Close").setStyle(ButtonStyle.Danger).setDisabled(disabled)
  );

  return [catRow, jobRow, navRow];
}


function buildGrindEmbed({ cooldownUnix, fatigueInfo } = {}) {
  const list = grindIndex?.list || [];
  const jobs = grindIndex?.jobs || {};

  const lines = list
    .map((k) => {
      const cfg = jobs[k];
      if (!cfg) return null;
      return `• **${cfg.title || k}** — ${cfg.desc || ""}`.trim();
    })
    .filter(Boolean)
    .join("\n");

  const fatigueMs = Number(fatigueInfo?.fatigueMs || 0);
  const fb = grindFatigueBar ? grindFatigueBar(fatigueMs) : { pct: 0, bar: "" };
  const lockUnix = fatigueInfo?.lockedUntil ? Math.floor(new Date(fatigueInfo.lockedUntil).getTime() / 1000) : null;

  // Match Crime UI: use the same segmented bar style (▰▱) via heatBar().
  const fatigueBlock =
    lockUnix
      ? [
          `🧠 Fatigue: **${fb.pct}** / 100`,
          `${heatBar(fb.pct)}`,
          `🧃 Recovering: <t:${lockUnix}:R>`,
        ].join("\n")
      : [
          `🧠 Fatigue: **${fb.pct}** / 100`,
          `${heatBar(fb.pct)}`,
          `🧃 Recovering: ${fatigueInfo?.exhausted ? "🥵 Exhausted (rest a bit)" : "Ready"}`,
        ].join("\n");

  const cdLines = [cdLine("Grind lockout", lockUnix)].join("\n");

  return new EmbedBuilder()
    .setTitle(grindIndex.category?.title || "🕒 Grind")
    .setDescription(
      [
        "Pick a job. Fatigue only affects **Grind** jobs.",
        "",
        statusLineFromCooldown(cooldownUnix),
        "",
        fatigueBlock,
        "",
        "**Cooldowns:**",
        cdLines,
      ].join("\n")
    )
    .addFields({ name: "Jobs", value: lines || "No jobs configured." })
    .setColor(0x2b2d31)
    .setFooter({ text: grindIndex.category?.footer || "Fatigue is shared across all Grind jobs." });
}

function buildGrindComponents(disabled = false) {
  const catRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("job_select:category")
      .setPlaceholder("Choose a category...")
      .addOptions(
        { label: "Work a 9–5", value: "job_cat:95", emoji: "📦" },
        { label: "Night Walker", value: "job_cat:nw", emoji: "🧠" },
        { label: "Grind", value: "job_cat:grind", emoji: "🕒", default: true },
        { label: "Crime", value: "job_cat:crime", emoji: "🕶️" },
        { label: "Enterprises", value: "job_cat:enterprises", emoji: "🏭" }
      )
      .setDisabled(disabled)
  );

  const jobMenu = new StringSelectMenuBuilder()
    .setCustomId("job_select:job")
    .setPlaceholder("Choose a job...")
    .setDisabled(disabled);

  const list = grindIndex?.list || [];
  const jobs = grindIndex?.jobs || {};
  for (const k of list) {
    const cfg = jobs[k];
    if (!cfg) continue;
    jobMenu.addOptions({
      label: safeLabel(cfg.title || k),
      value: cfg.buttonId || `grind:${k}`,
      description: cfg.desc ? safeDesc(cfg.desc) : undefined,
      emoji: (cfg.title || "🕒").split(" ")[0] || "🕒",
    });
  }

  const jobRow = new ActionRowBuilder().addComponents(jobMenu);

  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("job_back:hub").setLabel("⬅ Back").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId("job_home").setLabel("🏠 Home").setStyle(ButtonStyle.Primary).setDisabled(disabled),
    new ButtonBuilder().setCustomId("job_stop").setLabel("🗑 Close").setStyle(ButtonStyle.Danger).setDisabled(disabled)
  );

  return [catRow, jobRow, navRow];
}

function buildFarmingComponents(farm) {
  const rows = [];

  if ((farm.fields || []).length === 0) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("farm_buy")
          .setLabel("Buy Field")
          .setStyle(ButtonStyle.Success)
      )
    );
  }

  (farm.fields || []).forEach((f, i) => {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`farm_select:${i}`)
          .setLabel(`Field ${i + 1}`)
          .setStyle(ButtonStyle.Primary)
      )
    );
  });

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("job_back:hub")
        .setLabel("⬅ Back")
        .setStyle(ButtonStyle.Secondary)
    )
  );

  return rows;
}

/* ============================================================
   Crime UI builders
   ============================================================ */
function buildCrimeEmbed({ heatInfo, cooldowns } = {}) {
  const heat = heatInfo?.heat ?? 0;
  const heatUnix = unixFromDate(heatInfo?.expiresAt);

  const heatBlock =
    heat > 0 && heatUnix
      ? [
          `🔥 Heat: **${heat}** / 100`,
          `${heatBar(heat)}`,
          `🧊 Cooling down: <t:${heatUnix}:R>`,
        ].join("\n")
      : [
          `🔥 Heat: **0** / 100`,
          `${heatBar(0)}`,
          `🧊 Cooling down: Ready`,
        ].join("\n");

  // Global crime lockout blocks ALL crime jobs.
  // Show whichever cooldown ends later so UI matches behaviour.
  const effectiveCooldown = (jobCd, globalCd) => {
    if (!globalCd) return jobCd; // no global lockout
    if (!jobCd) return globalCd; // job would be ready, but global blocks
    return Math.max(jobCd, globalCd); // whichever ends later
  };

  const effStore = effectiveCooldown(cooldowns?.store, cooldowns?.crimeGlobal);
  const effHeist = effectiveCooldown(cooldowns?.heist, cooldowns?.crimeGlobal);
  const effMajor = effectiveCooldown(cooldowns?.major, cooldowns?.crimeGlobal);
  const effScam = effectiveCooldown(cooldowns?.scam, cooldowns?.crimeGlobal);

  const cdLines = [
    cdLine("Crime lockout", cooldowns?.crimeGlobal),
    cdLine("Store Robbery", effStore),
    cdLine("Scam Call", effScam),
    cdLine("Heist", effHeist),
    cdLine("Major Heist", effMajor),
  ].join("\n");

  return new EmbedBuilder()
    .setTitle("🕶️ Crime")
    .setDescription(
      [
        "Pick a job. Heat only affects **Crime** jobs.",
        "If you get jailed, **ALL jobs** are disabled until release.",
        "",
        heatBlock,
        "",
        "**Cooldowns:**",
        cdLines,
      ].join("\n")
    )
    .setColor(0x2b2d31)
    .setFooter({ text: "Crime cooldowns are separate from the /job payout cooldown." });
}

function buildCrimeComponents(disabled = false) {
  const catRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("job_select:category")
      .setPlaceholder("Choose a category...")
      .addOptions(
        { label: "Work a 9–5", value: "job_cat:95", emoji: "📦" },
        { label: "Night Walker", value: "job_cat:nw", emoji: "🧠" },
        { label: "Grind", value: "job_cat:grind", emoji: "🕒" },
        { label: "Crime", value: "job_cat:crime", emoji: "🕶️", default: true },
        { label: "Enterprises", value: "job_cat:enterprises", emoji: "🏭" }
      )
      .setDisabled(disabled)
  );

  const jobRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("job_select:job")
      .setPlaceholder("Choose a job...")
      .addOptions(
        { label: "Store Robbery", value: "crime:store", emoji: "🏪", description: safeDesc("Risky grab-and-go.") },
        { label: "Car Chase", value: "crime:chase", emoji: "🚗", description: safeDesc("Coming soon.") },
        { label: "Drug Pushing", value: "crime:drugs", emoji: "💊", description: safeDesc("Coming soon.") },
        { label: "Scam Call", value: "crime:scam", emoji: "☎️", description: safeDesc("Manipulate the mark and time your push.") },
        { label: "Heist", value: "crime:heist", emoji: "🏦", description: safeDesc("Big job, big heat.") },
        { label: "Major Heist", value: "crime:major", emoji: "💎", description: safeDesc("High stakes.") }
      )
      .setDisabled(disabled)
  );

  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("job_back:hub").setLabel("⬅ Back").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId("job_home").setLabel("🏠 Home").setStyle(ButtonStyle.Primary).setDisabled(disabled),
    new ButtonBuilder().setCustomId("job_stop").setLabel("🗑 Close").setStyle(ButtonStyle.Danger).setDisabled(disabled)
  );

  return [catRow, jobRow, navRow];
}


async function checkCrimeCooldownOrTell(btn, guildId, userId, jobKey, jobLabel) {
  const now = new Date();

  const globalNext = await getCooldown(guildId, userId, CRIME_GLOBAL_KEY);
  if (globalNext && now < globalNext) {
    await btn
      .followUp({
        content: `⏳ Crime lockout active. Try again <t:${toUnix(globalNext)}:R>.`,
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
    return true;
  }

  const jobNext = await getCooldown(guildId, userId, jobKey);
  if (jobNext && now < jobNext) {
    await btn
      .followUp({
        content: `⏳ **${jobLabel}** cooldown. Try again <t:${toUnix(jobNext)}:R>.`,
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
    return true;
  }

  return false;
}

/* ============================================================
   9–5: Contract UI builders (from contract config)
   ============================================================ */

function getContractChoices(step, level) {
  const out = [...(step.baseChoices || [])];

  const vipLevel = contractCfg.unlocks?.vipLevel ?? 10;
  const dangerLevel = contractCfg.unlocks?.dangerLevel ?? 20;

  if (level >= vipLevel) out.push(...(step.vipChoices || []));
  if (level >= dangerLevel) out.push(...(step.dangerChoices || []));

  return out;
}

function buildContractEmbed(stepIndex, pickedSoFar = [], level = 1) {
  const step = contractCfg.steps[stepIndex];
  const choices = getContractChoices(step, level);

  const pickedText =
    pickedSoFar.length > 0
      ? `\n\n**Chosen so far:** ${pickedSoFar.map((p) => `\`${p}\``).join(", ")}`
      : "";

  return new EmbedBuilder()
    .setTitle(step.title)
    .setDescription(`${step.desc}${pickedText}`)
    .addFields(
      choices.map((c) => ({
        name: c.label,
        value: `Bonus: +$${c.modMin}–$${c.modMax} | Risk: ${(c.risk * 100).toFixed(0)}%`,
        inline: false,
      }))
    )
    .setFooter({ text: contractCfg.footer || "Finish all 3 steps to get paid." });
}

function buildContractButtons(stepIndex, level, disabled = false) {
  const step = contractCfg.steps[stepIndex];
  const choices = getContractChoices(step, level);

  const rows = [];
  let row = new ActionRowBuilder();

  for (const c of choices) {
    if (row.components.length >= 5) {
      rows.push(row);
      row = new ActionRowBuilder();
    }
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`job_contract:${stepIndex}:${c.label}`)
        .setLabel(safeLabel(c.label))
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled)
    );
  }
  rows.push(row);

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("job_back:95").setLabel("⬅ Back").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
      new ButtonBuilder().setCustomId("job_stop").setLabel("🛑 Stop Work").setStyle(ButtonStyle.Danger).setDisabled(disabled)
    )
  );

  return rows;
}

/* ============================================================
   9–5: Skill UI builders
   ============================================================ */
function buildSkillEmbed(title, targetEmoji, expiresAtMs) {
  const unix = Math.floor(expiresAtMs / 1000);
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(`Click **${targetEmoji}** before time runs out!\n⏳ Ends: <t:${unix}:R>`)
    .setFooter({ text: "Failing doesn't pay, but browsing is still allowed." });
}

function buildSkillButtons(targetEmoji, disabled = false, prefix = "job_skill") {
  const decoys = sampleUnique(skillCfg.emojis.filter((e) => e !== targetEmoji), 4);
  const options = sampleUnique([targetEmoji, ...decoys], 5);

  const row = new ActionRowBuilder();
  for (const e of options) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${prefix}:${e}`)
        .setLabel(e)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled)
    );
  }

  return [
    row,
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("job_back:95").setLabel("⬅ Back").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
      new ButtonBuilder().setCustomId("job_stop").setLabel("🛑 Stop Work").setStyle(ButtonStyle.Danger).setDisabled(disabled)
    ),
  ];
}

/* ============================================================
   9–5: Shift UI builders
   ============================================================ */
function buildShiftEmbed(startMs, durationMs) {
  const now = Date.now();
  const elapsed = Math.min(durationMs, Math.max(0, now - startMs));
  const pct = Math.floor((elapsed / durationMs) * 100);
  const doneAtUnix = Math.floor((startMs + durationMs) / 1000);

  return new EmbedBuilder()
    .setTitle(shiftCfg.inProgressTitle || "🕒 Shift In Progress")
    .setDescription(
      [
        `${progressBar(pct)} **${pct}%**`,
        `⏳ Shift ends: <t:${doneAtUnix}:R>`,
        elapsed >= durationMs ? "✅ Shift complete! Press **Collect Pay**." : "",
      ]
        .filter(Boolean)
        .join("\n")
    )
    .setFooter({ text: shiftCfg.footer || "Stay on the board. Collect when ready." });
}

function formatRoutePlace(place) {
  return `${place.city}, ${place.state}`;
}

function durationMinutesForRoute(distanceKm) {
  const tiers = Array.isArray(truckerCfg.durationTiers) ? truckerCfg.durationTiers : [];
  const km = Math.max(1, Math.round(Number(distanceKm) || 1));
  for (const tier of tiers) {
    if (km <= Number(tier.maxKm)) return Math.max(1, Math.round(Number(tier.minutes) || 1));
  }
  return 5;
}

function generateTruckerManifest() {
  const route = pick(truckerCfg.routes || []);
  const freightEntry = pick(truckerCfg.freightPool || []);
  const freightName = typeof freightEntry === "string" ? freightEntry : (freightEntry?.name || "General Freight");
  const freightCategory = typeof freightEntry === "string" ? "generalPalletised" : (freightEntry?.category || "generalPalletised");
  const payoutModifier = Math.max(0.5, Number(freightEntry?.payoutModifier ?? 1));
  const compatibleTrailers = Array.isArray(truckerCfg.trailerConfigs?.[freightCategory])
    ? truckerCfg.trailerConfigs[freightCategory]
    : [];
  const truckType = pick(compatibleTrailers) || pick(truckerCfg.truckTypes || []) || "Semi Trailer";
  const flavorLine = pick(truckerCfg.manifestLines || []) || "";
  const distanceKm = Math.max(1, Math.round(Number(route?.distanceKm) || randInt(120, 1200)));
  const durationMinutes = durationMinutesForRoute(distanceKm);
  const perKm = (Math.random() * ((truckerCfg.payout?.perKmMax ?? 2.4) - (truckerCfg.payout?.perKmMin ?? 1.7))) + (truckerCfg.payout?.perKmMin ?? 1.7);
  const longHaulBonus = randInt(
    truckerCfg.payout?.longHaulBonusMin ?? 0,
    Math.max(truckerCfg.payout?.longHaulBonusMin ?? 0, Math.min(truckerCfg.payout?.longHaulBonusMax ?? 500, Math.floor(distanceKm / 6)))
  );
  const payoutBase = Math.max(100, Math.round((distanceKm * perKm + longHaulBonus) * payoutModifier));

  return {
    freight: freightName,
    freightCategory,
    truckType,
    flavorLine,
    route,
    distanceKm,
    durationMinutes,
    payoutBase,
  };
}

function truckerProgressState(run = {}) {
  const durationMs = Math.max(1, Number(run.durationMs || 0));
  const started = Math.max(0, Number(run.startMs || 0));
  const elapsedMs = run.ready ? durationMs : Math.max(0, Date.now() - started);
  const clampedElapsed = Math.min(durationMs, elapsedMs);
  const remainingMs = Math.max(0, durationMs - clampedElapsed);
  const pct = Math.max(0, Math.min(100, Math.round((clampedElapsed / durationMs) * 100)));
  const kmDone = Math.round((Number(run.manifest?.distanceKm || 0) * pct) / 100);
  const kmRemaining = Math.max(0, Math.round(Number(run.manifest?.distanceKm || 0) - kmDone));
  return { pct, remainingMs, kmRemaining };
}

function buildTruckerEmbed(run, { completed = false } = {}) {
  const manifest = run?.manifest || generateTruckerManifest();
  const started = Boolean(run?.startMs);
  const ready = Boolean(run?.ready);
  const title = completed
    ? (truckerCfg.completeTitle || "✅ Delivery Complete")
    : started
      ? (truckerCfg.inProgressTitle || "🚛 Long Haul In Progress")
      : (truckerCfg.manifestTitle || "🚛 Freight Manifest");

  const progress = truckerProgressState(run);
  const doneAtUnix = started ? Math.floor((run.startMs + run.durationMs) / 1000) : null;
  const lines = [
    manifest.flavorLine,
    "",
    `**Freight:** ${manifest.freight}`,
    `**Trailer Config:** ${manifest.truckType}`,
    `**Route:** ${formatRoutePlace(manifest.route.from)} → ${formatRoutePlace(manifest.route.to)}`,
    `**Distance:** ${manifest.distanceKm.toLocaleString()} km`,
    `**ETA:** ${manifest.durationMinutes} minute${manifest.durationMinutes === 1 ? "" : "s"}`,
    `**Payout:** $${Number(manifest.payoutBase || 0).toLocaleString()}`,
  ];

  if (started) {
    lines.push(
      "",
      `**Progress**`,
      `${progressBar(progress.pct)} **${progress.pct}%**`,
      ready || completed
        ? "✅ Delivery complete. Press **Collect Pay**."
        : `⏳ Arrival: <t:${doneAtUnix}:R>`,
      ready || completed ? `**Distance Remaining:** 0 km` : `**Distance Remaining:** ${progress.kmRemaining.toLocaleString()} km`
    );
  }

  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(lines.filter(Boolean).join("\n"))
    .setFooter({ text: truckerCfg.footer || "Start the run, let the kilometres roll, then collect the cheque." });
}

function buildTruckerButtons(run = {}) {
  const started = Boolean(run?.startMs);
  const ready = Boolean(run?.ready);

  if (!started) {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("job_trucker_start").setLabel("🚛 Start Job").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("job_trucker_refresh").setLabel("🔁 New Manifest").setStyle(ButtonStyle.Secondary)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("job_back:95").setLabel("⬅ Back").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("job_stop").setLabel("🛑 Stop Work").setStyle(ButtonStyle.Danger)
      ),
    ];
  }

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("job_trucker_collect")
        .setLabel("💵 Collect Pay")
        .setStyle(ButtonStyle.Success)
        .setDisabled(!ready)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("job_stop").setLabel("🛑 Stop Work").setStyle(ButtonStyle.Danger)
    ),
  ];
}

/* ============================================================
   Night Walker round builders
   ============================================================ */
function buildNWRoundEmbed({ title, round, rounds, prompt, statusLines = [] }) {
  return new EmbedBuilder()
    .setTitle(`${title} — Round ${round}/${rounds}`)
    .setDescription([prompt, "", ...statusLines].filter(Boolean).join("\n"));
}

function buildNWChoiceComponents({ jobKey, roundIndex, choices, disabled = false }) {
  const row = new ActionRowBuilder();
  choices.slice(0, 5).forEach((c, idx) => {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`nw:${jobKey}:${roundIndex}:${idx}`)
        .setLabel(safeLabel(c.label))
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled)
    );
  });

  return [
    row,
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("job_back:nw").setLabel("⬅ Back").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
      new ButtonBuilder().setCustomId("job_stop").setLabel("🛑 Stop Work").setStyle(ButtonStyle.Danger).setDisabled(disabled)
    ),
  ];
}

/* ============================================================
   Main command
   ============================================================ */
module.exports = {
  data: new SlashCommandBuilder().setName("job").setDescription("Open the job board and work for money."),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: "❌ Server only.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    // 🚔 Jail gate (true = BLOCK)
    if (await guardNotJailed(interaction)) return;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    await ensureUser(guildId, userId);

    const prog = await getJobProgress(guildId, userId);
    const cdUnix = await getCooldownUnixIfActive(guildId, userId, "job");

    const msg = await interaction.channel.send({
      embeds: [buildHubEmbed(interaction.user, prog, cdUnix)],
      components: buildHubComponents(false),
    });

    await interaction.editReply("✅ Job board posted.");

    const session = {
      view: "hub",

      // remembers last category for auto-return
      lastCategory: "hub",
      returnTimer: null,

      level: prog.level,
      legendaryAvailable: false,
      legendaryExpiresAt: 0,

      // Contract state
      contractStep: 0,
      contractPicks: [],
      contractBonusTotal: 0,
      contractRiskTotal: 0,

      // Skill state
      skillExpiresAt: 0,

      // Shift state
      shiftStartMs: 0,
      shiftInterval: null,
      shiftDurationMs: (shiftCfg.durationSeconds || 45) * 1000,
      shiftReady: false,

      // Trucker state
      trucker: null,

      // Night Walker state
      nw: null,
    };

    const collector = msg.createMessageComponentCollector({ time: BOARD_INACTIVITY_MS });

    function resetInactivity() {
      collector.resetTimer({ time: BOARD_INACTIVITY_MS });
    }

function cancelAutoReturn() {
  if (session.returnTimer) {
    clearTimeout(session.returnTimer);
    session.returnTimer = null;
  }
}

function scheduleReturnToCategory(delayMs = 5000) {
  cancelAutoReturn();

  session.returnTimer = setTimeout(async () => {
    try {
      if (collector.ended) return;
      const target = session.lastCategory;
      if (!["95", "nw", "grind", "crime"].includes(target)) return;

      session.view = target;
      await redraw();
    } catch {}
  }, delayMs);
}

    async function stopWork(reason = "stop") {
      cancelAutoReturn();
      if (session.shiftInterval) {
        clearInterval(session.shiftInterval);
        session.shiftInterval = null;
      }
      if (session.trucker?.interval) {
        clearInterval(session.trucker.interval);
        session.trucker.interval = null;
      }
      try {
        await msg.edit({ components: buildHubComponents(true) });
      } catch {}
      collector.stop(reason);
      setTimeout(() => msg.delete().catch(() => {}), 1000);
    }

    async function checkCooldownOrTell(btn) {
      const next = await getCooldown(guildId, userId, "job");
      const now = new Date();
      if (next && now < next) {
        const unix = Math.floor(next.getTime() / 1000);
        await btn
          .followUp({
            content: `⏳ You’re on cooldown. Next payout <t:${unix}:R>.`,
            flags: MessageFlags.Ephemeral,
          })
          .catch(() => {});
        return true;
      }
      return false;
    }

    async function maybeSpawnLegendary() {
      if (session.legendaryAvailable) return;
      if (Math.random() < LEGENDARY_CHANCE) {
        session.legendaryAvailable = true;
        session.legendaryExpiresAt = Date.now() + LEGENDARY_TTL_MS;
      }
    }

    async function payUser(amountBase, reason, xpGain, meta = {}, { countJob = true, allowLegendarySpawn = true, activityEffects = null } = {}) {
      const mult = levelMultiplier(session.level);
      let amount = Math.floor(amountBase * mult);

      if (GLOBAL_BONUS_CHANCE > 0 && Math.random() < GLOBAL_BONUS_CHANCE) {
        const bonus = randInt(GLOBAL_BONUS_MIN, GLOBAL_BONUS_MAX);
        amount += bonus;
        meta.globalBonus = bonus;
      }

      const nextClaim = new Date(Date.now() + JOB_COOLDOWN_SECONDS * 1000);
      await setCooldown(guildId, userId, "job", nextClaim);

      await creditUserWithEffects({
        guildId,
        userId,
        amount,
        type: reason,
        meta,
        activityEffects,
        awardSource: reason,
      });

      const progUpdate = await addXpAndMaybeLevel(guildId, userId, xpGain, countJob);

      if (countJob) {
        await handleJobMilestones({
          channel: msg.channel,
          guildId,
          userId,
          totalJobs: progUpdate.totalJobs,
        });
      }

      if (allowLegendarySpawn && countJob) {
        await maybeSpawnLegendary();
      }

      return { amount, nextClaim, prog: progUpdate };
    }

    async function redraw() {
      const p = await getJobProgress(guildId, userId);
      session.level = p.level;

      if (session.legendaryAvailable && Date.now() > session.legendaryExpiresAt) {
        session.legendaryAvailable = false;
      }

      const cd = await getCooldownUnixIfActive(guildId, userId, "job");

      if (session.view === "hub") {
        return msg
          .edit({
            embeds: [buildHubEmbed(interaction.user, p, cd)],
            components: buildHubComponents(false),
          })
          .catch(() => {});
      }

      if (session.view === "95") {
        return msg
          .edit({
            embeds: [buildNineToFiveEmbed(interaction.user, p, cd)],
            components: buildNineToFiveComponents({ disabled: false, legendary: session.legendaryAvailable }),
          })
          .catch(() => {});
      }

      if (session.view === "nw") {
        return msg
          .edit({
            embeds: [buildNightWalkerEmbed(interaction.user, p, cd)],
            components: buildNightWalkerComponents(false),
          })
          .catch(() => {});
      }

      if (session.view === "trucker" && session.trucker) {
        return msg
          .edit({
            embeds: [buildTruckerEmbed(session.trucker, { completed: session.trucker.ready })],
            components: buildTruckerButtons(session.trucker),
          })
          .catch(() => {});
      }

      if (session.view === "grind") {
        const fatigueInfo = await canGrindFatigue(pool, guildId, userId);

        return msg
          .edit({
            embeds: [buildGrindEmbed({ cooldownUnix: cd, fatigueInfo })],
            components: buildGrindComponents(false),
          })
          .catch(() => {});
      }

      if (session.view === "enterprises") {
        return msg.edit({
          embeds: [buildEnterprisesEmbed({ cooldownUnix: cd })],
          components: buildEnterprisesComponents(false),
        }).catch(() => {});
      }

      if (session.view === "farming_placeholder") {
        return msg.edit({
          embeds: [buildFarmingPlaceholderEmbed()],
          components: buildEnterprisesComponents(false),
        }).catch(() => {});
      }

      // ✅ UPDATED: Crime view includes heat bar + timers
      if (session.view === "crime") {
        const heatInfo = await getCrimeHeatInfo(guildId, userId);

        const cooldowns = {
          crimeGlobal: await getCooldownUnixIfActive(guildId, userId, CRIME_GLOBAL_KEY),
          store: await getCooldownUnixIfActive(guildId, userId, CRIME_KEYS.store),
          scam: await getCooldownUnixIfActive(guildId, userId, CRIME_KEYS.scam),
          heist: await getCooldownUnixIfActive(guildId, userId, CRIME_KEYS.heist),
          major: await getCooldownUnixIfActive(guildId, userId, CRIME_KEYS.major),
        };

        return msg
          .edit({
            embeds: [buildCrimeEmbed({ heatInfo, cooldowns })],
            components: buildCrimeComponents(false),
          })
          .catch(() => {});
      }
    }

      if (session.view === "farming") {
        try {
          console.log("FARMING REDRAW START", session.view);

          const farm = await farming.ensureFarm(guildId, userId);
          console.log("FARMING FARM DATA", JSON.stringify(farm));

          await farming.applySeasonRollover(guildId, userId, farm);
          console.log("FARMING SEASON", farming.getCurrentSeason());

          const components = buildFarmingComponents(farm);
          console.log("FARMING COMPONENT ROWS", components.length);

          return await msg.edit({
            embeds: [
              new EmbedBuilder()
                .setTitle("🌾 Farming")
                .setDescription(
                  `🌾 Fields: ${(farm.fields || []).length}\nSeason: ${farming.getCurrentSeason()}`
                )
            ],
            components
          });
        } catch (err) {
          console.error("FARMING REDRAW ERROR", err);
        }
      }

    // Adapter so Crime minigames (which use interaction.editReply/fetchReply) work on our board message
    const boardAdapter = {
      guildId,
      user: interaction.user,
      channel: msg.channel,
      editReply: (payload) => msg.edit(payload),
      fetchReply: () => Promise.resolve(msg),
    };

    /* ============================================================
       Collector handlers
       ============================================================ */
    collector.on("collect", async (btn) => {
      try {
        if (btn.user.id !== userId) {
          return btn.reply({ content: "❌ This board isn’t for you.", flags: MessageFlags.Ephemeral }).catch(() => {});
        }

        
        const isSelect = typeof btn.isStringSelectMenu === "function" && btn.isStringSelectMenu();
        const actionId = isSelect ? (btn.values?.[0] || "") : (btn.customId || "");

        // ✅ Ack once for safety (prevents "This interaction failed")
        // ⚠️ BUT: Grind job runtime buttons use modals, so we must NOT deferUpdate for grind_clerk:* actions.
        const isClerkRuntime = actionId.startsWith("grind_clerk:");
        const isTaxiRuntime = actionId.startsWith("grind_taxi:");
        if (isClerkRuntime || isTaxiRuntime) {
          resetInactivity();
          cancelAutoReturn();
          // keep the /job board alive while the grind module runs
          return;            // modal safety: the grind module will handle/ack as needed
        }

        await ensureAck(btn);
        resetInactivity();
        cancelAutoReturn();

        
        // 🚔 Jail gate for buttons (true = BLOCK)
        if (await guardNotJailedComponent(btn)) return;
// Stop
        if (actionId === "job_stop") {
          return stopWork("stop_button");
        }

        if (actionId === "job_home") {
          session.view = "hub";
          session.nw = null;
          await redraw();
          return;
        }

        // Back buttons
        if (actionId === "job_back:hub") {
          session.view = "hub";
          session.nw = null;
          await redraw();
          return;
        }

        if (actionId === "job_back:95") {
          session.view = "95";
          session.lastCategory = "95";
          session.nw = null;
          await redraw();
          return;
        }

        if (actionId === "job_back:nw") {
          session.view = "nw";
          session.lastCategory = "nw";
          session.nw = null;
          await redraw();
          return;
        }

        // Category nav (allowed even on /job payout cooldown — but jail still blocks)
        if (actionId === "job_cat:95") {
          session.view = "95";
          session.lastCategory = "95";
          await redraw();
          return;
        }
        if (actionId === "job_cat:nw") {
          session.view = "nw";
          session.lastCategory = "nw";
          await redraw();
          return;
        }
        if (actionId === "job_cat:grind") {
          session.view = "grind";
          session.lastCategory = "grind";
          await redraw();
          return;
        }
        if (actionId === "job_cat:crime") {
          session.view = "crime";
          session.lastCategory = "crime";
          await redraw();
          return;
        }
        if (actionId === "job_cat:enterprises") {
          session.view = "enterprises";
          session.lastCategory = "enterprises";
          await redraw();
          return;
        }
        if (actionId === "enterprise:farming") {
          console.log("FARMING CLICKHIT", actionId);
          session.view = "farming";
          session.lastCategory = "enterprises";
          await redraw();
          return;
        }


        /* ============================================================
           GRIND MENU (NEW)
           ============================================================ */
        if (actionId.startsWith("grind:")) {
          const key = actionId.split(":")[1];

          // Block starting a grind job if on /job payout cooldown
          if (await checkCooldownOrTell(btn)) return;

          if (key === "clerk") {
            session.view = "grind_run";

            await startStoreClerk(btn, {
              pool,
              boardMsg: msg,
              guildId,
              userId,
            });

            // After the module completes it edits the board; return to Grind menu
            await new Promise((r) => setTimeout(r, 1500));
            collector.resetTimer({ time: BOARD_INACTIVITY_MS });

            session.view = "grind";
            await redraw();
            return;
          }

          if (key === "warehousing") {
            session.view = "grind_run";
            await startWarehousing(btn, { pool, boardMsg: msg, guildId, userId });

            await new Promise((r) => setTimeout(r, 1500));
            collector.resetTimer({ time: BOARD_INACTIVITY_MS });
            session.view = "grind";
            await redraw();
            return;
          }

          if (key === "fishing") {
            session.view = "grind_run";
            await startFishing(btn, { pool, boardMsg: msg, guildId, userId });

            await new Promise((r) => setTimeout(r, 1500));
            collector.resetTimer({ time: BOARD_INACTIVITY_MS });
            session.view = "grind";
            await redraw();
            return;
          }

          if (key === "quarry") {
            session.view = "grind_run";
            await startQuarry(btn, { pool, boardMsg: msg, guildId, userId });

            await new Promise((r) => setTimeout(r, 1500));
            collector.resetTimer({ time: BOARD_INACTIVITY_MS });
            session.view = "grind";
            await redraw();
            return;
          }

          if (key === "taxi") {
            session.view = "grind_run";
            await startTaxiDriver(btn, { pool, boardMsg: msg, guildId, userId });

            await new Promise((r) => setTimeout(r, 1500));
            collector.resetTimer({ time: BOARD_INACTIVITY_MS });
            session.view = "grind";
            await redraw();
            return;
          }

          await btn
            .followUp({ content: "🕒 That Grind job is coming soon.", flags: MessageFlags.Ephemeral })
            .catch(() => {});
          return;
        }

        /* ============================================================
           CRIME MENU (Store Robbery + Heists live)
           ============================================================ */
        if (actionId.startsWith("crime:")) {
          const key = actionId.split(":")[1];

          if (key === "store") {
            if (await checkCrimeCooldownOrTell(btn, guildId, userId, CRIME_KEYS.store, "Store Robbery")) return;

            const lingeringHeat = await getCrimeHeat(guildId, userId);
            session.view = "crime_run";

            await startStoreRobbery(boardAdapter, {
              lingeringHeat,
              onStoreRobberyComplete: async ({ outcome, finalHeat, identified }) => {
                if (!finalHeat || finalHeat <= 0) return;
                const ttlMins = heatTTLMinutesForOutcome(outcome, { identified });
                await setCrimeHeat(guildId, userId, finalHeat, ttlMins);
              },
            });

            await new Promise((r) => setTimeout(r, 5_000));
            collector.resetTimer({ time: BOARD_INACTIVITY_MS });

            session.view = "crime";
            await redraw();
            return;
          }

          if (key === "scam") {
            if (await checkCrimeCooldownOrTell(btn, guildId, userId, CRIME_KEYS.scam, "Scam Call")) return;

            const lingeringHeat = await getCrimeHeat(guildId, userId);
            session.view = "crime_run";

            await startScamCall(boardAdapter, {
              lingeringHeat,
              onScamCallComplete: async ({ outcome, finalHeat, identified }) => {
                if (!finalHeat || finalHeat <= 0) return;
                const ttlMins = heatTTLMinutesForOutcome(outcome, { identified });
                await setCrimeHeat(guildId, userId, finalHeat, ttlMins);
              },
            });

            await new Promise((r) => setTimeout(r, 5_000));
            collector.resetTimer({ time: BOARD_INACTIVITY_MS });

            session.view = "crime";
            await redraw();
            return;
          }

          if (key === "heist") {
            if (await checkCrimeCooldownOrTell(btn, guildId, userId, CRIME_KEYS.heist, "Heist")) return;

            const lingeringHeat = await getCrimeHeat(guildId, userId);
            session.view = "crime_run";

            await startHeist(boardAdapter, {
              mode: "heist",
              lingeringHeat,
              onHeistComplete: async ({ outcome, finalHeat, identified, mode }) => {
                if (!finalHeat || finalHeat <= 0) return;
                const ttlMins = heatTTLMinutesForHeistOutcome(outcome, { identified, mode });
                await setCrimeHeat(guildId, userId, finalHeat, ttlMins);
              },
            });

            await new Promise((r) => setTimeout(r, 5_000));
            collector.resetTimer({ time: BOARD_INACTIVITY_MS });

            session.view = "crime";
            await redraw();
            return;
          }

          if (key === "major") {
            if (await checkCrimeCooldownOrTell(btn, guildId, userId, CRIME_KEYS.major, "Major Heist")) return;

            const lingeringHeat = await getCrimeHeat(guildId, userId);
            session.view = "crime_run";

            await startHeist(boardAdapter, {
              mode: "major",
              lingeringHeat,
              onHeistComplete: async ({ outcome, finalHeat, identified, mode }) => {
                if (!finalHeat || finalHeat <= 0) return;
                const ttlMins = heatTTLMinutesForHeistOutcome(outcome, { identified, mode });
                await setCrimeHeat(guildId, userId, finalHeat, ttlMins);
              },
            });

            await new Promise((r) => setTimeout(r, 5_000));
            collector.resetTimer({ time: BOARD_INACTIVITY_MS });

            session.view = "crime";
            await redraw();
            return;
          }

          if (key === "chase") {
            if (await checkCrimeCooldownOrTell(btn, guildId, userId, CRIME_KEYS.chase, "Car Chase")) return;
            await btn
              .followUp({ content: "🚗 Car Chase is coming soon.", flags: MessageFlags.Ephemeral })
              .catch(() => {});
            return;
          }

          if (key === "drugs") {
            await btn
              .followUp({ content: "💊 Drug Pushing is a placeholder for now.", flags: MessageFlags.Ephemeral })
              .catch(() => {});
            return;
          }
        }

        /* ============================================================
           9–5 ENTRY (buttons from data/nineToFive/index.js)
           ============================================================ */
        if (actionId.startsWith("job_95:")) {
          const mode = actionId.split(":")[1];

          // Block starting a job if on /job payout cooldown
          if (await checkCooldownOrTell(btn)) return;

          if (mode === "contract") {
            session.view = "contract";
            session.contractStep = 0;
            session.contractPicks = [];
            session.contractBonusTotal = 0;
            session.contractRiskTotal = 0;

            await msg
              .edit({
                embeds: [buildContractEmbed(0, session.contractPicks, session.level)],
                components: buildContractButtons(0, session.level, false),
              })
              .catch(() => {});
            return;
          }

          if (mode === "skill") {
            session.view = "skill";
            const target = pick(skillCfg.emojis);
            session.skillExpiresAt = Date.now() + (skillCfg.timeLimitMs || 12_000);

            await msg
              .edit({
                embeds: [buildSkillEmbed(skillCfg.title || "🧠 Skill Check", target, session.skillExpiresAt)],
                components: buildSkillButtons(target, false, "job_skill"),
              })
              .catch(() => {});
            return;
          }

          if (mode === "shift") {
            session.view = "shift";

            if (session.shiftInterval) clearInterval(session.shiftInterval);
            session.shiftStartMs = Date.now();
            session.shiftReady = false;

            await msg
              .edit({
                embeds: [buildShiftEmbed(session.shiftStartMs, session.shiftDurationMs)],
                components: buildShiftButtons({ canCollect: false, disabled: false }),
              })
              .catch(() => {});

            const tickMs = (shiftCfg.tickSeconds || 5) * 1000;

            session.shiftInterval = setInterval(async () => {
              try {
                const done = Date.now() - session.shiftStartMs >= session.shiftDurationMs;
                if (done) session.shiftReady = true;

                await msg
                  .edit({
                    embeds: [buildShiftEmbed(session.shiftStartMs, session.shiftDurationMs)],
                    components: buildShiftButtons({ canCollect: session.shiftReady, disabled: false }),
                  })
                  .catch(() => {});

                if (done) {
                  clearInterval(session.shiftInterval);
                  session.shiftInterval = null;
                }
              } catch {}
            }, tickMs);

            return;
          }

          if (mode === "trucker") {
            session.view = "trucker";
            if (session.trucker?.interval) {
              clearInterval(session.trucker.interval);
            }
            session.trucker = {
              manifest: generateTruckerManifest(),
              startMs: 0,
              durationMs: 0,
              ready: false,
              interval: null,
            };

            await msg
              .edit({
                embeds: [buildTruckerEmbed(session.trucker)],
                components: buildTruckerButtons(session.trucker),
              })
              .catch(() => {});
            return;
          }

          if (mode === "legendary") {
            if (!session.legendaryAvailable) return;

            if (await checkCooldownOrTell(btn)) return;

            session.view = "legendary";
            const target = pick(skillCfg.emojis);
            session.skillExpiresAt = Date.now() + LEGENDARY_SKILL_TIME_MS;

            await msg
              .edit({
                embeds: [buildSkillEmbed("🌟 Legendary Job", target, session.skillExpiresAt)],
                components: buildSkillButtons(target, false, "job_leg"),
              })
              .catch(() => {});
            return;
          }
        }

        if (actionId === "job_trucker_refresh") {
          if (!session.trucker || session.trucker.startMs) return;
          session.trucker.manifest = generateTruckerManifest();
          await msg
            .edit({
              embeds: [buildTruckerEmbed(session.trucker)],
              components: buildTruckerButtons(session.trucker),
            })
            .catch(() => {});
          return;
        }

        if (actionId === "job_trucker_start") {
          if (await checkCooldownOrTell(btn)) return;
          if (!session.trucker) {
            session.trucker = { manifest: generateTruckerManifest(), startMs: 0, durationMs: 0, ready: false, interval: null };
          }
          if (session.trucker.interval) clearInterval(session.trucker.interval);

          session.view = "trucker";
          session.trucker.startMs = Date.now();
          session.trucker.durationMs = session.trucker.manifest.durationMinutes * 60_000;
          session.trucker.ready = false;

          await msg
            .edit({
              embeds: [buildTruckerEmbed(session.trucker)],
              components: buildTruckerButtons(session.trucker),
            })
            .catch(() => {});

          const tickMs = Math.max(5_000, (truckerCfg.updateEverySeconds || 30) * 1000);
          session.trucker.interval = setInterval(async () => {
            try {
              const done = Date.now() - session.trucker.startMs >= session.trucker.durationMs;
              if (done) session.trucker.ready = true;

              await msg
                .edit({
                  embeds: [buildTruckerEmbed(session.trucker, { completed: session.trucker.ready })],
                  components: buildTruckerButtons(session.trucker),
                })
                .catch(() => {});

              if (done) {
                clearInterval(session.trucker.interval);
                session.trucker.interval = null;
              }
            } catch {}
          }, tickMs);

          return;
        }

        if (actionId === "job_trucker_collect") {
          if (!session.trucker?.ready) return;

          const manifest = session.trucker.manifest;
          const paid = await payUser(
            manifest.payoutBase,
            "job_95_trucker",
            truckerCfg.xp?.success ?? 0,
            {
              freight: manifest.freight,
              truckType: manifest.truckType,
              from: formatRoutePlace(manifest.route.from),
              to: formatRoutePlace(manifest.route.to),
              distanceKm: manifest.distanceKm,
              durationMinutes: manifest.durationMinutes,
            },
            { countJob: true, allowLegendarySpawn: true, activityEffects: truckerCfg.activityEffects }
          );

          if (session.trucker?.interval) {
            clearInterval(session.trucker.interval);
            session.trucker.interval = null;
          }

          const embed = new EmbedBuilder()
            .setTitle(truckerCfg.completeTitle || "✅ Delivery Complete")
            .setDescription(
              [
                `**Freight:** ${manifest.freight}`,
                `**Trailer Config:** ${manifest.truckType}`,
                `**Route:** ${formatRoutePlace(manifest.route.from)} → ${formatRoutePlace(manifest.route.to)}`,
                `**Distance:** ${manifest.distanceKm.toLocaleString()} km`,
                "",
                `✅ Paid: **$${paid.amount.toLocaleString()}**`,
                `⏳ Next payout: <t:${toUnix(paid.nextClaim)}:R>`,
                paid.prog.leveledUp ? `🎉 Level up! You are now **Level ${paid.prog.level}**` : "",
                "",
                "Back to Work a 9–5.",
              ]
                .filter(Boolean)
                .join("\n")
            )
            .setColor(0x22aa55);

          session.view = "95";
          session.trucker = null;
          await msg
            .edit({
              embeds: [embed],
              components: buildNineToFiveComponents({ disabled: false, legendary: session.legendaryAvailable }),
            })
            .catch(() => {});
          scheduleReturnToCategory(5000);
          return;
        }

          if (actionId === "farm_buy") {
            let farm = await farming.ensureFarm(guildId, userId);

            const cost = farming.getNextFieldCost(farm.fields.length);

            const bal = await pool.query(
              `SELECT balance FROM user_balances WHERE user_id=$1 AND guild_id=$2`,
              [userId, guildId]
            );

            if ((bal.rows[0]?.balance || 0) < cost) {
              return i.followUp({
                content: `❌ You need $${cost.toLocaleString()}`,
                ephemeral: true
              });
            }

            await pool.query(
              `UPDATE user_balances SET balance = balance - $1 WHERE user_id=$2 AND guild_id=$3`,
              [cost, userId, guildId]
            );

            await farming.buyField(guildId, userId, farm);

            await redraw();
            return;
          }

        // Contract clicks
        if (actionId.startsWith("job_contract:")) {
          if (await checkCooldownOrTell(btn)) return;

          const parts = actionId.split(":");
          const stepIndex = Number(parts[1]);
          const label = parts.slice(2).join(":");

          const step = contractCfg.steps[stepIndex];
          const choices = getContractChoices(step, session.level);
          const chosen = choices.find((c) => c.label === label);
          if (!chosen) return;

          session.contractPicks.push(label);
          session.contractBonusTotal += randInt(chosen.modMin, chosen.modMax);
          session.contractRiskTotal += chosen.risk;

          const nextStep = stepIndex + 1;

          if (nextStep >= contractCfg.steps.length) {
            const failRoll = Math.random() < session.contractRiskTotal;
            if (failRoll) {
              const embed = new EmbedBuilder()
                .setTitle("📦 Transport Contract — Failed")
                .setDescription(
                  [
                    "The contract went sideways.",
                    "",
                    `❌ No payout (risk caught up to you).`,
                    "",
                    "Back to Work a 9–5.",
                  ].join("\n")
                )
                .setColor(0xaa0000);

              session.view = "95";
              await msg
                .edit({
                  embeds: [embed],
                  components: buildNineToFiveComponents({ disabled: false, legendary: session.legendaryAvailable }),
                })
                .catch(() => {});
              scheduleReturnToCategory(5000);
            return;
            }

            const base = randInt(contractCfg.payout?.min ?? 2000, contractCfg.payout?.max ?? 5000);
            const amountBase = base + session.contractBonusTotal;

            const paid = await payUser(
              amountBase,
              "job_95_contract",
              contractCfg.xp?.success ?? 0,
              { picks: session.contractPicks, bonusTotal: session.contractBonusTotal, riskTotal: session.contractRiskTotal },
              { countJob: true, allowLegendarySpawn: true, activityEffects: contractCfg.activityEffects }
            );

            const embed = new EmbedBuilder()
              .setTitle("📦 Transport Contract — Complete")
              .setDescription(
                [
                  `✅ Paid: **$${paid.amount.toLocaleString()}**`,
                  `⏳ Next payout: <t:${toUnix(paid.nextClaim)}:R>`,
                  paid.prog.leveledUp ? `🎉 Level up! You are now **Level ${paid.prog.level}**` : "",
                  "",
                  "Back to Work a 9–5.",
                ]
                  .filter(Boolean)
                  .join("\n")
              )
              .setColor(0x22aa55);

            session.view = "95";
            await msg
              .edit({
                embeds: [embed],
                components: buildNineToFiveComponents({ disabled: false, legendary: session.legendaryAvailable }),
              })
              .catch(() => {});
            scheduleReturnToCategory(5000);
            return;
          }

          session.contractStep = nextStep;

          await msg
            .edit({
              embeds: [buildContractEmbed(nextStep, session.contractPicks, session.level)],
              components: buildContractButtons(nextStep, session.level, false),
            })
            .catch(() => {});
          return;
        }

        // Skill checks (normal + legendary)
        if (actionId.startsWith("job_skill:") || actionId.startsWith("job_leg:")) {
          const isLegendary = actionId.startsWith("job_leg:");
          const chosen = actionId.split(":")[1];

          const now = Date.now();
          const expired = now > session.skillExpiresAt;

          if (expired || !chosen) {
            const embed = new EmbedBuilder()
              .setTitle(isLegendary ? "🌟 Legendary — Failed" : "🧠 Skill Check — Failed")
              .setDescription("❌ Too slow. No payout.")
              .setColor(0xaa0000);

            session.view = "95";
            await msg
              .edit({
                embeds: [embed],
                components: buildNineToFiveComponents({ disabled: false, legendary: session.legendaryAvailable }),
              })
              .catch(() => {});
            scheduleReturnToCategory(5000);
            return;
          }

          if (await checkCooldownOrTell(btn)) return;

          const base = isLegendary
            ? randInt(LEGENDARY_MIN, LEGENDARY_MAX)
            : randInt(skillCfg.payout?.min ?? 1000, skillCfg.payout?.max ?? 2000);

          const paid = await payUser(
            base,
            isLegendary ? "job_95_legendary" : "job_95_skill",
            isLegendary ? (skillCfg.xp?.legendary ?? 30) : (skillCfg.xp?.success ?? 10),
            { legendary: isLegendary },
            { countJob: true, allowLegendarySpawn: true, activityEffects: isLegendary ? (skillCfg.legendaryActivityEffects || skillCfg.activityEffects) : skillCfg.activityEffects }
          );

          const embed = new EmbedBuilder()
            .setTitle(isLegendary ? "🌟 Legendary — Complete" : "🧠 Skill Check — Complete")
            .setDescription(
              [
                `✅ Paid: **$${paid.amount.toLocaleString()}**`,
                `⏳ Next payout: <t:${toUnix(paid.nextClaim)}:R>`,
                paid.prog.leveledUp ? `🎉 Level up! You are now **Level ${paid.prog.level}**` : "",
                "",
                "Back to Work a 9–5.",
              ]
                .filter(Boolean)
                .join("\n")
            )
            .setColor(0x22aa55);

          session.view = "95";
          await msg
            .edit({
              embeds: [embed],
              components: buildNineToFiveComponents({ disabled: false, legendary: session.legendaryAvailable }),
            })
            .catch(() => {});
          scheduleReturnToCategory(5000);
            return;
        }

        // Shift collect
        if (actionId === "job_shift_collect") {
          if (!session.shiftReady) return;
          if (await checkCooldownOrTell(btn)) return;

          const base = randInt(shiftCfg.payout?.min ?? 1200, shiftCfg.payout?.max ?? 2500);

          const paid = await payUser(
            base,
            "job_95_shift",
            shiftCfg.xp?.success ?? 12,
            { shift: true },
            { countJob: true, allowLegendarySpawn: true, activityEffects: shiftCfg.activityEffects }
          );

          const embed = new EmbedBuilder()
            .setTitle("🕒 Shift — Complete")
            .setDescription(
              [
                `✅ Paid: **$${paid.amount.toLocaleString()}**`,
                `⏳ Next payout: <t:${toUnix(paid.nextClaim)}:R>`,
                paid.prog.leveledUp ? `🎉 Level up! You are now **Level ${paid.prog.level}**` : "",
                "",
                "Back to Work a 9–5.",
              ]
                .filter(Boolean)
                .join("\n")
            )
            .setColor(0x22aa55);

          session.view = "95";
          await msg
            .edit({
              embeds: [embed],
              components: buildNineToFiveComponents({ disabled: false, legendary: session.legendaryAvailable }),
            })
            .catch(() => {});
          scheduleReturnToCategory(5000);
            return;
        }

        /* ============================================================
           Night Walker ENTRY
           ============================================================ */
        if (actionId.startsWith("job_nw:")) {
          const jobKey = actionId.split(":")[1];

          if (await checkCooldownOrTell(btn)) return;

          const cfg = nightWalker?.jobs?.[jobKey];
          if (!cfg) return;

          const rounds = cfg.rounds || 1;
          const poolList = cfg.scenarios || [];
          const pickedScenarios = sampleUnique(poolList, rounds);

          while (pickedScenarios.length < rounds && poolList.length) {
            pickedScenarios.push(pick(poolList));
          }

          session.view = "nw_round";
          session.nw = {
            jobKey,
            cfg,
            roundIndex: 0,
            pickedScenarios,
            wrongCount: 0,
            penaltyTokens: 0,
            risk: 0,
            payoutModPct: 0,
          };

          const sc = session.nw.pickedScenarios[0];
          await msg
            .edit({
              embeds: [
                buildNWRoundEmbed({
                  title: cfg.title || jobKey,
                  round: 1,
                  rounds,
                  prompt: sc?.prompt || "…",
                  statusLines: [],
                }),
              ],
              components: buildNWChoiceComponents({
                jobKey,
                roundIndex: 0,
                choices: sc?.choices || [],
              }),
            })
            .catch(() => {});
          return;
        }

        // NW round choice clicks
        if (actionId.startsWith("nw:")) {
          if (!session.nw) return;

          const [, jobKey, roundIndexStr, choiceIndexStr] = actionId.split(":");
          const roundIndex = Number(roundIndexStr);
          const choiceIndex = Number(choiceIndexStr);

          const cfg = nightWalker?.jobs?.[jobKey];
          if (!cfg) return;

          const sc = session.nw.pickedScenarios?.[roundIndex];
          const choice = sc?.choices?.[choiceIndex];
          if (!choice) return;

          if (jobKey === "flirt") {
            if (choice.correct === false) session.nw.wrongCount++;
          }
          if (jobKey === "lapDance") {
            if (choice.penalty) session.nw.penaltyTokens += choice.penalty;
          }
          if (jobKey === "prostitute") {
            session.nw.risk = clamp(session.nw.risk + (choice.riskDelta || 0), 0, 200);
          }

          session.nw.payoutModPct = clamp(session.nw.payoutModPct + (choice.payoutDeltaPct || 0), -80, 200);

          if (jobKey === "flirt" && session.nw.wrongCount >= (cfg.failOnWrongs || 2)) {
            session.view = "nw";
            session.nw = null;

            const embed = new EmbedBuilder()
              .setTitle(`${cfg.title || jobKey} — Failed`)
              .setDescription("❌ Too many wrong answers. No payout.")
              .setColor(0xaa0000);

            await msg.edit({ embeds: [embed], components: buildNightWalkerComponents(false) }).catch(() => {});
            return;
          }

          if (jobKey === "lapDance" && session.nw.penaltyTokens >= (cfg.penalties?.failAt || 3)) {
            session.view = "nw";
            session.nw = null;

            const embed = new EmbedBuilder()
              .setTitle(`${cfg.title || jobKey} — Failed`)
              .setDescription("❌ You messed up too many times. No payout.")
              .setColor(0xaa0000);

            await msg.edit({ embeds: [embed], components: buildNightWalkerComponents(false) }).catch(() => {});
            scheduleReturnToCategory(5000);
            return;
          }

          if (jobKey === "prostitute" && session.nw.risk >= (cfg.risk?.failAt || 100)) {
            session.view = "nw";
            session.nw = null;

            const embed = new EmbedBuilder()
              .setTitle(`${cfg.title || jobKey} — Failed`)
              .setDescription("❌ Heat got too high. No payout.")
              .setColor(0xaa0000);

            await msg.edit({ embeds: [embed], components: buildNightWalkerComponents(false) }).catch(() => {});
            scheduleReturnToCategory(5000);
            return;
          }

          session.nw.roundIndex++;

          if (session.nw.roundIndex >= (cfg.rounds || 1)) {
            if (await checkCooldownOrTell(btn)) return;

            const base = randInt(cfg.payout?.min ?? 1000, cfg.payout?.max ?? 2000);
            const mod = 1 + (session.nw.payoutModPct / 100);
            const amountBase = Math.max(0, Math.floor(base * mod));

            const paid = await payUser(
              amountBase,
              `job_nw_${jobKey}`,
              cfg.xp?.success ?? 0,
              { job: jobKey, modPct: session.nw.payoutModPct },
              { countJob: true, allowLegendarySpawn: true, activityEffects: cfg.activityEffects }
            );

            const embed = new EmbedBuilder()
              .setTitle(`${cfg.title || jobKey} — Complete`)
              .setDescription(
                [
                  choice.feedback || "Nice.",
                  "",
                  `✅ Paid: **$${paid.amount.toLocaleString()}**`,
                  `⏳ Next payout: <t:${toUnix(paid.nextClaim)}:R>`,
                  paid.prog.leveledUp ? `🎉 Level up! You are now **Level ${paid.prog.level}**` : "",
                  "",
                  "Back to Night Walker.",
                ]
                  .filter(Boolean)
                  .join("\n")
              )
              .setColor(0x22aa55);

            session.view = "nw";
            session.nw = null;

            await msg.edit({ embeds: [embed], components: buildNightWalkerComponents(false) }).catch(() => {});
            scheduleReturnToCategory(5000);
            return;
          }

          const nextSc = session.nw.pickedScenarios?.[session.nw.roundIndex];
          const statusLines = [];

          if (jobKey === "flirt") statusLines.push(`Wrong answers: **${session.nw.wrongCount}/${cfg.failOnWrongs || 2}**`);
          if (jobKey === "lapDance") statusLines.push(`Mistakes: **${session.nw.penaltyTokens}/${cfg.penalties?.failAt || 3}**`);
          if (jobKey === "prostitute") statusLines.push(`Risk: **${session.nw.risk}/${cfg.risk?.failAt || 100}**`);

          await msg
            .edit({
              embeds: [
                buildNWRoundEmbed({
                  title: cfg.title || jobKey,
                  round: session.nw.roundIndex + 1,
                  rounds: cfg.rounds || 1,
                  prompt: nextSc?.prompt || "…",
                  statusLines: [choice.feedback || "", "", ...statusLines].filter(Boolean),
                }),
              ],
              components: buildNWChoiceComponents({
                jobKey,
                roundIndex: session.nw.roundIndex,
                choices: nextSc?.choices || [],
              }),
            })
            .catch(() => {});
          return;
        }
      } catch (e) {
        console.error("/job interaction error:", e);
        try {
          await btn.followUp({ content: "❌ Something went wrong. Check Railway logs.", flags: MessageFlags.Ephemeral });
        } catch {}
      }
    });

    collector.on("end", async () => {
      cancelAutoReturn();
      if (session.shiftInterval) {
        clearInterval(session.shiftInterval);
        session.shiftInterval = null;
      }
      if (session.trucker?.interval) {
        clearInterval(session.trucker.interval);
        session.trucker.interval = null;
      }
      try {
        await msg.edit({ components: buildHubComponents(true) });
      } catch {}
      setTimeout(() => msg.delete().catch(() => {}), 1000);
    });

    // refresh only updates navigation views
    const refresh = setInterval(async () => {
      if (collector.ended) return clearInterval(refresh);
      if (["hub", "95", "nw", "grind", "crime", "enterprises", "farming_placeholder", "farming"].includes(session.view)) {
        await redraw();
      }
    }, 10_000);
  },
};
