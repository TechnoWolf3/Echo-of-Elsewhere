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
      name: "/job",
      short: "Open the job and enterprise hub.",
      detail:
        "**/job**\n" +
        "Opens the job hub where you can pick work, crime, grind jobs, Nightwalker jobs, enterprises, farming, and Underworld paths.\n\n" +
        "**Categories:**\n" +
        "🧰 **Work a 9-5** – safe, structured income.\n" +
        "🧠 **Nightwalker** – adult-themed income with higher risk.\n" +
        "🕒 **Grind** – steady, repeatable work, but builds **Fatigue**\n" +
        "🕶️ **Crime** – bigger payouts, but builds **Heat**.\n" +
        "🏢 **Enterprises** – longer-term systems such as Farming and Manufacturing.\n" +
        "🧪 **Underworld** – persistent illegal operations with serious risk.\n\n" +
        "**Quick How-To:**\n" +
        "- Run **/job**\n" +
        "- Select a category\n" +
        "- Pick a job from the list\n" +
        "- Follow the buttons/prompts to complete it\n\n" +
        "Heads up: **Heat only affects Crime jobs.**",
    },
    {
      id: "farming",
      name: "Enterprise - Farming",
      short: "Overview of the farming enterprise.",
      detail:
        "**Farming**\n" +
        "Farming lives under **/job** -> **Enterprises**. It is a slower progression path built around land, crops, machinery, barns, weather, supplies, livestock, and market selling.\n\n" +
        "**Main areas:**\n" +
        "- Farming hub: overview, plot status, weather, market, store, and machine shed\n" +
        "- Fields: cultivate, seed, harvest, fertilise, upgrade, or convert to barns\n" +
        "- Farm Market: sell harvested farm inventory\n" +
        "- Farm Store: buy fertiliser and animal husbandry items\n" +
        "- Machine Shed: buy, rent, and sell machinery\n" +
        "- Barns: collect produce, restock, slaughter, breed, upgrade, or demolish",
    },
    {
      id: "farmingFieldsCrops",
      name: "Farming How-To - Fields & Crops",
      short: "Buy land, cultivate, plant, harvest, and upgrade fields.",
      detail:
        "**Fields & Crops**\n" +
        "Fields are the crop-growing side of farming.\n\n" +
        "**How to grow crops:**\n" +
        "- Open **/job** -> **Enterprises** -> **Farming**\n" +
        "- Buy a field if you need land\n" +
        "- Open a field and cultivate it if needed\n" +
        "- Pick a crop from the seasonal crop list\n" +
        "- Wait for the seeding and growth timers\n" +
        "- Harvest when the crop is ready\n" +
        "- Sell produce through the Farm Market\n\n" +
        "**Important:** Crops are limited by field level and season. Field upgrades are timed tasks, and the new level applies only when the upgrade completes.",
    },
    {
      id: "farmingMachines",
      name: "Farming How-To - Machine Shed",
      short: "Use machinery for field tasks.",
      detail:
        "**Machine Shed**\n" +
        "Most field work needs machinery. The Machine Shed is where players manage equipment.\n\n" +
        "**What you can do:**\n" +
        "- Buy machines for permanent use\n" +
        "- Rent machines for short-term access\n" +
        "- Sell owned machines for partial value\n" +
        "- Browse machine categories and see supported task types\n\n" +
        "Active field tasks reserve the machines they use. Busy machines cannot be reused or sold until the task finishes. Better compatible machine sets can shorten field task durations.",
    },
    {
      id: "farmingStoreFertiliser",
      name: "Farming How-To - Store & Fertiliser",
      short: "Buy farm supplies and apply fertiliser at the right time.",
      detail:
        "**Farm Store & Fertiliser**\n" +
        "The Farm Store is a category hub for farming supplies.\n\n" +
        "**Fertiliser:**\n" +
        "- Open **Store** from the farming hub\n" +
        "- Choose **Fertiliser**\n" +
        "- Select a fertiliser and enter a quantity to buy\n" +
        "- Apply it from a field page during a valid growth window\n\n" +
        "Fertiliser can only be applied while a crop is growing, either in the first 10% of growth or after 75% growth before ready. Effects can shorten growth, increase yield, or provide a mix of both.",
    },
    {
      id: "farmingBarnsLivestock",
      name: "Farming How-To - Barns & Livestock",
      short: "Convert fields into barns and manage animal production.",
      detail:
        "**Barns & Livestock**\n" +
        "Barns turn fields into animal production.\n\n" +
        "**How barns work:**\n" +
        "- Open an empty cultivated field\n" +
        "- Choose a barn type: Chicken Coop, Sheep Barn, or Dairy Barn\n" +
        "- The new barn starts at level 1\n" +
        "- Collect produce when production cycles are ready\n" +
        "- Restock an empty barn, slaughter animals, upgrade the barn, or demolish it back into a field\n\n" +
        "Converting field to barn resets the barn to level 1. Demolishing barn to field resets the field to level 1. Barn upgrades are timed, and production pauses while an upgrade is active.",
    },
    {
      id: "farmingHusbandry",
      name: "Farming How-To - Animal Husbandry",
      short: "Breed animals and manage young livestock.",
      detail:
        "**Animal Husbandry**\n" +
        "Animal Husbandry items let players increase barn animal counts without restocking from empty.\n\n" +
        "**How to breed animals:**\n" +
        "- Buy a matching husbandry item from **Farm Store** -> **Animal Husbandry**\n" +
        "- Open the matching barn\n" +
        "- Make sure the barn has at least two adult animals\n" +
        "- Make sure there is free barn capacity\n" +
        "- Use the breed dropdown on the barn page\n\n" +
        "Young animals count toward capacity but do not produce until they mature. Higher barn levels increase capacity, which lets players hold more animals and earn more produce once they are adults.",
    },
    {
      id: "farmingWeatherMarket",
      name: "Farming How-To - Weather, Seasons & Market",
      short: "Understand seasons, weather effects, and selling produce.",
      detail:
        "**Weather, Seasons & Market**\n" +
        "Farming changes over time through seasons, weather, and market prices.\n\n" +
        "**Seasons:** Only crops valid for the current season can be planted.\n" +
        "**Weather:** Clear weather is neutral, rain can help yields, heatwaves and frost can reduce crop output, and storms can damage fields.\n" +
        "**Market:** Harvested crops and barn outputs become inventory items. Open **Market** from the farming hub to sell farm stock using current market pricing.\n\n" +
        "Farming also feeds contract progress through planted fields and harvested quantities.",
    },
    {
      id: "manufacturing",
      name: "Enterprise - Manufacturing",
      short: "Overview of the manufacturing enterprise.",
      detail:
        "**Manufacturing**\n" +
        "Manufacturing lives under **/job** -> **Enterprises** -> **Manufacturing**. It is a slower enterprise path built around factory plots, recipe production, contracts, and finished-goods markets.\n\n" +
        "**Main areas:**\n" +
        "- Manufacturing hub: plot overview, market, contracts, and supply access\n" +
        "- Factory Plots: assign a factory type, upgrade, import inputs, buy materials, and run recipes\n" +
        "- Manufacturing Market: sell finished goods instantly\n" +
        "- Manufacturing Contracts: turn in finished goods for better payout\n" +
        "- Supply flow: import Farming goods or buy manufacturing-only materials",
    },
    {
      id: "manufacturingHowTo",
      name: "Manufacturing How-To - Plots, Recipes & Supply",
      short: "Buy a plot, assign a factory type, stock it, and start production.",
      detail:
        "**Factory Plots & Recipes**\n" +
        "Manufacturing mirrors Farming's plot flow, but replaces fields and crops with factory plots and recipes.\n\n" +
        "**How to start:**\n" +
        "- Open **/job** -> **Enterprises** -> **Manufacturing**\n" +
        "- Buy a factory plot\n" +
        "- Open the plot and assign a factory type\n" +
        "- Import Farming goods or buy materials into the plot's input storage\n" +
        "- Review the unlocked recipe list on the plot page\n" +
        "- Start a recipe from the production dropdown\n\n" +
        "Each plot has limited input and output storage. Higher plot levels increase storage and unlock more production slots and recipes.",
    },
    {
      id: "manufacturingMarketContracts",
      name: "Manufacturing How-To - Market, Contracts & Events",
      short: "Sell finished goods, fulfill contracts, and handle bonus events.",
      detail:
        "**Market, Contracts & Events**\n" +
        "Manufacturing turns raw inputs into finished goods that can be monetised in two ways.\n\n" +
        "**Market:** Instant sales with fluctuating prices.\n" +
        "**Contracts:** Better payout, but requires the right goods on hand.\n" +
        "**Factory Events:** Optional mid-run events can appear during production. Ignoring them causes no penalty. Handling them grants a bonus outcome only.\n\n" +
        "Bought manufacturing materials cannot be sold back. They exist only to support production inside Manufacturing.",
    },
    {
      id: "underworld",
      name: "Underworld",
      short: "Persistent illegal operations with buildings, runs, suspicion, and raids.",
      detail:
        "**Underworld**\n" +
        "Underworld lives under **/job** -> **Underworld**. It is a high-cost, high-risk path built around persistent buildings and illegal operations.\n\n" +
        "**Live branch:** Operations.\n" +
        "**Scaffolded for later:** Smuggling and Fronts.\n\n" +
        "**Main areas:**\n" +
        "- Buy warehouse buildings\n" +
        "- Convert buildings into operations\n" +
        "- Start paid runs\n" +
        "- Respond to live events\n" +
        "- Choose distribution risk\n" +
        "- Manage suspicion, raids, dismantling, and storage goods",
    },
    {
      id: "underworldBuildings",
      name: "Underworld How-To - Buildings & Conversion",
      short: "Buy warehouses and install an operation.",
      detail:
        "**Buildings & Conversion**\n" +
        "Buildings are the foundation of Underworld operations.\n\n" +
        "**How to start:**\n" +
        "- Open **/job** -> **Underworld** -> **Operations**\n" +
        "- Buy a warehouse shell: Small, Medium, or Large Warehouse\n" +
        "- Inspect the building\n" +
        "- Convert it into an operation: Meth Lab, Cocaine Lab, or Storage House\n" +
        "- Wait for the conversion timer to complete\n\n" +
        "Purchases and conversions use bank money and add money to the server bank. Larger buildings cost more, hold more capacity, and carry more risk.",
    },
    {
      id: "underworldRuns",
      name: "Underworld How-To - Runs & Events",
      short: "Start operation runs and handle live events.",
      detail:
        "**Runs & Events**\n" +
        "Once a building has an operation installed, it can start paid runs.\n\n" +
        "**How runs work:**\n" +
        "- Inspect a converted building\n" +
        "- Press **Start Operation**\n" +
        "- Pay the batch cost from bank money\n" +
        "- Wait while the run progresses\n" +
        "- Respond to live events before their window closes\n" +
        "- Finish the run and distribute the result when ready\n\n" +
        "Live events can change output, suspicion, payout, and raid chance. Ignoring an event can apply automatic penalties.",
    },
    {
      id: "underworldDistribution",
      name: "Underworld How-To - Distribution & Raids",
      short: "Pick safe, standard, or aggressive distribution and manage raid risk.",
      detail:
        "**Distribution & Raids**\n" +
        "When a run is ready, distribution decides how hard the operation pushes the result to market.\n\n" +
        "**Distribution modes:**\n" +
        "- **Safe:** lower payout, lower suspicion and raid chance\n" +
        "- **Standard:** balanced payout and risk\n" +
        "- **Aggressive:** higher payout, higher suspicion and raid chance\n\n" +
        "Raid outcomes can cut payout, wipe payout, add suspicion, or trigger a full bust. A full bust can remove the building and send the player to jail.",
    },
    {
      id: "underworldStorage",
      name: "Underworld How-To - Storage Houses",
      short: "Generate stored goods, cool them off, and sell carefully.",
      detail:
        "**Storage Houses**\n" +
        "Storage Houses create fenced goods instead of an immediate lab-style payout.\n\n" +
        "**How storage works:**\n" +
        "- Convert a building into a Storage House\n" +
        "- Start a paid storage run\n" +
        "- Generated goods are stored in the building\n" +
        "- Wait for cool-off timers before safer sale\n" +
        "- Sell through Safe, Standard, or Aggressive distribution\n\n" +
        "Selling early can reduce payout, add suspicion, increase raid chance, and may trigger a stolen-goods report. If storage is full, sell goods before starting another storage run.",
    },
    {
      id: "underworldSuspicionDismantle",
      name: "Underworld How-To - Suspicion & Dismantling",
      short: "Lower pressure, dismantle operations, or emergency clear a building.",
      detail:
        "**Suspicion & Dismantling**\n" +
        "Suspicion is tracked per building and affects raid pressure and liquidation value.\n\n" +
        "Suspicion decays slowly over time, but events, aggressive choices, raids, storage reports, and early sales can raise it again.\n\n" +
        "**Dismantling:**\n" +
        "- Normal dismantle clears the installed setup and can return part of invested setup money\n" +
        "- Higher suspicion lowers the refund\n" +
        "- Emergency dismantle is harsher and pays much less, but can be used as a panic button\n\n" +
        "Dismantling clears the current operation setup and storage, so it should be treated as a serious reset.",
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
        "- Open **/job** → **Work a 9-5**\n" +
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
        "- Open **/job** → **Nightwalker**\n" +
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
        "- Open **/job** → **Grind**\n" +
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
        "- Open **/job** → **Crime**\n" +
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
    {
      id: "jail",
      name: "/jail",
      short: "Open the jail hub while serving a sentence.",
      detail:
        "**/jail**\n" +
        "Opens your jail panel if you are currently jailed.\n\n" +
        "**What you can do:**\n" +
        "- Pay fixed wallet-only bail based on the original sentence\n" +
        "- Work prison details for Prison Money and small sentence reductions\n" +
        "- Buy contraband with Prison Money only\n" +
        "- Attempt escape for a high-risk instant release\n" +
        "- Use the Card Table if you own a Deck of Cards or another player is jailed\n\n" +
        "**Important:** Prison Money is session-only. Leftover Prison Money converts to wallet cash when you are released. Work and contraband reductions cannot remove the whole sentence.",
    },
  ],
};
