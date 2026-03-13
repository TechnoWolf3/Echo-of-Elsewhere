// data/effects/definitions.js
// Central blessing / curse definitions.
// Edit these values to tune defaults, allowed duration modes, and enable/disable effects.

module.exports = {
  system: {
    enabled: true,
    minPayoutFloor: 0,
    expireOnFirstLimitReached: true,
  },

  effects: {
    echo_blessing_minor_cash: {
      id: "echo_blessing_minor_cash",
      name: "Echo's Blessing",
      type: "blessing",
      target: "money_reward",
      enabled: true,
      allowedModifierModes: ["percent", "flat"],
      defaultModifierMode: "percent",
      defaultModifierValue: 15,
      allowTimeDuration: true,
      allowUseDuration: true,
      defaultDuration: { minutes: 30, uses: null },
      defaultWeight: 10,
      description: "A soft nudge from Echo that improves eligible payouts.",
    },

    echo_curse_minor_cash: {
      id: "echo_curse_minor_cash",
      name: "Echo's Curse",
      type: "curse",
      target: "money_reward",
      enabled: true,
      allowedModifierModes: ["percent", "flat"],
      defaultModifierMode: "percent",
      defaultModifierValue: -15,
      allowTimeDuration: true,
      allowUseDuration: true,
      defaultDuration: { minutes: 30, uses: null },
      defaultWeight: 10,
      description: "Echo leans on the scale and trims eligible payouts.",
    },
  },
};
