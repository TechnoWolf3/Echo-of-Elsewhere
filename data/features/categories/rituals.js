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
      id: "rituals_hub",
      name: "🕯️ Rituals Hub",
      short: "A single place for recurring claims and daily luck systems.",
      detail:
        "The Rituals hub pulls repeatable reward systems into one clean command, making it easier to track and use daily, weekly, and monthly content without command clutter.\n\n" +
        "It is part reward board, part routine check-in, and part Echo nonsense.",
    },
    {
      id: "daily_claim",
      name: "🌅 Daily Claim",
      short: "Your regular day-to-day reward for checking in.",
      detail:
        "The daily ritual gives players a simple recurring reward and keeps regular activity flowing through the economy.\n\n" +
        "It is the most straightforward of the ritual claims, but still an important part of keeping players engaged.",
    },
    {
      id: "weekly_claim",
      name: "📅 Weekly Claim",
      short: "A larger recurring reward for players who keep showing up.",
      detail:
        "The weekly ritual builds on the daily claim with a bigger payout and a slightly more meaningful check-in cadence.\n\n" +
        "It rewards consistency without needing players to grind constantly.",
    },
    {
      id: "monthly_claim",
      name: "🗓 Monthly Claim",
      short: "A heavier recurring claim that rounds out the ritual ladder.",
      detail:
        "Monthly claims give the ritual system a proper long-cycle reward.\n\n" +
        "It adds one more reason for players to stay connected over time and helps the Rituals hub feel like a real progression lane rather than just a daily freebie.",
    },
    {
      id: "echo_wheel",
      name: "🎡 Echo Wheel",
      short: "Spin for luck, cash, setbacks, or something in between.",
      detail:
        "Echo Wheel adds a more chaotic edge to the Rituals hub.\n\n" +
        "Instead of a flat claim, players spin for a random outcome that might reward them, troll them, or set up future benefits. It is built to feel like a proper event, not just another button press.",
    },
    {
      id: "echo_cipher",
      name: "🔢 Echo Cipher",
      short: "A number-cracking ritual with limited attempts and real rewards.",
      detail:
        "Echo Cipher is a repeatable code-breaking challenge where players try to solve a hidden number sequence within a limited number of attempts.\n\n" +
        "It adds actual gameplay to the Rituals hub and gives the recurring systems something more interactive than just claiming money.",
    },
  ],
};
