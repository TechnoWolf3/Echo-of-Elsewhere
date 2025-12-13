const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { activeGames } = require("../utils/gameManager");
const { BlackjackSession, handValue, cardStr } = require("../utils/blackjackSession");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("blackjack")
    .setDescription("Start a joinable blackjack game (1–10 players)."),

  async execute(interaction) {
    const channelId = interaction.channelId;

    // Clear stale ended game
    const stale = activeGames.get(channelId);
    if (stale && stale.state === "ended") activeGames.delete(channelId);

    if (activeGames.has(channelId)) {
      return interaction.reply({
        content: "❌ A game is already running in this channel.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const session = new BlackjackSession({
      channel: interaction.channel,
      hostId: interaction.user.id,
    });

    activeGames.set(channelId, session);
    session.addPlayer(interaction.user);

    await interaction.reply({
      content: "🃏 Blackjack lobby created.",
      flags: MessageFlags.Ephemeral,
    });

    await session.postOrEditPanel();

    const collector = session.message.createMessageComponentCollector({
      time: 30 * 60_000,
    });

    collector.on("collect", async (i) => {
      await i.deferUpdate().catch(() => {});
      const [, gameId, action] = i.customId.split(":");
      if (gameId !== session.gameId) return;

      if (action === "join") {
        const r = session.addPlayer(i.user);
        if (!r.ok) return i.followUp({ content: r.msg, flags: MessageFlags.Ephemeral });
        await session.updatePanel();
      }

      if (action === "leave") {
        const r = session.removePlayer(i.user.id);
        if (!r.ok) return i.followUp({ content: r.msg, flags: MessageFlags.Ephemeral });
        await session.updatePanel();
      }

      if (action === "start") {
        if (!session.isHost(i.user.id)) return;
        await session.start();
        if (session.state === "ended") collector.stop();
      }

      if (action === "hit") {
        const r = await session.hit(i.user.id);
        if (r.ok)
          await i.followUp({
            content: `🃏 ${r.player.hand.map(cardStr).join(" ")} (**${handValue(r.player.hand)}**)`,
            flags: MessageFlags.Ephemeral,
          });
        if (session.state === "ended") collector.stop();
      }

      if (action === "stand") {
        const r = await session.stand(i.user.id);
        if (r.ok)
          await i.followUp({
            content: `✋ ${r.player.hand.map(cardStr).join(" ")} (**${handValue(r.player.hand)}**)`,
            flags: MessageFlags.Ephemeral,
          });
        if (session.state === "ended") collector.stop();
      }

      if (action === "hand") {
        const p = session.players.get(i.user.id);
        if (p)
          await i.followUp({
            content: `🃏 ${p.hand.map(cardStr).join(" ")} (**${handValue(p.hand)}**)`,
            flags: MessageFlags.Ephemeral,
          });
      }

      if (action === "end" && session.isHost(i.user.id)) {
        collector.stop();
      }
    });

    collector.on("end", () => {
      activeGames.delete(channelId);

      setTimeout(() => {
        session.message?.delete().catch(() => {});
        session.resultsMessage?.delete().catch(() => {});
      }, 15_000);
    });
  },
};
