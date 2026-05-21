const defaultConfig = require("../../data/games/echoWhisperConfig");

function shuffle(items) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function getSpyCount(playerCount, config = defaultConfig) {
  const row = config.spyScaling.find((r) => playerCount >= r.min && playerCount <= r.max);
  return row?.spies || 1;
}

function pickTwoWords(config = defaultConfig) {
  const pool = Array.isArray(config.wordPool) ? config.wordPool.filter(Boolean) : [];
  if (pool.length < 2) throw new Error("Echo Whisper needs at least two words.");
  const civilianWord = pool[Math.floor(Math.random() * pool.length)];
  let spyWord = civilianWord;
  while (spyWord === civilianWord) {
    spyWord = pool[Math.floor(Math.random() * pool.length)];
  }
  return { civilianWord, spyWord };
}

function createGame({ hostId, channelId, sessionId, config = defaultConfig }) {
  return {
    hostId: String(hostId),
    channelId: String(channelId),
    sessionId,
    phase: "lobby",
    round: 0,
    maxRounds: null,
    civilianWord: null,
    spyWords: [],
    players: new Map(),
    eliminated: [],
    votes: new Map(),
    speakingOrder: [],
    votingEndsAtUnix: null,
    paidOut: false,
    payoutResults: [],
    deliveryFailures: [],
    config,
  };
}

function addPlayer(game, user) {
  const id = String(user.id);
  if (game.players.has(id)) return game.players.get(id);
  const player = {
    id,
    user,
    displayName: user.globalName || user.username || id,
    role: null,
    word: null,
    wager: 0,
    eliminated: false,
    left: false,
  };
  game.players.set(id, player);
  return player;
}

function removeLobbyPlayer(game, userId) {
  if (game.phase !== "lobby") return false;
  return game.players.delete(String(userId));
}

function setWager(game, userId, amount) {
  const player = game.players.get(String(userId));
  if (!player || game.phase !== "lobby") return false;
  if (player.wager > 0) return false;
  player.wager = Math.floor(Number(amount) || 0);
  return true;
}

function markPlayerLeft(game, userId) {
  const player = game.players.get(String(userId));
  if (!player) return false;
  if (game.phase === "lobby") return removeLobbyPlayer(game, userId);
  if (player.eliminated) return false;
  player.left = true;
  player.eliminated = true;
  game.eliminated.push({ userId: player.id, role: player.role, reason: "left", round: game.round });
  return true;
}

function startGame(game) {
  const players = [...game.players.values()];
  if (players.length < game.config.minPlayers) {
    return { ok: false, reason: "min_players" };
  }
  if (players.length > game.config.maxPlayers) {
    return { ok: false, reason: "max_players" };
  }

  const spyCount = getSpyCount(players.length, game.config);
  const { civilianWord, spyWord } = pickTwoWords(game.config);
  const spies = new Set(shuffle(players).slice(0, spyCount).map((p) => p.id));

  for (const player of players) {
    player.role = spies.has(player.id) ? "spy" : "civilian";
    player.word = player.role === "spy" ? spyWord : civilianWord;
  }

  const civilians = players.filter((p) => p.role === "civilian");
  const firstSpeaker = civilians[Math.floor(Math.random() * civilians.length)];
  const rest = shuffle(players.filter((p) => p.id !== firstSpeaker.id));

  game.phase = "clue";
  game.round = 1;
  game.maxRounds = game.config.maxRoundsMode === "starting_players" ? players.length : Number(game.config.maxRounds || players.length);
  game.civilianWord = civilianWord;
  game.spyWords = [spyWord];
  game.speakingOrder = [firstSpeaker.id, ...rest.map((p) => p.id)];
  game.votes.clear();
  return { ok: true, spyCount, civilianWord, spyWord };
}

function activePlayers(game) {
  return [...game.players.values()].filter((p) => !p.eliminated && !p.left);
}

function activeTeamCounts(game) {
  const active = activePlayers(game);
  return {
    spies: active.filter((p) => p.role === "spy").length,
    civilians: active.filter((p) => p.role === "civilian").length,
  };
}

function beginDiscussion(game) {
  game.phase = "discussion";
}

function beginVoting(game, nowMs = Date.now()) {
  game.phase = "voting";
  game.votes.clear();
  game.votingEndsAtUnix = Math.floor((nowMs + game.config.votingDurationSeconds * 1000) / 1000);
}

function recordVote(game, voterId, targetId) {
  const voter = game.players.get(String(voterId));
  const target = game.players.get(String(targetId));
  if (game.phase !== "voting") return { ok: false, reason: "not_voting" };
  if (!voter || voter.eliminated || voter.left) return { ok: false, reason: "inactive_voter" };
  if (!target || target.eliminated || target.left) return { ok: false, reason: "inactive_target" };
  if (String(voterId) === String(targetId)) return { ok: false, reason: "self_vote" };
  game.votes.set(String(voterId), String(targetId));
  return { ok: true };
}

function resolveVote(game) {
  const tally = new Map();
  for (const targetId of game.votes.values()) {
    tally.set(targetId, (tally.get(targetId) || 0) + 1);
  }

  game.phase = "reveal";
  game.votingEndsAtUnix = null;

  if (!tally.size) {
    return { eliminated: null, reason: "no_votes", tally };
  }

  const maxVotes = Math.max(...tally.values());
  const tied = [...tally.entries()].filter(([, count]) => count === maxVotes).map(([id]) => id);
  if (tied.length !== 1) {
    return { eliminated: null, reason: "tie", tied, tally };
  }

  const player = game.players.get(tied[0]);
  if (!player) return { eliminated: null, reason: "missing_player", tally };

  player.eliminated = true;
  game.eliminated.push({ userId: player.id, role: player.role, reason: "vote", round: game.round });
  return { eliminated: player, reason: "eliminated", tally };
}

function checkWin(game) {
  const counts = activeTeamCounts(game);
  if (counts.spies <= 0) return { winner: "civilians", reason: "all_spies_found" };
  if (counts.spies >= counts.civilians) return { winner: "spies", reason: "parity" };
  if (game.round >= game.maxRounds) return { winner: "spies", reason: "final_round" };
  return null;
}

function continueRound(game) {
  game.round += 1;
  game.phase = "clue";
  game.votes.clear();
  game.votingEndsAtUnix = null;
  const active = activePlayers(game);
  const civilians = active.filter((p) => p.role === "civilian");
  const firstSpeaker = civilians[Math.floor(Math.random() * civilians.length)] || active[0];
  const rest = shuffle(active.filter((p) => p.id !== firstSpeaker.id));
  game.speakingOrder = [firstSpeaker, ...rest].map((p) => p.id);
}

function teamForPlayer(player) {
  return player.role === "spy" ? "spies" : "civilians";
}

module.exports = {
  createGame,
  addPlayer,
  removeLobbyPlayer,
  setWager,
  markPlayerLeft,
  startGame,
  activePlayers,
  activeTeamCounts,
  beginDiscussion,
  beginVoting,
  recordVote,
  resolveVote,
  checkWin,
  continueRound,
  teamForPlayer,
};
