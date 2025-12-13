const { SlashCommandBuilder } = require("discord.js");
const { activeGames } = require("../utils/gameManager");
const { BlackjackSession, handValue, cardStr } = require("../utils/blackjackSession");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("blackjack")
    .setDescription("Start a joinable blackjack game (1–6 players)."),

  async execute(interaction) {
    const channelId = interaction.channelId;

    if (activeGames.has(channelId)) {
      return interaction.reply({ content: "❌ A game is already running in this channel.", ephemeral: true });
    }

    const session = new BlackjackSession({ channel: interaction.channel, hostId: interaction.user.id });
    activeGames.set(channelId, session);

    session.addPlayer(interaction.user);

    await interaction.reply({ content: "🃏 Blackjack lobby created.", ephemeral: true });
    await session.postOrEditPanel();

    const collector = session.message.createMessageComponentCollector({ time: 30 * 60_000 });

    collector.on("collect", async (i) => {
      await i.deferUpdate().catch(() => {});

      const [prefix, gameId, action] = i.customId.split(":");
      if (prefix !== "bj" || gameId !== session.gameId) return;

      const isHost = session.isHost(i.user.id);

      if (action === "join") {
        const res = session.addPlayer(i.user);
        if (!res.ok) return i.followUp({ content: `❌ ${res.msg}`, ephemeral: true });
        await session.updatePanel();
        return;
      }

      if (action === "leave") {
        const res = session.removePlayer(i.user.id);
        if (!res.ok) return i.followUp({ content: `❌ ${res.msg}`, ephemeral: true });
        await session.updatePanel();
        return;
      }

      if (action === "start") {
        if (!isHost) return i.followUp({ content: "❌ Only the host can start.", ephemeral: true });
        await session.start();

        // When game starts, quietly DM/ephemeral each player their starting hand
        for (const p of session.players.values()) {
          const hand = p.hand.map(cardStr).join(" ");
          await interaction.followUp({
            content: `🃏 Your starting hand: ${hand}\nTotal: **${handValue(p.hand)}**`,
            ephemeral: true,
          }).catch(() => {});
        }
        return;
      }

      if (action === "end") {
        if (!isHost) return i.followUp({ content: "❌ Only the host can end.", ephemeral: true });
        collector.stop("ended");
        return;
      }

      if (session.state !== "playing") return;

      if (action === "hit") {
        const res = await session.hit(i.user.id);
        if (!res.ok) return i.followUp({ content: `❌ ${res.msg}`, ephemeral: true });

        const hand = res.player.hand.map(cardStr).join(" ");
        return i.followUp({
          content: `🃏 Your hand: ${hand}\nTotal: **${handValue(res.player.hand)}**`,
          ephemeral: true,
        });
      }

      if (action === "stand") {
        const res = await session.stand(i.user.id);
        if (!res.ok) return i.followUp({ content: `❌ ${res.msg}`, ephemeral: true });

        const hand = res.player.hand.map(cardStr).join(" ");
        return i.followUp({
          content: `✋ You stood.\nYour hand: ${hand}\nTotal: **${handValue(res.player.hand)}**`,
          ephemeral: true,
        });
      }
    });

    collector.on("end", async () => {
      activeGames.delete(channelId);
      if (session.timeout) clearTimeout(session.timeout);
      if (session.message) setTimeout(() => session.message.delete().catch(() => {}), 60_000);
    });
  },
};
