const { EmbedBuilder } = require("discord.js");
const { COMMUNITY_SYSTEM } = require("../../data/community/config");
const { makeProgressBar } = require("../progressBar");

function fmtInt(value) {
  return Math.floor(Number(value) || 0).toLocaleString("en-AU");
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours <= 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

function renderLevelProfileEmbed(profile) {
  const progress = profile.progress;
  const bar = makeProgressBar(progress.currentLevelXp, progress.xpForNextLevel, { length: 14 });
  const rankLine = profile.rank ? `#${fmtInt(profile.rank)}` : "Unranked";

  return new EmbedBuilder()
    .setColor(COMMUNITY_SYSTEM.color)
    .setTitle("Echo Resonance")
    .setThumbnail(profile.avatarUrl)
    .setDescription([
      `**${profile.displayName}**`,
      `Level **${fmtInt(progress.level)}** - ${progress.title}`,
      "",
      "**Progress**",
      `${bar}`,
      `**${fmtInt(progress.currentLevelXp)} / ${fmtInt(progress.xpForNextLevel)} XP**`,
    ].join("\n"))
    .addFields(
      { name: "Server Rank", value: rankLine, inline: true },
      { name: "Total XP", value: fmtInt(progress.totalXp), inline: true },
      { name: "Weekly XP", value: fmtInt(profile.weeklyXp), inline: true },
      { name: "Messages Counted", value: fmtInt(profile.messageCount), inline: true },
      { name: "Voice Time", value: formatDuration(profile.voiceSeconds), inline: true },
      { name: "Level Ups", value: fmtInt(profile.levelUpsCount), inline: true }
    )
    .setFooter({ text: "Echo Resonance - rank card renderer can replace this embed later" })
    .setTimestamp();
}

module.exports = {
  formatDuration,
  renderLevelProfileEmbed,
};
