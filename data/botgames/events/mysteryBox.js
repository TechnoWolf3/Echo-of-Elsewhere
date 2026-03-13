module.exports = {
  id: "mystery_box",
  name: "Mystery Box",
  weight: 3,

  create() {
    const cost = 1500;
    return {
      cost,
      title: "📦 Mystery Box",
      description:
        `First to click **Play** pays **$${cost.toLocaleString()}**.\n\n` +
        `Could be trash… could be a jackpot.`
    };
  },

  async run(ctx, state) {
    const { interaction } = ctx;
    const cost = state.cost;

    const balance = await ctx.econGetBalance(ctx.guildId, ctx.userId);
    if (balance < cost) {
      return interaction.reply({ content: "Not enough balance to open the box.", ephemeral: true });
    }

    await ctx.econRemove(ctx.guildId, ctx.userId, cost);

    const roll = Math.random();
    let payout = 0;
    let label = "";

    if (roll < 0.55) { payout = 0; label = "🗑️ Empty box. Pain."; }
    else if (roll < 0.85) { payout = Math.floor(cost * 1.2); label = "🪙 Small win."; }
    else if (roll < 0.97) { payout = Math.floor(cost * 2.0); label = "💰 Nice hit!"; }
    else { payout = Math.floor(cost * 8.0); label = "💎 JACKPOT!!"; }

    if (payout > 0) await ctx.econAdd(ctx.guildId, ctx.userId, payout);

    return interaction.update({
      embeds: [{
        title: "📦 Mystery Box Opened",
        description: `${interaction.user} opened the box.\n\n${label}\n**Payout:** $${payout.toLocaleString()}`,
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
