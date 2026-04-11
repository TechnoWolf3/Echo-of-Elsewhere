// commands/games.js
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ComponentType,
  MessageFlags,
  PermissionFlagsBits,
} = require("discord.js");

const { getActiveGame } = require("../utils/gamesHubState");
const echoCurses = require("../utils/echoCurses");
const jail = require("../utils/jail");
const ui = require("../utils/ui");
const { loadCategories, getCategory, getGame } = require("../data/games");
const gamesConfig = require("../data/games/config");

const CAT_SELECT_ID = "games:cat";
const GAME_SELECT_ID = "games:game";
const BTN_HOME_ID = "games:home";
const BTN_BACK_ID = "games:back";
const BTN_REFRESH_ID = "games:refresh";
const BTN_CLOSE_ID = "games:close";

// per-channel single panel message tracking
const panels = new Map(); // channelId -> { messageId, collector, view, catId }

function statusLine(channelId) {
  const active = getActiveGame(channelId);
  return active
    ? `${ui.statusEmoji("active")} **Active:** ${active.type} — **${active.state || "active"}**`
    : `${ui.statusEmoji("ready")} **No active game in this channel**`;
}

function buildHomeEmbed(channelId, categories) {
  const embed = new EmbedBuilder()
    .setTitle(gamesConfig.title)
    .setDescription(`${gamesConfig.description}\n\n${statusLine(channelId)}`);
  ui.applySystemStyle(embed, "games");

  for (const c of categories) {
    embed.addFields({
      name: `${c.emoji || "🎮"} ${c.name}`,
      value: `${c.description || "—"}\n**Games:** ${c.games?.length || 0}`,
      inline: true,
    });
  }

  return embed;
}

function buildCategoryEmbed(channelId, cat) {
  const list = (cat.games?.length || 0)
    ? cat.games
        .map((g) => `${g.emoji || "🎮"} **${g.name}** — ${g.description || "—"}`)
        .join("\n")
    : "_No games in this category yet._";

  return ui.applySystemStyle(new EmbedBuilder()
    .setTitle(`${cat.emoji || "🎮"} ${cat.name}`)
    .setDescription(
      `${statusLine(channelId)}\n\n${cat.description || ""}\n\n**Available:**\n${list}`
    ), "games");
}


function buildFunCategoryPayload(channelId, categories) {
  const cat = getCategory(categories, "fun");
  if (!cat) {
    return {
      embeds: [buildHomeEmbed(channelId, categories)],
      components: [buildCategorySelect(categories), buildButtons({ showBack: false })],
    };
  }
  return {
    embeds: [buildCategoryEmbed(channelId, cat)],
    components: [buildGameSelect(cat), buildButtons({ showBack: true })],
    cat,
  };
}

function buildCategorySelect(categories) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(CAT_SELECT_ID)
      .setPlaceholder("Choose a category...")
      .addOptions(
        categories.map((c) => ({
          label: c.name,
          value: c.id,
          description: (c.description || "View games").slice(0, 100),
          emoji: c.emoji,
        }))
      )
  );
}

function buildGameSelect(cat) {
  const games = cat.games || [];
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(GAME_SELECT_ID)
      .setPlaceholder(games.length ? "Choose a game..." : "No games available")
      .setDisabled(games.length === 0)
      .addOptions(
        games.map((g) => ({
          label: g.name,
          value: g.id,
          description: (g.description || "Launch").slice(0, 100),
          emoji: g.emoji,
        }))
      )
  );
}

function buildButtons({ showBack }) {
  const row = new ActionRowBuilder();

  if (showBack) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(BTN_BACK_ID)
        .setLabel(ui.nav.back.label)
        .setEmoji(ui.nav.back.emoji)
        .setStyle(ui.nav.back.style)
    );
  }

  row.addComponents(
    new ButtonBuilder()
      .setCustomId(BTN_HOME_ID)
      .setLabel(ui.nav.home.label)
      .setEmoji(ui.nav.home.emoji)
      .setStyle(ui.nav.home.style),
    new ButtonBuilder()
      .setCustomId(BTN_REFRESH_ID)
      .setLabel(ui.nav.refresh.label)
      .setEmoji(ui.nav.refresh.emoji)
      .setStyle(ui.nav.refresh.style),
    new ButtonBuilder()
      .setCustomId(BTN_CLOSE_ID)
      .setLabel(ui.nav.close.label)
      .setEmoji(ui.nav.close.emoji)
      .setStyle(ui.nav.close.style)
  );

  return row;
}


async function ackThenEdit(i, msg, payload) {
  // Always ACK quickly (Discord requires this within ~3s)
  try {
    if (!i.deferred && !i.replied) await i.deferUpdate();
  } catch {}

  // Then edit the hub message directly (more reliable than i.update when payload can be large/emoji-heavy)
  try {
    await msg.edit(payload);
  } catch (err) {
    console.warn("[GAMES HUB] message.edit failed:", err?.rawError?.message || err?.message || err);
  }
}

async function upsertPanel(interaction) {
  const channelId = interaction.channelId;
  const categories = loadCategories();

  const embed = buildHomeEmbed(channelId, categories);
  const components = [buildCategorySelect(categories), buildButtons({ showBack: false })];

  const existing = panels.get(channelId);
  let msg = null;

  if (existing?.messageId) {
    try {
      msg = await interaction.channel.messages.fetch(existing.messageId);
      await msg.edit({ embeds: [embed], components });
    } catch {
      msg = null;
    }
  }

  if (!msg) {
    msg = await interaction.channel.send({ embeds: [embed], components });
    panels.set(channelId, { messageId: msg.id, collector: null, view: "home", catId: null });
  }

  // Attach collector once
  const rec = panels.get(channelId);
  if (!rec.collector) {
    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.MessageComponent,
      idle: (gamesConfig.idleMinutes || 30) * 60 * 1000,
    });
    rec.collector = collector;

    collector.on("collect", async (i) => {
      if (i.message.id !== msg.id) return;

      const categoriesNow = loadCategories();
      const canClose =
        i.memberPermissions?.has?.(PermissionFlagsBits.ManageChannels) ||
        i.memberPermissions?.has?.(PermissionFlagsBits.Administrator);

      try {
        // close
        if (i.customId === BTN_CLOSE_ID) {
          if (!canClose) {
            return i.reply({
              content: "❌ You need **Manage Channels** (or Admin) to close the hub panel.",
              flags: MessageFlags.Ephemeral,
            });
          }

          collector.stop("closed");
          panels.delete(channelId);

          await msg.delete().catch(async () => {
            await msg.edit({ components: [] }).catch(() => {});
          });

          return i.reply({ content: "🗑️ Games hub closed.", flags: MessageFlags.Ephemeral }).catch(() => {});
        }

        // refresh (use i.update so Discord never complains)
        if (i.customId === BTN_REFRESH_ID) {
          const state = panels.get(channelId);

          // Home view payload
          const homePayload = {
            embeds: [buildHomeEmbed(channelId, categoriesNow)],
            components: [buildCategorySelect(categoriesNow), buildButtons({ showBack: false })],
          };

          if (!state || state.view === "home") {
            return ackThenEdit(i, msg, homePayload);
          }

          const cat = getCategory(categoriesNow, state.catId);
          if (!cat) {
            state.view = "home";
            state.catId = null;
            return ackThenEdit(i, msg, homePayload);
          }

                    return ackThenEdit(i, msg, {
              embeds: [buildCategoryEmbed(channelId, cat)],
              components: [buildGameSelect(cat), buildButtons({ showBack: true })],
            });
        }

        // home/back (use i.update)
        if (i.customId === BTN_HOME_ID || i.customId === BTN_BACK_ID) {
          const state = panels.get(channelId);
          if (state) {
            state.view = "home";
            state.catId = null;
          }

                    return ackThenEdit(i, msg, {
              embeds: [buildHomeEmbed(channelId, categoriesNow)],
              components: [buildCategorySelect(categoriesNow), buildButtons({ showBack: false })],
            });
        }

        // category select (use i.update)
        if (i.customId === CAT_SELECT_ID) {
          const catId = i.values?.[0];
          const cat = getCategory(categoriesNow, catId);
          if (!cat) return i.deferUpdate().catch(() => {});

          const state = panels.get(channelId);
          if (state) {
            state.view = "cat";
            state.catId = cat.id;
          }

                    return ackThenEdit(i, msg, {
              embeds: [buildCategoryEmbed(channelId, cat)],
              components: [buildGameSelect(cat), buildButtons({ showBack: true })],
            });
        }

        // game select (deferUpdate is fine; we also don't want to change the hub message immediately here)
        if (i.customId === GAME_SELECT_ID) {
          // IMPORTANT: do NOT swallow failure silently; if this fails Discord shows the warning.
          try {
            await i.deferUpdate();
          } catch {
            // As a fallback, acknowledge with an update that doesn't change anything.
            // This prevents "interaction wasn't handled" if deferUpdate fails for any reason.
            await i.update({}).catch(() => {});
          }

          const state = panels.get(channelId);
          if (!state?.catId) return;

          const cat = getCategory(categoriesNow, state.catId);
          if (!cat) return;

          const gameId = i.values?.[0];
          const game = getGame(cat, gameId);
          if (!game) return;

          const active = getActiveGame(channelId);
          if (active) {
            return i.followUp({
              content: `❌ There’s already an active game in this channel: **${active.type}** (${active.state}).`,
              flags: MessageFlags.Ephemeral,
            });
          }

          if (typeof game.run !== "function") {
            return i.followUp({
              content: `❌ **${game.name}** isn’t hub-enabled yet.`,
              flags: MessageFlags.Ephemeral,
            });
          }

          await game.run(i, { reuseMessage: msg }).catch((e) => {
            console.error("[games] launch error:", e);
          });

          // If the game reused the hub message and is now active, leave the game UI in place.
          // Refreshing here would instantly overwrite the launched game embed.
          const activeNow = getActiveGame(channelId);
          if (activeNow) return;

          // If no game became active (launch failed, was declined instantly, etc.), restore the hub view.
          const fresh = panels.get(channelId);
          if (!fresh || fresh.view === "home") {
            return msg
              .edit({
                embeds: [buildHomeEmbed(channelId, categoriesNow)],
                components: [buildCategorySelect(categoriesNow), buildButtons({ showBack: false })],
              })
              .catch(() => {});
          }

          const freshCat = getCategory(categoriesNow, fresh.catId);
          if (!freshCat) return;

          return msg
            .edit({
              embeds: [buildCategoryEmbed(channelId, freshCat)],
              components: [buildGameSelect(freshCat), buildButtons({ showBack: true })],
            })
            .catch(() => {});
        }
      } catch (e) {
        console.error("[games] panel error:", e);
        try {
          if (!i.deferred && !i.replied) {
            await i.reply({ content: "❌ Something went wrong.", flags: MessageFlags.Ephemeral });
          }
        } catch {}
      }
    });

    collector.on("end", async () => {
      try {
        await msg.edit({ components: [] });
      } catch {}
      const cur = panels.get(channelId);
      if (cur?.collector === collector) panels.delete(channelId);
    });
  }

  return msg;
}


async function showFunCategory(interaction, existingMessage = null) {
  const channelId = interaction.channelId || interaction.channel?.id;
  const categories = loadCategories();
  const payload = buildFunCategoryPayload(channelId, categories);
  let msg = existingMessage;

  if (!msg) {
    const rec = panels.get(channelId);
    if (rec?.messageId) {
      try {
        msg = await interaction.channel.messages.fetch(rec.messageId);
      } catch {}
    }
  }

  if (!msg) {
    msg = await upsertPanel(interaction);
  }

  const state = panels.get(channelId);
  if (state) {
    state.view = "cat";
    state.catId = payload.cat?.id || "fun";
  }

  await msg.edit({
    embeds: payload.embeds,
    components: payload.components,
  }).catch(() => {});

  return msg;
}

// Internal helper for rerouting (like your old pattern)
async function ensureHub(interaction) {
  try {
    return await upsertPanel(interaction);
  } catch {
    return null;
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("games")
    .setDescription("Open the Games Hub panel for this channel."),

  async execute(interaction) {
    // Jail blocks everything already
    if (await jail.guardNotJailed(interaction)) return;

    // Blood Tax blocks /games until paid (offers pay/jail buttons)
    if (await echoCurses.guardBloodTaxCommand(interaction, { contextLabel: "games" })) return;

    if (!interaction.inGuild()) {
      return interaction.reply({ content: "❌ Server only.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
    await upsertPanel(interaction);

    return interaction.editReply("✅ Games hub posted/updated in this channel.");
  },
};

module.exports.ensureHub = ensureHub;
module.exports.showFunCategory = showFunCategory;
