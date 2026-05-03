// data/features/categories/rituals.js
module.exports = {
  id: "rituals",
  order: 6,
  name: "Rituals",
  emoji: "🕯️",
  blurb: "Timed claims, daily puzzles, and Echo's stranger reward games.",
  description:
    "The Rituals hub gathers Echo's recurring claims and daily side rituals into one place. Players can claim reliable daily, weekly, and monthly payouts, then take on interactive rituals for stronger rewards, perks, and riskier outcomes.",

  items: [
    {
      id: "rituals_hub",
      name: "/rituals",
      short: "Open the full ritual hub.",
      detail:
        "**/rituals**\n" +
        "Opens the ritual hub with ready states, cooldowns, primary claims, and the daily side-ritual dropdown.\n\n" +
        "**Primary rituals:** Daily Ritual, Weekly Ritual, Monthly Ritual.\n" +
        "**Other rituals:** Echo Wheel, Echo Cipher, Veil Sequence, Blade Grid, Echo Seating.\n\n" +
        "Rituals use Sydney reset timing and feed ritual completion and ritual earnings contract progress when completed.",
    },
    {
      id: "ritual_claims",
      name: "Ritual Claims",
      short: "Daily, weekly, and monthly check-in payouts.",
      detail:
        "**Ritual Claims**\n" +
        "The claim rituals are straightforward recurring payouts for regular check-ins.\n\n" +
        "**Daily Ritual** - once per Sydney day, currently pays **$20,000-$35,000**.\n" +
        "**Weekly Ritual** - once per Sydney week, currently pays **$175,000-$275,000**.\n" +
        "**Monthly Ritual** - once per Sydney month, currently pays **$500,000-$800,000**.\n\n" +
        "These are the stable side of rituals: no puzzle, no spin, just a timed Echo payout.",
    },
    {
      id: "echo_wheel",
      name: "Echo Wheel",
      short: "A paid daily spin with rewards, setbacks, and chaos outcomes.",
      detail:
        "**Echo Wheel**\n" +
        "A once-per-day interactive ritual where players pay **$10,000** from wallet to spin.\n\n" +
        "Possible outcomes include cash wins, random items, lottery tickets, jackpot-style rewards, account trouble, jail, casino vouchers, blessings, curses, void spins, and Echo's less helpful jokes.\n\n" +
        "Cash outcomes now count toward ritual earnings contracts.",
    },
    {
      id: "echo_cipher",
      name: "Echo Cipher",
      short: "Crack a five-digit lock before Echo punishes failure.",
      detail:
        "**Echo Cipher**\n" +
        "A daily code-breaking ritual. Players try to solve a hidden five-digit code with repeated digits allowed.\n\n" +
        "Solving earlier pays better, currently up to **$100,000**. Failure can trigger harsher Echo consequences such as jail or curses.",
    },
    {
      id: "veil_sequence",
      name: "Veil Sequence",
      short: "Arrange revealed numbers into ascending order.",
      detail:
        "**Veil Sequence**\n" +
        "A daily ordering puzzle. Five numbers are revealed and players lock them into ascending order one placement at a time.\n\n" +
        "Rewards scale with accuracy, currently up to **$85,000** for a perfect sequence.",
    },
    {
      id: "blade_grid",
      name: "Blade Grid",
      short: "Pick a square and survive the row and column strike.",
      detail:
        "**Blade Grid**\n" +
        "A daily risk ritual on a 5x3 grid. The player chooses one square, then Echo strikes one full row and one full column.\n\n" +
        "If the chosen square survives both strikes, the ritual currently pays **$60,000-$90,000**.",
    },
    {
      id: "echo_seating",
      name: "Echo Seating",
      short: "Solve a seating-order logic puzzle.",
      detail:
        "**Echo Seating / Echo Arrangement**\n" +
        "A daily logic puzzle where 5-10 names must be arranged into the correct seating order using clue text.\n\n" +
        "Players submit the order through a modal, receive limited feedback on mistakes, and can reveal the answer by solving, failing, or giving up. Payout scales with puzzle size and mistakes.",
    },
  ],
};
