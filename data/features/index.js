// data/features/index.js
const fs = require("fs");
const path = require("path");
const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, MessageFlags } = require("discord.js");
const cfg = require("./config");
const store = require("./store");

function loadCategories() {
  const dir = path.join(__dirname, "categories");
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js"));
  const cats = [];

  for (const file of files) {
    const p = path.join(dir, file);
    try {
      delete require.cache[require.resolve(p)];
      const mod = require(p);

      if (!mod?.id || !mod?.name || !Array.isArray(mod.items)) {
        console.warn(`[FEATURES] Skipped ${file}: missing id/name/items[]`);
        continue;
      }
      cats.push(mod);
    } catch (e) {
      console.error(`[FEATURES] Failed to load ${file}:`, e);
    }
  }

  cats.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  return cats;
}

function buildHubMessage(categories) {
  const embed = new EmbedBuilder()
    .setTitle(cfg.title)
    .setDescription(cfg.description)
    .setColor(cfg.color)
    .addFields(
      {
        name: "Categories",
        value:
          categories.length
            ? categories.map((c) => `${c.emoji ? `${c.emoji} ` : ""}**${c.name}** — ${c.blurb || "—"}`).join("\n")
            : "No categories found.",
      }
    );

  const options = categories.slice(0, 25).map((c) => ({
    label: c.name.slice(0, 100),
    value: c.id,
    description: (c.blurb || "View details").slice(0, 100),
    emoji: c.emoji || undefined,
  }));

  const menu = new StringSelectMenuBuilder()
    .setCustomId("features:open")
    .setPlaceholder("Select a feature category…")
    .addOptions(options.length ? options : [{ label: "No categories", value: "none" }]);

  const row = new ActionRowBuilder().addComponents(menu);

  return { embeds: [embed], components: [row] };
}

function buildCategoryPanel(userId, category) {
  const embed = new EmbedBuilder()
    .setTitle(`${category.emoji ? `${category.emoji} ` : ""}${category.name}`)
    .setDescription(category.description || category.blurb || "—")
    .setColor(cfg.color);

  const items = (category.items || []).slice(0, 25);

  if (!items.length) {
    embed.addFields({ name: "Nothing here yet", value: "This category has no entries." });
  } else {
    embed.addFields({
      name: "Entries",
      value: items.map((it, i) => `**${i + 1}. ${it.name}** — ${it.short || "—"}`).join("\n"),
    });
  }

  // Select to open an entry
  const options = items.map((it) => ({
    label: it.name.slice(0, 100),
    value: it.id,
    description: (it.short || "Open").slice(0, 100),
  }));

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`features:entry:${userId}:${category.id}`)
    .setPlaceholder("Open an entry…")
    .addOptions(options.length ? options : [{ label: "No entries", value: "none" }]);

  const row = new ActionRowBuilder().addComponents(menu);

  return { embeds: [embed], components: [row] };
}

function buildEntryPanel(userId, category, entry) {
  const embed = new EmbedBuilder()
    .setTitle(`${category.emoji ? `${category.emoji} ` : ""}${category.name} • ${entry.name}`)
    .setDescription(entry.detail || entry.short || "—")
    .setColor(cfg.color);

  const backMenu = new StringSelectMenuBuilder()
    .setCustomId(`features:back:${userId}`)
    .setPlaceholder("Back to categories…")
    .addOptions([{ label: "Back to categories", value: "back" }]);

  const row = new ActionRowBuilder().addComponents(backMenu);

  return { embeds: [embed], components: [row] };
}

/**
 * Ensure the persistent hub message exists in the configured channel and is refreshed.
 * - Creates the DB table if needed
 * - Upserts the message reference
 * - Edits the existing message on restart so new features appear automatically
 */
async function ensure(client) {
  const channelId = cfg.FEATURES_CHANNEL_ID;
  if (!channelId) {
    console.warn("[FEATURES] FEATURES_CHANNEL_ID not set — skipping persistent features hub.");
    return false;
  }

  await store.ensureTable(client.db);

  // Which guild is the hub in?
  const guildId = cfg.FEATURES_GUILD_ID || (client.guilds.cache.first()?.id ?? "");
  if (!guildId) {
    console.warn("[FEATURES] No guild available — skipping.");
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

  // Try edit existing message
  if (existing?.message_id) {
    const msg = await channel.messages.fetch(existing.message_id).catch(() => null);
    if (msg) {
      await msg.edit(payload).catch(() => null);
      return true;
    }
  }

  // Otherwise create a new one and store it
  const sent = await channel.send(payload);
  await store.set(client.db, guildId, cfg.hubKey, channelId, sent.id);
  console.log(`[FEATURES] Created persistent hub message: ${sent.id} in #${channelId}`);
  return true;
}

/**
 * Global interaction handler for the features hub.
 * Returns true if handled.
 */
async function handleInteraction(interaction) {
  if (!interaction.isAnySelectMenu?.()) return false;
  if (typeof interaction.customId !== "string") return false;

  const categories = loadCategories();

  // Public hub menu → open user-scoped panel
  if (interaction.customId === "features:open") {
    const catId = interaction.values?.[0];
    const category = categories.find((c) => c.id === catId);

    if (!category) {
      await interaction.reply({ content: "❌ That category no longer exists.", flags: MessageFlags.Ephemeral });
      return true;
    }

    const panel = buildCategoryPanel(interaction.user.id, category);
    await interaction.reply({ ...panel, flags: MessageFlags.Ephemeral });
    return true;
  }

  // Entry picker (user scoped)
  if (interaction.customId.startsWith("features:entry:")) {
    const parts = interaction.customId.split(":"); // features:entry:<userId>:<catId>
    if (parts.length < 4) return false;

    const userId = parts[2];
    const catId = parts[3];

    if (interaction.user.id !== userId) {
      await interaction.reply({ content: "🚫 This panel isn’t for you — open your own from the hub.", flags: MessageFlags.Ephemeral });
      return true;
    }

    const category = categories.find((c) => c.id === catId);
    if (!category) {
      await interaction.update({ content: "❌ This category was removed.", embeds: [], components: [] }).catch(() => null);
      return true;
    }

    const entryId = interaction.values?.[0];
    const entry = (category.items || []).find((it) => it.id === entryId);

    if (!entry) {
      const panel = buildCategoryPanel(userId, category);
      await interaction.update(panel).catch(() => null);
      return true;
    }

    const panel = buildEntryPanel(userId, category, entry);
    await interaction.update(panel).catch(() => null);
    return true;
  }

  // Back to categories (user scoped)
  if (interaction.customId.startsWith("features:back:")) {
    const parts = interaction.customId.split(":"); // features:back:<userId>
    if (parts.length < 3) return false;

    const userId = parts[2];
    if (interaction.user.id !== userId) {
      await interaction.reply({ content: "🚫 This panel isn’t for you — open your own from the hub.", flags: MessageFlags.Ephemeral });
      return true;
    }

    // Show category chooser again (as a small panel)
    const embed = new EmbedBuilder()
      .setTitle("✨ Bot Features — Categories")
      .setDescription("Pick a category to browse.")
      .setColor(cfg.color);

    const options = categories.slice(0, 25).map((c) => ({
      label: c.name.slice(0, 100),
      value: c.id,
      description: (c.blurb || "View details").slice(0, 100),
      emoji: c.emoji || undefined,
    }));

    const menu = new StringSelectMenuBuilder()
      .setCustomId("features:open")
      .setPlaceholder("Select a feature category…")
      .addOptions(options.length ? options : [{ label: "No categories", value: "none" }]);

    const row = new ActionRowBuilder().addComponents(menu);

    await interaction.update({ embeds: [embed], components: [row] }).catch(() => null);
    return true;
  }

  return false;
}

module.exports = {
  ensure,
  handleInteraction,
  loadCategories,
};
