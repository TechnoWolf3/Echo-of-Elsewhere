const { EmbedBuilder } = require("discord.js");

const contractCfg = require("../../data/work/categories/nineToFive/transportContract");
const skillCfg = require("../../data/work/categories/nineToFive/skillCheck");
const shiftCfg = require("../../data/work/categories/nineToFive/shift");
const truckerCfg = require("../../data/work/categories/nineToFive/trucker");
const { emailSorterCfg, generateRun, scoreRun } = require("./emailSorter");
const ui = require("../../utils/ui");
const nineToFiveUi = require("./ui");

const JOB_COOLDOWNS = {
  contract: { key: "job:95:contract", label: "Transport Contract", seconds: contractCfg.cooldownSeconds ?? 10 * 60 },
  skill: { key: "job:95:skill", label: "Skill Check", seconds: skillCfg.cooldownSeconds ?? 5 * 60 },
  shift: { key: "job:95:shift", label: "Shift Work", seconds: shiftCfg.cooldownSeconds ?? 6 * 60 },
  emailSorter: { key: "job:95:email_sorter", label: "Email Sorter", seconds: emailSorterCfg.cooldownSeconds ?? 8 * 60 },
};

function cooldownFor(mode) {
  return JOB_COOLDOWNS[mode] || { key: "job", label: "payout", seconds: 45 };
}

function isNineToFiveInteraction(actionId) {
  return (
    actionId.startsWith("job_95:") ||
    actionId.startsWith("job_contract:") ||
    actionId.startsWith("job_skill:") ||
    actionId.startsWith("job_leg:") ||
    actionId.startsWith("job_email:") ||
    actionId === "job_shift_collect" ||
    actionId === "job_trucker_refresh" ||
    actionId === "job_trucker_start" ||
    actionId === "job_trucker_collect"
  );
}

async function handleNineToFiveInteraction({
  actionId,
  interaction,
  session,
  msg,
  guildId,
  userId,
  payUser,
  checkCooldownOrTell,
  startCooldown,
  scheduleReturnToCategory,
  legendary,
}) {
  if (!isNineToFiveInteraction(actionId)) return false;

  if (actionId.startsWith("job_95:")) {
    const mode = actionId.split(":")[1];
    return handleNineToFiveEntry({
      mode,
      interaction,
      session,
      msg,
      checkCooldownOrTell,
      legendary,
    });
  }

  if (actionId === "job_trucker_refresh") {
  if (!session.trucker || session.trucker.startMs) return true;
  session.trucker.manifest = nineToFiveUi.generateTruckerManifest();
  await msg.edit({
    embeds: [nineToFiveUi.buildTruckerEmbed(session.trucker, { completed: session.trucker.ready })],
    components: nineToFiveUi.buildTruckerButtons(session.trucker),
  }).catch(() => {});
  return true;
}

  if (actionId === "job_trucker_start") {
    return startTrucker({
      interaction,
      session,
      msg,
      checkCooldownOrTell,
    });
  }

  if (actionId === "job_trucker_collect") {
    return collectTrucker({
      session,
      msg,
      payUser,
      scheduleReturnToCategory,
    });
  }

  if (actionId.startsWith("job_contract:")) {
    return handleContractClick({
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

  if (actionId.startsWith("job_skill:") || actionId.startsWith("job_leg:")) {
    return handleSkillClick({
      actionId,
      interaction,
      session,
      msg,
      payUser,
      checkCooldownOrTell,
      startCooldown,
      scheduleReturnToCategory,
      legendary,
    });
  }

  if (actionId.startsWith("job_email:")) {
    return handleEmailSorterClick({
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

  if (actionId === "job_shift_collect") {
    return collectShift({
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

async function handleNineToFiveEntry({
  mode,
  interaction,
  session,
  msg,
  checkCooldownOrTell,
  legendary,
}) {
  if (mode !== "trucker" && mode !== "legendary") {
    const cooldown = cooldownFor(mode);
    if (await checkCooldownOrTell(interaction, cooldown.key, cooldown.label)) return true;
  } else if (mode === "legendary" && await checkCooldownOrTell(interaction)) {
    return true;
  }

  if (mode === "contract") {
    session.view = "contract";
    session.contractStep = 0;
    session.contractPicks = [];
    session.contractBonusTotal = 0;
    session.contractRiskTotal = 0;

    await msg.edit({
      embeds: [nineToFiveUi.buildContractEmbed(0, session.contractPicks, session.level)],
      components: nineToFiveUi.buildContractButtons(0, session.level, false),
    }).catch(() => {});
    return true;
  }

  if (mode === "skill") {
    session.view = "skill";
    const patternLength = Math.max(1, Number(skillCfg.patternLength || 3));
    const target = Array.from({ length: patternLength }, () => pick(skillCfg.emojis));
    session.skillTarget = target;
    session.skillInput = [];
    session.skillExpiresAt = Date.now() + (skillCfg.timeLimitMs || 18_000);

    await msg.edit({
      embeds: [nineToFiveUi.buildSkillEmbed(skillCfg.title || "🧠 Skill Check", target, session.skillExpiresAt)],
      components: nineToFiveUi.buildSkillButtons(target, true, "job_skill"),
    }).catch(() => {});

    const expiresAt = session.skillExpiresAt;
    setTimeout(async () => {
      if (session.view !== "skill" || session.skillExpiresAt !== expiresAt) return;
      await msg.edit({
        embeds: [nineToFiveUi.buildSkillEmbed(skillCfg.title || "ðŸ§  Skill Check", target, session.skillExpiresAt, { progress: 0, total: patternLength })],
        components: nineToFiveUi.buildSkillButtons(target, false, "job_skill"),
      }).catch(() => {});
    }, Math.max(1000, Number(skillCfg.memoriseMs || 3500)));
    return true;
  }

  if (mode === "shift") {
    session.view = "shift";
    if (session.shiftInterval) clearInterval(session.shiftInterval);
    session.shiftStartMs = Date.now();
    session.shiftReady = false;

    await msg.edit({
      embeds: [nineToFiveUi.buildShiftEmbed(session.shiftStartMs, session.shiftDurationMs)],
      components: nineToFiveUi.buildShiftButtons({ canCollect: false, disabled: false }),
    }).catch(() => {});

    const tickMs = (shiftCfg.tickSeconds || 5) * 1000;
    session.shiftInterval = setInterval(async () => {
      try {
        const done = Date.now() - session.shiftStartMs >= session.shiftDurationMs;
        if (done) session.shiftReady = true;

        await msg.edit({
          embeds: [nineToFiveUi.buildShiftEmbed(session.shiftStartMs, session.shiftDurationMs)],
          components: nineToFiveUi.buildShiftButtons({ canCollect: session.shiftReady, disabled: false }),
        }).catch(() => {});

        if (done) {
          clearInterval(session.shiftInterval);
          session.shiftInterval = null;
        }
      } catch {}
    }, tickMs);
    return true;
  }


  if (mode === "emailSorter") {
    session.view = "emailSorter";
    session.emailSorter = generateRun();

    await msg.edit({
      embeds: [nineToFiveUi.buildEmailSorterEmbed(session.emailSorter)],
      components: nineToFiveUi.buildEmailSorterButtons(false),
    }).catch(() => {});
    return true;
  }

  if (mode === "trucker") {
    session.view = "trucker";
    if (session.trucker?.interval) clearInterval(session.trucker.interval);
    session.trucker = {
      manifest: nineToFiveUi.generateTruckerManifest(),
      startMs: 0,
      durationMs: 0,
      ready: false,
      interval: null,
    };

    await msg.edit({
      embeds: [nineToFiveUi.buildTruckerEmbed(session.trucker)],
      components: nineToFiveUi.buildTruckerButtons(session.trucker),
    }).catch(() => {});
    return true;
  }

  if (mode === "legendary") {
    if (!session.legendaryAvailable) return true;

    session.view = "legendary";
    const target = pick(skillCfg.emojis);
    session.skillTarget = target;
    session.skillExpiresAt = Date.now() + legendary.skillTimeMs;

    await msg.edit({
      embeds: [nineToFiveUi.buildSkillEmbed("🌟 Legendary Job", target, session.skillExpiresAt)],
      components: nineToFiveUi.buildSkillButtons(target, false, "job_leg"),
    }).catch(() => {});
    return true;
  }

  return true;
}

async function startTrucker({ interaction, session, msg, checkCooldownOrTell }) {
  if (!session.trucker) {
    session.trucker = {
      manifest: nineToFiveUi.generateTruckerManifest(),
      startMs: 0,
      durationMs: 0,
      ready: false,
      interval: null,
    };
  }
  if (session.trucker.interval) clearInterval(session.trucker.interval);

  session.view = "trucker";
  session.trucker.startMs = Date.now();
  session.trucker.durationMs = session.trucker.manifest.durationMinutes * 60_000;
  session.trucker.ready = false;

  await msg.edit({
    embeds: [nineToFiveUi.buildTruckerEmbed(session.trucker)],
    components: nineToFiveUi.buildTruckerButtons(session.trucker),
  }).catch(() => {});

  const tickMs = Math.max(5_000, (truckerCfg.updateEverySeconds || 30) * 1000);
  session.trucker.interval = setInterval(async () => {
  try {
    const done = Date.now() - session.trucker.startMs >= session.trucker.durationMs;
    if (done) session.trucker.ready = true;

    await msg.edit({
      content: null,
      embeds: [nineToFiveUi.buildTruckerEmbed(session.trucker, { completed: session.trucker.ready })],
      components: nineToFiveUi.buildTruckerButtons(session.trucker),
    }).catch(() => {});

    if (done) {
      clearInterval(session.trucker.interval);
      session.trucker.interval = null;

      await msg.channel.send({
        content: `<@${session.userId}> your delivery is complete — collect your pay.`,
        allowedMentions: { users: [session.userId] },
      }).catch(() => {});
    }
  } catch {}
}, tickMs);

  return true;
}

async function collectTrucker({ session, msg, payUser, scheduleReturnToCategory }) {
  if (!session.trucker?.ready) return true;

  const manifest = session.trucker.manifest;
  const paid = await payUser(
    manifest.payoutBase,
    "job_95_trucker",
    truckerCfg.xp?.success ?? 0,
    {
      freight: manifest.freight,
      truckType: manifest.truckType,
      from: nineToFiveUi.formatRoutePlace(manifest.route.from),
      to: nineToFiveUi.formatRoutePlace(manifest.route.to),
      distanceKm: manifest.distanceKm,
      durationMinutes: manifest.durationMinutes,
    },
    { countJob: true, allowLegendarySpawn: true, activityEffects: truckerCfg.activityEffects, cooldownKey: "job:95:trucker", cooldownSeconds: 0 }
  );

  if (session.trucker?.interval) {
    clearInterval(session.trucker.interval);
    session.trucker.interval = null;
  }

  session.view = "95";
  session.trucker = null;
  await msg.edit({
  content: null,
  embeds: [buildCompletionEmbed({
    title: truckerCfg.completeTitle || "✅ Delivery Complete",
    lines: [
      `**Freight:** ${manifest.freight}`,
      `**Trailer Config:** ${manifest.truckType}`,
      `**Route:** ${nineToFiveUi.formatRoutePlace(manifest.route.from)} -> ${nineToFiveUi.formatRoutePlace(manifest.route.to)}`,
      `**Distance:** ${manifest.distanceKm.toLocaleString()} km`,
    ],
    paid,
  })],
  components: nineToFiveUi.buildNineToFiveComponents({ disabled: false, legendary: session.legendaryAvailable }),
}).catch(() => {});
  scheduleReturnToCategory(5000);
  return true;
}

async function handleContractClick({
  actionId,
  interaction,
  session,
  msg,
  payUser,
  checkCooldownOrTell,
  startCooldown,
  scheduleReturnToCategory,
}) {
  const cooldown = cooldownFor("contract");
  if (await checkCooldownOrTell(interaction, cooldown.key, cooldown.label)) return true;

  const parts = actionId.split(":");
  const stepIndex = Number(parts[1]);
  const label = parts.slice(2).join(":");
  const step = contractCfg.steps[stepIndex];
  const choices = nineToFiveUi.getContractChoices(step, session.level);
  const chosen = choices.find((choice) => choice.label === label);
  if (!chosen) return true;

  session.contractPicks.push(label);
  session.contractBonusTotal += randInt(chosen.modMin, chosen.modMax);
  session.contractRiskTotal += chosen.risk;

  const nextStep = stepIndex + 1;
  if (nextStep >= contractCfg.steps.length) {
    const failRoll = Math.random() < session.contractRiskTotal;
    if (failRoll) {
      if (startCooldown) await startCooldown(cooldown.key, cooldown.seconds);
      session.view = "95";
      await msg.edit({
        embeds: [buildFailureEmbed("📦 Transport Contract - Failed", "The contract went sideways.")],
        components: nineToFiveUi.buildNineToFiveComponents({ disabled: false, legendary: session.legendaryAvailable }),
      }).catch(() => {});
      scheduleReturnToCategory(5000);
      return true;
    }

    const base = randInt(contractCfg.basePay?.min ?? 1575, contractCfg.basePay?.max ?? 2625);
    const amountBase = base + session.contractBonusTotal;
    const paid = await payUser(
      amountBase,
      "job_95_contract",
      contractCfg.xp?.success ?? 0,
      { picks: session.contractPicks, bonusTotal: session.contractBonusTotal, riskTotal: session.contractRiskTotal },
      { countJob: true, allowLegendarySpawn: true, activityEffects: contractCfg.activityEffects, cooldownKey: cooldown.key, cooldownSeconds: cooldown.seconds }
    );

    session.view = "95";
    await msg.edit({
      embeds: [buildCompletionEmbed({ title: "📦 Transport Contract - Complete", paid })],
      components: nineToFiveUi.buildNineToFiveComponents({ disabled: false, legendary: session.legendaryAvailable }),
    }).catch(() => {});
    scheduleReturnToCategory(5000);
    return true;
  }

  session.contractStep = nextStep;
  await msg.edit({
    embeds: [nineToFiveUi.buildContractEmbed(nextStep, session.contractPicks, session.level)],
    components: nineToFiveUi.buildContractButtons(nextStep, session.level, false),
  }).catch(() => {});
  return true;
}

async function handleSkillClick({
  actionId,
  interaction,
  session,
  msg,
  payUser,
  checkCooldownOrTell,
  startCooldown,
  scheduleReturnToCategory,
  legendary,
}) {
  const isLegendary = actionId.startsWith("job_leg:");
  const chosen = actionId.split(":")[1];
  const expired = Date.now() > session.skillExpiresAt;
  const targetPattern = Array.isArray(session.skillTarget) ? session.skillTarget : [session.skillTarget];
  const skillInput = Array.isArray(session.skillInput) ? session.skillInput : [];
  const expected = isLegendary ? session.skillTarget : targetPattern[skillInput.length];
  const wrongChoice = expected && chosen !== expected;

  if (expired || !chosen || wrongChoice) {
    if (!isLegendary && startCooldown) {
      const cooldown = cooldownFor("skill");
      await startCooldown(cooldown.key, cooldown.seconds);
    }
    session.view = "95";
    await msg.edit({
      embeds: [buildFailureEmbed(
        isLegendary ? "🌟 Legendary - Failed" : "🧠 Skill Check - Failed",
        expired ? "Too slow. No payout." : "Wrong button. No payout."
      )],
      components: nineToFiveUi.buildNineToFiveComponents({ disabled: false, legendary: session.legendaryAvailable }),
    }).catch(() => {});
    scheduleReturnToCategory(5000);
    return true;
  }

  if (!isLegendary) {
    session.skillInput = [...skillInput, chosen];
    if (session.skillInput.length < targetPattern.length) {
      await msg.edit({
        embeds: [nineToFiveUi.buildSkillEmbed(skillCfg.title || "ðŸ§  Skill Check", targetPattern, session.skillExpiresAt, { progress: session.skillInput.length, total: targetPattern.length })],
        components: nineToFiveUi.buildSkillButtons(targetPattern, false, "job_skill"),
      }).catch(() => {});
      return true;
    }
  }

  if (isLegendary && await checkCooldownOrTell(interaction)) return true;

  const base = isLegendary
    ? randInt(legendary.min, legendary.max)
    : randInt(skillCfg.payout?.success?.min ?? 2000, skillCfg.payout?.success?.max ?? 4000);

  const paid = await payUser(
    base,
    isLegendary ? "job_95_legendary" : "job_95_skill",
    isLegendary ? (skillCfg.xp?.legendary ?? 30) : (skillCfg.xp?.success ?? 10),
    { legendary: isLegendary },
    {
      countJob: true,
      allowLegendarySpawn: true,
      activityEffects: isLegendary ? (skillCfg.legendaryActivityEffects || skillCfg.activityEffects) : skillCfg.activityEffects,
      cooldownKey: isLegendary ? "job" : cooldownFor("skill").key,
      cooldownSeconds: isLegendary ? undefined : cooldownFor("skill").seconds,
    }
  );

  session.view = "95";
  await msg.edit({
    embeds: [buildCompletionEmbed({ title: isLegendary ? "🌟 Legendary - Complete" : "🧠 Skill Check - Complete", paid })],
    components: nineToFiveUi.buildNineToFiveComponents({ disabled: false, legendary: session.legendaryAvailable }),
  }).catch(() => {});
  scheduleReturnToCategory(5000);
  return true;
}


async function handleEmailSorterClick({
  actionId,
  interaction,
  session,
  msg,
  payUser,
  checkCooldownOrTell,
  scheduleReturnToCategory,
}) {
  const cooldown = cooldownFor("emailSorter");
  if (await checkCooldownOrTell(interaction, cooldown.key, cooldown.label)) return true;
  if (!session.emailSorter?.emails?.length) return true;

  const chosenFolder = actionId.split(':')[1];
  const run = session.emailSorter;
  const email = run.emails[run.currentIndex];
  if (!email) return true;

  run.results.push({
    emailId: email.id,
    subject: email.subject,
    actual: email.category,
    chosen: chosenFolder,
  });
  run.currentIndex += 1;

  const finished = run.currentIndex >= run.emails.length;
  if (!finished) {
    await msg.edit({
      embeds: [nineToFiveUi.buildEmailSorterEmbed(run)],
      components: nineToFiveUi.buildEmailSorterButtons(false),
    }).catch(() => {});
    return true;
  }

  scoreRun(run);

  let paid = null;
  if (!run.failed && run.totals.total > 0) {
    paid = await payUser(
      run.totals.total,
      'job_95_email_sorter',
      run.totals.correct === run.emails.length ? (emailSorterCfg.xp?.success ?? 0) : (emailSorterCfg.xp?.partial ?? 0),
      {
        results: run.results.map((result) => ({
          subject: result.subject,
          actual: result.actual,
          chosen: result.chosen,
          outcome: result.outcome,
          penalty: result.penalty || 0,
        })),
        totals: run.totals,
      },
      { countJob: true, allowLegendarySpawn: true, activityEffects: emailSorterCfg.activityEffects, cooldownKey: cooldown.key, cooldownSeconds: cooldown.seconds }
    );
  }

  session.view = '95';
  session.emailSorter = null;
  await msg.edit({
    embeds: [nineToFiveUi.buildEmailSorterSummaryEmbed(run, { paid })],
    components: nineToFiveUi.buildNineToFiveComponents({ disabled: false, legendary: session.legendaryAvailable }),
  }).catch(() => {});
  scheduleReturnToCategory(7000);
  return true;
}

async function collectShift({
  interaction,
  session,
  msg,
  payUser,
  checkCooldownOrTell,
  scheduleReturnToCategory,
}) {
  if (!session.shiftReady) return true;
  const cooldown = cooldownFor("shift");
  if (await checkCooldownOrTell(interaction, cooldown.key, cooldown.label)) return true;

  const base = randInt(shiftCfg.payout?.min ?? 1200, shiftCfg.payout?.max ?? 2500);
  const paid = await payUser(
    base,
    "job_95_shift",
    shiftCfg.xp?.success ?? 12,
    { shift: true },
    { countJob: true, allowLegendarySpawn: true, activityEffects: shiftCfg.activityEffects, cooldownKey: cooldown.key, cooldownSeconds: cooldown.seconds }
  );

  session.view = "95";
  await msg.edit({
    embeds: [buildCompletionEmbed({ title: "🕒 Shift - Complete", paid })],
    components: nineToFiveUi.buildNineToFiveComponents({ disabled: false, legendary: session.legendaryAvailable }),
  }).catch(() => {});
  scheduleReturnToCategory(5000);
  return true;
}

function buildCompletionEmbed({ title, paid, lines = [] }) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(
      [
        ...lines,
        lines.length ? "" : null,
        `✅ Paid: **$${paid.amount.toLocaleString()}**`,
        `⏳ Next payout: <t:${toUnix(paid.nextClaim)}:R>`,
        paid.prog.leveledUp ? `🎉 Level up! You are now **Level ${paid.prog.level}**` : "",
        "",
        "Back to Work a 9-5.",
      ].filter(Boolean).join("\n")
    )
    .setColor(ui.colors.success);
}

function buildFailureEmbed(title, reason) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(["❌ " + reason, "", "Back to Work a 9-5."].join("\n"))
    .setColor(ui.colors.danger);
}

function randInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function toUnix(date) {
  return Math.floor(date.getTime() / 1000);
}

module.exports = {
  handleNineToFiveInteraction,
  isNineToFiveInteraction,
};
