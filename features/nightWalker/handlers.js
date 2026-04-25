const { EmbedBuilder } = require("discord.js");

const nightWalker = require("../../data/work/categories/nightwalker/index");
const ui = require("../../utils/ui");
const nightWalkerUi = require("./ui");

const JOB_COOLDOWN_DEFAULTS = {
  flirt: 5 * 60,
  lapDance: 7 * 60,
  prostitute: 10 * 60,
};

function cooldownFor(jobKey, cfg = {}) {
  return {
    key: `job:nw:${jobKey}`,
    label: cfg.title || jobKey,
    seconds: cfg.cooldownSeconds ?? JOB_COOLDOWN_DEFAULTS[jobKey] ?? 45,
  };
}

function isNightWalkerInteraction(actionId) {
  return actionId.startsWith("job_nw:") || actionId.startsWith("nw:");
}

async function handleNightWalkerInteraction({
  actionId,
  interaction,
  session,
  msg,
  payUser,
  checkCooldownOrTell,
  startCooldown,
  scheduleReturnToCategory,
}) {
  if (!isNightWalkerInteraction(actionId)) return false;

  if (actionId.startsWith("job_nw:")) {
    return startNightWalkerJob({
      actionId,
      interaction,
      session,
      msg,
      checkCooldownOrTell,
    });
  }

  if (actionId.startsWith("nw:")) {
    return handleNightWalkerChoice({
      actionId,
      interaction,
      session,
      msg,
      payUser,
      checkCooldownOrTell,
      startCooldown,
      scheduleReturnToCategory,
    });
  }

  return true;
}

async function startNightWalkerJob({
  actionId,
  interaction,
  session,
  msg,
  checkCooldownOrTell,
}) {
  const jobKey = actionId.split(":")[1];
  const cfg = nightWalker?.jobs?.[jobKey];
  if (!cfg) return true;
  const cooldown = cooldownFor(jobKey, cfg);
  if (await checkCooldownOrTell(interaction, cooldown.key, cooldown.label)) return true;

  const rounds = cfg.rounds || 1;
  const poolList = cfg.scenarios || [];
  const pickedScenarios = sampleUnique(poolList, rounds);

  while (pickedScenarios.length < rounds && poolList.length) {
    pickedScenarios.push(pick(poolList));
  }

  session.view = "nw_round";
  session.nw = {
    jobKey,
    cfg,
    roundIndex: 0,
    pickedScenarios,
    wrongCount: 0,
    penaltyTokens: 0,
    risk: 0,
    payoutModPct: 0,
  };

  const scenario = session.nw.pickedScenarios[0];
  await msg.edit({
    embeds: [
      nightWalkerUi.buildNWRoundEmbed({
        title: cfg.title || jobKey,
        round: 1,
        rounds,
        prompt: scenario?.prompt || "...",
        statusLines: [],
      }),
    ],
    components: nightWalkerUi.buildNWChoiceComponents({
      jobKey,
      roundIndex: 0,
      choices: scenario?.choices || [],
    }),
  }).catch(() => {});
  return true;
}

async function handleNightWalkerChoice({
  actionId,
  interaction,
  session,
  msg,
  payUser,
  checkCooldownOrTell,
  startCooldown,
  scheduleReturnToCategory,
}) {
  if (!session.nw) return true;

  const [, jobKey, roundIndexStr, choiceIndexStr] = actionId.split(":");
  const roundIndex = Number(roundIndexStr);
  const choiceIndex = Number(choiceIndexStr);

  const cfg = nightWalker?.jobs?.[jobKey];
  if (!cfg) return true;
  const cooldown = cooldownFor(jobKey, cfg);

  const scenario = session.nw.pickedScenarios?.[roundIndex];
  const choice = scenario?.choices?.[choiceIndex];
  if (!choice) return true;

  applyChoiceEffects(jobKey, session, choice);

  const failure = getFailure(jobKey, session, cfg);
  if (failure) {
    if (startCooldown) await startCooldown(cooldown.key, cooldown.seconds);
    session.view = "nw";
    session.nw = null;

    await msg.edit({
      embeds: [buildFailureEmbed(`${cfg.title || jobKey} - Failed`, failure)],
      components: nightWalkerUi.buildNightWalkerComponents(false),
    }).catch(() => {});
    scheduleReturnToCategory(5000);
    return true;
  }

  session.nw.roundIndex++;

  if (session.nw.roundIndex >= (cfg.rounds || 1)) {
    if (await checkCooldownOrTell(interaction, cooldown.key, cooldown.label)) return true;

    const base = randInt(cfg.payout?.min ?? 1000, cfg.payout?.max ?? 2000);
    const mod = getPayoutMultiplier(jobKey, session, cfg);
    const amountBase = Math.max(0, Math.floor(base * mod));

    const paid = await payUser(
      amountBase,
      `job_nw_${jobKey}`,
      cfg.xp?.success ?? 0,
      { job: jobKey, modPct: Math.round((mod - 1) * 100), risk: session.nw.risk },
      { countJob: true, allowLegendarySpawn: true, activityEffects: cfg.activityEffects, cooldownKey: cooldown.key, cooldownSeconds: cooldown.seconds }
    );

    session.view = "nw";
    session.nw = null;

    await msg.edit({
      embeds: [buildCompleteEmbed(`${cfg.title || jobKey} - Complete`, choice.feedback || "Nice.", paid)],
      components: nightWalkerUi.buildNightWalkerComponents(false),
    }).catch(() => {});
    scheduleReturnToCategory(5000);
    return true;
  }

  const nextScenario = session.nw.pickedScenarios?.[session.nw.roundIndex];
  await msg.edit({
    embeds: [
      nightWalkerUi.buildNWRoundEmbed({
        title: cfg.title || jobKey,
        round: session.nw.roundIndex + 1,
        rounds: cfg.rounds || 1,
        prompt: nextScenario?.prompt || "...",
        statusLines: [choice.feedback || "", "", ...getStatusLines(jobKey, session, cfg)].filter(Boolean),
      }),
    ],
    components: nightWalkerUi.buildNWChoiceComponents({
      jobKey,
      roundIndex: session.nw.roundIndex,
      choices: nextScenario?.choices || [],
    }),
  }).catch(() => {});
  return true;
}

function applyChoiceEffects(jobKey, session, choice) {
  if (jobKey === "flirt") {
    const modifiers = session.nw.cfg?.modifiers || {};
    if (choice.tag === "wrong" || choice.correct === false) {
      session.nw.wrongCount++;
      session.nw.payoutModPct -= Number(modifiers.wrongPenaltyPct || 0);
    } else if (choice.tag === "good") {
      session.nw.payoutModPct += Number(modifiers.goodBonusPct || 0);
    } else {
      session.nw.payoutModPct += Number(modifiers.neutralBonusPct || 0);
    }
  }
  if (jobKey === "lapDance") {
    const penalties = session.nw.cfg?.penalties || {};
    if (choice.tag === "awkward" || choice.penalty) {
      session.nw.penaltyTokens += Number(choice.penalty || penalties.awkwardAdds || 1);
    } else if (choice.tag === "smooth") {
      session.nw.penaltyTokens = Math.max(0, session.nw.penaltyTokens - Number(penalties.smoothRemoves || 0));
    }
  }
  if (jobKey === "prostitute") {
    session.nw.risk = clamp(session.nw.risk + (choice.riskDelta || 0), 0, 200);
  }
  if (jobKey !== "flirt") {
    session.nw.payoutModPct = clamp(session.nw.payoutModPct + (choice.payoutDeltaPct || 0), -80, 200);
  } else {
    session.nw.payoutModPct = clamp(session.nw.payoutModPct, -80, 200);
  }
}

function getFailure(jobKey, session, cfg) {
  if (jobKey === "flirt" && session.nw.wrongCount >= (cfg.failOnWrongs || 2)) {
    return "Too many wrong answers. No payout.";
  }
  if (jobKey === "lapDance" && session.nw.penaltyTokens >= (cfg.penalties?.failAt || 3)) {
    return "You messed up too many times. No payout.";
  }
  if (jobKey === "prostitute" && cfg.risk?.failAt && session.nw.risk >= cfg.risk.failAt) {
    return "Heat got too high. No payout.";
  }
  return null;
}

function getPayoutMultiplier(jobKey, session, cfg) {
  if (jobKey !== "prostitute") {
    return 1 + (session.nw.payoutModPct / 100);
  }

  const risk = Math.max(0, Number(session.nw.risk || 0));
  const variance = Math.max(0, Number(cfg.risk?.payoutVariancePct ?? 5));
  const riskBonusPct = randInt(Math.max(0, Math.floor(risk - variance)), Math.ceil(risk + variance));
  return 1 + riskBonusPct / 100;
}

function getStatusLines(jobKey, session, cfg) {
  const lines = [];
  if (jobKey === "flirt") lines.push(`Wrong answers: **${session.nw.wrongCount}/${cfg.failOnWrongs || 2}**`);
  if (jobKey === "lapDance") lines.push(`Mistakes: **${session.nw.penaltyTokens}/${cfg.penalties?.failAt || 3}**`);
  if (jobKey === "prostitute") lines.push(`Risk: **${session.nw.risk}/${cfg.risk?.failAt || 100}**`);
  return lines;
}

function buildFailureEmbed(title, reason) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(`❌ ${reason}`)
    .setColor(ui.colors.danger);
}

function buildCompleteEmbed(title, feedback, paid) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(
      [
        feedback,
        "",
        `✅ Paid: **$${paid.amount.toLocaleString()}**`,
        `⏳ Next payout: <t:${toUnix(paid.nextClaim)}:R>`,
        paid.prog.leveledUp ? `🎉 Level up! You are now **Level ${paid.prog.level}**` : "",
        "",
        "Back to Night Walker.",
      ].filter(Boolean).join("\n")
    )
    .setColor(ui.colors.success);
}

function sampleUnique(arr, n) {
  const copy = [...arr];
  const out = [];
  while (copy.length && out.length < n) {
    out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
  }
  return out;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function toUnix(date) {
  return Math.floor(date.getTime() / 1000);
}

module.exports = {
  handleNightWalkerInteraction,
  isNightWalkerInteraction,
  cooldownFor,
};
