// commands/setjail.js
const { SlashCommandBuilder } = require("discord.js");
const { setJail, getJailRelease, releaseJail } = require("../../utils/jail");

const JAIL_ADMIN_ROLE_ID = "741251069002121236";

function hasPermission(interaction) {
  return interaction.member?.roles?.cache?.has(JAIL_ADMIN_ROLE_ID);
}

async function clearJail(guildId, userId) {
  return releaseJail(guildId, userId, "admin_release");
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
        .setMaxValue(720)
        .setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("reason").setDescription("Reason (optional)").setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    if (!interaction.inGuild()) {
      return interaction.editReply("Server only.");
    }

    if (!hasPermission(interaction)) {
      return interaction.editReply("You do not have permission to use this command.");
    }

    const guildId = interaction.guildId;
    const target = interaction.options.getUser("user");
    const minutes = interaction.options.getInteger("minutes");
    const reason = interaction.options.getString("reason") || "Admin action";

    try {
      if (minutes === 0) {
        const released = await clearJail(guildId, target.id);
        const converted = released?.message ? `\n${released.message}` : "";
        return interaction.editReply(`Jail cleared for **${target.username}**.${converted}`);
      }

      const existingRelease = await getJailRelease(guildId, target.id);
      let totalMinutes = minutes;

      if (existingRelease) {
        const remainingMs = existingRelease.getTime() - Date.now();
        const remainingMin = Math.max(0, Math.ceil(remainingMs / 60000));
        totalMinutes += remainingMin;
      }

      const releaseAt = await setJail(guildId, target.id, totalMinutes, { effects: { admin: true } });

      return interaction.editReply(
        `**${target.username}** jailed\n` +
          `- Time: **${totalMinutes} minutes**\n` +
          `- Release: <t:${Math.floor(releaseAt.getTime() / 1000)}:R>\n` +
          `- Reason: *${reason}*`
      );
    } catch (err) {
      console.error("setjail error:", err);
      return interaction.editReply("Failed to modify jail time. Check logs.");
    }
  },
};
