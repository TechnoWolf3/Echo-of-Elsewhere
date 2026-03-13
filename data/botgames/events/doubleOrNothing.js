module.exports = {
  id: "double_or_nothing",
  name: "Double or Nothing",
  weight: 2,

  create() {
    const bet = Math.floor(Math.random() * 5000) + 1000; // 1k–6k
    return {
      bet,
      title: "🎲 Double or Nothing!",
      description:
        `First to click **Play** risks **$${bet.toLocaleString()}**.\n\n` +
        `Win → Double it.\nLose → It’s gone.`
    };
  },

  // Legacy one-shot handler (kept compatible)
  async run(ctx, state) {
    const { interaction, economy, guildId, userId } = ctx;
    const bet = state.bet;

    const balance = await ctx.econGetBalance(guildId, userId);
    if (balance < bet) {
      return interaction.reply({ content: "Not enough balance.", ephemeral: true });
    }

    await ctx.econRemove(guildId, userId, bet);

    const win = Math.random() < 0.5;
    if (win) await ctx.econAdd(guildId, userId, bet * 2);

    return interaction.update({
      embeds: [{
        title: win ? "💰 You Won!" : "💀 You Lost!",
        description: win
          ? `${interaction.user} doubled **$${bet.toLocaleString()}**!`
          : `${interaction.user} lost **$${bet.toLocaleString()}**.`,
      }],
      components: []
    });
  },

  activityEffects: {
    effectsApply: true,
    canAwardEffects: true,
    blockedBlessings: [],
    blockedCurses: [],
    effectAwardPool: {
      nothingWeight: 100,
      blessingWeight: 0,
      curseWeight: 0,
      blessingWeights: {},
      curseWeights: {},
    },
  },
};
