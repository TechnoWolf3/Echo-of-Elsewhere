// data/work/categories/grind/warehousing.js
// Warehousing Grind job: random role (Picker & Packer / Forklift Operator)
// - Session-based earnings (minted)
// - Per-order timer (enforced via setTimeout)
// - Streak multiplier per order
// - Optional overtime at 100% fatigue

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require("discord.js");

const { canGrind, tickFatigue, fatigueBar, MAX_FATIGUE_MS, applyGrindLock } = require("../../../../utils/grindFatigue");
const { money, mintUser, setJobCooldownSeconds } = require("./_shared");

const ACTIVITY_EFFECTS = {
  key: "warehousing",
  name: "warehousing",
  effectsApply: true,
  canAwardEffects: true,
  blockedBlessings: [],
  blockedCurses: [],
  effectAwardPool: { nothingWeight: 100, blessingWeight: 0, curseWeight: 0, weightOverrides: {} },
};

const JOB_COOLDOWN_SECONDS = 45;
const SHIFT_TTL_MS = 5 * 60_000;
const OVERTIME_HARDCAP_MULT = 1.5;

function randInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function streakMultiplier(streak, { overtime = false } = {}) {
  if (overtime) return 1.6;
  if (streak >= 16) return 1.45;
  if (streak >= 11) return 1.3;
  if (streak >= 6) return 1.15;
  return 1.0;
}

function timerSecondsFor(streak, { overtime = false } = {}) {
  if (overtime) return randInt(3, 4);
  if (streak >= 11) return 6;
  if (streak >= 6) return 8;
  return 10;
}

function genShelfCode() {
  const letter = pick(["A", "B", "C", "D", "E", "F"]);
  const num = randInt(1, 24);
  return `${letter}-${String(num).padStart(2, "0")}`;
}

function genPickerOrder(streak) {
  const items = ["Protein Bars", "Soft Drinks", "Energy Drinks", "Cereal", "Dog Food", "Coffee", "Donuts", "Batteries", "Toilet Paper", "Painkillers"];
  const item = pick(items);
  const correct = genShelfCode();
  const multi = streak >= 11 && Math.random() < 0.35;
  const qty = multi ? randInt(1, 3) : randInt(1, 2);

  const distractors = new Set();
  while (distractors.size < (streak >= 6 ? 5 : 3)) {
    const c = genShelfCode();
    if (c !== correct) distractors.add(c);
  }
  const options = [correct, ...Array.from(distractors)].sort(() => Math.random() - 0.5);
  return { kind: "picker", item, qty, correct, options, basePay: 120 + randInt(0, 40) };
}

function genForkliftOrder(streak) {
  const weight = pick(["Light", "Medium", "Heavy"]);
  const fragile = Math.random() < (streak >= 6 ? 0.5 : 0.35);
  const cold = streak >= 11 ? Math.random() < 0.35 : Math.random() < 0.15;

  const zones = [];
  if (weight === "Heavy" && fragile && cold) zones.push({ id: "Z_HFC", label: "Zone C — Heavy + Fragile + Cold" });
  if (weight === "Heavy" && fragile) zones.push({ id: "Z_HF", label: "Zone B — Heavy + Fragile" });
  if (weight === "Heavy" && cold) zones.push({ id: "Z_HC", label: "Zone D — Heavy + Cold" });
  if (fragile && cold) zones.push({ id: "Z_FC", label: "Zone F — Fragile + Cold" });
  if (fragile) zones.push({ id: "Z_F", label: "Zone A — Fragile Storage" });
  if (cold) zones.push({ id: "Z_C", label: "Zone E — Cold Storage" });
  if (weight === "Heavy") zones.push({ id: "Z_H", label: "Zone G — Heavy Rack" });
  zones.push({ id: "Z_G", label: "Zone H — General Storage" });

  // Choose the most specific match as correct
  let correct = null;
  for (const z of zones) {
    if (z.id === "Z_HFC") correct = z;
  }
  if (!correct && weight === "Heavy" && fragile) correct = zones.find((z) => z.id === "Z_HF");
  if (!correct && weight === "Heavy" && cold) correct = zones.find((z) => z.id === "Z_HC");
  if (!correct && fragile && cold) correct = zones.find((z) => z.id === "Z_FC");
  if (!correct && fragile) correct = zones.find((z) => z.id === "Z_F");
  if (!correct && cold) correct = zones.find((z) => z.id === "Z_C");
  if (!correct && weight === "Heavy") correct = zones.find((z) => z.id === "Z_H");
  if (!correct) correct = zones.find((z) => z.id === "Z_G") || zones[0];

  // Options: pick 4-7 zones depending on streak
  const pool = zones.map((z) => z.label);
  const want = streak >= 11 ? 8 : streak >= 6 ? 6 : 4;
  const opts = Array.from(new Set([correct.label, ...pool])).sort(() => Math.random() - 0.5).slice(0, want);
  if (!opts.includes(correct.label)) opts[0] = correct.label;
  return {
    kind: "forklift",
    weight,
    fragile,
    cold,
    correct: correct.label,
    options: opts,
    basePay: 170 + randInt(0, 60),
  };
}

function maybeRareEvent() {
  const r = Math.random();
  if (r < 0.08) return { id: "rush", label: "🚨 Rush Hour", orders: 3, payMult: 2.0, timerDelta: -2 };
  if (r < 0.12) return { id: "vip", label: "⭐ VIP Express", orders: 1, payMult: 2.5, timerDelta: -1 };
  if (r < 0.16) return { id: "supervisor", label: "👀 Supervisor Watching", orders: 2, payMult: 1.25, timerDelta: 0, failEnds: true };
  return null;
}

module.exports = function startWarehousing(btn, { pool, boardMsg, guildId, userId } = {}) {
  return new Promise(async (resolve) => {
    let _resolved = false;
    const resolveOnce = () => { if (_resolved) return; _resolved = true; resolve(); };

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

    const role = Math.random() < 0.5 ? "picker" : "forklift";
    const roleName = role === "picker" ? "📦 Picker & Packer" : "🚜 Forklift Operator";

    let overtime = false;
    let earned = 0;
    let orders = 0;
    let streak = 0;
    let bestStreak = 0;
    let rareEvents = 0;
    let activeEvent = null;
    let eventOrdersLeft = 0;
    let lastTick = { fatigueMs: 0, exhausted: false };

    let current = role === "picker" ? genPickerOrder(streak) : genForkliftOrder(streak);
    let orderExpiresAt = 0;
    let orderTimer = null;

    const endBtn = new ButtonBuilder().setCustomId("grind_wh:end").setLabel("End shift").setStyle(ButtonStyle.Danger);
    const pushBtn = new ButtonBuilder().setCustomId("grind_wh:push").setLabel("Push on").setStyle(ButtonStyle.Secondary);

    function makeOptionRows(disabled = false) {
      const rows = [];
      const opts = current.options;
      const maxPerRow = 5;
      for (let i = 0; i < opts.length; i += maxPerRow) {
        const row = new ActionRowBuilder();
        for (const opt of opts.slice(i, i + maxPerRow)) {
          row.addComponents(
            new ButtonBuilder()
              .setCustomId(`grind_wh:pick:${opt}`)
              .setLabel(opt)
              .setStyle(ButtonStyle.Primary)
              .setDisabled(disabled)
          );
        }
        rows.push(row);
      }
      const control = new ActionRowBuilder().addComponents(endBtn.setDisabled(disabled));
      if (lastTick?.exhausted && !overtime) control.addComponents(pushBtn.setDisabled(disabled));
      rows.push(control);
      return rows;
    }

    function summaryEmbed(reason, lockTs = null, finalEarned = earned) {
      const emb = new EmbedBuilder()
        .setTitle(`${roleName} — Shift Complete`)
        .setDescription([reason, lockTs ? `🥵 Recovery: Grind unlocks <t:${lockTs}:R>.` : ""].filter(Boolean).join("\n"))
        .addFields(
          { name: "Orders completed", value: String(orders), inline: true },
          { name: "Best streak", value: String(bestStreak), inline: true },
          { name: "Rare events", value: String(rareEvents), inline: true },
          { name: "Total earned", value: money(finalEarned), inline: true }
        );
      return emb;
    }

    async function buildEmbed(feedback = "") {
      const tick = await tickFatigue(db, guildId, userId);
      lastTick = tick;

      const fb = fatigueBar(tick.fatigueMs || 0);
      const hardCapMs = Math.floor(MAX_FATIGUE_MS * OVERTIME_HARDCAP_MULT);

      const exhaustedLine = tick.exhausted && !overtime
        ? "⚠️ You’ve hit **100% fatigue**. End your shift to recover — or **Push on** at your own risk."
        : overtime
          ? "🔥 Overtime active. Mistakes hurt more."
          : "";

      const timerSecBase = timerSecondsFor(streak, { overtime });
      const timerSec = Math.max(2, timerSecBase + (activeEvent?.timerDelta || 0));
      const remaining = Math.max(0, Math.ceil((orderExpiresAt - Date.now()) / 1000));

      const eventLine = activeEvent ? `${activeEvent.label} — **${eventOrdersLeft}** order(s) left` : "";

      let body = "";
      if (current.kind === "picker") {
        body = `Order: **${current.item}**\nQty: **${current.qty}**\nFind: **${current.correct}**`;
      } else {
        const bits = [
          `Weight: **${current.weight}**`,
          `Fragile: **${current.fragile ? "Yes" : "No"}**`,
          `Cold: **${current.cold ? "Yes" : "No"}**`,
        ];
        body = `Incoming Pallet\n${bits.join("\n")}`;
      }

      const mult = streakMultiplier(streak, { overtime });
      const eventMult = activeEvent?.payMult || 1;
      const shownMult = (mult * eventMult).toFixed(2);

      const emb = new EmbedBuilder()
        .setTitle(`${roleName} — Grind`)
        .setDescription([
          eventLine,
          body,
          `\n⏱️ Time remaining: **${remaining}s** (base ${timerSec}s)`,
          exhaustedLine,
          feedback,
        ].filter(Boolean).join("\n"))
        .addFields(
          { name: "Streak", value: String(streak), inline: true },
          { name: "Multiplier", value: `${shownMult}x`, inline: true },
          { name: "Earned (shift)", value: money(finalEarned), inline: true },
          { name: "Fatigue", value: `${fb.bar} ${fb.pct}%`, inline: false }
        );

      if (overtime && (tick.fatigueMs || 0) >= hardCapMs) {
        emb.setFooter({ text: "You’re about to collapse…" });
      }

      return { emb, timerSec };
    }

    function clearOrderTimer() {
      if (orderTimer) clearTimeout(orderTimer);
      orderTimer = null;
    }

    async function scheduleOrderTimeout() {
      clearOrderTimer();
      const { timerSec } = await buildEmbed();
      orderExpiresAt = Date.now() + timerSec * 1000;
      orderTimer = setTimeout(async () => {
        // Timeout penalty
        streak = 0;
        current = role === "picker" ? genPickerOrder(streak) : genForkliftOrder(streak);

        // Event ticking
        if (activeEvent) {
          eventOrdersLeft -= 1;
          if (eventOrdersLeft <= 0) activeEvent = null;
        }

        // Next event chance
        if (!activeEvent) {
          const ev = maybeRareEvent();
          if (ev) {
            activeEvent = ev;
            eventOrdersLeft = ev.orders;
            rareEvents += 1;
          }
        }

        const { emb: e2, timerSec: t2 } = await buildEmbed("⏳ Order timed out — truck’s waiting.");
        orderExpiresAt = Date.now() + t2 * 1000;
        await boardMsg.edit({ embeds: [e2], components: makeOptionRows(false) }).catch(() => {});
        await scheduleOrderTimeout();
      }, timerSec * 1000);
    }

    async function endShift(reason, { forceLock = false } = {}) {
      clearOrderTimer();
      let finalEarned = earned;
      if (earned > 0) {
        const payout = await mintUser(db, guildId, userId, earned, "grind_warehousing_payout", {
          job: "warehousing",
          role,
          orders,
          bestStreak,
          rareEvents,
          overtime,
        }, ACTIVITY_EFFECTS);
        finalEarned = Number(payout?.finalAmount ?? earned);
        await setJobCooldownSeconds(db, guildId, userId, JOB_COOLDOWN_SECONDS);
      }

      let lockTs = null;
      if (forceLock || (lastTick?.fatigueMs || 0) >= MAX_FATIGUE_MS) {
        const lock = await applyGrindLock(db, guildId, userId);
        lockTs = Math.floor(lock.lockedUntil.getTime() / 1000);
      }

      await boardMsg.edit({ embeds: [summaryEmbed(reason, lockTs, finalEarned)], components: [] }).catch(() => {});
      collector.stop("done");
      resolveOnce();
    }

    // Initial render
    const first = await buildEmbed();
    orderExpiresAt = Date.now() + first.timerSec * 1000;
    await boardMsg.edit({ embeds: [first.emb], components: makeOptionRows(false) }).catch(() => {});

    const collector = boardMsg.createMessageComponentCollector({ time: SHIFT_TTL_MS });

    await scheduleOrderTimeout();

    collector.on("collect", async (i) => {
      if (i.user.id !== userId) {
        return i.reply({ content: "❌ This job isn’t for you.", flags: MessageFlags.Ephemeral }).catch(() => {});
      }

      if (i.customId === "grind_wh:end") {
        await i.deferUpdate().catch(() => {});
        return endShift("You clocked off. Nice work.");
      }

      if (i.customId === "grind_wh:push") {
        await i.deferUpdate().catch(() => {});
        overtime = true;
        const { emb } = await buildEmbed("🔥 Overtime approved. Keep moving.");
        await boardMsg.edit({ embeds: [emb], components: makeOptionRows(false) }).catch(() => {});
        return;
      }

      if (!i.customId.startsWith("grind_wh:pick:")) {
        await i.deferUpdate().catch(() => {});
        return;
      }

      await i.deferUpdate().catch(() => {});
      clearOrderTimer();
      let finalEarned = earned;

      // Enforce timeout even if button clicked late
      if (Date.now() > orderExpiresAt) {
        streak = 0;
        current = role === "picker" ? genPickerOrder(streak) : genForkliftOrder(streak);
        const { emb: e2 } = await buildEmbed("⏳ Too slow — order expired.");
        await boardMsg.edit({ embeds: [e2], components: makeOptionRows(false) }).catch(() => {});
        await scheduleOrderTimeout();
        return;
      }

      const chosen = decodeURIComponent(i.customId.split(":").slice(2).join(":"));
      const correct = current.correct;
      const isCorrect = chosen === correct;

      if (!isCorrect) {
        streak = 0;
        if (activeEvent?.failEnds && overtime) {
          return endShift("👀 The supervisor saw that mistake in overtime. Shift ended.", { forceLock: true });
        }
      } else {
        streak += 1;
        bestStreak = Math.max(bestStreak, streak);
        orders += 1;
        const mult = streakMultiplier(streak, { overtime });
        const eventMult = activeEvent?.payMult || 1;
        const payout = Math.max(0, Math.floor(current.basePay * mult * eventMult));
        earned += payout;
      }

      // Event ticking
      if (activeEvent) {
        eventOrdersLeft -= 1;
        if (eventOrdersLeft <= 0) activeEvent = null;
      }

      // Next event chance
      if (!activeEvent) {
        const ev = maybeRareEvent();
        if (ev) {
          activeEvent = ev;
          eventOrdersLeft = ev.orders;
          rareEvents += 1;
        }
      }

      // Fatigue hard-cap injury in overtime
      const tickNow = await tickFatigue(db, guildId, userId);
      lastTick = tickNow;
      const hardCapMs = Math.floor(MAX_FATIGUE_MS * OVERTIME_HARDCAP_MULT);
      if (overtime && (tickNow.fatigueMs || 0) >= hardCapMs) {
        return endShift("💥 You collapsed from exhaustion.", { forceLock: true });
      }

      // Next order
      current = role === "picker" ? genPickerOrder(streak) : genForkliftOrder(streak);

      const feedback = isCorrect ? "✅ Correct." : "❌ Wrong bay.";
      const { emb: e3, timerSec } = await buildEmbed(feedback);
      orderExpiresAt = Date.now() + timerSec * 1000;
      await boardMsg.edit({ embeds: [e3], components: makeOptionRows(false) }).catch(() => {});
      await scheduleOrderTimeout();
    });

    collector.on("end", async () => {
      clearOrderTimer();
      let finalEarned = earned;
      if (_resolved) return;
      await endShift("⏲️ Shift ended (inactivity).", { forceLock: (lastTick?.fatigueMs || 0) >= MAX_FATIGUE_MS });
    });
  });
};
