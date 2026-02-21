module.exports = {
  enabled: true,

  // 🔔 Role to ping when a new Bot Game spawns
  roleId: "1474683699344838809",

  // 📢 Where to post Bot Games (set this once and forget it)
  channelId: "1449217901306581074",

  // 🇦🇺 AEST settings (Brisbane is UTC+10 year-round)
  tzOffsetHours: 10,

  // 🎲 Daily roll chances (weekdays)
  chancesWeekday: { none: 0.65, one: 0.30, two: 0.05 },

  // 🎉 Weekend boost (Sat/Sun) — slightly more likely to get events
  chancesWeekend: { none: 0.55, one: 0.37, two: 0.08 },

  // ⏰ Spawn windows (AEST, inclusive start, exclusive end)
  windows: {
    oneEvent: { startHour: 15, endHour: 22 }, // 3PM–10PM
    twoEventMorning: { startHour: 8, endHour: 11 }, // 8AM–11AM
    twoEventAfternoon: { startHour: 15, endHour: 22 } // 3PM–10PM
  },

  // ⌛ Expire an unclaimed event after X minutes
  expireMinutes: 10,

  // 🧪 Logging (set true if you want to see schedule decisions in logs)
  debug: false,
};
