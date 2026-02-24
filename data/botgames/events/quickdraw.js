module.exports = {
  id: "quickdraw",
  name: "Quickdraw",
  weight: 3,

  create() {
    const prize = 5000;
    return {
      prize,
      title: "⚡ Quickdraw!",
      description: `First to click **Play** wins **$${prize.toLocaleString()}**.\n\nNo cost. Pure speed.`
    };
  },

  async run(ctx, state) {
    const { interaction } = ctx;
    await ctx.econAdd(ctx.guildId, ctx.userId, state.prize);

    return interaction.update({
      embeds: [{
        title: "⚡ Quickdraw Winner!",
        description: `${interaction.user} was fastest.\n**Won:** $${state.prize.toLocaleString()}`,
      }],
      components: []
    });
  }
};
