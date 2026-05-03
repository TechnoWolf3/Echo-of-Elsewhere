const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require("discord.js");

const nightWalker = require("../../data/work/categories/nightwalker/index");
const ui = require("../../utils/ui");

function xpToNext(level) {
  return 100 + (Math.max(1, level) - 1) * 60;
}

function levelMultiplier(level) {
  const mult = 1 + 0.02 * (Math.max(1, level) - 1);
  return Math.min(mult, 1.6);
}

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

function availabilityLine(unixTs) {
  return unixTs ? `⏳ Available <t:${unixTs}:R>` : "✅ Available now";
}

function buildNightWalkerEmbed(user, progress, cooldowns = {}) {
  const need = xpToNext(progress.level);
  const mult = levelMultiplier(progress.level);
  const bonusPct = Math.round((mult - 1) * 100);

  const list = nightWalker?.list || [];
  const jobs = nightWalker?.jobs || {};
  const lines = list
    .map((key) => {
      const cfg = jobs[key];
      if (!cfg) return null;
      return [
        `• **${cfg.title || key}** - ${cfg.rounds ? `${cfg.rounds} rounds` : "interactive"}`,
        availabilityLine(cooldowns[key]),
      ].join("\n");
    })
    .filter(Boolean)
    .join("\n\n");

  return new EmbedBuilder()
    .setTitle(nightWalker.category?.title || "🧠 Night Walker")
    .setDescription(nightWalker.category?.description || "")
    .addFields(
      { name: "Progress", value: `Level ${progress.level} - XP ${progress.xp}/${need} - Bonus +${bonusPct}%` },
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
        { label: "Work a 9-5", value: "job_cat:95", emoji: "📦" },
        { label: "Night Walker", value: "job_cat:nw", emoji: "🧠", default: true },
        { label: "Grind", value: "job_cat:grind", emoji: "🕒" },
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

  const list = nightWalker?.list || Object.keys(nightWalker?.jobs || {});
  for (const key of list) {
    const cfg = nightWalker?.jobs?.[key];
    if (!cfg) continue;
    jobMenu.addOptions({
      label: safeLabel(cfg.title || key),
      value: `job_nw:${key}`,
      description: cfg.desc ? safeDesc(cfg.desc) : undefined,
      emoji: (cfg.title || "🧠").split(" ")[0] || "🧠",
    });
  }

  const jobRow = new ActionRowBuilder().addComponents(jobMenu);

  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("job_back:hub").setLabel(ui.nav.back.label).setEmoji(ui.nav.back.emoji).setStyle(ui.nav.back.style).setDisabled(disabled),
    new ButtonBuilder().setCustomId("job_home").setLabel(ui.nav.home.label).setEmoji(ui.nav.home.emoji).setStyle(ui.nav.home.style).setDisabled(disabled),
    new ButtonBuilder().setCustomId("job_stop").setLabel(ui.nav.close.label).setEmoji(ui.nav.close.emoji).setStyle(ui.nav.close.style).setDisabled(disabled)
  );

  return [catRow, jobRow, navRow];
}

function buildNWRoundEmbed({ title, round, rounds, prompt, statusLines = [] }) {
  return new EmbedBuilder()
    .setTitle(`${title} - Round ${round}/${rounds}`)
    .setDescription([prompt, "", ...statusLines].filter(Boolean).join("\n"));
}

function buildNWChoiceComponents({ jobKey, roundIndex, choices, disabled = false }) {
  const row = new ActionRowBuilder();
  choices.slice(0, 5).forEach((choice, idx) => {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`nw:${jobKey}:${roundIndex}:${idx}`)
        .setLabel(safeLabel(choice.label))
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled)
    );
  });

  return [
    row,
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("job_back:nw").setLabel(ui.nav.back.label).setEmoji(ui.nav.back.emoji).setStyle(ui.nav.back.style).setDisabled(disabled),
      new ButtonBuilder().setCustomId("job_stop").setLabel("Stop Work").setStyle(ButtonStyle.Danger).setDisabled(disabled)
    ),
  ];
}

module.exports = {
  buildNightWalkerEmbed,
  buildNightWalkerComponents,
  buildNWRoundEmbed,
  buildNWChoiceComponents,
};
