// data/features/categories/economy.js
module.exports = {
  id: "economy",
  order: 1,
  name: "Economy Features",
  emoji: "💸",
  blurb: "A shared vault where your wins drain it… and your losses feed it.",
  description:
    "A centralised server-wide bank powers all money-based activity. Wins withdraw from the vault, losses feed it — keeping the economy alive and reactive.",

  // Items shown inside the category (like help.commands)
  items: [
    {
      id: "server_bank",
      name: "🏦 Server Bank",
      short: "The home of The Place's funding.",
      detail:
        "**Server Bank**\n" +
        "At the heart of The Place is a shared, server-wide vault that powers the entire economy.\n" +
        "Every casino payout, job reward, fine, and loss flows through this central bank. When you win big, the money comes directly from the vault — and when you lose or pay fines, it feeds back into it.\n" +
        "This creates a living, reactive economy where risk, reward, and balance truly matter.",
    },
    {
      id: "Personal_bank",
      name: "💳 Personal Balance System",
      short: "Personal finances!.",
      detail:
        "**Personal Bank**\n" +
        "Each member has their own persistent balance that tracks earnings, losses, and spending across all money-based activities.\n" +
        "Your funds are securely stored and updated in real time, ensuring that every gamble, job, and purchase is accurately reflected.\n" +
        "What you earn is yours, until it's the casinos.",
    },
    {
      id: "dynamic_circulation",
      name: "🔁 Dynamic Money Circulation",
      short: "Dynamic Money Circulation.",
      detail:
        "**How the economy moves**\n" +
        "Money in The Place doesn’t appear out of thin air, it moves.\n" +
        "Casino wins withdraw from the bank, losses replenish it, and spending helps regulate the overall balance.\n" +
        "Completing jobs in the work hub (/jobs) mints money which is the main way to add funding to the economy!\n" +
        "This circulation keeps the economy active and prevents it from becoming overly inflated or stagnant.",
    },
    {
      id: "income_systems",
      name: "💼 Income Systems",
      short: "Your money, your way.",
      detail:
        "**Income systems**\n" +
        "There are multiple ways to earn within the ecosystem\n" +
        "From structured 9–5 jobs to risk-based work and special events.\n" +
        "/job opens up the job center from there you can pick from the following types of work;\n" +
        "**Nine to Five**\n" +
        "-# Easy, Legal jobs to keep you earning without the law on your tail\n" +
        "Shift - Clock on, clock off. Low effort = Low pay.\n" +
        "Skill Check - Find the correct symbol in time. Quick reactions for a quick payout.\n" +
        "Transport Contract - Deliver the parcel, chose your route. Riskier turns increase payout.\n\n" +
        "**Grind**\n" +
        "-# Long running jobs that progressively get harder but also increase payout.\n" +
        "Store Clerk - Take on the role of a checkout-chick. Return the correct change and earn that paycheck.\n\n" +
        "**Night Walker**\n" +
        "-# Sell your soul in the night, please the people, earn large. Watch out! The police are looking for Night Walkers.\n" +
        "Flirt - Take the hint, roll with it and it might just work out. Right moves increase payout.\n" +
        "Lap Dance - Feel the music and bust a move. Keep your clients happy for a higher payout.\n" +
        "Prostitute - Do we need to explain this one? Sell yourself, keep 'em happy. They might just leave you a tip.\n\n" +
        "**Crime**\n" +
        "-# Take a risk, rob a servo... maybe even a bank! Beware, cameras are everywhere and the police are looking.\n" +
        "Store Robbery - Rob a servo maybe a supermarket? Plan your entry and exit. Success leads to high payout.\n" +
        "Heist - Wether standard or major, were going to the bank. Plan every move, watch your Heat, higher heat = higher chance of failure.\n" +
        "Whether you prefer steady income or high-risk opportunities, every earning method feeds into the wider economic structure.",
    },
    {
      id: "riskandloss_mechanics",
      name: "🎲 Risk & Loss Mechanics",
      short: "Risk & Loss Mechanics.",
      detail:
        "**How risks and loss affects you.**\n" +
        "Risk is part of the experience.\n" +
        "Gambling losses, failed attempts, fines, and risky decisions all have financial consequences.\n" +
        "These mechanics ensure that money holds value and that every wager or action carries weight.",
    },
    {
      id: "cooldownsand_regulations",
      name: "⏳ Cooldowns and Regulations",
      short: "Cooldowns and Government.",
      detail:
        "**How risks and loss affects you.**\n" +
        "These safeguards prevent inflation, protect the server bank, and ensure long-term sustainability of the economy.\n" +
        "These timers are listed in their respective boards for easy viewing.\n\n" +
        "Large payouts depend on the health of the server bank. If the vault is strong, big wins are possible. If it runs low, liquidity becomes part of the strategy.",
    },
    {
      id: "random_events",
      name: "🎉 Random Events",
      short: "Random Events.",
      detail:
        "**Challenge Echo for a chance to win.**\n" +
        "Timed and surprise events introduce bursts of opportunity into the system.\n" +
        "Whether rewarding speed, participation, or luck, these events inject energy into the economy and keep members engaged.",
    },
  ],
};
