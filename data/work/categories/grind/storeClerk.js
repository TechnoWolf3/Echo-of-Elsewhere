// data/work/categories/grind/storeClerk.js
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require("discord.js");

const { canGrind, tickFatigue, fatigueBar, MAX_FATIGUE_MS, applyGrindLock } = require("../../../../utils/grindFatigue");
const { money, mintUser, setJobCooldownSeconds } = require("./_shared");

// ✅ set this to your store item ID that grants +5% and is consumed per shift
const CLERK_BONUS_ITEM_ID = "Math_Tutour";

const JOB_COOLDOWN_SECONDS = 45;
const OVERTIME_HARDCAP_MULT = 1.5; // 150%

function centsToString(cents) {
  const a = Math.abs(cents);
  const dollars = Math.floor(a / 100);
  const rem = a % 100;
  return `${dollars}.${String(rem).padStart(2, "0")}`;
}

function parseMoneyToCents(input) {
  const s = String(input || "").trim().replace("$", "");
  if (!s) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;

  const [d, cRaw] = s.split(".");
  const dollars = Number(d);
  const cents = Number((cRaw || "0").padEnd(2, "0").slice(0, 2));
  return dollars * 100 + cents;
}

function clampInt(n, min, max) {
  const x = Math.floor(Number(n));
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
}

function randInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function pickTier(streak) {
  if (streak < 5) return 1 + (Math.random() < 0.35 ? 1 : 0);
  if (streak < 15) return 2 + (Math.random() < 0.5 ? 1 : 0);
  if (streak < 30) return 3 + (Math.random() < 0.6 ? 1 : 0);
  return 4 + (Math.random() < 0.6 ? 1 : 0);
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function makeScenario(streak) {
  // 8% “debit save”
  if (Math.random() < 0.08) {
    return {
      tier: 0,
      text: "Customer taps their **debit card**. No change needed — you’re off the hook!",
      changeCents: 0,
      basePayout: 40,
    };
  }

  const tier = pickTier(streak);

  const items = ["chips", "soft drink", "sandwich", "coffee", "donut", "magazine", "energy drink", "chocolate bar"];

  function priceWhole() {
    return pick([3, 4, 5, 6, 7, 8, 9, 10, 12, 15]) * 100;
  }
  function priceCents() {
    const d = pick([2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15]);
    const c = pick([10, 20, 25, 30, 40, 50, 60, 75, 80, 95]);
    return d * 100 + c;
  }

  let aName = pick(items);
  let bName = pick(items.filter((x) => x !== aName));

  let a = 0, b = 0, coupon = 0;

  if (tier === 1) a = priceWhole();
  else if (tier === 2) a = priceCents();
  else if (tier === 3) { a = priceCents(); b = priceWhole(); }
  else if (tier === 4) { a = priceCents(); b = priceCents(); }
  else { a = priceCents(); b = priceCents(); coupon = pick([250, 500]); } // $2.50 or $5.00

  const total = a + b;
  const afterCoupon = Math.max(0, total - coupon);

  const notes = [500, 1000, 2000, 5000, 10000]; // $5..$100
  const paid = pick(notes.filter((n) => n >= afterCoupon)) || 10000;

  const change = paid - afterCoupon;

  const parts = [];
  if (a) parts.push(`**${aName}** for **$${centsToString(a)}**`);
  if (b) parts.push(`**${bName}** for **$${centsToString(b)}**`);

  let text = `Customer buys ${parts.join(" and ")}.\n`;
  if (coupon) text += `They use a **$${centsToString(coupon)} coupon**.\n`;
  text += `They hand you **$${centsToString(paid)}**.\n**What change do you give?**`;

  const basePayout = [0, 45, 55, 70, 85, 100][tier] || 60;

  return { tier, text, changeCents: change, basePayout };
}

// (mintUser imported from _shared)

async function consumeBonusItemIfPresent(db, guildId, userId) {
  const res = await db.query(
    `SELECT qty, uses_remaining
     FROM user_inventory
     WHERE guild_id=$1 AND user_id=$2 AND item_id=$3`,
    [guildId, userId, CLERK_BONUS_ITEM_ID]
  );

  if (!res.rowCount) return { used: false };

  const row = res.rows[0];
  const qty = Number(row.qty || 0);
  const uses = Number(row.uses_remaining || 0);

  // Prefer decrement uses_remaining if it exists
  if (uses > 0) {
    const upd = await db.query(
      `UPDATE user_inventory
       SET uses_remaining = uses_remaining - 1,
           updated_at = NOW()
       WHERE guild_id=$1 AND user_id=$2 AND item_id=$3 AND uses_remaining > 0
       RETURNING qty, uses_remaining`,
      [guildId, userId, CLERK_BONUS_ITEM_ID]
    );
    if (!upd.rowCount) return { used: false };

    const leftQty = Number(upd.rows[0].qty || 0);
    const leftUses = Number(upd.rows[0].uses_remaining || 0);
    if (leftQty <= 0 && leftUses <= 0) {
      await db.query(
        `DELETE FROM user_inventory WHERE guild_id=$1 AND user_id=$2 AND item_id=$3`,
        [guildId, userId, CLERK_BONUS_ITEM_ID]
      );
    }

    return { used: true, mode: "uses" };
  }

  if (qty > 0) {
    const upd = await db.query(
      `UPDATE user_inventory
       SET qty = qty - 1,
           updated_at = NOW()
       WHERE guild_id=$1 AND user_id=$2 AND item_id=$3 AND qty > 0
       RETURNING qty, uses_remaining`,
      [guildId, userId, CLERK_BONUS_ITEM_ID]
    );
    if (!upd.rowCount) return { used: false };

    const leftQty = Number(upd.rows[0].qty || 0);
    const leftUses = Number(upd.rows[0].uses_remaining || 0);
    if (leftQty <= 0 && leftUses <= 0) {
      await db.query(
        `DELETE FROM user_inventory WHERE guild_id=$1 AND user_id=$2 AND item_id=$3`,
        [guildId, userId, CLERK_BONUS_ITEM_ID]
      );
    }

    return { used: true, mode: "qty" };
  }

  return { used: false };
}

// The entrypoint called from /job
module.exports = function startStoreClerk(btn, { pool, boardMsg, guildId, userId } = {}) {
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

  // Bonus item: if present, consume 1 and grant +5%
  const bonus = await consumeBonusItemIfPresent(db, guildId, userId);
  const bonusPct = bonus.used ? 0.05 : 0;

  let streak = 0;
  let earned = 0;
  let active = true;
  let overtime = false;
  let lastTick = { fatigueMs: 0, exhausted: false };

  let scenario = makeScenario(streak);

  const enterBtn = new ButtonBuilder().setCustomId("grind_clerk:enter").setLabel("Enter change").setStyle(ButtonStyle.Success);
  const endBtn = new ButtonBuilder().setCustomId("grind_clerk:end").setLabel("End shift").setStyle(ButtonStyle.Danger);
  const pushBtn = new ButtonBuilder().setCustomId("grind_clerk:push").setLabel("Push on").setStyle(ButtonStyle.Secondary);

  function actionRow({ disabled = false, showPush = false, disableEnter = false } = {}) {
    const row = new ActionRowBuilder().addComponents(
      enterBtn.setDisabled(disabled || disableEnter),
      endBtn.setDisabled(disabled)
    );
    if (showPush) row.addComponents(pushBtn.setDisabled(disabled));
    return row;
  }

  async function buildEmbed(extraLine = "") {
    const tick = await tickFatigue(db, guildId, userId);
    lastTick = tick;

    // Hard cap in overtime -> forced rest
    const hardCapMs = Math.floor(MAX_FATIGUE_MS * OVERTIME_HARDCAP_MULT);
    if (overtime && (tick.fatigueMs || 0) >= hardCapMs) {
      active = false;
      return new EmbedBuilder()
        .setTitle("🏪 Store Clerk — Shift Ended")
        .setDescription(`💥 You pushed too far and **collapsed from exhaustion**.\n\n${extraLine}`.trim())
        .addFields(
          { name: "Earned (shift)", value: money(earned), inline: true },
          { name: "Streak", value: String(streak), inline: true },
          { name: "Bonus item", value: bonus.used ? "✅ Used (+5%)" : "❌ None", inline: true }
        );
    }

    const fb = fatigueBar(tick.fatigueMs || 0);
    const streakBonus = streak >= 25 ? 0.10 : streak >= 10 ? 0.05 : 0;

    const exhaustedLine = tick.exhausted && !overtime
      ? "⚠️ You’ve hit **100% fatigue**. End your shift to recover — or **Push on** at your own risk."
      : "";

    return new EmbedBuilder()
      .setTitle("🏪 Store Clerk — Grind")
      .setDescription([scenario.text, exhaustedLine, "", extraLine].filter(Boolean).join("\n").trim())
      .addFields(
        { name: "Streak", value: String(streak), inline: true },
        { name: "Earned (shift)", value: money(earned), inline: true },
        { name: "Fatigue", value: `${fb.bar} ${fb.pct}%`, inline: false },
        {
          name: "Bonuses",
          value:
            `Streak bonus: **${Math.round(streakBonus * 100)}%**\n` +
            `Item bonus: **${Math.round(bonusPct * 100)}%**${bonus.used ? " (consumed 1)" : ""}`,
          inline: false,
        }
      );
  }

  // Swap board into “run mode”
  await boardMsg.edit({
    embeds: [await buildEmbed()],
    components: [actionRow({ disabled: false, showPush: false, disableEnter: false })],
  }).catch(() => {});

  const collector = boardMsg.createMessageComponentCollector({ time: 5 * 60_000 });

  async function endShift(reason) {
    if (!active) return;
    active = false;

    if (earned > 0) {
      await mintUser(db, guildId, userId, earned, "grind_store_clerk_payout", {
        job: "store_clerk",
        streak,
        used_bonus_item: bonus.used,
      });
      await setJobCooldownSeconds(db, guildId, userId, JOB_COOLDOWN_SECONDS);
    }

    // If exhausted or in overtime, force recovery lock.
    let lockTs = null;
    if ((lastTick?.fatigueMs || 0) >= MAX_FATIGUE_MS) {
      const lock = await applyGrindLock(db, guildId, userId);
      lockTs = Math.floor(lock.lockedUntil.getTime() / 1000);
    }

    const embed = new EmbedBuilder()
      .setTitle("🏪 Store Clerk — Shift Complete")
      .setDescription([reason, lockTs ? `🥵 Recovery: Grind unlocks <t:${lockTs}:R>.` : ""].filter(Boolean).join("\n"))
      .addFields(
        { name: "Earned (shift)", value: money(earned), inline: true },
        { name: "Final streak", value: String(streak), inline: true },
        { name: "Bonus item", value: bonus.used ? "✅ Used (+5%)" : "❌ None", inline: true }
      );

    await boardMsg.edit({ embeds: [embed], components: [] }).catch(() => {});
    collector.stop("done");
    resolveOnce();
  }

  async function nextScenario(correct, feedbackLine) {
    if (correct) streak += 1;
    else streak = 0;

    // payout for correct answers only
    if (correct) {
      const streakBonus = streak >= 25 ? 0.10 : streak >= 10 ? 0.05 : 0;
      const mult = 1 + streakBonus + bonusPct;
      const payout = Math.max(0, Math.floor(scenario.basePayout * mult));
      earned += payout;
    }

    scenario = makeScenario(streak);

    const emb = await buildEmbed(feedbackLine);
    if (!active) {
      return endShift("🥵 You hit the wall.");
    }

    const showPush = !!(lastTick?.exhausted && !overtime);
    const disableEnter = showPush; // force decision at 100%
    await boardMsg.edit({ embeds: [emb], components: [actionRow({ disabled: false, showPush, disableEnter })] }).catch(() => {});
  }

  collector.on("collect", async (i) => {
    if (i.user.id !== userId) {
      return i.reply({ content: "❌ This job isn’t for you.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    if (i.customId === "grind_clerk:end") {
      await i.deferUpdate().catch(() => {});
      return endShift("You clocked off. Nice work.");
    }

    if (i.customId === "grind_clerk:push") {
      await i.deferUpdate().catch(() => {});
      overtime = true;
      const emb = await buildEmbed("🔥 Overtime mode: faster mistakes, bigger risks.");
      await boardMsg.edit({ embeds: [emb], components: [actionRow({ disabled: false, showPush: false, disableEnter: false })] }).catch(() => {});
      return;
    }

    if (i.customId === "grind_clerk:enter") {
      // ✅ DO NOT deferUpdate before showModal
      const modalId = `grind_clerk_modal:${Date.now()}`;
      const modal = new ModalBuilder().setCustomId(modalId).setTitle("Enter Change");

      const input = new TextInputBuilder()
        .setCustomId("change")
        .setLabel("Change amount (e.g. 12.50 or 12)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await i.showModal(modal);

      const submitted = await i.awaitModalSubmit({
        time: 30_000,
        filter: (m) => m.user.id === userId && m.customId === modalId,
      }).catch(() => null);

      if (!submitted) return;

      await submitted.deferUpdate().catch(() => {});
if (scenario.tier === 0) {return nextScenario(true, "✅ Debit card — no change needed.");
      }

      const entered = parseMoneyToCents(submitted.fields.getTextInputValue("change"));
      if (entered == null) {
        await boardMsg.edit({ embeds: [await buildEmbed("❌ Invalid format. Use `12` or `12.50`.")], components: [actionRow(false)] }).catch(() => {});
        return;
      }

      if (entered === scenario.changeCents) {
        await submitted.editReply(`✅ Correct! Change is **$${centsToString(scenario.changeCents)}**.`).catch(() => {});
        return nextScenario(true, `✅ Correct! Change: $${centsToString(scenario.changeCents)}`);
      }

      await submitted.editReply(`❌ Wrong. Correct was **$${centsToString(scenario.changeCents)}**. Streak reset.`).catch(() => {});
      return nextScenario(false, `❌ Wrong. Correct: $${centsToString(scenario.changeCents)} (streak reset)`);
    }
  });

  collector.on("end", async () => {
    if (active) await endShift("⏳ Shift timed out.");
  });
  });
};