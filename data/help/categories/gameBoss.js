// data/help/categories/gameBoss.js
module.exports = {
  id: "gameboss",
  order: 99,
  name: "Game Boss",
  emoji: "👑",
  blurb: "Admin / control panel commands (restricted).",

  commands: [
    { id: "addbalance", name: "/addbalance", short: "Add balance to a user.", detail: "**/addbalance**\nEdit details here." },
    { id: "addserverbal", name: "/addserverbal", short: "Adjust server bank balance.", detail: "**/addserverbal**\nEdit details here." },
    { id: "board", name: "/board", short: "Manage boards (details editable).", detail: "**/board**\nEdit details here." },
    { id: "cooldown", name: "/cooldown", short: "Manage cooldowns.", detail: "**/cooldown**\nEdit details here." },
    { id: "invadmin", name: "/invadmin", short: "Inventory admin tools.", detail: "**/invadmin**\nEdit details here." },
    { id: "patchboard", name: "/patchboard", short: "Manage patch notes board.", detail: "**/patchboard**\nEdit details here." },
    { id: "purge", name: "/purge", short: "Purge messages (or data).", detail: "**/purge**\nEdit details here." },
    { id: "resetachievements", name: "/resetachievements", short: "Reset achievements.", detail: "**/resetachievements**\nEdit details here." },
    { id: "serverbal", name: "/serverbal", short: "View server bank balance.", detail: "**/serverbal**\nEdit details here." },
    { id: "setheat", name: "/setheat", short: "Set crime heat (admin).", detail: "**/setheat**\nEdit details here." },
    { id: "setjail", name: "/setjail", short: "Set jail status (admin).", detail: "**/setjail**\nEdit details here." },
    { id: "shopadmin", name: "/shopadmin", short: "Shop admin tools.", detail: "**/shopadmin**\nEdit details here." },
  ],
};
