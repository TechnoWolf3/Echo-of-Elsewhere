const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  MessageFlags,
} = require("discord.js");

const { guardNotJailed } = require("../utils/jail");
const ritualsRegistry = require("../data/rituals");
const { getPrimaryRituals, getOtherRituals, getRitual } = ritualsRegistry;
const { getRitualStatus, claimRitual, buildStatusLine } = require("../utils/rituals");

const BTN_PREFIX = "rituals:claim:";
const SELECT_ID = "rituals:other";
const REFRESH_ID = "rituals:refresh";
const CLOSE_ID = "rituals:close";

async function buildHubPayload(guildId, userId, latestMessage = null) {
  const primary = getPrimaryRituals();
  const other = getOtherRituals();

  const statuses = new Map();
  for (const ritual of [...primary, ...other]) {
    statuses.set(ritual.id, await getRitualStatus(guildId, userId, ritual));
  }

  const embed = new EmbedBuilder()
    .setColor(0x7a2bff)
    .setTitle("🕯️ Echo Rituals")
    .setDescription(
      "Return here for timed offerings, recurring rites, and whatever else Echo decides is worth your time."
    )
    .addFields({
      name: "Primary Rituals",
      value: primary.map((ritual) => buildStatusLine(ritual, statuses.get(ritual.id))).join("\n"),
    });

  if (other.length) {
    embed.addFields({
      name: "Other Rituals",
      value: other.map((ritual) => buildStatusLine(ritual, statuses.get(ritual.id))).join("\n"),
    });
  } else {
    embed.addFields({
      name: "Other Rituals",
      value: "_Nothing else has been added yet. Future daily or weekly side rituals can live in the dropdown here._",
    });
  }

  if (latestMessage) {
    embed.addFields({ name: "Latest Result", value: latestMessage.slice(0, 1024) });
  }

  const buttonStyles = [ButtonStyle.Primary, ButtonStyle.Secondary, ButtonStyle.Success, ButtonStyle.Primary, ButtonStyle.Secondary];
  const primaryRows = [];
  for (let start = 0; start < primary.length; start += 5) {
    const slice = primary.slice(start, start + 5);
    if (!slice.length) continue;
    primaryRows.push(
      new ActionRowBuilder().addComponents(
        slice.map((ritual, idx) => {
          const status = statuses.get(ritual.id);
          return new ButtonBuilder()
            .setCustomId(`${BTN_PREFIX}${ritual.id}`)
            .setLabel(ritual.shortName || ritual.name)
            .setStyle(status?.available ? buttonStyles[(start + idx) % buttonStyles.length] ?? ButtonStyle.Primary : ButtonStyle.Secondary);
        })
      )
    );
  }

  const otherMenu = new StringSelectMenuBuilder()
    .setCustomId(SELECT_ID)
    .setPlaceholder(other.length ? "Choose another ritual…" : "No other rituals available yet")
    .setDisabled(other.length === 0)
    .addOptions(
      (other.length
        ? other
        : [
            {
              id: "none",
              name: "No other rituals available yet",
              description: 'Add rituals with placement: "other" to populate this menu.',
            },
          ]).map((ritual) => ({
        label: ritual.name,
        value: ritual.id,
        description: String(ritual.description || "Perform ritual").slice(0, 100),
      }))
    );

  const menuRow = new ActionRowBuilder().addComponents(otherMenu);
  const utilityRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(REFRESH_ID).setLabel("Refresh").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(CLOSE_ID).setLabel("Close").setStyle(ButtonStyle.Danger)
  );

  return { embeds: [embed], components: [...primaryRows, menuRow, utilityRow] };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("rituals")
    .setDescription("Open the hub for daily, weekly, monthly, and other timed rituals."),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({
        content: "❌ Server only.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
    }

    if (await guardNotJailed(interaction)) return;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
    const payload = await buildHubPayload(interaction.guildId, interaction.user.id);
    return interaction.editReply(payload).catch(() => {});
  },

  async handleInteraction(interaction) {
    const cid = String(interaction.customId || "");

    for (const ritual of ritualsRegistry.rituals || []) {
      if (typeof ritual.handleInteraction === "function") {
        try {
          const handled = await ritual.handleInteraction(interaction, { buildHubPayload });
          if (handled) return true;
        } catch (err) {
          console.error(`[RITUALS:${ritual.id}] interaction failed:`, err);
          if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content: "❌ Something went wrong while handling that ritual.", embeds: [], components: [] }).catch(() => {});
          } else {
            await interaction.reply({ content: "❌ Something went wrong while handling that ritual.", flags: MessageFlags.Ephemeral }).catch(() => {});
          }
          return true;
        }
      }
    }

    const isRelevant =
      (interaction.isButton?.() && (cid.startsWith(BTN_PREFIX) || cid === REFRESH_ID || cid === CLOSE_ID)) ||
      (interaction.isStringSelectMenu?.() && cid === SELECT_ID);

    if (!isRelevant) return false;

    if (!interaction.inGuild()) {
      await interaction.reply({ content: "❌ Server only.", flags: MessageFlags.Ephemeral }).catch(() => {});
      return true;
    }

    try {
      if (cid === CLOSE_ID) {
        await interaction.update({ content: "🗑️ Rituals closed.", embeds: [], components: [] }).catch(() => {});
        return true;
      }

      if (cid === REFRESH_ID) {
        await interaction.deferUpdate().catch(() => {});
        const refreshed = await buildHubPayload(interaction.guildId, interaction.user.id);
        await interaction.editReply(refreshed).catch(() => {});
        return true;
      }

      let ritualId = null;
      if (interaction.isButton?.() && cid.startsWith(BTN_PREFIX)) {
        ritualId = cid.slice(BTN_PREFIX.length);
      } else if (interaction.isStringSelectMenu?.() && cid === SELECT_ID) {
        ritualId = interaction.values?.[0] || null;
      }

      const ritual = ritualId ? getRitual(ritualId) : null;
      if (!ritual) {
        await interaction.deferUpdate().catch(() => {});
        const refreshed = await buildHubPayload(interaction.guildId, interaction.user.id, "⚠️ That ritual could not be found.");
        await interaction.editReply(refreshed).catch(() => {});
        return true;
      }

      if (await guardNotJailed(interaction)) return true;

      if (ritual.interactive && typeof ritual.begin === "function") {
        return !!(await ritual.begin(interaction, { buildHubPayload }));
      }

      await interaction.deferUpdate().catch(() => {});

      const result = await claimRitual({
        guildId: interaction.guildId,
        userId: interaction.user.id,
        ritual,
      });

      const refreshed = await buildHubPayload(interaction.guildId, interaction.user.id, result.message);
      await interaction.editReply(refreshed).catch(() => {});
      return true;
    } catch (err) {
      console.error("[RITUALS] interaction failed:", err);
      const fallback = await buildHubPayload(
        interaction.guildId,
        interaction.user.id,
        "❌ Something went wrong while handling that ritual."
      ).catch(() => null);

      try {
        if (fallback) {
          if (interaction.deferred || interaction.replied) {
            await interaction.editReply(fallback).catch(() => {});
          } else {
            await interaction.update(fallback).catch(async () => {
              await interaction.reply({
                content: "❌ Something went wrong while handling that ritual.",
                flags: MessageFlags.Ephemeral,
              }).catch(() => {});
            });
          }
        }
      } catch (_) {}
      return true;
    }
  },
};
