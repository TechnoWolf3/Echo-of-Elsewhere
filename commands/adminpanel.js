const { SlashCommandBuilder } = require("discord.js");
const adminPanel = require("../utils/adminPanel");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("adminpanel")
    .setDescription("Open the admin control panel."),

  async execute(interaction) {
    return adminPanel.execute(interaction);
  },
};