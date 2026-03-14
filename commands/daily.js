const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { pool } = require("../utils/db");
const { ensureUser } = require("../utils/economy");
const { creditUserWithEffects } = require("../utils/effectSystem");
const { guardNotJailed } = require("../utils/jail");

function nextSydneyMidnightUTC() {
  // Get "now" in Australia/Sydney, then compute next midnight there
  const now = new Date();

  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now).reduce((acc, p) => (acc[p.type] = p.value, acc), {});

  const y = Number(parts.year);
  const m = Number(parts.month);
  const d = Number(parts.day);

  // Next day at 00:00 Sydney time
  const next = new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0));

  // Convert that “Sydney midnight” into actual UTC instant
  const sydneyAtUTC = new Date(next.toLocaleString("en-US", { timeZone: "Australia/Sydney" }));
  const utcAtUTC = new Date(next.toLocaleString("en-US", { timeZone: "UTC" }));
  const offsetMs = sydneyAtUTC.getTime() - utcAtUTC.getTime();

  return new Date(next.getTime() - offsetMs);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("daily")
    .setDescription("Claim your daily bonus (resets at 12am AEDT)."),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({
        content: "❌ Server only.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
    }

    // 🚔 Jail gate: block /daily while jailed
    if (await guardNotJailed(interaction)) return;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

    // 🚔 Jail gate for /daily
    if (await guardNotJailed(interaction)) return;

    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    await ensureUser(guildId, userId);

    const now = new Date();
    const key = "daily";

    const cd = await pool.query(
      `SELECT next_claim_at FROM cooldowns WHERE guild_id=$1 AND user_id=$2 AND key=$3`,
      [guildId, userId, key]
    );

    if (cd.rowCount > 0) {
      const next = new Date(cd.rows[0].next_claim_at);
      if (now < next) {
        const unix = Math.floor(next.getTime() / 1000);
        return interaction.editReply(`⏳ You’ve already claimed. Come back <t:${unix}:R>.`);
      }
    }

    // 🎁 Daily payout range
    const min = 2500;
    const max = 5000;
    const amount = Math.floor(Math.random() * (max - min + 1)) + min;

    const nextClaim = nextSydneyMidnightUTC();

    await pool.query(
      `INSERT INTO cooldowns (guild_id, user_id, key, next_claim_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (guild_id, user_id, key) DO UPDATE SET next_claim_at=EXCLUDED.next_claim_at`,
      [guildId, userId, key, nextClaim]
    );

    const payout = await creditUserWithEffects({
      guildId,
      userId,
      amount,
      type: "daily",
      meta: { reset: "midnight_sydney" },
      activityEffects: module.exports.activityEffects,
      awardSource: "daily",
    });

    const lines = [
      `🎁 Daily claimed: **$${payout.finalAmount.toLocaleString()}** (resets at 12am AEDT).`,
    ];
    if (payout?.awardResult?.notice) lines.push('', payout.awardResult.notice);

    return interaction.editReply(lines.join('\n'));
  },

  activityEffects: {
    effectsApply: true,
    canAwardEffects: true,
    blockedBlessings: [],
    blockedCurses: [],
    effectAwardPool: {
      nothingWeight: 75,
      blessingWeight: 25,
      curseWeight: 0,
      blessingWeights: {},
      curseWeights: {},
    },
  },
};