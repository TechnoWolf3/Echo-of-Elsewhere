// commands/blackjack.js
const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { activeGames } = require("../utils/gameManager");
const { BlackjackSession, handValue, cardStr } = require("../utils/blackjackSession");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("blackjack")
    .setDescription("Start a joinable blackjack game (1–10 players)."),

  async execute(interaction) {
    const channelId = interaction.channelId;

    try {
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

      // Host auto-joins
      session.addPlayer(interaction.user);

      await interaction.reply({
        content: "🃏 Blackjack lobby created.",
        flags: MessageFlags.Ephemeral,
      });

      // Post the persistent panel
      await session.postOrEditPanel();

      // If panel couldn't post (permissions), bail cleanly
      if (!session.message) {
        activeGames.delete(channelId);
        return interaction.followUp({
          content:
            "❌ I couldn't post the Blackjack panel in this channel.\n" +
            "Check my permissions: **View Channel**, **Send Messages**, **Embed Links** (and if thread: **Send Messages in Threads**).",
          flags: MessageFlags.Ephemeral,
        });
      }

      const collector = session.message.createMessageComponentCollector({
        time: 30 * 60_000,
      });

      collector.on("collect", async (i) => {
        await i.deferUpdate().catch(() => {});

        const [prefix, gameId, action] = i.customId.split(":");
        if (prefix !== "bj" || gameId !== session.gameId) return;

        const isHost = session.isHost(i.user.id);

        // ---- LOBBY ----
        if (action === "join") {
          const res = session.addPlayer(i.user);
          if (!res.ok) {
            return i.followUp({ content: `❌ ${res.msg}`, flags: MessageFlags.Ephemeral }).catch(() => {});
          }
          await session.updatePanel();
          return;
        }

        if (action === "leave") {
          const res = session.removePlayer(i.user.id);
          if (!res.ok) {
            return i.followUp({ content: `❌ ${res.msg}`, flags: MessageFlags.Ephemeral }).catch(() => {});
          }
          await session.updatePanel();
          return;
        }

        if (action === "start") {
          if (!isHost) {
            return i.followUp({ content: "❌ Only the host can start.", flags: MessageFlags.Ephemeral }).catch(() => {});
          }
          await session.start();
          return;
        }

        if (action === "end") {
          if (!isHost) {
            return i.followUp({ content: "❌ Only the host can end.", flags: MessageFlags.Ephemeral }).catch(() => {});
          }
          collector.stop("ended_by_host");
          return;
        }

        // ---- GAMEPLAY ----
        if (session.state !== "playing") return;

        // ✅ New: view hand anytime (no commitment)
        if (action === "hand") {
          const p = session.players.get(i.user.id);
          if (!p) {
            return i.followUp({ content: "❌ You’re not in this game.", flags: MessageFlags.Ephemeral }).catch(() => {});
          }

          const hand = p.hand.map(cardStr).join(" ");
          return i.followUp({
            content: `🃏 Your hand: ${hand}\nTotal: **${handValue(p.hand)}**`,
            flags: MessageFlags.Ephemeral,
          }).catch(() => {});
        }

        if (action === "hit") {
          const res = await session.hit(i.user.id);
          if (!res.ok) {
            return i.followUp({ content: `❌ ${res.msg}`, flags: MessageFlags.Ephemeral }).catch(() => {});
          }

          const hand = res.player.hand.map(cardStr).join(" ");
          return i.followUp({
            content: `🃏 You hit.\nYour hand: ${hand}\nTotal: **${handValue(res.player.hand)}**`,
            flags: MessageFlags.Ephemeral,
          }).catch(() => {});
        }

        if (action === "stand") {
          const res = await session.stand(i.user.id);
          if (!res.ok) {
            return i.followUp({ content: `❌ ${res.msg}`, flags: MessageFlags.Ephemeral }).catch(() => {});
          }

          const hand = res.player.hand.map(cardStr).join(" ");
          return i.followUp({
            content: `✋ You stood.\nYour hand: ${hand}\nTotal: **${handValue(res.player.hand)}**`,
            flags: MessageFlags.Ephemeral,
          }).catch(() => {});
        }
      });

      collector.on("end", async () => {
        activeGames.delete(channelId);
        if (session.timeout) clearTimeout(session.timeout);

        if (session.message) {
          setTimeout(() => session.message.delete().catch(() => {}), 60_000);
        }
      });
    } catch (err) {
      console.error("Blackjack command crashed:", err);
      activeGames.delete(channelId);

      const msg = "❌ Blackjack hit an error — check bot logs for details.";

      if (interaction.deferred || interaction.replied) {
        return interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
      }
      return interaction.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  },
};
