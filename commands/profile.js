const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ComponentType,
  MessageFlags,
} = require('discord.js');
const { pool } = require('../utils/db');
const economy = require('../utils/economy');

function n0(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function money(n) {
  const v = Math.floor(Math.max(0, n0(n)));
  return `$${v.toLocaleString('en-AU')}`;
}

function moneySigned(n) {
  const x = Math.floor(n0(n));
  const abs = Math.abs(x);
  const s = abs.toLocaleString('en-AU');
  if (x > 0) return `+$${s}`;
  if (x < 0) return `-$${s}`;
  return `$0`;
}

function fmtInt(n) {
  return `${Math.floor(n0(n)).toLocaleString('en-AU')}`;
}

function echoLine({ profit, totalJobs, rouletteWins, messages }) {
  // Light flavour; no roasting.
  const p = n0(profit);
  if (p >= 250000) return 'Echo approves. Your ledger hums with confidence.';
  if (p >= 50000) return 'You’ve got momentum. Echo is… watching.';
  if (p <= -100000) return 'The void stares back. Maybe take a breath before the next bet.';
  if (n0(rouletteWins) >= 25) return 'Roulette keeps calling your name. Echo hears it too.';
  if (n0(totalJobs) >= 100) return 'Relentless worker energy. Echo respects the grind.';
  if (n0(messages) >= 1500) return 'You talk. Echo listens. The server remembers.';
  return 'A snapshot of your server stats — more depths to come.';
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription('Show a server profile snapshot for a user')
    .addUserOption(o => o.setName('user').setDescription('User to view (defaults to you)')),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
    }

    const user = interaction.options.getUser('user') || interaction.user;
    const guildId = interaction.guildId;

    // Prefer server avatar if present (feels more personal)
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    const avatarUrl =
      member?.displayAvatarURL({ extension: 'png', size: 256 }) ??
      user.displayAvatarURL({ extension: 'png', size: 256 });

    // Balance
    const balance = await economy.getBalance(guildId, user.id).catch(() => 0);

    // Messages
    let messages = 0;
    try {
      const msgRes = await pool.query(
        `SELECT messages FROM message_stats WHERE guild_id=$1 AND user_id=$2`,
        [String(guildId), String(user.id)]
      );
      messages = msgRes.rows[0]?.messages ?? 0;
    } catch (_) {}

    // Jobs
    let totalJobs = 0;
    let jobXP = 0;
    let jobLevel = 1;
    try {
      const jobRes = await pool.query(
        `SELECT total_jobs, xp, level FROM job_progress WHERE guild_id=$1 AND user_id=$2`,
        [String(guildId), String(user.id)]
      );
      totalJobs = jobRes.rows[0]?.total_jobs ?? 0;
      jobXP = jobRes.rows[0]?.xp ?? 0;
      jobLevel = jobRes.rows[0]?.level ?? 1;
    } catch (_) {}

    // Roulette (existing table)
    let rouletteWins = 0;
    try {
      const roulRes = await pool.query(
        `SELECT wins FROM roulette_stats WHERE guild_id=$1 AND user_id=$2`,
        [String(guildId), String(user.id)]
      );
      rouletteWins = roulRes.rows[0]?.wins ?? 0;
    } catch (_) {}

    // Achievements
    let achievementCount = 0;
    try {
      const achRes = await pool.query(
        `SELECT COUNT(*)::int AS cnt FROM user_achievement_counters WHERE guild_id=$1 AND user_id=$2`,
        [String(guildId), String(user.id)]
      );
      achievementCount = achRes.rows[0]?.cnt ?? 0;
    } catch (_) {}

    // Economy summary from transactions
    let earned = 0;
    let spent = 0;
    let feesPaid = 0;
    try {
      const txRes = await pool.query(
        `SELECT
           COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END),0) AS earned,
           COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END),0) AS spent,
           COALESCE(SUM(CASE WHEN type ILIKE '%fine%' OR type ILIKE '%fee%' THEN CASE WHEN amount < 0 THEN -amount ELSE 0 END ELSE 0 END),0) AS fees_paid
         FROM transactions
         WHERE guild_id=$1 AND user_id=$2`,
        [String(guildId), String(user.id)]
      );
      earned = txRes.rows[0]?.earned ?? 0;
      spent = txRes.rows[0]?.spent ?? 0;
      feesPaid = txRes.rows[0]?.fees_paid ?? 0;
    } catch (_) {}

    const profit = n0(earned) - n0(spent) - n0(feesPaid);

    // --- Embed builders (hub + tabs) ---
    const buildOverview = () => {
      return new EmbedBuilder()
        .setAuthor({ name: `${user.username}'s Profile`, iconURL: avatarUrl })
        .setThumbnail(avatarUrl)
        .setDescription(echoLine({ profit, totalJobs, rouletteWins, messages }))
        .addFields(
          { name: 'Balance', value: money(balance), inline: true },
          { name: 'Lifetime Profit', value: moneySigned(profit), inline: true },
          { name: 'Achievements', value: fmtInt(achievementCount), inline: true },
          {
            name: 'Jobs',
            value: `Completed: **${fmtInt(totalJobs)}**\nLevel: **${fmtInt(jobLevel)}** (XP: ${fmtInt(jobXP)})`,
            inline: true,
          },
          { name: 'Casino (Quick)', value: `Roulette wins: **${fmtInt(rouletteWins)}**`, inline: true },
          {
            name: 'Economy Totals',
            value: `Earned: **${money(earned)}**\nSpent: **${money(spent)}**\nFees paid: **${money(feesPaid)}**`,
            inline: true,
          }
        )
        .setFooter({ text: 'Profile Hub • Use the menu to drill into categories' });
    };

    const buildEconomy = async () => {
      return new EmbedBuilder()
        .setAuthor({ name: `${user.username} • Economy`, iconURL: avatarUrl })
        .setThumbnail(avatarUrl)
        .addFields(
          { name: 'Balance', value: money(balance), inline: true },
          { name: 'Lifetime Profit', value: moneySigned(profit), inline: true },
          { name: 'Fees Paid', value: money(feesPaid), inline: true },
          { name: 'Totals', value: `Earned: **${money(earned)}**\nSpent: **${money(spent)}**`, inline: false }
        )
        .setFooter({ text: 'Economy • Totals are based on your transaction log' });
    };

    const buildCasino = async () => {
      return new EmbedBuilder()
        .setAuthor({ name: `${user.username} • Casino`, iconURL: avatarUrl })
        .setThumbnail(avatarUrl)
        .setDescription('More casino breakdowns can be added as each game exposes stats.')
        .addFields(
          { name: 'Roulette Wins', value: fmtInt(rouletteWins), inline: true },
          { name: 'Lifetime Profit', value: moneySigned(profit), inline: true },
          { name: 'Balance', value: money(balance), inline: true }
        )
        .setFooter({ text: 'Casino • This tab will expand as more game stats are tracked' });
    };

    const buildJobs = async () => {
      return new EmbedBuilder()
        .setAuthor({ name: `${user.username} • Jobs`, iconURL: avatarUrl })
        .setThumbnail(avatarUrl)
        .addFields(
          { name: 'Completed Jobs', value: fmtInt(totalJobs), inline: true },
          { name: 'Level', value: fmtInt(jobLevel), inline: true },
          { name: 'XP', value: fmtInt(jobXP), inline: true }
        )
        .setFooter({ text: 'Jobs • More insights can be layered in (best payout, favourite category, etc.)' });
    };

    const buildAchievements = async () => {
      return new EmbedBuilder()
        .setAuthor({ name: `${user.username} • Achievements`, iconURL: avatarUrl })
        .setThumbnail(avatarUrl)
        .setDescription('Want this tab to list your latest unlocks? Easy add once we confirm the achievement tables you’re using.')
        .addFields({ name: 'Unlocked', value: fmtInt(achievementCount), inline: true })
        .setFooter({ text: 'Achievements • Snapshot' });
    };

    const buildStatement = async () => {
      let rows = [];
      try {
        const res = await pool.query(
          `SELECT amount, type, created_at
           FROM transactions
           WHERE guild_id=$1 AND user_id=$2
           ORDER BY created_at DESC
           LIMIT 10`,
          [String(guildId), String(user.id)]
        );
        rows = res.rows ?? [];
      } catch (_) {
        rows = [];
      }

      const lines = rows.map(r => {
        const amt = n0(r.amount);
        const when = r.created_at ? Math.floor(new Date(r.created_at).getTime() / 1000) : null;
        const t = when ? `<t:${when}:R>` : '';
        const signAmt = amt >= 0 ? `+${money(amt)}` : `-${money(-amt)}`;
        const label = String(r.type ?? 'unknown').replace(/_/g, ' ');
        return `• **${label}** — ${signAmt} ${t}`.trim();
      });

      return new EmbedBuilder()
        .setAuthor({ name: `${user.username} • Statement`, iconURL: avatarUrl })
        .setThumbnail(avatarUrl)
        .setDescription(lines.length ? lines.join('\n') : 'No transactions logged yet.')
        .setFooter({ text: 'Statement • Last 10 transactions' });
    };

    // --- Components ---
    const customId = `profile_menu:${interaction.id}`;
    const menu = new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder('Choose a profile tab…')
      .addOptions(
        { label: 'Overview', value: 'overview', description: 'The quick snapshot (default)' },
        { label: 'Casino', value: 'casino', description: 'Game stats & gambling summary' },
        { label: 'Jobs', value: 'jobs', description: 'Work progress & XP' },
        { label: 'Economy', value: 'economy', description: 'Earnings, spending, fees, profit' },
        { label: 'Achievements', value: 'achievements', description: 'Unlocked achievements snapshot' },
        { label: 'Statement', value: 'statement', description: 'Recent transaction history' }
      );

    const row = new ActionRowBuilder().addComponents(menu);

    await interaction.reply({ embeds: [buildOverview()], components: [row], ephemeral: false });

    const msg = await interaction.fetchReply().catch(() => null);
    if (!msg) return;

    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      time: 5 * 60 * 1000,
      filter: (i) => i.customId === customId,
    });

    collector.on('collect', async (i) => {
      // Only the command invoker can drive the UI (others can still *view* the embed).
      if (i.user.id !== interaction.user.id) {
        return i.reply({ content: `Only **${interaction.user.username}** can use this profile menu.`, flags: MessageFlags.Ephemeral });
      }

      const v = i.values?.[0] ?? 'overview';
      try {
        // ACK immediately to avoid "Unknown interaction" if DB queries take >3s.
        await i.deferUpdate();

        let next;
        if (v === 'overview') next = buildOverview();
        else if (v === 'casino') next = await buildCasino();
        else if (v === 'jobs') next = await buildJobs();
        else if (v === 'economy') next = await buildEconomy();
        else if (v === 'achievements') next = await buildAchievements();
        else if (v === 'statement') next = await buildStatement();
        else next = buildOverview();

        // Edit the original reply message (safe after deferUpdate)
        await i.editReply({ embeds: [next], components: [row] });
        return;
      } catch (_) {
        // If something goes wrong after deferUpdate, fall back to an ephemeral notice.
        return i.followUp({ content: 'Something went wrong updating that tab.', flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    });

    collector.on('end', async () => {
      try {
        const disabled = new ActionRowBuilder().addComponents(menu.setDisabled(true));
        await msg.edit({ components: [disabled] });
      } catch (_) {}
    });
  },
};
