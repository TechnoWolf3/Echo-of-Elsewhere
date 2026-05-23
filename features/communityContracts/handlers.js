const { MessageFlags, EmbedBuilder } = require("discord.js");
const engine = require("../../utils/communityContracts");
const ccUi = require("./ui");
const ui = require("../../utils/ui");

async function safeFollow(interaction, contentOrPayload) {
  const payload = typeof contentOrPayload === "string"
    ? { content: contentOrPayload, flags: MessageFlags.Ephemeral }
    : { flags: MessageFlags.Ephemeral, ...contentOrPayload };
  try {
    if (interaction.deferred || interaction.replied) return interaction.followUp(payload);
    return interaction.reply(payload);
  } catch {
    return null;
  }
}

async function renderMain({ msg, guildId, userId, user }) {
  const snapshot = await engine.snapshot(guildId, userId);
  return msg.edit({
    embeds: [ccUi.buildMainEmbed(snapshot, user)],
    components: ccUi.buildMainComponents(false),
  }).catch(() => {});
}

async function handleCommunityContractsInteraction({
  actionId,
  interaction,
  session,
  msg,
  guildId,
  userId,
  redraw,
}) {
  if (!actionId.startsWith("cc:") && !actionId.startsWith("cc_task:") && !actionId.startsWith("cc_help:") && !actionId.startsWith("cc_help_confirm:")) {
    return false;
  }

  if (actionId === "cc:main" || actionId === "cc:refresh") {
    session.view = "community_contracts";
    await redraw();
    return true;
  }

  if (actionId === "cc:start") {
    const snapshot = await engine.snapshot(guildId, userId);
    session.view = "community_contracts_start";
    await msg.edit({
      embeds: [ccUi.buildStartEmbed(snapshot)],
      components: ccUi.buildStartComponents(snapshot, false),
    }).catch(() => {});
    return true;
  }

  if (actionId.startsWith("cc_task:")) {
    const taskKey = actionId.slice("cc_task:".length);
    const res = await engine.startTask({ guildId, userId, taskKey });
    if (!res.ok) {
      const messages = {
        already_active: `You already have an active lead task. Collect it when it is ready before starting another.`,
        task_unavailable: "That task is not available in the current phase.",
        no_active_contract: "No active community contract could be loaded.",
      };
      await safeFollow(interaction, messages[res.reason] || `Could not start task: ${res.reason}`);
    } else {
      await safeFollow(interaction, `Started **${res.task.task_label}**. It will be ready <t:${Math.floor(new Date(res.task.current_finish_at).getTime() / 1000)}:R>.`);
    }
    session.view = "community_contracts";
    await redraw();
    return true;
  }

  if (actionId === "cc:help") {
    const snapshot = await engine.snapshot(guildId, userId);
    session.view = "community_contracts_help";
    const embed = new EmbedBuilder()
      .setColor(ui.colors.echo)
      .setTitle("Help / Rally")
      .setDescription(snapshot.assistableTasks.length
        ? "Choose an active assistable task. Earlier help gives better contribution, more bond XP, and a bigger timer reduction."
        : "No rally tasks are available right now. Long and major tasks from other players will appear here while they still have enough time remaining.");
    await msg.edit({
      embeds: [embed],
      components: ccUi.buildHelpComponents(snapshot, false),
    }).catch(() => {});
    return true;
  }

  if (actionId.startsWith("cc_help:")) {
    const taskId = actionId.slice("cc_help:".length);
    const estimate = await engine.estimateHelp({ guildId, userId, taskId });
    if (!estimate.ok) {
      await safeFollow(interaction, `Could not join that rally: ${estimate.reason}`);
      session.view = "community_contracts";
      await redraw();
      return true;
    }
    session.view = "community_contracts_help_confirm";
    session.ccHelpTaskId = taskId;
    await msg.edit({
      embeds: [ccUi.buildHelpConfirmEmbed(estimate)],
      components: ccUi.buildConfirmComponents(taskId, false),
    }).catch(() => {});
    return true;
  }

  if (actionId.startsWith("cc_help_confirm:")) {
    const taskId = actionId.slice("cc_help_confirm:".length);
    const res = await engine.joinHelp({ guildId, userId, taskId });
    if (!res.ok) {
      const messages = {
        own_task: "You cannot help your own task.",
        duplicate: "You are already helping that task.",
        full: "That task has no helper slots left.",
        too_late: "That task is too close to completion for another rally.",
        helper_limit: "You already have the maximum number of active rally commitments for this contract.",
      };
      await safeFollow(interaction, messages[res.reason] || `Could not join that rally: ${res.reason}`);
    } else {
      await safeFollow(interaction, [
        `You rallied behind **${res.task.task_label}** for <@${res.task.lead_user_id}>.`,
        `Estimated contribution: **${Number(res.estimatedContribution || 0).toLocaleString("en-AU")}**`,
        `Time saved: **${ccUi.msToShort(res.reductionMs)}**`,
      ].join("\n"));
    }
    session.ccHelpTaskId = null;
    session.view = "community_contracts";
    await redraw();
    return true;
  }

  if (actionId === "cc:collect") {
    const res = await engine.collectReadyTasks({ guildId, userId });
    if (!res.ok) {
      if (res.reason === "not_ready" && res.task) {
        await safeFollow(interaction, `Your active task is not ready yet. It finishes <t:${Math.floor(new Date(res.task.current_finish_at).getTime() / 1000)}:R>.`);
      } else {
        await safeFollow(interaction, "You do not have any completed Community Contract tasks to collect.");
      }
      await redraw();
      return true;
    }
    const lines = res.results.map((result) =>
      `**${result.task.task_label}** - ${result.outcome.label}: +${Number(result.totalAdded || 0).toLocaleString("en-AU")} progress (${Number(result.helperTotal || 0).toLocaleString("en-AU")} from helpers)`
    );
    await safeFollow(interaction, lines.join("\n").slice(0, 1900));
    if (res.completion?.completed) {
      await msg.channel.send({ embeds: [ccUi.buildCompletionEmbed(res.completion)] }).catch(() => {});
    }
    session.view = "community_contracts";
    await redraw();
    return true;
  }

  if (actionId === "cc:contributors") {
    const snapshot = await engine.snapshot(guildId, userId);
    await msg.edit({
      embeds: [ccUi.buildContributorsEmbed(snapshot)],
      components: ccUi.buildMainComponents(false),
    }).catch(() => {});
    return true;
  }

  if (actionId === "cc:history") {
    const rows = await engine.history(guildId, 8);
    await msg.edit({
      embeds: [ccUi.buildHistoryEmbed(rows)],
      components: ccUi.buildMainComponents(false),
    }).catch(() => {});
    return true;
  }

  return false;
}

module.exports = {
  renderMain,
  handleCommunityContractsInteraction,
};
