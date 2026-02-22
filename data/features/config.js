// data/features/config.js
module.exports = {
  // Optional defaults (you can ignore these if you pass channelId/guildId from root index.js)
  FEATURES_CHANNEL_ID: "1467848400555999264",
  FEATURES_GUILD_ID: "737136423269826560",

  // DB key used to store the hub message reference
  hubKey: "features_hub",

  // UI bits
  title: "✨ The Place — Bot Features",
  description: `Pick a category below to see what Echo can do.\n\nYou’ll get a clean panel you can scroll through.\n\n⚙️ This hub auto-refreshes on bot restart so new features show up automatically.`,

  color: 0x0875AF, // Server blue.
};
