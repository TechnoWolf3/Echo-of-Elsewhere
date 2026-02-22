// data/features/config.js
module.exports = {
  // Channel where the persistent "Bot Features" hub message should live
  // (Set via Railway ENV if you prefer)
  FEATURES_CHANNEL_ID: process.env.FEATURES_CHANNEL_ID || "",

  // Optional: lock setup to a single guild (recommended if your bot is in multiple)
  FEATURES_GUILD_ID: process.env.FEATURES_GUILD_ID || "",

  // DB key used to store the hub message reference
  hubKey: "features_hub",

  // UI bits
  title: "✨ The Place — Bot Features",
  description:
    "Pick a category below to see what Echo can do.
" +
    "You’ll get a clean panel you can scroll through — without this channel turning into a novel.

" +
    "⚙️ This hub auto-refreshes on bot restart so new features show up automatically.",

  color: 0x9b59b6, // purple-ish; change if you want
};
