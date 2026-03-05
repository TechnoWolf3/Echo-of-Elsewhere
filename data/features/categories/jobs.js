// data/features/categories/jobs.js
module.exports = {
  id: "jobs",
  order: 3,
  name: "Jobs",
  emoji: "🧑‍🔧",
  blurb: "About our Workforce.",
  description:
    "Jobs are a money-driven hub connected directly to your personal bank. Work hard, take risks, earn big. All jobs come with their own tasks and associated risks.\n" +
    "There are currently 4 categories for work; 9-5, Nightwalker, Grind & Crime",

  // Items shown inside the category (like help.commands)
  items: [
    {
      id: "nineToFive_Transport",
      name: "🚚 Transport Contract",
      short: "Deliver the parcels, take risks with instant outcomes.",
      detail:
        "Transport clients parcels.\n" +
        "Take riskier routes and delivery options.\n" +
        "Risk directly impacts the payout but careful! Being reckless can destroy your load.",
    },
    {
      id: "nineToFive_SkillCheck",
      name: "🤹 Skill Check",
      short: "A quick time event job.",
      detail:
        "Skill Check requires your eyes and hands to work together.\n" +
        "Find what colour is reequired and click it in time.\n" +
        "One wrong move and your shift ends early.",
    },
    {
      id: "nineToFive_Shift",
      name: "🕒 Shift",
      short: "Clock on, clock off & get paid.",
      detail:
        "The easiest of the 9-5's\n" +
        "Simply clock on and wait out the shift.\n" +
        "Collect your paycheck at the end to get paid.\n" +
        "*Due to the lack of effort required, this job pays the least*.",
    },
    {
      id: "nightwalker_Flirt",
      name: "💬 Flirt",
      short: "A social skill check.",
      detail:
        "Dance to keepp your client happy.\n" +
        "Follow the vibe and your clients hints, correct moves reward better.\n" +
        "Make the wrong move and the client may just up and leave!",
    },
    {
      id: "nightwalker_LapDance",
      name: "💃 Lap Dance",
      short: "I hope those dance classes will pay off.",
      detail:
        "Dance your heart out.\n" +
        "Overcome incidents gracefully to keep your partner feeling it.\n" +
        "Riskier moves lead to bigger tips!.",
    },
    {
      id: "nightwalker_Prostitute",
      name: "🎲 Prostitute",
      short: "Do we need to explain?",
      detail:
        "Service the nightlife.\n" +
        "Your body is your tool, lonely people get freaky, match their vibe but dont get caught!.\n" +
        "Risk meters will help you keep in line.",
    },
    {
      id: "grind_StoreClerk",
      name: "🏪 Store Clerk",
      short: "Fast-paced retail tasks with steady, reliable payouts.",
      detail:
        "Store Clerk places players behind the counter in a steady retail workflow.\n" +
        "It focuses on quick interactions and reliable payouts, making it a dependable entry point for the grind system.\n" +
        "Clean prompts and simple tasks keep the pace moving while still feeling connected to the server economy.",
    },
    {
      id: "grind_Warehousing",
      name: "📦 Warehousing",
      short: "Move stock, handle cargo, and keep the warehouse flowing.",
      detail:
        "Warehousing introduces structured logistics work into the grind category.\n" +
        "Players move goods, complete handling tasks, and keep the operation running smoothly.\n" +
        "The role rewards consistency and efficiency, offering a stable income path for players who enjoy productive gameplay loops.",
    },
    {
      id: "grind_Fishing",
      name: "🎣 Fishing",
      short: "A slower-paced grind built around patience and timing.",
      detail:
        "Fishing offers a slower, methodical grind built around patience and timing.\n" +
        "It provides a relaxed alternative to high-intensity jobs while still feeding directly into the economy.\n" +
        "The calm pace makes it ideal for players looking to earn while enjoying a quieter gameplay rhythm.",
    },
    {
      id: "grind_Quarry",
      name: "🪨 Quarry",
      short: "Heavy labour and resource extraction for solid payouts.",
      detail:
        "Quarry work focuses on heavy labour and resource extraction within the grind system.\n" +
        "Players complete demanding tasks that reflect industrial-style work environments.\n" +
        "It delivers solid payouts through effort-based progression, rewarding players who stick with the job cycle.",
    },
    {
      id: "crime_StoreRobbery",
      name: "🏪 Store Robbery",
      short: "Risky grab-and-go crime with quick payouts.",
      detail:
        "Store Robbery introduces fast-moving criminal opportunities to the job system.\n" +
        "It rewards timing and nerve, allowing players to attempt quick hits for immediate cash.\n" +
        "While the payout can be tempting, every robbery adds heat, increasing the risk of future crime attempts.",
    },
    {
      id: "crime_CarChase",
      name: "🚓 Car Chase",
      short: "Coming Soon.",
      detail:
        "Coming Soon.",
    },
    {
      id: "crime_DrugPushing",
      name: "💊 Drug Pushing",
      short: "Coming Soon.",
      detail:
        "Coming Soon.",
    },
    {
      id: "crime_Heist",
      name: "🏦 Heist",
      short: "Large-scale jobs with serious heat.",
      detail:
        "Heists represent coordinated high-value crime operations.\n" +
        "These jobs offer significantly larger rewards than smaller crimes, but come with greater consequences.\n" +
        "Taking on a heist means committing to a high-risk play where the payoff can be massive — or disastrous.",
    },
    {
      id: "crime_MajorHeist",
      name: "💎 Major Heist",
      short: "Massive payouts with extreme risk.",
      detail:
        "Major Heists sit at the top of the crime ladder, offering the biggest payouts available in the job system.\n" +
        "These operations push the risk level to its limits, generating serious heat and attention.\n" +
        "Only the boldest players will attempt them, knowing the rewards can reshape the balance of the economy.",
    },
  ],
};
