const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  StringSelectMenuBuilder,
} = require("discord.js");

const ui = require("../../utils/ui");
const { renderProgressBar } = require("../../utils/progressBar");

function safeDesc(s) {
  const t = String(s ?? "").trim();
  if (!t) return "";
  if (t.length <= 100) return t;
  return t.slice(0, 97) + "...";
}

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
          "🔥 Heat: **0** / 100",
          `${heatBar(0)}`,
          "🧊 Cooling down: Ready",
        ].join("\n");

  const effectiveCooldown = (jobCd, globalCd) => {
    if (!globalCd) return jobCd;
    if (!jobCd) return globalCd;
    return Math.max(jobCd, globalCd);
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
    .setColor(ui.systems.job.color)
    .setFooter({ text: "Crime cooldowns are separate from the /job payout cooldown." });
}

function buildCrimeComponents(disabled = false) {
  const catRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("job_select:category")
      .setPlaceholder("Choose a category...")
      .addOptions(
        { label: "Work a 9-5", value: "job_cat:95", emoji: "📦" },
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
    new ButtonBuilder()
      .setCustomId("job_back:hub")
      .setLabel(ui.nav.back.label)
      .setEmoji(ui.nav.back.emoji)
      .setStyle(ui.nav.back.style)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId("job_home")
      .setLabel(ui.nav.home.label)
      .setEmoji(ui.nav.home.emoji)
      .setStyle(ui.nav.home.style)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId("job_stop")
      .setLabel(ui.nav.close.label)
      .setEmoji(ui.nav.close.emoji)
      .setStyle(ui.nav.close.style)
      .setDisabled(disabled)
  );

  return [catRow, jobRow, navRow];
}

module.exports = {
  buildCrimeEmbed,
  buildCrimeComponents,
};
