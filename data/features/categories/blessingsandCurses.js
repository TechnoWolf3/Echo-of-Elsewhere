// data/features/categories/blessingsandCurses.js
module.exports = {
  id: "effects",
  order: 8,
  name: "Effects",
  emoji: "✨",
  blurb: "Echo's blessings, curses, and active income modifiers.",
  description:
    "Effects are temporary or limited-use modifiers that can alter a player's earnings. Blessings reward activity, curses punish bad luck or poor outcomes, and only one active effect can be held at a time.",

  items: [
    {
      id: "effect_rules",
      name: "Effect Rules",
      short: "One active effect at a time, with duration or use limits.",
      detail:
        "Players can only hold one active blessing or curse at a time.\n\n" +
        "Effects may expire by time or by uses. Rolling the same active effect can refresh it, but a different blessing or curse will not overwrite the current one.",
    },
    {
      id: "income_coverage",
      name: "Income Coverage",
      short: "Most earned rewards can be modified by effects.",
      detail:
        "Blessings and curses apply to most earned money streams, including jobs, games, rituals, bot games, and other reward systems that use the effect-aware payout helpers.\n\n" +
        "They do not apply to player transfers or direct admin grants.",
    },
    {
      id: "echos_favour",
      name: "Echo's Favour",
      short: "Blessing that increases income by 15%.",
      detail:
        "Echo's Favour is a percentage blessing.\n\n" +
        "While active, eligible rewards are increased by 15%, making good payouts hit harder until the effect expires or runs out of uses.",
    },
    {
      id: "echos_tribute",
      name: "Echo's Tribute",
      short: "Blessing that adds a flat $2,000 to eligible earnings.",
      detail:
        "Echo's Tribute is a flat bonus blessing.\n\n" +
        "While active, eligible earnings receive an extra $2,000, which is especially useful on frequent smaller activities.",
    },
    {
      id: "echos_burden",
      name: "Echo's Burden",
      short: "Curse that reduces income by 15%.",
      detail:
        "Echo's Burden is a percentage curse.\n\n" +
        "While active, eligible rewards are reduced by 15%, making every earning action feel the penalty until the curse clears.",
    },
    {
      id: "echos_tax",
      name: "Echo's Tax",
      short: "Curse that removes a flat $1,000 from eligible earnings.",
      detail:
        "Echo's Tax is a flat income curse.\n\n" +
        "While active, eligible rewards lose $1,000. It hurts most on smaller rewards and repeated activities.",
    },
    {
      id: "blood_tax",
      name: "Blood Tax",
      short: "A harsher curse gate that can block activity until paid.",
      detail:
        "Blood Tax is a stronger curse-style pressure used by some event systems.\n\n" +
        "When active, it can block certain actions until the player pays the demanded amount or accepts the consequence.",
    },
  ],
};
