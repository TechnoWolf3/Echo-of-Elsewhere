const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require("discord.js");

const path = require("path");
const { pool } = require(path.join(process.cwd(), "utils", "db"));
const { setJail } = require(path.join(process.cwd(), "utils", "jail"));
const { tryDebitUser, addServerBank } = require(path.join(process.cwd(), "utils", "economy"));
const { creditUserWithEffects } = require(path.join(process.cwd(), "utils", "effectSystem"));
const content = require("./scamCall.data");

const ACTIVITY_EFFECTS = {
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
};

const GLOBAL_LOCKOUT_KEY = "crime_global";
const CRIME_KEY = "crime_scam";
const RESULTS_LINGER_MS = 18_000;
const GO_BUTTON_ID = "go_for_it";
const HANGUP_BUTTON_ID = "hang_up";

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}
function randInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
function weightPick(items, weightKey = "weight") {
  const total = items.reduce((sum, item) => sum + Math.max(0, Number(item?.[weightKey] || 0)), 0);
  if (total <= 0) return pick(items);
  let roll = Math.random() * total;
  for (const item of items) {
    roll -= Math.max(0, Number(item?.[weightKey] || 0));
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}
function money(n) {
  return `$${Number(n || 0).toLocaleString("en-AU")}`;
}
function progressBar(value, max = 100, length = 10) {
  const pct = clamp(Number(value || 0) / Math.max(1, Number(max || 100)), 0, 1);
  const filled = Math.round(pct * length);
  return `【${"█".repeat(filled)}${"░".repeat(length - filled)}】`;
}

async function ensureUserRow(guildId, userId) {
  await pool.query(
    `INSERT INTO user_balances (guild_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT (guild_id, user_id) DO NOTHING`,
    [guildId, userId]
  );
}

async function addUserWallet(guildId, userId, amount, type = "crime_payout", meta = {}) {
  await creditUserWithEffects({
    guildId,
    userId,
    amount,
    type,
    meta: { ...meta, destination: "wallet" },
    activityEffects: ACTIVITY_EFFECTS,
    awardSource: "crime_scam_call",
  });
}

async function subtractUserWalletAndSendToBank(guildId, userId, amount, type = "crime_loss", meta = {}) {
  await ensureUserRow(guildId, userId);

  const res = await pool.query(
    `SELECT balance FROM user_balances WHERE guild_id=$1 AND user_id=$2`,
    [guildId, userId]
  );

  const current = Number(res.rows?.[0]?.balance || 0);
  const take = Math.min(current, Math.max(0, Number(amount) || 0));
  if (take <= 0) return 0;

  const debit = await tryDebitUser(guildId, userId, take, type, { ...meta, source: "wallet" });
  if (!debit?.ok) return 0;

  await addServerBank(guildId, take, `${type}_bank`, { ...meta, userId, source: "wallet" });
  return take;
}

async function setCooldownMinutes(guildId, userId, key, minutes) {
  const next = new Date(Date.now() + Number(minutes || 0) * 60_000);
  await pool.query(
    `INSERT INTO cooldowns (guild_id, user_id, key, next_claim_at)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (guild_id, user_id, key)
     DO UPDATE SET next_claim_at = EXCLUDED.next_claim_at`,
    [guildId, userId, key, next]
  );
}

async function applyCooldowns(guildId, userId) {
  await setCooldownMinutes(guildId, userId, GLOBAL_LOCKOUT_KEY, content.settings.globalCooldownMinutes);
  await setCooldownMinutes(guildId, userId, CRIME_KEY, content.settings.scamCooldownMinutes);
}

function getBand(bands, value) {
  const v = clamp(Math.round(Number(value || 0)), 0, 100);
  return bands.find((b) => v <= b.max) || bands[bands.length - 1];
}

function reactionPool(target, tag, bucket = "positive") {
  const direct = target?.responses?.[tag];
  if (Array.isArray(direct) && direct.length) return direct;
  return target?.responses?.[bucket] || ["They pause on the line."];
}

function pickResponse(target, option, bucket) {
  const primaryTag = option?.tags?.[0];
  const pool = reactionPool(target, primaryTag, bucket);
  return pick(pool) || "They pause on the line.";
}

function getOptionById(id) {
  return content.dialogueOptions.find((opt) => opt.id === id) || null;
}

function getVisibleOptions(state) {
  const available = content.dialogueOptions.filter((opt) => {
    if (state.usedOptions.has(opt.id)) return false;
    if (opt.minTurn && state.turn < opt.minTurn) return false;
    if (opt.maxTurn && state.turn > opt.maxTurn) return false;
    return true;
  });

  const chosen = shuffle(available).slice(0, 4);
  if (chosen.length < 4) {
    for (const extra of shuffle(content.dialogueOptions)) {
      if (chosen.length >= 4) break;
      if (!chosen.find((c) => c.id === extra.id)) chosen.push(extra);
    }
  }
  return chosen.slice(0, 4);
}

function maybeTriggerRareEvent(state) {
  if (Math.random() > content.settings.rareEventChance) return null;
  const event = weightPick(content.rareEvents);
  if (!event) return null;
  try { event.apply(state); } catch {}
  state.persuasion = clamp(state.persuasion, 0, 100);
  state.suspicion = clamp(state.suspicion, 0, 100);
  return event.text;
}

function applyOptionToState(state, option) {
  const target = state.target;
  const affinity = (option.tags || []).reduce((sum, tag) => sum + Number(target.persuasionByTag?.[tag] || 0), 0);
  const basePers = randInt(option.persuasion[0], option.persuasion[1]);
  const baseSusp = randInt(option.suspicion[0], option.suspicion[1]);

  let persuasionDelta = basePers + affinity;
  let suspicionDelta = baseSusp;
  if (persuasionDelta <= 0) suspicionDelta += randInt(3, 8);

  const backfireChance = clamp(Number(target.backfireBase || 0) + Number(option.risk || 0), 2, 60);
  const backfired = Math.random() < backfireChance / 100;
  let bucket = "positive";

  if (backfired) {
    bucket = "backfire";
    persuasionDelta = -Math.max(5, Math.round(Math.abs(persuasionDelta) * randInt(45, 80) / 100));
    suspicionDelta += randInt(10, 18);
  } else if (persuasionDelta < 0) {
    bucket = "negative";
    persuasionDelta = Math.round(persuasionDelta);
    suspicionDelta += randInt(2, 6);
  }

  state.persuasion = clamp(state.persuasion + persuasionDelta, 0, 100);
  state.suspicion = clamp(state.suspicion + suspicionDelta, 0, 100);
  state.turn += 1;
  state.usedOptions.add(option.id);

  const response = pickResponse(target, option, bucket);
  state.log.push(`**You:** ${option.line}`);
  state.log.push(`**Target:** ${response}`);

  const eventText = maybeTriggerRareEvent(state);
  if (eventText) state.log.push(eventText);

  return { persuasionDelta, suspicionDelta, response, bucket, eventText };
}

function buildRunEmbed(state, options) {
  const persuasionBand = getBand(content.settings.persuasionBands, state.persuasion);
  const suspicionBand = getBand(content.settings.suspicionBands, state.suspicion);
  const recentLog = state.log.slice(-6).join("\n");

  return new EmbedBuilder()
    .setTitle("☎️ Scam Call Centre")
    .setColor(0x7a1fa2)
    .setDescription(
      [
        "You've got a live one on the line. Read the room, build the lie, then decide when to go in for the scam.",
        "",
        `**Persuasion:** ${persuasionBand.label} (${persuasionBand.approx})`,
        progressBar(state.persuasion, 100, 10),
        `**Suspicion:** ${suspicionBand.label}`,
        progressBar(state.suspicion, 100, 10),
        `**Turns used:** ${state.turn}/${content.settings.maxTurns}`,
        "",
        recentLog,
      ].join("\n")
    )
    .setFooter({ text: "Customer types and dialogue pools are fully editable in scamCall.data.js" });
}

function buildRunComponents(state, options) {
  const rows = [];
  const showGo = state.turn >= content.settings.goInForScamMinTurn && Math.random() < content.settings.goInForScamChance;

  const actionButtons = options.map((option) =>
    new ButtonBuilder()
      .setCustomId(`sc|${state.sessionId}|opt|${option.id}`)
      .setLabel(option.label.slice(0, 80))
      .setStyle(ButtonStyle.Secondary)
  );

  if (showGo) {
    actionButtons.splice(
      Math.min(actionButtons.length, randInt(1, actionButtons.length)),
      0,
      new ButtonBuilder()
        .setCustomId(`sc|${state.sessionId}|opt|${GO_BUTTON_ID}`)
        .setLabel("Go in for the scam!")
        .setStyle(ButtonStyle.Success)
    );
  }

  rows.push(new ActionRowBuilder().addComponents(actionButtons.slice(0, 5)));
  if (actionButtons.length > 5) rows.push(new ActionRowBuilder().addComponents(actionButtons.slice(5, 10)));
  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`sc|${state.sessionId}|opt|${HANGUP_BUTTON_ID}`)
        .setLabel("Hang up")
        .setStyle(ButtonStyle.Danger)
    )
  );
  return rows;
}

function resolvePayout(persuasion, target, state) {
  const band = content.settings.payoutBands.find((b) => persuasion >= b.min && persuasion <= b.max);
  if (!band) return 0;
  const raw = randInt(band.range[0], band.range[1]);
  return Math.round(raw * Number(target.rewardMultiplier || 1) * Number(state.jackpotMultiplier || 1));
}

function getFailureKind(state) {
  if (state.traceFlag || state.suspicion >= 100) return "trace";
  return pick(state.target.failOutcomes || ["hangup"]);
}

async function finalize(interaction, state, reason, context = {}) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const target = state.target;
  let outcome = "spotted";
  let identified = false;
  let finalHeat = clamp(state.heatStart || 0, 0, 100);
  let payout = 0;
  let loss = 0;
  let jailedUntil = null;
  let resultLines = [];

  await applyCooldowns(guildId, userId);

  if (reason === "hangup") {
    outcome = "clean";
    resultLines = [pick(target.hangups || ["You hang up."]), pick(target.declineNotes || ["The floor manager is unimpressed."])];
    finalHeat = clamp(finalHeat, 0, 100);
  } else {
    const successChance = clamp(Math.round(state.persuasion), 1, 100);
    const roll = randInt(1, 100);
    const success = reason === "forced_success" || roll <= successChance;

    if (success) {
      payout = resolvePayout(state.persuasion, target, state);
      if (payout > 0) {
        await addUserWallet(guildId, userId, payout, "crime_scam_payout", {
          targetType: target.id,
          persuasion: state.persuasion,
          destination: "wallet",
        });
      }

      const addedHeat = Math.max(0, Math.round((state.persuasion - target.basePersuasion) * Number(target.heatMultiplier || 1))) + Number(state.heatBonus || 0);
      finalHeat = clamp((state.heatStart || 0) + addedHeat, 0, 100);
      outcome = addedHeat <= 10 ? "clean" : addedHeat <= 30 ? "spotted" : addedHeat <= 55 ? "partial" : state.traceFlag ? "busted_hard" : "busted";
      identified = finalHeat >= 50 || state.traceFlag;
      resultLines = [
        "☎️ **Call Result**",
        `Persuasion settled at **${clamp(Math.round(state.persuasion), 0, 100)}%**.`,
        pick(target.responses.goSuccess || [pick(target.successReplies || ["The scam lands."])]),
        pick(target.successReplies || ["The scam lands."]),
        payout > 0 ? `💸 You walked away with **${money(payout)}**.` : "💸 The scam landed, but the payout was miserable.",
      ];
    } else {
      const failKind = getFailureKind(state);
      if (failKind === "reversed") {
        loss = randInt(6000, 18000);
        const taken = await subtractUserWalletAndSendToBank(guildId, userId, loss, "crime_scam_reversed", {
          targetType: target.id,
          source: "wallet",
        });
        loss = taken;
        outcome = "partial";
        finalHeat = clamp((state.heatStart || 0) + randInt(18, 30) + Number(state.heatBonus || 0), 0, 100);
        identified = true;
        resultLines = [
          "☎️ **Call Result**",
          `Persuasion peaked at **${clamp(Math.round(state.persuasion), 0, 100)}%**, but the target turned it back on you.`,
          pick(target.responses.goFail || target.responses.backfire || ["It goes horribly wrong."]),
          loss > 0 ? `💳 You lost **${money(loss)}** trying to get clever.` : "💳 They tried to turn the tables, but you had nothing left worth taking.",
        ];
      } else if (failKind === "trace") {
        outcome = "busted_hard";
        identified = true;
        finalHeat = clamp((state.heatStart || 0) + randInt(45, 65) + Number(state.heatBonus || 0), 0, 100);
        const jailMinutes = randInt(20, 35);
        if (Math.random() < 0.5) {
          jailedUntil = await setJail(guildId, userId, jailMinutes);
        }
        resultLines = [
          "☎️ **Call Result**",
          `Persuasion reached **${clamp(Math.round(state.persuasion), 0, 100)}%**, but the line was hot.`,
          pick(target.responses.goFail || ["The line goes dead."]),
          "🚓 The call was traced. That is, as they say, less than ideal.",
        ];
        if (jailedUntil) {
          resultLines.push(`⛓️ You were jailed for **${jailMinutes} minutes** — release <t:${Math.floor(new Date(jailedUntil).getTime() / 1000)}:R>.`);
        }
      } else if (failKind === "reported") {
        outcome = "busted";
        identified = true;
        finalHeat = clamp((state.heatStart || 0) + randInt(28, 42) + Number(state.heatBonus || 0), 0, 100);
        resultLines = [
          "☎️ **Call Result**",
          `Persuasion reached **${clamp(Math.round(state.persuasion), 0, 100)}%**, but not far enough.`,
          pick(target.responses.goFail || ["They cut you off."]),
          "📞 The victim reported the call. Somewhere, paperwork with your name on it is absolutely blossoming.",
        ];
      } else {
        outcome = "spotted";
        finalHeat = clamp((state.heatStart || 0) + randInt(10, 20) + Number(state.heatBonus || 0), 0, 100);
        resultLines = [
          "☎️ **Call Result**",
          `Persuasion reached **${clamp(Math.round(state.persuasion), 0, 100)}%**, but the target bailed out.`,
          pick(target.responses.goFail || ["They hang up."]),
          "📴 The victim hung up before the scam could close.",
        ];
      }
    }
  }

  if (typeof context.onScamCallComplete === "function") {
    try {
      await context.onScamCallComplete({
        guildId,
        userId,
        outcome,
        finalHeat,
        identified,
      });
    } catch {}
  }

  const embed = new EmbedBuilder()
    .setTitle("☎️ Scam Call Complete")
    .setColor(outcome.startsWith("busted") ? 0xaa0000 : payout > 0 ? 0x22aa55 : 0xb8860b)
    .setDescription(resultLines.join("\n"))
    .addFields(
      { name: "🔥 Final Heat", value: `${finalHeat}/100`, inline: true },
      { name: "🧾 Identified?", value: identified ? "Likely" : "Not obviously", inline: true },
      { name: "🎯 Target Read", value: target.id.replace(/_/g, " "), inline: true }
    )
    .setFooter({ text: "Things may become more obvious when you read into them" });

  await interaction.editReply({ content: null, embeds: [embed], components: [] }).catch(() => {});
  return { outcome, finalHeat, identified };
}

module.exports = async function startScamCall(interaction, context = {}) {
  const message = await interaction.fetchReply();
  const target = weightPick(content.targetTypes);
  const state = {
    sessionId: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    target,
    turn: 0,
    persuasion: Number(target.basePersuasion || 0),
    suspicion: 0,
    usedOptions: new Set(),
    jackpotMultiplier: 1,
    heatBonus: 0,
    traceFlag: false,
    heatStart: clamp(Number(context.lingeringHeat || 0), 0, 100),
    log: [
      `**Target:** ${pick(target.openings || ["Hello?"])}`,
    ],
  };

  let done = false;
  const finishOnce = async (reason) => {
    if (done) return null;
    done = true;
    return finalize(interaction, state, reason, context);
  };

  const render = async () => {
    const options = getVisibleOptions(state);
    await interaction
      .editReply({
        content: null,
        embeds: [buildRunEmbed(state, options)],
        components: buildRunComponents(state, options),
      })
      .catch(() => {});
  };

  const collector = message.createMessageComponentCollector({ time: content.settings.timeoutMs });

  collector.on("collect", async (i) => {
    if (i.user.id !== interaction.user.id) {
      return i.reply({ content: "❌ Not your scam call.", flags: 64 }).catch(() => {});
    }

    await i.deferUpdate().catch(() => {});

    const parts = String(i.customId || "").split("|");
    if (parts.length !== 4 || parts[0] !== "sc" || parts[1] !== state.sessionId || parts[2] !== "opt") return;

    const optionId = parts[3];

    if (optionId === HANGUP_BUTTON_ID) {
      collector.stop("hangup");
      await finishOnce("hangup");
      return;
    }

    if (optionId === GO_BUTTON_ID) {
      collector.stop("go");
      await finishOnce("go");
      return;
    }

    const option = getOptionById(optionId);
    if (!option) {
      await render();
      return;
    }

    applyOptionToState(state, option);

    if (state.suspicion >= 100) {
      collector.stop("busted");
      await finishOnce("go");
      return;
    }

    if (state.turn >= content.settings.maxTurns) {
      collector.stop("maxturns");
      await finishOnce("go");
      return;
    }

    await render();
  });

  collector.on("end", async (_, reason) => {
    if (done) return;
    if (["hangup", "go", "busted", "maxturns"].includes(reason)) return;

    done = true;
    await applyCooldowns(interaction.guildId, interaction.user.id).catch(() => {});
    await interaction
      .editReply({
        content: "⏱️ The line goes dead while you hesitate. Whatever you almost had, it's gone.",
        embeds: [],
        components: [],
      })
      .catch(() => {});

    if (typeof context.onScamCallComplete === "function") {
      try {
        await context.onScamCallComplete({
          guildId: interaction.guildId,
          userId: interaction.user.id,
          outcome: "spotted",
          finalHeat: clamp((state.heatStart || 0) + 8, 0, 100),
          identified: false,
        });
      } catch {}
    }
  });

  await render();
  return new Promise((resolve) => {
    const stopCheck = setInterval(() => {
      if (!done) return;
      clearInterval(stopCheck);
      setTimeout(() => resolve(), RESULTS_LINGER_MS);
    }, 250);
  });
};

module.exports.activityEffects = ACTIVITY_EFFECTS;
