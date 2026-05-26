const { SlashCommandBuilder, MessageFlags } = require("discord.js");

function apiBaseUrl() {
  return String(
    process.env.ECHO_API_URL ||
    process.env.EXPO_PUBLIC_ECHO_API_URL ||
    `http://127.0.0.1:${process.env.PORT || 3000}`
  ).replace(/\/+$/g, "");
}

function displayNameFor(interaction) {
  return (
    interaction.member?.displayName ||
    interaction.user.globalName ||
    interaction.user.username ||
    "Echo Player"
  );
}

async function readApiError(response) {
  const text = await response.text().catch(() => "");
  try {
    const json = JSON.parse(text);
    return json.message || json.error || text;
  } catch {
    return text || `API returned ${response.status}.`;
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("link")
    .setDescription("Link your Discord economy profile to the Echo mobile app.")
    .addStringOption((option) =>
      option
        .setName("code")
        .setDescription("The Echo app link code, like ECHO-482913.")
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!interaction.inGuild()) {
      await interaction.editReply("This command can only be used inside the Echo server.");
      return;
    }

    const code = String(interaction.options.getString("code", true) || "").trim().toUpperCase();
    const baseUrl = apiBaseUrl();

    try {
      const response = await fetch(`${baseUrl}/v1/link-codes/${encodeURIComponent(code)}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          discord_user_id: interaction.user.id,
          display_name: displayNameFor(interaction),
          guild_id: interaction.guildId,
        }),
      });

      if (!response.ok) {
        const message = await readApiError(response);
        await interaction.editReply(message || "Link failed.");
        return;
      }

      await interaction.editReply("Linked. Your Echo app now follows this ledger.");
    } catch (error) {
      console.error("[/link] API call failed:", error);
      await interaction.editReply("Link failed because Echo could not reach the Railway API.");
    }
  },
};
