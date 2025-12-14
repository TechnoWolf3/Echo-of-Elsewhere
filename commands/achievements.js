// commands/achievements.js
const {
  SlashCommandBuilder,
  MessageFlags,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const PAGE_SIZE = 12; // tweak if you want more/less per page

module.exports = {
  data: new SlashCommandBuilder()
    .setName("achievements")
    .setDescription("View achievements and what a user has unlocked.")
    .addUserOption((opt) =>
      opt
        .setName("user")
        .setDescription("Whose achievements to view (defaults to you).")
        .setRequired(false)
    )
    .addBooleanOption((opt) =>
      opt
        .setName("public")
        .setDescription("Post publicly in the channel (default: false / ephemeral).")
        .setRequired(false)
    ),

  async execute(interaction) {
    const guildId = interaction.guildId;
    if (!interaction.inGuild()) return interaction.reply({ content: "❌ Server only." }).catch(() => {});

    const targetUser = interaction.options.getUser("user") ?? interaction.user;
    const isPublic = interaction.options.getBoolean("public") ?? false;

    // Prefer ephemeral by default
    const replyOpts = isPublic ? {} : { flags: MessageFlags.Ephemeral };

    await interaction.deferReply(replyOpts).catch(() => {});

    const db = interaction.client.db;
    if (!db) return interaction.editReply("❌ Database not configured (DATABASE_URL missing).").catch(() => {});

    // 1) Fetch all achievements
    const all = await db.query(
      `SELECT id, name, description, category, hidden, reward_coins
       FROM achievements
       ORDER BY category ASC, name ASC`
    );

    const achievements = all.rows || [];
    if (!achievements.length) {
      return interaction.editReply("No achievements found yet.").catch(() => {});
    }

    // 2) Fetch user's unlocked achievements
    const unlockedRes = await db.query(
      `SELECT achievement_id
       FROM user_achievements
       WHERE guild_id = $1 AND user_id = $2`,
      [guildId, targetUser.id]
    );

    const unlockedSet = new Set((unlockedRes.rows || []).map((r) => r.achievement_id));

    // 3) Build pages
    const pages = buildPages({ achievements, unlockedSet, targetUser });

    let pageIndex = 0;

    const message = await interaction.editReply({
      embeds: [pages[pageIndex]],
      components: pages.length > 1 ? [buildRow(pageIndex, pages.length, interaction.user.id, targetUser.id, isPublic)] : [],
      ...(isPublic ? {} : { flags: MessageFlags.Ephemeral }),
    }).catch(() => null);

    if (!message || pages.length <= 1) return;

    // 4) Button pagination (only the command invoker can flip pages)
    const collector = message.createMessageComponentCollector({
      time: 3 * 60_000,
    });

    collector.on("collect", async (btn) => {
      try {
        const [prefix, action, invokerId, viewedUserId] = btn.customId.split(":");
        if (prefix !== "ach") return;

        // Only invoker can use the buttons
        if (btn.user.id !== invokerId) {
          return btn.reply({ content: "❌ Only the person who ran the command can use these buttons.", flags: MessageFlags.Ephemeral })
            .catch(() => {});
        }

        // If someone tries to use old buttons on a different target, ignore
        if (viewedUserId !== targetUser.id) {
          return btn.reply({ content: "❌ Those buttons don’t match this view.", flags: MessageFlags.Ephemeral }).catch(() => {});
        }

        await btn.deferUpdate().catch(() => {});

        if (action === "prev") pageIndex = Math.max(0, pageIndex - 1);
        if (action === "next") pageIndex = Math.min(pages.length - 1, pageIndex + 1);

        await interaction.editReply({
          embeds: [pages[pageIndex]],
          components: [buildRow(pageIndex, pages.length, interaction.user.id, targetUser.id, isPublic)],
          ...(isPublic ? {} : { flags: MessageFlags.Ephemeral }),
        }).catch(() => {});
      } catch (e) {
        console.error("Achievements pager error:", e);
      }
    });

    collector.on("end", async () => {
      // Disable buttons when collector ends
      try {
        await interaction.editReply({
          components: [],
          ...(isPublic ? {} : { flags: MessageFlags.Ephemeral }),
        }).catch(() => {});
      } catch {}
    });
  },
};

function buildRow(pageIndex, totalPages, invokerId, viewedUserId, isPublic) {
  // same buttons for public/ephemeral; behavior controlled by invoker lock above
  const prev = new ButtonBuilder()
    .setCustomId(`ach:prev:${invokerId}:${viewedUserId}`)
    .setLabel("Prev")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(pageIndex <= 0);

  const next = new ButtonBuilder()
    .setCustomId(`ach:next:${invokerId}:${viewedUserId}`)
    .setLabel("Next")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(pageIndex >= totalPages - 1);

  return new ActionRowBuilder().addComponents(prev, next);
}

function buildPages({ achievements, unlockedSet, targetUser }) {
  // Create display lines with category headers
  const lines = [];
  let currentCategory = null;

  let unlockedCount = 0;

  for (const a of achievements) {
    const cat = a.category || "General";
    if (cat !== currentCategory) {
      currentCategory = cat;
      lines.push(`\n__**${currentCategory}**__`);
    }

    const unlocked = unlockedSet.has(a.id);
    if (unlocked) unlockedCount++;

    const reward = Number(a.reward_coins || 0);
    const rewardText = reward > 0 ? ` (+$${reward.toLocaleString()})` : "";

    // Hide details if hidden and not unlocked
    if (a.hidden && !unlocked) {
      lines.push(`⬜ 🔒 Hidden achievement`);
      continue;
    }

    const mark = unlocked ? "✅" : "🔒";
    lines.push(`${mark} **${a.name}**${rewardText} — ${a.description}`);
  }

  const total = achievements.length;
  const progress = `${unlockedCount}/${total}`;

  // Split into pages
  const chunks = chunkLines(lines, PAGE_SIZE);

  return chunks.map((chunk, idx) => {
    return new EmbedBuilder()
      .setTitle(`🏆 Achievements — ${targetUser.username}`)
      .setDescription(chunk.join("\n").trim())
      .setFooter({ text: `Progress: ${progress} • Page ${idx + 1}/${chunks.length}` });
  });
}

function chunkLines(lines, size) {
  // Keep category headers from being orphaned alone at the bottom:
  // If a chunk ends with a header line, move it to next chunk.
  const chunks = [];
  let buf = [];

  for (const line of lines) {
    buf.push(line);

    if (buf.length >= size) {
      // If last line is a header, shift it to next page
      const last = buf[buf.length - 1];
      if (isHeader(last) && buf.length > 1) {
        const header = buf.pop();
        chunks.push(buf);
        buf = [header];
      } else {
        chunks.push(buf);
        buf = [];
      }
    }
  }

  if (buf.length) chunks.push(buf);
  return chunks;
}

function isHeader(line) {
  return typeof line === "string" && line.startsWith("\n__**") && line.endsWith("**__");
}
