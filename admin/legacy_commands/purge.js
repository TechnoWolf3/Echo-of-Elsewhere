// commands/purge.js
const {
  SlashCommandBuilder,
  MessageFlags,
} = require("discord.js");

const BOT_MASTER_ROLE_ID = "741251069002121236";

function isBotMaster(member) {
  return member?.roles?.cache?.has?.(BOT_MASTER_ROLE_ID);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("purge")
    .setDescription("Delete a number of recent messages in this channel (admin only).")
    .addIntegerOption((opt) =>
      opt
        .setName("amount")
        .setDescription("How many messages to delete (1–200).")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(200)
    )
    // NOTE: This file is no longer deployed as a slash command.
    // Permissions are enforced by the Admin Panel + this role gate.

  async execute(interaction) {
    // ✅ ALWAYS ACK FAST
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

    try {
      // Must be in a server channel
      if (!interaction.inGuild()) {
        return interaction.editReply("❌ This command can only be used in a server channel.");
      }

      // Role gate
      if (!isBotMaster(interaction.member)) {
        return interaction.editReply("❌ You don’t have permission to do that.");
      }

      const amount = interaction.options.getInteger("amount", true);

      const channel = interaction.channel;
      if (!channel || !channel.bulkDelete) {
        return interaction.editReply("❌ I can’t bulk delete messages in this channel type.");
      }

      // Discord bulkDelete max is 100 per call, and won’t delete messages older than 14 days.
      let remaining = amount;
      let totalDeleted = 0;

      while (remaining > 0) {
        const batch = Math.min(100, remaining);

        const deleted = await channel.bulkDelete(batch, true);
        totalDeleted += deleted.size;
        remaining -= batch;

        // If nothing deleted, we hit the end or 14-day limit
        if (deleted.size === 0) break;
      }

      return interaction.editReply(
        `✅ Purge complete. Deleted **${totalDeleted}** message(s).\n` +
        (totalDeleted < amount
          ? `\nNote: Discord won’t bulk delete messages older than **14 days**, and can only delete what exists.`
          : "")
      );
    } catch (err) {
      console.error("Purge command error:", err);
      return interaction.editReply(
        "❌ Purge failed. Make sure the bot has **Manage Messages** + **Read Message History** in this channel."
      );
    }
  },
};
