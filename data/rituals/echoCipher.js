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

const { pool } = require("../../utils/db");
const { nextSydneyMidnightUTC, getRitualStatus } = require("../../utils/rituals");
const { creditUserWithEffects, awardEffect } = require("../../utils/effectSystem");
const { setJail } = require("../../utils/jail");

let recordProgress = async () => {};
try {
  ({ recordProgress } = require('../../utils/contracts'));
} catch (_) {}

async function recordRitualContractProgress(guildId, userId, earnings = 0) {
  try {
    await recordProgress({ guildId, userId, metric: 'rituals_completed', amount: 1 });
    const cash = Math.max(0, Math.floor(Number(earnings || 0)));
    if (cash > 0) {
      await recordProgress({ guildId, userId, metric: 'ritual_earnings', amount: cash });
    }
  } catch (_) {}
}

const SESSION_TTL_MS = 30 * 60 * 1000;
const CLEANUP_DELAY_MS = 60 * 1000;
const CODE_LENGTH = 5;
const MAX_ATTEMPTS = 6;

const BTN_GUESS = "rituals:cipher:guess";
const BTN_GIVE_UP = "rituals:cipher:giveup";
const MODAL_ID = "rituals:cipher:modal";
const INPUT_ID = "cipher_guess";

const sessions = new Map();

const REWARD_BY_ATTEMPT_USED = [100000, 85000, 70000, 55000, 45000, 35000];

function sessionKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function pruneSessions() {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [key, session] of sessions.entries()) {
    if (!session || Number(session.updatedAt || 0) < cutoff) sessions.delete(key);
  }
}

function randomCode(length = CODE_LENGTH) {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += String(Math.floor(Math.random() * 10));
  }
  return out;
}

function buildFeedback(secret, guess) {
  const markers = new Array(guess.length).fill("⬛");
  const secretCounts = new Map();
  let correctSpot = 0;
  let wrongSpot = 0;

  for (let i = 0; i < guess.length; i += 1) {
    if (guess[i] === secret[i]) {
      markers[i] = "🟩";
      correctSpot += 1;
    } else {
      const digit = secret[i];
      secretCounts.set(digit, (secretCounts.get(digit) || 0) + 1);
    }
  }

  for (let i = 0; i < guess.length; i += 1) {
    if (markers[i] === "🟩") continue;
    const digit = guess[i];
    const remaining = secretCounts.get(digit) || 0;
    if (remaining > 0) {
      markers[i] = "🟨";
      wrongSpot += 1;
      secretCounts.set(digit, remaining - 1);
    }
  }

  return {
    markers: markers.join(""),
    correctSpot,
    wrongSpot,
  };
}

function formatHistory(history = []) {
  if (!history.length) return "_No attempts logged yet._";
  return history
    .map((entry, idx) => `**${idx + 1}.** \`${entry.guess}\` → ${entry.markers} _(exact: ${entry.correctSpot}, misplaced: ${entry.wrongSpot})_`)
    .join("\n");
}

function buildComponents({ finished = false } = {}) {
  if (finished) return [];
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(BTN_GUESS).setLabel("Guess Code").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(BTN_GIVE_UP).setLabel("Give Up").setStyle(ButtonStyle.Danger)
    ),
  ];
}

function buildEmbed(session, latestMessage = null) {
  const attemptsUsed = Array.isArray(session.history) ? session.history.length : 0;
  const attemptsRemaining = Math.max(0, MAX_ATTEMPTS - attemptsUsed);

  const embed = new EmbedBuilder()
    .setColor(0x7a2bff)
    .setTitle("🔐 Echo Cipher")
    .setDescription(
      "A five-digit lock sits in front of you. Crack the sequence in **6 attempts**.\n\nDigits **can repeat**."
    )
    .addFields(
      { name: "Attempts", value: `Used: **${attemptsUsed}/${MAX_ATTEMPTS}**\nRemaining: **${attemptsRemaining}**`, inline: true },
      { name: "Reward", value: "Solve it for **$35,000 – $100,000** and a chance at a blessing.", inline: true },
      { name: "Failure", value: "Miss the code and Echo may answer with **jail**, a **curse**, or both.", inline: false },
      { name: "Attempt History", value: formatHistory(session.history) }
    )
    .setFooter({ text: "Enter a 5-digit code. Repeated digits are allowed." });

  if (latestMessage) {
    embed.addFields({ name: "Latest Result", value: String(latestMessage).slice(0, 1024) });
  }

  return embed;
}

function buildModal(userId) {
  return new ModalBuilder()
    .setCustomId(`${MODAL_ID}:${userId}`)
    .setTitle("Echo Cipher Guess")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(INPUT_ID)
          .setLabel("Enter your 5-digit guess")
          .setPlaceholder("e.g. 52741")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMinLength(CODE_LENGTH)
          .setMaxLength(CODE_LENGTH)
      )
    );
}

function getSession(guildId, userId) {
  pruneSessions();
  return sessions.get(sessionKey(guildId, userId)) || null;
}

function getSessionByMessageId(messageId) {
  pruneSessions();
  if (!messageId) return null;
  for (const session of sessions.values()) {
    if (session?.messageId === messageId) return session;
  }
  return null;
}

function setSession(session) {
  session.updatedAt = Date.now();
  sessions.set(sessionKey(session.guildId, session.userId), session);
  return session;
}

function clearSession(guildId, userId) {
  sessions.delete(sessionKey(guildId, userId));
}

function scheduleCleanup(message, delayMs = CLEANUP_DELAY_MS) {
  if (!message || typeof message.delete !== "function") return;
  setTimeout(() => {
    message.delete().catch(() => {});
  }, delayMs);
}

async function getSessionMessage(session, interaction) {
  const channel = interaction.channel || interaction.client?.channels?.cache?.get(session.channelId);
  if (!channel || typeof channel.messages?.fetch !== "function" || !session.messageId) return null;
  try {
    return await channel.messages.fetch(session.messageId);
  } catch {
    return null;
  }
}

async function updateSessionMessage(session, interaction, payload) {
  const message = await getSessionMessage(session, interaction);
  if (message) {
    await message.edit(payload).catch(() => {});
    return message;
  }
  return null;
}

async function setCooldown(guildId, userId, nextClaimAt) {
  await pool.query(
    `INSERT INTO cooldowns (guild_id, user_id, key, next_claim_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (guild_id, user_id, key) DO UPDATE SET next_claim_at = EXCLUDED.next_claim_at`,
    [String(guildId), String(userId), "echo_cipher", nextClaimAt]
  );
}

function jailLine(jailedUntil, minutes) {
  const ts = Math.floor(jailedUntil.getTime() / 1000);
  return `⛓️ Echo throws you in jail for **${minutes} minute${minutes === 1 ? "" : "s"}**. Release <t:${ts}:R>.`;
}

async function failSession({ session, interaction, reason }) {
  const jailMinutes = 5 + Math.floor(Math.random() * 6);
  const jailedUntil = await setJail(session.guildId, session.userId, jailMinutes);
  const curseRoll = Math.random();
  let curseNotice = null;

  if (curseRoll < 0.85) {
    const curseOptions = ["echo_curse_minor_percent", "echo_curse_minor_flat"];
    const effectId = curseOptions[Math.floor(Math.random() * curseOptions.length)];
    const award = await awardEffect(session.guildId, session.userId, effectId, { source: "echo_cipher_fail" });
    curseNotice = award?.notice || null;
  }

  const nextClaimAt = nextSydneyMidnightUTC();
  await setCooldown(session.guildId, session.userId, nextClaimAt);

  await recordRitualContractProgress(session.guildId, session.userId, 0);

  const lines = [
    reason || "❌ The lock slams shut before you can break it.",
    `The code was **${session.secret}**.`,
    jailLine(jailedUntil, jailMinutes),
  ];
  if (curseNotice) lines.push("", curseNotice);

  const message = await updateSessionMessage(session, interaction, {
    embeds: [buildEmbed({ ...session, finished: true }, lines.join("\n"))],
    components: [],
  });

  clearSession(session.guildId, session.userId);
  scheduleCleanup(message);
  return true;
}

async function winSession({ session, interaction }) {
  const attemptsUsed = Math.max(1, session.history.length);
  const amount = REWARD_BY_ATTEMPT_USED[Math.min(REWARD_BY_ATTEMPT_USED.length - 1, attemptsUsed - 1)] || 35000;
  const nextClaimAt = nextSydneyMidnightUTC();
  await setCooldown(session.guildId, session.userId, nextClaimAt);

  const payout = await creditUserWithEffects({
    guildId: session.guildId,
    userId: session.userId,
    amount,
    type: "echo_cipher",
    meta: { ritual: "echo_cipher", reset: "daily", attemptsUsed },
    activityEffects: module.exports.successEffects,
    awardSource: "echo_cipher",
  });

  await recordRitualContractProgress(session.guildId, session.userId, payout.finalAmount || amount);

  const lines = [
    `✅ The vault opens. You cracked the code in **${attemptsUsed}/${MAX_ATTEMPTS}** attempts.`,
    `Echo grants **$${Number(payout.finalAmount || amount).toLocaleString()}**.`,
  ];
  if (payout?.awardResult?.notice) lines.push("", payout.awardResult.notice);

  const message = await updateSessionMessage(session, interaction, {
    embeds: [buildEmbed({ ...session, finished: true }, lines.join("\n"))],
    components: [],
  });

  clearSession(session.guildId, session.userId);
  scheduleCleanup(message);
  return true;
}

module.exports = {
  id: "echo_cipher",
  placement: "other",
  interactive: true,
  type: "echo_cipher",
  awardSource: "echo_cipher",
  cooldownKey: "echo_cipher",
  name: "Echo Cipher",
  shortName: "Echo Cipher",
  description: "Crack a five-digit lock once per day before Echo decides you belong in a cell. Digits may repeat.",
  nextClaimAt: nextSydneyMidnightUTC,
  claimText: () => "",
  cooldownText: ({ unix }) => `⏳ **Echo Cipher** has already been completed. Return <t:${unix}:R>.`,
  successEffects: {
    effectsApply: true,
    canAwardEffects: true,
    blockedBlessings: [],
    blockedCurses: [],
    effectAwardPool: {
      nothingWeight: 65,
      blessingWeight: 35,
      curseWeight: 0,
      blessingWeights: {},
      curseWeights: {},
    },
  },

  async begin(interaction) {
    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    const status = await getRitualStatus(guildId, userId, module.exports);

    if (!status.available) {
      await interaction.deferUpdate().catch(() => {});
      await interaction.editReply({
        embeds: [buildEmbed({ guildId, userId, history: [] }, module.exports.cooldownText({ unix: status.unix, nextClaimAt: status.nextClaimAt }))],
        components: [],
      }).catch(() => {});
      return true;
    }

    let session = getSession(guildId, userId);
    if (!session) {
      session = setSession({
        guildId,
        userId,
        secret: randomCode(),
        history: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    await interaction.deferUpdate().catch(() => {});

    const existingMessage = await getSessionMessage(session, interaction);
    if (existingMessage) {
      await existingMessage.edit({
        embeds: [buildEmbed(session)],
        components: buildComponents(),
      }).catch(() => {});
      return true;
    }

    const publicMessage = await interaction.channel?.send({
      embeds: [buildEmbed(session)],
      components: buildComponents(),
    }).catch(() => null);

    if (publicMessage) {
      session.channelId = publicMessage.channelId;
      session.messageId = publicMessage.id;
      setSession(session);
    }

    return true;
  },

  async handleInteraction(interaction) {
    const cid = String(interaction.customId || "");
    const isCipherButton = interaction.isButton?.() && (cid === BTN_GUESS || cid === BTN_GIVE_UP);
    const isCipherModal = interaction.isModalSubmit?.() && cid.startsWith(`${MODAL_ID}:`);
    if (!isCipherButton && !isCipherModal) return false;

    if (!interaction.inGuild()) {
      await interaction.reply({ content: "❌ Server only.", flags: MessageFlags.Ephemeral }).catch(() => {});
      return true;
    }

    const guildId = interaction.guildId;
    const userId = interaction.user.id;

    if (interaction.isButton()) {
      const messageSession = getSessionByMessageId(interaction.message?.id);
      if (!messageSession) {
        await interaction.reply({
          content: "❌ That Echo Cipher session is gone. Open it again from **/rituals**.",
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
        return true;
      }

      if (messageSession.userId !== userId) {
        await interaction.reply({
          content: "❌ This Echo Cipher belongs to someone else.",
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
        return true;
      }

      const session = getSession(guildId, userId);
      if (!session) {
        await interaction.reply({
          content: "❌ That Echo Cipher session is gone. Open it again from **/rituals**.",
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
        return true;
      }

      if (cid === BTN_GUESS) {
        await interaction.showModal(buildModal(userId)).catch(() => {});
        return true;
      }

      if (cid === BTN_GIVE_UP) {
        await interaction.deferUpdate().catch(() => {});
        return failSession({
          session,
          interaction,
          reason: "❌ You abandoned the cipher. Echo decides that counts as failure.",
        });
      }
    }

    if (interaction.isModalSubmit()) {
      const modalUserId = cid.split(":").pop();
      if (modalUserId !== userId) {
        await interaction.reply({
          content: "❌ This Echo Cipher belongs to someone else.",
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
        return true;
      }

      const session = getSession(guildId, userId);
      if (!session) {
        await interaction.reply({
          content: "❌ That Echo Cipher session is gone. Open it again from **/rituals**.",
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
        return true;
      }

      const rawGuess = String(interaction.fields.getTextInputValue(INPUT_ID) || "").trim();
      if (!/^\d{5}$/.test(rawGuess)) {
        await interaction.reply({
          content: "❌ Enter exactly **5 digits**.",
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
        return true;
      }

      if (session.history.some((entry) => entry.guess === rawGuess)) {
        await interaction.reply({
          content: "❌ You already tried that code. Use a different guess.",
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
        return true;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

      const feedback = buildFeedback(session.secret, rawGuess);
      session.history.push({ guess: rawGuess, ...feedback });
      setSession(session);

      if (rawGuess === session.secret) {
        await winSession({ session, interaction });
        await interaction.deleteReply().catch(() => {});
        return true;
      }

      if (session.history.length >= MAX_ATTEMPTS) {
        await failSession({
          session,
          interaction,
          reason: "❌ Six attempts spent. The lock slams shut.",
        });
        await interaction.deleteReply().catch(() => {});
        return true;
      }

      const latest = `\`${rawGuess}\` → ${feedback.markers}\nExact digits: **${feedback.correctSpot}** • Misplaced digits: **${feedback.wrongSpot}**`;
      await updateSessionMessage(session, interaction, {
        embeds: [buildEmbed(session, latest)],
        components: buildComponents(),
      });

      await interaction.deleteReply().catch(() => {});
      return true;
    }

    return false;
  },
};
