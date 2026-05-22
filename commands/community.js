const {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const community = require("../utils/community/communityService");
const { COMMUNITY_SYSTEM } = require("../data/community/config");
const bonds = require("../utils/community/bonds");
const standing = require("../utils/community/standing");
const { renderRatioBar, renderSignedStandingBar } = require("../utils/community/progressBars");

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

function buildCommunityButtons(disabled = false) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("community:level")
        .setLabel("Community Level")
        .setEmoji("🌐")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId("community:rewards")
        .setLabel("Community Rewards")
        .setEmoji("🎁")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId("community:bonds")
        .setLabel("Echo Bonds")
        .setEmoji("🤝")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId("community:standing")
        .setLabel("Server Standing")
        .setEmoji("⚖️")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled)
    ),
  ];
}

function bonusLinesForBond(level) {
  const bonus = bonds.getBondBonuses(level);
  const lines = [];
  if (bonus.jobPayoutPct) lines.push(`💼 Jobs: +${bonus.jobPayoutPct}% payout together`);
  if (bonus.jobXpPct) lines.push(`📈 Job XP: +${bonus.jobXpPct}% together`);
  if (bonus.casinoProfitPct) lines.push(`🎰 Casino: +${bonus.casinoProfitPct}% net winnings together`);
  for (const note of bonus.display || []) lines.push(`✨ ${note}`);
  return lines.length ? lines.join("\n") : "No active bonuses yet.";
}

async function buildBondsEmbed(interaction) {
  const rows = await bonds.getTopBondsForUser(interaction.guildId, interaction.user.id, 5);
  const embed = new EmbedBuilder()
    .setColor(COMMUNITY_SYSTEM.color)
    .setTitle("🤝 Echo Bonds")
    .setDescription("Some bonds are built on loyalty.\nSome are built on shared poor decisions.")
    .setFooter({ text: COMMUNITY_SYSTEM.footer })
    .setTimestamp();

  if (!rows.length) {
    embed.addFields({
      name: "No Bonds Yet",
      value: "You do not have any Echo Bonds yet. Play games, work jobs, join events, or cause legally questionable chaos with others to build bonds.",
      inline: false,
    });
    return embed;
  }

  const fields = [];
  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx];
    const otherId = String(row.other_user_id);
    const name = await nameFor(interaction, otherId);
    const info = bonds.getBondLevelInfo(Number(row.xp || 0));
    const currentFloor = info.level >= 10 ? info.xp : (bonds.getBondLevelInfo(info.level).xp || 0);
    const nextXp = info.next?.xp || info.xp;
    const progressTotal = info.isMax ? info.xp : nextXp - currentFloor;
    const progressNow = info.isMax ? info.xp : Math.max(0, Number(row.xp || 0) - currentFloor);
    const bar = info.isMax ? renderRatioBar(1) : renderRatioBar(progressNow / Math.max(1, progressTotal));
    fields.push({
      name: `${idx + 1}. ${name}`,
      value: [
        `Status: **${info.name}**`,
        `Level **${info.level}**`,
        `${bar} ${fmtInt(Number(row.xp || 0))} / ${fmtInt(nextXp)} XP`,
        "",
        "**Active Bonuses:**",
        bonusLinesForBond(info.level),
      ].join("\n"),
      inline: false,
    });
  }
  embed.addFields(fields);
  return embed;
}

function standingEffectsLines(value) {
  const bonuses = standing.getStandingBonuses(value);
  const lines = [];
  if (bonuses.legalJobPayoutPct) lines.push(`💼 Legal Jobs: +${bonuses.legalJobPayoutPct}% payout`);
  if (bonuses.legalPenaltyPct) lines.push(`💼 Legal Jobs: -${bonuses.legalPenaltyPct}% payout`);
  if (bonuses.legalJobXpPct) lines.push(`📈 Legal XP: +${bonuses.legalJobXpPct}%`);
  if (bonuses.crimePayoutPct) lines.push(`🕵️ Crime/Underworld: +${bonuses.crimePayoutPct}% payout`);
  if (bonuses.crimeXpPct) lines.push(`📈 Crime/Underworld XP: +${bonuses.crimeXpPct}%`);
  for (const note of bonuses.display || []) lines.push(`🚨 Risk: ${note}`);
  if (!lines.length) lines.push("No major bonuses or penalties.");
  return lines.join("\n");
}

async function buildStandingEmbed(interaction) {
  const row = await standing.getStanding(interaction.guildId, interaction.user.id);
  const value = standing.clampStanding(row?.standing || 0);
  const tier = standing.getStandingTier(value);
  const displayName = interaction.member?.displayName || interaction.user.globalName || interaction.user.username;
  return new EmbedBuilder()
    .setColor(value < 0 ? 0xaa0000 : value > 0 ? 0x22aa55 : COMMUNITY_SYSTEM.color)
    .setTitle("⚖️ Server Standing")
    .setDescription([
      `**${displayName}**`,
      `Standing: **${value} / 100**`,
      `Status: **${tier.name}**`,
      "",
      `${renderSignedStandingBar(value)} ${value}%`,
      "",
      "**Current Effects:**",
      standingEffectsLines(value),
      "",
      tier.description,
    ].join("\n"))
    .setFooter({ text: COMMUNITY_SYSTEM.footer })
    .setTimestamp();
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

    const msg = await interaction.editReply({ embeds: [embed], components: buildCommunityButtons(false) });
    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 10 * 60_000,
    });

    collector.on("collect", async (btn) => {
      try {
        if (btn.user.id !== interaction.user.id) {
          return btn.reply({ content: "This community panel is not yours.", flags: MessageFlags.Ephemeral }).catch(() => {});
        }

        if (btn.customId === "community:bonds") {
          await btn.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
          const bondsEmbed = await buildBondsEmbed(btn);
          return btn.editReply({ embeds: [bondsEmbed] }).catch(() => {});
        }

        if (btn.customId === "community:standing") {
          await btn.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
          const standingEmbed = await buildStandingEmbed(btn);
          return btn.editReply({ embeds: [standingEmbed] }).catch(() => {});
        }

        if (btn.customId === "community:level") {
          return btn.reply({ content: "Use `/level` to open your full Echo Resonance card.", flags: MessageFlags.Ephemeral }).catch(() => {});
        }

        if (btn.customId === "community:rewards") {
          return btn.reply({ content: "Community reward browsing is coming through this panel soon.", flags: MessageFlags.Ephemeral }).catch(() => {});
        }
      } catch (error) {
        console.error("[community] button failed:", error);
        if (!btn.deferred && !btn.replied) {
          await btn.reply({ content: "Something went wrong loading that community panel.", flags: MessageFlags.Ephemeral }).catch(() => {});
        } else {
          await btn.editReply({ content: "Something went wrong loading that community panel." }).catch(() => {});
        }
      }
    });

    collector.on("end", async () => {
      await msg.edit({ components: buildCommunityButtons(true) }).catch(() => {});
    });

    return msg;
  },
};
