// utils/echoRift/curseGuard.js
// Blocks /games usage if the user owes Echo a fee (e.g., Blood Tax).

const { MessageFlags } = require("discord.js");
const { pool } = require("../db");
const economy = require("../economy");

async function getCurse(guildId, userId) {
  const res = await pool.query(
    `SELECT kind, value, expires_at
     FROM echo_user_curses
     WHERE guild_id=$1 AND user_id=$2
     LIMIT 1`,
    [String(guildId), String(userId)]
  );
  const row = res.rows?.[0];
  if (!row) return null;

  const exp = row.expires_at ? new Date(row.expires_at).getTime() : null;
  if (exp && exp <= Date.now()) {
    await pool.query(`DELETE FROM echo_user_curses WHERE guild_id=$1 AND user_id=$2`, [String(guildId), String(userId)]);
    return null;
  }

  return { kind: String(row.kind), value: Number(row.value || 0), expiresAt: exp };
}

async function clearCurse(guildId, userId) {
  await pool.query(`DELETE FROM echo_user_curses WHERE guild_id=$1 AND user_id=$2`, [String(guildId), String(userId)]);
}

function label(kind) {
  if (kind === "blood_tax") return "Blood Tax";
  if (kind === "games_fee") return "Echo's Fee";
  return "Echo's Curse";
}

async function tryPayIfOwed(guildId, userId, curse) {
  if (!curse || curse.value <= 0) return { ok: true, paid: false };

  const bal = await economy.getBalance(guildId, userId);
  if (bal < curse.value) return { ok: false, paid: false, needed: curse.value, balance: bal };

  const res = await economy.tryDebitUser(guildId, userId, curse.value, "echo_curse_payment", { kind: curse.kind });
  if (!res.ok) return { ok: false, paid: false, needed: curse.value, balance: bal };

  await clearCurse(guildId, userId);
  return { ok: true, paid: true, amount: curse.value };
}

/**
 * Guard for /games command.
 * Returns true if blocked.
 */
async function guardGamesCommand(interaction) {
  const curse = await getCurse(interaction.guildId, interaction.user.id);
  if (!curse) return false;

  if (curse.kind === "blood_tax" || curse.kind === "games_fee") {
    const pay = await tryPayIfOwed(interaction.guildId, interaction.user.id, curse);

    if (!pay.ok) {
      const msg = `🩸 **${label(curse.kind)} owed:** **$${curse.value.toLocaleString()}**\n` +
        `Your balance: **$${(pay.balance ?? 0).toLocaleString()}**\n\n` +
        `Echo refuses you until the debt is paid.`;

      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ content: msg, flags: MessageFlags.Ephemeral });
        } else {
          await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
        }
      } catch {}
      return true;
    }

    if (pay.paid) {
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({
            content: `💸 Echo takes **$${pay.amount.toLocaleString()}** in tribute. You may proceed.`,
            flags: MessageFlags.Ephemeral,
          });
        }
      } catch {}
    }
  }

  return false;
}

/**
 * Guard for game component interactions.
 * Returns true if blocked.
 */
async function guardGamesComponent(interaction) {
  const curse = await getCurse(interaction.guildId, interaction.user.id);
  if (!curse) return false;

  if (curse.kind === "blood_tax" || curse.kind === "games_fee") {
    const pay = await tryPayIfOwed(interaction.guildId, interaction.user.id, curse);

    if (!pay.ok) {
      const msg = `🩸 **${label(curse.kind)} owed:** **$${curse.value.toLocaleString()}**\n` +
        `Echo blocks your games until you pay.`;

      try {
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
      } catch {
        try {
          await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral });
        } catch {}
      }
      return true;
    }

    if (pay.paid) {
      const msg = `💸 Echo takes **$${pay.amount.toLocaleString()}** in tribute. The games may continue.`;
      try {
        await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral });
      } catch {}
      return false;
    }
  }

  return false;
}

module.exports = {
  guardGamesCommand,
  guardGamesComponent,
};
