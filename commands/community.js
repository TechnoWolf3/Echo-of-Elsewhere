const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require("discord.js");
const community = require("../utils/community/communityService");
const { COMMUNITY_SYSTEM } = require("../data/community/config");

function fmtInt(value) {
  return Math.floor(Number(value) || 0).toLocaleString("en-AU");
}

async function nameFor(interaction, userId) {
  const member = await interaction.guild.members.fetch(String(userId)).catch(() => null);
  if (member?.displayName) return member.displayName;
  const user = await interaction.client.users.fetch(String(userId)).catch(() => null);
  return user?.username || "Unknown User";
}

function emptyLine(text) {
  return text || "No resonance recorded yet.";
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("community")
    .setDescription("Open the Echo Community hub."),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: "This command can only be used in a server.", flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply();

    const overview = await community.getCommunityOverview(interaction.guild);

    const topLines = await Promise.all((overview.topResonance || []).map(async (row, idx) => {
      const name = await nameFor(interaction, row.user_id);
      return `${idx + 1}. **${name}** - Level **${fmtInt(row.level)}**`;
    }));

    const weeklyLines = await Promise.all((overview.weeklyTop || []).map(async (row, idx) => {
      const name = await nameFor(interaction, row.user_id);
      return `${idx + 1}. **${name}** - **${fmtInt(row.weekly_xp)}** weekly XP`;
    }));

    const pulse = overview.pulse || {};
    const embed = new EmbedBuilder()
      .setColor(COMMUNITY_SYSTEM.color)
      .setTitle("Echo Community")
      .setDescription("The Place is listening. Here is where the server has been loudest lately.")
      .addFields(
        { name: "Top Resonance", value: emptyLine(topLines.join("\n")), inline: false },
        { name: "Most Active This Week", value: emptyLine(weeklyLines.join("\n")), inline: false },
        {
          name: "Server Pulse",
          value: [
            `Messages Counted This Week: **${fmtInt(pulse.messages)}**`,
            `Voice Hours This Week: **${(Number(pulse.voiceSeconds || 0) / 3600).toFixed(1)}**`,
            `Level Ups This Week: **${fmtInt(pulse.levelUps)}**`,
          ].join("\n"),
          inline: false,
        }
      )
      .setFooter({ text: "Echo Community - leaderboards are rolling 7 days" })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },
};
