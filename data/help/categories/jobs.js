// data/help/categories/jobs.js
module.exports = {
  id: "jobs",
  order: 2,
  name: "Jobs",
  emoji: "💼",
  blurb: "Earn money through work, crime, and risk.",

  commands: [
    {
      id: "jobsHub",
      name: "/jobs",
      short: "Open the jobs hub.",
      detail:
        "**/jobs**\n" +
        "Opens the jobs hub where you can pick a category and start a job.\n\n" +
        "**Categories:**\n" +
        "🧰 **Work a 9-5** – safe, structured income.\n" +
        "🧠 **Nightwalker** – adult-themed income with higher risk.\n" +
        "🕒 **Grind** – steady, repeatable work, but builds **Fatigue**\n" +
        "🕶️ **Crime** – bigger payouts, but builds **Heat**.\n\n" +
        "**Quick How-To:**\n" +
        "- Run **/jobs**\n" +
        "- Select a category\n" +
        "- Pick a job from the list\n" +
        "- Follow the buttons/prompts to complete it\n\n" +
        "Heads up: **Heat only affects Crime jobs.**",
    },

    // =========================
    // WORK A 9-5
    // =========================
    {
      id: "work95",
      name: "Job Category - Work a 9-5",
      short: "Structured work with predictable payouts.",
      detail:
        "**Work a 9-5**\n" +
        "These jobs are built for steady progression and consistent income.\n" +
        "Lower risk, cleaner payouts, and a simple loop.\n\n" +
        "**Quick How-To:**\n" +
        "- Open **/jobs** → **Work a 9-5**\n" +
        "- Choose a job\n" +
        "- Complete the prompt/action and collect payout",
    },

    {
      id: "transportContract",
      name: "9-5 Job - Transport Contract",
      short: "Take contracts and complete the run for a payout.",
      detail:
        "**Transport Contract**\n" +
        "A contract-based job focused on completing runs for consistent income.\n" +
        "Reliable payouts with a clean, structured loop.\n\n" +
        "**Quick How-To:**\n" +
        "- Select **Transport Contract** in the 9-5 list\n" +
        "- Follow the job prompt\n" +
        "- Finish the run and collect your payout",
    },
    {
      id: "skillCheck",
      name: "9-5 Job - Skill Check",
      short: "Complete a quick check for fast earnings.",
      detail:
        "**Skill Check**\n" +
        "Short, repeatable work built around quick interactions.\n" +
        "Great for players who want fast jobs without long commitment.\n\n" +
        "**Quick How-To:**\n" +
        "- Choose **Skill Check**\n" +
        "- Complete the interaction when prompted\n" +
        "- Get paid instantly on completion",
    },
    {
      id: "shiftWork",
      name: "9-5 Job - Shift Work",
      short: "Clock in, work the shift, take the payout.",
      detail:
        "**Shift Work**\n" +
        "A steady income option that rewards consistency.\n" +
        "Designed to feel like clocking in and completing a work cycle.\n\n" +
        "**Quick How-To:**\n" +
        "- Choose **Shift Work**\n" +
        "- Follow the prompts / actions\n" +
        "- Complete the shift to receive payout",
    },

    // =========================
    // NIGHTWALKER
    // =========================
    {
      id: "nightwalker",
      name: "Job Category - Nightwalker",
      short: "Adult-themed jobs with higher risk and rewards.",
      detail:
        "**Nightwalker**\n" +
        "A riskier income path with a darker, late-night vibe.\n" +
        "Higher reward potential, but you’re playing closer to the edge.\n\n" +
        "**Quick How-To:**\n" +
        "- Open **/jobs** → **Nightwalker**\n" +
        "- Pick a job\n" +
        "- Complete the prompt/action and collect payout",
    },

    {
      id: "flirt",
      name: "Nightwalker - Flirt",
      short: "Low-risk nightlife cash with quick interactions.",
      detail:
        "**Flirt**\n" +
        "A lighter Nightwalker option with smaller payouts and lower risk.\n" +
        "Designed as a quick income loop with a nightlife flavour.\n\n" +
        "**Quick How-To:**\n" +
        "- Select **Flirt**\n" +
        "- Follow the prompt\n" +
        "- Complete the interaction and get paid",
    },
    {
      id: "lapDance",
      name: "Nightwalker - Lap Dance",
      short: "Higher payout nightlife work with more risk.",
      detail:
        "**Lap Dance**\n" +
        "A step up from Flirt with stronger payout potential.\n" +
        "Still fast-paced, but with more risk baked into the loop.\n\n" +
        "**Quick How-To:**\n" +
        "- Select **Lap Dance**\n" +
        "- Complete the prompt/action\n" +
        "- Collect payout if successful",
    },
    {
      id: "prostitute",
      name: "Nightwalker - Prostitute",
      short: "High risk, high reward nightlife work.",
      detail:
        "**Prostitute**\n" +
        "The highest-risk Nightwalker option with the biggest earning potential.\n" +
        "This path is designed to feel dangerous — profits can spike, but so can consequences.\n\n" +
        "**Quick How-To:**\n" +
        "- Select **Prostitute**\n" +
        "- Follow the prompt carefully\n" +
        "- Complete the job to receive payout",
    },

    // =========================
    // GRIND
    // =========================
    {
      id: "grind",
      name: "Job Category - Grind",
      short: "Steady work with reliable payouts.",
      detail:
        "**Grind Jobs**\n" +
        "Repeatable, low-risk work designed for steady income.\n" +
        "These jobs are all about consistency over big swings.\n\n" +
        "**Quick How-To:**\n" +
        "- Open **/jobs** → **Grind**\n" +
        "- Choose a job\n" +
        "- Complete the prompt/action and collect payout",
    },

    {
      id: "storeClerk",
      name: "Grind - Store Clerk",
      short: "Fast-paced retail work with steady payouts.",
      detail:
        "**Store Clerk**\n" +
        "Retail work that keeps the economy moving with reliable returns.\n\n" +
        "**Quick How-To:**\n" +
        "- Pick **Store Clerk**\n" +
        "- Follow the prompts\n" +
        "- Complete the task cycle to get paid",
    },
    {
      id: "warehousing",
      name: "Grind - Warehousing",
      short: "Move cargo and keep the warehouse flowing.",
      detail:
        "**Warehousing**\n" +
        "A structured logistics job focused on steady task loops.\n\n" +
        "**Quick How-To:**\n" +
        "- Pick **Warehousing**\n" +
        "- Complete the handling prompts\n" +
        "- Get paid on completion",
    },
    {
      id: "fishing",
      name: "Grind - Fishing",
      short: "A slower-paced grind built on patience.",
      detail:
        "**Fishing**\n" +
        "A relaxed job loop with consistent, calmer income.\n\n" +
        "**Quick How-To:**\n" +
        "- Pick **Fishing**\n" +
        "- Follow the prompt/timing\n" +
        "- Collect payout for successful completion",
    },
    {
      id: "quarry",
      name: "Grind - Quarry",
      short: "Heavy labour with solid payouts.",
      detail:
        "**Quarry**\n" +
        "Industrial work with dependable earnings through effort-based cycles.\n\n" +
        "**Quick How-To:**\n" +
        "- Pick **Quarry**\n" +
        "- Complete the work prompt\n" +
        "- Receive payout when finished",
    },

    // =========================
    // CRIME
    // =========================
    {
      id: "crime",
      name: "Job Category - Crime",
      short: "High risk jobs that generate heat.",
      detail:
        "**Crime Jobs**\n" +
        "Crime pays… until it doesn’t.\n\n" +
        "Crime jobs offer bigger payouts, but they build **Heat**.\n" +
        "More heat means higher risk on future crime attempts.\n\n" +
        "**Quick How-To:**\n" +
        "- Open **/jobs** → **Crime**\n" +
        "- Choose a crime\n" +
        "- Complete the prompt/action\n" +
        "- Watch your Heat — it stacks",
    },

    {
      id: "storeRobbery",
      name: "Crime - Store Robbery",
      short: "Risky grab-and-go crime with quick payouts.",
      detail:
        "**Store Robbery**\n" +
        "Fast money with fast consequences.\n" +
        "Great for quick gains, but it raises your heat.\n\n" +
        "**Quick How-To:**\n" +
        "- Select **Store Robbery**\n" +
        "- Commit the job via the prompt\n" +
        "- Collect payout if you get away clean",
    },

    {
      id: "carChase",
      name: "Crime - Car Chase",
      short: "Coming soon.",
      detail:
        "**Car Chase**\n" +
        "Coming soon.\n\n" +
        "This crime job will introduce high-speed escape moments as part of the system.\n" +
        "More risk. More adrenaline. More heat.\n\n" +
        "-# Not available yet.",
    },

    {
      id: "drugPushing",
      name: "Crime - Drug Pushing",
      short: "Coming soon.",
      detail:
        "**Drug Pushing**\n" +
        "Coming soon.\n\n" +
        "This crime job will focus on street-level distribution with repeatable high-risk income.\n" +
        "The more you push, the more attention you draw.\n\n" +
        "-# Not available yet.",
    },

    {
      id: "heist",
      name: "Crime - Heist",
      short: "Big job, big heat.",
      detail:
        "**Heist**\n" +
        "High-value crime with serious consequences.\n" +
        "These jobs are designed to pay more, but punish mistakes harder.\n\n" +
        "**Quick How-To:**\n" +
        "- Select **Heist**\n" +
        "- Follow the prompt carefully\n" +
        "- Complete the job to claim the payout",
    },

    {
      id: "majorHeist",
      name: "Crime - Major Heist",
      short: "High stakes.",
      detail:
        "**Major Heist**\n" +
        "The top of the crime ladder.\n" +
        "Massive payout potential with extreme risk and serious heat generation.\n\n" +
        "**Quick How-To:**\n" +
        "- Select **Major Heist**\n" +
        "- Complete the prompt/action\n" +
        "- Get paid if you survive the consequences",
    },
  ],
};