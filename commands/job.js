// commands/job.js
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require("discord.js");

const { pool } = require("../utils/db");
const { ensureUser, creditUser } = require("../utils/economy");
const { guardNotJailed } = require("../utils/jail");
const { unlockAchievement } = require("../utils/achievementEngine");

/* ============================================================
   ✅ BALANCE TUNING (EDIT THESE)
   ============================================================ */

// cooldown BETWEEN PAYOUTS (not between opening /job)
const JOB_COOLDOWN_SECONDS = 45;

// board clears after 3 minutes inactivity (or Stop Work)
const BOARD_INACTIVITY_MS = 3 * 60_000;

// XP per payout
const XP_CONTRACT = 15;
const XP_SKILL_SUCCESS = 10;
const XP_SKILL_FAIL = 3;
const XP_SHIFT = 12;
const XP_LEGENDARY = 30;

// Level curve: XP needed increases steadily
// XP to next level = 100 + (level-1)*60
function xpToNext(level) {
  return 100 + (Math.max(1, level) - 1) * 60;
}

// payout multiplier by level (2% per level, capped at +60%)
function levelMultiplier(level) {
  const mult = 1 + 0.02 * (Math.max(1, level) - 1);
  return Math.min(mult, 1.6);
}

// 1) Contract (multi-step) base
const CONTRACT_BASE_MIN = 750;
const CONTRACT_BASE_MAX = 1250;

// 2) Skill check
const SKILL_SUCCESS_MIN = 650;
const SKILL_SUCCESS_MAX = 1600;
const SKILL_FAIL_MIN = 50;
const SKILL_FAIL_MAX = 220;

// 3) Shift (progress bar)
const SHIFT_PAY_MIN = 1200;
const SHIFT_PAY_MAX = 2600;
const SHIFT_DURATION_S = 45;
const SHIFT_TICK_S = 5;

// Legendary spawn chance (rolled AFTER a SUCCESSFUL completion)
const LEGENDARY_CHANCE = 0.012; // ~1.2%
const LEGENDARY_TTL_MS = 60_000; // stays available for 60s or until used
const LEGENDARY_MIN = 50_000;
const LEGENDARY_MAX = 90_000;
const LEGENDARY_SKILL_TIME_MS = 7_000; // tighter skill-check window

// Optional global bonus (small spice)
const GLOBAL_BONUS_CHANCE = 0.04;
const GLOBAL_BONUS_MIN = 400;
const GLOBAL_BONUS_MAX = 2000;

/* ============================================================ */

function randInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function progressBar(pct, size = 12) {
  const filled = Math.max(0, Math.min(size, Math.round((pct / 100) * size)));
  return "▰".repeat(filled) + "▱".repeat(size - filled);
}

/* ============================================================
   ✅ Cooldowns (same schema as daily/weekly)
   ============================================================ */
async function getCooldown(guildId, userId, key) {
  const cd = await pool.query(
    `SELECT next_claim_at FROM cooldowns WHERE guild_id=$1 AND user_id=$2 AND key=$3`,
    [guildId, userId, key]
  );
  if (cd.rowCount === 0) return null;
  return new Date(cd.rows[0].next_claim_at);
}
async function setCooldown(guildId, userId, key, nextClaim) {
  await pool.query(
    `INSERT INTO cooldowns (guild_id, user_id, key, next_claim_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (guild_id, user_id, key)
     DO UPDATE SET next_claim_at=EXCLUDED.next_claim_at`,
    [guildId, userId, key, nextClaim]
  );
}

/* ============================================================
   ✅ Job Progress DB
   Requires table:
   job_progress(guild_id,user_id,xp,level,total_jobs,updated_at)
   ============================================================ */
async function ensureJobProgress(guildId, userId) {
  await pool.query(
    `INSERT INTO job_progress (guild_id, user_id, xp, level, total_jobs)
     VALUES ($1,$2,0,1,0)
     ON CONFLICT (guild_id, user_id) DO NOTHING`,
    [guildId, userId]
  );
}

async function getJobProgress(guildId, userId) {
  await ensureJobProgress(guildId, userId);
  const res = await pool.query(
    `SELECT xp, level, total_jobs FROM job_progress WHERE guild_id=$1 AND user_id=$2`,
    [guildId, userId]
  );
  const row = res.rows?.[0] || { xp: 0, level: 1, total_jobs: 0 };
  return {
    xp: Number(row.xp || 0),
    level: Number(row.level || 1),
    totalJobs: Number(row.total_jobs || 0),
  };
}

// IMPORTANT: countJob controls total_jobs increment (ONLY on successful completions)
async function addXpAndMaybeLevel(guildId, userId, addXp, countJob = true) {
  await ensureJobProgress(guildId, userId);

  const cur = await getJobProgress(guildId, userId);
  let xp = cur.xp + Math.max(0, Number(addXp || 0));
  let level = cur.level;
  let leveledUp = false;

  while (xp >= xpToNext(level)) {
    xp -= xpToNext(level);
    level += 1;
    leveledUp = true;
  }

  const upd = await pool.query(
    `UPDATE job_progress
     SET xp=$3,
         level=$4,
         total_jobs = total_jobs + $5,
         updated_at = NOW()
     WHERE guild_id=$1 AND user_id=$2
     RETURNING xp, level, total_jobs`,
    [guildId, userId, xp, level, countJob ? 1 : 0]
  );

  const row = upd.rows?.[0];
  return {
    xp: Number(row?.xp ?? xp),
    level: Number(row?.level ?? level),
    totalJobs: Number(row?.total_jobs ?? (cur.totalJobs + (countJob ? 1 : 0))),
    leveledUp,
  };
}

/* ============================================================
   ✅ Achievements: announce + milestones for jobs
   ============================================================ */
const JOB_MILESTONES = [
  { count: 1, id: "job_first_fin" },
  { count: 10, id: "job_10_fin" },
  { count: 50, id: "job_50_fin" },
  { count: 100, id: "job_100_win" },
  { count: 250, id: "job_250_fin" },
];

async function fetchAchievementInfo(achievementId) {
  try {
    const res = await pool.query(
      `SELECT id, name, description, category, reward_coins, reward_role_id
       FROM public.achievements
       WHERE id=$1`,
      [achievementId]
    );
    return res.rows?.[0] ?? null;
  } catch (e) {
    console.error("fetchAchievementInfo failed:", e);
    return null;
  }
}

async function announceAchievement(channel, userId, info) {
  if (!channel || !channel.send || !info) return;

  const rewardCoins = Number(info.reward_coins || 0);

  const embed = new EmbedBuilder()
    .setTitle("🏆 Achievement Unlocked!")
    .setDescription(`**<@${userId}>** unlocked **${info.name}**`)
    .addFields(
      { name: "Description", value: info.description || "—" },
      { name: "Category", value: info.category || "General", inline: true },
      { name: "Reward", value: rewardCoins > 0 ? `+$${rewardCoins.toLocaleString()}` : "None", inline: true }
    )
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
   ✅ UI builders
   ============================================================ */
function buildBoardEmbed(user, progress, legendaryAvailable) {
  const need = xpToNext(progress.level);
  const mult = levelMultiplier(progress.level);

  return new EmbedBuilder()
    .setTitle("🧰 Job Board")
    .setDescription(
      [
        `Alright **${user.username}** — pick what kind of work you want to do.`,
        `Cooldown between payouts: **${JOB_COOLDOWN_SECONDS}s**.`,
        `Board clears after **3 minutes** inactivity (or press **Stop Work**).`,
        "",
        `**Level:** ${progress.level}  |  **XP:** ${progress.xp}/${need}  |  **Payout Bonus:** +${Math.round(
          (mult - 1) * 100
        )}%`,
        "",
        "**Job Types:**",
        "📦 **Contract (Multi-step)** — choices affect risk/reward.",
        "🧠 **Skill Check** — quick task, succeed for full pay.",
        "🕒 **Shift** — wait it out, then **Collect Pay**.",
        legendaryAvailable ? "\n🌟 **Legendary Job available!** (limited time)" : "",
        "",
        progress.level >= 10 ? "🔓 **Unlocked:** VIP choices in Contracts (Level 10+)" : "",
        progress.level >= 20 ? "🔓 **Unlocked:** Dangerous choices in Contracts (Level 20+)" : "",
      ]
        .filter(Boolean)
        .join("\n")
    )
    .setFooter({ text: "Jobs pay instantly. Legendary jobs are rare — don’t miss them." });
}

function buildBoardComponents({ disabled = false, legendary = false } = {}) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("job_mode:contract")
      .setLabel("📦 Contract")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId("job_mode:skill")
      .setLabel("🧠 Skill Check")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId("job_mode:shift")
      .setLabel("🕒 Shift")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled)
  );

  const row2 = new ActionRowBuilder();

  if (legendary) {
    // Discord can't do a true gold button, so we make it POP with emoji + Success style
    row2.addComponents(
      new ButtonBuilder()
        .setCustomId("job_mode:legendary")
        .setLabel("🌟 Legendary Job")
        .setStyle(ButtonStyle.Success)
        .setDisabled(disabled)
    );
  }

  row2.addComponents(
    new ButtonBuilder()
      .setCustomId("job_stop")
      .setLabel("🛑 Stop Work")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled)
  );

  return [row1, row2];
}

/* ============================================================
   ✅ Contract steps with unlockable harder choices
   ============================================================ */
const CONTRACT_STEPS = [
  {
    title: "📦 Step 1/3 — Pick your route",
    desc: "How are you getting there?",
    baseChoices: [
      { id: "highway", label: "Highway", modMin: 0, modMax: 160, risk: 0.02 },
      { id: "backstreets", label: "Backstreets", modMin: 80, modMax: 280, risk: 0.06 },
      { id: "scenic", label: "Scenic", modMin: -40, modMax: 180, risk: 0.01 },
    ],
    vipChoices: [{ id: "viplane", label: "VIP Lane", modMin: 160, modMax: 420, risk: 0.08, minLevel: 10 }],
    dangerChoices: [{ id: "hotroute", label: "Hot Route", modMin: 300, modMax: 700, risk: 0.14, minLevel: 20 }],
  },
  {
    title: "📦 Step 2/3 — Handling",
    desc: "Package handling style?",
    baseChoices: [
      { id: "careful", label: "Careful", modMin: 40, modMax: 180, risk: 0.01 },
      { id: "fast", label: "Fast", modMin: 120, modMax: 340, risk: 0.08 },
      { id: "standard", label: "Standard", modMin: 0, modMax: 160, risk: 0.03 },
    ],
    vipChoices: [{ id: "insured", label: "Insured Handling", modMin: 120, modMax: 320, risk: 0.04, minLevel: 10 }],
    dangerChoices: [{ id: "fragile", label: "Ultra Fragile", modMin: 260, modMax: 620, risk: 0.16, minLevel: 20 }],
  },
  {
    title: "📦 Step 3/3 — Delivery",
    desc: "How do you finish it?",
    baseChoices: [
      { id: "signature", label: "Signature", modMin: 70, modMax: 220, risk: 0.03 },
      { id: "doorstep", label: "Doorstep", modMin: 0, modMax: 170, risk: 0.05 },
      { id: "priority", label: "Priority", modMin: 140, modMax: 380, risk: 0.10 },
    ],
    vipChoices: [{ id: "vipdrop", label: "VIP Priority", modMin: 240, modMax: 600, risk: 0.12, minLevel: 10 }],
    dangerChoices: [{ id: "blackops", label: "Black Ops Drop", modMin: 400, modMax: 900, risk: 0.20, minLevel: 20 }],
  },
];

function getContractChoices(step, level) {
  const out = [...step.baseChoices];
  for (const c of step.vipChoices || []) if (level >= (c.minLevel || 0)) out.push(c);
  for (const c of step.dangerChoices || []) if (level >= (c.minLevel || 0)) out.push(c);
  return out;
}

function buildContractEmbed(stepIndex, pickedSoFar = [], level = 1) {
  const step = CONTRACT_STEPS[stepIndex];
  const choices = getContractChoices(step, level);
  const pickedText =
    pickedSoFar.length > 0 ? `\n\n**Chosen so far:** ${pickedSoFar.map((p) => `\`${p}\``).join(", ")}` : "";

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
    .setFooter({ text: "Finish all 3 steps to get paid." });
}

function buildContractButtons(stepIndex, level, disabled = false) {
  const step = CONTRACT_STEPS[stepIndex];
  const choices = getContractChoices(step, level);

  const row = new ActionRowBuilder();
  for (const c of choices.slice(0, 5)) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`job_contract:${stepIndex}:${c.id}`)
        .setLabel(c.label)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled)
    );
  }

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("job_stop")
      .setLabel("🛑 Stop Work")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled)
  );

  return [row, row2];
}

/* ============================================================
   ✅ Skill check (normal + legendary)
   ============================================================ */
const SKILL_EMOJIS = ["🟥", "🟦", "🟩", "🟨"];

function buildSkillEmbed(title, targetEmoji, expiresAt, color) {
  const unix = Math.floor(expiresAt / 1000);
  const e = new EmbedBuilder()
    .setTitle(title)
    .setDescription(
      [
        `Click the **correct emoji** before time runs out: **${targetEmoji}**`,
        `⏳ Expires: <t:${unix}:R>`,
      ].join("\n")
    )
    .setFooter({ text: "Succeed for full pay. Fail for a tiny payout." });

  if (color) e.setColor(color);
  return e;
}

function buildSkillButtons(targetEmoji, disabled = false, prefix = "job_skill") {
  const shuffled = [...SKILL_EMOJIS].sort(() => Math.random() - 0.5);

  const row = new ActionRowBuilder();
  for (const e of shuffled) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${prefix}:${e}:${targetEmoji}`)
        .setLabel(e)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled)
    );
  }

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("job_stop")
      .setLabel("🛑 Stop Work")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled)
  );

  return [row, row2];
}

/* ============================================================
   ✅ Shift mode
   ============================================================ */
function buildShiftEmbed(startMs, durationMs) {
  const now = Date.now();
  const elapsed = Math.min(durationMs, Math.max(0, now - startMs));
  const pct = Math.floor((elapsed / durationMs) * 100);
  const doneAtUnix = Math.floor((startMs + durationMs) / 1000);

  return new EmbedBuilder()
    .setTitle("🕒 Shift In Progress")
    .setDescription(
      [
        `${progressBar(pct)} **${pct}%**`,
        `⏳ Shift ends: <t:${doneAtUnix}:R>`,
        elapsed >= durationMs ? "✅ Shift complete! Press **Collect Pay**." : "",
      ]
        .filter(Boolean)
        .join("\n")
    )
    .setFooter({ text: "Stay on the board. Collect when ready." });
}

function buildShiftButtons({ canCollect, disabled = false }) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("job_shift_collect")
      .setLabel("💵 Collect Pay")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled || !canCollect)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("job_stop")
      .setLabel("🛑 Stop Work")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled)
  );

  return [row, row2];
}

/* ============================================================
   ✅ Main command
   ============================================================ */
module.exports = {
  data: new SlashCommandBuilder().setName("job").setDescription("Open the job board and work for money."),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.inGuild()) return interaction.editReply("❌ Server only.");
    if (await guardNotJailed(interaction)) return;

    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    await ensureUser(guildId, userId);

    const prog = await getJobProgress(guildId, userId);

    const msg = await interaction.channel.send({
      embeds: [buildBoardEmbed(interaction.user, prog, false)],
      components: buildBoardComponents({ disabled: false, legendary: false }),
    });

    await interaction.editReply("✅ Job board posted. Pick a job type below.");

    const session = {
      level: prog.level,

      legendaryAvailable: false,
      legendaryExpiresAt: 0,

      contractStep: 0,
      contractPicks: [],
      contractBonusTotal: 0,
      contractRiskTotal: 0,

      skillExpiresAt: 0,
      legExpiresAt: 0,

      shiftStartMs: 0,
      shiftInterval: null,
      shiftDurationMs: SHIFT_DURATION_S * 1000,
      shiftReady: false,
    };

    const collector = msg.createMessageComponentCollector({ time: BOARD_INACTIVITY_MS });

    function resetInactivity() {
      collector.resetTimer({ time: BOARD_INACTIVITY_MS });
    }

    async function stopWork(reason = "stopped") {
      if (session.shiftInterval) {
        clearInterval(session.shiftInterval);
        session.shiftInterval = null;
      }
      try {
        await msg.edit({ components: buildBoardComponents({ disabled: true, legendary: false }) });
      } catch {}
      collector.stop(reason);
      setTimeout(() => msg.delete().catch(() => {}), 1000);
    }

    async function redrawBoard() {
      const p = await getJobProgress(guildId, userId);
      session.level = p.level;

      if (session.legendaryAvailable && Date.now() > session.legendaryExpiresAt) {
        session.legendaryAvailable = false;
      }

      await msg
        .edit({
          embeds: [buildBoardEmbed(interaction.user, p, session.legendaryAvailable)],
          components: buildBoardComponents({ disabled: false, legendary: session.legendaryAvailable }),
        })
        .catch(() => {});
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

    // pay helper:
    // countJob=true ONLY on real completions
    // allowLegendarySpawn=true ONLY on real completions
    async function payUser(amountBase, reason, xpGain, meta = {}, { countJob = true, allowLegendarySpawn = true } = {}) {
      const mult = levelMultiplier(session.level);
      let amount = Math.floor(amountBase * mult);

      if (GLOBAL_BONUS_CHANCE > 0 && Math.random() < GLOBAL_BONUS_CHANCE) {
        const bonus = randInt(GLOBAL_BONUS_MIN, GLOBAL_BONUS_MAX);
        amount += bonus;
        meta.globalBonus = bonus;
      }

      const nextClaim = new Date(Date.now() + JOB_COOLDOWN_SECONDS * 1000);
      await setCooldown(guildId, userId, "job", nextClaim);

      await creditUser(guildId, userId, amount, reason, meta);

      const progUpdate = await addXpAndMaybeLevel(guildId, userId, xpGain, countJob);

      // Achievements only on real completions
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

    collector.on("collect", async (btn) => {
      try {
        if (btn.user.id !== userId) {
          return btn.reply({ content: "❌ This board isn’t for you.", flags: MessageFlags.Ephemeral }).catch(() => {});
        }

        resetInactivity();

        if (btn.customId === "job_stop") {
          await btn.deferUpdate().catch(() => {});
          return stopWork("stop_button");
        }

        // MODE selection
        if (btn.customId.startsWith("job_mode:")) {
          await btn.deferUpdate().catch(() => {});
          const mode = btn.customId.split(":")[1];

          // CONTRACT
          if (mode === "contract") {
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

          // SKILL
          if (mode === "skill") {
            const target = pick(SKILL_EMOJIS);
            session.skillExpiresAt = Date.now() + 12_000;

            await msg
              .edit({
                embeds: [buildSkillEmbed("🧠 Skill Check", target, session.skillExpiresAt)],
                components: buildSkillButtons(target, false, "job_skill"),
              })
              .catch(() => {});
            return;
          }

          // SHIFT
          if (mode === "shift") {
            if (session.shiftInterval) clearInterval(session.shiftInterval);
            session.shiftStartMs = Date.now();
            session.shiftReady = false;

            await msg
              .edit({
                embeds: [buildShiftEmbed(session.shiftStartMs, session.shiftDurationMs)],
                components: buildShiftButtons({ canCollect: false, disabled: false }),
              })
              .catch(() => {});

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
            }, SHIFT_TICK_S * 1000);

            return;
          }

          // LEGENDARY
          if (mode === "legendary") {
            session.legendaryAvailable = false;

            const target = pick(SKILL_EMOJIS);
            session.legExpiresAt = Date.now() + LEGENDARY_SKILL_TIME_MS;

            await msg
              .edit({
                embeds: [buildSkillEmbed("🌟 LEGENDARY JOB", target, session.legExpiresAt, 0xFFD700)],
                components: buildSkillButtons(target, false, "job_leg"),
              })
              .catch(() => {});
            return;
          }
        }

        // CONTRACT step choice
        if (btn.customId.startsWith("job_contract:")) {
          await btn.deferUpdate().catch(() => {});
          if (await checkCooldownOrTell(btn)) return;

          const [, stepStr, choiceId] = btn.customId.split(":");
          const stepIndex = Number(stepStr);
          if (stepIndex !== session.contractStep) return;

          const step = CONTRACT_STEPS[stepIndex];
          const choices = getContractChoices(step, session.level);
          const choice = choices.find((c) => c.id === choiceId);
          if (!choice) return;

          session.contractPicks.push(choice.label);
          session.contractBonusTotal += randInt(choice.modMin, choice.modMax);
          session.contractRiskTotal += choice.risk;
          session.contractStep += 1;

          if (session.contractStep < CONTRACT_STEPS.length) {
            await msg
              .edit({
                embeds: [buildContractEmbed(session.contractStep, session.contractPicks, session.level)],
                components: buildContractButtons(session.contractStep, session.level, false),
              })
              .catch(() => {});
            return;
          }

          const base = randInt(CONTRACT_BASE_MIN, CONTRACT_BASE_MAX);
          const amountBase = base + session.contractBonusTotal;
          const fail = Math.random() < session.contractRiskTotal;

          if (fail) {
            const consolationBase = randInt(60, 260);

            const paid = await payUser(
              consolationBase,
              "job_contract_fail",
              4,
              { picks: session.contractPicks, risk: session.contractRiskTotal, base, bonus: session.contractBonusTotal },
              { countJob: false, allowLegendarySpawn: false }
            );

            const embed = new EmbedBuilder()
              .setTitle("📦 Contract Failed")
              .setDescription(
                [
                  `You hit a snag and the contract fell through. 😬`,
                  "",
                  `🪙 Consolation pay: **$${paid.amount.toLocaleString()}**`,
                  paid.prog.leveledUp ? `🎉 **Level up!** You are now **Level ${paid.prog.level}**` : "",
                  "",
                  "Back to the board.",
                ]
                  .filter(Boolean)
                  .join("\n")
              );

            await msg
              .edit({
                embeds: [embed],
                components: buildBoardComponents({ disabled: false, legendary: session.legendaryAvailable }),
              })
              .catch(() => {});
            return;
          }

          const paid = await payUser(
            amountBase,
            "job_contract",
            XP_CONTRACT,
            { picks: session.contractPicks, risk: session.contractRiskTotal, base, bonus: session.contractBonusTotal },
            { countJob: true, allowLegendarySpawn: true }
          );

          const embed = new EmbedBuilder()
            .setTitle("📦 Contract Complete")
            .setDescription(
              [
                `✅ Paid: **$${paid.amount.toLocaleString()}**`,
                `⏳ Next payout: <t:${Math.floor(paid.nextClaim.getTime() / 1000)}:R>`,
                paid.prog.leveledUp ? `🎉 **Level up!** You are now **Level ${paid.prog.level}**` : "",
                "",
                "Back to the board.",
              ]
                .filter(Boolean)
                .join("\n")
            );

          await msg
            .edit({
              embeds: [embed],
              components: buildBoardComponents({ disabled: false, legendary: session.legendaryAvailable }),
            })
            .catch(() => {});
          return;
        }

        // SKILL (normal)
        if (btn.customId.startsWith("job_skill:")) {
          await btn.deferUpdate().catch(() => {});
          if (await checkCooldownOrTell(btn)) return;

          const [, clickedEmoji, targetEmoji] = btn.customId.split(":");
          const expired = Date.now() > session.skillExpiresAt;
          const correct = clickedEmoji === targetEmoji && !expired;

          if (correct) {
            const amountBase = randInt(SKILL_SUCCESS_MIN, SKILL_SUCCESS_MAX);

            const paid = await payUser(
              amountBase,
              "job_skill_success",
              XP_SKILL_SUCCESS,
              { target: targetEmoji },
              { countJob: true, allowLegendarySpawn: true }
            );

            const embed = new EmbedBuilder()
              .setTitle("🧠 Skill Check — Success")
              .setDescription(
                [
                  `✅ Paid: **$${paid.amount.toLocaleString()}**`,
                  `⏳ Next payout: <t:${Math.floor(paid.nextClaim.getTime() / 1000)}:R>`,
                  paid.prog.leveledUp ? `🎉 **Level up!** You are now **Level ${paid.prog.level}**` : "",
                  "",
                  "Back to the board.",
                ]
                  .filter(Boolean)
                  .join("\n")
              );

            await msg
              .edit({
                embeds: [embed],
                components: buildBoardComponents({ disabled: false, legendary: session.legendaryAvailable }),
              })
              .catch(() => {});
          } else {
            const amountBase = randInt(SKILL_FAIL_MIN, SKILL_FAIL_MAX);

            const paid = await payUser(
              amountBase,
              "job_skill_fail",
              XP_SKILL_FAIL,
              { target: targetEmoji, clicked: clickedEmoji, expired },
              { countJob: false, allowLegendarySpawn: false }
            );

            const embed = new EmbedBuilder()
              .setTitle("🧠 Skill Check — Fail")
              .setDescription(
                [
                  expired ? "Too slow. 😴" : `Wrong one. Target was **${targetEmoji}**`,
                  `🪙 Paid: **$${paid.amount.toLocaleString()}**`,
                  `⏳ Next payout: <t:${Math.floor(paid.nextClaim.getTime() / 1000)}:R>`,
                  paid.prog.leveledUp ? `🎉 **Level up!** You are now **Level ${paid.prog.level}**` : "",
                  "",
                  "Back to the board.",
                ]
                  .filter(Boolean)
                  .join("\n")
              );

            await msg
              .edit({
                embeds: [embed],
                components: buildBoardComponents({ disabled: false, legendary: session.legendaryAvailable }),
              })
              .catch(() => {});
          }
          return;
        }

        // LEGENDARY skill
        if (btn.customId.startsWith("job_leg:")) {
          await btn.deferUpdate().catch(() => {});
          if (await checkCooldownOrTell(btn)) return;

          const [, clickedEmoji, targetEmoji] = btn.customId.split(":");
          const expired = Date.now() > session.legExpiresAt;
          const correct = clickedEmoji === targetEmoji && !expired;

          if (!correct) {
            const embed = new EmbedBuilder()
              .setTitle("🌟 Legendary Job — Failed")
              .setColor(0xFFD700)
              .setDescription(
                [
                  expired ? "Too slow… the moment passed." : `Wrong choice. It was **${targetEmoji}**`,
                  "",
                  "Legendary jobs don’t pay if you fail. Brutal, but fair. 😅",
                  "Back to the board.",
                ].join("\n")
              );

            await msg
              .edit({
                embeds: [embed],
                components: buildBoardComponents({ disabled: false, legendary: false }),
              })
              .catch(() => {});
            return;
          }

          const amountBase = randInt(LEGENDARY_MIN, LEGENDARY_MAX);

          const paid = await payUser(
            amountBase,
            "job_legendary",
            XP_LEGENDARY,
            { legendary: true, target: targetEmoji },
            { countJob: true, allowLegendarySpawn: true }
          );

          const embed = new EmbedBuilder()
            .setTitle("🌟 LEGENDARY JOB COMPLETE")
            .setColor(0xFFD700)
            .setDescription(
              [
                `✅ Paid: **$${paid.amount.toLocaleString()}**`,
                `⏳ Next payout: <t:${Math.floor(paid.nextClaim.getTime() / 1000)}:R>`,
                paid.prog.leveledUp ? `🎉 **Level up!** You are now **Level ${paid.prog.level}**` : "",
                "",
                "Back to the board.",
              ]
                .filter(Boolean)
                .join("\n")
            );

          await msg
            .edit({
              embeds: [embed],
              components: buildBoardComponents({ disabled: false, legendary: session.legendaryAvailable }),
            })
            .catch(() => {});
          return;
        }

        // SHIFT collect
        if (btn.customId === "job_shift_collect") {
          await btn.deferUpdate().catch(() => {});
          if (await checkCooldownOrTell(btn)) return;

          if (!session.shiftReady) {
            return btn.followUp({ content: "⏳ Shift isn’t finished yet.", flags: MessageFlags.Ephemeral }).catch(() => {});
          }

          const amountBase = randInt(SHIFT_PAY_MIN, SHIFT_PAY_MAX);

          const paid = await payUser(
            amountBase,
            "job_shift",
            XP_SHIFT,
            { duration_s: SHIFT_DURATION_S },
            { countJob: true, allowLegendarySpawn: true }
          );

          const embed = new EmbedBuilder()
            .setTitle("🕒 Shift Complete")
            .setDescription(
              [
                `✅ Paid: **$${paid.amount.toLocaleString()}**`,
                `⏳ Next payout: <t:${Math.floor(paid.nextClaim.getTime() / 1000)}:R>`,
                paid.prog.leveledUp ? `🎉 **Level up!** You are now **Level ${paid.prog.level}**` : "",
                "",
                "Back to the board.",
              ]
                .filter(Boolean)
                .join("\n")
            );

          await msg
            .edit({
              embeds: [embed],
              components: buildBoardComponents({ disabled: false, legendary: session.legendaryAvailable }),
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
      if (session.shiftInterval) {
        clearInterval(session.shiftInterval);
        session.shiftInterval = null;
      }
      try {
        await msg.edit({ components: buildBoardComponents({ disabled: true, legendary: false }) });
      } catch {}
      setTimeout(() => msg.delete().catch(() => {}), 1000);
    });

    // lightweight refresh (mainly to expire legendary properly)
    const refresh = setInterval(async () => {
      if (collector.ended) return clearInterval(refresh);
      await redrawBoard();
    }, 10_000);
  },
};
