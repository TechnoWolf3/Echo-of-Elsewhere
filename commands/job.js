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
   - JOB_COOLDOWN_SECONDS: how often a user can do /job
   - Each job has MIN/MAX payout and optional BONUS
   ============================================================ */
const JOB_COOLDOWN_SECONDS = 30;

const JOBS = [
  {
    id: "courier",
    name: "📦 Courier Run",
    desc: "Deliver a package across the city.",
    min: 800,
    max: 1500,
    bonusChance: 0.06,
    bonusMin: 1000,
    bonusMax: 2500,
    successLines: [
      "Smooth delivery. No drama, easy money.",
      "Traffic was cooked, but you made it on time.",
      "Customer tipped you for the hustle.",
    ],
    bonusLines: [
      "Big tip day. Somebody’s feeling generous!",
      "VIP delivery — you got paid extra.",
    ],
  },
  {
    id: "fishing",
    name: "🎣 Fishing Trip",
    desc: "Cast a line and see what bites.",
    min: 500,
    max: 1200,
    bonusChance: 0.04,
    bonusMin: 1500,
    bonusMax: 4000,
    successLines: [
      "Decent haul. Fresh fish, fresh cash.",
      "You didn’t catch a monster, but you sold enough.",
      "Quiet waters, steady profit.",
    ],
    bonusLines: [
      "You pulled a rare one — collectors paid up.",
      "Legendary catch! That’s rent money.",
    ],
  },
  {
    id: "mining",
    name: "⛏️ Mining Shift",
    desc: "Chip away at rock for ore and valuables.",
    min: 900,
    max: 1800,
    bonusChance: 0.05,
    bonusMin: 2000,
    bonusMax: 5000,
    successLines: [
      "Ore prices were good today. Nice work.",
      "Solid run — you filled a few crates.",
      "Dusty, loud, profitable.",
    ],
    bonusLines: [
      "You hit a gem vein! Jackpot.",
      "Rare find — you sold it immediately.",
    ],
  },
];
/* ============================================================ */

function randInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildJobMenuEmbed(user) {
  const embed = new EmbedBuilder()
    .setTitle("🧰 Job Board")
    .setDescription(
      [
        `Pick a job to do right now, **${user.username}**.`,
        `Payouts are instant. Cooldown: **${JOB_COOLDOWN_SECONDS}s**.`,
        "",
        ...JOBS.map(j => `**${j.name}** — ${j.desc}`),
      ].join("\n")
    )
    .setFooter({ text: "Tip: Add more jobs in commands/job.js → JOBS[]" });

  return embed;
}

function buildJobButtons(disabled = false) {
  // Discord allows max 5 buttons per row, so keep jobs <= 5 per row or add another row.
  const row = new ActionRowBuilder();
  for (const j of JOBS.slice(0, 5)) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`job_pick:${j.id}`)
        .setLabel(j.name)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled)
    );
  }

  // Optional cancel button if there’s space
  if (JOBS.length < 5) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId("job_pick:cancel")
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled)
    );
  }

  return [row];
}

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
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (guild_id, user_id, key)
     DO UPDATE SET next_claim_at=EXCLUDED.next_claim_at`,
    [guildId, userId, key, nextClaim]
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("job")
    .setDescription("Pick a job to do for quick money."),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.inGuild()) return interaction.editReply("❌ Server only.");

    // 🚔 Jail gate
    if (await guardNotJailed(interaction)) return;

    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    await ensureUser(guildId, userId);

    // Cooldown check
    const key = "job";
    const now = new Date();
    const next = await getCooldown(guildId, userId, key);
    if (next && now < next) {
      const unix = Math.floor(next.getTime() / 1000);
      return interaction.editReply(`⏳ You’ve already worked recently. Come back <t:${unix}:R>.`);
    }

    // Set cooldown immediately so users can’t spam rerolls by reopening /job
    const nextClaim = new Date(Date.now() + JOB_COOLDOWN_SECONDS * 1000);
    await setCooldown(guildId, userId, key, nextClaim);

    const menuEmbed = buildJobMenuEmbed(interaction.user);

    // NOTE: We send a *public* message for buttons/collector reliability,
    // and auto-delete it to avoid chat spam.
    const menuMsg = await interaction.channel.send({
      embeds: [menuEmbed],
      components: buildJobButtons(false),
    });

    await interaction.editReply("✅ Job board posted. Pick one from the buttons (message will auto-delete).");

    const collector = menuMsg.createMessageComponentCollector({ time: 60_000 });

    collector.on("collect", async (btn) => {
      try {
        // Only the caller can use this job menu
        if (btn.user.id !== userId) {
          return btn.reply({ content: "❌ This job board isn’t for you.", flags: MessageFlags.Ephemeral }).catch(() => {});
        }

        await btn.deferUpdate().catch(() => {});
        const [, choice] = btn.customId.split(":");

        if (choice === "cancel") {
          collector.stop("cancelled");
          return;
        }

        const job = JOBS.find(j => j.id === choice);
        if (!job) {
          collector.stop("invalid");
          return;
        }

        // Roll payout
        let amount = randInt(job.min, job.max);
        let line = pick(job.successLines);

        // Bonus roll
        if (job.bonusChance && Math.random() < job.bonusChance) {
          const bonus = randInt(job.bonusMin ?? 0, job.bonusMax ?? 0);
          amount += bonus;
          line = `✨ ${pick(job.bonusLines)} (+$${bonus.toLocaleString()})`;
        }

        // Mint to user (NOT bank)
        await creditUser(guildId, userId, amount, `job_${job.id}`, {
          job: job.id,
          reset: `${JOB_COOLDOWN_SECONDS}s`,
        });

        const resultEmbed = new EmbedBuilder()
          .setTitle(job.name)
          .setDescription(
            [
              line,
              "",
              `✅ You earned **$${amount.toLocaleString()}**`,
              `⏳ Next /job: <t:${Math.floor(nextClaim.getTime() / 1000)}:R>`,
            ].join("\n")
          )
          .setFooter({ text: `Job ID: ${job.id}` });

        // Disable buttons + show result
        await menuMsg.edit({
          embeds: [resultEmbed],
          components: buildJobButtons(true),
        }).catch(() => {});

        collector.stop("done");
      } catch (e) {
        console.error("/job button error:", e);
        collector.stop("error");
      }
    });

    collector.on("end", async () => {
      // Auto-delete after a short delay to keep chat clean
      setTimeout(() => menuMsg.delete().catch(() => {}), 10_000);
    });
  },
};
