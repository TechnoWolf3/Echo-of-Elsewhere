// data/features/categories/effects.js
module.exports = {
  id: "effects",
  order: 99,
  name: "Effects",
  emoji: "✨",
  blurb: "Echo's Bleesings and Curses.",
  description:
    "Echo is always watching, performance is key.\n" +
    "Echo spares no one but is also rather generous, will you be blessed with wealth or cursed with imprisonment?\n" +
    "Some grant fortune. Others demand sacrifice.\n" +
    "Rarely, Echo may mark someone as **Chosen**, but such favor comes sparingly.\n" +
    "**Blessings & Curses cannot be overwritten! If you are blessed, you cannot be cursed!** *Durations can be reset if you strike the same outcome 2x.*\n" +
    "Blessings and curses affect *almost* all income streams from jobs to gambling, dailys to bot games.",

  // Blessings & Curses
  items: [
    {
      id: "echos_favour",
      name: "✨ Echo's Favour",
      short: "Blessing of 15% income bonus.",
      detail:
        "Through good performance or complete luck, echo offers you a favour.\n" +
        "Wether a time duration or a payout count noted by Echo, you receive 15% **MORE** money from activites.\n" +
        "Simply Win and your prize grows by 15%.\n" +
        "-# Blessings do **NOT** affect money transfered between players or granted by admins",
    },
    {
      id: "echos_tribute",
      name: "✨ Echo's Tribute",
      short: "Blessing of $2000 income bonus.",
      detail:
        "A tribute to those entertaining Echo's wildest desires.\n" +
        "Echo decides to pay tribute to your sacrifice, offering a bonus $2000 to every job you complete/ game you win!\n" +
        "Simply Win and your prize grows by $2000.\n" +
        "-# Blessings do **NOT** affect money transfered between players or granted by admins",
    },
    {
      id: "echos_burden",
      name: "🖤 Echo's Burden",
      short: "Curse of -15% income.",
      detail:
        "You dare fail in the eyes of Echo? Or do you have the worst luck? You are struck with a loss of 15% across all income streams.\n" +
        "Granted as a time duration **OR** a total payout count, the loss will remain a burden until it's decided that you have learnt your lesson.\n" +
        "Echo is always watching, these burdens her Echo more than it hurts you.\n" +
        "-# Curses do **NOT** affect money transfered between players or granted by admins",
    },
    {
      id: "echos_tax",
      name: "🖤 Echo's Tax",
      short: "Curse of -$1000 income.",
      detail:
        "As EOFY rolls around, well actuall whenever Echo chooses, it's time to pay your taxes.\n" +
        "We lack a *Fair Work Ombudsman or any real Taxation office so we take what we want and you cant complain! That'll be $1000 please.\n" +
        "The curse will take $1000 from every earning until the time is up or you complete enough activities.\n" +
        "-# Curses do **NOT** affect money transfered between players or granted by admins",
    },
  ],
};
