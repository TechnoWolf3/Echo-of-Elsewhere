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
const GLOBAL_CRIME_LOCK_MIN = 10;
const STORE_COOLDOWN_MIN = 10;

const SUCCESS_PAYOUT_MIN = 2000;
const SUCCESS_PAYOUT_MAX = 6000;

const FINE_MIN = 3000;
const FINE_MAX = 8000;

// Heat tiers (S1 tuned)
const HEAT_TIERS = {
  CLEAN: 25,
  SPOTTED: 45,
  PARTIAL: 65,
  BUSTED_HARD: 85,
};

// Low-chance random events (per run)
const LOOT_DROP_CHANCE = 0.12;     // low chance
const VALUABLE_FIND_CHANCE = 0.10; // low chance
const LOOT_DROP_MULT = 0.85;       // reduces payout a bit
const VALUABLE_BONUS_MIN = 150;    // small boost
const VALUABLE_BONUS_MAX = 650;

// Jail (S1 uncommon/rare, only on busted/busted hard)
const JAIL_CHANCE_BUSTED = 0.08;
const JAIL_CHANCE_BUSTED_HARD = 0.14;
const JAIL_MIN_MINUTES = 2;
const JAIL_MAX_MINUTES = 5;

// Collector timeout
const RUN_TIMEOUT_MS = 3 * 60 * 1000;

// =====================
// DB HELPERS
// =====================
async function upsertCooldown(guildId, userId, key, nextClaimAt) {
  await pool.query(
    `INSERT INTO cooldowns (guild_id, user_id, key, next_claim_at)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (guild_id, user_id, key)
     DO UPDATE SET next_claim_at = EXCLUDED.next_claim_at`,
    [guildId, userId, key, nextClaimAt]
  );
}

async function addUserBalance(guildId, userId, amount) {
  // Ensure row exists
  const up = await pool.query(
    `UPDATE user_balances SET balance = balance + $1
     WHERE guild_id=$2 AND user_id=$3`,
    [amount, guildId, userId]
  );
  if (up.rowCount === 0) {
    await pool.query(
      `INSERT INTO user_balances (guild_id, user_id, balance)
       VALUES ($1,$2,$3)
       ON CONFLICT (guild_id, user_id)
       DO UPDATE SET balance = user_balances.balance + EXCLUDED.balance`,
      [guildId, userId, amount]
    );
  }
}

async function subUserBalanceNoNegative(guildId, userId, amount) {
  // Ensure row exists
  await pool.query(
    `INSERT INTO user_balances (guild_id, user_id, balance)
     VALUES ($1,$2,0)
     ON CONFLICT (guild_id, user_id) DO NOTHING`,
    [guildId, userId]
  );

  await pool.query(
    `UPDATE user_balances
     SET balance = GREATEST(balance - $1, 0)
     WHERE guild_id=$2 AND user_id=$3`,
    [amount, guildId, userId]
  );
}

async function addBankBalance(guildId, amount) {
  // Ensure guild row exists
  await pool.query(
    `INSERT INTO guilds (guild_id, bank_balance)
     VALUES ($1, 0)
     ON CONFLICT (guild_id) DO NOTHING`,
    [guildId]
  );

  await pool.query(
    `UPDATE guilds
     SET bank_balance = bank_balance + $1
     WHERE guild_id=$2`,
    [amount, guildId]
  );
}

// =====================
// RANDOM HELPERS
// =====================
function randInt(min, maxInclusive) {
  const r = Math.floor(Math.random() * (maxInclusive - min + 1)) + min;
  return r;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function pickNonRepeating(pool, usedSet) {
  if (!Array.isArray(pool) || pool.length === 0) return null;
  const available = pool.filter((s) => !usedSet.has(s.id));
  const pickFrom = available.length ? available : pool;
  const chosen = pickFrom[Math.floor(Math.random() * pickFrom.length)];
  usedSet.add(chosen.id);
  return chosen;
}

// =====================
// MAIN EXPORT
// =====================
module.exports = async function startStoreRobbery(interaction, context = {}) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;

  // If your crime system passes this in, we start from it
  let heat = Number(context.lingeringHeat || 0);
  heat = clamp(heat, 0, 100);

  let loot = 0;

  // Evidence/flags
  let evidenceRisk = false;   // “Act casual” sets this
  let evidenceCleared = false;
  let usedCar = false;
  let timerRisk = false;
  let witnessRisk = false;

  // Randomise run length: 3–5 steps
  // Always: approach, method, greed. Then maybe exit, maybe aftermath.
  const phases = ["approach", "method", "greed"];
  if (Math.random() < 0.85) phases.push("exit");       // usually yes
  if (Math.random() < 0.60) phases.push("aftermath");  // sometimes yes
  while (phases.length < 3) phases.push("exit");
  phases.length = clamp(phases.length, 3, 5);

  // Non-repeating per-phase scenario selection
  const used = {
    approach: new Set(),
    method: new Set(),
    greed: new Set(),
    exit: new Set(),
    aftermath: new Set(),
  };

  let phaseIndex = 0;
  let currentScenario = null;

  function baseEmbed(phaseTitle, text) {
    return new EmbedBuilder()
      .setTitle("🏪 Store Robbery")
      .setDescription(`**${phaseTitle}**\n\n${text}`)
      .addFields(
        { name: "🔥 Heat", value: `${heat}`, inline: true },
        { name: "💰 Loot", value: `$${loot.toLocaleString()}`, inline: true }
      )
      .setColor(0xcc4444);
  }

  function makeCustomId(phase, scenarioId, choiceIndex) {
    return `sr|${phase}|${scenarioId}|${choiceIndex}`;
  }

  function renderScenario(phase, scenario) {
    const embed = baseEmbed(phase.toUpperCase(), scenario.text);

    const row = new ActionRowBuilder();
    // Standardise to max 3 choices to keep UI consistent
    scenario.choices.slice(0, 3).forEach((c, idx) => {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(makeCustomId(phase, scenario.id, idx))
          .setLabel(c.label)
          .setStyle(c.style || ButtonStyle.Secondary)
      );
    });

    return { embed, components: [row] };
  }

  function pickScenarioForPhase(phase) {
    const pool = scenarios[phase] || [];
    return pickNonRepeating(pool, used[phase]);
  }

  async function showCurrentPhase() {
    const phase = phases[phaseIndex];
    currentScenario = pickScenarioForPhase(phase);

    if (!currentScenario) {
      // Safety: if no scenarios exist for this phase, skip it
      phaseIndex++;
      if (phaseIndex >= phases.length) return resolveAndFinish();
      return showCurrentPhase();
    }

    const { embed, components } = renderScenario(phase, currentScenario);
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

    // Dumping evidence reduces it
    if (evidenceCleared) chance -= 0.12;

    chance = clamp(chance, 0, 0.45);
    return Math.random() < chance;
  }

  function applyRandomRunEvents() {
    const notes = [];

    if (Math.random() < LOOT_DROP_CHANCE) {
      loot = Math.floor(loot * LOOT_DROP_MULT);
      notes.push("🫳 You fumbled part of the loot while escaping.");
    }

    if (Math.random() < VALUABLE_FIND_CHANCE) {
      const bonus = randInt(VALUABLE_BONUS_MIN, VALUABLE_BONUS_MAX);
      loot += bonus;
      notes.push("💎 You found something valuable worth extra cash.");
    }

    return notes;
  }

  function computeSuccessPayout(outcome) {
    // Base: loot driven but clamped into the success window.
    // Spotted is slightly reduced; clean is full.
    let payout = loot;

    if (outcome === "spotted") payout = Math.floor(payout * 0.88);

    payout = clamp(payout, SUCCESS_PAYOUT_MIN, SUCCESS_PAYOUT_MAX);
    return payout;
  }

  function computePartialPayout() {
    // Partial score: smaller, can be under 2k.
    // Still feels like “got something” without being a full win.
    let payout = Math.floor(loot * 0.55);
    payout = clamp(payout, 500, 2500);
    return payout;
  }

  function computeFine(outcome) {
    if (outcome === "busted_hard") {
      // Slight bias to higher end but still inside 3–8k “fine band”
      return randInt(Math.max(5000, FINE_MIN), FINE_MAX);
    }
    return randInt(FINE_MIN, FINE_MAX);
  }

  async function applyCooldowns() {
    const now = Date.now();
    const globalNext = new Date(now + GLOBAL_CRIME_LOCK_MIN * 60 * 1000);
    const storeNext = new Date(now + STORE_COOLDOWN_MIN * 60 * 1000);

    await upsertCooldown(guildId, userId, "crime_global", globalNext);
    await upsertCooldown(guildId, userId, "crime_store", storeNext);
  }

  async function maybeJail(outcome) {
    if (outcome !== "busted" && outcome !== "busted_hard") return null;

    const chance =
      outcome === "busted_hard" ? JAIL_CHANCE_BUSTED_HARD : JAIL_CHANCE_BUSTED;

    if (Math.random() >= chance) return null;

    const minutes = randInt(JAIL_MIN_MINUTES, JAIL_MAX_MINUTES);
    const releaseAt = new Date(Date.now() + minutes * 60 * 1000);
    await setJail(guildId, userId, releaseAt);
    return minutes;
  }

  async function resolveAndFinish() {
    // Always apply cooldowns on BOTH fail and success (locked rule)
    await applyCooldowns();

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
      const payout = computeSuccessPayout(outcome);
      await addUserBalance(guildId, userId, payout);

      resultLines.push(
        outcome === "clean"
          ? `✅ Clean getaway. You pocket **$${payout.toLocaleString()}**.`
          : `👀 You got away, but you were **spotted**. You pocket **$${payout.toLocaleString()}**.`
      );
    } else if (outcome === "partial") {
      const payout = computePartialPayout();
      await addUserBalance(guildId, userId, payout);
      resultLines.push(`🟡 Partial score. You escape with **$${payout.toLocaleString()}**.`);
    } else {
      const fine = computeFine(outcome);
      await subUserBalanceNoNegative(guildId, userId, fine);
      await addBankBalance(guildId, fine);

      resultLines.push(
        outcome === "busted_hard"
          ? `🚨 **BUSTED HARD.** Fine: **$${fine.toLocaleString()}** (paid to the bank).`
          : `🚨 **BUSTED.** Fine: **$${fine.toLocaleString()}** (paid to the bank).`
      );

      const jailMins = await maybeJail(outcome);
      if (jailMins) {
        resultLines.push(`🚔 You were jailed for **${jailMins} minutes**.`);
      }
    }

    // Event notes
    if (eventNotes.length) {
      resultLines.push("", ...eventNotes);
    }

    // Identified note
    if (identified) {
      resultLines.push("", "🧾 You left enough behind to be **ID’d later**.");
    }

    // (Optional) Lingering heat hook — if your Crime system provides a setter
    // We’re not enforcing storage here because you didn’t specify the persistence layer yet.
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
        { name: "🔥 Final Heat", value: `${heat}`, inline: true },
        { name: "💰 Final Loot", value: `$${loot.toLocaleString()}`, inline: true }
      )
      .setColor(outcome.startsWith("busted") ? 0xaa0000 : 0x22aa55);

    await interaction.editReply({ embeds: [embed], components: [] });
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

    // Special crowd logic if scenario wants it
    if (choice.crowdBlend) {
      heat = heat < 30 ? heat - 5 : heat + 5;
    }

    heat = clamp(heat, 0, 100);

    // Advance to next phase or resolve
    phaseIndex++;
    if (phaseIndex >= phases.length) {
      collector.stop("done");
      return resolveAndFinish();
    }

    return showCurrentPhase();
  });

  collector.on("end", async (_, reason) => {
    if (reason === "done") return;
    await interaction.editReply({
      content: "⏱️ You hesitated too long. The opportunity passed.",
      embeds: [],
      components: [],
    });
  });

  // Kick off
  await showCurrentPhase();
};
