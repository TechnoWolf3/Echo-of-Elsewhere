module.exports = {
  enabled: true,

  // 📍 Channel to post in
  channelId: "1449217901306581074",

  // ⏳ Expiry for unclaimed events
  expireMinutes: 180,

  // ⏳ Expiry AFTER an event is claimed (prevents stuck games)
  claimedExpireMinutes: 10,

  // 🎲 Daily roll odds (weekdays)
  weekdayOdds: { none: 0.65, one: 0.30, two: 0.05 },

  // 🎉 Daily roll odds (weekends - boosted)
  weekendOdds: { none: 0.55, one: 0.37, two: 0.08 },

  // 🕒 Time windows (AEST / Australia/Brisbane)
  windows: {
    oneEvent: { start: "15:00", end: "22:00" },      // 3PM–10PM
    twoEvent1: { start: "08:00", end: "11:00" },     // 8AM–11AM
    twoEvent2: { start: "15:00", end: "22:00" }      // 3PM–10PM
  },

  // 🧭 Timezone for scheduling
  timeZone: "Australia/Brisbane",

  // 🧪 Debug mode (logs planning + enables /botgames test if you add it later)
  debug: false
};
