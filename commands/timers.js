const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require("discord.js");

const userTimers = require("../utils/userTimers");

const COLOR = 0x0875AF;
const BTN_COUNTDOWN = "timers:create:countdown";
const BTN_ALARM = "timers:create:alarm";
const BTN_REFRESH = "timers:refresh";
const BTN_CLOSE = "timers:close";
const MENU_CANCEL = "timers:cancel";
const MODAL_COUNTDOWN = "timers:modal:countdown";
const MODAL_ALARM = "timers:modal:alarm";

function formatAbsolute(dateLike) {
  const unix = Math.floor(new Date(dateLike).getTime() / 1000);
  return `<t:${unix}:F> (<t:${unix}:R>)`;
}

function buildCountdownModal() {
  return new ModalBuilder()
    .setCustomId(MODAL_COUNTDOWN)
    .setTitle("Create Timer")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("timer_name")
          .setLabel("Timer Name")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("Laundry, Study break, Boss respawn...")
          .setRequired(true)
          .setMaxLength(80)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("hours")
          .setLabel("Hours")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("0")
          .setRequired(false)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("minutes")
          .setLabel("Minutes")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("15")
          .setRequired(false)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("seconds")
          .setLabel("Seconds")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("0")
          .setRequired(false)
      )
    );
}

function buildAlarmModal() {
  return new ModalBuilder()
    .setCustomId(MODAL_ALARM)
    .setTitle(`Set Alarm (${userTimers.TIMEZONE_LABEL})`)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("timer_name")
          .setLabel("Alarm Name")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("Meeting, Daily reset, Wake-up...")
          .setRequired(true)
          .setMaxLength(80)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("hour")
          .setLabel("Hour (0-23)")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("18")
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("minute")
          .setLabel("Minute (0-59)")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("30")
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("second")
          .setLabel("Second (0-59, optional)")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("0")
          .setRequired(false)
      )
    );
}

async function buildHubPayload(guildId, userId, latestMessage = null) {
  const activeTimers = await userTimers.listActiveTimers(guildId, userId, 10);

  const lines = activeTimers.length
    ? activeTimers.map((timer) => {
        const kind = timer.timer_type === "alarm" ? "Alarm" : "Timer";
        const extra = timer.duration_seconds ? ` • ${userTimers.formatDuration(timer.duration_seconds)}` : "";
        return `• **${timer.timer_name}** (${kind}${extra})\nEnds ${formatAbsolute(timer.target_at)}`;
      }).join("\n\n")
    : "No active timers right now.";

  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle("Timers")
    .setDescription(
      [
        "Create countdown timers or set an alarm time. When one finishes, I’ll tag you in this channel.",
        "",
        `Alarm times use **${userTimers.TIMEZONE_LABEL}**.`,
      ].join("\n")
    )
    .addFields({
      name: activeTimers.length ? "Active Timers" : "Active Timers",
      value: lines,
    })
    .setFooter({ text: "You can run multiple timers at once." })
    .setTimestamp();

  if (latestMessage) {
    embed.addFields({ name: "Latest Update", value: latestMessage.slice(0, 1024) });
  }

  const components = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(BTN_COUNTDOWN).setLabel("New Timer").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(BTN_ALARM).setLabel("New Alarm").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(BTN_REFRESH).setLabel("Refresh").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(BTN_CLOSE).setLabel("Close").setStyle(ButtonStyle.Secondary)
    ),
  ];

  const cancelMenu = new StringSelectMenuBuilder()
    .setCustomId(MENU_CANCEL)
    .setPlaceholder(activeTimers.length ? "Cancel an active timer" : "No timers to cancel")
    .setDisabled(activeTimers.length === 0);

  if (activeTimers.length) {
    cancelMenu.addOptions(
      activeTimers.slice(0, 25).map((timer) => ({
        label: timer.timer_name.slice(0, 100),
        description: `${timer.timer_type === "alarm" ? "Alarm" : "Timer"} • ends ${new Date(timer.target_at).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })}`.slice(0, 100),
        value: String(timer.id),
      }))
    );
  } else {
    cancelMenu.addOptions([
      {
        label: "No active timers",
        description: "Create a timer or alarm first.",
        value: "none",
      },
    ]);
  }

  components.push(new ActionRowBuilder().addComponents(cancelMenu));
  return { embeds: [embed], components };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("timers")
    .setDescription("Create countdown timers and alarm reminders."),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({
        content: "❌ Server only.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
    const payload = await buildHubPayload(interaction.guildId, interaction.user.id);
    await interaction.editReply(payload).catch(() => {});
  },

  async handleInteraction(interaction) {
    const cid = String(interaction.customId || "");
    const relevant =
      cid.startsWith("timers:") ||
      cid === MODAL_COUNTDOWN ||
      cid === MODAL_ALARM;

    if (!relevant) return false;

    if (!interaction.inGuild()) {
      await interaction.reply({ content: "❌ Server only.", flags: MessageFlags.Ephemeral }).catch(() => {});
      return true;
    }

    try {
      if (interaction.isButton()) {
        if (cid === BTN_COUNTDOWN) {
          await interaction.showModal(buildCountdownModal());
          return true;
        }

        if (cid === BTN_ALARM) {
          await interaction.showModal(buildAlarmModal());
          return true;
        }

        if (cid === BTN_REFRESH) {
          await interaction.deferUpdate().catch(() => {});
          await interaction.editReply(await buildHubPayload(interaction.guildId, interaction.user.id)).catch(() => {});
          return true;
        }

        if (cid === BTN_CLOSE) {
          await interaction.update({ content: "🕒 Timers closed.", embeds: [], components: [] }).catch(() => {});
          return true;
        }
      }

      if (interaction.isStringSelectMenu() && cid === MENU_CANCEL) {
        const timerId = interaction.values?.[0];
        await interaction.deferUpdate().catch(() => {});

        if (!timerId || timerId === "none") {
          await interaction.editReply(await buildHubPayload(interaction.guildId, interaction.user.id)).catch(() => {});
          return true;
        }

        const cancelled = await userTimers.cancelTimer(interaction.guildId, interaction.user.id, timerId);
        const latest = cancelled
          ? `Cancelled **${cancelled.timer_name}**.`
          : "That timer was already gone.";
        await interaction.editReply(await buildHubPayload(interaction.guildId, interaction.user.id, latest)).catch(() => {});
        return true;
      }

      if (interaction.isModalSubmit()) {
        if (cid === MODAL_COUNTDOWN) {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
          const created = await userTimers.createCountdownTimer({
            guildId: interaction.guildId,
            channelId: interaction.channelId,
            userId: interaction.user.id,
            timerName: interaction.fields.getTextInputValue("timer_name"),
            hours: interaction.fields.getTextInputValue("hours"),
            minutes: interaction.fields.getTextInputValue("minutes"),
            seconds: interaction.fields.getTextInputValue("seconds"),
          });

          await interaction.editReply({
            content: `✅ Timer **${created.timer_name}** is set for ${created.duration_seconds ? userTimers.formatDuration(created.duration_seconds) : "later"} and will finish ${formatAbsolute(created.target_at)}.`,
          }).catch(() => {});

          await interaction.followUp({
            ...await buildHubPayload(interaction.guildId, interaction.user.id, `Created **${created.timer_name}**.`),
            flags: MessageFlags.Ephemeral,
          }).catch(() => {});
          return true;
        }

        if (cid === MODAL_ALARM) {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
          const created = await userTimers.createAlarmTimer({
            guildId: interaction.guildId,
            channelId: interaction.channelId,
            userId: interaction.user.id,
            timerName: interaction.fields.getTextInputValue("timer_name"),
            hour: interaction.fields.getTextInputValue("hour"),
            minute: interaction.fields.getTextInputValue("minute"),
            second: interaction.fields.getTextInputValue("second"),
          });

          await interaction.editReply({
            content: `✅ Alarm **${created.timer_name}** is set for ${formatAbsolute(created.target_at)}.`,
          }).catch(() => {});

          await interaction.followUp({
            ...await buildHubPayload(interaction.guildId, interaction.user.id, `Created alarm **${created.timer_name}**.`),
            flags: MessageFlags.Ephemeral,
          }).catch(() => {});
          return true;
        }
      }
    } catch (err) {
      console.error("[TIMERS] interaction failed:", err);
      const message = err?.message ? `❌ ${err.message}` : "❌ Something went wrong while handling that timer.";

      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ content: message, embeds: [], components: [] }).catch(() => {});
        } else {
          await interaction.reply({ content: message, flags: MessageFlags.Ephemeral }).catch(() => {});
        }
      } catch (_) {}
      return true;
    }

    return false;
  },
};
