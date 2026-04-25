const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require("discord.js");

const nineToFiveIndex = require("../../data/work/categories/nineToFive/index");
const contractCfg = require("../../data/work/categories/nineToFive/transportContract");
const skillCfg = require("../../data/work/categories/nineToFive/skillCheck");
const shiftCfg = require("../../data/work/categories/nineToFive/shift");
const truckerCfg = require("../../data/work/categories/nineToFive/trucker");
const { emailSorterCfg, folderMeta } = require("./emailSorter");
const { renderProgressBar } = require("../../utils/progressBar");
const ui = require("../../utils/ui");

function xpToNext(level) {
  return 100 + (Math.max(1, level) - 1) * 60;
}

function levelMultiplier(level) {
  const mult = 1 + 0.02 * (Math.max(1, level) - 1);
  return Math.min(mult, 1.6);
}

function randInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function sampleUnique(arr, n) {
  const copy = [...arr];
  const out = [];
  while (copy.length && out.length < n) {
    out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
  }
  return out;
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

function progressBar(pct, size = 16) {
  return renderProgressBar(pct, 100, { length: size });
}

function statusLineFromCooldown(cooldownUnix) {
  return cooldownUnix ? `⏳ Next payout: <t:${cooldownUnix}:R>` : "✅ Ready for payout.";
}

function buildNineToFiveEmbed(user, progress, cooldownUnix) {
  const need = xpToNext(progress.level);
  const mult = levelMultiplier(progress.level);
  const bonusPct = Math.round((mult - 1) * 100);

  const jobLines = nineToFiveIndex.jobs
    .map((job) => `${job.title} - ${job.desc}`)
    .join("\n");

  return new EmbedBuilder()
    .setTitle(nineToFiveIndex.category?.title || "📦 Work a 9-5")
    .setDescription([statusLineFromCooldown(cooldownUnix), "", nineToFiveIndex.category?.description || ""].join("\n").trim())
    .addFields(
      { name: "Progress", value: `Level ${progress.level} - XP ${progress.xp}/${need} - Bonus +${bonusPct}%` },
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
        { label: "Work a 9-5", value: "job_cat:95", emoji: "📦", default: true },
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

  for (const job of nineToFiveIndex.jobs) {
    jobMenu.addOptions({
      label: safeLabel(job.title || job.key),
      value: job.button.id,
      description: job.desc ? safeDesc(job.desc) : undefined,
      emoji: (job.button?.label || "").split(" ")[0] || "🧩",
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
    new ButtonBuilder().setCustomId("job_back:hub").setLabel(ui.nav.back.label).setEmoji(ui.nav.back.emoji).setStyle(ui.nav.back.style).setDisabled(disabled),
    new ButtonBuilder().setCustomId("job_home").setLabel(ui.nav.home.label).setEmoji(ui.nav.home.emoji).setStyle(ui.nav.home.style).setDisabled(disabled),
    new ButtonBuilder().setCustomId("job_stop").setLabel(ui.nav.close.label).setEmoji(ui.nav.close.emoji).setStyle(ui.nav.close.style).setDisabled(disabled)
  );

  return [catRow, jobRow, navRow];
}

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
      choices.map((choice) => ({
        name: choice.label,
        value: `Bonus: +$${choice.modMin}-$${choice.modMax} | Risk: ${(choice.risk * 100).toFixed(0)}%`,
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

  for (const choice of choices) {
    if (row.components.length >= 5) {
      rows.push(row);
      row = new ActionRowBuilder();
    }
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`job_contract:${stepIndex}:${choice.label}`)
        .setLabel(safeLabel(choice.label))
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled)
    );
  }
  rows.push(row);

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("job_back:95").setLabel(ui.nav.back.label).setEmoji(ui.nav.back.emoji).setStyle(ui.nav.back.style).setDisabled(disabled),
      new ButtonBuilder().setCustomId("job_stop").setLabel("🛑 Stop Work").setStyle(ButtonStyle.Danger).setDisabled(disabled)
    )
  );

  return rows;
}

function buildSkillEmbed(title, targetEmoji, expiresAtMs, { revealPattern = Array.isArray(targetEmoji), progress = 0, total = 1 } = {}) {
  const unix = Math.floor(expiresAtMs / 1000);
  const pattern = Array.isArray(targetEmoji) ? targetEmoji : [targetEmoji];
  const prompt = revealPattern
    ? `Memorise this pattern:\n\n${pattern.join(" ")}`
    : `Repeat the colour pattern from memory.\nProgress: **${progress}/${total || pattern.length}**`;
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(`${prompt}\n⏳ Ends: <t:${unix}:R>`)
    .setFooter({ text: "Failing doesn't pay, but browsing is still allowed." });
}

function buildSkillButtons(targetEmoji, disabled = false, prefix = "job_skill") {
  const targets = Array.isArray(targetEmoji) ? targetEmoji : [targetEmoji];
  const options = skillCfg.emojis.length <= 5
    ? [...skillCfg.emojis]
    : sampleUnique([...new Set([...targets, ...sampleUnique(skillCfg.emojis.filter((emoji) => !targets.includes(emoji)), 5)])], 5);
  const row = new ActionRowBuilder();

  for (const emoji of options) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${prefix}:${emoji}`)
        .setLabel(emoji)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled)
    );
  }

  return [
    row,
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("job_back:95").setLabel(ui.nav.back.label).setEmoji(ui.nav.back.emoji).setStyle(ui.nav.back.style).setDisabled(disabled),
      new ButtonBuilder().setCustomId("job_stop").setLabel("🛑 Stop Work").setStyle(ButtonStyle.Danger).setDisabled(disabled)
    ),
  ];
}

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
      ].filter(Boolean).join("\n")
    )
    .setFooter({ text: shiftCfg.footer || "Stay on the board. Collect when ready." });
}

function buildShiftButtons({ canCollect = false, disabled = false } = {}) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("job_shift_collect")
        .setLabel("💵 Collect Pay")
        .setStyle(ButtonStyle.Success)
        .setDisabled(disabled || !canCollect)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("job_back:95").setLabel(ui.nav.back.label).setEmoji(ui.nav.back.emoji).setStyle(ui.nav.back.style).setDisabled(disabled),
      new ButtonBuilder().setCustomId("job_stop").setLabel("🛑 Stop Work").setStyle(ButtonStyle.Danger).setDisabled(disabled)
    ),
  ];
}

function formatRoutePlace(place) {
  return `${place.city}, ${place.state}`;
}

function durationMinutesForRoute(distanceKm) {
  const km = Math.max(1, Math.round(Number(distanceKm) || 1));
  const minutesPerKm = Number(truckerCfg.duration?.minutesPerKm || 0.01);
  const minMinutes = Number(truckerCfg.duration?.minMinutes || 3);
  return Math.max(minMinutes, Math.ceil(km * minutesPerKm));
}

function generateTruckerManifest() {
  const route = pick(truckerCfg.routes || []);
  const freightEntry = pick(truckerCfg.freightPool || []);
  const freightName = typeof freightEntry === "string" ? freightEntry : (freightEntry?.name || "General Freight");
  const freightCategory = typeof freightEntry === "string" ? "generalPalletised" : (freightEntry?.category || "generalPalletised");
  const payoutModifier = truckerCfg.payout?.useFreightModifiers === false
    ? 1
    : Math.max(0.5, Number(freightEntry?.payoutModifier ?? 1));
  const compatibleTrailers = Array.isArray(truckerCfg.trailerConfigs?.[freightCategory])
    ? truckerCfg.trailerConfigs[freightCategory]
    : [];
  const truckType = pick(compatibleTrailers) || pick(truckerCfg.truckTypes || []) || "Semi Trailer";
  const flavorLine = pick(truckerCfg.manifestLines || []) || "";
  const distanceKm = Math.max(1, Math.round(Number(route?.distanceKm) || randInt(120, 1200)));
  const durationMinutes = durationMinutesForRoute(distanceKm);
  const perKm = Number(truckerCfg.payout?.perKm ?? truckerCfg.payout?.perKmMin ?? 12);
  const payoutBase = Math.max(100, Math.round(distanceKm * perKm * payoutModifier));

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
  const pct = Math.max(0, Math.min(100, Math.round((clampedElapsed / durationMs) * 100)));
  const kmDone = Math.round((Number(run.manifest?.distanceKm || 0) * pct) / 100);
  const kmRemaining = Math.max(0, Math.round(Number(run.manifest?.distanceKm || 0) - kmDone));
  return { pct, kmRemaining };
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
    `**Route:** ${formatRoutePlace(manifest.route.from)} -> ${formatRoutePlace(manifest.route.to)}`,
    `**Distance:** ${manifest.distanceKm.toLocaleString()} km`,
    `**ETA:** ${manifest.durationMinutes} minute${manifest.durationMinutes === 1 ? "" : "s"}`,
    `**Payout:** $${Number(manifest.payoutBase || 0).toLocaleString()}`,
  ];

  if (started) {
    lines.push(
      "",
      "**Progress**",
      `${progressBar(progress.pct)} **${progress.pct}%**`,
      ready || completed ? "✅ Delivery complete. Press **Collect Pay**." : `⏳ Arrival: <t:${doneAtUnix}:R>`,
      ready || completed ? "**Distance Remaining:** 0 km" : `**Distance Remaining:** ${progress.kmRemaining.toLocaleString()} km`
    );
  }

  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(lines.filter(Boolean).join("\n"))
    .setFooter({ text: truckerCfg.footer || "Start the run, let the kilometres roll, then collect the cheque." });
}


function buildEmailSorterEmbed(run) {
  const total = run?.emails?.length || 0;
  const index = Math.max(0, Number(run?.currentIndex || 0));
  const email = run?.emails?.[index];
  if (!email) {
    return new EmbedBuilder()
      .setTitle(emailSorterCfg.title || "📧 Email Sorter")
      .setDescription("No email is currently loaded.")
      .setFooter({ text: emailSorterCfg.footer || "Read carefully." });
  }

  return new EmbedBuilder()
    .setTitle(`${emailSorterCfg.title || "📧 Email Sorter"} — Email ${index + 1}/${total}`)
    .setDescription(
      [
        `📨 **From:** \`${email.from}\``,
        `📌 **Subject:** ${email.subject}`,
        `━━━━━━━━━━━━━━━━━━`,
        ``,
        email.body,
      ].join("\n")
    )
    .setFooter({ text: emailSorterCfg.footer || "Read carefully. One bad phishing call can wreck the shift." });
  }

function buildEmailSorterButtons(disabled = false) {
  const folderIds = ["urgent", "todo", "spam", "scam"];
  return [
    new ActionRowBuilder().addComponents(
      ...folderIds.map((folderId) => {
        const meta = folderMeta(folderId);
        return new ButtonBuilder()
          .setCustomId(`job_email:${folderId}`)
          .setLabel(meta.label)
          .setEmoji(meta.emoji)
          .setStyle(folderId === 'scam' ? ButtonStyle.Danger : ButtonStyle.Primary)
          .setDisabled(disabled);
      })
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("job_back:95").setLabel(ui.nav.back.label).setEmoji(ui.nav.back.emoji).setStyle(ui.nav.back.style).setDisabled(disabled),
      new ButtonBuilder().setCustomId("job_stop").setLabel("🛑 Stop Work").setStyle(ButtonStyle.Danger).setDisabled(disabled)
    ),
  ];
}

function buildEmailSorterSummaryEmbed(run, { paid = null } = {}) {
  const totalEmails = run?.emails?.length || 0;
  const totals = run?.totals || {};
  const lines = [];

  for (let i = 0; i < (run?.results?.length || 0); i += 1) {
    const result = run.results[i];
    const chosen = folderMeta(result.chosen);
    const actual = folderMeta(result.actual);
    let status = '❌';
    let extra = '';

    if (result.outcome === 'correct') {
      status = '✅';
    } else if (result.outcome === 'scam_to_spam') {
      status = '⚠️';
      extra = ` — penalty -$${Number(result.penalty || 0).toLocaleString()}`;
    } else if (result.outcome === 'mission_fail') {
      status = '💥';
      extra = ' — compromised';
    }

    lines.push(
      `${status} **${i + 1}. ${result.subject}**`,
      `Sorted: ${chosen.emoji} ${chosen.label} | Actual: ${actual.emoji} ${actual.label}${extra}`
    );
  }

  const summary = [
    `Processed: **${totalEmails}**`,
    `Correct: **${Number(totals.correct || 0)}/${totalEmails}**`,
    run?.failed ? `Failure: **${run.failedReason || 'Yes'}**` : 'Failure: **No**',
    '',
    ...lines,
    '',
  ];

  if (run?.failed) {
    summary.push('💥 **Mission failed. No payout awarded.**');
  } else {
    summary.push(
      `Base shift pay: **$${Number(totals.subtotal || 0).toLocaleString()}**`,
      Number(totals.perfectBonus || 0) > 0 ? `Perfect bonus: **+$${Number(totals.perfectBonus || 0).toLocaleString()}**` : null,
      Number(totals.penalties || 0) > 0 ? `Penalties: **-$${Number(totals.penalties || 0).toLocaleString()}**` : null,
      paid ? `Final paid: **$${Number(paid.amount || 0).toLocaleString()}**` : `Total earned: **$${Number(totals.total || 0).toLocaleString()}**`,
      paid ? `⏳ Next payout: <t:${Math.floor(paid.nextClaim.getTime() / 1000)}:R>` : null,
      paid?.prog?.leveledUp ? `🎉 Level up! You are now **Level ${paid.prog.level}**` : null
    );
  }

  return new EmbedBuilder()
    .setTitle(run?.failed ? '📧 Email Sorter — Shift Failed' : '📧 Email Sorter — Shift Summary')
    .setDescription(summary.filter(Boolean).join('\n'))
    .setColor(run?.failed ? ui.colors.danger : ui.colors.success);
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
        new ButtonBuilder().setCustomId("job_back:95").setLabel(ui.nav.back.label).setEmoji(ui.nav.back.emoji).setStyle(ui.nav.back.style),
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

module.exports = {
  buildNineToFiveEmbed,
  buildNineToFiveComponents,
  getContractChoices,
  buildContractEmbed,
  buildContractButtons,
  buildSkillEmbed,
  buildSkillButtons,
  buildShiftEmbed,
  buildShiftButtons,
  buildEmailSorterEmbed,
  buildEmailSorterButtons,
  buildEmailSorterSummaryEmbed,
  formatRoutePlace,
  generateTruckerManifest,
  buildTruckerEmbed,
  buildTruckerButtons,
};
