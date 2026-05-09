const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

const MODES = {
  ground: {
    label: "Ground",
    chance: 0.75,
    payout: 6500,
    style: ButtonStyle.Success,
    win: "kept the signal steady",
    lose: "grounded the wrong wire",
  },
  tune: {
    label: "Tune",
    chance: 0.50,
    payout: 12500,
    style: ButtonStyle.Primary,
    win: "caught the hidden frequency",
    lose: "lost the frequency",
  },
  overload: {
    label: "Overload",
    chance: 0.25,
    payout: 24000,
    style: ButtonStyle.Danger,
    win: "overloaded the static cleanly",
    lose: "got snapped by the static",
  },
};

module.exports = {
  id: "static_sweep",
  name: "Static Sweep",
  weight: 2,

  create() {
    return {
      title: "📡 Static Sweep",
      description:
        `First to click **Play** chooses how hard to push the signal.\n\n` +
        `Safer choices pay less. Riskier choices can spike higher.`,
    };
  },

  render(state, { isClaimed }) {
    const row = new ActionRowBuilder();

    if (!isClaimed) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId("botgames:static_sweep:play")
          .setLabel("Play")
          .setStyle(ButtonStyle.Success)
      );
    } else {
      for (const [id, mode] of Object.entries(MODES)) {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`botgames:static_sweep:${id}`)
            .setLabel(`${mode.label} $${mode.payout.toLocaleString()}`)
            .setStyle(mode.style)
        );
      }
    }

    return {
      embeds: [{
        title: state.title,
        description: isClaimed
          ? `${state.description}\n\n**Ground:** 75% for $6,500\n**Tune:** 50% for $12,500\n**Overload:** 25% for $24,000`
          : state.description,
      }],
      components: [row],
    };
  },

  async onAction(ctx, state, action) {
    const { interaction } = ctx;

    if (action === "play") {
      return interaction.update(ctx.render());
    }

    const mode = MODES[action];
    if (!mode) {
      return interaction.reply({ content: "Unknown sweep mode.", ephemeral: true });
    }

    const won = Math.random() < mode.chance;
    if (won) await ctx.econAdd(ctx.guildId, ctx.userId, mode.payout);

    ctx.end?.();
    return interaction.update({
      embeds: [{
        title: won ? "📡 Signal Locked" : "📡 Signal Lost",
        description: won
          ? `${interaction.user} ${mode.win} and won **$${mode.payout.toLocaleString()}**.`
          : `${interaction.user} ${mode.lose}. No payout this time.`,
      }],
      components: [],
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
