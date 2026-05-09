// data/help/config.js
module.exports = {
  // Shown when someone without the role selects Game Boss
  noAccess: {
    title: "👑 Game Boss",
    description:
      "You can see this section exists, but you don’t have access to the commands inside it.\n\n" +
      "If you believe you should have access, reach out to staff and they’ll sort you out.",
  },

  // 3 minutes idle
  idleMs: 3 * 60 * 1000,

  // Optional: expires message text if we can’t delete
  expiredText:
    "⏱️ This help panel expired due to inactivity.\nRun **/help** again to open a fresh one.",
};
