const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { getOrCreateGuildPlayer } = require("../utils/music/playerManager");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play a song (name or link) and open the music panel")
    .addStringOption((opt) =>
      opt.setName("query").setDescription("Song name or link").setRequired(true)
    ),

  async execute(interaction) {
    const query = interaction.options.getString("query", true);

    // Must be in a voice channel
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    const voiceChannel = member?.voice?.channel;

    if (!voiceChannel) {
      return interaction.reply({
        content: "Join a voice channel first, then use `/play` 🙂",
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply(); // visible (panel will be in channel)

    const player = getOrCreateGuildPlayer(interaction.guild.id);

    // Join / move to user VC if needed
    await player.connect(voiceChannel);

    // Enqueue + maybe start playback
    const added = await player.enqueue(query, interaction.user);

    // Ensure panel message exists in THIS channel (where /play was run)
    await player.ensurePanel(interaction.channel);

    // Acknowledge
    await interaction.editReply({
      content: added?.count > 1
        ? `✅ Queued **${added.count}** tracks.`
        : `✅ Queued: **${added.title || "track"}**`,
    });
  },
};
