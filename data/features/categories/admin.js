// data/features/categories/admin.js
module.exports = {
  id: "admin",
  order: 99,
  name: "Admin & Bot Master Tools",
  emoji: "👑",
  blurb: "Restricted controls for economy, moderation, events, and live systems.",
  description:
    "Admin and Bot Master tools keep the server systems maintainable without needing code edits for every live adjustment.",

  items: [
    {
      id: "admin_panel",
      name: "Admin Panel",
      short: "A restricted control panel for Bot Master actions.",
      detail:
        "**/adminpanel** opens the Bot Master control panel.\n\n" +
        "It groups controls for economy, moderation, boards, effects, patchboard, shop and inventory, bot games, Echo Rift, ESE, contracts, enterprises, and misc tools.",
    },
    {
      id: "economy_admin",
      name: "Economy Controls",
      short: "Adjust player balances, server bank, and lottery visibility.",
      detail:
        "Economy controls include adding player balance, adding server bank funds, viewing the server bank, and checking Powerball buyers for the active draw.",
    },
    {
      id: "moderation_admin",
      name: "Moderation Controls",
      short: "Purge, jail, heat, cooldowns, and achievement resets.",
      detail:
        "Moderation controls support immediate purges, scheduled purge jobs, disabling purge schedules, setting crime heat, setting jail time, clearing cooldowns, and resetting achievements.",
    },
    {
      id: "live_system_admin",
      name: "Live System Controls",
      short: "Manage effects, bot games, ESE, contracts, and farming seasons.",
      detail:
        "Live system controls let Bot Masters give or clear effects, spawn or expire bot games, adjust ESE stocks, manage contracts, and move farming to the next season.",
    },
    {
      id: "content_admin",
      name: "Content & Shop Controls",
      short: "Manage patch notes, boards, shop items, and inventories.",
      detail:
        "Content controls include patchboard updates, role board management, shop item creation and edits, category changes, enabling/disabling items, deletions, and inventory removal.",
    },
  ],
};
