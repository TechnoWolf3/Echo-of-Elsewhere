const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  StringSelectMenuBuilder,
} = require("discord.js");

const grindIndex = require("../../data/work/categories/grind/index");
const { fatigueBar: grindFatigueBar } = require("../../utils/grindFatigue");
const { renderProgressBar } = require("../../utils/progressBar");
const ui = require("../../utils/ui");

function safeLabel(s) {
  const t = String(s ?? "").trim();
  if (t.length <= 80) return t;
  return t.slice(0, 77) + "...";
}

function safeDesc(s) {
  const t = String(s ?? "").trim();
  if (!t) return "";
  if (t.length <= 100) return t;
  return t.slice(0, 97) + "...";
}

function progressBar(value, size = 10) {
  return renderProgressBar(value, 100, { length: size });
}

function cdLine(label, unixTs) {
  return unixTs ? `⏳ ${label}: <t:${unixTs}:R>` : `✅ ${label}: Ready`;
}

function buildGrindEmbed({ fatigueInfo, cooldowns = {} } = {}) {
  const list = grindIndex?.list || [];
  const jobs = grindIndex?.jobs || {};

  const lines = list
    .map((key) => {
      const cfg = jobs[key];
      if (!cfg) return null;
      return [
        `• **${cfg.title || key}** - ${cfg.desc || ""}`,
        cdLine("Available", cooldowns[key]),
      ].join("\n").trim();
    })
    .filter(Boolean)
    .join("\n\n");

  const fatigueMs = Number(fatigueInfo?.fatigueMs || 0);
  const fb = grindFatigueBar ? grindFatigueBar(fatigueMs) : { pct: 0, bar: "" };
  const lockUnix = fatigueInfo?.lockedUntil
    ? Math.floor(new Date(fatigueInfo.lockedUntil).getTime() / 1000)
    : null;

  const fatigueBlock = lockUnix
    ? [
        `🧠 Fatigue: **${fb.pct}** / 100`,
        `${progressBar(fb.pct)}`,
        `🧃 Recovering: <t:${lockUnix}:R>`,
      ].join("\n")
    : [
        `🧠 Fatigue: **${fb.pct}** / 100`,
        `${progressBar(fb.pct)}`,
        `🧃 Recovering: ${fatigueInfo?.exhausted ? "Exhausted (rest a bit)" : "Ready"}`,
      ].join("\n");

  return new EmbedBuilder()
    .setTitle(grindIndex.category?.title || "🕒 Grind")
    .setDescription(
      [
        "Pick a job. Fatigue only affects **Grind** jobs.",
        "",
        fatigueBlock,
      ].join("\n")
    )
    .addFields({ name: "Jobs", value: lines || "No jobs configured." })
    .setColor(ui.systems.job.color)
    .setFooter({ text: grindIndex.category?.footer || "Fatigue is shared across all Grind jobs." });
}

function buildGrindComponents(disabled = false) {
  const catRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("job_select:category")
      .setPlaceholder("Choose a category...")
      .addOptions(
        { label: "Work a 9-5", value: "job_cat:95", emoji: "📦" },
        { label: "Night Walker", value: "job_cat:nw", emoji: "🧠" },
        { label: "Grind", value: "job_cat:grind", emoji: "🕒", default: true },
        { label: "Crime", value: "job_cat:crime", emoji: "🕶️" },
        { label: "Enterprises", value: "job_cat:enterprises", emoji: "🏭" },
        { label: "The Underworld", value: "job_cat:underworld", emoji: "🕶️" }
      )
      .setDisabled(disabled)
  );

  const jobMenu = new StringSelectMenuBuilder()
    .setCustomId("job_select:job")
    .setPlaceholder("Choose a job...")
    .setDisabled(disabled);

  const list = grindIndex?.list || [];
  const jobs = grindIndex?.jobs || {};
  for (const key of list) {
    const cfg = jobs[key];
    if (!cfg) continue;
    jobMenu.addOptions({
      label: safeLabel(cfg.title || key),
      value: cfg.buttonId || `grind:${key}`,
      description: cfg.desc ? safeDesc(cfg.desc) : undefined,
      emoji: (cfg.title || "🕒").split(" ")[0] || "🕒",
    });
  }

  const jobRow = new ActionRowBuilder().addComponents(jobMenu);

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
  buildGrindEmbed,
  buildGrindComponents,
};
