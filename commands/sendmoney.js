// commands/sendmoney.js
const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { ensureUser, tryDebitUser, creditUser, getBalance } = require("../utils/economy");

// 🚔 Jail guard (optional but recommended if your economy uses it everywhere)
const { guardNotJailed } = require("../utils/jail");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("sendmoney")
    .setDescription("Send some of your money to another player.")
    .addUserOption((opt) =>
      opt.setName("user").setDescription("Who to send money to").setRequired(true)
    )
    .addIntegerOption((opt) =>
      opt
        .setName("amount")
        .setDescription("Amount to send")
        .setRequired(true)
        .setMinValue(1)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.inGuild()) return interaction.editReply("❌ Server only.");

    // 🚔 Jail gate
    if (await guardNotJailed(interaction)) return;

    const guildId = interaction.guildId;
    const fromId = interaction.user.id;

    const toUser = interaction.options.getUser("user", true);
    const toId = toUser.id;

    const amount = interaction.options.getInteger("amount", true);

    if (toUser.bot) return interaction.editReply("❌ You can’t send money to a bot.");
    if (toId === fromId) return interaction.editReply("❌ You can’t send money to yourself.");

    // Ensure both users exist in DB
    await ensureUser(guildId, fromId);
    await ensureUser(guildId, toId);

    // Debit sender
    const debit = await tryDebitUser(
      guildId,
      fromId,
      amount,
      "sendmoney_debit",
      { to: toId }
    );

    if (!debit.ok) {
      const bal = await getBalance(guildId, fromId);
      return interaction.editReply(
        `❌ You need **$${amount.toLocaleString()}**, but you only have **$${bal.toLocaleString()}**.`
      );
    }

    // Credit receiver
    await creditUser(
      guildId,
      toId,
      amount,
      "sendmoney_credit",
      { from: fromId }
    );

    return interaction.editReply(
      `✅ Sent **$${amount.toLocaleString()}** to **${toUser.username}**.`
    );
  },
};
