// data/lottery/config.js
// Edit text/labels here without touching logic.

module.exports = {
  enabled: true,

  // Posting / ping
  channelId: "1449217901306581074",
  pingRoleId: "1474683699344838809", // ping ONLY on draw result

  // Schedule (AEST / Australia/Brisbane)
  timezone: "Australia/Brisbane",
  drawWeekday: 4,          // 0=Sun ... 4=Thu
  drawHour: 20,
  drawMinute: 30,
  salesCloseHoursBefore: 3,

  // Economy
  ticketPrice: 20000,
  maxTicketsPerUser: 5,

  // Per-ticket allocation (must sum to 1.0)
  allocation: {
    reserve: 0.10,   // house cut -> lottery reserve
    divisional: 0.25,
    jackpot: 0.65
  },

  // Seeding rules
  seed: {
    minJackpot: 250000,
    maxSeedsPerMonth: 1
  },

  // Divisional pool rollover rule (unpaid divisional leftovers)
  rollover: {
    toJackpotRatio: 0.50,
    toDivCarryRatio: 0.50
  },

  // Current AU Powerball format
  balls: {
    mainPick: 7,
    mainMax: 35,
    powerMax: 20
  },

  // Divisions & weights (share of the divisional pool)
  // Division 1 is the jackpot (7 + PB) and is NOT part of divisional pool.
  divisionWeights: {
    D2: 30, // 7
    D3: 18, // 6 + PB
    D4: 12, // 6
    D5: 10, // 5 + PB
    D6: 8,  // 5
    D7: 8,  // 4 + PB
    D8: 7,  // 4
    D9: 7   // 3 + PB
  },

  // Post refresh (repost to bottom)
  refreshTimesAEST: [
    { hour: 9, minute: 0 },
    { hour: 18, minute: 0 }
  ],

  // Embed text (easy editing)
  embed: {
    title: "🎟 Echo Powerball",
    footer: "Tickets close 3 hours before draw. Odds are brutal. That’s the point.",
    howTo: [
      "Use the buttons below to buy Quick Picks.",
      "Max **5 tickets** per draw.",
      "Jackpot rolls over until someone hits **Division 1 (7 + Powerball)**."
    ]
  }
};
