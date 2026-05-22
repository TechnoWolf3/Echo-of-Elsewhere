const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

const {
  gameId,
  getOrReuseMessage,
  safeReply,
  canControl,
  guardGameButton,
  startActive,
  patchActive,
  endActive,
  mention,
  resultRow,
  returnToFunHub,
} = require("./funHelpers");
const config = require("./echoWhisperConfig");
const economy = require("../../utils/economy");
const engine = require("../../utils/games/echoWhisperEngine");
const bondService = require("../../utils/community/bonds");
const { BOND_CONFIG } = require("../../data/community/bondsConfig");

const sessions = new Map();

function fmtMoney(amount) {
  return `$${Number(amount || 0).toLocaleString()}`;
}

function playerName(player) {
  return player?.user?.globalName || player?.user?.username || player?.displayName || player?.id || "Player";
}

function buildIds(sessionId) {
  return {
    join: `${sessionId}:join`,
    leave: `${sessionId}:leave`,
    wager: `${sessionId}:wager`,
    start: `${sessionId}:start`,
    showWord: `${sessionId}:word`,
    discussion: `${sessionId}:discussion`,
    voteStart: `${sessionId}:vote_start`,
    voteSelect: `${sessionId}:vote`,
    next: `${sessionId}:next`,
    close: `${sessionId}:close`,
    return: `${sessionId}:return`,
    modal: `${sessionId}:wager_modal`,
    amountInput: "amount",
  };
}

function baseEmbed(title, description) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: "Echo Whisper | Just for Fun" });
}

function lobbyPayload(game, ids) {
  const players = [...game.players.values()];
  const playerLines = players.length
    ? players.map((p) => `- ${mention(p.id)}${p.wager > 0 ? ` - wager ${fmtMoney(p.wager)}` : ""}`).join("\n")
    : "_No players yet. Click Join to play._";

  const embed = baseEmbed(
    "Echo Whisper - Lobby",
    [
      "Civilians share one secret word. Spies receive a different word. Give vague clues, debate, and vote out suspicious players.",
      "",
      `Players: **${players.length}/${config.maxPlayers}** (minimum ${config.minPlayers})`,
      playerLines,
      "",
      "Optional wagers are supported. No casino table fees apply.",
    ].join("\n")
  );

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(ids.join).setLabel("Join").setStyle(ButtonStyle.Success).setDisabled(players.length >= config.maxPlayers),
        new ButtonBuilder().setCustomId(ids.leave).setLabel("Leave").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(ids.wager).setLabel("Set Wager").setStyle(ButtonStyle.Primary).setDisabled(!config.optionalBettingEnabled),
        new ButtonBuilder().setCustomId(ids.start).setLabel("Start").setStyle(ButtonStyle.Success).setDisabled(players.length < config.minPlayers),
        new ButtonBuilder().setCustomId(ids.close).setLabel("Close").setStyle(ButtonStyle.Danger)
      ),
    ],
  };
}

function activeMentions(game) {
  return engine.activePlayers(game).map((p) => mention(p.id)).join(", ") || "_None_";
}

function speakingOrderText(game) {
  return game.speakingOrder
    .filter((id) => {
      const p = game.players.get(id);
      return p && !p.eliminated && !p.left;
    })
    .map((id, idx) => `${idx + 1}. ${mention(id)}`)
    .join("\n");
}

function cluePayload(game, ids, note = null) {
  const embed = baseEmbed(
    `Echo Whisper - Round ${game.round} Clues`,
    [
      note,
      `Active players: ${activeMentions(game)}`,
      "",
      "**Speaking order:**",
      speakingOrderText(game),
      "",
      "Give one vague clue in order. Do not say or spell your word.",
    ].filter(Boolean).join("\n")
  );

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(ids.showWord).setLabel("Show My Word").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(ids.discussion).setLabel("Start Discussion").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(ids.leave).setLabel("Leave Game").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(ids.close).setLabel("Close").setStyle(ButtonStyle.Danger)
      ),
    ],
  };
}

function discussionPayload(game, ids, note = null) {
  const embed = baseEmbed(
    `Echo Whisper - Round ${game.round} Discussion`,
    [
      note,
      `Active players: ${activeMentions(game)}`,
      "",
      `Discuss who seems suspicious. Host can start voting early; otherwise voting opens after about ${config.discussionDurationSeconds} seconds.`,
    ].filter(Boolean).join("\n")
  );

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(ids.showWord).setLabel("Show My Word").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(ids.voteStart).setLabel("Start Vote").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(ids.leave).setLabel("Leave Game").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(ids.close).setLabel("Close").setStyle(ButtonStyle.Danger)
      ),
    ],
  };
}

function votingPayload(game, ids, note = null) {
  const active = engine.activePlayers(game);
  const options = active.map((p) => ({
    label: playerName(p).slice(0, 100),
    value: p.id,
    description: p.role ? "Vote to eliminate this player" : "Vote",
  }));

  const embed = baseEmbed(
    `Echo Whisper - Round ${game.round} Voting`,
    [
      note,
      `Voting phase ends <t:${game.votingEndsAtUnix}:R>`,
      "",
      "Vote for who you think is a spy. Active players can change their vote until voting closes.",
      `Votes submitted: **${game.votes.size}/${active.length}**`,
    ].filter(Boolean).join("\n")
  );

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(ids.voteSelect)
          .setPlaceholder("Vote to eliminate...")
          .setDisabled(options.length < 2)
          .addOptions(options.slice(0, 25))
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(ids.showWord).setLabel("Show My Word").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(ids.leave).setLabel("Leave Game").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(ids.close).setLabel("Close").setStyle(ButtonStyle.Danger)
      ),
    ],
  };
}

function revealPayload(game, ids, voteResult, win = null, payoutSummary = []) {
  const tallyLines = [...(voteResult?.tally || new Map()).entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, count]) => `- ${mention(id)}: **${count}** vote(s)`);

  let reveal = "No one was eliminated.";
  if (voteResult?.reason === "tie") reveal = "Vote tied. No elimination this round.";
  if (voteResult?.reason === "no_votes") reveal = "No votes were submitted. No elimination this round.";
  if (voteResult?.eliminated) {
    reveal = `${mention(voteResult.eliminated.id)} was eliminated and revealed as **${voteResult.eliminated.role === "spy" ? "Spy" : "Civilian"}**.`;
  }

  const embed = baseEmbed(
    win ? "Echo Whisper - Results" : `Echo Whisper - Round ${game.round} Reveal`,
    [
      reveal,
      tallyLines.length ? `\n**Votes:**\n${tallyLines.join("\n")}` : "",
      "",
      win ? buildFinalSummary(game, win, payoutSummary) : "No team has won yet. Continue to the next clue round.",
    ].filter(Boolean).join("\n")
  );

  const components = win
    ? [resultRow({ returnId: ids.return, closeId: ids.close })]
    : [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(ids.next).setLabel("Next Round").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(ids.showWord).setLabel("Show My Word").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(ids.close).setLabel("Close").setStyle(ButtonStyle.Danger)
        ),
      ];

  return { embeds: [embed], components };
}

function buildFinalSummary(game, win, payoutSummary) {
  const spies = [...game.players.values()].filter((p) => p.role === "spy").map((p) => mention(p.id)).join(", ") || "_None_";
  const eliminated = game.eliminated.length
    ? game.eliminated.map((e) => `- ${mention(e.userId)}: ${e.role === "spy" ? "Spy" : "Civilian"} (${e.reason}, round ${e.round})`).join("\n")
    : "_No eliminations._";
  const payouts = payoutSummary.length ? payoutSummary.join("\n") : "_No wager payouts._";

  return [
    `Winning team: **${win.winner === "spies" ? "Spies" : "Civilians"}** (${win.reason.replace(/_/g, " ")})`,
    `Spies: ${spies}`,
    `Civilian word: **${game.civilianWord}**`,
    `Spy word${game.spyWords.length === 1 ? "" : "s"}: **${game.spyWords.join(", ")}**`,
    "",
    `**Eliminated players:**\n${eliminated}`,
    "",
    `**Payouts:**\n${payouts}`,
  ].join("\n");
}

async function showWagerModal(btn, ids) {
  const modal = new ModalBuilder()
    .setCustomId(ids.modal)
    .setTitle("Echo Whisper Wager");
  const amount = new TextInputBuilder()
    .setCustomId(ids.amountInput)
    .setLabel("Wager amount")
    .setPlaceholder("50000")
    .setRequired(true)
    .setStyle(TextInputStyle.Short);
  modal.addComponents(new ActionRowBuilder().addComponents(amount));
  await btn.showModal(modal);
}

async function setPlayerWager(modal, game) {
  const player = game.players.get(modal.user.id);
  if (!player) {
    return safeReply(modal, { content: "Join the lobby before setting a wager.", flags: MessageFlags.Ephemeral });
  }
  if (game.phase !== "lobby") {
    return safeReply(modal, { content: "Wagers can only be set before the game starts.", flags: MessageFlags.Ephemeral });
  }
  if (player.wager > 0) {
    return safeReply(modal, { content: "You already placed a wager for this game.", flags: MessageFlags.Ephemeral });
  }

  const raw = modal.fields.getTextInputValue("amount");
  const amount = Math.floor(Number(String(raw).replace(/[$,\s]/g, "")));
  if (!Number.isFinite(amount) || amount <= 0) {
    return safeReply(modal, { content: "Enter a positive whole-number wager.", flags: MessageFlags.Ephemeral });
  }

  const debit = await economy.tryDebitUser(game.channelGuildId, modal.user.id, amount, "echo_whisper_wager", {
    userId: modal.user.id,
    source: "echo_whisper",
    sessionId: game.sessionId,
  });
  if (!debit.ok) {
    return safeReply(modal, { content: `You do not have ${fmtMoney(amount)} in your wallet.`, flags: MessageFlags.Ephemeral });
  }

  try {
    await economy.addServerBank(game.channelGuildId, amount, "echo_whisper_wager_bank", {
      userId: modal.user.id,
      source: "echo_whisper",
      sessionId: game.sessionId,
    });
  } catch (err) {
    await economy.creditUser(game.channelGuildId, modal.user.id, amount, "echo_whisper_wager_refund", {
      source: "echo_whisper",
      sessionId: game.sessionId,
      reason: "server_bank_deposit_failed",
    }).catch(() => {});
    throw err;
  }

  engine.setWager(game, modal.user.id, amount);
  return safeReply(modal, { content: `Wager placed: **${fmtMoney(amount)}**.`, flags: MessageFlags.Ephemeral });
}

async function deliverWords(game) {
  game.deliveryFailures = [];
  for (const player of game.players.values()) {
    const content = `Echo Whisper\nYour word: **${player.word}**`;
    const sent = await player.user.send({ content }).then(() => true).catch(() => false);
    if (!sent) game.deliveryFailures.push(player.id);
  }
}

async function showWord(interaction, game) {
  const player = game.players.get(interaction.user.id);
  if (!player || !player.word) {
    return safeReply(interaction, { content: "You do not have a word in this game.", flags: MessageFlags.Ephemeral });
  }
  return safeReply(interaction, { content: `Your word: **${player.word}**`, flags: MessageFlags.Ephemeral });
}

async function settlePayouts(game, winner) {
  if (game.paidOut) return game.payoutResults;
  game.paidOut = true;
  const lines = [];

  for (const player of game.players.values()) {
    if (!player.wager) continue;
    if (engine.teamForPlayer(player) !== winner.winner) continue;
    const amount = player.wager * config.payoutMultiplier;
    try {
      const paid = await economy.bankToUserIfEnough(game.channelGuildId, player.id, amount, "echo_whisper_payout", {
        userId: player.id,
        source: "echo_whisper",
        sessionId: game.sessionId,
        wager: player.wager,
        multiplier: config.payoutMultiplier,
      });
      if (paid.ok) lines.push(`- ${mention(player.id)} won ${fmtMoney(amount)}${paid.recoveredAmount ? ` (${fmtMoney(paid.recoveredAmount)} recovered)` : ""}`);
      else lines.push(`- ${mention(player.id)} payout failed: server bank only has ${fmtMoney(paid.bankBalance)}`);
    } catch (err) {
      lines.push(`- ${mention(player.id)} payout failed: ${err?.message || "unknown error"}`);
    }
  }

  game.payoutResults = lines;
  return lines;
}

async function finishWithWin(game, message, ids, voteResult, win, collector, timers) {
  clearTimeout(timers.discussion);
  clearTimeout(timers.vote);
  patchActive(game.channelId, { state: "ended" });
  await bondService.awardBondXp({
    guildId: game.channelGuildId,
    userIds: game.players.map((player) => player.id),
    amount: BOND_CONFIG.xp.sharedGroupGame,
    source: "echo_whisper",
    activityType: "game",
    reason: "shared_group_game",
  }).catch(() => {});
  const payouts = await settlePayouts(game, win);
  await message.edit(revealPayload(game, ids, voteResult, win, payouts)).catch(() => {});
  collector.stop("done");
}

async function startVoting(game, message, ids, timers, note = null) {
  clearTimeout(timers.discussion);
  const counts = engine.activeTeamCounts(game);
  let immediateWin = null;
  if (counts.spies <= 0) immediateWin = { winner: "civilians", reason: "all_spies_found" };
  else if (counts.spies >= counts.civilians) immediateWin = { winner: "spies", reason: "parity" };
  if (immediateWin) {
    await finishWithWin(game, message, ids, { eliminated: null, reason: "win_check", tally: new Map() }, immediateWin, timers.collector, timers);
    return;
  }
  engine.beginVoting(game);
  patchActive(game.channelId, { state: `round_${game.round}_voting` });
  await message.edit(votingPayload(game, ids, note)).catch(() => {});
  clearTimeout(timers.vote);
  timers.vote = setTimeout(async () => {
    if (game.phase !== "voting") return;
    const voteResult = engine.resolveVote(game);
    const win = engine.checkWin(game);
    if (win) {
      await finishWithWin(game, message, ids, voteResult, win, timers.collector, timers);
      return;
    }
    await message.edit(revealPayload(game, ids, voteResult)).catch(() => {});
  }, config.votingDurationSeconds * 1000);
}

async function beginDiscussion(game, message, ids, timers) {
  engine.beginDiscussion(game);
  patchActive(game.channelId, { state: `round_${game.round}_discussion` });
  await message.edit(discussionPayload(game, ids)).catch(() => {});
  clearTimeout(timers.discussion);
  timers.discussion = setTimeout(() => {
    startVoting(game, message, ids, timers, "Discussion time ended. Voting is open.").catch(() => {});
  }, config.discussionDurationSeconds * 1000);
}

async function handleLeave(btn, game, message, ids, timers, collector) {
  if (game.phase === "lobby") {
    engine.removeLobbyPlayer(game, btn.user.id);
    await btn.deferUpdate().catch(() => {});
    return message.edit(lobbyPayload(game, ids)).catch(() => {});
  }

  engine.markPlayerLeft(game, btn.user.id);
  const win = engine.checkWin(game);
  await btn.deferUpdate().catch(() => {});
  if (win) {
    await finishWithWin(game, message, ids, { eliminated: null, reason: "left", tally: new Map() }, win, collector, timers);
    return;
  }

  const note = `${mention(btn.user.id)} left and was removed from active play.`;
  if (game.phase === "clue") await message.edit(cluePayload(game, ids, note)).catch(() => {});
  else if (game.phase === "discussion") await message.edit(discussionPayload(game, ids, note)).catch(() => {});
  else if (game.phase === "voting") await message.edit(votingPayload(game, ids, note)).catch(() => {});
}

async function startFromHub(interaction, opts = {}) {
  const sessionId = gameId("ew");
  const ids = buildIds(sessionId);
  const game = engine.createGame({ hostId: interaction.user.id, channelId: interaction.channelId, sessionId, config });
  game.channelGuildId = interaction.guildId;
  sessions.set(interaction.channelId, game);
  engine.addPlayer(game, interaction.user);

  startActive(interaction.channelId, "echo_whisper", "lobby", { startedBy: interaction.user.id, sessionId });

  const message = await getOrReuseMessage(interaction, opts.reuseMessage, lobbyPayload(game, ids));
  const timers = { discussion: null, vote: null, collector: null };
  let ended = false;
  let resultCollector = null;

  const collector = message.createMessageComponentCollector({ time: 3 * 60 * 60_000 });
  timers.collector = collector;

  async function cleanup(reason) {
    if (ended) return;
    ended = true;
    clearTimeout(timers.discussion);
    clearTimeout(timers.vote);
    sessions.delete(game.channelId);
    endActive(game.channelId);
    if (reason !== "done") {
      await message.edit({
        embeds: [baseEmbed("Echo Whisper - Closed", reason === "timeout" ? "Game timed out." : "Game closed.")],
        components: [resultRow({ returnId: ids.return, closeId: ids.close })],
      }).catch(() => {});
    }
    if (!resultCollector) {
      resultCollector = message.createMessageComponentCollector({ time: 10 * 60_000 });
      resultCollector.on("collect", async (btn) => {
        if (btn.customId === ids.return) {
          await btn.deferUpdate().catch(() => {});
          resultCollector.stop("return");
          return returnToFunHub(btn, message);
        }
        if (btn.customId === ids.close) {
          await btn.deferUpdate().catch(() => {});
          resultCollector.stop("close");
          return message.edit({ components: [] }).catch(() => {});
        }
      });
    }
  }

  collector.on("collect", async (btn) => {
    if (btn.message.id !== message.id) return;
    if (!btn.customId.startsWith(`${sessionId}:`)) return;
    if (await guardGameButton(btn)) return;

    try {
      if (btn.customId === ids.join) {
        if (game.phase !== "lobby") return safeReply(btn, { content: "This game has already started.", flags: MessageFlags.Ephemeral });
        if (game.players.size >= config.maxPlayers) return safeReply(btn, { content: `Echo Whisper is capped at ${config.maxPlayers} players.`, flags: MessageFlags.Ephemeral });
        engine.addPlayer(game, btn.user);
        await btn.deferUpdate().catch(() => {});
        return message.edit(lobbyPayload(game, ids)).catch(() => {});
      }

      if (btn.customId === ids.leave) {
        return handleLeave(btn, game, message, ids, timers, collector);
      }

      if (btn.customId === ids.wager) {
        if (game.phase !== "lobby") return safeReply(btn, { content: "Wagers are closed after the game starts.", flags: MessageFlags.Ephemeral });
        if (!game.players.has(btn.user.id)) return safeReply(btn, { content: "Join the lobby before setting a wager.", flags: MessageFlags.Ephemeral });
        await showWagerModal(btn, ids);
        const modal = await btn.awaitModalSubmit({ filter: (m) => m.customId === ids.modal && m.user.id === btn.user.id, time: 60_000 }).catch(() => null);
        if (!modal) return;
        await setPlayerWager(modal, game);
        return message.edit(lobbyPayload(game, ids)).catch(() => {});
      }

      if (btn.customId === ids.start) {
        if (btn.user.id !== game.hostId) return safeReply(btn, { content: "Only the host can start Echo Whisper.", flags: MessageFlags.Ephemeral });
        const started = engine.startGame(game);
        if (!started.ok) return safeReply(btn, { content: `Need ${config.minPlayers}-${config.maxPlayers} players to start.`, flags: MessageFlags.Ephemeral });
        await btn.deferUpdate().catch(() => {});
        await deliverWords(game);
        const note = game.deliveryFailures.length
          ? `Words were assigned. ${game.deliveryFailures.length} DM(s) failed; use Show My Word for a private reminder.`
          : "Words were assigned privately. Use Show My Word if you need a reminder.";
        patchActive(game.channelId, { state: `round_${game.round}_clue` });
        return message.edit(cluePayload(game, ids, note)).catch(() => {});
      }

      if (btn.customId === ids.showWord) {
        return showWord(btn, game);
      }

      if (btn.customId === ids.discussion) {
        if (!canControl(btn.member, game.hostId)) return safeReply(btn, { content: "Only the host or channel managers can move to discussion.", flags: MessageFlags.Ephemeral });
        if (game.phase !== "clue") return safeReply(btn, { content: "Discussion is not available right now.", flags: MessageFlags.Ephemeral });
        await btn.deferUpdate().catch(() => {});
        return beginDiscussion(game, message, ids, timers);
      }

      if (btn.customId === ids.voteStart) {
        if (!canControl(btn.member, game.hostId)) return safeReply(btn, { content: "Only the host or channel managers can start voting.", flags: MessageFlags.Ephemeral });
        if (game.phase !== "discussion") return safeReply(btn, { content: "Voting is not available right now.", flags: MessageFlags.Ephemeral });
        await btn.deferUpdate().catch(() => {});
        return startVoting(game, message, ids, timers);
      }

      if (btn.customId === ids.voteSelect) {
        const targetId = btn.values?.[0];
        const vote = engine.recordVote(game, btn.user.id, targetId);
        if (!vote.ok) {
          const reason = vote.reason === "self_vote" ? "You cannot vote for yourself." : "You cannot vote right now.";
          return safeReply(btn, { content: reason, flags: MessageFlags.Ephemeral });
        }
        await safeReply(btn, { content: `Vote set for ${mention(targetId)}.`, flags: MessageFlags.Ephemeral });
        return message.edit(votingPayload(game, ids)).catch(() => {});
      }

      if (btn.customId === ids.next) {
        if (!canControl(btn.member, game.hostId)) return safeReply(btn, { content: "Only the host or channel managers can continue.", flags: MessageFlags.Ephemeral });
        if (game.phase !== "reveal") return safeReply(btn, { content: "The next round is not ready yet.", flags: MessageFlags.Ephemeral });
        engine.continueRound(game);
        patchActive(game.channelId, { state: `round_${game.round}_clue` });
        await btn.deferUpdate().catch(() => {});
        return message.edit(cluePayload(game, ids)).catch(() => {});
      }

      if (btn.customId === ids.close) {
        if (!canControl(btn.member, game.hostId)) return safeReply(btn, { content: "Only the host or channel managers can close this game.", flags: MessageFlags.Ephemeral });
        await btn.deferUpdate().catch(() => {});
        collector.stop("closed");
      }
    } catch (err) {
      console.error("[Echo Whisper] interaction failed:", err);
      return safeReply(btn, { content: "Echo Whisper hit an error handling that action.", flags: MessageFlags.Ephemeral });
    }
  });

  collector.on("end", async (_, reason) => cleanup(reason === "done" ? "done" : reason || "timeout"));
  return message;
}

module.exports = {
  id: "echowhisper",
  name: "Echo Whisper",
  startFromHub,
  _sessions: sessions,
};
