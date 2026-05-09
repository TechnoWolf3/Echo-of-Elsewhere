const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

const CUPS = [
  { id: "left", label: "Left Cup" },
  { id: "middle", label: "Middle Cup" },
  { id: "right", label: "Right Cup" },
];

module.exports = {
  id: "echo_cups",
  name: "Echo Cups",
  weight: 2,

  create() {
    const prize = 12000;
    const consolation = 1500;
    const winningCup = CUPS[Math.floor(Math.random() * CUPS.length)].id;

    return {
      prize,
      consolation,
      winningCup,
      title: "🥤 Echo Cups",
      description:
        `First to click **Play** gets one pick.\n\n` +
        `Find the marked cup to win **$${prize.toLocaleString()}**. Miss and Echo may still toss you **$${consolation.toLocaleString()}** for showing up.`,
    };
  },

  render(state, { isClaimed }) {
    const row = new ActionRowBuilder();

    if (!isClaimed) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId("botgames:echo_cups:play")
          .setLabel("Play")
          .setStyle(ButtonStyle.Success)
      );
    } else {
      row.addComponents(
        ...CUPS.map((cup) =>
          new ButtonBuilder()
            .setCustomId(`botgames:echo_cups:${cup.id}`)
            .setLabel(cup.label)
            .setStyle(ButtonStyle.Secondary)
        )
      );
    }

    return {
      embeds: [{
        title: state.title,
        description: isClaimed
          ? `${state.description}\n\nChoose one cup. No peeking.`
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

    const picked = CUPS.find((cup) => cup.id === action);
    if (!picked) {
      return interaction.reply({ content: "Unknown cup.", ephemeral: true });
    }

    const won = action === state.winningCup;
    const pity = !won && Math.random() < 0.35;
    const payout = won ? state.prize : (pity ? state.consolation : 0);
    if (payout > 0) await ctx.econAdd(ctx.guildId, ctx.userId, payout);

    ctx.end?.();
    return interaction.update({
      embeds: [{
        title: won ? "🥤 Marked Cup!" : "🥤 Empty Cup",
        description:
          won
            ? `${interaction.user} found the marked cup and won **$${payout.toLocaleString()}**.`
            : `${interaction.user} picked **${picked.label}**.\n${pity ? `Echo flicked over **$${payout.toLocaleString()}** anyway.` : "Nothing under there but static."}`,
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
