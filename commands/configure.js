const {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const guildConfig = require("../utils/guildConfig");

const SETTINGS = {
  bot_channel_id: {
    label: "Bot Channel",
    kind: "channel",
    description: "Preferred channel for normal bot usage and random events.",
    placeholder: "#bot-commands or channel ID",
  },
  feature_hub_channel_id: {
    label: "Feature Hub",
    kind: "channel",
    description: "Where Echo posts the persistent Feature Hub.",
    placeholder: "#features or channel ID",
  },
  powerball_channel_id: {
    label: "Powerball",
    kind: "channel",
    description: "Where Echo Powerball posts and refreshes.",
    placeholder: "#powerball or channel ID",
  },
  ese_news_channel_id: {
    label: "ESE News",
    kind: "channel",
    description: "Where Echo Stock Exchange news posts.",
    placeholder: "#ese-news or channel ID",
  },
  bot_master_role_id: {
    label: "Bot Master",
    kind: "role",
    description: "Role allowed to use protected admin tools.",
    placeholder: "@Bot Master or role ID",
  },
};

const CHANNEL_KEYS = Object.keys(SETTINGS).filter((key) => SETTINGS[key].kind === "channel");

function cleanId(value) {
  return String(value || "").replace(/[^0-9]/g, "") || null;
}

function formatChannel(id) {
  return id ? `<#${id}>` : "Not set";
}

function formatRole(id) {
  return id ? `<@&${id}>` : "Not set";
}

async function reply(interaction, payload) {
  const full = typeof payload === "string" ? { content: payload } : payload;
  full.flags ??= MessageFlags.Ephemeral;
  if (interaction.deferred || interaction.replied) return interaction.followUp(full);
  return interaction.reply(full);
}

async function canSendInChannel(channel) {
  if (!channel?.isTextBased?.()) return false;
  const me = await channel.guild.members.fetchMe().catch(() => null);
  if (!me) return true;
  const perms = channel.permissionsFor(me);
  return Boolean(perms?.has?.(PermissionFlagsBits.ViewChannel) && perms?.has?.(PermissionFlagsBits.SendMessages));
}

async function canViewConfigure(member) {
  return guildConfig.isAdministrator(member) || await guildConfig.isBotMaster(member);
}

async function buildConfigEmbed(guildId) {
  const row = await guildConfig.getGuildConfig(guildId);
  const embed = new EmbedBuilder()
    .setColor(0x0875AF)
    .setTitle("Echo Server Configuration")
    .setDescription("Basic setup for where Echo posts and who can manage advanced controls.")
    .addFields(
      { name: "Bot Channel", value: formatChannel(row?.bot_channel_id), inline: true },
      { name: "Feature Hub", value: formatChannel(row?.feature_hub_channel_id), inline: true },
      { name: "Powerball", value: formatChannel(row?.powerball_channel_id), inline: true },
      { name: "ESE News", value: formatChannel(row?.ese_news_channel_id), inline: true },
      { name: "Bot Master", value: formatRole(row?.bot_master_role_id), inline: true }
    )
    .setFooter({ text: "Basic setup lives here. Powerful tuning stays in /adminpanel." })
    .setTimestamp();

  const missing = [];
  for (const [key, setting] of Object.entries(SETTINGS)) {
    if (!row?.[key]) missing.push(setting.label);
  }
  if (missing.length) {
    embed.addFields({ name: "Missing Setup", value: missing.map((label) => `• ${label}`).join("\n") });
  }
  return embed;
}

function buildControls() {
  const setRow = new ActionRowBuilder().addComponents(
    ...CHANNEL_KEYS.map((key) =>
      new ButtonBuilder()
        .setCustomId(`configure:set:${key}`)
        .setLabel(`Set ${SETTINGS[key].label}`)
        .setStyle(ButtonStyle.Primary)
    )
  );

  const clearRow = new ActionRowBuilder().addComponents(
    ...CHANNEL_KEYS.map((key) =>
      new ButtonBuilder()
        .setCustomId(`configure:clear:${key}`)
        .setLabel(`Clear ${SETTINGS[key].label}`)
        .setStyle(ButtonStyle.Secondary)
    )
  );

  const protectedRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("configure:set:bot_master_role_id")
      .setLabel("Set Bot Master")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("configure:refresh")
      .setLabel("Refresh")
      .setStyle(ButtonStyle.Secondary)
  );

  return [setRow, clearRow, protectedRow];
}

async function buildHubPayload(guildId) {
  return {
    embeds: [await buildConfigEmbed(guildId)],
    components: buildControls(),
  };
}

function buildSetModal(settingKey) {
  const setting = SETTINGS[settingKey];
  const modal = new ModalBuilder()
    .setCustomId(`configure:modal:set:${settingKey}`)
    .setTitle(`Set ${setting.label}`);

  const input = new TextInputBuilder()
    .setCustomId("value")
    .setLabel(setting.kind === "role" ? "Role mention or ID" : "Channel mention or ID")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder(setting.placeholder);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

async function showHub(interaction, useUpdate = false) {
  const payload = await buildHubPayload(interaction.guildId);
  if (useUpdate && interaction.isRepliable?.()) {
    return interaction.update(payload);
  }
  return reply(interaction, payload);
}

async function saveChannel(interaction, settingKey, rawValue) {
  const id = cleanId(rawValue);
  if (!id) return reply(interaction, `Please enter a valid channel mention or ID for ${SETTINGS[settingKey].label}.`);

  const channel = await interaction.guild.channels.fetch(id).catch(() => null);
  if (!(await canSendInChannel(channel))) {
    return reply(interaction, `I cannot send messages in <#${id}>. Please choose a text channel I can access.`);
  }

  await guildConfig.setGuildConfigValue(interaction.guildId, settingKey, id);
  return reply(interaction, {
    embeds: [
      new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle(`${SETTINGS[settingKey].label} Updated`)
        .setDescription(`${SETTINGS[settingKey].label} is now <#${id}>.`)
        .setTimestamp(),
    ],
    components: buildControls(),
  });
}

async function saveBotMaster(interaction, rawValue) {
  const allowed = await guildConfig.canManageConfigure(interaction.member, "bot_master_role_id");
  if (!allowed) {
    return reply(interaction, "Only the configured Bot Master role can change Bot Master after initial setup.");
  }

  const id = cleanId(rawValue);
  if (!id) return reply(interaction, "Please enter a valid role mention or ID for Bot Master.");

  const role = await interaction.guild.roles.fetch(id).catch(() => null);
  if (!role) return reply(interaction, `I could not find role \`${id}\` in this server.`);

  await guildConfig.setGuildConfigValue(interaction.guildId, "bot_master_role_id", id);
  return reply(interaction, {
    embeds: [
      new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle("Bot Master Role Updated")
        .setDescription(`Bot Master is now ${role}.`)
        .setFooter({ text: "Only members with this role can change it from now on." })
        .setTimestamp(),
    ],
    components: buildControls(),
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("configure")
    .setDescription("Open Echo's basic server setup hub."),

  async execute(interaction) {
    if (!interaction.inGuild?.() || !interaction.guild) {
      return reply(interaction, "This command can only be used inside a server.");
    }

    await guildConfig.ensureSchema();
    if (!(await canViewConfigure(interaction.member))) {
      return reply(interaction, "You need Discord Administrator permission, or the Bot Master role, to view Echo setup.");
    }

    return showHub(interaction);
  },

  async handleInteraction(interaction) {
    const cid = interaction.customId;
    if (typeof cid !== "string" || !cid.startsWith("configure:")) return false;
    if (!interaction.inGuild?.() || !interaction.guild) {
      await reply(interaction, "This only works inside a server.");
      return true;
    }

    await guildConfig.ensureSchema();

    if (cid === "configure:refresh") {
      if (!(await canViewConfigure(interaction.member))) {
        await reply(interaction, "You need Discord Administrator permission, or the Bot Master role, to view Echo setup.");
        return true;
      }
      await showHub(interaction, true);
      return true;
    }

    const parts = cid.split(":");
    const action = parts[1];

    if (action === "modal" && interaction.isModalSubmit?.()) {
      const modalAction = parts[2];
      const modalSettingKey = parts[3];

      if (modalAction !== "set" || !SETTINGS[modalSettingKey]) {
        await reply(interaction, "Unknown configuration modal.");
        return true;
      }

      const value = interaction.fields.getTextInputValue("value");

      if (SETTINGS[modalSettingKey].kind === "role") {
        await saveBotMaster(interaction, value);
      } else {
        if (!(await guildConfig.canManageConfigure(interaction.member, modalSettingKey))) {
          await reply(interaction, "You need Discord Administrator permission to change basic Echo setup.");
          return true;
        }
        await saveChannel(interaction, modalSettingKey, value);
      }

      return true;
    }

    const settingKey = parts[2];

    if (!SETTINGS[settingKey]) {
      await reply(interaction, "Unknown configuration option.");
      return true;
    }

    if (action === "set" && interaction.isButton?.()) {
      if (!(await guildConfig.canManageConfigure(interaction.member, settingKey))) {
        await reply(interaction, settingKey === "bot_master_role_id"
          ? "Only the configured Bot Master role can change Bot Master after initial setup."
          : "You need Discord Administrator permission to change basic Echo setup.");
        return true;
      }
      await interaction.showModal(buildSetModal(settingKey));
      return true;
    }

    if (action === "clear" && interaction.isButton?.()) {
      if (SETTINGS[settingKey].kind === "role") {
        await reply(interaction, "Bot Master cannot be cleared from the hub. Set a replacement role instead.");
        return true;
      }
      if (!(await guildConfig.canManageConfigure(interaction.member, settingKey))) {
        await reply(interaction, "You need Discord Administrator permission to change basic Echo setup.");
        return true;
      }
      await guildConfig.clearGuildConfigValue(interaction.guildId, settingKey);
      await reply(interaction, {
        embeds: [
          new EmbedBuilder()
            .setColor(0xe67e22)
            .setTitle(`${SETTINGS[settingKey].label} Cleared`)
            .setDescription(`${SETTINGS[settingKey].label} is now unset. Echo will skip systems that require it.`)
            .setTimestamp(),
        ],
        components: buildControls(),
      });
      return true;
    }

    await reply(interaction, "Unknown configuration action.");
    return true;
  },
};