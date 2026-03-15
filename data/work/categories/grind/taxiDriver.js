const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require("discord.js");

const { canGrind, tickFatigue, fatigueBar, MAX_FATIGUE_MS, applyGrindLock } = require("../../../../utils/grindFatigue");
const { money, mintUser, setJobCooldownSeconds } = require("./_shared");
const SCENARIOS = require("./taxiDriver.scenarios");

const JOB_COOLDOWN_SECONDS = 45;
const SHIFT_TTL_MS = 7 * 60_000;
const OVERTIME_HARDCAP_MULT = 1.5;
const SHIFT_TARGET = 5;

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

function randInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, Number(n)));
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function chance(p) {
  return Math.random() < p;
}

function routeToText(route, revealCount = route.length) {
  return route
    .map((step, idx) => (idx < revealCount ? `**${idx + 1}. ${step}**` : `**${idx + 1}. ?**`))
    .join("\n");
}

function buildPassenger(type) {
  const routeLen = randInt(3, 6);
  const route = Array.from({ length: routeLen }, () => pick(["Left", "Right", "Straight"]));

  const baseByType = {
    easy: { min: 1000, max: 3000 },
    vip: { min: 6000, max: 15000 },
    sketchy: { min: 1800, max: 5200 },
  };

  const range = baseByType[type] || baseByType.easy;
  const payout = randInt(range.min, range.max);
  return {
    type,
    description: pick(SCENARIOS[type]),
    intro: pick(SCENARIOS.routeIntros),
    route,
    basePayout: payout,
  };
}

function rollPassengerType() {
  const r = Math.random();
  if (r < 0.56) return "easy";
  if (r < 0.78) return "sketchy";
  return "vip";
}

function nextPassenger() {
  return buildPassenger(rollPassengerType());
}

function passengerLabel(type) {
  if (type === "vip") return "💎 VIP Passenger";
  if (type === "sketchy") return "🕶️ Sketchy Passenger";
  return "🙂 Casual Passenger";
}

function typeColor(type) {
  if (type === "vip") return 0xeab308;
  if (type === "sketchy") return 0xef4444;
  return 0x22c55e;
}

module.exports = function startTaxiDriver(btn, { pool, boardMsg, guildId, userId } = {}) {
  return new Promise(async (resolve) => {
    let _resolved = false;
    const resolveOnce = () => {
      if (_resolved) return;
      _resolved = true;
      resolve();
    };

    const db = pool;
    const gate = await canGrind(db, guildId, userId);
    if (!gate.ok) {
      const ts = gate.lockedUntil ? Math.floor(gate.lockedUntil.getTime() / 1000) : null;
      await btn.followUp({
        content: ts
          ? `🥵 You’re fatigued. Grind unlocks <t:${ts}:R>.`
          : `🥵 You’re at **100% fatigue**. Rest a bit before starting another Grind shift.`,
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      resolveOnce();
      return;
    }

    let overtime = false;
    let shiftIndex = 1;
    let served = 0;
    let declined = 0;
    let incidents = 0;
    let earned = 0;
    let tips = 0;
    let lastFareEarned = 0;
    let ongoingShiftPenaltyPct = 0;
    let lastTick = { fatigueMs: 0, exhausted: false };
    let feedback = "";

    let passenger = nextPassenger();
    let state = "offer"; // offer | preview | route | result
    let stepIndex = 0;
    let previewTimer = null;

    function buildAcceptBtn() {
      return new ButtonBuilder().setCustomId("grind_taxi:accept").setLabel("Accept").setStyle(ButtonStyle.Success);
    }

    function buildDeclineBtn() {
      return new ButtonBuilder().setCustomId("grind_taxi:decline").setLabel("Decline").setStyle(ButtonStyle.Secondary);
    }

    function buildLeftBtn(disabled = false) {
      return new ButtonBuilder().setCustomId("grind_taxi:turn:left").setLabel("⬅ Left").setStyle(ButtonStyle.Primary).setDisabled(disabled);
    }

    function buildStraightBtn(disabled = false) {
      return new ButtonBuilder().setCustomId("grind_taxi:turn:straight").setLabel("⬆ Straight").setStyle(ButtonStyle.Primary).setDisabled(disabled);
    }

    function buildRightBtn(disabled = false) {
      return new ButtonBuilder().setCustomId("grind_taxi:turn:right").setLabel("Right ➡").setStyle(ButtonStyle.Primary).setDisabled(disabled);
    }

    function buildNextBtn() {
      return new ButtonBuilder().setCustomId("grind_taxi:next").setLabel("Next Fare").setStyle(ButtonStyle.Success);
    }

    function buildPushBtn() {
      return new ButtonBuilder().setCustomId("grind_taxi:push").setLabel("Push on").setStyle(ButtonStyle.Secondary);
    }

    function buildEndBtn() {
      return new ButtonBuilder().setCustomId("grind_taxi:end").setLabel("End shift").setStyle(ButtonStyle.Danger);
    }

    function clearPreviewTimer() {
      if (previewTimer) clearTimeout(previewTimer);
      previewTimer = null;
    }

    function effectiveFare(baseAmount) {
      const pct = clamp(ongoingShiftPenaltyPct, 0, 90);
      return Math.max(0, Math.floor(baseAmount * (1 - pct / 100)));
    }

    function routeControls({ disabled = false } = {}) {
      return new ActionRowBuilder().addComponents(
        buildLeftBtn(disabled),
        buildStraightBtn(disabled),
        buildRightBtn(disabled),
      );
    }

    function offerControls() {
      return new ActionRowBuilder().addComponents(buildAcceptBtn(), buildDeclineBtn());
    }

    function bottomControls() {
      const row = new ActionRowBuilder().addComponents(buildEndBtn());
      if (lastTick?.exhausted && !overtime) row.addComponents(buildPushBtn());
      return row;
    }

    function resultControls() {
      return [new ActionRowBuilder().addComponents(buildNextBtn()), bottomControls()];
    }

    function currentComponents() {
      if (state === "offer") return [offerControls(), bottomControls()];
      if (state === "preview") return [routeControls({ disabled: true }), bottomControls()];
      if (state === "route") return [routeControls(), bottomControls()];
      return resultControls();
    }

    async function buildEmbed(extraFeedback = "") {
      const tick = await tickFatigue(db, guildId, userId);
      lastTick = tick;
      const fb = fatigueBar(tick.fatigueMs || 0);
      const exhaustedLine = tick.exhausted && !overtime
        ? "⚠️ You’ve hit **100% fatigue**. Cash out and recover — or **Push on** if you want to risk a collapse."
        : overtime
          ? "🌙 Overtime: you are driving on fumes now."
          : "";

      const summaryBits = [
        `Served: **${served}/${SHIFT_TARGET}**`,
        `Declined: **${declined}**`,
        `Incidents: **${incidents}**`,
      ].join(" • ");

      let description = "";
      if (state === "offer") {
        description = [
          `${passengerLabel(passenger.type)}`,
          `\n**Passenger Waiting**`,
          `"${passenger.description}"`,
          "",
          `Estimated fare: **${money(passenger.basePayout)}**`,
          `Route length: **${passenger.route.length} turns**`,
        ].join("\n");
      } else if (state === "preview") {
        description = [
          `${passengerLabel(passenger.type)}`,
          "",
          passenger.intro,
          "",
          "**Memorise this route:**",
          routeToText(passenger.route, passenger.route.length),
          "",
          "The full list disappears after the first move.",
        ].join("\n");
      } else if (state === "route") {
        description = [
          `${passengerLabel(passenger.type)}`,
          "",
          `Turn **${stepIndex + 1}/${passenger.route.length}**`,
          `Expected direction is hidden — trust your memory.`,
          "",
          `Progress: ${"▰".repeat(stepIndex)}${"▱".repeat(passenger.route.length - stepIndex)}`,
        ].join("\n");
      } else {
        description = feedback || extraFeedback || "Fare resolved.";
      }

      return new EmbedBuilder()
        .setColor(typeColor(passenger.type))
        .setTitle("🚕 Taxi Driver — Grind")
        .setDescription([exhaustedLine, description, "", summaryBits, extraFeedback && state !== "result" ? extraFeedback : ""].filter(Boolean).join("\n"))
        .addFields(
          { name: "Shift Earned", value: money(earned), inline: true },
          { name: "Tips", value: money(tips), inline: true },
          { name: "Fatigue", value: `${fb.bar} ${fb.pct}%`, inline: false },
        )
        .setFooter({ text: ongoingShiftPenaltyPct > 0 ? `Cab is a mess: fares are reduced by ${ongoingShiftPenaltyPct}% for the rest of this shift.` : `Passenger ${Math.min(shiftIndex, SHIFT_TARGET)} of ${SHIFT_TARGET}` });
    }

    async function showState(extraFeedback = "") {
      await boardMsg.edit({ embeds: [await buildEmbed(extraFeedback)], components: currentComponents() }).catch(() => {});
    }

    async function settlePassenger(text, { fare = 0, tip = 0, incident = false } = {}) {
      const actualFare = Math.max(0, Math.floor(fare));
      const actualTip = Math.max(0, Math.floor(tip));
      earned += actualFare + actualTip;
      tips += actualTip;
      lastFareEarned = actualFare + actualTip;
      if (incident) incidents += 1;
      served += 1;
      state = "result";
      feedback = [text, "", `Fare result: **${money(actualFare)}**`, actualTip > 0 ? `Tip: **${money(actualTip)}**` : ""].filter(Boolean).join("\n");
      await showState();
    }

    async function failPassenger(text, { incident = false, stealPrevious = false, fee = 0 } = {}) {
      let lines = [text];
      if (stealPrevious && lastFareEarned > 0) {
        earned = Math.max(0, earned - lastFareEarned);
        lines.push(`They robbed you of your previous fare: **-${money(lastFareEarned)}**`);
        lastFareEarned = 0;
      }
      if (fee > 0) {
        earned = Math.max(0, earned - fee);
        lines.push(`Cleaning fee: **-${money(fee)}**`);
      }
      if (incident) incidents += 1;
      served += 1;
      state = "result";
      feedback = [lines.join("\n"), "", `Fare result: **${money(0)}**`].join("\n");
      await showState();
    }

    async function resolveSuccessfulRide() {
      let fare = effectiveFare(passenger.basePayout);
      let tip = 0;
      const completeLine = pick(SCENARIOS.completeLines[passenger.type] || SCENARIOS.completeLines.easy);

      if (passenger.type === "easy") {
        return settlePassenger(completeLine, { fare });
      }

      if (passenger.type === "vip") {
        if (chance(0.18)) {
          fare *= 2;
          return settlePassenger(`${completeLine}\n${pick(SCENARIOS.vipEvents.double)}`, { fare });
        }
        if (chance(0.32)) {
          tip = randInt(700, 2200);
          return settlePassenger(`${completeLine}\n${pick(SCENARIOS.vipEvents.tip)}`, { fare, tip });
        }
        if (chance(0.12)) {
          tip = randInt(1800, 3500);
          fare = Math.floor(fare * 1.35);
          return settlePassenger(`${completeLine}\n${pick(SCENARIOS.vipEvents.escape)}`, { fare, tip, incident: true });
        }
        return settlePassenger(completeLine, { fare });
      }

      const roll = Math.random();
      if (roll < 0.30) {
        return settlePassenger(`${completeLine}\n${pick(SCENARIOS.sketchyOutcomes.normal)}`, { fare, incident: false });
      }
      if (roll < 0.48) {
        return failPassenger(pick(SCENARIOS.sketchyOutcomes.noPay), { incident: true });
      }
      if (roll < 0.63) {
        return failPassenger(pick(SCENARIOS.sketchyOutcomes.runAway), { incident: true });
      }
      if (roll < 0.79) {
        const fee = 1500;
        return failPassenger(pick(SCENARIOS.sketchyOutcomes.pukeFee), { incident: true, fee });
      }
      if (roll < 0.90) {
        ongoingShiftPenaltyPct = Math.max(ongoingShiftPenaltyPct, 20);
        return failPassenger(`${pick(SCENARIOS.sketchyOutcomes.reducedShift)}\nAll remaining fares are reduced by **20%**.`, { incident: true });
      }
      return failPassenger(pick(SCENARIOS.sketchyOutcomes.robbery), { incident: true, stealPrevious: true });
    }

    async function advanceToNextPassenger() {
      clearPreviewTimer();
      if (served >= SHIFT_TARGET) {
        return endShift("🚕 Shift complete. You pull over and cash out.");
      }
      shiftIndex = served + 1;
      passenger = nextPassenger();
      state = "offer";
      stepIndex = 0;
      feedback = "";
      await showState();
    }

    function startPreview() {
      clearPreviewTimer();
      state = "preview";
      stepIndex = 0;
    }

    async function endShift(reason, { forceLock = false } = {}) {
      clearPreviewTimer();
      if (earned > 0) {
        await mintUser(db, guildId, userId, earned, "grind_taxi_driver_payout", {
          job: "taxi_driver",
          served,
          declined,
          incidents,
          tips,
          overtime,
          reducedShiftPct: ongoingShiftPenaltyPct,
        }, { activityEffects: ACTIVITY_EFFECTS, awardSource: "grind_taxi_driver" });
        await setJobCooldownSeconds(db, guildId, userId, JOB_COOLDOWN_SECONDS);
      }

      let lockTs = null;
      if (forceLock || (lastTick?.fatigueMs || 0) >= MAX_FATIGUE_MS) {
        const lock = await applyGrindLock(db, guildId, userId);
        lockTs = Math.floor(lock.lockedUntil.getTime() / 1000);
      }

      const emb = new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle("🚕 Taxi Driver — Shift Complete")
        .setDescription([reason, lockTs ? `🥵 Recovery: Grind unlocks <t:${lockTs}:R>.` : ""].filter(Boolean).join("\n"))
        .addFields(
          { name: "Passengers Served", value: String(served), inline: true },
          { name: "Declined", value: String(declined), inline: true },
          { name: "Incidents", value: String(incidents), inline: true },
          { name: "Total Earned", value: money(earned), inline: true },
          { name: "Tips", value: money(tips), inline: true },
          { name: "Shift Penalty", value: ongoingShiftPenaltyPct > 0 ? `${ongoingShiftPenaltyPct}%` : "None", inline: true },
        );

      await boardMsg.edit({ embeds: [emb], components: [] }).catch(() => {});
      collector.stop("done");
      resolveOnce();
    }

    await showState();

    const collector = boardMsg.createMessageComponentCollector({ time: SHIFT_TTL_MS });

    collector.on("collect", async (i) => {
      if (i.user.id !== userId) {
        return i.reply({ content: "❌ This job isn’t for you.", flags: MessageFlags.Ephemeral }).catch(() => {});
      }

      const hardCapMs = Math.floor(MAX_FATIGUE_MS * OVERTIME_HARDCAP_MULT);
      if (overtime && (lastTick?.fatigueMs || 0) >= hardCapMs) {
        await i.deferUpdate().catch(() => {});
        return endShift("💥 You nodded off behind the wheel and the shift ended in a hard burnout.", { forceLock: true });
      }

      if (i.customId === "grind_taxi:end") {
        await i.deferUpdate().catch(() => {});
        return endShift("You parked up and ended the shift early.");
      }

      if (i.customId === "grind_taxi:push") {
        await i.deferUpdate().catch(() => {});
        overtime = true;
        return showState("🌙 You keep driving. The city gets weirder after this point.");
      }

      if (i.customId === "grind_taxi:next") {
        await i.deferUpdate().catch(() => {});
        return advanceToNextPassenger();
      }

      if (i.customId === "grind_taxi:accept") {
        await i.deferUpdate().catch(() => {});
        if (state !== "offer") return;
        clearPreviewTimer();
        state = "route";
        stepIndex = 0;
        return showState();
      }

      if (i.customId === "grind_taxi:decline") {
        await i.deferUpdate().catch(() => {});
        if (state !== "offer") return;
        declined += 1;
        served += 1;
        state = "result";
        feedback = pick(SCENARIOS.declineLines);
        return showState();
      }

      if (i.customId.startsWith("grind_taxi:turn:")) {
        await i.deferUpdate().catch(() => {});
        if (state !== "route") return;

        const chosen = i.customId.split(":")[2];
        const normalized = chosen === "straight" ? "Straight" : chosen === "left" ? "Left" : "Right";
        const expected = passenger.route[stepIndex];

        if (normalized !== expected) {
          return failPassenger(pick(SCENARIOS.wrongTurnLines), { incident: true });
        }

        stepIndex += 1;
        if (stepIndex >= passenger.route.length) {
          return resolveSuccessfulRide();
        }

        return showState();
      }
    });

    collector.on("end", async () => {
      if (_resolved) return;
      await endShift("⏲️ Shift ended (inactivity).", { forceLock: (lastTick?.fatigueMs || 0) >= MAX_FATIGUE_MS });
    });
  });
};

module.exports.activityEffects = ACTIVITY_EFFECTS;
