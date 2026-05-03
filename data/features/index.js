const fs = require("fs");
const path = require("path");
const {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require("discord.js");
const cfg = require("./config");
const store = require("./store");

function loadCategories() {
  const dir = path.join(__dirname, "categories");
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter((file) => file.endsWith(".js"));
  const categories = [];

  for (const file of files) {
    const fullPath = path.join(dir, file);
    try {
      delete require.cache[require.resolve(fullPath)];
      const mod = require(fullPath);

      if (!mod?.id || !mod?.name || !Array.isArray(mod.items)) {
        console.warn(`[FEATURES] Skipped ${file}: missing id/name/items[]`);
        continue;
      }

      categories.push(mod);
    } catch (error) {
      console.error(`[FEATURES] Failed to load ${file}:`, error);
    }
  }

  categories.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  return categories;
}

function chunkLines(lines, maxLen = 1024) {
  const chunks = [];
  let current = "";

  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > maxLen) {
      if (current) chunks.push(current);
      current = line.length > maxLen ? `${line.slice(0, maxLen - 1)}…` : line;
    } else {
      current = next;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function splitIntoColumns(lines, columns = 2) {
  if (!lines.length) return ["No categories available."];
  const perColumn = Math.ceil(lines.length / columns);
  const output = [];
  for (let index = 0; index < lines.length; index += perColumn) {
    output.push(lines.slice(index, index + perColumn).join("\n"));
  }
  return output;
}

function getCategorySections(category) {
  return Array.isArray(category?.sections) ? category.sections : [];
}

function getSectionEntries(category, sectionId) {
  const section = getCategorySections(category).find((entry) => entry.id === sectionId) || null;
  if (!section) return { section: null, entries: [] };

  const ids = new Set(section.itemIds || []);
  return {
    section,
    entries: (category.items || []).filter((item) => ids.has(item.id)),
  };
}

function buildCategoryOptions(categories) {
  return categories.slice(0, 25).map((category) => ({
    label: (category.name || "Unknown").slice(0, 100),
    value: category.id,
    description: (category.blurb || "View details").slice(0, 100),
    emoji: category.emoji || undefined,
  }));
}

function buildHomeEmbed(categories) {
  const categoryLines = categories.map(
    (category) => `${category.emoji ? `${category.emoji} ` : ""}**${category.name}**\n${category.blurb || "Browse this category."}`
  );
  const columns = splitIntoColumns(categoryLines, 2);

  return new EmbedBuilder()
    .setTitle(cfg.title)
    .setDescription("A cleaner map of Echo's systems, commands, and progression paths.")
    .setColor(cfg.color)
    .addFields(
      {
        name: "How It Works",
        value: [
          "Choose a category below.",
          "Larger categories open into section groups first.",
          "This hub refreshes automatically when the bot restarts.",
        ].join("\n"),
      },
      ...columns.map((value, index) => ({
        name: index === 0 ? "Feature Categories" : "\u200b",
        value: value.slice(0, 1024),
        inline: true,
      }))
    );
}

function buildHubMessage(categories) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId("features:open")
    .setPlaceholder("Select a feature category...")
    .addOptions(buildCategoryOptions(categories).length ? buildCategoryOptions(categories) : [{ label: "No categories", value: "none" }]);

  return {
    embeds: [buildHomeEmbed(categories)],
    components: [new ActionRowBuilder().addComponents(menu)],
  };
}

function buildCategoryPanel(userId, category) {
  const sections = getCategorySections(category);
  const embed = new EmbedBuilder()
    .setTitle(`${category.emoji ? `${category.emoji} ` : ""}${category.name}`)
    .setDescription(category.description || category.blurb || "-")
    .setColor(cfg.color);

  if (sections.length) {
    const lines = sections.map(
      (section, index) => `**${index + 1}. ${section.name || "Section"}** - ${section.short || "Browse this section."}`
    );
    const chunks = chunkLines(lines, 1024);

    embed.addFields(
      chunks.map((value, index) => ({
        name: index === 0 ? "Sections" : `Sections (cont. ${index + 1})`,
        value,
      }))
    );

    const sectionMenu = new StringSelectMenuBuilder()
      .setCustomId(`features:section:${userId}:${category.id}`)
      .setPlaceholder("Open a section...")
      .addOptions(
        sections.slice(0, 25).map((section) => ({
          label: (section.name || "Section").slice(0, 100),
          value: section.id,
          description: (section.short || "Browse this section.").slice(0, 100),
        }))
      );

    return {
      embeds: [embed],
      components: [
        new ActionRowBuilder().addComponents(sectionMenu),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`features:home:${userId}`)
            .setLabel("Back to Categories")
            .setStyle(ButtonStyle.Secondary)
        ),
      ],
    };
  }

  const items = (category.items || []).slice(0, 25);
  if (!items.length) {
    embed.addFields({ name: "Nothing here yet", value: "This category has no entries." });
  } else {
    const lines = items.map(
      (item, index) => `**${index + 1}. ${item.name || "Unknown"}** - ${item.short || "-"}`
    );
    const chunks = chunkLines(lines, 1024);
    embed.addFields(
      chunks.map((value, index) => ({
        name: index === 0 ? "Entries" : `Entries (cont. ${index + 1})`,
        value,
      }))
    );
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`features:entry:${userId}:${category.id}`)
    .setPlaceholder("Open an entry...")
    .addOptions(
      items.length
        ? items.map((item) => ({
            label: (item.name || "Unknown").slice(0, 100),
            value: item.id,
            description: (item.short || "Open").slice(0, 100),
          }))
        : [{ label: "No entries", value: "none" }]
    );

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(menu),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`features:home:${userId}`)
          .setLabel("Back to Categories")
          .setStyle(ButtonStyle.Secondary)
      ),
    ],
  };
}

function buildSectionPanel(userId, category, section) {
  const { entries } = getSectionEntries(category, section.id);
  const embed = new EmbedBuilder()
    .setTitle(`${category.emoji ? `${category.emoji} ` : ""}${category.name} - ${section.name}`)
    .setDescription(section.description || section.short || category.blurb || "-")
    .setColor(cfg.color);

  if (!entries.length) {
    embed.addFields({ name: "Nothing here yet", value: "This section has no entries." });
  } else {
    const lines = entries.map(
      (item, index) => `**${index + 1}. ${item.name || "Unknown"}** - ${item.short || "-"}`
    );
    const chunks = chunkLines(lines, 1024);
    embed.addFields(
      chunks.map((value, index) => ({
        name: index === 0 ? "Entries" : `Entries (cont. ${index + 1})`,
        value,
      }))
    );
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`features:entry:${userId}:${category.id}:${section.id}`)
    .setPlaceholder("Open an entry...")
    .addOptions(
      entries.length
        ? entries.slice(0, 25).map((entry) => ({
            label: (entry.name || "Unknown").slice(0, 100),
            value: entry.id,
            description: (entry.short || "Open").slice(0, 100),
          }))
        : [{ label: "No entries", value: "none" }]
    );

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(menu),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`features:category:${userId}:${category.id}`)
          .setLabel(`Back to ${category.name}`)
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`features:home:${userId}`)
          .setLabel("Categories")
          .setStyle(ButtonStyle.Secondary)
      ),
    ],
  };
}

function buildEntryPanel(userId, category, entry, source = {}) {
  const embed = new EmbedBuilder()
    .setTitle(`${category.emoji ? `${category.emoji} ` : ""}${category.name} - ${entry.name}`)
    .setDescription(entry.detail || entry.short || "-")
    .setColor(cfg.color);

  const buttons = [];
  if (source.sectionId) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`features:sectionReturn:${userId}:${category.id}:${source.sectionId}`)
        .setLabel("Back to Section")
        .setStyle(ButtonStyle.Secondary)
    );
  } else {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`features:category:${userId}:${category.id}`)
        .setLabel(`Back to ${category.name}`)
        .setStyle(ButtonStyle.Secondary)
    );
  }

  buttons.push(
    new ButtonBuilder()
      .setCustomId(`features:home:${userId}`)
      .setLabel("Categories")
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(buttons)],
  };
}

async function ensure(client, opts = {}) {
  const channelId = opts.channelId || cfg.FEATURES_CHANNEL_ID;
  if (!channelId) {
    console.warn("[FEATURES] No channelId provided for persistent features hub - skipping.");
    return false;
  }

  await store.ensureTable(client.db);

  const guildId =
    opts.guildId || cfg.FEATURES_GUILD_ID || (client.guilds.cache.first()?.id ?? "");
  if (!guildId) {
    console.warn("[FEATURES] No guild available - skipping.");
    return false;
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased?.()) {
    console.warn("[FEATURES] Channel not found or not text-based:", channelId);
    return false;
  }

  const categories = loadCategories();
  const payload = buildHubMessage(categories);
  const existing = await store.get(client.db, guildId, cfg.hubKey);

  if (existing?.message_id) {
    const message = await channel.messages.fetch(existing.message_id).catch(() => null);
    if (message) {
      await message.edit(payload).catch(() => null);
      return true;
    }
  }

  const sent = await channel.send(payload);
  await store.set(client.db, guildId, cfg.hubKey, channelId, sent.id);
  console.log(`[FEATURES] Created persistent hub message: ${sent.id} in #${channelId}`);
  return true;
}

async function rejectForeignPanel(interaction) {
  await interaction.reply({
    content: "This panel is not for you. Open your own from the hub.",
    flags: MessageFlags.Ephemeral,
  });
}

function buildHomePanel(categories) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId("features:open")
    .setPlaceholder("Select a feature category...")
    .addOptions(buildCategoryOptions(categories).length ? buildCategoryOptions(categories) : [{ label: "No categories", value: "none" }]);

  return {
    embeds: [buildHomeEmbed(categories)],
    components: [new ActionRowBuilder().addComponents(menu)],
  };
}

async function handleInteraction(interaction) {
  if (typeof interaction.customId !== "string") return false;
  const categories = loadCategories();

  if (interaction.isAnySelectMenu?.() && interaction.customId === "features:open") {
    const category = categories.find((entry) => entry.id === interaction.values?.[0]);
    if (!category) {
      await interaction.reply({
        content: "That category no longer exists.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    await interaction.reply({ ...buildCategoryPanel(interaction.user.id, category), flags: MessageFlags.Ephemeral });
    return true;
  }

  if (interaction.isAnySelectMenu?.() && interaction.customId.startsWith("features:section:")) {
    const [, , userId, catId] = interaction.customId.split(":");
    if (interaction.user.id !== userId) {
      await rejectForeignPanel(interaction);
      return true;
    }

    const category = categories.find((entry) => entry.id === catId);
    if (!category) {
      await interaction.update({ content: "This category was removed.", embeds: [], components: [] }).catch(() => null);
      return true;
    }

    const section = getCategorySections(category).find((entry) => entry.id === interaction.values?.[0]);
    if (!section) {
      await interaction.update(buildCategoryPanel(userId, category)).catch(() => null);
      return true;
    }

    await interaction.update(buildSectionPanel(userId, category, section)).catch(() => null);
    return true;
  }

  if (interaction.isAnySelectMenu?.() && interaction.customId.startsWith("features:entry:")) {
    const parts = interaction.customId.split(":");
    const userId = parts[2];
    const catId = parts[3];
    const sectionId = parts[4] || null;

    if (interaction.user.id !== userId) {
      await rejectForeignPanel(interaction);
      return true;
    }

    const category = categories.find((entry) => entry.id === catId);
    if (!category) {
      await interaction.update({ content: "This category was removed.", embeds: [], components: [] }).catch(() => null);
      return true;
    }

    const entries = sectionId ? getSectionEntries(category, sectionId).entries : (category.items || []);
    const entry = entries.find((item) => item.id === interaction.values?.[0]);
    if (!entry) {
      const fallback = sectionId
        ? buildSectionPanel(userId, category, getSectionEntries(category, sectionId).section || { id: sectionId, name: "Section" })
        : buildCategoryPanel(userId, category);
      await interaction.update(fallback).catch(() => null);
      return true;
    }

    await interaction.update(buildEntryPanel(userId, category, entry, { sectionId })).catch(() => null);
    return true;
  }

  if (interaction.isButton?.() && interaction.customId.startsWith("features:category:")) {
    const [, , userId, catId] = interaction.customId.split(":");
    if (interaction.user.id !== userId) {
      await rejectForeignPanel(interaction);
      return true;
    }

    const category = categories.find((entry) => entry.id === catId);
    if (!category) {
      await interaction.update({ content: "This category was removed.", embeds: [], components: [] }).catch(() => null);
      return true;
    }

    await interaction.update(buildCategoryPanel(userId, category)).catch(() => null);
    return true;
  }

  if (interaction.isButton?.() && interaction.customId.startsWith("features:sectionReturn:")) {
    const [, , userId, catId, sectionId] = interaction.customId.split(":");
    if (interaction.user.id !== userId) {
      await rejectForeignPanel(interaction);
      return true;
    }

    const category = categories.find((entry) => entry.id === catId);
    const section = category ? getCategorySections(category).find((entry) => entry.id === sectionId) : null;
    if (!category || !section) {
      await interaction.update({ content: "This section was removed.", embeds: [], components: [] }).catch(() => null);
      return true;
    }

    await interaction.update(buildSectionPanel(userId, category, section)).catch(() => null);
    return true;
  }

  if (interaction.isButton?.() && interaction.customId.startsWith("features:home:")) {
    const [, , userId] = interaction.customId.split(":");
    if (interaction.user.id !== userId) {
      await rejectForeignPanel(interaction);
      return true;
    }

    await interaction.update(buildHomePanel(categories)).catch(() => null);
    return true;
  }

  return false;
}

module.exports = {
  ensure,
  handleInteraction,
  loadCategories,
};
