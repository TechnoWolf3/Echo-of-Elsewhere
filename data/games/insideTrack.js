// data/games/insideTrack.js
// Inside Track live horse racing table for /games -> Casino.

const crypto = require("crypto");
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

const { activeGames } = require("../../utils/gameManager");
const { setActiveGame, clearActiveGame } = require("../../utils/gamesHubState");
const { guardGamesComponent } = require("../../utils/echoRift/curseGuard");
const { guardNotJailedComponent } = require("../../utils/jail");
const economy = require("../../utils/economy");
const { bankPayoutWithEffects, handleTriggeredEffectEvent } = require("../../utils/effectSystem");
const { recordProgress: recordContractProgress } = require("../../utils/contracts");
const {
  getUserCasinoSecurity,
  maybeAnnounceCasinoSecurity,
  getEffectiveFeePct,
  computeFeeForBet,
  formatSecurityEmbedLines,
} = require("../../utils/casinoSecurity");
const config = require("./casino/insideTrackConfig");
const engine = require("../../utils/games/insideTrackEngine");
const ui = require("../../utils/ui");

const ACTIVITY_EFFECTS = {
  effectsApply: true,
  canAwardEffects: true,
  blockedBlessings: [],
  blockedCurses: [],
  effectAwardPool: { nothingWeight: 100, blessingWeight: 0, curseWeight: 0, blessingWeights: {}, curseWeights: {} },
};

const sessionsById = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeTableId() {
  return crypto.randomBytes(6).toString("hex");
}

function parseAmount(raw) {
  const cleaned = String(raw || "").replace(/[$,\s]/g, "");
  const n = Number.parseInt(cleaned, 10);
  if (!Number.isFinite(n)) return null;
  return n;
}

function fmtMoney(n) {
  return `$${Math.floor(Number(n) || 0).toLocaleString()}`;
}

function formatTime(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function raceTitle(session) {
  const race = session.race;
  const major = race?.isMajor ? " - Major Race" : "";
  return `🏇 Inside Track / ${race?.raceName || "Echo Downs"}${major}`;
}

function buildHorseList(race) {
  return race.horses
    .map((h) => {
      const place = engine.payoutMultiplierForBet("place", h.odds);
      const show = engine.payoutMultiplierForBet("show", h.odds);
      return `**#${h.number} ${h.name}** - Win **${h.odds.toFixed(1)}x** | Place **${place.toFixed(2)}x** | Show **${show.toFixed(2)}x**\n${h.form}.`;
    })
    .join("\n\n");
}

function buildBettingEmbed(session, now = Date.now()) {
  const race = session.race;
  const embed = new EmbedBuilder()
    .setTitle(raceTitle(session))
    .setDescription(
      [
        race.isMajor ? `**${race.raceName.toUpperCase()}** has taken over the card.` : "**Echo Downs** is open for betting.",
        "",
        `Race **${race.raceNumber}** - **${race.type}**`,
        `Track: **${race.condition.name}**`,
        `Betting closes in: **${formatTime(session.bettingEndsAt - now)}**`,
        `Bets this race: **${session.bets.size}**`,
      ].join("\n")
    )
    .addFields(
      { name: "Horses", value: buildHorseList(race), inline: false },
      {
        name: "Betting",
        value: [
          `Min **${fmtMoney(config.minBet)}** - Max **${fmtMoney(config.maxBet)}**`,
          "**Win** pays full listed odds.",
          "**Place** pays if your horse finishes 1st or 2nd.",
          "**Show** pays if your horse finishes 1st, 2nd, or 3rd.",
        ].join("\n"),
        inline: false,
      },
      { name: "Security", value: formatSecurityEmbedLines({ hostBaseState: session.hostSecurity }).join("\n"), inline: false }
    )
    .setFooter({ text: `No-bet races: ${session.noBetRaces}/${config.shutdownAfterNoBetRaces}` });

  ui.applySystemStyle(embed, "casino", false);
  return embed;
}

function buildRaceEmbed(session) {
  const race = session.race;
  const leader = [...race.horses].sort((a, b) => b.progress - a.progress)[0];
  const phase = engine.tickRace(race, Date.now()).phase;
  const embed = new EmbedBuilder()
    .setTitle(raceTitle(session))
    .setDescription(
      [
        `Race **${race.raceNumber}** - **${phase}**`,
        `Track: **${race.condition.name}**`,
        leader ? `Leader: **#${leader.number} ${leader.name}**` : null,
        "",
        engine.renderTrack(race),
        "**Commentary**",
        (race.commentary || []).map((line) => `- ${line}`).join("\n"),
      ].filter(Boolean).join("\n")
    )
    .setFooter({ text: "Betting is closed. Watch the rail." });
  ui.applySystemStyle(embed, "casino", false);
  return embed;
}

function buildResultEmbed(session, result, nextRaceAt = null) {
  const race = session.race;
  const order = result.order
    .slice(0, race.horses.length)
    .map((h, idx) => `${engine.ordinal(idx + 1)} - **#${h.number} ${h.name}**`)
    .join("\n");

  const payoutLines = result.payouts.length
    ? result.payouts.slice(0, 12).map((p) => `- <@${p.userId}> ${p.label} - **+${fmtMoney(p.profit)}** profit`).join("\n")
    : "_No winning tickets this race._";

  const lossLines = result.lossNotices.length ? `\n\n${result.lossNotices.join("\n")}` : "";
  const next = nextRaceAt ? `\n\nNext race opens in **${formatTime(nextRaceAt - Date.now())}**.` : "";

  const embed = new EmbedBuilder()
    .setTitle(`🏁 Inside Track Results - Race ${race.raceNumber}`)
    .setDescription(
      [
        race.isMajor ? `**${race.raceName}** is official.` : "The result is official.",
        "",
        `Winner: **#${result.order[0].number} ${result.order[0].name}**`,
        "",
        "**Finishing Order**",
        order,
        "",
        "**Payouts**",
        payoutLines + lossLines + next,
      ].join("\n")
    )
    .setFooter({ text: `No-bet races: ${session.noBetRaces}/${config.shutdownAfterNoBetRaces}` });
  ui.applySystemStyle(embed, "casino", false);
  return embed;
}

function buildClosedEmbed(reason) {
  const text = reason === "no_bets"
    ? "The track has closed due to lack of betting activity. Three straight races went off with no tickets at the window."
    : "The Inside Track table has closed.";
  const embed = new EmbedBuilder().setTitle("🏇 Inside Track - Track Closed").setDescription(text);
  ui.applySystemStyle(embed, "casino", false);
  return embed;
}

function buildComponents(session, { betting = false, disabled = false } = {}) {
  const tableId = session.tableId;
  const canBet = betting && !disabled && !session.closed;
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`inside_track:bet:${tableId}:win`)
      .setLabel("Win")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!canBet),
    new ButtonBuilder()
      .setCustomId(`inside_track:bet:${tableId}:place`)
      .setLabel("Place")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!canBet),
    new ButtonBuilder()
      .setCustomId(`inside_track:bet:${tableId}:show`)
      .setLabel("Show")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!canBet)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`inside_track:close:${tableId}`)
      .setLabel("Close Track")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled)
  );

  return [row1, row2];
}

function buildBetModal(tableId, betType) {
  const title = `Inside Track - ${betType.toUpperCase()} Bet`;
  const modal = new ModalBuilder().setCustomId(`inside_track:modal:${tableId}:${betType}`).setTitle(title);
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("horse")
        .setLabel("Horse number")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("e.g. 3")
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("amount")
        .setLabel("Wager amount")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder(`Min ${config.minBet}, max ${config.maxBet}`)
        .setRequired(true)
    )
  );
  return modal;
}

async function safeEdit(session, payload = null) {
  if (!session?.message) return;
  try {
    await session.message.edit(payload || {
      embeds: [buildBettingEmbed(session)],
      components: buildComponents(session, { betting: session.phase === "betting" }),
    });
  } catch (e) {
    console.error("[INSIDE TRACK] message edit failed:", e?.message || e);
  }
}

async function recordCasinoContractProgress(guildId, userId, { played = 0, wins = 0, profit = 0 } = {}) {
  if (played > 0) await recordContractProgress({ guildId, userId, metric: "casino_games_played", amount: played }).catch(() => {});
  if (wins > 0) await recordContractProgress({ guildId, userId, metric: "casino_wins", amount: wins }).catch(() => {});
  if (profit > 0) await recordContractProgress({ guildId, userId, metric: "casino_profit", amount: Math.floor(profit) }).catch(() => {});
}

async function closeSession(session, reason = "closed") {
  if (!session || session.closed) return;
  session.closed = true;
  session.phase = "closing";
  clearTimeout(session._betTickTimer);

  await safeEdit(session, {
    embeds: [buildClosedEmbed(reason)],
    components: buildComponents(session, { disabled: true }),
  });

  activeGames.delete(session.channelId);
  clearActiveGame(session.channelId);
  sessionsById.delete(session.tableId);
  if (session.collector && !session.collector.ended) session.collector.stop("closed");

  if (session.reuseHubMessage) {
    setTimeout(async () => {
      const gamesCmd = require("../../commands/games");
      await gamesCmd.showCasinoCategory({ channelId: session.channelId, channel: session.channel }, session.message).catch(() => {});
    }, 15_000);
  }
}

async function runBettingPhase(session) {
  session.phase = "betting";
  session.bets.clear();
  session.bettingEndsAt = Date.now() + session.race.bettingMs;
  await safeEdit(session);

  const tick = async () => {
    if (session.closed || session.phase !== "betting") return;
    if (Date.now() >= session.bettingEndsAt) return;
    await safeEdit(session);
    session._betTickTimer = setTimeout(tick, 15_000);
  };
  session._betTickTimer = setTimeout(tick, 15_000);
  await sleep(session.race.bettingMs);
  clearTimeout(session._betTickTimer);
}

async function runRacePhase(session) {
  session.phase = "racing";
  session.race.startedAt = Date.now();
  while (!session.closed && !session.race.finished) {
    await safeEdit(session, {
      embeds: [buildRaceEmbed(session)],
      components: buildComponents(session, { betting: false }),
    });
    if (session.race.finished) break;
    await sleep(config.timing.raceUpdateMs);
  }
}

function betWins(bet, order) {
  const idx = order.findIndex((h) => h.number === bet.horseNumber);
  if (idx < 0) return false;
  if (bet.type === "win") return idx === 0;
  if (bet.type === "place") return idx <= 1;
  if (bet.type === "show") return idx <= 2;
  return false;
}

async function processResults(session) {
  if (session.processedRaceNumbers.has(session.race.raceNumber)) {
    return { order: session.race.order, payouts: [], lossNotices: [] };
  }
  session.processedRaceNumbers.add(session.race.raceNumber);

  const order = session.race.order.length ? session.race.order : [...session.race.horses].sort((a, b) => b.progress - a.progress);
  const payouts = [];
  const lossNotices = [];

  if (session.bets.size === 0) session.noBetRaces += 1;
  else session.noBetRaces = 0;

  for (const [userId, bet] of session.bets.entries()) {
    await recordCasinoContractProgress(session.guildId, userId, { played: 1 });
    const horse = session.race.horses.find((h) => h.number === bet.horseNumber);
    if (!horse) continue;

    if (betWins(bet, order)) {
      const mult = engine.payoutMultiplierForBet(bet.type, horse.odds);
      const payout = Math.floor(bet.amount * mult);
      const profit = Math.max(0, payout - bet.amount - (bet.feeAmount || 0));
      const paid = await bankPayoutWithEffects({
        guildId: session.guildId,
        userId,
        amount: payout,
        type: "inside_track_win",
        meta: {
          game: "inside_track",
          race: session.race.raceNumber,
          betType: bet.type,
          horse: horse.name,
          horseNumber: horse.number,
          odds: horse.odds,
          payoutMultiplier: mult,
        },
        activityEffects: ACTIVITY_EFFECTS,
        awardSource: "inside_track",
      });

      if (paid?.ok) {
        await recordCasinoContractProgress(session.guildId, userId, { wins: 1, profit });
        payouts.push({ userId, profit, label: `${bet.type.toUpperCase()} on #${horse.number} ${horse.name} (${mult.toFixed(2)}x)` });
      } else {
        lossNotices.push(`- <@${userId}> had a winning ticket, but the server bank could not cover **${fmtMoney(payout)}**.`);
      }
    } else {
      const trigger = await handleTriggeredEffectEvent({
        guildId: session.guildId,
        userId,
        eventKey: "casino_loss",
        context: { source: "inside_track", refundAmount: Number(bet.amount || 0) },
      }).catch(() => null);
      if (trigger?.triggered && trigger.notice) lossNotices.push(`- <@${userId}> ${trigger.notice}`);
    }
  }

  return { order, payouts, lossNotices };
}

async function gameLoop(session) {
  while (!session.closed) {
    session.race = engine.generateRace(session.raceNumber);
    session.raceNumber += 1;

    await runBettingPhase(session);
    if (session.closed) break;

    await runRacePhase(session);
    if (session.closed) break;

    const result = await processResults(session).catch((e) => {
      console.error("[INSIDE TRACK] processResults error:", e);
      return { order: session.race.order || [], payouts: [], lossNotices: [] };
    });

    if (session.noBetRaces >= config.shutdownAfterNoBetRaces) {
      await safeEdit(session, { embeds: [buildResultEmbed(session, result)], components: buildComponents(session, { disabled: true }) });
      await sleep(8_000);
      await closeSession(session, "no_bets");
      break;
    }

    const nextRaceAt = Date.now() + config.timing.cooldownMs;
    await safeEdit(session, {
      embeds: [buildResultEmbed(session, result, nextRaceAt)],
      components: buildComponents(session, { betting: false }),
    });
    await sleep(config.timing.cooldownMs);
  }
}

async function startFromHub(interaction, ctx = {}) {
  if (!interaction.inGuild?.()) {
    return interaction.reply({ content: "Server only.", flags: MessageFlags.Ephemeral }).catch(() => {});
  }
  if (await guardGamesComponent(interaction)) return;
  if (await guardNotJailedComponent(interaction)) return;

  const channelId = interaction.channelId;
  if (activeGames.has(channelId)) {
    await interaction.followUp({ content: "There is already an active game in this channel.", flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  const tableId = makeTableId();
  const hostSecurity = await getUserCasinoSecurity(interaction.guildId, interaction.user.id).catch(() => ({ level: 0, feePct: 0 }));
  await maybeAnnounceCasinoSecurity({
    db: interaction.client?.db,
    channel: interaction.channel,
    guildId: interaction.guildId,
    userId: interaction.user.id,
    displayName: interaction.member?.displayName || interaction.user.username,
    current: hostSecurity,
  }).catch(() => {});

  const session = {
    tableId,
    guildId: interaction.guildId,
    channelId,
    channel: interaction.channel,
    hostId: interaction.user.id,
    hostSecurity,
    message: null,
    reuseHubMessage: Boolean(ctx.reuseMessage),
    raceNumber: 1,
    race: engine.generateRace(1),
    phase: "betting",
    bettingEndsAt: Date.now(),
    bets: new Map(),
    noBetRaces: 0,
    processedRaceNumbers: new Set(),
    closed: false,
    _betTickTimer: null,
  };

  sessionsById.set(tableId, session);
  activeGames.set(channelId, { type: "inside_track", state: "running" });
  setActiveGame(channelId, { type: "inside_track", state: "running" });

  const msg = ctx.reuseMessage || await interaction.channel.send({
    embeds: [buildBettingEmbed(session)],
    components: buildComponents(session, { betting: true }),
  }).catch((e) => {
    console.error("[INSIDE TRACK] failed to send table:", e);
    return null;
  });

  if (!msg) {
    sessionsById.delete(tableId);
    activeGames.delete(channelId);
    clearActiveGame(channelId);
    return;
  }

  session.message = msg;
  if (ctx.reuseMessage) await safeEdit(session);

  const collector = msg.createMessageComponentCollector();
  session.collector = collector;
  collector.on("collect", async (i) => {
    if (session.closed) return;
    if (await guardGamesComponent(i)) return;
    if (await guardNotJailedComponent(i)) return;

    const cid = String(i.customId || "");
    if (!cid.includes(`:${tableId}`)) {
      return i.reply({ content: "That Inside Track table is not active anymore.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    if (cid.startsWith("inside_track:close:")) {
      const isHost = i.user.id === session.hostId;
      const isAdmin = i.memberPermissions?.has?.(PermissionFlagsBits.Administrator);
      if (!isHost && !isAdmin) {
        return i.reply({ content: "Only the table host or an admin can close the track.", flags: MessageFlags.Ephemeral }).catch(() => {});
      }
      await i.deferUpdate().catch(() => {});
      collector.stop("closed");
      await closeSession(session, "closed");
      return;
    }

    if (session.phase !== "betting" || Date.now() >= session.bettingEndsAt) {
      return i.reply({ content: "Betting is closed for this race.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    if (session.bets.has(i.user.id)) {
      return i.reply({ content: "You already have a ticket locked in for this race.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    if (cid.startsWith("inside_track:bet:")) {
      const betType = cid.split(":").pop();
      return i.showModal(buildBetModal(tableId, betType)).catch(() => {});
    }
  });

  collector.on("end", async (_c, reason) => {
    if (session.closed) return;
    if (reason === "idle") await closeSession(session, "closed");
  });

  await interaction.followUp({ content: "Inside Track table opened in this channel.", flags: MessageFlags.Ephemeral }).catch(() => {});
  gameLoop(session).catch((e) => console.error("[INSIDE TRACK] loop error:", e));
}

async function handleInteraction(interaction) {
  const cid = String(interaction.customId || "");
  if (!cid.startsWith("inside_track:modal:")) return false;
  if (await guardGamesComponent(interaction)) return true;
  if (await guardNotJailedComponent(interaction)) return true;

  const [, , tableId, betType] = cid.split(":");
  const session = sessionsById.get(tableId);
  if (!session || session.closed) {
    await interaction.reply({ content: "This Inside Track table is no longer active.", flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }

  if (session.phase !== "betting" || Date.now() >= session.bettingEndsAt) {
    await interaction.reply({ content: "Betting is closed for this race.", flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }
  if (session.bets.has(interaction.user.id)) {
    await interaction.reply({ content: "You already have a ticket locked in for this race.", flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }

  const horseNumber = Number.parseInt(String(interaction.fields?.getTextInputValue?.("horse") || ""), 10);
  const horse = session.race.horses.find((h) => h.number === horseNumber);
  if (!horse) {
    await interaction.reply({ content: "Invalid horse number for this race.", flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }

  const amount = parseAmount(interaction.fields?.getTextInputValue?.("amount"));
  if (!amount || amount < config.minBet || amount > config.maxBet) {
    await interaction.reply({
      content: `Wager must be between **${fmtMoney(config.minBet)}** and **${fmtMoney(config.maxBet)}**.`,
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return true;
  }

  const playerSecurity = await getUserCasinoSecurity(session.guildId, interaction.user.id).catch(() => ({ level: 0, feePct: 0 }));
  await maybeAnnounceCasinoSecurity({
    db: interaction.client?.db,
    channel: interaction.channel,
    guildId: session.guildId,
    userId: interaction.user.id,
    displayName: interaction.member?.displayName || interaction.user.username,
    current: playerSecurity,
  }).catch(() => {});

  const feePct = getEffectiveFeePct({
    playerFeePct: playerSecurity.feePct,
    hostBaseFeePct: session.hostSecurity?.feePct || 0,
  });
  const fee = computeFeeForBet(amount, feePct);

  await economy.ensureUser(session.guildId, interaction.user.id).catch(() => {});
  const debit = await economy.tryDebitUser(session.guildId, interaction.user.id, fee.totalCharge, "inside_track_bet", {
    game: "inside_track",
    race: session.race.raceNumber,
    betType,
    horse: horse.name,
    horseNumber,
    stake: amount,
    feeAmount: fee.feeAmount,
    feePct,
  });

  if (!debit?.ok) {
    await interaction.reply({
      content: `You need **${fmtMoney(fee.totalCharge)}** in your wallet for that ticket${fee.feeAmount ? `, including a **${fmtMoney(fee.feeAmount)}** table fee` : ""}.`,
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return true;
  }

  await economy.addServerBank(session.guildId, fee.totalCharge, "inside_track_bet_bank", {
    game: "inside_track",
    race: session.race.raceNumber,
    betType,
    horse: horse.name,
    horseNumber,
    stake: amount,
    feeAmount: fee.feeAmount,
    userId: interaction.user.id,
  }).catch(() => {});

  session.bets.set(interaction.user.id, {
    userId: interaction.user.id,
    type: betType,
    horseNumber,
    amount,
    feeAmount: fee.feeAmount,
    raceNumber: session.race.raceNumber,
  });

  const mult = engine.payoutMultiplierForBet(betType, horse.odds);
  await interaction.reply({
    content: [
      `Ticket locked: **${betType.toUpperCase()}** on **#${horse.number} ${horse.name}** for **${fmtMoney(amount)}**.`,
      `Potential payout: **${mult.toFixed(2)}x** (${fmtMoney(Math.floor(amount * mult))}).`,
      fee.feeAmount ? `Table fee: **${fmtMoney(fee.feeAmount)}**.` : null,
    ].filter(Boolean).join("\n"),
    flags: MessageFlags.Ephemeral,
  }).catch(() => {});
  await safeEdit(session);
  return true;
}

module.exports = {
  startFromHub,
  handleInteraction,
  activityEffects: ACTIVITY_EFFECTS,
};
