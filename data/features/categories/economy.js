// data/features/categories/economy.js
module.exports = {
  id: "economy",
  order: 1,
  name: "Economy Features",
  emoji: "💸",
  blurb: "A living economy powered by wallets, banks, loans, contracts, and the shared vault.",
  description:
    "Echo's economy is built to move, not sit still. Your wallet, your bank account, the server vault, loans, jobs, gambling, contracts, investments, and long-term progression all connect into one shared financial system.",

  items: [
    {
      id: "server_bank",
      name: "Server Bank",
      short: "The shared vault that keeps the whole economy alive.",
      detail:
        "**Server Bank**\n" +
        "At the heart of The Place is a shared, server-wide vault that powers money-based activity across the bot.\n\n" +
        "Casino wins pull from the vault. Losses, fines, and sinks feed it back in. That means the health of the wider economy actually matters, especially when big payouts are involved.\n\n" +
        "It turns the economy into something reactive instead of fake money appearing out of nowhere.",
    },
    {
      id: "wallet_and_echo_reserve",
      name: "Wallet & The Echo Reserve",
      short: "Split your money between cash in hand and secure banking.",
      detail:
        "**Wallet**\n" +
        "Your wallet is your cash in hand. Most earnings land here first, which means it is convenient but exposed.\n\n" +
        "**The Echo Reserve**\n" +
        "Use **/bank** to access the bank hub. From there, players can manage their money properly with deposits, withdrawals, transfers, account information, transaction history, and recurring deposits.\n\n" +
        "Keeping money in the bank protects it from wallet-based risks and makes the financial system feel far more real than a single balance ever could.",
    },
    {
      id: "shop_and_inventory",
      name: "Shop & Inventory",
      short: "Buy, sell, store, and use items across the economy.",
      detail:
        "The shop gives players a structured place to buy and sell items through **/shop**.\n\n" +
        "Items can be grouped into categories, limited by stock, marked as one-time buys, sold back when eligible, or configured as consumables, perks, roles, permanent purchases, tools, and general items.\n\n" +
        "Use **/inventory** to view owned items, quantities, and remaining uses on limited-use items.",
    },
    {
      id: "loan_system",
      name: "Loan System",
      short: "Borrow now, repay later, and hope Echo stays patient.",
      detail:
        "The loan system gives players access to borrowed money through The Echo Reserve, letting them take financial risks before they have the cash to fully back them.\n\n" +
        "Loans are useful for getting moving, funding larger plans, or surviving a rough run, but debt comes with responsibility. Missed repayment dates can trigger recovery pressure from the bank.\n\n" +
        "It adds pressure, progression, and real decision-making to the economy instead of every player growing at the same pace.",
    },
    {
      id: "dynamic_circulation",
      name: "Dynamic Money Circulation",
      short: "Money moves around the server instead of spawning from thin air.",
      detail:
        "**How the economy moves**\n" +
        "Money in The Place is constantly circulating. Casino losses refill the vault, wins drain it, jobs generate fresh earnings, banking tools move funds, and long-term systems create new sinks and rewards.\n\n" +
        "That circulation helps keep the economy from feeling flat, stale, or endlessly inflated.",
    },
    {
      id: "income_systems",
      name: "Income Systems",
      short: "Steady work, risky play, and long-term earning paths.",
      detail:
        "Players can earn through legal jobs, grind-style work, crime, casino games, rituals, random events, contracts, investments, and longer-term systems like farming and enterprises.\n\n" +
        "Some paths are safe and predictable. Others are high-risk and high-reward. Together, they create a proper ladder of progression instead of a one-note grind.",
    },
    {
      id: "echo_stock_exchange",
      name: "Echo Stock Exchange",
      short: "Buy, hold, and react to a market that moves with the server.",
      detail:
        "The Echo Stock Exchange gives players a longer-term investment path through **/ese**.\n\n" +
        "Prices shift with market conditions, player behaviour, and server-wide activity, meaning the market is not just decorative. It reacts.\n\n" +
        "For players who like strategy over instant payouts, the exchange adds a slower, smarter way to build wealth.",
    },
    {
      id: "contracts",
      name: "Contracts",
      short: "Shared and personal goals that reward active play.",
      detail:
        "Contracts give players structured goals beyond simple command repetition.\n\n" +
        "Use **/contracts** to view the active community contract and personal contracts. Supported systems can feed progress into contracts, including farming, stock trading, and other economy activity.\n\n" +
        "They help turn everyday actions into longer-running server objectives.",
    },
    {
      id: "echo_powerball",
      name: "Echo Powerball",
      short: "A weekly lottery with capped tickets and rollover jackpots.",
      detail:
        "Echo Powerball is the server lottery system.\n\n" +
        "Players can check draw details with **/lottery info**, then buy tickets from the lottery post when sales are open. Tickets have a fixed price, a per-player cap, and sales close before the draw.\n\n" +
        "Jackpots can roll over, with divisional pools giving the draw more than one way to pay out.",
    },
    {
      id: "risk_and_loss_mechanics",
      name: "Risk & Loss Mechanics",
      short: "Bad decisions cost money, and that matters.",
      detail:
        "Losses are part of the design. Failed gambles, fines, bad calls, risky routes, crime pressure, debt, and poor timing all carry consequences.\n\n" +
        "That is what gives money value. Without meaningful loss, wins stop meaning anything.",
    },
    {
      id: "cooldowns_and_regulations",
      name: "Cooldowns & Safeguards",
      short: "Systems that keep the economy healthy over time.",
      detail:
        "Cooldowns, payout checks, and other safeguards help prevent spam, protect the vault, and keep systems sustainable long term.\n\n" +
        "They are there to keep things balanced without stripping away the fun of earning big.",
    },
    {
      id: "random_events",
      name: "Random Events",
      short: "Surprise opportunities that can shake up your balance sheet.",
      detail:
        "Timed and surprise events inject bursts of activity into the economy. Some reward speed, some reward luck, and others tempt players into taking risks they probably should not.\n\n" +
        "They keep the server feeling alive by creating moments that cannot be planned perfectly.",
    },
  ],
};
