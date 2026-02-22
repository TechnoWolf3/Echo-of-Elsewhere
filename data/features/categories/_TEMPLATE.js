// data/features/categories/_TEMPLATE.js
module.exports = {
  id: "example",
  order: 99,
  name: "Example Category",
  emoji: "🧩",
  blurb: "Short one-liner shown in the hub.",
  description:
    "Longer description shown when someone opens this category.",

  // Items shown inside the category (like help.commands)
  items: [
    {
      id: "thing1",
      name: "Cool Feature",
      short: "A quick description.",
      detail:
        "**Cool Feature**\n" +
        "Explain what it does, how to use it, and any gotchas.",
    },
  ],
};
