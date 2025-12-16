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

/* ============================================================
   ✅ EASY BALANCE TUNING (EDIT HERE)
   ============================================================ */

// Cooldown between payouts (NOT between opening /job)
const JOB_COOLDOWN_SECONDS = 30;

// Board auto-clears after 3 minutes with no button presses
const BOARD_INACTIVITY_MS = 3 * 60_000;

// ----------- MODE PAYOUTS (EDIT THESE) -----------
// 1) Contract (multi-step): base range + step bonuses/risk multipliers
const CONTRACT_BASE_MIN = 900;
const CONTRACT_BASE_MAX = 1600;

// 2) Skill check: success / fail payout
const SKILL_SUCCESS_MIN = 800;
const SKILL_SUCCESS_MAX = 2000;
const SKILL_FAIL_MIN = 50;
const SKILL_FAIL_MAX = 250;

// 3) Shift: payout for completing shift (collect pay)
const SHIFT_PAY_MIN = 1500;
const SHIFT_PAY_MAX = 3200;

// Shift duration (seconds) and update rate
const SHIFT_DURATION_S = 45;
const SHIFT_TICK_S = 5;

// Optional: small bonus chance on any mode
const GLOBAL_BONUS_CHANCE = 0.05;
const GLOBAL_BONUS_MIN = 500;
const GLOBAL_BONUS_MAX = 2500;

// --------------------------------------------------

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

// ---------------- Cooldowns (same schema as daily/weekly) ----------------
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

// ---------------- UI builders ----------------
function buildBoardEmbed(user) {
  return new EmbedBuilder()
    .setTitle("🧰 Job Board")
    .setDescription(
      [
        `Alright **${user.username}** — pick what kind of work you want to do.`,
        `Cooldown between payouts: **${JOB_COOLDOWN_SECONDS}s**.`,
        `Board clears after **3 minutes** inactivity (or press **Stop Work**).`,
        "",
        "**Job Types:**",
        "📦 **Contract (Multi-step)** — make choices, risk/reward, paid on completion.",
        "🧠 **Skill Check** — quick task, succeed for full pay, fail for crumbs.",
        "🕒 **Shift (Progress Bar)** — wait it out, then press **Collect Pay**.",
      ].join("\n")
    )
    .setFooter({ text: "Tip: You can farm, but you gotta earn it 😄" });
}

function buildBoardComponents(disabled = false) {
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

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("job_stop")
      .setLabel("🛑 Stop Work")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled)
  );

  return [row1, row2];
}

// Contract choices (simple, extendable)
const CONTRACT_STEPS = [
  {
    title: "📦 Step 1/3 — Pick your route",
    desc: "How are you getting there?",
    choices: [
      { id: "highway", label: "Highway", modMin: 0, modMax: 200, risk: 0.02 },
      { id: "backstreets", label: "Backstreets", modMin: 100, modMax: 400, risk: 0.06 },
      { id: "scenic", label: "Scenic", modMin: -50, modMax: 250, risk: 0.01 },
    ],
  },
  {
    title: "📦 Step 2/3 — Handling",
    desc: "Package handling style?",
    choices: [
      { id: "careful", label: "Careful", modMin: 50, modMax: 250, risk: 0.01 },
      { id: "fast", label: "Fast", modMin: 150, modMax: 450, risk: 0.08 },
      { id: "standard", label: "Standard", modMin: 0, modMax: 200, risk: 0.03 },
    ],
  },
  {
    title: "📦 Step 3/3 — Delivery",
    desc: "How do you finish it?",
    choices: [
      { id: "signature", label: "Signature Required", modMin: 100, modMax: 350, risk: 0.03 },
      { id: "doorstep", label: "Doorstep Drop", modMin: 0, modMax: 250, risk: 0.05 },
      { id: "vip", label: "VIP Priority", modMin: 250, modMax: 700, risk: 0.10 },
    ],
  },
];

function buildContractEmbed(stepIndex, pickedSoFar = []) {
  const step = CONTRACT_STEPS[stepIndex];
  const pickedText =
    pickedSoFar.length > 0 ? `\n\n**Chosen so far:** ${pickedSoFar.map(p => `\`${p}\``).join(", ")}` : "";

  return new EmbedBuilder()
    .setTitle(step.title)
    .setDescription(`${step.desc}${pickedText}`)
    .addFields(
      step.choices.map((c) => ({
        name: c.label,
        value: `Bonus: +$${c.modMin}–$${c.modMax} | Risk: ${(c.risk * 100).toFixed(0)}%`,
        inline: false,
      }))
    )
    .setFooter({ text: "Finish all 3 steps to get paid." });
}

function buildContractButtons(stepIndex, disabled = false) {
  const step = CONTRACT_STEPS[stepIndex];
  const row = new ActionRowBuilder();

  for (const c of step.choices) {
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

// Skill check: choose correct emoji
const SKILL_EMOJIS = ["🟥", "🟦", "🟩", "🟨"];

function buildSkillEmbed(targetEmoji, expiresAt) {
  const unix = Math.floor(expiresAt / 1000);
  return new EmbedBuilder()
    .setTitle("🧠 Skill Check")
    .setDescription(
      [
        `Click the **correct emoji** before time runs out: **${targetEmoji}**`,
        `⏳ Expires: <t:${unix}:R>`,
      ].join("\n")
    )
    .setFooter({ text: "Succeed for full pay. Fail for a tiny payout." });
}

function buildSkillButtons(targetEmoji, disabled = false) {
  // Randomize button order
  const shuffled = [...SKILL_EMOJIS].sort(() => Math.random() - 0.5);

  const row = new ActionRowBuilder();
  for (const e of shuffled) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`job_skill:${e}:${targetEmoji}`)
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

// Shift mode
function buildShiftEmbed(startMs, durationMs) {
  const now = Date.now();
  const elapsed = Math.min(durationMs, Math.max(0, now - startMs));
  const pct = Math.floor((elapsed / durationMs) * 100);
  const leftMs = Math.max(0, durationMs - elapsed);
  const doneAtUnix = Math.floor((startMs + durationMs) / 1000);

  return new EmbedBuilder()
    .setTitle("🕒 Shift In Progress")
    .setDescription(
      [
        `${progressBar(pct)} **${pct}%**`,
        `⏳ Shift ends: <t:${doneAtUnix}:R>`,
        leftMs > 0 ? "" : "✅ Shift complete! Press **Collect Pay**.",
      ].join("\n")
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

// ---------------- Main command ----------------
module.exports = {
  data: new SlashCommandBuilder()
    .setName("job")
    .setDescription("Open the job board and work for money."),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.inGuild()) return interaction.editReply("❌ Server only.");
    if (await guardNotJailed(interaction)) return;

    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    await ensureUser(guildId, userId);

    const msg = await interaction.channel.send({
      embeds: [buildBoardEmbed(interaction.user)],
      components: buildBoardComponents(false),
    });

    await interaction.editReply("✅ Job board posted. Pick a job type below.");

    // Per-board session state (in-memory)
    const session = {
      mode: null,                 // "contract" | "skill" | "shift"
      contractStep: 0,
      contractPicks: [],
      contractBonusTotal: 0,
      contractRiskTotal: 0,

      skillTarget: null,
      skillExpiresAt: 0,

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
      // cleanup shift timer if running
      if (session.shiftInterval) {
        clearInterval(session.shiftInterval);
        session.shiftInterval = null;
      }

      try {
        await msg.edit({ components: buildBoardComponents(true) });
      } catch {}
      collector.stop(reason);
      setTimeout(() => msg.delete().catch(() => {}), 1000);
    }

    async function checkCooldownOrTell(btn) {
      const next = await getCooldown(guildId, userId, "job");
      const now = new Date();
      if (next && now < next) {
        const unix = Math.floor(next.getTime() / 1000);
        await btn.followUp({
          content: `⏳ You’re on cooldown. Next payout <t:${unix}:R>.`,
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
        return true;
      }
      return false;
    }

    async function payUser(amount, reason, meta = {}) {
      // apply optional global bonus
      if (GLOBAL_BONUS_CHANCE > 0 && Math.random() < GLOBAL_BONUS_CHANCE) {
        const bonus = randInt(GLOBAL_BONUS_MIN, GLOBAL_BONUS_MAX);
        amount += bonus;
        meta.globalBonus = bonus;
      }

      const nextClaim = new Date(Date.now() + JOB_COOLDOWN_SECONDS * 1000);
      await setCooldown(guildId, userId, "job", nextClaim);

      await creditUser(guildId, userId, amount, reason, meta);

      return { amount, nextClaim, meta };
    }

    collector.on("collect", async (btn) => {
      try {
        if (btn.user.id !== userId) {
          return btn.reply({ content: "❌ This board isn’t for you.", flags: MessageFlags.Ephemeral }).catch(() => {});
        }

        resetInactivity();

        // Stop work
        if (btn.customId === "job_stop") {
          await btn.deferUpdate().catch(() => {});
          return stopWork("stop_button");
        }

        // Mode selection from board
        if (btn.customId.startsWith("job_mode:")) {
          await btn.deferUpdate().catch(() => {});
          const mode = btn.customId.split(":")[1];
          session.mode = mode;

          // CONTRACT
          if (mode === "contract") {
            session.contractStep = 0;
            session.contractPicks = [];
            session.contractBonusTotal = 0;
            session.contractRiskTotal = 0;

            await msg.edit({
              embeds: [buildContractEmbed(0, session.contractPicks)],
              components: buildContractButtons(0, false),
            }).catch(() => {});
            return;
          }

          // SKILL
          if (mode === "skill") {
            const target = pick(SKILL_EMOJIS);
            session.skillTarget = target;
            session.skillExpiresAt = Date.now() + 12_000;

            await msg.edit({
              embeds: [buildSkillEmbed(target, session.skillExpiresAt)],
              components: buildSkillButtons(target, false),
            }).catch(() => {});
            return;
          }

          // SHIFT
          if (mode === "shift") {
            // clear any old interval
            if (session.shiftInterval) clearInterval(session.shiftInterval);
            session.shiftStartMs = Date.now();
            session.shiftReady = false;

            await msg.edit({
              embeds: [buildShiftEmbed(session.shiftStartMs, session.shiftDurationMs)],
              components: buildShiftButtons({ canCollect: false, disabled: false }),
            }).catch(() => {});

            session.shiftInterval = setInterval(async () => {
              try {
                const done = Date.now() - session.shiftStartMs >= session.shiftDurationMs;
                if (done) session.shiftReady = true;

                await msg.edit({
                  embeds: [buildShiftEmbed(session.shiftStartMs, session.shiftDurationMs)],
                  components: buildShiftButtons({ canCollect: session.shiftReady, disabled: false }),
                }).catch(() => {});

                if (done) {
                  clearInterval(session.shiftInterval);
                  session.shiftInterval = null;
                }
              } catch {
                // ignore edit failures
              }
            }, SHIFT_TICK_S * 1000);

            return;
          }
        }

        // CONTRACT CHOICES
        if (btn.customId.startsWith("job_contract:")) {
          await btn.deferUpdate().catch(() => {});

          if (await checkCooldownOrTell(btn)) return;

          const [, stepStr, choiceId] = btn.customId.split(":");
          const stepIndex = Number(stepStr);
          if (stepIndex !== session.contractStep) return;

          const step = CONTRACT_STEPS[stepIndex];
          const choice = step.choices.find((c) => c.id === choiceId);
          if (!choice) return;

          // accumulate
          session.contractPicks.push(choice.label);
          session.contractBonusTotal += randInt(choice.modMin, choice.modMax);
          session.contractRiskTotal += choice.risk;
          session.contractStep += 1;

          // next step or finish
          if (session.contractStep < CONTRACT_STEPS.length) {
            await msg.edit({
              embeds: [buildContractEmbed(session.contractStep, session.contractPicks)],
              components: buildContractButtons(session.contractStep, false),
            }).catch(() => {});
            return;
          }

          // Finish contract: roll base + bonuses, apply risk fail
          const base = randInt(CONTRACT_BASE_MIN, CONTRACT_BASE_MAX);
          let amount = base + session.contractBonusTotal;

          const riskRoll = Math.random();
          const fail = riskRoll < session.contractRiskTotal;

          if (fail) {
            // failed contract => small consolation
            const consolation = randInt(50, 300);
            await payUser(consolation, "job_contract_fail", {
              picks: session.contractPicks,
              risk: session.contractRiskTotal,
              base,
              bonus: session.contractBonusTotal,
            });

            const embed = new EmbedBuilder()
              .setTitle("📦 Contract Failed")
              .setDescription(
                [
                  `You hit a snag and the contract fell through. 😬`,
                  "",
                  `**Chosen:** ${session.contractPicks.map((p) => `\`${p}\``).join(", ")}`,
                  `Risk: **${Math.round(session.contractRiskTotal * 100)}%**`,
                  "",
                  `🪙 Consolation pay: **$${consolation.toLocaleString()}**`,
                  "",
                  "Pick another job type, or press **Stop Work**.",
                ].join("\n")
              );

            await msg.edit({ embeds: [embed], components: buildBoardComponents(false) }).catch(() => {});
            return;
          }

          const paid = await payUser(amount, "job_contract", {
            picks: session.contractPicks,
            risk: session.contractRiskTotal,
            base,
            bonus: session.contractBonusTotal,
          });

          const extraLine = paid.meta.globalBonus
            ? `\n✨ Bonus find: **+$${Number(paid.meta.globalBonus).toLocaleString()}**`
            : "";

          const embed = new EmbedBuilder()
            .setTitle("📦 Contract Complete")
            .setDescription(
              [
                `Nice work. Contract delivered clean.`,
                "",
                `**Chosen:** ${session.contractPicks.map((p) => `\`${p}\``).join(", ")}`,
                `Risk: **${Math.round(session.contractRiskTotal * 100)}%**`,
                "",
                `✅ Paid: **$${paid.amount.toLocaleString()}**${extraLine}`,
                `⏳ Next payout: <t:${Math.floor(paid.nextClaim.getTime() / 1000)}:R>`,
                "",
                "Pick another job type, or press **Stop Work**.",
              ].join("\n")
            );

          await msg.edit({ embeds: [embed], components: buildBoardComponents(false) }).catch(() => {});
          return;
        }

        // SKILL CHOICES
        if (btn.customId.startsWith("job_skill:")) {
          await btn.deferUpdate().catch(() => {});

          if (await checkCooldownOrTell(btn)) return;

          const [, clickedEmoji, targetEmoji] = btn.customId.split(":");

          const expired = Date.now() > session.skillExpiresAt;
          const correct = clickedEmoji === targetEmoji && !expired;

          if (correct) {
            const amount = randInt(SKILL_SUCCESS_MIN, SKILL_SUCCESS_MAX);
            const paid = await payUser(amount, "job_skill_success", { target: targetEmoji });

            const extraLine = paid.meta.globalBonus
              ? `\n✨ Bonus: **+$${Number(paid.meta.globalBonus).toLocaleString()}**`
              : "";

            const embed = new EmbedBuilder()
              .setTitle("🧠 Skill Check — Success")
              .setDescription(
                [
                  `You nailed it: **${targetEmoji}**`,
                  "",
                  `✅ Paid: **$${paid.amount.toLocaleString()}**${extraLine}`,
                  `⏳ Next payout: <t:${Math.floor(paid.nextClaim.getTime() / 1000)}:R>`,
                  "",
                  "Pick another job type, or press **Stop Work**.",
                ].join("\n")
              );

            await msg.edit({ embeds: [embed], components: buildBoardComponents(false) }).catch(() => {});
            return;
          } else {
            const amount = randInt(SKILL_FAIL_MIN, SKILL_FAIL_MAX);
            const paid = await payUser(amount, "job_skill_fail", { target: targetEmoji, clicked: clickedEmoji, expired });

            const embed = new EmbedBuilder()
              .setTitle("🧠 Skill Check — Fail")
              .setDescription(
                [
                  expired ? "Too slow. 😴" : `Wrong one. Target was **${targetEmoji}**`,
                  "",
                  `🪙 Paid: **$${paid.amount.toLocaleString()}** (better luck next time)`,
                  `⏳ Next payout: <t:${Math.floor(paid.nextClaim.getTime() / 1000)}:R>`,
                  "",
                  "Pick another job type, or press **Stop Work**.",
                ].join("\n")
              );

            await msg.edit({ embeds: [embed], components: buildBoardComponents(false) }).catch(() => {});
            return;
          }
        }

        // SHIFT COLLECT
        if (btn.customId === "job_shift_collect") {
          await btn.deferUpdate().catch(() => {});

          if (await checkCooldownOrTell(btn)) return;

          if (!session.shiftReady) {
            // keep board, just tell them quietly
            return btn.followUp({ content: "⏳ Shift isn’t finished yet.", flags: MessageFlags.Ephemeral }).catch(() => {});
          }

          const amount = randInt(SHIFT_PAY_MIN, SHIFT_PAY_MAX);
          const paid = await payUser(amount, "job_shift", {
            duration_s: SHIFT_DURATION_S,
          });

          const extraLine = paid.meta.globalBonus
            ? `\n✨ Bonus: **+$${Number(paid.meta.globalBonus).toLocaleString()}**`
            : "";

          const embed = new EmbedBuilder()
            .setTitle("🕒 Shift Complete")
            .setDescription(
              [
                `Clocked out. Solid grind.`,
                "",
                `✅ Paid: **$${paid.amount.toLocaleString()}**${extraLine}`,
                `⏳ Next payout: <t:${Math.floor(paid.nextClaim.getTime() / 1000)}:R>`,
                "",
                "Pick another job type, or press **Stop Work**.",
              ].join("\n")
            );

          await msg.edit({ embeds: [embed], components: buildBoardComponents(false) }).catch(() => {});
          return;
        }

        // Unknown button: ignore
      } catch (e) {
        console.error("/job interaction error:", e);
        // don’t crash; let board persist
        try {
          await btn.followUp({ content: "❌ Something went wrong. Check Railway logs.", flags: MessageFlags.Ephemeral });
        } catch {}
      }
    });

    collector.on("end", async () => {
      // Clean up shift timer if still running
      if (session.shiftInterval) {
        clearInterval(session.shiftInterval);
        session.shiftInterval = null;
      }

      // Disable then delete
      try {
        await msg.edit({ components: buildBoardComponents(true) });
      } catch {}
      setTimeout(() => msg.delete().catch(() => {}), 1000);
    });
  },
};
