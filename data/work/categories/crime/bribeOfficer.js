const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} = require("discord.js");

const path = require("path");
const { pool } = require(path.join(process.cwd(), "utils", "db"));
const { tryDebitUser, addServerBank } = require(path.join(process.cwd(), "utils", "economy"));
const { setJail } = require(path.join(process.cwd(), "utils", "jail"));
const { getCrimeHeat, setCrimeHeat } = require(path.join(process.cwd(), "utils", "crimeHeat"));

const CRIME_KEY = "crime_bribe_officer";
const COOLDOWN_MINUTES = 30;
const HEAT_TTL_MINUTES = 12 * 60;
const RESULTS_LINGER_MS = 10_000;

const TARGETS = {
  patrol: {
    id: "patrol",
    label: "Patrol Officer",
    description: "Cheap, common, unreliable.",
    success: { low: 0.58, medium: 0.72, high: 0.82 },
    heatDrop: { low: [5, 7], medium: [8, 12], high: [12, 16] },
    failHeat: [5, 10],
    jailChance: 0.01,
  },
  evidence: {
    id: "evidence",
    label: "Evidence Clerk",
    description: "High reward, moderate risk.",
    success: { low: 0.34, medium: 0.56, high: 0.72 },
    heatDrop: { low: [10, 14], medium: [18, 24], high: [28, 35] },
    failHeat: [7, 12],
    jailChance: 0.025,
  },
  sergeant: {
    id: "sergeant",
    label: "Desk Sergeant",
    description: "Balanced option.",
    success: { low: 0.46, medium: 0.66, high: 0.80 },
    heatDrop: { low: [7, 10], medium: [14, 20], high: [22, 28] },
    failHeat: [5, 10],
    jailChance: 0.015,
  },
};

const TIERS = {
  low: { id: "low", label: "Low", amount: 5_000 },
  medium: { id: "medium", label: "Medium", amount: 12_500 },
  high: { id: "high", label: "High", amount: 25_000 },
};

function randInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function setCooldown(guildId, userId) {
  const next = new Date(Date.now() + COOLDOWN_MINUTES * 60_000);
  await pool.query(
    `INSERT INTO cooldowns (guild_id, user_id, key, next_claim_at)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (guild_id, user_id, key)
     DO UPDATE SET next_claim_at = EXCLUDED.next_claim_at`,
    [guildId, userId, CRIME_KEY, next]
  );
}

function buildTargetEmbed(heat) {
  return new EmbedBuilder()
    .setTitle("💸 Bribe The Officer")
    .setDescription(
      [
        "You're looking to make a problem disappear. Who do you approach?",
        "",
        `Current heat: **${heat}/100**`,
      ].join("\n")
    )
    .setColor(0xb8860b);
}

function targetComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("bribe:target")
        .setPlaceholder("Choose a target...")
        .addOptions(
          Object.values(TARGETS).map((target) => ({
            label: target.label,
            value: target.id,
            description: target.description,
          }))
        )
    ),
  ];
}

function buildTierEmbed(target, heat) {
  return new EmbedBuilder()
    .setTitle("💸 Bribe The Officer")
    .setDescription(
      [
        `Target: **${target.label}**`,
        target.description,
        "",
        `Current heat: **${heat}/100**`,
        "How much are you willing to offer?",
      ].join("\n")
    )
    .setColor(0xb8860b);
}

function tierComponents(targetId) {
  return [
    new ActionRowBuilder().addComponents(
      Object.values(TIERS).map((tier) =>
        new ButtonBuilder()
          .setCustomId(`bribe:tier:${targetId}:${tier.id}`)
          .setLabel(`${tier.label} ($${tier.amount.toLocaleString()})`)
          .setStyle(tier.id === "high" ? ButtonStyle.Success : ButtonStyle.Primary)
      )
    ),
  ];
}

module.exports = function startBribeOfficer(interaction, context = {}) {
  return new Promise(async (resolve) => {
    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    let heat = Math.max(0, Math.min(100, Number(context.lingeringHeat ?? await getCrimeHeat(guildId, userId)) || 0));
    let selectedTarget = null;
    let done = false;

    const finishOnce = () => {
      if (done) return;
      done = true;
      resolve();
    };

    const message = await interaction.fetchReply();
    const collector = message.createMessageComponentCollector({ time: 90_000 });

    await interaction.editReply({
      content: null,
      embeds: [buildTargetEmbed(heat)],
      components: targetComponents(),
    });

    collector.on("collect", async (i) => {
      if (i.user.id !== userId) {
        return i.reply({ content: "❌ Not your bribe.", flags: 64 }).catch(() => {});
      }

      await i.deferUpdate().catch(() => {});

      if (i.customId === "bribe:target") {
        const targetId = i.values?.[0];
        selectedTarget = TARGETS[targetId] || null;
        if (!selectedTarget) return;
        await interaction.editReply({
          embeds: [buildTierEmbed(selectedTarget, heat)],
          components: tierComponents(selectedTarget.id),
        }).catch(() => {});
        return;
      }

      if (!i.customId.startsWith("bribe:tier:")) return;
      const [, , targetId, tierId] = i.customId.split(":");
      const target = TARGETS[targetId] || selectedTarget;
      const tier = TIERS[tierId];
      if (!target || !tier) return;

      const debit = await tryDebitUser(guildId, userId, tier.amount, "crime_bribe_officer", {
        target: target.id,
        tier: tier.id,
        source: "wallet",
      });

      if (!debit.ok) {
        collector.stop("done");
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle("💸 Bribe The Officer")
              .setDescription(`❌ You need **$${tier.amount.toLocaleString()}** in your wallet for that offer.`)
              .setColor(0xaa0000),
          ],
          components: [],
        }).catch(() => {});
        setTimeout(finishOnce, RESULTS_LINGER_MS);
        return;
      }

      await setCooldown(guildId, userId);

      await addServerBank(guildId, tier.amount, "crime_bribe_officer_bank", {
        target: target.id,
        tier: tier.id,
        userId,
      }).catch(() => {});

      const trustedContact = Math.random() < 0.08;
      const successChance = Math.min(0.95, Number(target.success[tier.id] || 0) + (trustedContact ? 0.12 : 0));
      const success = Math.random() < successChance;
      const lines = [
        trustedContact ? "A trusted contact vouches for you before the meet." : pick([
          "They glance around before answering.",
          "The room gets very quiet.",
          "You slide the offer across and wait.",
        ]),
      ];

      if (success) {
        const [min, max] = target.heatDrop[tier.id];
        const drop = randInt(min, max);
        heat = Math.max(0, heat - drop);
        await setCrimeHeat(guildId, userId, heat, HEAT_TTL_MINUTES);
        lines.push(`✅ The bribe lands. Heat reduced by **${drop}%**.`);
      } else {
        const [min, max] = target.failHeat;
        const gain = randInt(min, max);
        heat = Math.min(100, heat + gain);
        await setCrimeHeat(guildId, userId, heat, HEAT_TTL_MINUTES);
        lines.push(`❌ They take the money, but the room turns hostile. Heat increased by **${gain}%**.`);
        if (Math.random() < target.jailChance) {
          const minutes = randInt(5, 15);
          await setJail(guildId, userId, minutes).catch(() => {});
          lines.push(`⛓️ The setup snaps shut. You were jailed for **${minutes} minutes**.`);
        }
      }

      collector.stop("done");
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("💸 Bribe The Officer")
            .setDescription(lines.join("\n"))
            .addFields(
              { name: "Target", value: target.label, inline: true },
              { name: "Offer", value: `$${tier.amount.toLocaleString()}`, inline: true },
              { name: "Heat", value: `${heat}/100`, inline: true }
            )
            .setColor(success ? 0x22aa55 : 0xaa0000),
        ],
        components: [],
      }).catch(() => {});
      setTimeout(finishOnce, RESULTS_LINGER_MS);
    });

    collector.on("end", async (_, reason) => {
      if (done || reason === "done") return;
      await interaction.editReply({
        content: "⏱️ You hesitated too long. The contact disappears.",
        embeds: [],
        components: [],
      }).catch(() => {});
      finishOnce();
    });
  });
};
