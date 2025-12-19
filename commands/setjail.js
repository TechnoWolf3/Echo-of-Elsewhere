// commands/setjail.js
const { SlashCommandBuilder } = require("discord.js");
const { setJail, getJailRelease } = require("../utils/jail");
const { pool } = require("../utils/db");

const JAIL_ADMIN_ROLE_ID = "741251069002121236";

function hasPermission(interaction) {
  return interaction.member?.roles?.cache?.has(JAIL_ADMIN_ROLE_ID);
}

async function clearJail(guildId, userId) {
  await pool.query(
    `DELETE FROM jail WHERE guild_id = $1 AND user_id = $2`,
    [guildId, userId]
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setjail")
    .setDescription("Admin: set, extend, or clear jail time for a user.")
    .addUserOption((o) =>
      o.setName("user").setDescription("User to jail / modify").setRequired(true)
    )
    .addIntegerOption((o) =>
      o
        .setName("minutes")
        .setDescription("Minutes to jail. Use 0 to clear jail.")
        .setMinValue(0)
        .setMaxValue(720) // safety cap: 12 hours
        .setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("reason").setDescription("Reason (optional)").setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    if (!interaction.inGuild()) {
      return interaction.editReply("❌ Server only.");
    }

    if (!hasPermission(interaction)) {
      return interaction.editReply("❌ You do not have permission to use this command.");
    }

    const guildId = interaction.guildId;
    const target = interaction.options.getUser("user");
    const minutes = interaction.options.getInteger("minutes");
    const reason = interaction.options.getString("reason") || "Admin action";

    try {
      // CLEAR JAIL
      if (minutes === 0) {
        await clearJail(guildId, target.id);
        return interaction.editReply(`🟢 Jail cleared for **${target.username}**.`);
      }

      // EXTEND if already jailed
      const existingRelease = await getJailRelease(guildId, target.id);
      let totalMinutes = minutes;

      if (existingRelease) {
        const remainingMs = existingRelease.getTime() - Date.now();
        const remainingMin = Math.max(0, Math.ceil(remainingMs / 60000));
        totalMinutes += remainingMin;
      }

      // setJail expects minutes from NOW (not a Date)
      const releaseAt = await setJail(guildId, target.id, totalMinutes);

      return interaction.editReply(
        `⛓️ **${target.username}** jailed\n` +
          `• Time: **${totalMinutes} minutes**\n` +
          `• Release: <t:${Math.floor(releaseAt.getTime() / 1000)}:R>\n` +
          `• Reason: *${reason}*`
      );
    } catch (err) {
      console.error("setjail error:", err);
      return interaction.editReply("❌ Failed to modify jail time. Check logs.");
    }
  },
};
