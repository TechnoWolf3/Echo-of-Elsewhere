module.exports = {
  id: "double_or_nothing",
  name: "Double or Nothing",
  weight: 1,

  create() {
    const bet = Math.floor(Math.random() * 5000) + 1000; // $1,000–$6,000
    return {
      title: "🎲 Double or Nothing!",
      description:
        `First to click **Play** risks **$${bet.toLocaleString()}**.\n\n` +
        `Win → Double it.\n` +
        `Lose → It's gone.`,
      bet,
    };
  },
};
