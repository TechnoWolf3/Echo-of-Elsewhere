// data/features/categories/rituals.js
module.exports = {
  id: "rituals",
  order: 6,
  name: "Rituals",
  emoji: "🕯️",
  blurb: "Daily luck, weekly rewards, monthly claims, and Echo's stranger games.",
  description:
    "The Rituals hub brings recurring rewards and luck-based activities into one place. From standard claims to weird little Echo-crafted games, it gives players a reason to check in regularly.",

  items: [
    {
      id: "rituals",
      name: "🕯️ Ritual Claims",
      short: "A single place for recurring reward for checking in.",
      detail:
        "The Claimable Rituals are repeatable reward systems in one place, making it easier to track and use daily, weekly, and monthly content without command clutter.\n\n" +
        "It is part reward board, part routine check-in, and part Echo nonsense.\n\n" +
        "🌅 Daily Claim\n" +
        "The daily ritual gives players a simple recurring reward and keeps regular activity flowing through the economy.\n" +
        "It is the most straightforward of the ritual claims, claimable once daily (resets midnight daily).\n\n" +
        "📅 Weekly Claim" +
        "The weekly ritual builds on the daily claim with a bigger payout and a slightly more meaningful check-in cadence.\n" +
        "A larger reward claimable once per week (resets midnight on Sundays).\n\n" +
        "🗓 Monthly Claim" +
        "Monthly claims give the ritual system a proper long-cycle reward.\n" +
        "The laegest claimable reward, often paying over $250k claimable once per month (resets midnight on the last day of the month).",
    },
    {
      id: "daily_challenges",
      name: "🕯️ Daily Challenges",
      short: "Daily games and challenges, rewards and effects in play.",
      detail:
        "🎡 Echo Wheel\n" +
        "Echo Wheel adds a more chaotic edge to the Rituals hub.\n" +
        "Instead of a flat claim, players spin for a random outcome that might reward them, troll them, or set up future benefits. It is built to feel like a proper event, not just another button press.\n\n" +
        "🔢 Echo Cipher\n" +
        "Echo Cipher is a repeatable code-breaking challenge where players try to solve a hidden number sequence within a limited number of attempts.\n" +
        "It adds actual gameplay to the Rituals hub and gives the recurring systems something more interactive than just claiming money.",
    },
  ],
};
