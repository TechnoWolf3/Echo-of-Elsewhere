const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require("discord.js");

function prettyUser(u) {
  if (!u) return "Unknown";
  return u.username ? u.username : (u.tag || "User");
}

function buildPanelMessagePayload(state) {
  const now = state.now;
  const q = state.queue;

  const embed = new EmbedBuilder()
    .setTitle("🎵 Rubicon Royal Radio")
    .setDescription(
      now
        ? `**Now Playing:** ${now.title}\nRequested by: **${prettyUser(now.requestedBy)}**\nLoop: **${state.loopMode}**`
        : `No track playing.\nUse **/play** to start music.\nLoop: **${state.loopMode}**`
    )
    .addFields({
      name: "Up Next",
      value:
        q.length
          ? q.slice(0, 5).map((t, i) => `**${i + 1}.** ${t.title}`).join("\n")
          : "_Queue empty_",
    });

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("music:pause").setStyle(ButtonStyle.Primary).setLabel("Play/Pause"),
    new ButtonBuilder().setCustomId("music:skip").setStyle(ButtonStyle.Secondary).setLabel("Skip"),
    new ButtonBuilder().setCustomId("music:stop").setStyle(ButtonStyle.Danger).setLabel("Stop"),
    new ButtonBuilder().setCustomId("music:loop").setStyle(ButtonStyle.Secondary).setLabel("Loop"),
    new ButtonBuilder().setCustomId("music:shuffle").setStyle(ButtonStyle.Secondary).setLabel("Shuffle")
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("music:add").setStyle(ButtonStyle.Success).setLabel("Add")
  );

  const options = q.slice(0, 25).map((t, idx) => ({
    label: t.title.length > 95 ? t.title.slice(0, 92) + "..." : t.title,
    value: String(idx),
  }));

  const row3 = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("music:jump")
      .setPlaceholder("Jump to a queued track…")
      .setDisabled(options.length === 0)
      .addOptions(options.length ? options : [{ label: "Queue empty", value: "0" }])
  );

  return { embeds: [embed], components: [row1, row2, row3] };
}

module.exports = { buildPanelMessagePayload };
