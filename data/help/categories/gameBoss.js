// data/help/categories/gameBoss.js
module.exports = {
  id: "gameboss",
  order: 99,
  name: "Game Boss",
  emoji: "👑",
  blurb: "Restricted admin and Bot Master controls.",

  commands: [
    {
      id: "adminpanel",
      name: "/adminpanel",
      short: "Open the Bot Master control panel.",
      detail:
        "**/adminpanel**\n" +
        "Opens the restricted Bot Master control panel.\n\n" +
        "**Categories:** Economy, Moderation, Boards, Effects, Patchboard, Shop / Inventory, Bot Games, Echo Rift, Echo Stock Exchange, Contracts, Enterprises, and Misc.\n\n" +
        "Use this for live control of major bot systems without needing to run individual legacy commands manually.",
    },
    {
      id: "economyAdmin",
      name: "Admin Panel - Economy",
      short: "Balance, server bank, and lottery tools.",
      detail:
        "**Economy Controls**\n" +
        "The admin panel can add player balance, add server bank funds, view the server bank, and list Powerball buyers for the active draw.",
    },
    {
      id: "moderationAdmin",
      name: "Admin Panel - Moderation",
      short: "Purge, heat, jail, cooldowns, and achievements.",
      detail:
        "**Moderation Controls**\n" +
        "The admin panel can purge messages, schedule recurring channel purges, view purge status, disable purge schedules, set crime heat, set jail time, clear cooldowns, and reset achievements.",
    },
    {
      id: "boardsAdmin",
      name: "Admin Panel - Boards",
      short: "Create, update, bump, list, and delete role boards.",
      detail:
        "**Board Controls**\n" +
        "The admin panel can create, update, bump, list, and delete board messages.\n\n" +
        "Use **/roles** for JSON-backed self-assign role boards stored in `data/roleboards`.",
    },
    {
      id: "effectsAdmin",
      name: "Admin Panel - Effects",
      short: "Give, view, clear, and list active effects.",
      detail:
        "**Effect Controls**\n" +
        "The admin panel can give effects to players, view active effects, clear effects, and list valid effect IDs.",
    },
    {
      id: "patchboardAdmin",
      name: "Admin Panel - Patchboard",
      short: "Manage patch note board content.",
      detail:
        "**Patchboard Controls**\n" +
        "The admin panel can set, append, overwrite, pause, resume, show, and repost patchboard content.",
    },
    {
      id: "shopAdmin",
      name: "Admin Panel - Shop / Inventory",
      short: "Manage shop items and remove inventory.",
      detail:
        "**Shop / Inventory Controls**\n" +
        "The admin panel can add shop items, edit items, set categories, enable or disable items, delete items, and remove inventory from players.",
    },
    {
      id: "eventAdmin",
      name: "Admin Panel - Events",
      short: "Control Bot Games and Echo Rift.",
      detail:
        "**Event Controls**\n" +
        "Bot Games controls can view status, spawn random or specific events, force spawn, and expire active events.\n\n" +
        "Echo Rift controls can view status, spawn, clear, schedule, adjust chance, and manage Blood Tax.",
    },
    {
      id: "eseAdmin",
      name: "Admin Panel - ESE",
      short: "Inspect and adjust stock market listings.",
      detail:
        "**Echo Stock Exchange Controls**\n" +
        "The admin panel can view stock data, set the current price, set the next tick price, set or clear a floor, and reset a stock to launch price.",
    },
    {
      id: "contractsAdmin",
      name: "Admin Panel - Contracts",
      short: "Control contract automation and active contracts.",
      detail:
        "**Contract Controls**\n" +
        "The admin panel can view contract status, toggle auto contracts, change settings, start manual contracts, stop active contracts, rotate contracts, and post the daily contract now.",
    },
    {
      id: "enterpriseAdmin",
      name: "Admin Panel - Enterprises",
      short: "View and advance farming seasons.",
      detail:
        "**Enterprise Controls**\n" +
        "The admin panel can view farming season status and manually skip to the next season. Season skips apply rollover handling to farms.",
    },
    {
      id: "roles",
      name: "/roles",
      short: "Post and sync self-assign role boards.",
      detail:
        "**/roles**\n" +
        "Manage self-assign role boards from `data/roleboards`.\n\n" +
        "Use **/roles list** to see available board files, **/roles post** to post and persist a board, and **/roles sync** to update an existing posted board after the JSON changes.",
    },
  ],
};
