// commands/help.js
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ComponentType,
} = require("discord.js");

const { loadCategories, getCategory, getCommand } = require("../data/help");
const helpConfig = require("../data/help/config");

const CAT_SELECT_ID = "help:cat";
const CMD_SELECT_ID = "help:cmd";
const BTN_HOME_ID = "help:home";
const BTN_BACK_ID = "help:back";
const BTN_CLOSE_ID = "help:close";

function hasRole(member, roleId) {
  // Works for guild interactions; if member missing, fail closed
  try {
    return Boolean(member?.roles?.cache?.has(roleId));
  } catch {
    return false;
  }
}

function buildHubEmbed(categories) {
  const embed = new EmbedBuilder()
    .setTitle("📖 Help Hub")
    .setDescription("Select a category below to see commands.\nThis panel will auto-close after inactivity.");

  // Show categories as fields for readability
  for (const c of categories) {
    embed.addFields({
      name: `${c.emoji} ${c.name}`,
      value: c.blurb || "—",
      inline: true,
    });
  }

  return embed;
}

function buildCategoryEmbed(category) {
  const embed = new EmbedBuilder()
    .setTitle(`${category.emoji} ${category.name}`)
    .setDescription(
      category.blurb
        ? `${category.blurb}\n\n**Commands:**\n${category.commands
            .map((cmd) => `• **${cmd.name}** — ${cmd.short}`)
            .join("\n")}`
        : `**Commands:**\n${category.commands.map((cmd) => `• **${cmd.name}** — ${cmd.short}`).join("\n")}`
    );

  return embed;
}

function buildCommandEmbed(category, command) {
  return new EmbedBuilder()
    .setTitle(`${category.emoji} ${category.name} → ${command.name}`)
    .setDescription(command.detail || command.short || "No details set.");
}

function buildNoAccessEmbed() {
  return new EmbedBuilder()
    .setTitle(helpConfig.noAccess.title)
    .setDescription(helpConfig.noAccess.description);
}

function buildExpiredEmbed() {
  return new EmbedBuilder().setTitle("Help Panel Expired").setDescription(helpConfig.expiredText);
}

function buildCategorySelect(categories) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(CAT_SELECT_ID)
      .setPlaceholder("Choose a category…")
      .addOptions(
        categories.map((c) => ({
          label: c.name,
          value: c.id,
          description: (c.blurb || "").slice(0, 100) || "View commands",
          emoji: c.emoji,
        }))
      )
  );
}

function buildCommandSelect(category) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(CMD_SELECT_ID)
      .setPlaceholder("Choose a command…")
      .addOptions(
        category.commands.map((cmd) => ({
          label: cmd.name,
          value: cmd.id,
          description: (cmd.short || "").slice(0, 100) || "View details",
        }))
      )
  );
}

function buildNavButtons({ showBack = false } = {}) {
  const row = new ActionRowBuilder();

  if (showBack) {
    row.addComponents(
      new ButtonBuilder().setCustomId(BTN_BACK_ID).setLabel("Back").setStyle(ButtonStyle.Secondary).setEmoji("⬅️")
    );
  }

  row.addComponents(
    new ButtonBuilder().setCustomId(BTN_HOME_ID).setLabel("Home").setStyle(ButtonStyle.Primary).setEmoji("🏠"),
    new ButtonBuilder().setCustomId(BTN_CLOSE_ID).setLabel("Close").setStyle(ButtonStyle.Danger).setEmoji("🗑️")
  );

  return row;
}

module.exports = {
  data: new SlashCommandBuilder().setName("help").setDescription("Open the help panel"),

  async execute(interaction) {
    const categories = loadCategories();

    // Start on HUB
    let view = "hub"; // hub | category | command | noaccess
    let currentCategoryId = null;

    const hubEmbed = buildHubEmbed(categories);

    const msg = await interaction.reply({
      embeds: [hubEmbed],
      components: [buildCategorySelect(categories), buildNavButtons({ showBack: false })],
      fetchReply: true,
    });

    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.MessageComponent,
      idle: helpConfig.idleMs,
    });

    collector.on("collect", async (i) => {
      // Restrict interactions to the same channel message, but allow anyone to use it publicly
      // (No user lock, per your request)
      try {
        if (i.customId === BTN_CLOSE_ID) {
          collector.stop("closed");
          try {
            await msg.delete();
          } catch {
            // If can't delete, just disable
            await i.update({
              embeds: [buildExpiredEmbed()],
              components: [],
            });
          }
          return;
        }

        if (i.customId === BTN_HOME_ID) {
          view = "hub";
          currentCategoryId = null;
          return i.update({
            embeds: [buildHubEmbed(categories)],
            components: [buildCategorySelect(categories), buildNavButtons({ showBack: false })],
          });
        }

        if (i.customId === BTN_BACK_ID) {
          // Back goes to HUB from category/command/noaccess
          view = "hub";
          currentCategoryId = null;
          return i.update({
            embeds: [buildHubEmbed(categories)],
            components: [buildCategorySelect(categories), buildNavButtons({ showBack: false })],
          });
        }

        // Category select
        if (i.customId === CAT_SELECT_ID) {
          const catId = i.values?.[0];
          const cat = getCategory(categories, catId);
          if (!cat) return i.deferUpdate();

          // Permission gate for Game Boss category
          if (cat.id === "gameboss") {
            const allowed = hasRole(i.member, helpConfig.GAME_BOSS_ROLE_ID);
            if (!allowed) {
              view = "noaccess";
              currentCategoryId = cat.id;
              return i.update({
                embeds: [buildNoAccessEmbed()],
                components: [buildCategorySelect(categories), buildNavButtons({ showBack: true })],
              });
            }
          }

          view = "category";
          currentCategoryId = cat.id;

          return i.update({
            embeds: [buildCategoryEmbed(cat)],
            components: [buildCommandSelect(cat), buildNavButtons({ showBack: true })],
          });
        }

        // Command select
        if (i.customId === CMD_SELECT_ID) {
          if (!currentCategoryId) return i.deferUpdate();
          const cat = getCategory(categories, currentCategoryId);
          if (!cat) return i.deferUpdate();

          // Extra safety: if this is gameboss and user doesn't have role, block
          if (cat.id === "gameboss" && !hasRole(i.member, helpConfig.GAME_BOSS_ROLE_ID)) {
            view = "noaccess";
            return i.update({
              embeds: [buildNoAccessEmbed()],
              components: [buildCategorySelect(categories), buildNavButtons({ showBack: true })],
            });
          }

          const cmdId = i.values?.[0];
          const cmd = getCommand(cat, cmdId);
          if (!cmd) return i.deferUpdate();

          view = "command";
          return i.update({
            embeds: [buildCommandEmbed(cat, cmd)],
            components: [buildCommandSelect(cat), buildNavButtons({ showBack: true })],
          });
        }

        // Unknown component
        return i.deferUpdate();
      } catch (e) {
        console.error("[HELP] interaction error:", e);
        try {
          if (!i.replied && !i.deferred) await i.deferUpdate();
        } catch {}
      }
    });

    collector.on("end", async (_collected, reason) => {
      // If closed, we've handled deletion already
      if (reason === "closed") return;

      // Auto-clear after idle: delete message if possible
      try {
        await msg.delete();
      } catch {
        // Fallback: disable components
        try {
          await msg.edit({
            embeds: [buildExpiredEmbed()],
            components: [],
          });
        } catch {}
      }
    });
  },
};
