const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
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

module.exports = {
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription('Show a server profile snapshot for a user')
    .addUserOption(o => o.setName('user').setDescription('User to view (defaults to you)')),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    }

    const user = interaction.options.getUser('user') || interaction.user;
    const guildId = interaction.guildId;

    // Balance
    const balance = await economy.getBalance(guildId, user.id).catch(() => 0);

    // Messages
    const msgRes = await pool.query(
      `SELECT messages FROM message_stats WHERE guild_id=$1 AND user_id=$2`,
      [String(guildId), String(user.id)]
    );
    const messages = msgRes.rows[0]?.messages ?? 0;

    // Jobs
    const jobRes = await pool.query(
      `SELECT total_jobs, xp, level FROM job_progress WHERE guild_id=$1 AND user_id=$2`,
      [String(guildId), String(user.id)]
    );
    const totalJobs = jobRes.rows[0]?.total_jobs ?? 0;
    const jobXP = jobRes.rows[0]?.xp ?? 0;
    const jobLevel = jobRes.rows[0]?.level ?? 1;

    // Roulette (existing table)
    const roulRes = await pool.query(
      `SELECT wins FROM roulette_stats WHERE guild_id=$1 AND user_id=$2`,
      [String(guildId), String(user.id)]
    );
    const rouletteWins = roulRes.rows[0]?.wins ?? 0;

    // Achievements
    const achRes = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM user_achievement_counters WHERE guild_id=$1 AND user_id=$2`,
      [String(guildId), String(user.id)]
    );
    const achievementCount = achRes.rows[0]?.cnt ?? 0;

    // Economy summary from transactions
    const txRes = await pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END),0) AS earned,
         COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END),0) AS spent,
         COALESCE(SUM(CASE WHEN type ILIKE '%fine%' OR type ILIKE '%fee%' THEN CASE WHEN amount < 0 THEN -amount ELSE 0 END ELSE 0 END),0) AS fees_paid
       FROM transactions
       WHERE guild_id=$1 AND user_id=$2`,
      [String(guildId), String(user.id)]
    );
    const earned = txRes.rows[0]?.earned ?? 0;
    const spent = txRes.rows[0]?.spent ?? 0;
    const feesPaid = txRes.rows[0]?.fees_paid ?? 0;

    const embed = new EmbedBuilder()
      .setTitle(`${user.username}'s Profile`)
      .setDescription('A snapshot of your server stats (more coming soon).')
      .addFields(
        { name: 'Balance', value: money(balance), inline: true },
        { name: 'Messages', value: `${messages.toLocaleString('en-AU')}`, inline: true },
        { name: 'Achievements', value: `${achievementCount}`, inline: true },
        { name: 'Jobs', value: `Completed: **${totalJobs}**\nLevel: **${jobLevel}** (XP: ${jobXP})`, inline: false },
        { name: 'Casino', value: `Roulette wins: **${rouletteWins}**`, inline: true },
        { name: 'Economy Totals', value: `Earned: **${money(earned)}**\nSpent: **${money(spent)}**\nFees paid: **${money(feesPaid)}**`, inline: true },
      );

    return interaction.reply({ embeds: [embed], ephemeral: false });
  },
};
