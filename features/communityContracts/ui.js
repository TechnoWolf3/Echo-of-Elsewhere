const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require("discord.js");

const ui = require("../../utils/ui");
const { renderProgressBar } = require("../../utils/progressBar");
const data = require("../../data/communityContracts");

const CATEGORY_COLORS = {
  "Local Works": 0xb08d57,
  "Community Care": 0x4b9cd3,
  "Disaster Recovery": 0xc25b3d,
  "Land & Wildlife": 0x3f9b55,
  "Regional Supply": 0xd6a944,
};

function pct(current, total) {
  return Math.floor((Math.max(0, Number(current || 0)) / Math.max(1, Number(total || 1))) * 100);
}

function money(value) {
  return `$${Number(value || 0).toLocaleString("en-AU")}`;
}

function msToShort(ms) {
  const total = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${Math.max(1, minutes)}m`;
}

function unix(dateLike) {
  const date = dateLike instanceof Date ? dateLike : new Date(dateLike);
  return Math.floor(date.getTime() / 1000);
}

function progressLine(label, current, total) {
  return `${label}: ${renderProgressBar(current, total, { length: 14, filled: "#", empty: "-" })} ${pct(current, total)}%`;
}

function buildVisual(snapshot) {
  const { contract, definition, phaseProgress } = snapshot;
  const visual = data.visuals[definition?.visualType] || data.visuals.repair;
  const phaseIndex = Number(contract.phase_index || 0);
  if (definition?.visualType === "supply") {
    return {
      name: visual.title,
      value: (visual.stock || []).map((label, index) => {
        const ratio = Math.max(0.1, Math.min(1, (Number(contract.total_progress || 0) / Math.max(1, Number(contract.total_required || 1))) + (index - 1) * 0.08));
        return `${label}: ${renderProgressBar(ratio * 100, 100, { length: 10, filled: "#", empty: "-" })} ${Math.floor(ratio * 100)}%`;
      }).join("\n"),
    };
  }
  const phases = definition?.phases || [];
  const milestones = phases.length
    ? phases.map((phase) => ({ label: phase.name }))
    : visual.milestones || [];
  const lines = milestones.map((item, index) => {
    if (index < phaseIndex) return `[OK] ${item.label}`;
    if (index === phaseIndex) {
      const mark = phaseProgress.current >= phaseProgress.required * 0.5 ? "[..]" : "[> ]";
      return `${mark} ${item.label}`;
    }
    return `[  ] ${item.label}`;
  });
  return { name: visual.title || "Status", value: lines.join("\n") || "No status available." };
}

function activeTaskLines(tasks, max = 5) {
  if (!tasks?.length) return ["No active tasks yet."];
  return tasks.slice(0, max).map((task) => {
    const remaining = new Date(task.current_finish_at).getTime() - Date.now();
    const helpers = Number(task.helper_count || 0);
    const helperText = task.assistable ? ` helpers ${helpers}/${task.max_helpers || 0}` : "";
    return `<@${task.lead_user_id}> - **${task.task_label}** - ${remaining <= 0 ? "ready to collect" : `<t:${unix(task.current_finish_at)}:R>`}${helperText}`;
  });
}

function contributorLines(contributors, userContribution) {
  const top = (contributors || []).slice(0, 5).map((row, index) => {
    const medal = index === 0 ? "1." : index === 1 ? "2." : `${index + 1}.`;
    return `${medal} <@${row.user_id}> - ${Number(row.contribution || 0).toLocaleString("en-AU")}`;
  });
  if (!top.length) top.push("No contributions yet.");
  const mine = userContribution
    ? `You: **${Number(userContribution.contribution || 0).toLocaleString("en-AU")}** contribution, rank **${userContribution.rank || "?"}**`
    : "You: no contribution yet.";
  return [...top, "", mine];
}

function eventLines(events) {
  if (!events?.length) return ["No active project events."];
  return events.slice(0, 3).map((event) => {
    const effect = event.effect_json || {};
    const expires = event.expires_at ? ` - ends <t:${unix(event.expires_at)}:R>` : "";
    return `**${effect.title || event.event_key}**${expires}\n${effect.description || "A local condition is affecting the project."}`;
  });
}

function buildMainEmbed(snapshot, user) {
  const { contract, definition, phase, phaseProgress } = snapshot;
  if (!contract || !definition) {
    return new EmbedBuilder()
      .setColor(ui.colors.danger)
      .setTitle("Community Contracts")
      .setDescription("No active contract could be loaded.");
  }
  const visual = buildVisual(snapshot);
  return new EmbedBuilder()
    .setColor(CATEGORY_COLORS[definition.category] || data.config.DEFAULT_COLOR)
    .setTitle(`Community Contracts: ${definition.name}`)
    .setDescription([definition.description, "", definition.flavour].filter(Boolean).join("\n"))
    .addFields(
      {
        name: "Contract",
        value: [
          `Category: **${definition.category}**`,
          `Size: **${definition.size}** - recommended **${definition.recommendedPlayers || "any"}** players`,
          `Payout pool: **${money(contract.payout_pool)}**`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "Progress",
        value: [
          progressLine("Overall", contract.total_progress, contract.total_required),
          `Phase: **${phase?.name || "Current Phase"}**`,
          progressLine("Phase", phaseProgress.current, phaseProgress.required),
        ].join("\n"),
        inline: false,
      },
      visual,
      {
        name: "Active Tasks",
        value: activeTaskLines(snapshot.activeTasks).join("\n").slice(0, 1024),
        inline: false,
      },
      {
        name: "Rally Tasks",
        value: activeTaskLines(snapshot.assistableTasks, 4).join("\n").slice(0, 1024),
        inline: false,
      },
      {
        name: "Project Events",
        value: eventLines(snapshot.events).join("\n").slice(0, 1024),
        inline: false,
      },
      {
        name: "Contributors",
        value: contributorLines(snapshot.contributors, snapshot.userContribution).join("\n").slice(0, 1024),
        inline: false,
      }
    )
    .setFooter({ text: `Echo Community Contracts - opened by ${user?.username || "player"}` })
    .setTimestamp();
}

function buildStartEmbed(snapshot) {
  const phase = snapshot.phase;
  const lines = snapshot.availableTasks.map((task) => {
    const helper = task.assistable ? ` - rally slots ${task.maxHelpers || 0}` : "";
    return `**${task.label}** (${task.type}, ${msToShort(task.durationMs)})${helper}\n${task.description}`;
  });
  return new EmbedBuilder()
    .setColor(CATEGORY_COLORS[snapshot.definition?.category] || data.config.DEFAULT_COLOR)
    .setTitle("Start Community Task")
    .setDescription([`Current phase: **${phase?.name || "Phase"}**`, "", ...lines].join("\n\n").slice(0, 4000));
}

function buildHelpConfirmEmbed(estimate) {
  const reduction = msToShort(estimate.reductionMs);
  return new EmbedBuilder()
    .setColor(data.config.DEFAULT_COLOR)
    .setTitle("Rally Behind This Task?")
    .setDescription([
      `Task: **${estimate.task.task_label}**`,
      `Lead player: <@${estimate.task.lead_user_id}>`,
      `Time remaining: **${msToShort(estimate.remainingMs)}**`,
      `Estimated contribution: **${Number(estimate.estimatedContribution || 0).toLocaleString("en-AU")}**`,
      `Estimated bond XP: **${Number(estimate.bondXpEstimate || 0).toLocaleString("en-AU")}**`,
      `Time reduction: **${reduction}**`,
      "",
      "Joining early gives stronger rewards. Joining late helps a little, which is still more than the council subcommittee managed.",
    ].join("\n"));
}

function buildContributorsEmbed(snapshot) {
  const lines = (snapshot.contributors || []).map((row, index) =>
    `${index + 1}. <@${row.user_id}> - **${Number(row.contribution || 0).toLocaleString("en-AU")}** contribution`
  );
  return new EmbedBuilder()
    .setColor(data.config.DEFAULT_COLOR)
    .setTitle("Community Contract Contributors")
    .setDescription((lines.length ? lines : ["No contributors yet."]).join("\n"))
    .setFooter({ text: "Top 1 receives +25% payout. Top 2 receives +15% payout." });
}

function buildHistoryEmbed(rows) {
  const lines = (rows || []).map((row) => {
    const ts = unix(row.completed_at);
    return `**${row.name}** - ${row.category} - ${Number(row.total_contributors || 0)} contributors - <t:${ts}:R>`;
  });
  return new EmbedBuilder()
    .setColor(data.config.DEFAULT_COLOR)
    .setTitle("Completed Community Projects")
    .setDescription((lines.length ? lines : ["No completed projects yet."]).join("\n"));
}

function buildCompletionEmbed(completion) {
  const definition = completion.definition;
  const top = (completion.contributors || []).slice(0, 5).map((row, index) =>
    `${index + 1}. <@${row.user_id}> - ${Number(row.contribution || 0).toLocaleString("en-AU")}`
  );
  const finalState = (definition?.phases || []).map((phase) => `[OK] ${phase.name}`).join("\n");
  return new EmbedBuilder()
    .setColor(ui.colors.success)
    .setTitle("Community Contract Completed")
    .setDescription(definition?.resultText || `${completion.contract.name} has been completed.`)
    .addFields(
      { name: "What Changed", value: finalState || "The project is complete.", inline: false },
      { name: "Top Contributors", value: top.length ? top.join("\n") : "No contributors recorded.", inline: false },
      {
        name: "Rewards",
        value: [
          `Total contributors: **${Number(completion.contributors?.length || 0).toLocaleString("en-AU")}**`,
          `Payout pool: **${money(completion.contract.payout_pool)}**`,
          `Meaningful contributors received community standing where available.`,
          `Bond XP was awarded between meaningful collaborators where available.`,
        ].join("\n"),
        inline: false,
      }
    )
    .setTimestamp();
}

function baseButtons(disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("cc:start").setLabel("Start Task").setStyle(ButtonStyle.Primary).setDisabled(disabled),
    new ButtonBuilder().setCustomId("cc:help").setLabel("Help / Rally").setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId("cc:collect").setLabel("Collect Results").setStyle(ButtonStyle.Primary).setDisabled(disabled),
    new ButtonBuilder().setCustomId("cc:contributors").setLabel("Contributors").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId("cc:history").setLabel("Completed").setStyle(ButtonStyle.Secondary).setDisabled(disabled)
  );
}

function navButtons(disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("cc:refresh").setLabel("Refresh").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId("job_back:hub").setLabel("Back").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId("job_stop").setLabel("Close").setStyle(ButtonStyle.Danger).setDisabled(disabled)
  );
}

function buildMainComponents(disabled = false) {
  return [baseButtons(disabled), navButtons(disabled)];
}

function buildStartComponents(snapshot, disabled = false) {
  const options = (snapshot.availableTasks || []).slice(0, 25).map((task) => ({
    label: task.label.slice(0, 100),
    value: `cc_task:${task.key}`,
    description: `${task.type} - ${msToShort(task.durationMs)}`.slice(0, 100),
  }));
  const rows = [];
  if (options.length) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("cc_select:start")
        .setPlaceholder("Choose a timed task")
        .addOptions(options)
        .setDisabled(disabled)
    ));
  }
  rows.push(navButtons(disabled));
  return rows;
}

function buildHelpComponents(snapshot, disabled = false) {
  const options = (snapshot.assistableTasks || []).slice(0, 25).map((task) => ({
    label: `Help ${task.task_label}`.slice(0, 100),
    value: `cc_help:${task.id}`,
    description: `Lead: ${task.lead_user_id} - helpers ${task.helper_count || 0}/${task.max_helpers || 0}`.slice(0, 100),
  }));
  const rows = [];
  if (options.length) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("cc_select:help")
        .setPlaceholder("Choose a rally task")
        .addOptions(options)
        .setDisabled(disabled)
    ));
  }
  rows.push(navButtons(disabled));
  return rows;
}

function buildConfirmComponents(taskId, disabled = false) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`cc_help_confirm:${taskId}`).setLabel("Confirm Rally").setStyle(ButtonStyle.Success).setDisabled(disabled),
      new ButtonBuilder().setCustomId("cc:main").setLabel("Cancel").setStyle(ButtonStyle.Secondary).setDisabled(disabled)
    ),
  ];
}

module.exports = {
  buildMainEmbed,
  buildMainComponents,
  buildStartEmbed,
  buildStartComponents,
  buildHelpComponents,
  buildHelpConfirmEmbed,
  buildConfirmComponents,
  buildContributorsEmbed,
  buildHistoryEmbed,
  buildCompletionEmbed,
  msToShort,
};
