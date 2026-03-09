// admin/legacy_commands/addbalance.js
const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const REQUIRED_ROLE_ID = "741251069002121236";

function getDbQuery() {
  const db = require("../../utils/db");
  if (typeof db.query === "function") return db.query.bind(db);
  if (db.pool && typeof db.pool.query === "function") return db.pool.query.bind(db.pool);
  throw new Error("utils/db.js must export either { query } or { pool }");
}

function hasRequiredRole(member) {
  return member?.roles?.cache?.has(REQUIRED_ROLE_ID);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("addbalance")
    .setDescription("Add money to a user's wallet or bank (restricted role only).")
    .addUserOption((opt) => opt.setName("user").setDescription("User to credit").setRequired(true))
    .addIntegerOption((opt) => opt.setName("amount").setDescription("Amount to add").setRequired(true).setMinValue(1))
    .addStringOption((opt) =>
      opt
        .setName("target")
        .setDescription("Where the money should go")
        .setRequired(false)
        .addChoices({ name: "Wallet", value: "wallet" }, { name: "Bank", value: "bank" })
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

    try {
      if (!interaction.inGuild()) return interaction.editReply("❌ This command can only be used in a server.");
      if (!hasRequiredRole(interaction.member)) return interaction.editReply("❌ You don’t have permission to use this command.");

      const target = interaction.options.getUser("user", true);
      const amount = interaction.options.getInteger("amount", true);
      const balanceTarget = String(interaction.options.getString("target") || "wallet").toLowerCase() === "bank" ? "bank" : "wallet";
      if (!Number.isFinite(amount) || amount <= 0) return interaction.editReply("❌ Amount must be a positive number.");

      const query = getDbQuery();
      const guildId = interaction.guildId;
      const userId = target.id;
      const amountCol = balanceTarget === "bank" ? "bank_balance" : "balance";

      await query(`INSERT INTO guilds (guild_id) VALUES ($1) ON CONFLICT (guild_id) DO NOTHING`, [guildId]);
      await query(`INSERT INTO user_balances (guild_id, user_id) VALUES ($1, $2) ON CONFLICT (guild_id, user_id) DO NOTHING`, [guildId, userId]);

      const updated = await query(
        `UPDATE user_balances
         SET ${amountCol} = ${amountCol} + $3
         WHERE guild_id=$1 AND user_id=$2
         RETURNING balance, bank_balance`,
        [guildId, userId, amount]
      );

      const row = updated.rows?.[0] || {};
      const newBal = Number(balanceTarget === "bank" ? row.bank_balance : row.balance);

      await query(
        `INSERT INTO transactions (guild_id, user_id, amount, type, meta)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          guildId,
          userId,
          amount,
          balanceTarget === "bank" ? "admin_addbank_mint" : "admin_addbalance_mint",
          JSON.stringify({ by: interaction.user.id, to: userId, channelId: interaction.channelId, balance_type: balanceTarget }),
        ]
      );

      return interaction.editReply(
        `✅ Added **$${amount.toLocaleString()}** to ${target}'s **${balanceTarget}**.
` +
          `New ${balanceTarget}: **$${newBal.toLocaleString()}**`
      );
    } catch (err) {
      console.error("AddBalance crashed:", err);
      return interaction.editReply("❌ Something went wrong running that command. Check Railway logs.");
    }
  },
};
