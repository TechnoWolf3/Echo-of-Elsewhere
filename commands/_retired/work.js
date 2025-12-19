// commands/work.js
const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { pool } = require("../utils/db");
const { ensureUser, creditUser } = require("../utils/economy");
const { guardNotJailed } = require("../utils/jail");

const COOLDOWN_MS = 15 * 60 * 1000;

const WORK_LINES = [
  "You worked in the office today and received **$%AMOUNT%**.",
  "You clocked in, pretended to be busy, and received **$%AMOUNT%**.",
  "You worked overtime and received **$%AMOUNT%**.",
  "You answered emails no one reads and received **$%AMOUNT%**.",
  "You filled out spreadsheets and received **$%AMOUNT%**.",
  "You worked retail and questioned your life choices for **$%AMOUNT%**.",
  "You did honest work and received **$%AMOUNT%**.",
  "You helped an old lady cross the street and somehow received **$%AMOUNT%**.",
  "You flipped burgers with passion and received **$%AMOUNT%**.",
  "You worked the night shift and received **$%AMOUNT%**.",
  "You sold your ass on the corner and earned **$%AMOUNT%** 😏",
  "You streamed to 3 viewers and received **$%AMOUNT%**.",
  "You worked from home and took 7 breaks — **$%AMOUNT%** earned.",
  "You did absolutely nothing productive but still received **$%AMOUNT%**.",
  "You survived another day at work and received **$%AMOUNT%**.",
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("work")
    .setDescription("Do some work and earn money (15 min cooldown)."),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.inGuild()) return interaction.editReply("❌ Server only.");

    // 🚔 Jail gate (blocks all economy commands while jailed)
    if (await guardNotJailed(interaction)) return;

    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    const key = "work";

    await ensureUser(guildId, userId);

    const now = new Date();
    const cd = await pool.query(
      `SELECT next_claim_at FROM cooldowns WHERE guild_id=$1 AND user_id=$2 AND key=$3`,
      [guildId, userId, key]
    );

    if (cd.rowCount > 0) {
      const next = new Date(cd.rows[0].next_claim_at);
      if (now < next) {
        const unix = Math.floor(next.getTime() / 1000);
        return interaction.editReply(`⏳ You can work again <t:${unix}:R>.`);
      }
    }

    const amount = Math.floor(Math.random() * (1500 - 500 + 1)) + 250;
    const next = new Date(now.getTime() + COOLDOWN_MS);

    await pool.query(
      `INSERT INTO cooldowns (guild_id, user_id, key, next_claim_at)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (guild_id, user_id, key)
       DO UPDATE SET next_claim_at=EXCLUDED.next_claim_at`,
      [guildId, userId, key, next]
    );

    // /work mints currency (does NOT touch server bank)
    await creditUser(guildId, userId, amount, "work", {});

    const line = pick(WORK_LINES).replace("%AMOUNT%", amount.toLocaleString());
    return interaction.editReply(`💼 ${line}`);
  },
};
