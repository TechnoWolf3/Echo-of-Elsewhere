const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require("discord.js");

const { pool } = require("../../utils/db");
const { setJail } = require("../../utils/jail");

// Scenario pools (data-only)
const scenarios = require("./storeRobbery.scenarios");

// =====================
// CONFIG (LOCKED RULES)
// =====================

// 3–5 step minigame
const MIN_STEPS = 3;
const MAX_STEPS = 5;

// Cooldowns (minutes)
const GLOBAL_LOCKOUT_MINUTES = 10;
const STORE_COOLDOWN_MINUTES = 10;

// Heat tiers => outcomes
const HEAT_TIERS = {
  CLEAN: 20,         // < 20 => clean
  SPOTTED: 35,       // 20–34 => spotted
  PARTIAL: 60,       // 35–59 => partial
  BUSTED_HARD: 90,   // >= 90 => busted hard
  // 60–89 => busted
};

// Payouts / fines
const PAYOUT_MIN = 2000;
const PAYOUT_MAX = 6000;

const FINE_MIN = 3000;
const FINE_MAX = 8000;

// Jail chance (only on busted tiers)
const JAIL_CHANCE_BUSTED = 0.18;       // uncommon
const JAIL_CHANCE_BUSTED_HARD = 0.28;  // rare-ish
const JAIL_MIN_MINUTES = 2;
const JAIL_MAX_MINUTES = 5;

// Random run events
const LOOT_DROP_CHANCE = 0.12;     // low chance
const VALUABLE_FIND_CHANCE = 0.10; // low chance
const LOOT_DROP_MIN = 300;
const LOOT_DROP_MAX = 1200;
const VALUABLE_MIN = 250;
const VALUABLE_MAX = 1500;

// UI / timeout
const RUN_TIMEOUT_MS = 3 * 60_000;

// =====================
// DB HELPERS
// =====================
async function addUserBalance(guildId, userId, amount) {
  await pool.query(
    `UPDATE user_balances
     SET balance = balance + $1
     WHERE guild_id=$2 AND user_id=$3`,
    [amount, guildId, userId]
  );
}

async function subtractUserBalanceAndSendToBank(guildId, userId, amount) {
  // Clamp user balance at 0 (never negative), move what we can to bank.
  const res = await pool.query(
    `SELECT balance FROM user_balances WHERE guild_id=$1 AND user_id=$2`,
    [guildId, userId]
  );

  const current = Number(res.rows?.[0]?.balance || 0);
  const take = Math.min(current, Math.max(0, amount));

  if (take <= 0) return 0;

  await pool.query(
    `UPDATE user_balances
     SET balance = balance - $1
     WHERE guild_id=$2 AND user_id=$3`,
    [take, guildId, userId]
  );

  await pool.query(
    `UPDATE guilds
     SET bank_balance = bank_balance + $1
     WHERE guild_id=$2`,
    [take, guildId]
  );

  return take;
}

async function setCooldown(guildId, userId, key, minutes) {
  const next = new Date(Date.now() + minutes * 60 * 1000);
  await pool.query(
    `INSERT INTO cooldowns (guild_id, user_id, key, next_claim_at)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (guild_id, user_id, key)
     DO UPDATE SET next_claim_at = EXCLUDED.next_claim_at`,
    [guildId, userId, key, next]
  );
}

async function applyCooldowns(guildId, userId) {
  // Global lockout + store cooldown
  await setCooldown(guildId, userId, "crime_global", GLOBAL_LOCKOUT_MINUTES);
  await setCooldown(guildId, userId, "crime_store", STORE_COOLDOWN_MINUTES);
}

// =====================
// RANDOM HELPERS
// =====================
function randInt(min, maxIncl) {
  return Math.floor(min + Math.random() * (maxIncl - min + 1));
}
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

// =====================
// RENDER HELPERS
// =====================
function buildRow(phaseKey, scenarioId, choices) {
  const row = new ActionRowBuilder();
  choices.slice(0, 5).forEach((c, idx) => {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`sr|${phaseKey}|${scenarioId}|${idx}`)
        .setLabel(c.label)
        .setStyle(ButtonStyle.Primary)
    );
  });
  return row;
}

function renderScenario(phaseKey, scenario) {
  const embed = new EmbedBuilder()
    .setTitle("🏪 Store Robbery")
    .setDescription(scenario.prompt)
    .setFooter({ text: "Choose carefully. Heat carries forward in Crime." });

  const row = buildRow(phaseKey, scenario.id, scenario.choices);
  return { embed, components: [row] };
}

function applyRandomRunEvents() {
  const notes = [];
  // loot drop reduces payout
  if (Math.random() < LOOT_DROP_CHANCE) {
    const drop = randInt(LOOT_DROP_MIN, LOOT_DROP_MAX);
    notes.push(`💨 You fumbled and dropped **$${drop.toLocaleString()}** worth of loot.`);
    return { payoutDelta: -drop, notes };
  }

  // finding valuables increases payout slightly
  if (Math.random() < VALUABLE_FIND_CHANCE) {
    const find = randInt(VALUABLE_MIN, VALUABLE_MAX);
    notes.push(`✨ You found an extra **$${find.toLocaleString()}** hidden away.`);
    return { payoutDelta: +find, notes };
  }

  return { payoutDelta: 0, notes };
}

function computeSuccessPayout(outcome) {
  // clean/spotted pay full range; partial is reduced a bit
  let base = randInt(PAYOUT_MIN, PAYOUT_MAX);
  if (outcome === "partial") base = Math.floor(base * 0.75);
  return Math.max(0, base);
}

function computeFine(outcome) {
  let fine = randInt(FINE_MIN, FINE_MAX);
  if (outcome === "busted_hard") fine = Math.floor(fine * 1.1);
  return fine;
}

// =====================
// MAIN EXPORT
// =====================
module.exports = function startStoreRobbery(interaction, context = {}) {
  return new Promise(async (resolve) => {
    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    // If your crime system passes this in, we start from it
    let heat = Number(context.lingeringHeat || 0);
    heat = clamp(heat, 0, 100);

    let loot = 0;

    // Promise finalizer (so /job can await this minigame)
    let finished = false;
    const finishOnce = (payload) => {
      if (finished) return;
      finished = true;
      resolve(payload);
    };

    // Evidence/flags
    let evidenceRisk = false;   // “Act casual” sets this
    let evidenceCleared = false;
    let usedCar = false;
    let timerRisk = false;
    let witnessRisk = false;

    // Step phases (picked from scenario pools)
    const phases = ["entry", "approach", "grab", "exit", "escape"];

    // Steps are randomized 3–5 across those phases
    const stepCount = randInt(MIN_STEPS, MAX_STEPS);
    const chosenPhases = phases.slice(0, stepCount);

    // Build a run list of scenarios that won't repeat within the run
    const chosenScenarios = [];
    const usedIds = new Set();

    for (const phase of chosenPhases) {
      const poolList = scenarios[phase] || [];
      const available = poolList.filter((s) => !usedIds.has(s.id));
      const s = available.length ? pick(available) : pick(poolList);
      if (s) {
        usedIds.add(s.id);
        chosenScenarios.push({ phase, scenario: s });
      }
    }

    let phaseIndex = 0;

    // Show current phase
    async function showCurrentPhase() {
      const current = chosenScenarios[phaseIndex];
      if (!current) {
        // No scenario to show => finish
        return resolveAndFinish();
      }

      const { phase, scenario } = current;

      if (!scenario || !Array.isArray(scenario.choices) || scenario.choices.length === 0) {
        // Safety: if no scenarios exist for this phase, skip it
        phaseIndex++;
        if (phaseIndex >= chosenScenarios.length) return resolveAndFinish();
        return showCurrentPhase();
      }

      const { embed, components } = renderScenario(phase, scenario);
      await interaction.editReply({ embeds: [embed], components });
    }

    // Outcome resolution
    function determineOutcome() {
      if (heat < HEAT_TIERS.CLEAN) return "clean";
      if (heat < HEAT_TIERS.SPOTTED) return "spotted";
      if (heat < HEAT_TIERS.PARTIAL) return "partial";
      if (heat >= HEAT_TIERS.BUSTED_HARD) return "busted_hard";
      return "busted";
    }

    function rollIdentifiedLater() {
      // Base chance
      let chance = 0.05;

      // “Act casual” evidence risk
      if (evidenceRisk) chance += 0.18;

      // Staying longer / more chaotic choices
      if (timerRisk) chance += 0.10;
      if (usedCar) chance += 0.10;
      if (witnessRisk) chance += 0.08;

      // Evidence clearing reduces this
      if (evidenceCleared) chance -= 0.12;

      chance = clamp(chance, 0, 0.60);
      return Math.random() < chance;
    }

    async function maybeJail(outcome) {
      const roll = Math.random();
      const chance =
        outcome === "busted_hard" ? JAIL_CHANCE_BUSTED_HARD : JAIL_CHANCE_BUSTED;

      if (roll >= chance) return 0;

      const minutes = randInt(JAIL_MIN_MINUTES, JAIL_MAX_MINUTES);
      const releaseAt = new Date(Date.now() + minutes * 60 * 1000);
      await setJail(guildId, userId, releaseAt);
      return minutes;
    }

    async function resolveAndFinish() {
      // Always apply cooldowns on BOTH fail and success (locked rule)
      await applyCooldowns(guildId, userId);

      // Apply random loot events (low chance)
      const eventNotes = applyRandomRunEvents();

      // Determine base outcome from heat
      let outcome = determineOutcome();

      // Evidence / ID can turn a clean run into “spotted”
      const identified = rollIdentifiedLater();
      if (identified && outcome === "clean") outcome = "spotted";

      let resultLines = [];

      // Handle outcomes
      if (outcome === "clean" || outcome === "spotted") {
        const payout = computeSuccessPayout(outcome) + eventNotes.payoutDelta;
        const finalPayout = Math.max(0, payout);
        await addUserBalance(guildId, userId, finalPayout);

        resultLines.push(
          outcome === "clean"
            ? `✅ Clean getaway. You pocket **$${finalPayout.toLocaleString()}**.`
            : `⚠️ You got out, but it felt risky. You pocket **$${finalPayout.toLocaleString()}**.`
        );

        if (identified) {
          resultLines.push("🧾 You might’ve been **identified later**.");
        }
      } else if (outcome === "partial") {
        const payout = computeSuccessPayout("partial") + eventNotes.payoutDelta;
        const finalPayout = Math.max(0, payout);
        await addUserBalance(guildId, userId, finalPayout);

        resultLines.push(
          `😬 You got something, but not much. You pocket **$${finalPayout.toLocaleString()}**.`
        );
      } else {
        // busted tiers: fine goes to bank (never negative)
        const fine = computeFine(outcome);
        const taken = await subtractUserBalanceAndSendToBank(guildId, userId, fine);

        if (outcome === "busted_hard") {
          resultLines.push(
            `🚨 **BUSTED HARD.** You were hit with a fine of **$${fine.toLocaleString()}** (paid **$${taken.toLocaleString()}**).`
          );
        } else {
          resultLines.push(
            `🚓 **BUSTED.** You were hit with a fine of **$${fine.toLocaleString()}** (paid **$${taken.toLocaleString()}**).`
          );
        }

        const jailedMinutes = await maybeJail(outcome);
        if (jailedMinutes > 0) {
          resultLines.push(`⛓️ You were jailed for **${jailedMinutes} minutes**. (All jobs blocked while jailed)`);
        } else {
          resultLines.push("😮‍💨 You avoided jail this time.");
        }
      }

      // Notes from random events
      if (eventNotes.notes?.length) {
        resultLines.push("", ...eventNotes.notes);
      }

      // Adjust heat based on outcome a bit (helps prevent “always clean” loops)
      if (outcome === "clean") heat = clamp(heat - 8, 0, 100);
      if (outcome === "spotted") heat = clamp(heat + 5, 0, 100);
      if (outcome === "partial") heat = clamp(heat + 12, 0, 100);
      if (outcome === "busted") heat = clamp(heat + 22, 0, 100);
      if (outcome === "busted_hard") heat = clamp(heat + 35, 0, 100);

      // Allow caller to persist heat, etc.
      if (typeof context.onStoreRobberyComplete === "function") {
        try {
          await context.onStoreRobberyComplete({
            guildId,
            userId,
            outcome,
            finalHeat: heat,
            evidenceRisk,
            identified,
          });
        } catch (_) {
          // ignore
        }
      }

      const embed = new EmbedBuilder()
        .setTitle("🏁 Store Robbery Complete")
        .setDescription(resultLines.join("\n"))
        .addFields(
          { name: "🔥 Final Heat", value: `${clamp(heat, 0, 100)}/100`, inline: true },
          { name: "🧾 Identified?", value: identified ? "Yes (possible)" : "No", inline: true }
        )
        .setFooter({ text: "Crime heat only affects Crime jobs." })
        .setColor(outcome.startsWith("busted") ? 0xaa0000 : 0x22aa55);

      await interaction.editReply({ embeds: [embed], components: [] });

      // End collector + resolve promise for the caller (/job)
      try { collector.stop("done"); } catch (_) {}
      finishOnce({ outcome, finalHeat: clamp(heat, 0, 100), identified });
    }

    // =====================
    // Collector / Router
    // =====================
    const collector = interaction.channel.createMessageComponentCollector({
      time: RUN_TIMEOUT_MS,
    });

    collector.on("collect", async (i) => {
      if (i.user.id !== userId) return;
      await i.deferUpdate();

      // Parse custom id
      const parts = String(i.customId).split("|");
      if (parts.length !== 4 || parts[0] !== "sr") return;

      const phase = parts[1];
      const scenarioId = parts[2];
      const choiceIndex = Number(parts[3]);

      const scenario = (scenarios[phase] || []).find((s) => s.id === scenarioId);
      const choice = scenario?.choices?.[choiceIndex];
      if (!choice) return;

      // Apply choice effects (data-driven)
      if (typeof choice.heat === "number") heat += choice.heat;
      if (typeof choice.lootAdd === "number") loot += choice.lootAdd;

      if (choice.evidenceRisk) evidenceRisk = true;
      if (choice.evidenceClear) evidenceCleared = true;
      if (choice.usedCar) usedCar = true;
      if (choice.timerRisk) timerRisk = true;
      if (choice.witnessRisk) witnessRisk = true;

      heat = clamp(heat, 0, 100);

      // Advance to next phase
      phaseIndex++;
      if (phaseIndex >= chosenScenarios.length) return resolveAndFinish();
      return showCurrentPhase();
    });

    collector.on("end", async (_, reason) => {
      if (reason === "done") return;
      await interaction.editReply({
        content: "⏱️ You hesitated too long. The opportunity passed.",
        embeds: [],
        components: [],
      });
      finishOnce({ outcome: "timeout", finalHeat: clamp(heat, 0, 100), identified: false });
    });

    // Kick off
    await showCurrentPhase();
  });
};
