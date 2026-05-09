const {
  SlashCommandBuilder,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} = require("discord.js");
const guildConfig = require("../utils/guildConfig");

const CHANNEL_SETTING_MAP = {
  "bot-channel": "bot_channel_id",
  "feature-hub": "feature_hub_channel_id",
  powerball: "powerball_channel_id",
  "ese-news": "ese_news_channel_id",
};

const LABELS = {
  bot_channel_id: "Bot Channel",
  feature_hub_channel_id: "Feature Hub Channel",
  powerball_channel_id: "Powerball Channel",
  ese_news_channel_id: "ESE News Channel",
  bot_master_role_id: "Bot Master Role",
};

function channelSubcommands(group, label) {
  return group
    .addSubcommand((sub) =>
      sub
        .setName("set")
        .setDescription(`Set the ${label} channel.`)
        .addChannelOption((option) =>
          option
            .setName("channel")
            .setDescription("Channel to use.")
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("clear")
        .setDescription(`Clear the ${label} channel.`)
    );
}

function formatChannel(id) {
  return id ? `<#${id}>` : "Not set";
}

function formatRole(id) {
  return id ? `<@&${id}>` : "Not set";
}

async function canSendInChannel(channel) {
  if (!channel?.isTextBased?.()) return false;
  const me = await channel.guild.members.fetchMe().catch(() => null);
  if (!me) return true;
  const perms = channel.permissionsFor(me);
  return Boolean(perms?.has?.(PermissionFlagsBits.ViewChannel) && perms?.has?.(PermissionFlagsBits.SendMessages));
}

async function reply(interaction, payload) {
  const full = typeof payload === "string" ? { content: payload } : payload;
  full.flags ??= MessageFlags.Ephemeral;
  if (interaction.deferred || interaction.replied) return interaction.followUp(full);
  return interaction.reply(full);
}

function buildConfigEmbed(row, effective = {}) {
  const embed = new EmbedBuilder()
    .setColor(0x0875AF)
    .setTitle("Echo Server Configuration")
    .setDescription("Basic setup for where Echo posts and who can manage advanced controls.")
    .addFields(
      { name: "Bot Channel", value: formatChannel(row?.bot_channel_id || effective.bot_channel_id), inline: true },
      { name: "Feature Hub", value: formatChannel(row?.feature_hub_channel_id || effective.feature_hub_channel_id), inline: true },
      { name: "Powerball", value: formatChannel(row?.powerball_channel_id || effective.powerball_channel_id), inline: true },
      { name: "ESE News", value: formatChannel(row?.ese_news_channel_id || effective.ese_news_channel_id), inline: true },
      { name: "Bot Master", value: formatRole(row?.bot_master_role_id || effective.bot_master_role_id), inline: true }
    )
    .setFooter({ text: "Use /configure to update basic setup. Advanced tuning stays in /adminpanel." })
    .setTimestamp();

  const missing = [];
  if (!row?.feature_hub_channel_id) missing.push("Feature Hub Channel");
  if (!row?.powerball_channel_id) missing.push("Powerball Channel");
  if (!row?.ese_news_channel_id) missing.push("ESE News Channel");
  if (!row?.bot_master_role_id && !effective.bot_master_role_id) missing.push("Bot Master Role");
  if (missing.length) {
    embed.addFields({ name: "Setup Notes", value: missing.map((label) => `• ${label} is not configured.`).join("\n") });
  }
  return embed;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("configure")
    .setDescription("Configure Echo's basic server setup.")
    .addSubcommand((sub) =>
      sub
        .setName("view")
        .setDescription("View current basic server configuration.")
    )
    .addSubcommandGroup((group) => channelSubcommands(group.setName("bot-channel").setDescription("Configure the preferred bot usage channel."), "bot usage"))
    .addSubcommandGroup((group) => channelSubcommands(group.setName("feature-hub").setDescription("Configure the persistent Feature Hub channel."), "Feature Hub"))
    .addSubcommandGroup((group) => channelSubcommands(group.setName("powerball").setDescription("Configure Echo Powerball posting."), "Powerball"))
    .addSubcommandGroup((group) => channelSubcommands(group.setName("ese-news").setDescription("Configure Echo Stock Exchange news posting."), "ESE news"))
    .addSubcommandGroup((group) =>
      group
        .setName("bot-master")
        .setDescription("Configure the protected Bot Master role.")
        .addSubcommand((sub) =>
          sub
            .setName("set")
            .setDescription("Set the Bot Master role.")
            .addRoleOption((option) =>
              option
                .setName("role")
                .setDescription("Role that can use powerful Bot Master controls.")
                .setRequired(true)
            )
        )
        .addSubcommand((sub) =>
          sub
            .setName("view")
            .setDescription("View the current Bot Master role.")
        )
    ),

  async execute(interaction) {
    if (!interaction.inGuild?.() || !interaction.guild) {
      return reply(interaction, "This command can only be used inside a server.");
    }

    await guildConfig.ensureSchema();

    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (!group && sub === "view") {
      const canView = guildConfig.isAdministrator(interaction.member) || await guildConfig.isBotMaster(interaction.member);
      if (!canView) {
        return reply(interaction, "You need Discord Administrator permission, or the Bot Master role, to view Echo setup.");
      }
      const row = await guildConfig.getGuildConfig(guildId);
      const effective = {
        bot_master_role_id: row?.bot_master_role_id || null,
      };
      return reply(interaction, { embeds: [buildConfigEmbed(row, effective)] });
    }

    if (group === "bot-master") {
      if (sub === "view") {
        const canView = guildConfig.isAdministrator(interaction.member) || await guildConfig.isBotMaster(interaction.member);
        if (!canView) {
          return reply(interaction, "You need Discord Administrator permission, or the Bot Master role, to view Echo setup.");
        }
        const configured = await guildConfig.getConfiguredBotMasterRoleId(guildId);
        return reply(interaction, {
          embeds: [
            new EmbedBuilder()
              .setColor(0x0875AF)
              .setTitle("Bot Master Role")
              .setDescription(configured ? `Configured Bot Master role: ${formatRole(configured)}` : "No guild Bot Master role is configured yet. A Discord Administrator must set the first one with `/configure bot-master set`.")
              .setTimestamp(),
          ],
        });
      }

      const allowed = await guildConfig.canManageConfigure(interaction.member, "bot_master_role_id");
      if (!allowed) {
        return reply(interaction, "Only the configured Bot Master role can change Bot Master after initial setup.");
      }

      const role = interaction.options.getRole("role", true);
      await guildConfig.setGuildConfigValue(guildId, "bot_master_role_id", role.id);
      return reply(interaction, {
        embeds: [
          new EmbedBuilder()
            .setColor(0x2ecc71)
            .setTitle("Bot Master Role Updated")
            .setDescription(`Bot Master is now ${role}.`)
            .setFooter({ text: "Only members with this role can change it from now on." })
            .setTimestamp(),
        ],
      });
    }

    const settingKey = CHANNEL_SETTING_MAP[group];
    if (!settingKey) {
      return reply(interaction, "Unknown configuration setting.");
    }

    const allowed = await guildConfig.canManageConfigure(interaction.member, settingKey);
    if (!allowed) {
      return reply(interaction, "You need Discord Administrator permission to change basic Echo setup.");
    }

    if (sub === "clear") {
      await guildConfig.clearGuildConfigValue(guildId, settingKey);
      return reply(interaction, {
        embeds: [
          new EmbedBuilder()
            .setColor(0xe67e22)
            .setTitle(`${LABELS[settingKey]} Cleared`)
            .setDescription(`${LABELS[settingKey]} is now unset. Echo will skip systems that require it.`)
            .setTimestamp(),
        ],
      });
    }

    const channel = interaction.options.getChannel("channel", true);
    if (!(await canSendInChannel(channel))) {
      return reply(interaction, `I cannot send messages in ${channel}. Please pick a text channel I can access.`);
    }

    await guildConfig.setGuildConfigValue(guildId, settingKey, channel.id);
    return reply(interaction, {
      embeds: [
        new EmbedBuilder()
          .setColor(0x2ecc71)
          .setTitle(`${LABELS[settingKey]} Updated`)
          .setDescription(`${LABELS[settingKey]} is now ${channel}.`)
          .setTimestamp(),
      ],
    });
  },
};
