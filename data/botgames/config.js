module.exports = {
  enabled: true,

  // 🔔 Role to ping when a new Bot Game spawns
  roleId: "1474683699344838809",

  // 📣 Where to post Bot Games (set this once and forget it)
  // If left blank, the bot will try the server's system channel, then the first channel it can speak in.
  channelId: "",

  // ⏱ Timing controls
  tickMs: 60_000,              // Check every 60s
  minIntervalMs: 120 * 60_000, // Minimum 2 hours between spawns
  spawnChance: 0.02,           // 2% chance per tick

  // 🧨 Expire an unclaimed event after X minutes
  expireMinutes: 10,
};
