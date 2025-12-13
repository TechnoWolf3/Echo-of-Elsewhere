// commands/blackjack.js
const { SlashCommandBuilder } = require("discord.js");
const { activeGames } = require("../utils/gameManager");
const { BlackjackSession, handValue, cardStr } = require("../utils/blackjackSession");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("blackjack")
    .setDescription("Start a joinable blackjack game (1–10 players)."),

  async execute(interaction) {
    const channelId = interaction.channelId;

    try {
      // One game at a time (per channel)
      if (activeGames.has(channelId)) {
        return interaction.reply({
          content: "❌ A game is already running in this channel.",
          ephemeral: true,
        });
      }

      // Create session + mark active
      const session = new BlackjackSession({
        channel: interaction.channel,
        hostId: interaction.user.id,
      });

      activeGames.set(channelId, session);

      // Host auto-joins
      session.addPlayer(interaction.user);

      // Acknowledge slash command quickly
      await interaction.reply({ content: "🃏 Blackjack lobby created.", ephemeral: true });

      // Post the persistent panel
      await session.postOrEditPanel();

      // If we couldn't post the panel (usually missing perms), clean up + tell host
      if (!session.message) {
        activeGames.delete(channelId);
        return interaction.followUp({
          content:
            "❌ I couldn't post the Blackjack panel in this channel.\n" +
            "Please check my permissions: **View Channel**, **Send Messages**, **Embed Links**, (and if thread: **Send Messages in Threads**).",
          ephemeral: true,
        });
      }

      // Collect button presses on the panel message
      const collector = session.message.createMessageComponentCollector({
        time: 30 * 60_000, // 30 minutes
      });

      collector.on("collect", async (i) => {
        // Always ack fast so Discord doesn't throw interaction timeouts
        await i.deferUpdate().catch(() => {});

        const [prefix, gameId, action] = i.customId.split(":");
        if (prefix !== "bj" || gameId !== session.gameId) return;

        const isHost = session.isHost(i.user.id);

        // --- LOBBY ACTIONS ---
        if (action === "join") {
          const res = session.addPlayer(i.user);
          if (!res.ok) {
            return i.followUp({ content: `❌ ${res.msg}`, ephemeral: true }).catch(() => {});
          }
          await session.updatePanel();
          return;
        }

        if (action === "leave") {
          const res = session.removePlayer(i.user.id);
          if (!res.ok) {
            return i.followUp({ content: `❌ ${res.msg}`, ephemeral: true }).catch(() => {});
          }
          await session.updatePanel();
          return;
        }

        if (action === "start") {
          if (!isHost) {
            return i.followUp({ content: "❌ Only the host can start.", ephemeral: true }).catch(() => {});
          }

          await session.start();

          // Optional: after start, each player can press Hit/Stand to see their hand.
          // If you WANT to push starting hands immediately, we can do it — but note:
          // only the command invoker can receive followUps from `interaction`.
          // So we keep it clean: hands are shown on each player's first action.

          return;
        }

        if (action === "end") {
          if (!isHost) {
            return i.followUp({ content: "❌ Only the host can end.", ephemeral: true }).catch(() => {});
          }
          collector.stop("ended_by_host");
          return;
        }

        // --- GAMEPLAY ACTIONS ---
        if (session.state !== "playing") return;

        if (action === "hit") {
          const res = await session.hit(i.user.id);
          if (!res.ok) {
            return i.followUp({ content: `❌ ${res.msg}`, ephemeral: true }).catch(() => {});
          }

          const hand = res.player.hand.map(cardStr).join(" ");
          return i.followUp({
            content: `🃏 Your hand: ${hand}\nTotal: **${handValue(res.player.hand)}**`,
            ephemeral: true,
          }).catch(() => {});
        }

        if (action === "stand") {
          const res = await session.stand(i.user.id);
          if (!res.ok) {
            return i.followUp({ content: `❌ ${res.msg}`, ephemeral: true }).catch(() => {});
          }

          const hand = res.player.hand.map(cardStr).join(" ");
          return i.followUp({
            content: `✋ You stood.\nYour hand: ${hand}\nTotal: **${handValue(res.player.hand)}**`,
            ephemeral: true,
          }).catch(() => {});
        }
      });

      collector.on("end", async () => {
        // Cleanup active game map + timers
        activeGames.delete(channelId);
        if (session.timeout) clearTimeout(session.timeout);

        // Match your bot style: panel auto-delete after 60s
        if (session.message) {
          setTimeout(() => session.message.delete().catch(() => {}), 60_000);
        }
      });
    } catch (err) {
      console.error("Blackjack command crashed:", err);
      activeGames.delete(channelId);

      const msg = "❌ Blackjack hit an error — check bot logs for details.";

      if (interaction.deferred || interaction.replied) {
        return interaction.followUp({ content: msg, ephemeral: true }).catch(() => {});
      }
      return interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
    }
  },
};
