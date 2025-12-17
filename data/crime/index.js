// data/crime/index.js
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require("discord.js");

const { pool } = require("../../utils/db");
const { guardNotJailedComponent } = require("../../utils/jail"); // blocks while jailed :contentReference[oaicite:1]{index=1}

const startStoreRobbery = require("./storeRobbery");

// Keys
const KEY_GLOBAL = "crime_global";
const KEY_STORE = "crime_store";
const KEY_CHASE = "crime_chase";
const KEY_DRUGS = "crime_drugs";
const KEY_HEIST = "crime_heist";
const KEY_HEIST_MAJOR = "crime_heist_major";

// Labels
const LABELS = {
  store: "🏪 Store Robbery",
  chase: "🚗 Car Chase",
  drugs: "💊 Drug Pushing (Soon)",
  heist: "🏦 Heist",
  major: "💰 Major Heist",
  back: "⬅️ Back",
  stop: "🛑 Stop",
};

function now() {
  return new Date();
}

function toUnix(date) {
  return Math.floor(date.getTime() / 1000);
}

async function getCooldownUntil(guildId, userId, key) {
  const res = await pool.query(
    `SELECT next_claim_at FROM cooldowns
     WHERE guild_id=$1 AND user_id=$2 AND key=$3`,
    [guildId, userId, key]
  );
  if (res.rowCount === 0) return null;

  const dt = new Date(res.rows[0].next_claim_at);
  if (Number.isNaN(dt.getTime())) return null;
  if (now() >= dt) return null;
  return dt;
}

function buildCooldownBlockEmbed(title, lines) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(lines.join("\n"))
    .setColor(0xcc4444);
}

function crimeMenuEmbed() {
  return new EmbedBuilder()
    .setTitle("🕶️ Crime")
    .setDescription(
      [
        "Choose your poison.",
        "",
        "⚠️ **Heat lingers** (Crime-only).",
        "🚔 **Jail disables all jobs**.",
        "",
        "Tip: Big scores have big timers.",
      ].join("\n")
    )
    .setColor(0x2b2d31);
}

function crimeMenuComponents() {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("crime:store")
      .setLabel(LABELS.store)
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("crime:chase")
      .setLabel(LABELS.chase)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("crime:drugs")
      .setLabel(LABELS.drugs)
      .setStyle(ButtonStyle.Secondary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("crime:heist")
      .setLabel(LABELS.heist)
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("crime:major")
      .setLabel(LABELS.major)
      .setStyle(ButtonStyle.Danger)
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("crime:back")
      .setLabel(LABELS.back)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("crime:stop")
      .setLabel(LABELS.stop)
      .setStyle(ButtonStyle.Secondary)
  );

  return [row1, row2, row3];
}

/**
 * Enforces:
 * - global crime lockout (crime_global)
 * - job-specific lockout (e.g. crime_store)
 * Returns { ok: true } or { ok: false, embed } to show block reason.
 */
async function checkCrimeCooldowns(guildId, userId, jobKey, jobLabel) {
  const globalUntil = await getCooldownUntil(guildId, userId, KEY_GLOBAL);
  const jobUntil = await getCooldownUntil(guildId, userId, jobKey);

  if (!globalUntil && !jobUntil) return { ok: true };

  const lines = [];
  lines.push(`You can’t start **${jobLabel}** right now.`);

  if (globalUntil) {
    lines.push(`⏳ **Crime lockout:** <t:${toUnix(globalUntil)}:R>`);
  }
  if (jobUntil) {
    lines.push(`⏱️ **${jobLabel} cooldown:** <t:${toUnix(jobUntil)}:R>`);
  }

  lines.push("");
  lines.push("Try again later.");

  return {
    ok: false,
    embed: buildCooldownBlockEmbed("🚫 Crime Cooldown", lines),
  };
}

/**
 * Hook point for lingering heat.
 * For now returns 0 until you add persistence (table/column).
 * When you’re ready, we’ll store heat with an expiry timestamp.
 */
async function getLingeringHeat(_guildId, _userId) {
  return 0;
}

/**
 * Entrypoint: show Crime menu and handle buttons.
 *
 * @param {import('discord.js').CommandInteraction} interaction - the /job interaction (already deferred)
 * @param {object} options
 * @param {function=} options.onBack - function to render previous job hub menu
 */
module.exports = async function showCrimeMenu(interaction, options = {}) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;

  // Initial render
  await interaction.editReply({
    embeds: [crimeMenuEmbed()],
    components: crimeMenuComponents(),
  });

  const msg = await interaction.fetchReply();

  const collector = msg.createMessageComponentCollector({
    time: 3 * 60 * 1000,
  });

  collector.on("collect", async (btn) => {
    if (btn.user.id !== userId) {
      return btn.reply({ content: "This isn’t your menu.", ephemeral: true });
    }

    // Jail blocks ALL jobs
    if (await guardNotJailedComponent(btn)) {
      collector.stop("jailed");
      return;
    }

    await btn.deferUpdate();

    const id = btn.customId;

    // Navigation
    if (id === "crime:stop") {
      collector.stop("stop");
      return interaction.editReply({
        content: "🛑 Stopped.",
        embeds: [],
        components: [],
      });
    }

    if (id === "crime:back") {
      collector.stop("back");
      if (typeof options.onBack === "function") {
        return options.onBack(interaction);
      }
      // Fallback: just redraw crime menu (if no back handler provided)
      return interaction.editReply({
        embeds: [crimeMenuEmbed()],
        components: crimeMenuComponents(),
      });
    }

    // Job: Store Robbery (LIVE)
    if (id === "crime:store") {
      const cd = await checkCrimeCooldowns(guildId, userId, KEY_STORE, "Store Robbery");
      if (!cd.ok) {
        return interaction.editReply({
          embeds: [cd.embed],
          components: crimeMenuComponents(),
        });
      }

      const lingeringHeat = await getLingeringHeat(guildId, userId);

      collector.stop("start_store");
      return startStoreRobbery(interaction, {
        lingeringHeat,
        // Later we can pass:
        // onStoreRobberyComplete: async ({ outcome, finalHeat, ... }) => { ...persist lingering heat... }
      });
    }

    // Job: Car Chase (placeholder for now)
    if (id === "crime:chase") {
      const cd = await checkCrimeCooldowns(guildId, userId, KEY_CHASE, "Car Chase");
      if (!cd.ok) {
        return interaction.editReply({
          embeds: [cd.embed],
          components: crimeMenuComponents(),
        });
      }

      const embed = new EmbedBuilder()
        .setTitle("🚗 Car Chase")
        .setDescription("Coming soon. This will be a multi-tier car boosting/chase minigame.")
        .setColor(0x2b2d31);

      return interaction.editReply({ embeds: [embed], components: crimeMenuComponents() });
    }

    // Job: Drug Pushing (placeholder)
    if (id === "crime:drugs") {
      const embed = new EmbedBuilder()
        .setTitle("💊 Drug Pushing")
        .setDescription(
          [
            "**Placeholder for now.**",
            "",
            "Planned: linked storage system (buy/grow stock) + outcomes that affect cooldowns.",
            "Confiscation will be a major mechanic here later.",
          ].join("\n")
        )
        .setColor(0x2b2d31);

      return interaction.editReply({ embeds: [embed], components: crimeMenuComponents() });
    }

    // Job: Heist (placeholder)
    if (id === "crime:heist") {
      const cd = await checkCrimeCooldowns(guildId, userId, KEY_HEIST, "Heist");
      if (!cd.ok) {
        return interaction.editReply({
          embeds: [cd.embed],
          components: crimeMenuComponents(),
        });
      }

      const embed = new EmbedBuilder()
        .setTitle("🏦 Heist")
        .setDescription("Coming soon. 6–10 steps, high risk, 12-hour cooldown.")
        .setColor(0x2b2d31);

      return interaction.editReply({ embeds: [embed], components: crimeMenuComponents() });
    }

    // Job: Major Heist (placeholder)
    if (id === "crime:major") {
      const cd = await checkCrimeCooldowns(guildId, userId, KEY_HEIST_MAJOR, "Major Heist");
      if (!cd.ok) {
        return interaction.editReply({
          embeds: [cd.embed],
          components: crimeMenuComponents(),
        });
      }

      const embed = new EmbedBuilder()
        .setTitle("💰 Major Heist")
        .setDescription("Coming soon. 8–15 steps, brutal risk, 24-hour cooldown.")
        .setColor(0x2b2d31);

      return interaction.editReply({ embeds: [embed], components: crimeMenuComponents() });
    }
  });

  collector.on("end", async (_collected, reason) => {
    if (reason === "stop" || reason === "back" || reason.startsWith("start_") || reason === "jailed") return;

    // Inactivity cleanup – match your “auto-clear after 3 mins” behavior
    try {
      await interaction.editReply({
        content: "⏱️ Crime menu expired.",
        embeds: [],
        components: [],
      });
    } catch (_) {}
  });
};
