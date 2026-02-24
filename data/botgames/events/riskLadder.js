const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

module.exports = {
  id: "risk_ladder",
  name: "Risk Ladder",
  weight: 2,

  create() {
    // Free entry by default (house-funded)
    // You can make it a stake by adding `stake` and charging it on claim.
    const basePrize = 2500;

    // Each step increases pot + increases bust chance
    const ladder = [
      { mult: 1.2, bust: 0.05 },
      { mult: 1.5, bust: 0.10 },
      { mult: 1.9, bust: 0.18 },
      { mult: 2.5, bust: 0.30 },
      { mult: 3.5, bust: 0.45 },
      { mult: 5.0, bust: 0.60 },
    ];

    return {
      basePrize,
      ladder,
      step: 0,
      pot: basePrize,
      title: "🪜 Risk Ladder",
      description:
        `First to click **Play** claims the ladder.\n\n` +
        `You can **Continue** for bigger rewards… but you might bust.\n` +
        `Or **Cash Out** anytime.`
    };
  },

  // Multi-step interface
  render(state, { isClaimed }) {
    const step = state.step;
    const current = state.ladder[step] || state.ladder[state.ladder.length - 1];
    const pot = state.pot;

    const lines = [];
    lines.push(`**Current pot:** $${Math.floor(pot).toLocaleString()}`);
    if (isClaimed) {
      lines.push(`**Step:** ${step + 1}/${state.ladder.length}`);
      lines.push(`**Bust chance if Continue:** ${(current.bust * 100).toFixed(0)}%`);
      lines.push(`**Next pot if safe:** $${Math.floor(state.basePrize * current.mult).toLocaleString()}`);
    } else {
      lines.push(`Claim it first, then choose **Continue** or **Cash Out**.`);
    }

    const embed = {
      title: state.title,
      description: `${state.description}\n\n${lines.join("\n")}`
    };

    const row = new ActionRowBuilder();

    if (!isClaimed) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId("botgames:risk_ladder:play")
          .setLabel("Play")
          .setStyle(ButtonStyle.Success)
      );
    } else {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId("botgames:risk_ladder:continue")
          .setLabel("Continue")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("botgames:risk_ladder:cashout")
          .setLabel("Cash Out")
          .setStyle(ButtonStyle.Success)
      );
    }

    return { embeds: [embed], components: [row] };
  },

  async onAction(ctx, state, action) {
    const { interaction } = ctx;

    if (action === "play") {
      // Claimer handled by engine; just return updated render
      return interaction.update(ctx.render());
    }

    if (action === "cashout") {
      const payout = Math.floor(state.pot);
      await ctx.econAdd(ctx.guildId, ctx.userId, payout);

      return interaction.update({
        embeds: [{
          title: "🏁 Cashed Out!",
          description: `${interaction.user} cashed out **$${payout.toLocaleString()}**.`,
        }],
        components: []
      });
    }

    if (action === "continue") {
      const step = state.step;
      const current = state.ladder[step] || state.ladder[state.ladder.length - 1];

      // Bust?
      if (Math.random() < current.bust) {
        return interaction.update({
          embeds: [{
            title: "💥 BUST!",
            description: `${interaction.user} pushed their luck and **lost it all**.`,
          }],
          components: []
        });
      }

      // Safe: advance step and pot
      const nextPot = Math.floor(state.basePrize * current.mult);
      state.pot = nextPot;
      state.step = Math.min(state.step + 1, state.ladder.length - 1);

      return interaction.update(ctx.render());
    }

    // Unknown action
    return interaction.reply({ content: "Unknown action.", ephemeral: true });
  }
};
