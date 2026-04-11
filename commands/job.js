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
const ui = require("../utils/ui");

// ✅ UPDATED: add getCrimeHeatInfo for bar + timer UI
const { getCrimeHeatInfo } = require("../utils/crimeHeat");

// ✅ Grind fatigue (shared across Grind jobs)
const { canGrind: canGrindFatigue } = require("../utils/grindFatigue");

// ✅ Config imports
const shiftCfg = require("../data/work/categories/nineToFive/shift");


// ✅ Crime
// ✅ Grind (NEW)

// ✅ Farming
const farming = require("../utils/farming/engine");
const market = require("../utils/farming/market");
const machineEngine = require("../utils/farming/machineEngine");
const farmingUi = require("../features/farming/ui");
const { handleFarmingInteraction } = require("../features/farming/handlers");
const crimeUi = require("../features/crime/ui");
const { handleCrimeInteraction } = require("../features/crime/handlers");
const { CRIME_GLOBAL_KEY, CRIME_KEYS } = require("../features/crime/constants");
const grindUi = require("../features/grind/ui");
const { handleGrindInteraction } = require("../features/grind/handlers");
const nineToFiveUi = require("../features/nineToFive/ui");
const { handleNineToFiveInteraction } = require("../features/nineToFive/handlers");
const nightWalkerUi = require("../features/nightWalker/ui");
const { handleNightWalkerInteraction } = require("../features/nightWalker/handlers");
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
/**
 * Ensure the button interaction is acknowledged (prevents "This interaction failed").
 * Safe to call multiple times.
 */
async function ensureAck(i) {
  if (i.deferred || i.replied) return;
  await i.deferUpdate().catch(() => {});
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
    .setColor(ui.colors.warning)
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

  return ui.applySystemStyle(new EmbedBuilder()
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
    ), "job", "Leveling up increases payout bonus.");
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
    new ButtonBuilder()
      .setCustomId("job_stop")
      .setLabel(ui.nav.close.label)
      .setEmoji(ui.nav.close.emoji)
      .setStyle(ui.nav.close.style)
      .setDisabled(disabled)
  );

  return [catRow, navRow];
}

function buildEnterprisesEmbed({ cooldownUnix } = {}) {
  return ui.applySystemStyle(new EmbedBuilder()
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
    ), "job");
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
            embeds: [nineToFiveUi.buildNineToFiveEmbed(interaction.user, p, cd)],
            components: nineToFiveUi.buildNineToFiveComponents({ disabled: false, legendary: session.legendaryAvailable }),
          })
          .catch(() => {});
      }

      if (session.view === "nw") {
        return msg
          .edit({
            embeds: [nightWalkerUi.buildNightWalkerEmbed(interaction.user, p, cd)],
            components: nightWalkerUi.buildNightWalkerComponents(false),
          })
          .catch(() => {});
      }

      if (session.view === "trucker" && session.trucker) {
        return msg
          .edit({
            embeds: [nineToFiveUi.buildTruckerEmbed(session.trucker, { completed: session.trucker.ready })],
            components: nineToFiveUi.buildTruckerButtons(session.trucker),
          })
          .catch(() => {});
      }

      if (session.view === "grind") {
        const fatigueInfo = await canGrindFatigue(pool, guildId, userId);

        return msg
          .edit({
            embeds: [grindUi.buildGrindEmbed({ cooldownUnix: cd, fatigueInfo })],
            components: grindUi.buildGrindComponents(false),
          })
          .catch(() => {});
      }

      if (session.view === "farming") {
        try {

          const farm = await farming.ensureFarm(guildId, userId);

          await farming.applySeasonRollover(guildId, userId, farm);
          await farming.applyFieldTaskRollovers(guildId, userId, farm);

          const components = farmingUi.buildFarmingComponents(farm);

          return await msg.edit({
            embeds: [farmingUi.buildFarmingEmbed(farm)],
            components
          });
        } catch (err) {
          console.error("[FARM] redraw failed:", err);
          return msg.edit({
            embeds: [
              new EmbedBuilder()
                .setTitle("🌾 Farming")
                .setDescription("❌ Farming failed to load. Check the bot logs for details.")
                .setColor(ui.colors.danger)
            ],
            components: buildEnterprisesComponents(false),
          }).catch(() => {});
        }
      }

      if (session.view === "farm_field") {
        const farm = await farming.ensureFarm(guildId, userId);
        await farming.applySeasonRollover(guildId, userId, farm);
        await farming.applyFieldTaskRollovers(guildId, userId, farm);

        return msg.edit({
          embeds: [farmingUi.buildFieldEmbed(farm, session.fieldIndex)],
          components: farmingUi.buildFieldComponents(farm, session.fieldIndex),
        }).catch(() => {});
      }

      if (session.view === "farm_market") {
        const items = await market.getSellableFarmItems(guildId, userId);

        return msg.edit({
          embeds: [farmingUi.buildFarmMarketEmbed(items)],
          components: farmingUi.buildFarmMarketComponents(items),
        }).catch(() => {});
      }

      if (session.view === "farm_machines") {
        if (session.machinePage === "home") {
          return msg.edit({
            embeds: [farmingUi.buildMachineShedHomeEmbed()],
            components: farmingUi.buildMachineShedHomeComponents(),
          });
        }

        if (["buy", "rent", "sell"].includes(session.machinePage)) {
          return msg.edit({
            embeds: [farmingUi.buildMachineActionEmbed(session.machinePage)],
            components: farmingUi.buildMachineActionCategoryComponents(session.machinePage),
          });
        }

        if (session.machinePage?.startsWith("machine_cat:")) {
          const [, mode, category] = session.machinePage.split(":");
          const machineState = await machineEngine.ensureMachineState(guildId, userId);

          return msg.edit({
            embeds: [farmingUi.buildMachineActionCategoryEmbed(category, machineState, mode)],
            components: farmingUi.buildMachineActionSelectComponents(category, machineState, mode),
          }).catch(() => {});
        }
      }

      if (session.view === "enterprises") {
        return msg.edit({
          embeds: [buildEnterprisesEmbed({ cooldownUnix: cd })],
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
            embeds: [crimeUi.buildCrimeEmbed({ heatInfo, cooldowns })],
            components: crimeUi.buildCrimeComponents(false),
          })
          .catch(() => {});
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
        if (await handleFarmingInteraction({
          actionId,
          interaction: btn,
          session,
          msg,
          pool,
          guildId,
          userId,
          redraw,
        })) return;

        if (await handleCrimeInteraction({
          actionId,
          interaction: btn,
          session,
          guildId,
          userId,
          boardAdapter,
          pool,
          redraw,
          resetInactivity,
        })) return;

        if (await handleGrindInteraction({
          actionId,
          interaction: btn,
          session,
          msg,
          pool,
          guildId,
          userId,
          redraw,
          resetInactivity,
          checkCooldownOrTell,
        })) return;

        if (await handleNineToFiveInteraction({
          actionId,
          interaction: btn,
          session,
          msg,
          guildId,
          userId,
          payUser,
          checkCooldownOrTell,
          scheduleReturnToCategory,
          legendary: {
            skillTimeMs: LEGENDARY_SKILL_TIME_MS,
            min: LEGENDARY_MIN,
            max: LEGENDARY_MAX,
          },
        })) return;

        if (await handleNightWalkerInteraction({
          actionId,
          interaction: btn,
          session,
          msg,
          payUser,
          checkCooldownOrTell,
          scheduleReturnToCategory,
        })) return;

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
      if (["hub", "95", "nw", "grind", "crime", "enterprises", "farming", "farm_field", "farm_market", "farm_machines"].includes(session.view)) {
        await redraw();
      }
    }, 10_000);
  },
};
