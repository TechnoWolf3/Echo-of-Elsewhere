// data/features/categories/jobs.js
module.exports = {
  id: "jobs",
  order: 3,
  name: "Jobs",
  emoji: "🧑‍🔧",
  blurb: "Clock on, hustle hard, or risk everything for bigger money.",
  description:
    "Jobs are one of the main ways fresh money enters the economy. From easy legal shifts to grind jobs, crime, and nightlife work, every category offers a different style of earning with its own pressure and payout.",

  items: [
    {
      id: "nine_to_five_transport",
      name: "🚚 Transport Contract",
      short: "Parcel delivery with risk-based routes and payout choices.",
      detail:
        "Transport Contract is a fast legal delivery job where players move cargo and choose how much risk they want to take on.\n\n" +
        "Safer options keep things steady. Riskier routes and choices can lift the payout, but one bad decision can cost the whole job.",
    },
    {
      id: "nine_to_five_trucker",
      name: "🚛 Trucker",
      short: "Take a manifest, haul freight, and watch the kilometres roll by.",
      detail:
        "Trucker expands the 9-5 roster with a longer-form transport job built around proper freight work.\n\n" +
        "Players receive a manifest, haul realistic loads across real Australian-style distances, and track progress from departure to delivery. It is a calmer, click-and-wait style job with strong flavour and solid progression potential.\n\n" +
        "For players who like logistics and long-haul vibes, it adds a much more grounded transport option to the work hub.",
    },
    {
      id: "nine_to_five_skill_check",
      name: "🤹 Skill Check",
      short: "Quick reactions, quick payout, quick mistakes.",
      detail:
        "Skill Check is built around speed, attention, and clean execution.\n\n" +
        "Spot the right prompt in time and keep the shift alive. Slip up, and the job can end early. It is one of the fastest legal earners for players who trust their reactions.",
    },
    {
      id: "nine_to_five_shift",
      name: "🕒 Shift",
      short: "Clock on, wait it out, collect your pay.",
      detail:
        "Shift is the simplest legal job on the board.\n\n" +
        "There is very little risk and very little effort, which also means the payout stays modest. It is the easy option for players who just want clean, dependable income.",
    },
    {
      id: "nightwalker_flirt",
      name: "💬 Flirt",
      short: "Read the room, play it right, and keep the client interested.",
      detail:
        "Flirt is a social, choice-driven Night Walker job where reading the vibe matters.\n\n" +
        "Pick the right responses and the payout climbs. Misread the moment and the whole interaction can collapse.",
    },
    {
      id: "nightwalker_lap_dance",
      name: "💃 Lap Dance",
      short: "Keep the energy up and turn confidence into tips.",
      detail:
        "Lap Dance leans into performance, momentum, and handling mid-job incidents without losing control.\n\n" +
        "The better you manage the session, the better the payout. It is flashy, risky, and very different to the slower legal jobs.",
    },
    {
      id: "nightwalker_prostitute",
      name: "🎲 Prostitute",
      short: "High pressure nightlife work with high earning potential.",
      detail:
        "This Night Walker role pushes risk and reward further, asking players to stay in control while dealing with volatile client interactions.\n\n" +
        "Handle it well and the money can be excellent. Handle it badly and the job can go south quickly.",
    },
    {
      id: "grind_store_clerk",
      name: "🏪 Store Clerk",
      short: "Fast retail gameplay with steady, reliable payouts.",
      detail:
        "Store Clerk puts players behind the counter in a simple but satisfying retail loop.\n\n" +
        "Quick prompts, clean interactions, and dependable income make it one of the best entry points into the grind category.",
    },
    {
      id: "grind_warehousing",
      name: "📦 Warehousing",
      short: "Move stock, handle orders, and keep the warehouse alive.",
      detail:
        "Warehousing is a logistics-focused grind job built around consistent task completion and efficiency.\n\n" +
        "It rewards players who enjoy a structured workflow and a sense of building momentum over time.",
    },
    {
      id: "grind_fishing",
      name: "🎣 Fishing",
      short: "A calmer earning path built on patience and timing.",
      detail:
        "Fishing offers a slower-paced grind loop for players who want something more relaxed.\n\n" +
        "It trades chaos for patience while still feeding directly into the wider economy.",
    },
    {
      id: "grind_quarry",
      name: "🪨 Quarry",
      short: "Heavy labour, industrial flavour, and solid returns.",
      detail:
        "Quarry work focuses on extraction, workload, and effort-based earnings.\n\n" +
        "It is one of the more demanding grind options, but that effort comes with respectable payouts.",
    },
    {
      id: "crime_store_robbery",
      name: "🏪 Store Robbery",
      short: "Fast crime, quick cash, and rising heat.",
      detail:
        "Store Robbery is a fast-moving criminal option for players who want quick hits instead of long jobs.\n\n" +
        "It can pay well, but every robbery raises heat and increases the pressure on future crime attempts.",
    },
    {
      id: "crime_heist",
      name: "🏦 Heist",
      short: "Bigger crime with bigger planning and bigger consequences.",
      detail:
        "Heists take crime beyond simple smash-and-grab jobs and into higher-stakes coordinated runs.\n\n" +
        "The reward ceiling is much higher, but so is the fallout when it goes wrong.",
    },
    {
      id: "crime_major_heist",
      name: "💎 Major Heist",
      short: "Top-tier crime with extreme reward and extreme danger.",
      detail:
        "Major Heist sits at the top of the crime ladder.\n\n" +
        "Huge payouts are possible, but so are huge losses, major heat, and hard consequences. It is designed for players who want to push their luck all the way.",
    },
    {
      id: "jail_system",
      name: "Jail System",
      short: "Crime consequences with bail, prison work, contraband, escape, and cards.",
      detail:
        "Jail is what happens when Echo decides your crime career needs a concrete timeout.\n\n" +
        "While jailed, players can use **/jail** to open the jail hub. From there they can pay harsh bail, work prison details for Prison Money and modest sentence reduction, buy contraband, attempt escape, gamble at the card table, or simply wait it out.\n\n" +
        "Prison Money only exists inside the current jail session. It is earned from jail activities, spent on contraband or gambling, and converts to wallet cash on release. Wallet and bank money cannot buy contraband.\n\n" +
        "Jail is interactive now, but it is still punishment: bail is expensive, escape failure is harsh, and work/items cannot erase the full sentence.",
    },
    {
      id: "underworld_overview",
      name: "Underworld",
      short: "Persistent illegal operations with buildings, runs, events, suspicion, and raids.",
      detail:
        "Underworld is a high-cost, high-risk path inside **/job**. It is built around persistent buildings that keep moving while the player is offline.\n\n" +
        "The live branch is **Operations**. Players buy warehouse shells, convert them into operations, fund runs, respond to live events, and choose how aggressively to distribute the results.\n\n" +
        "Underworld is not a quick button payout. It uses bank-funded setup costs, timed conversions, timed runs, suspicion pressure, raid chances, and serious consequences if a full bust hits.",
    },
    {
      id: "underworld_buildings_operations",
      name: "Underworld - Buildings & Operations",
      short: "Buy warehouses and convert them into labs or storage operations.",
      detail:
        "Underworld starts with buildings. Players can buy Small, Medium, or Large Warehouses, up to the configured building limit.\n\n" +
        "A purchased shell can be converted into a **Meth Lab**, **Cocaine Lab**, or **Storage House**. Conversion costs bank money, contributes to the server bank, and takes time before the building becomes usable.\n\n" +
        "Meth and cocaine labs run paid batches that later need distribution. Storage Houses generate fenced goods that can cool off before sale.",
    },
    {
      id: "underworld_runs_events",
      name: "Underworld - Runs, Events & Distribution",
      short: "Start paid runs, handle events, then choose safe, standard, or aggressive distribution.",
      detail:
        "Once a building has an operation installed, players can start a run by paying the batch cost from the bank.\n\n" +
        "Runs can open live events such as police patrols, equipment issues, expansion offers, or loose neighborhood talk. Responding can cost money, reduce or increase suspicion, change output, or shift raid odds. Ignored events apply their own penalties when the window expires.\n\n" +
        "When a run is ready, distribution choices decide the final push: **Safe** pays less and reduces risk, **Standard** is balanced, and **Aggressive** pays more while adding suspicion and raid chance.",
    },
    {
      id: "underworld_suspicion_raids",
      name: "Underworld - Suspicion, Raids & Dismantling",
      short: "Manage suspicion or risk raids, lost payouts, full busts, and jail.",
      detail:
        "Each building has suspicion. Suspicion decays over time, but events, aggressive distribution, early storage sales, and raid outcomes can push it back up.\n\n" +
        "Distribution rolls against raid risk. Minor raids reduce payout and add suspicion. Major raids can wipe the payout. A full bust can remove the building and send the player to jail.\n\n" +
        "Players can dismantle an installed operation for a partial refund based on investment and suspicion. Emergency dismantle is available even in rougher states, but pays much less.",
    },
    {
      id: "underworld_storage",
      name: "Underworld - Storage Houses",
      short: "Generate fenced goods, wait through cool-off, or sell early with extra risk.",
      detail:
        "Storage Houses turn paid runs into stored goods such as counterfeit electronics, designer knockoffs, auto parts, grey-market phones, and luxury watches.\n\n" +
        "Goods have cool-off timers before they are safer to sell. Selling early can reduce payout, add suspicion, increase raid risk, and may trigger a stolen-goods report.\n\n" +
        "Storage buildings have capacity. If storage is full, players need to sell goods before starting another storage run.",
    },
  ],
};
