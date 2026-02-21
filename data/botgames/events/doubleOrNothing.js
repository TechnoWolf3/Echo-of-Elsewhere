module.exports = {
  id: "double_or_nothing",
  name: "Double or Nothing",
  weight: 1,

  create() {
    const bet = Math.floor(Math.random() * 5000) + 1000;

    return {
      title: "🎲 Double or Nothing!",
      description:
        `First to click **Claim & Play** risks **$${bet.toLocaleString()}**.\n\n` +
        `Win → get **$${(bet * 2).toLocaleString()}** back.\n` +
        `Lose → it’s gone.\n\n` +
        `**First in best dressed.**`,
      bet,
    };
  },
};
