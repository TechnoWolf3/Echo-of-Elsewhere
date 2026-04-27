// data/work/categories/grind/fishing.js
// Calm Grind job with rare spikes + ultra events.
// - Cast -> Bite -> 3s Tug
// - Commons/Junk: visual tension bar only
// - Rare/Legendary: small interactive tension phase
// - Ultra events: optional announcement in Playground (env PLAYGROUND_CHANNEL_ID)

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require("discord.js");

const { canGrind, tickFatigue, fatigueBar, MAX_FATIGUE_MS, applyGrindLock } = require("../../../../utils/grindFatigue");
const { money, mintUser, setJobCooldownSeconds, postUltraToPlayground, ultraEmbed } = require("./_shared");
const { renderProgressBar } = require("../../../../utils/progressBar");

const JOB_COOLDOWN_SECONDS = 45;
const SHIFT_TTL_MS = 5 * 60_000;
const OVERTIME_HARDCAP_MULT = 1.5;

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

// Data-driven-ish list. Add/edit fish here.
// weight = roll chance, value = base payout.
const DEFAULT_TABLE = {
  junk: [
    { name: "Old Boot", weight: 22, value: 360 },
    { name: "Rusty Can", weight: 18, value: 315 },
    { name: "Tangled Line", weight: 12, value: 225 },
    { name: "Seaweed Clump", weight: 16, value: 270 },
  ],
  common: [
    { name: "Bream", weight: 26, value: 1080 },
    { name: "Whiting", weight: 24, value: 990 },
    { name: "Flathead", weight: 20, value: 1215 },
    { name: "Mackerel", weight: 14, value: 1350 },
  ],
  rare: [
    { name: "Golden Snapper", weight: 9, value: 4680 },
    { name: "Tiger Trout", weight: 7, value: 5400 },
    { name: "Moon Koi", weight: 5, value: 6750 },
  ],
  legendary: [
    { name: "Mythic Marlin", weight: 2, value: 21600 },
    { name: "Abyss Pike", weight: 2, value: 23400 },
  ],
};

function pickWeighted(items) {
  const total = items.reduce((a, b) => a + (Number(b.weight) || 0), 0);
  let r = Math.random() * total;
  for (const it of items) {
    r -= Number(it.weight) || 0;
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

function rollCatch({ overtime = false } = {}) {
  // Base tier selection: junk/common heavy; rare/legendary light.
  // Overtime slightly boosts rare/legendary.
  const tierRoll = Math.random();
  const rareBoost = overtime ? 0.03 : 0;
  const legBoost = overtime ? 0.01 : 0;

  if (tierRoll < 0.18) return { tier: "junk", item: pickWeighted(DEFAULT_TABLE.junk) };
  if (tierRoll < 0.18 + 0.74) return { tier: "common", item: pickWeighted(DEFAULT_TABLE.common) };
  if (tierRoll < 0.18 + 0.74 + (0.07 + rareBoost)) return { tier: "rare", item: pickWeighted(DEFAULT_TABLE.rare) };
  if (tierRoll < 0.18 + 0.74 + (0.07 + rareBoost) + (0.01 + legBoost)) return { tier: "legendary", item: pickWeighted(DEFAULT_TABLE.legendary) };
  return { tier: "common", item: pickWeighted(DEFAULT_TABLE.common) };
}

function tensionBar(pct, length = 16) {
  const p = clamp(pct, 0, 100);
  return renderProgressBar(p, 100, { length });
}

module.exports = function startFishing(btn, { pool, boardMsg, guildId, userId } = {}) {
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
    let casts = 0;
    let streak = 0;
    let bestStreak = 0;
    let rares = 0;
    let legends = 0;
    let ultras = 0;
    let lastTick = { fatigueMs: 0, exhausted: false };

    // state: idle -> waiting_bite -> tug_window -> tension -> brace -> resolve
    let state = "idle";
    let biteTimer = null;
    let tugTimer = null;
    let tension = 0;
    let tensionStepsNeeded = 0;
    let tensionStepsDone = 0;
    let catchInfo = null;

    const castBtn = new ButtonBuilder().setCustomId("grind_fish:cast").setLabel("Cast Line").setStyle(ButtonStyle.Primary);
    const tugBtn = new ButtonBuilder().setCustomId("grind_fish:tug").setLabel("🎣 Tug Rod").setStyle(ButtonStyle.Success);
    const reelBtn = new ButtonBuilder().setCustomId("grind_fish:reel").setLabel("⬆️ Reel Harder").setStyle(ButtonStyle.Primary);
    const easeBtn = new ButtonBuilder().setCustomId("grind_fish:ease").setLabel("⬇️ Ease Line").setStyle(ButtonStyle.Secondary);
    const braceBtn = new ButtonBuilder().setCustomId("grind_fish:brace").setLabel("💥 Brace!").setStyle(ButtonStyle.Danger);
    const endBtn = new ButtonBuilder().setCustomId("grind_fish:end").setLabel("End shift").setStyle(ButtonStyle.Danger);
    const pushBtn = new ButtonBuilder().setCustomId("grind_fish:push").setLabel("Push on").setStyle(ButtonStyle.Secondary);

    function clearTimers() {
      if (biteTimer) clearTimeout(biteTimer);
      if (tugTimer) clearTimeout(tugTimer);
      biteTimer = null;
      tugTimer = null;
    }

    function controlsRow() {
      // NOTE: ButtonBuilders are mutable. We must explicitly reset disabled state
      // when switching states (otherwise the Cast button can stay greyed out).
      castBtn.setDisabled(false);
      tugBtn.setDisabled(false);
      reelBtn.setDisabled(false);
      easeBtn.setDisabled(false);
      braceBtn.setDisabled(false);

      const row = new ActionRowBuilder();

      if (state === "idle") {
        row.addComponents(castBtn.setDisabled(false));
      } else if (state === "waiting_bite") {
        row.addComponents(castBtn.setDisabled(true));
      } else if (state === "tug_window") {
        row.addComponents(tugBtn);
      } else if (state === "tension") {
        row.addComponents(reelBtn, easeBtn);
      } else if (state === "brace") {
        row.addComponents(braceBtn);
      }

      // Always show end (+ push at 100%)
      const row2 = new ActionRowBuilder().addComponents(endBtn);
      if (lastTick?.exhausted && !overtime) row2.addComponents(pushBtn);
      return [row, row2];
    }

    async function buildEmbed(feedback = "") {
      const tick = await tickFatigue(db, guildId, userId);
      lastTick = tick;

      const fb = fatigueBar(tick.fatigueMs || 0);
      const exhaustedLine = tick.exhausted && !overtime
        ? "⚠️ You’ve hit **100% fatigue**. End your shift to recover — or **Push on** at your own risk."
        : overtime
          ? "🌙 Overtime: rarer bites… riskier mistakes."
          : "";

      const lines = [];
      if (state === "idle") lines.push("Cast your line and wait for a bite.");
      if (state === "waiting_bite") lines.push("…waiting…");
      if (state === "tug_window") lines.push("🐟 **BITE!** Tug the rod!");
      if (state === "tension") {
        lines.push(`Line Tension: ${tensionBar(tension)} **${Math.round(tension)}%**`);
        lines.push(`Stabilise: **${tensionStepsDone}/${tensionStepsNeeded}**`);
      }
      if (state === "brace") lines.push("🌊 The catch thrashes — **BRACE!**");

      return new EmbedBuilder()
        .setTitle("🎣 Fishing — Grind")
        .setDescription([exhaustedLine, ...lines, feedback].filter(Boolean).join("\n"))
        .addFields(
          { name: "Streak", value: String(streak), inline: true },
          { name: "Earned (shift)", value: money(earned), inline: true },
          { name: "Casts", value: String(casts), inline: true },
          { name: "Fatigue", value: `${fb.bar} ${fb.pct}%`, inline: false }
        );
    }

    async function endShift(reason, { forceLock = false } = {}) {
      clearTimers();
      if (earned > 0) {
        await mintUser(db, guildId, userId, earned, "grind_fishing_payout", {
          job: "fishing",
          casts,
          bestStreak,
          rares,
          legends,
          ultras,
          overtime,
        }, { activityEffects: ACTIVITY_EFFECTS, awardSource: "grind_fishing" });
        await setJobCooldownSeconds(db, guildId, userId, JOB_COOLDOWN_SECONDS, "job:grind:fishing");
      }

      let lockTs = null;
      if (forceLock || (lastTick?.fatigueMs || 0) >= MAX_FATIGUE_MS) {
        const lock = await applyGrindLock(db, guildId, userId);
        lockTs = Math.floor(lock.lockedUntil.getTime() / 1000);
      }

      const emb = new EmbedBuilder()
        .setTitle("🎣 Fishing — Shift Complete")
        .setDescription([reason, lockTs ? `🥵 Recovery: Grind unlocks <t:${lockTs}:R>.` : ""].filter(Boolean).join("\n"))
        .addFields(
          { name: "Total earned", value: money(earned), inline: true },
          { name: "Best streak", value: String(bestStreak), inline: true },
          { name: "Rare / Legendary", value: `${rares} / ${legends}`, inline: true },
          { name: "Ultra events", value: String(ultras), inline: true }
        );

      await boardMsg.edit({ embeds: [emb], components: [] }).catch(() => {});
      collector.stop("done");
      resolveOnce();
    }

    function startBiteCycle() {
      clearTimers();
      state = "waiting_bite";
      const wait = randInt(2000, 6000);
      biteTimer = setTimeout(async () => {
        state = "tug_window";
        const windowMs = overtime ? 2000 : 3000;
        await boardMsg.edit({ embeds: [await buildEmbed()], components: controlsRow() }).catch(() => {});
        tugTimer = setTimeout(async () => {
          // Missed bite
          streak = 0;
          state = "idle";
          await boardMsg.edit({ embeds: [await buildEmbed("😴 You missed the bite.")], components: controlsRow() }).catch(() => {});
        }, windowMs);
      }, wait);
    }

    async function resolveCatch() {
      // Determine tier + item
      const rolled = rollCatch({ overtime });
      catchInfo = rolled;

      // Visual tension bar for non-rare
      tension = randInt(10, 90);
      const base = rolled.item.value;

      // Ultra chance (legendary only, extremely rare)
      const ultra = rolled.tier === "legendary" && Math.random() < 0.05;

      if (rolled.tier === "rare" || rolled.tier === "legendary") {
        state = "tension";
        tensionStepsDone = 0;
        tensionStepsNeeded = rolled.tier === "legendary" ? 3 : 2;
        // Start around mid
        tension = randInt(35, 65);
        await boardMsg.edit({ embeds: [await buildEmbed(`🎯 Hooked a **${rolled.tier.toUpperCase()}** catch: **${rolled.item.name}**`)], components: controlsRow() }).catch(() => {});
        catchInfo.ultra = ultra;
        catchInfo.base = base;
        return;
      }

      // Common/junk: auto success, show fun bar
      const mult = 1 + Math.min(0.25, streak * 0.02);
      const payout = Math.floor(base * mult);
      earned += payout;
      streak += 1;
      bestStreak = Math.max(bestStreak, streak);
      casts += 1;

      const tierLabel = rolled.tier === "junk" ? "Junk" : "Common";
      const msg = `${tierLabel} catch: **${rolled.item.name}**\nLine Tension: ${tensionBar(tension)} **${Math.round(tension)}%**\n+${money(payout)}`;
      state = "idle";
      await boardMsg.edit({ embeds: [await buildEmbed(msg)], components: controlsRow() }).catch(() => {});
    }

    async function finishRareOrLegendary(success) {
      const tier = catchInfo?.tier;
      const name = catchInfo?.item?.name;
      const base = Number(catchInfo?.base || catchInfo?.item?.value || 0);
      const ultra = !!catchInfo?.ultra;

      if (!success) {
        streak = 0;
        state = "idle";
        await boardMsg.edit({ embeds: [await buildEmbed(`💨 The **${name}** got away.`)], components: controlsRow() }).catch(() => {});
        return;
      }

      // If legendary, add brace step
      if (tier === "legendary") {
        state = "brace";
        await boardMsg.edit({ embeds: [await buildEmbed(`👑 **Legendary!** ${name} — don’t lose it now…`)], components: controlsRow() }).catch(() => {});
        // 2s brace window
        clearTimers();
        tugTimer = setTimeout(async () => {
          // Downgrade to rare payout
          state = "idle";
          legends += 1;
          const payout = Math.floor(base * 0.7);
          earned += payout;
          streak += 1;
          bestStreak = Math.max(bestStreak, streak);
          casts += 1;
          await boardMsg.edit({ embeds: [await buildEmbed(`😬 You slipped… still landed it, barely.\n**${name}** (reduced) +${money(payout)}`)], components: controlsRow() }).catch(() => {});
        }, 2000);
        return;
      }

      // Rare success
      rares += 1;
      const mult = 1.2 + Math.min(0.35, streak * 0.02);
      const payout = Math.floor(base * mult);
      earned += payout;
      streak += 1;
      bestStreak = Math.max(bestStreak, streak);
      casts += 1;
      state = "idle";

      await boardMsg.edit({ embeds: [await buildEmbed(`✨ Rare catch: **${name}**\n+${money(payout)}`)], components: controlsRow() }).catch(() => {});
    }

    // Initial render
    await boardMsg.edit({ embeds: [await buildEmbed()], components: controlsRow() }).catch(() => {});

    const collector = boardMsg.createMessageComponentCollector({ time: SHIFT_TTL_MS });

    collector.on("collect", async (i) => {
      if (i.user.id !== userId) {
        return i.reply({ content: "❌ This job isn’t for you.", flags: MessageFlags.Ephemeral }).catch(() => {});
      }

      // Fatigue hard cap collapse in overtime
      const hardCapMs = Math.floor(MAX_FATIGUE_MS * OVERTIME_HARDCAP_MULT);
      if (overtime && (lastTick?.fatigueMs || 0) >= hardCapMs) {
        await i.deferUpdate().catch(() => {});
        return endShift("💥 You collapsed from exhaustion.", { forceLock: true });
      }

      if (i.customId === "grind_fish:end") {
        await i.deferUpdate().catch(() => {});
        return endShift("You packed up your gear.");
      }

      if (i.customId === "grind_fish:push") {
        await i.deferUpdate().catch(() => {});
        overtime = true;
        await boardMsg.edit({ embeds: [await buildEmbed("🌙 Overtime: the water feels… alive.")], components: controlsRow() }).catch(() => {});
        return;
      }

      if (i.customId === "grind_fish:cast") {
        await i.deferUpdate().catch(() => {});
        if (state !== "idle") return;
        startBiteCycle();
        await boardMsg.edit({ embeds: [await buildEmbed("🎣 You cast your line.")], components: controlsRow() }).catch(() => {});
        return;
      }

      if (i.customId === "grind_fish:tug") {
        await i.deferUpdate().catch(() => {});
        if (state !== "tug_window") return;
        clearTimers();
        // A successful tug counts as a cast attempt
        await resolveCatch();
        return;
      }

      if (i.customId === "grind_fish:reel" || i.customId === "grind_fish:ease") {
        await i.deferUpdate().catch(() => {});
        if (state !== "tension") return;

        const delta = i.customId === "grind_fish:reel" ? 15 : -15;
        tension = clamp(tension + delta + randInt(-6, 6), 0, 100);

        // Safe zones
        const tier = catchInfo?.tier;
        const safeMin = tier === "legendary" ? 35 : 20;
        const safeMax = tier === "legendary" ? 75 : 85;

        if (tension <= 0) {
          state = "idle";
          streak = 0;
          return boardMsg.edit({ embeds: [await buildEmbed("💥 Line went slack — it escaped!")], components: controlsRow() }).catch(() => {});
        }
        if (tension >= 100) {
          state = "idle";
          streak = 0;
          return boardMsg.edit({ embeds: [await buildEmbed("💥 Line snapped — you lost it!")], components: controlsRow() }).catch(() => {});
        }

        if (tension >= safeMin && tension <= safeMax) {
          tensionStepsDone += 1;
        } else {
          // drifting out of safe zone resets progress for a calm-but-skill vibe
          tensionStepsDone = Math.max(0, tensionStepsDone - 1);
        }

        if (tensionStepsDone >= tensionStepsNeeded) {
          // Success
          const tierOk = catchInfo?.tier;
          const base = Number(catchInfo?.base || catchInfo?.item?.value || 0);
          const name = catchInfo?.item?.name;

          if (tierOk === "legendary") {
            // wait for brace input
            // (finishRareOrLegendary handles brace)
            return finishRareOrLegendary(true);
          }
          return finishRareOrLegendary(true);
        }

        await boardMsg.edit({ embeds: [await buildEmbed()], components: controlsRow() }).catch(() => {});
        return;
      }

      if (i.customId === "grind_fish:brace") {
        await i.deferUpdate().catch(() => {});
        if (state !== "brace") return;
        clearTimers();
        legends += 1;
        const base = Number(catchInfo?.base || catchInfo?.item?.value || 0);
        const name = catchInfo?.item?.name;
        const ultra = !!catchInfo?.ultra;

        const mult = 1.6 + Math.min(0.45, streak * 0.02);
        const payout = Math.floor(base * mult);
        earned += payout;
        streak += 1;
        bestStreak = Math.max(bestStreak, streak);
        casts += 1;

        state = "idle";

        // Ultra announcement
        if (ultra) {
          ultras += 1;
          const emb = ultraEmbed({
            title: "🌊🌊🌊 ULTRA CATCH! 🌊🌊🌊",
            description: `has conquered the **Echo Leviathan** while fishing!`,
            userTag: i.user.tag,
            amount: payout,
            extraLines: ["🎣 Legendary haul secured.", `🔥 Overtime: **${overtime ? "Yes" : "No"}**`, `🎯 Streak: **${streak}**`],
          });
          await postUltraToPlayground(i.client, guildId, emb);
        }

        await boardMsg.edit({ embeds: [await buildEmbed(`👑 Legendary catch: **${name}**\n+${money(payout)}`)], components: controlsRow() }).catch(() => {});
        return;
      }
    });

    collector.on("end", async () => {
      if (_resolved) return;
      await endShift("⏲️ Shift ended (inactivity).", { forceLock: (lastTick?.fatigueMs || 0) >= MAX_FATIGUE_MS });
    });
  });
};

module.exports.activityEffects = ACTIVITY_EFFECTS;
