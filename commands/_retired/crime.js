// commands/crime.js
const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { pool } = require("../utils/db");
const {
  ensureUser,
  creditUser,
  tryDebitUser,
  addServerBank,
  getBalance,
} = require("../utils/economy");
const { guardNotJailed, setJail } = require("../utils/jail");

const COOLDOWN_MS = 15 * 60 * 1000;
const SUCCESS_CHANCE = 0.6;     // 60% success
const JAIL_CHANCE_ON_FAIL = 0.15; // 15% of failures lead to jail

const CRIME_SUCCESS = [
  "You committed fraud using your grandma’s name and earned **$%AMOUNT%**.",
  "You robbed a vending machine and earned **$%AMOUNT%**.",
  "You scammed someone on Marketplace and earned **$%AMOUNT%**.",
  "You ran an underground poker night and earned **$%AMOUNT%**.",
  "You hacked a toaster and somehow earned **$%AMOUNT%**.",
  "You boosted a car and earned **$%AMOUNT%**.",
  "You sold fake sneakers and earned **$%AMOUNT%**.",
  "You pulled off a heist so clean it was basically art — **$%AMOUNT%** earned.",
  "You laundered money through a car wash and earned **$%AMOUNT%**.",
  "You committed insurance fraud and earned **$%AMOUNT%**.",
  "You sold ‘limited edition’ air and earned **$%AMOUNT%**.",
  "You ran a dodgy crypto rugpull and earned **$%AMOUNT%**.",
];

const CRIME_FAIL = [
  "The police caught you mid-crime and fined you **$%AMOUNT%** 🚔.",
  "Your neighbour called the cops. You were fined **$%AMOUNT%**.",
  "You tripped while running away and got fined **$%AMOUNT%**.",
  "You were snitched on and fined **$%AMOUNT%**.",
  "The job went wrong. You paid **$%AMOUNT%** in legal fees.",
  "You robbed the wrong house. Fine: **$%AMOUNT%**.",
  "Your accomplice betrayed you. Fine: **$%AMOUNT%**.",
  "You forgot gloves. Big mistake. Fine: **$%AMOUNT%**.",
  "CCTV footage got you caught. Fine: **$%AMOUNT%**.",
  "The cops were already waiting. Fine: **$%AMOUNT%**.",
  "You tried to hotwire the car… it was an undercover cop’s. Fine: **$%AMOUNT%**.",
  "You attempted arson but set your own shoes on fire. Fine: **$%AMOUNT%**.",
];

const JAIL_LINES = [
  "You’re going to **jail**. Enjoy the complimentary bologna sandwich.",
  "You got locked up. The cellmate immediately claimed top bunk.",
  "Straight to jail. Do not pass GO. Do not collect vibes.",
  "The judge looked disappointed. Jail time.",
  "You’re in custody. Your lawyer has left you on read.",
  "You’ve been jailed. The cops took your shoelaces too.",
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function toUnix(date) {
  return Math.floor(date.getTime() / 1000);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("crime")
    .setDescription("Commit a crime for a chance at big money… or a fine (15 min cooldown)."),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.inGuild()) return interaction.editReply("❌ Server only.");

    // 🚔 Jail gate
    if (await guardNotJailed(interaction)) return;

    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    const key = "crime";

    await ensureUser(guildId, userId);

    const now = new Date();

    // 15m cooldown check
    const cd = await pool.query(
      `SELECT next_claim_at FROM cooldowns WHERE guild_id=$1 AND user_id=$2 AND key=$3`,
      [guildId, userId, key]
    );

    if (cd.rowCount > 0) {
      const next = new Date(cd.rows[0].next_claim_at);
      if (now < next) {
        const unix = Math.floor(next.getTime() / 1000);
        return interaction.editReply(`⏳ You can commit another crime <t:${unix}:R>.`);
      }
    }

    // Set base crime cooldown immediately (always)
    const crimeCooldownEnds = new Date(now.getTime() + COOLDOWN_MS);
    await pool.query(
      `INSERT INTO cooldowns (guild_id, user_id, key, next_claim_at)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (guild_id, user_id, key)
       DO UPDATE SET next_claim_at=EXCLUDED.next_claim_at`,
      [guildId, userId, key, crimeCooldownEnds]
    );

    const roll = Math.random();

    // ✅ SUCCESS (mint)
    if (roll < SUCCESS_CHANCE) {
      const amount = Math.floor(Math.random() * (5000 - 250 + 1)) + 250;
      await creditUser(guildId, userId, amount, "crime_success", {});
      const line = pick(CRIME_SUCCESS).replace("%AMOUNT%", amount.toLocaleString());
      return interaction.editReply(`🕵️ ${line}\n⏳ Next /crime: <t:${toUnix(crimeCooldownEnds)}:R>`);
    }

    // ❌ FAILURE → fine → server bank
    let fine = Math.floor(Math.random() * (3000 - 250 + 1)) + 250;

    const bal = await getBalance(guildId, userId);
    if (bal <= 0) {
      // Still might go to jail even if broke
      const jailRoll = Math.random();
      if (jailRoll < JAIL_CHANCE_ON_FAIL) {
        const extraMins = Math.floor(Math.random() * (30 - 5 + 1)) + 5;
        const jailEnds = new Date(now.getTime() + COOLDOWN_MS + extraMins * 60 * 1000);
        await setJail(guildId, userId, jailEnds);

        return interaction.editReply(
          `🚔 You got caught… but you’re broke. The cops laughed — then arrested you anyway.\n` +
          `🔒 ${pick(JAIL_LINES)}\n` +
          `⛓️ Release: <t:${toUnix(jailEnds)}:R>\n` +
          `⏳ /crime cooldown: <t:${toUnix(crimeCooldownEnds)}:R>`
        );
      }

      return interaction.editReply(
        `🚔 You got caught… but you’re broke. The cops just laughed and left.\n` +
        `⏳ /crime cooldown: <t:${toUnix(crimeCooldownEnds)}:R>`
      );
    }

    if (fine > bal) fine = bal;

    const debit = await tryDebitUser(guildId, userId, fine, "crime_fine", {});

    if (debit.ok) {
      await addServerBank(guildId, fine, "crime_fine_bank", {});
    }

    const failLine = pick(CRIME_FAIL).replace("%AMOUNT%", fine.toLocaleString());

    // 🎲 Jail chance on failures
    const jailRoll = Math.random();
    if (jailRoll < JAIL_CHANCE_ON_FAIL) {
      const extraMins = Math.floor(Math.random() * (30 - 5 + 1)) + 5;
      const jailEnds = new Date(now.getTime() + COOLDOWN_MS + extraMins * 60 * 1000);

      await setJail(guildId, userId, jailEnds);

      return interaction.editReply(
        `🚨 ${failLine}\n` +
        `🔒 ${pick(JAIL_LINES)}\n` +
        `⛓️ Release: <t:${toUnix(jailEnds)}:R>\n` +
        `⏳ /crime cooldown: <t:${toUnix(crimeCooldownEnds)}:R>`
      );
    }

    return interaction.editReply(
      `🚨 ${failLine}\n` +
      `⏳ /crime cooldown: <t:${toUnix(crimeCooldownEnds)}:R>`
    );
  },
};
