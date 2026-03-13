// data/work/categories/grind/quarry.js
// Quarry Grind job (Prospecting / Digging)
// - 5 dig sites per round (buttons)
// - Depth increases over time; deeper = better rewards + higher collapse risk
// - Medium pace with a per-dig timer (boss watching)
// - Full collapse ends shift immediately with recovery lock

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
  key: "quarry",
  name: "quarry",
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

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, Number(n)));
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function makeSites() {
  // Each site has hidden quality/stability. quality boosts ore chance; stability reduces collapse.
  const out = [];
  for (let i = 0; i < 5; i++) {
    out.push({
      id: `S${i + 1}`,
      label: `Dig ${i + 1}`,
      quality: Math.random(),
      stability: Math.random(),
      scanned: false,
      hint: "",
    });
  }
  return out;
}

function digTimerSeconds(depth, { overtime = false } = {}) {
  // Medium pace: starts 10s, trends to ~6s as depth rises.
  if (overtime) return 6;
  const base = 10 - Math.floor(depth / 6);
  return clamp(base, 6, 10);
}

function collapseChance({ depth, site, fatiguePct, overtime }) {
  // Depth is the main driver; fatigue and overtime amplify.
  const d = clamp(depth, 0, 40);
  const base = 0.005 + d * 0.003; // 0.5% + 0.3% per depth
  const fatigueMult = fatiguePct >= 120 ? 1.8 : fatiguePct >= 100 ? 1.35 : fatiguePct >= 80 ? 1.15 : 1.0;
  const overtimeMult = overtime ? 1.25 : 1.0;
  const stabilityMult = 1.0 - 0.35 * (Number(site?.stability) || 0); // stable sites reduce risk
  return clamp(base * fatigueMult * overtimeMult * stabilityMult, 0, 0.35);
}

function rollFind({ depth, site }) {
  // Simple reward curve.
  // Always something on success: sand/stone/gravel, then ores, then gems.
  const q = Number(site?.quality) || 0;
  const d = clamp(depth, 0, 40);

  const common = [
    { name: "Sand", value: 70 },
    { name: "Gravel", value: 80 },
    { name: "Stone", value: 95 },
  ];
  const ores = [
    { name: "Iron Ore", value: 160 },
    { name: "Copper Ore", value: 175 },
    { name: "Coal Chunk", value: 150 },
  ];
  const rares = [
    { name: "Silver Vein", value: 380 },
    { name: "Gold Vein", value: 520 },
  ];
  const gems = [
    { name: "Opal Shard", value: 900 },
    { name: "Ruby Fragment", value: 1100 },
  ];

  const oreChance = clamp(0.10 + d * 0.02 + q * 0.12, 0, 0.85);
  const rareChance = clamp(0.01 + Math.max(0, d - 12) * 0.01 + q * 0.06, 0, 0.35);
  const gemChance = clamp(0.002 + Math.max(0, d - 20) * 0.005 + q * 0.03, 0, 0.18);

  const r = Math.random();
  if (r < gemChance) return { tier: "gem", item: pick(gems) };
  if (r < gemChance + rareChance) return { tier: "rare", item: pick(rares) };
  if (r < gemChance + rareChance + oreChance) return { tier: "ore", item: pick(ores) };
  return { tier: "common", item: pick(common) };
}

function tierMult(tier) {
  if (tier === "gem") return 2.0;
  if (tier === "rare") return 1.5;
  if (tier === "ore") return 1.15;
  return 1.0;
}

module.exports = function startQuarry(btn, { pool, boardMsg, guildId, userId } = {}) {
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

    let overtime = false;
    let earned = 0;
    let digs = 0;
    let depth = 0;
    let streak = 0;
    let bestStreak = 0;
    let collapses = 0;
    let lastTick = { fatigueMs: 0, exhausted: false };

    let sites = makeSites();
    let actionExpiresAt = 0;
    let actionTimer = null;

    const endBtn = new ButtonBuilder().setCustomId("grind_q:end").setLabel("End shift").setStyle(ButtonStyle.Danger);
    const pushBtn = new ButtonBuilder().setCustomId("grind_q:push").setLabel("Push on").setStyle(ButtonStyle.Secondary);

    function clearActionTimer() {
      if (actionTimer) clearTimeout(actionTimer);
      actionTimer = null;
    }

    function actionRows(disabled = false) {
      const row = new ActionRowBuilder();
      for (const s of sites) {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`grind_q:dig:${s.id}`)
            .setLabel(s.label)
            .setStyle(ButtonStyle.Primary)
            .setDisabled(disabled)
        );
      }

      const row2 = new ActionRowBuilder().addComponents(endBtn.setDisabled(disabled));
      if (lastTick?.exhausted && !overtime) row2.addComponents(pushBtn.setDisabled(disabled));
      return [row, row2];
    }

    async function buildEmbed(feedback = "") {
      const tick = await tickFatigue(db, guildId, userId);
      lastTick = tick;
      const fb = fatigueBar(tick.fatigueMs || 0);
      const fatiguePct = fb.pct;

      const exhaustedLine = tick.exhausted && !overtime
        ? "⚠️ You’ve hit **100% fatigue**. End your shift to recover — or **Push on** at your own risk."
        : overtime
          ? "🧨 Overtime: cave feels unstable."
          : "";

      const sec = digTimerSeconds(depth, { overtime });
      const remaining = Math.max(0, Math.ceil((actionExpiresAt - Date.now()) / 1000));

      const hints = sites
        .filter((s) => s.scanned)
        .map((s) => `• ${s.label}: ${s.hint}`)
        .slice(0, 5);

      const desc = [
        "Prospecting: choose where to dig. Deeper gets better… and riskier.",
        `\n⛏️ Depth: **${depth}**`,
        `⏱️ Boss timer: **${remaining}s** (base ${sec}s)`,
        exhaustedLine,
        feedback,
        hints.length ? `\n🧭 Surface notes:\n${hints.join("\n")}` : "",
      ].filter(Boolean).join("\n");

      const emb = new EmbedBuilder()
        .setTitle("🪨 Quarry — Grind")
        .setDescription(desc)
        .addFields(
          { name: "Streak", value: String(streak), inline: true },
          { name: "Earned (shift)", value: money(finalEarned), inline: true },
          { name: "Digs", value: String(digs), inline: true },
          { name: "Fatigue", value: `${fb.bar} ${fb.pct}%`, inline: false }
        );

      // Discord requires footer text to be a non-empty string.
      if (fatiguePct >= 100) {
        emb.setFooter({ text: "One bad move could collapse the wall." });
      }

      return emb;
    }

    async function scheduleTimeout() {
      clearActionTimer();
      const sec = digTimerSeconds(depth, { overtime });
      actionExpiresAt = Date.now() + sec * 1000;
      actionTimer = setTimeout(async () => {
        // Timeout -> boss yells, streak resets, depth still creeps a bit.
        streak = 0;
        depth += 1;
        sites = makeSites();
        await boardMsg.edit({ embeds: [await buildEmbed("⏳ Too slow — boss is watching.")], components: actionRows(false) }).catch(() => {});
        await scheduleTimeout();
      }, sec * 1000);
    }

    async function endShift(reason, { forceLock = false } = {}) {
      clearActionTimer();
      let finalEarned = earned;
      if (earned > 0) {
        const payout = await mintUser(db, guildId, userId, earned, "grind_quarry_payout", {
          job: "quarry",
          digs,
          depth,
          bestStreak,
          collapses,
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

      const emb = new EmbedBuilder()
        .setTitle("🪨 Quarry — Shift Complete")
        .setDescription([reason, lockTs ? `🥵 Recovery: Grind unlocks <t:${lockTs}:R>.` : ""].filter(Boolean).join("\n"))
        .addFields(
          { name: "Total earned", value: money(finalEarned), inline: true },
          { name: "Depth reached", value: String(depth), inline: true },
          { name: "Best streak", value: String(bestStreak), inline: true },
          { name: "Collapses", value: String(collapses), inline: true }
        );

      await boardMsg.edit({ embeds: [emb], components: [] }).catch(() => {});
      collector.stop("done");
      resolveOnce();
    }

    // Initial render
    await boardMsg.edit({ embeds: [await buildEmbed()], components: actionRows(false) }).catch(() => {});

    const collector = boardMsg.createMessageComponentCollector({ time: SHIFT_TTL_MS });
    await scheduleTimeout();

    collector.on("collect", async (i) => {
      if (i.user.id !== userId) {
        return i.reply({ content: "❌ This job isn’t for you.", flags: MessageFlags.Ephemeral }).catch(() => {});
      }

      if (i.customId === "grind_q:end") {
        await i.deferUpdate().catch(() => {});
        return endShift("You stepped away from the pit.");
      }

      if (i.customId === "grind_q:push") {
        await i.deferUpdate().catch(() => {});
        overtime = true;
        await boardMsg.edit({ embeds: [await buildEmbed("🧨 Overtime: keep your head on a swivel.")], components: actionRows(false) }).catch(() => {});
        return;
      }

      if (!i.customId.startsWith("grind_q:dig:")) {
        await i.deferUpdate().catch(() => {});
        return;
      }

      await i.deferUpdate().catch(() => {});
      clearActionTimer();
      let finalEarned = earned;

      // Enforce timeout even if clicked late
      if (Date.now() > actionExpiresAt) {
        streak = 0;
        depth += 1;
        sites = makeSites();
        await boardMsg.edit({ embeds: [await buildEmbed("⏳ Too slow — boss is watching.")], components: actionRows(false) }).catch(() => {});
        await scheduleTimeout();
        return;
      }

      const id = i.customId.split(":").pop();
      const site = sites.find((s) => s.id === id) || sites[0];

      // Roll collapse before reward
      const fb = fatigueBar(lastTick?.fatigueMs || 0);
      const cChance = collapseChance({ depth, site, fatiguePct: fb.pct, overtime });
      const hardCapMs = Math.floor(MAX_FATIGUE_MS * OVERTIME_HARDCAP_MULT);
      if (overtime && (lastTick?.fatigueMs || 0) >= hardCapMs) {
        collapses += 1;
        return endShift("💥 You collapsed from exhaustion.", { forceLock: true });
      }

      if (Math.random() < cChance) {
        collapses += 1;
        return endShift("💥 **CAVE-IN!** The wall collapsed. You’re forced into recovery.", { forceLock: true });
      }

      // Successful dig always pays something
      const found = rollFind({ depth, site });
      const mult = tierMult(found.tier) * (1 + Math.min(0.35, streak * 0.03)) * (overtime ? 1.15 : 1.0);
      const payout = Math.max(0, Math.floor(found.item.value * mult));
      earned += payout;
      digs += 1;
      depth += 1;
      streak += 1;
      bestStreak = Math.max(bestStreak, streak);

      // Update hints for the site (prospecting feel)
      site.scanned = true;
      if (site.quality > 0.75) site.hint = "✨ Promising shimmer";
      else if (site.quality > 0.55) site.hint = "🪨 Dense rock";
      else if (site.quality > 0.35) site.hint = "⛏️ Mixed gravel";
      else site.hint = "🏜️ Mostly sand";

      // New sites every few depths to keep it fresh
      if (depth % 4 === 0) sites = makeSites();

      const msg = `✅ Found **${found.item.name}** (+${money(payout)})`;
      await boardMsg.edit({ embeds: [await buildEmbed(msg)], components: actionRows(false) }).catch(() => {});
      await scheduleTimeout();
    });

    collector.on("end", async () => {
      if (_resolved) return;
      await endShift("⏲️ Shift ended (inactivity).", { forceLock: (lastTick?.fatigueMs || 0) >= MAX_FATIGUE_MS });
    });
  });
};
