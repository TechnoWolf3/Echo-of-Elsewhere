function milestone(label, emoji = "-") {
  return { label, emoji };
}

module.exports = {
  repair: {
    title: "Site Status",
    milestones: [
      milestone("Debris cleared", "[OK]"),
      milestone("Supports being repaired", "[..]"),
      milestone("Main structure partially restored", "[..]"),
      milestone("Services and supplies restored", "[  ]"),
      milestone("Final inspection pending", "[  ]"),
    ],
  },
  route: {
    title: "Route",
    milestones: [
      milestone("Wallaby Creek", "[OK]"),
      milestone("Ironbark Ridge", "[..]"),
      milestone("Wattleford", "[  ]"),
      milestone("Banksia Bay", "[  ]"),
      milestone("Murray's Bend", "[  ]"),
    ],
  },
  zones: {
    title: "Recovery Zones",
    milestones: [
      milestone("North ridge secured", "[OK]"),
      milestone("Creek line under repair", "[..]"),
      milestone("Fencing and access tracks damaged", "[..]"),
      milestone("Wildlife shelter needs support", "[  ]"),
      milestone("Final sweep pending", "[  ]"),
    ],
  },
  facility: {
    title: "Facility Status",
    milestones: [
      milestone("Site cleared", "[OK]"),
      milestone("Rooms being fitted", "[..]"),
      milestone("Water and power underway", "[..]"),
      milestone("Storage not fully stocked", "[  ]"),
      milestone("Front desk not signed off", "[  ]"),
    ],
  },
  supply: {
    title: "Supply Stock",
    stock: ["Food", "Water", "Medical", "Tools"],
  },
  emergency_response: {
    title: "Current Problems",
    milestones: [
      milestone("Main fault identified", "[!]"),
      milestone("Crew repairing lines", "[..]"),
      milestone("Fuel and parts delivery pending", "[  ]"),
      milestone("Public safety check pending", "[  ]"),
      milestone("Council paperwork attempting to become sentient", "[  ]"),
    ],
  },
};
