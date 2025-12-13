const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require("discord.js");

const QUESTIONS = require("../data/voteQuestions_spicy");
const ALLOWED_CHANNEL = "1449217901306581074";

let session = null;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("votendrink")
    .setDescription("Vote & Drink party game")
    .addSubcommand((sub) =>
      sub.setName("start").setDescription("Start a Vote & Drink lobby")
    ),

  async execute(interaction) {
    if (interaction.channelId !== ALLOWED_CHANNEL) {
      return interaction.reply({
        content: "❌ This game can only be played in the designated channel.",
        ephemeral: true,
      });
    }

    if (session) {
      return interaction.reply({
        content: "⚠️ A Vote & Drink game is already running.",
        ephemeral: true,
      });
    }

    session = createSession(interaction);

    await interaction.reply({
      content: "🍻 **Vote & Drink started!** (Panel posted below)",
      ephemeral: true,
    });

    // Create ONE persistent panel message
    const panel = await interaction.channel.send(buildLobbyPanelPayload());
    session.panelMessageId = panel.id;

    // Attach one collector to the panel message that lives the whole session
    attachPanelCollector(panel);
  },
};

function createSession(interaction) {
  return {
    hostId: interaction.user.id,
    channelId: interaction.channelId,

    // Players who clicked Join
    players: new Map(), // userId -> User

    // Deck behavior (avoid repeats until exhausted)
    usedQuestions: [],

    // Panel message (single-message UI)
    panelMessageId: null,
    panelCollector: null,

    // Round state
    state: "lobby", // "lobby" | "voting" | "results"
    roundActive: false,
    roundVotesByVoterId: {}, // { voterId: votedUserId }
    roundQuestion: null,

    // Session-only stats
    sessionVoteTotals: {}, // { userId: totalVotesReceived }
    roundsPlayed: 0,
  };
}

/** -------- Panel Builders -------- */

function buildLobbyPanelPayload() {
  const playerList = session.players.size
    ? [...session.players.values()].map((u) => `• ${u}`).join("\n")
    : "_No players yet. Click **Join** to play._";

  const embed = new EmbedBuilder()
    .setTitle("🗳️ Vote & Drink — Lobby")
    .setColor(0x8e44ad)
    .setDescription(
      `Click **Join** if you're playing.\n` +
        `Host clicks **Begin Round** when ready (need 2+).\n\n` +
        `**Players (${session.players.size}):**\n${playerList}`
    )
    .setFooter({ text: "Session-only stats • Party responsibly" });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("vnd_join")
      .setLabel("Join")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("vnd_leave")
      .setLabel("Leave")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("vnd_begin")
      .setLabel("Begin Round")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(session.roundActive || session.players.size < 2),
    new ButtonBuilder()
      .setCustomId("vnd_end")
      .setLabel("End Game")
      .setStyle(ButtonStyle.Danger)
  );

  return { embeds: [embed], components: [row] };
}

function buildVotingPanelPayload() {
  const embed = new EmbedBuilder()
    .setTitle("🗳️ Vote & Drink")
    .setColor(0x8e44ad)
    .setDescription(`**${session.roundQuestion}**\n\nVote below 👇`)
    .setFooter({ text: "Ends in 30 seconds (or sooner if everyone votes)" });

  const playersArr = [...session.players.values()];
  const voteRows = buildVoteComponents(playersArr);

  return { embeds: [embed], components: voteRows };
}

function buildResultsPanelPayload({ tally, baseEmbed }) {
  const postRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("vnd_next")
      .setLabel("Next Round")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("vnd_end")
      .setLabel("End Game")
      .setStyle(ButtonStyle.Danger)
  );

  let desc = `**${session.roundQuestion}**\n\n`;

  if (!Object.keys(tally).length) {
    desc += "❌ No votes were cast.";
  } else {
    const maxVotes = Math.max(...Object.values(tally));
    const losers = Object.keys(tally).filter((id) => tally[id] === maxVotes);

    const sips = Math.random() < 0.15 ? 4 : Math.floor(Math.random() * 3) + 1;

    const resultsLines = Object.entries(tally)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id, count]) => `• <@${id}> — **${count}** vote(s)`)
      .join("\n");

    const mentions = losers.map((id) => `<@${id}>`).join(", ");

    desc += `📊 **Results:**\n${resultsLines}\n\n🍺 ${mentions} drink **${sips} sip(s)**!` +
      (losers.length > 1 ? " (Tie rule)" : "");
  }

  const embed = EmbedBuilder.from(baseEmbed).setDescription(desc);
  return { embeds: [embed], components: [postRow] };
}

/** -------- Collector + Flow -------- */

function attachPanelCollector(panelMsg) {
  const collector = panelMsg.createMessageComponentCollector({
    time: 3 * 60 * 60 * 1000, // 3 hours session max
  });

  session.panelCollector = collector;

  collector.on("collect", async (i) => {
    // Always ack fast to prevent interaction failed
    await i.deferUpdate().catch(() => {});

    if (!session) return;
    if (i.channelId !== session.channelId) return;
    if (i.message.id !== session.panelMessageId) return;

    const id = i.customId;

    // Join/Leave are always allowed in lobby/results (not during voting to keep it stable)
    if (id === "vnd_join") {
      if (session.state === "voting") return;
      session.players.set(i.user.id, i.user);
      await safeEditPanel(panelMsg, buildLobbyPanelPayload());
      return;
    }

    if (id === "vnd_leave") {
      if (session.state === "voting") return;
      session.players.delete(i.user.id);
      await safeEditPanel(panelMsg, buildLobbyPanelPayload());
      return;
    }

    if (id === "vnd_begin") {
      if (i.user.id !== session.hostId) return;
      if (session.roundActive) return;
      if (session.players.size < 2) return;

      await beginRound(panelMsg);
      return;
    }

    if (id === "vnd_next") {
      if (i.user.id !== session.hostId) return;
      if (session.roundActive) return;
      if (session.players.size < 2) return;

      await beginRound(panelMsg);
      return;
    }

    if (id === "vnd_end") {
      if (i.user.id !== session.hostId) return;

      collector.stop("ended");
      await endGame(panelMsg.channel, panelMsg);
      return;
    }

    // Voting buttons: vnd_vote_<userid>
    if (id.startsWith("vnd_vote_")) {
      if (session.state !== "voting") return;
      if (!session.players.has(i.user.id)) return; // must be joined

      const votedId = id.replace("vnd_vote_", "");
      session.roundVotesByVoterId[i.user.id] = votedId;

      // End early if all joined players voted
      if (Object.keys(session.roundVotesByVoterId).length >= session.players.size) {
        await finishRound(panelMsg);
      }

      return;
    }
  });

  collector.on("end", async () => {
    if (session) {
      await endGame(panelMsg.channel, panelMsg);
    }
  });
}

async function beginRound(panelMsg) {
  session.roundActive = true;
  session.state = "voting";
  session.roundVotesByVoterId = {};
  session.roundQuestion = pickNextQuestion();

  await safeEditPanel(panelMsg, buildVotingPanelPayload());

  // 30s timer for the round (since we’re not using a per-round collector now)
  setTimeout(async () => {
    // If game ended or already moved on, ignore
    if (!session) return;
    if (panelMsg.id !== session.panelMessageId) return;
    if (session.state !== "voting") return;

    await finishRound(panelMsg);
  }, 30_000);
}

async function finishRound(panelMsg) {
  if (!session) return;
  if (session.state !== "voting") return;

  session.state = "results";

  // Build tally
  const tally = {};
  Object.values(session.roundVotesByVoterId).forEach((votedId) => {
    tally[votedId] = (tally[votedId] || 0) + 1;
  });

  // Add to session totals
  for (const [id, count] of Object.entries(tally)) {
    session.sessionVoteTotals[id] = (session.sessionVoteTotals[id] || 0) + count;
  }
  session.roundsPlayed += 1;

  // Build results payload using the previous voting embed as base
  const currentEmbed = panelMsg.embeds?.[0]
    ? EmbedBuilder.from(panelMsg.embeds[0])
    : new EmbedBuilder().setColor(0x8e44ad);

  const payload = buildResultsPanelPayload({ tally, baseEmbed: currentEmbed });

  await safeEditPanel(panelMsg, payload);

  session.roundActive = false;
}

function pickNextQuestion() {
  const available = QUESTIONS.filter((q) => !session.usedQuestions.includes(q));
  const pool = available.length ? available : QUESTIONS;

  if (!available.length) session.usedQuestions = [];

  const chosen = pool[Math.floor(Math.random() * pool.length)];
  session.usedQuestions.push(chosen);
  return chosen;
}

function buildVoteComponents(playersArr) {
  const rows = [];
  let row = new ActionRowBuilder();

  playersArr.forEach((user, idx) => {
    if (idx > 0 && idx % 5 === 0) {
      rows.push(row);
      row = new ActionRowBuilder();
    }

    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`vnd_vote_${user.id}`)
        .setLabel(user.username)
        .setStyle(ButtonStyle.Primary)
    );
  });

  rows.push(row);
  return rows;
}

async function safeEditPanel(panelMsg, payload) {
  try {
    await panelMsg.edit(payload);
  } catch {
    // If message is gone or edit fails, end session safely
    session = null;
  }
}

/** -------- End Game + Leaderboard + Cleanup -------- */

async function endGame(channel, panelMsg) {
  // Stop collector if still alive
  try {
    session?.panelCollector?.stop("endGame");
  } catch {}

  // Build + send leaderboard (session-only)
  try {
    const totals = Object.entries(session?.sessionVoteTotals || {}).sort(
      (a, b) => b[1] - a[1]
    );

    if (totals.length) {
      const top = totals.slice(0, 10);
      const lines = top
        .map(([id, votes], idx) => {
          const medal =
            idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : "•";
          return `${medal} <@${id}> — **${votes}** vote(s)`;
        })
        .join("\n");

      const embed = new EmbedBuilder()
        .setTitle("🏆 Vote & Drink — Session Leaderboard")
        .setColor(0x8e44ad)
        .setDescription(`**Rounds played:** ${session.roundsPlayed}\n\n${lines}`)
        .setFooter({ text: "Session-only leaderboard (resets next game)" });

      await channel.send({ embeds: [embed] });
    } else {
      const embed = new EmbedBuilder()
        .setTitle("🏁 Vote & Drink — Session Ended")
        .setColor(0x8e44ad)
        .setDescription("No votes were recorded this session, so there’s no leaderboard.")
        .setFooter({ text: "Session-only leaderboard (resets next game)" });

      await channel.send({ embeds: [embed] });
    }
  } catch {}

  // Disable panel buttons immediately (optional)
  try {
    await panelMsg.edit({
      embeds: panelMsg.embeds,
      components: [],
    });
  } catch {}

  await channel.send("🛑 **Vote & Drink has ended.**");

  // Delete the panel after 60 seconds
  setTimeout(async () => {
    try {
      await panelMsg.delete();
    } catch {}
  }, 60_000);

  session = null;
}
