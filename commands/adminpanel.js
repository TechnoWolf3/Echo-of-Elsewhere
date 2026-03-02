// commands/adminpanel.js
const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const adminPanel = require("../utils/adminPanel");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("adminpanel")
    .setDescription("Bot Master control panel"),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: "❌ This only works in a server.", flags: MessageFlags.Ephemeral });
    }

    // Role gate — cheeky.
    if (!adminPanel.isBotMaster(interaction.member)) {
      return interaction.reply({ content: adminPanel.naughtyMessage(), flags: MessageFlags.Ephemeral });
    }

    // Not ephemeral by request — but buttons are still hard-locked server-side.
    return interaction.reply(adminPanel.render("home"));
  },
};
