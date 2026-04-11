const { EmbedBuilder } = require("discord.js");

const nightWalker = require("../../data/work/categories/nightwalker/index");
const ui = require("../../utils/ui");
const nightWalkerUi = require("./ui");

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
  if (await checkCooldownOrTell(interaction)) return true;

  const cfg = nightWalker?.jobs?.[jobKey];
  if (!cfg) return true;

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
  scheduleReturnToCategory,
}) {
  if (!session.nw) return true;

  const [, jobKey, roundIndexStr, choiceIndexStr] = actionId.split(":");
  const roundIndex = Number(roundIndexStr);
  const choiceIndex = Number(choiceIndexStr);

  const cfg = nightWalker?.jobs?.[jobKey];
  if (!cfg) return true;

  const scenario = session.nw.pickedScenarios?.[roundIndex];
  const choice = scenario?.choices?.[choiceIndex];
  if (!choice) return true;

  applyChoiceEffects(jobKey, session, choice);

  const failure = getFailure(jobKey, session, cfg);
  if (failure) {
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
    if (await checkCooldownOrTell(interaction)) return true;

    const base = randInt(cfg.payout?.min ?? 1000, cfg.payout?.max ?? 2000);
    const mod = 1 + (session.nw.payoutModPct / 100);
    const amountBase = Math.max(0, Math.floor(base * mod));

    const paid = await payUser(
      amountBase,
      `job_nw_${jobKey}`,
      cfg.xp?.success ?? 0,
      { job: jobKey, modPct: session.nw.payoutModPct },
      { countJob: true, allowLegendarySpawn: true, activityEffects: cfg.activityEffects }
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
  if (jobKey === "flirt" && choice.correct === false) {
    session.nw.wrongCount++;
  }
  if (jobKey === "lapDance" && choice.penalty) {
    session.nw.penaltyTokens += choice.penalty;
  }
  if (jobKey === "prostitute") {
    session.nw.risk = clamp(session.nw.risk + (choice.riskDelta || 0), 0, 200);
  }
  session.nw.payoutModPct = clamp(session.nw.payoutModPct + (choice.payoutDeltaPct || 0), -80, 200);
}

function getFailure(jobKey, session, cfg) {
  if (jobKey === "flirt" && session.nw.wrongCount >= (cfg.failOnWrongs || 2)) {
    return "Too many wrong answers. No payout.";
  }
  if (jobKey === "lapDance" && session.nw.penaltyTokens >= (cfg.penalties?.failAt || 3)) {
    return "You messed up too many times. No payout.";
  }
  if (jobKey === "prostitute" && session.nw.risk >= (cfg.risk?.failAt || 100)) {
    return "Heat got too high. No payout.";
  }
  return null;
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
};
