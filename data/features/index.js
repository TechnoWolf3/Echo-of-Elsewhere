const fs = require("fs");
const path = require("path");
const {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  MessageFlags,
} = require("discord.js");
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

function chunkLines(lines, maxLen = 1024) {
  const chunks = [];
  let current = "";

  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > maxLen) {
      if (current) chunks.push(current);
      current = line.length > maxLen ? line.slice(0, maxLen - 1) + "…" : line;
    } else {
      current = next;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function buildHubMessage(categories) {
  const embed = new EmbedBuilder()
    .setTitle(cfg.title)
    .setDescription(cfg.description)
    .setColor(cfg.color)
    .addFields({
      name: "Categories",
      value: categories.length
        ? categories
            .map(
              (c) =>
                `${c.emoji ? `${c.emoji} ` : ""}**${c.name}** — ${c.blurb || "—"}`
            )
            .join("\n")
            .slice(0, 1024)
        : "No categories found.",
    });

  const options = categories.slice(0, 25).map((c) => ({
    label: (c.name || "Unknown").slice(0, 100),
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
    const lines = items.map(
      (it, i) => `**${i + 1}. ${it.name || "Unknown"}** — ${it.short || "—"}`
    );
    const chunks = chunkLines(lines, 1024);

    embed.addFields(
      chunks.map((value, i) => ({
        name: i === 0 ? "Entries" : `Entries (cont. ${i + 1})`,
        value,
      }))
    );
  }

  const options = items.map((it, index) => ({
    label: (it.name || "Unknown").slice(0, 100),
    value: String(index),
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

async function ensure(client, opts = {}) {
  const channelId = opts.channelId || cfg.FEATURES_CHANNEL_ID;
  if (!channelId) {
    console.warn("[FEATURES] No channelId provided for persistent features hub — skipping.");
    return false;
  }

  await store.ensureTable(client.db);

  const guildId =
    opts.guildId || cfg.FEATURES_GUILD_ID || (client.guilds.cache.first()?.id ?? "");
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

  if (existing?.message_id) {
    const msg = await channel.messages.fetch(existing.message_id).catch(() => null);
    if (msg) {
      await msg.edit(payload).catch(() => null);
      return true;
    }
  }

  const sent = await channel.send(payload);
  await store.set(client.db, guildId, cfg.hubKey, channelId, sent.id);
  console.log(`[FEATURES] Created persistent hub message: ${sent.id} in #${channelId}`);
  return true;
}

async function handleInteraction(interaction) {
  if (!interaction.isAnySelectMenu?.()) return false;
  if (typeof interaction.customId !== "string") return false;

  const categories = loadCategories();

  if (interaction.customId === "features:open") {
    const catId = interaction.values?.[0];
    const category = categories.find((c) => c.id === catId);

    if (!category) {
      await interaction.reply({
        content: "❌ That category no longer exists.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const panel = buildCategoryPanel(interaction.user.id, category);
    await interaction.reply({ ...panel, flags: MessageFlags.Ephemeral });
    return true;
  }

  if (interaction.customId.startsWith("features:entry:")) {
    const parts = interaction.customId.split(":");
    if (parts.length < 4) return false;

    const userId = parts[2];
    const catId = parts[3];

    if (interaction.user.id !== userId) {
      await interaction.reply({
        content: "🚫 This panel isn’t for you — open your own from the hub.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const category = categories.find((c) => c.id === catId);
    if (!category) {
      await interaction.update({
        content: "❌ This category was removed.",
        embeds: [],
        components: [],
      }).catch(() => null);
      return true;
    }

    const selectedIndex = parseInt(interaction.values?.[0], 10);
    const entry = category.items?.[selectedIndex];

    if (!entry) {
      console.warn("[FEATURES] Invalid entry selection:", interaction.values?.[0], "for", catId);
      const panel = buildCategoryPanel(userId, category);
      await interaction.update(panel).catch(() => null);
      return true;
    }

    const panel = buildEntryPanel(userId, category, entry);
    await interaction.update(panel).catch(() => null);
    return true;
  }

  if (interaction.customId.startsWith("features:back:")) {
    const parts = interaction.customId.split(":");
    if (parts.length < 3) return false;

    const userId = parts[2];
    if (interaction.user.id !== userId) {
      await interaction.reply({
        content: "🚫 This panel isn’t for you — open your own from the hub.",
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const embed = new EmbedBuilder()
      .setTitle("✨ Bot Features — Categories")
      .setDescription("Pick a category to browse.")
      .setColor(cfg.color);

    const options = categories.slice(0, 25).map((c) => ({
      label: (c.name || "Unknown").slice(0, 100),
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
