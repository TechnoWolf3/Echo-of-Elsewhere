module.exports = {
  // Internal ID: lowercase, no spaces
  id: "category_id_here",

  // Order: lower = shows first
  order: 10,

  // Display name + emoji shown to users
  name: "Category Name Here",
  emoji: "📌",

  // Short blurb shown on the Help Hub
  blurb: "One short line explaining what this category contains.",

  // Commands shown inside the category
  commands: [
    {
      // Internal ID for this command (unique within this category)
      id: "command_id_here",

      // Actual slash command name (what users see/click)
      name: "/command",

      // Very short one-liner shown in category list
      short: "Very short description of what it does.",

      // Full breakdown shown when the command is selected
      detail:
        "**/command**\n" +
        "Write a clear description here.\n\n" +
        "**How to use:**\n" +
        "- Example step 1\n" +
        "- Example step 2\n\n" +
        "**Notes:**\n" +
        "- Any limits/cooldowns/etc.\n",
    },
  ],
};
