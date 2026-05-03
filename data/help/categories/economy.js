// data/help/categories/economy.js
module.exports = {
  id: "economy",
  order: 2,
  name: "Economy",
  emoji: "💰",
  blurb: "Balance, banking, contracts, payouts, shop, and money movement.",

  commands: [
    {
      id: "bal",
      name: "/bal",
      short: "Shows your current wallet balance.",
      detail:
        "**/bal**\n" +
        "Displays your current wallet balance.",
    },
    {
      id: "balance",
      name: "/balance",
      short: "Alias for /bal.",
      detail:
        "**/balance**\n" +
        "Same as **/bal**. It shows your current wallet balance.",
    },
    {
      id: "leaderboard",
      name: "/leaderboard",
      short: "Shows the richest players.",
      detail:
        "**/leaderboard**\n" +
        "Shows the top player balances on the server leaderboard.",
    },
    {
      id: "bank",
      name: "/bank",
      short: "Open The Echo Reserve banking hub.",
      detail:
        "**/bank**\n" +
        "Opens your Echo Reserve account hub.\n\n" +
        "**What it shows:** wallet balance, bank balance, total wealth, account number, loan status, auto-deposit status, and recent banking tools.\n\n" +
        "**Actions:** deposit wallet money, withdraw bank money, transfer bank funds to another account number, view transaction history, and manage loans.\n\n" +
        "**Notes:** casino play uses wallet money, shop purchases use bank money, and bank transfers move bank-to-bank.",
    },
    {
      id: "bankLoans",
      name: "Bank Loans",
      short: "Borrow from The Echo Reserve and repay before recovery starts.",
      detail:
        "**Bank Loans**\n" +
        "Open **/bank**, choose **Loans**, then view available offers.\n\n" +
        "Loan offers show the amount borrowed, total owed, due date, grace period, and any wealth requirements. If accepted, the loan is deposited into your bank account.\n\n" +
        "**Repayment:** use the Loans panel to repay from available funds. If a loan becomes overdue or defaulted, The Echo Reserve can recover money from balances and incoming transfers.",
    },
    {
      id: "daily",
      name: "/daily",
      short: "Claim your daily payout.",
      detail:
        "**/daily**\n" +
        "Claim your daily reward.\n\n" +
        "**Note:** Can be claimed once daily.",
    },
    {
      id: "weekly",
      name: "/weekly",
      short: "Claim your weekly payout.",
      detail:
        "**/weekly**\n" +
        "Claim your weekly reward.\n\n" +
        "**Note:** Can be claimed once weekly.",
    },
    {
      id: "pay",
      name: "/pay",
      short: "Pay another player.",
      detail:
        "**/pay**\n" +
        "Send money to another user.\n\n" +
        "**Tip:** Double-check the amount before confirming.",
    },
    {
      id: "sendmoney",
      name: "/sendmoney",
      short: "Alias for /pay.",
      detail:
        "**/sendmoney**\n" +
        "Sends money to another user, same as **/pay**.",
    },
    {
      id: "shop",
      name: "/shop",
      short: "Browse, buy, and sell items.",
      detail:
        "**/shop**\n" +
        "Opens the shop panel.\n\n" +
        "**Buy view:** browse categories, move between pages, choose an item, and enter a quantity.\n\n" +
        "**Sell view:** sell eligible items from your inventory when they have a sell price.\n\n" +
        "The shop supports categories, limited stock, one-time buys, perks, roles, permanent items, consumables, and stackable items. Some items force quantity 1 when they are not stackable or have limited uses.",
    },
    {
      id: "ese",
      name: "/ese",
      short: "Open the Echo Stock Exchange.",
      detail:
        "**/ese**\n" +
        "Opens the Echo Stock Exchange hub.\n\n" +
        "**Use it to:** view the market overview, inspect listed companies, check top movers, read market news and rumors, view your portfolio, and buy or sell shares.\n\n" +
        "**Important:** trades use wallet money, include fees, have cooldowns, and can affect market activity.",
    },
    {
      id: "contracts",
      name: "/contracts",
      short: "View community and personal contracts.",
      detail:
        "**/contracts**\n" +
        "Shows the active community contract and your personal contracts.\n\n" +
        "Contracts track progress across supported activities such as farming, stock trading, and other economy actions. They give players extra goals beyond raw grinding.",
    },
    {
      id: "lottery",
      name: "/lottery info",
      short: "View the weekly Echo Powerball draw.",
      detail:
        "**/lottery info**\n" +
        "Shows the current Echo Powerball jackpot, next draw time, sales close time, ticket price, and tickets sold.\n\n" +
        "Tickets are bought from the lottery post when it is active. Each draw has a ticket cap, sales close before the draw, and the jackpot can roll over.",
    },
    {
      id: "jobHub",
      name: "/job",
      short: "Open the work hub.",
      detail:
        "**/job**\n" +
        "Opens the work hub where you can pick a job type.",
    },
  ],
};
