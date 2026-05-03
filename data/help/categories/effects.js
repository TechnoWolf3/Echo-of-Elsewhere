// data/help/categories/effects.js
module.exports = {
  id: "effects",
  order: 5,
  name: "Effects",
  emoji: "✨",
  blurb: "Blessings, curses, active effects, and income modifiers.",

  commands: [
    {
      id: "effectsOverview",
      name: "Blessings & Curses",
      short: "Temporary modifiers that affect eligible income.",
      detail:
        "**Blessings & Curses**\n" +
        "Effects can increase or reduce eligible earnings across many bot activities.\n\n" +
        "A player can only have one active effect at a time. Effects may expire by time, by number of uses, or by being cleared by staff.",
    },
    {
      id: "viewEffects",
      name: "Viewing Active Effects",
      short: "Use /profile to see current effects.",
      detail:
        "**Viewing Active Effects**\n" +
        "Use **/profile** and open the Effects tab to see whether a player has an active blessing or curse.\n\n" +
        "The profile shows the effect name, type, target, mode, value, expiry, and uses remaining when available.",
    },
    {
      id: "effectCoverage",
      name: "What Effects Change",
      short: "Most earned rewards can be modified.",
      detail:
        "**What Effects Change**\n" +
        "Effects can apply to eligible rewards from jobs, casino games, rituals, bot games, and other effect-aware earning systems.\n\n" +
        "They do not apply to player-to-player transfers or direct admin grants.",
    },
    {
      id: "blessings",
      name: "Blessings",
      short: "Positive effects that increase earnings.",
      detail:
        "**Blessings**\n" +
        "**Echo's Favour** increases eligible income by 15%.\n\n" +
        "**Echo's Tribute** adds a flat $2,000 to eligible income.",
    },
    {
      id: "curses",
      name: "Curses",
      short: "Negative effects that reduce earnings or block activity.",
      detail:
        "**Curses**\n" +
        "**Echo's Burden** reduces eligible income by 15%.\n\n" +
        "**Echo's Tax** removes a flat $1,000 from eligible income.\n\n" +
        "**Blood Tax** can block certain activities until the demanded amount is paid or the consequence is accepted.",
    },
  ],
};
