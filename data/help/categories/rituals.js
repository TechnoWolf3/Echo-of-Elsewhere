// data/help/categories/rituals.js
module.exports = {
  id: "rituals",
  order: 5,
  name: "Rituals",
  emoji: "🕯️",
  blurb: "Timed claims and Echo puzzle rituals.",

  commands: [
    {
      id: "ritualsHub",
      name: "/rituals",
      short: "Open the rituals hub.",
      detail:
        "**/rituals**\n" +
        "Opens the Echo Rituals hub. The panel shows which rituals are ready, which are on cooldown, and gives access to primary claims and daily side rituals.\n\n" +
        "**Primary Rituals:**\n" +
        "- Daily Ritual\n" +
        "- Weekly Ritual\n" +
        "- Monthly Ritual\n\n" +
        "**Other Rituals:**\n" +
        "- Echo Wheel\n" +
        "- Echo Cipher\n" +
        "- Veil Sequence\n" +
        "- Blade Grid\n" +
        "- Echo Seating\n\n" +
        "Most rituals reset on Sydney timing and completed rituals can progress ritual contracts.",
    },
    {
      id: "dailyRitual",
      name: "Daily Ritual",
      short: "Once-per-day claim payout.",
      detail:
        "**Daily Ritual**\n" +
        "A simple daily claim from the primary ritual buttons.\n\n" +
        "Current payout: **$20,000-$35,000**.\n" +
        "Reset: once per Sydney day.",
    },
    {
      id: "weeklyRitual",
      name: "Weekly Ritual",
      short: "Once-per-week claim payout.",
      detail:
        "**Weekly Ritual**\n" +
        "A larger weekly claim from the primary ritual buttons.\n\n" +
        "Current payout: **$175,000-$275,000**.\n" +
        "Reset: once per Sydney week.",
    },
    {
      id: "monthlyRitual",
      name: "Monthly Ritual",
      short: "Once-per-month claim payout.",
      detail:
        "**Monthly Ritual**\n" +
        "The long-cycle primary ritual claim.\n\n" +
        "Current payout: **$500,000-$800,000**.\n" +
        "Reset: once per Sydney month.",
    },
    {
      id: "echoWheel",
      name: "Echo Wheel",
      short: "A paid daily spin with mixed outcomes.",
      detail:
        "**Echo Wheel**\n" +
        "A daily spin ritual selected from the Other Rituals dropdown.\n\n" +
        "Cost: **$10,000** from wallet.\n" +
        "Possible outcomes include cash, items, lottery tickets, jackpot rewards, casino vouchers, blessings, curses, jail, account trouble, and other Echo chaos.\n\n" +
        "Cash wins count toward ritual earnings contracts.",
    },
    {
      id: "echoCipher",
      name: "Echo Cipher",
      short: "Solve a five-digit code.",
      detail:
        "**Echo Cipher**\n" +
        "A daily code-breaking ritual selected from the Other Rituals dropdown.\n\n" +
        "Guess the five-digit lock before attempts run out. Digits may repeat.\n" +
        "Solving earlier pays better, currently up to **$100,000**.",
    },
    {
      id: "veilSequence",
      name: "Veil Sequence",
      short: "Place five numbers in ascending order.",
      detail:
        "**Veil Sequence**\n" +
        "A daily sequence ritual selected from the Other Rituals dropdown.\n\n" +
        "Arrange five revealed numbers into ascending order. Each placement locks in permanently.\n" +
        "Accuracy controls payout, currently up to **$85,000**.",
    },
    {
      id: "bladeGrid",
      name: "Blade Grid",
      short: "Survive a row and column strike.",
      detail:
        "**Blade Grid**\n" +
        "A daily grid ritual selected from the Other Rituals dropdown.\n\n" +
        "Pick one square on a 5x3 board. Echo strikes a full row and a full column. If your square survives both, you win.\n" +
        "Current win payout: **$60,000-$90,000**.",
    },
    {
      id: "echoSeating",
      name: "Echo Seating",
      short: "Solve a seating-order logic puzzle.",
      detail:
        "**Echo Seating / Echo Arrangement**\n" +
        "A daily logic puzzle selected from the Other Rituals dropdown.\n\n" +
        "Arrange 5-10 names into the correct order using the clues. Submit by modal, use feedback carefully, and solve before mistakes run out.\n" +
        "Payout scales with puzzle size and mistakes used.",
    },
  ],
};
