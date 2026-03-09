const { SlashCommandBuilder } = require("discord.js");
const { pool } = require("../utils/db");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Show top 5 total wealth rankings."),

  async execute(interaction) {
    if (!interaction.inGuild()) return interaction.reply({ content: "❌ Server only.", ephemeral: true });

    const res = await pool.query(
      `SELECT user_id, balance, bank_balance, (balance + bank_balance) AS total_wealth
       FROM user_balances
       WHERE guild_id=$1
       ORDER BY total_wealth DESC
       LIMIT 5`,
      [interaction.guildId]
    );

    if (res.rowCount === 0) {
      return interaction.reply({ content: "No balances yet.", ephemeral: true });
    }

    const lines = await Promise.all(
      res.rows.map(async (r, idx) => {
        const medal = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"][idx] ?? "•";
        let name = "Unknown User";
        try {
          const user = await interaction.client.users.fetch(r.user_id);
          name = user.username;
        } catch {}
        return `${medal} ${name} — **$${Number(r.total_wealth).toLocaleString()}** total *(Wallet: $${Number(r.balance).toLocaleString()} | Bank: $${Number(r.bank_balance).toLocaleString()})*`;
      })
    );

    return interaction.reply({ content: `🏆 **Top 5 Total Wealth**\n${lines.join("\n")}` });
  },
};
