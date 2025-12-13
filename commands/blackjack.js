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
      // One game at a time (per channel)
      if (activeGames.has(channelId)) {
        return interaction.reply({
          content: "❌ A game is already running in this channel.",
          flags: MessageFlags.Ephemeral,
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
      await interaction.reply({
        content: "🃏 Blackjack lobby created.",
        flags: MessageFlags.Ephemeral,
      });

      // Post the persistent panel
      await session.postOrEditPanel();

      // If we couldn't post the panel (usually missing perms), stop cleanly
      if (!session.message) {
        activeGames.delete(channelId);
        return interaction.followUp({
          content:
            "❌ I couldn't post the Blackjack panel in this channel.\n" +
            "Check my permissions: **View Channel**, **Send Messages**, **Embed Links** (and if thread: **Send Messages in Threads**).",
          flags: MessageFlags.Ephemeral,
        });
      }

      // Collect button presses on the panel message
      const collector = session.message.createMessageComponentCollector({
        time: 30 * 60_000, // 30 minutes
      });

      collector.on("collect", async (i) => {
        await i.deferUpdate().catch(() => {});

        const [prefix, gameId, action] = i.customId.split(":");
        if (prefix !== "bj" || gameId !== session.gameId) return;

        const isHost = session.isHost(i.user.id);

        // --- LOBBY ACTIONS ---
        if (action === "join") {
          const res = session.addPlayer(i.user);
          if (!res.ok) {
            return i.followUp({
              content: `❌ ${res.msg}`,
              flags: MessageFlags.Ephemeral,
            }).catch(() => {});
          }
          await session.updatePanel();
          return;
        }

        if (action === "leave") {
          const res = session.removePlayer(i.user.id);
          if (!res.ok) {
            return i.followUp({
              content: `❌ ${res.msg}`,
              flags: MessageFlags.Ephemeral,
            }).catch(() => {});
          }
          await session.updatePanel();
          return;
        }

        if (action === "start") {
          if (!isHost) {
            return i.followUp({
              content: "❌ Only the host can start.",
              flags: MessageFlags.Ephemeral,
            }).catch(() => {});
          }

          await session.start();

          // ✅ If start() immediately ended the game (rare, but possible), cleanup
          if (session.state === "ended") collector.stop("game_finished");
          return;
        }

        if (action === "end") {
          if (!isHost) {
            return i.followUp({
              content: "❌ Only the host can end.",
              flags: MessageFlags.Ephemeral,
            }).catch(() => {});
          }

          collector.stop("ended_by_host");
          return;
        }

        // --- GAMEPLAY ACTIONS ---
        if (session.state !== "playing") return;

        if (action === "hand") {
          const p = session.players.get(i.user.id);
          if (!p) {
            return i.followUp({
              content: "❌ You’re not in this game.",
              flags: MessageFlags.Ephemeral,
            }).catch(() => {});
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
            return i.followUp({
              content: `❌ ${res.msg}`,
              flags: MessageFlags.Ephemeral,
            }).catch(() => {});
          }

          const hand = res.player.hand.map(cardStr).join(" ");
          await i.followUp({
            content: `🃏 You hit.\nYour hand: ${hand}\nTotal: **${handValue(res.player.hand)}**`,
            flags: MessageFlags.Ephemeral,
          }).catch(() => {});

          // ✅ If that hit ended the game, stop collector so cleanup runs
          if (session.state === "ended") collector.stop("game_finished");
          return;
        }

        if (action === "stand") {
          const res = await session.stand(i.user.id);
          if (!res.ok) {
            return i.followUp({
              content: `❌ ${res.msg}`,
              flags: MessageFlags.Ephemeral,
            }).catch(() => {});
          }

          const hand = res.player.hand.map(cardStr).join(" ");
          await i.followUp({
            content: `✋ You stood.\nYour hand: ${hand}\nTotal: **${handValue(res.player.hand)}**`,
            flags: MessageFlags.Ephemeral,
          }).catch(() => {});

          // ✅ If standing ended the game, stop collector so cleanup runs
          if (session.state === "ended") collector.stop("game_finished");
          return;
        }
      });

      collector.on("end", async () => {
        // Cleanup
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
        return interaction
          .followUp({ content: msg, flags: MessageFlags.Ephemeral })
          .catch(() => {});
      }

      return interaction
        .reply({ content: msg, flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }
  },
};
