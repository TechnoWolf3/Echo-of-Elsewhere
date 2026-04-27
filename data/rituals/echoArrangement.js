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

const ui = require("../../utils/ui");
const { pool } = require("../../utils/db");
const { nextSydneyMidnightUTC, getRitualStatus } = require("../../utils/rituals");
const { creditUserWithEffects } = require("../../utils/effectSystem");
const scenarios = require("./echoArrangementScenarios");

let recordProgress = async () => {};
try {
  ({ recordProgress } = require("../../utils/contracts"));
} catch (_) {}

const BTN_SUBMIT = "rituals:echo_arrangement:submit";
const BTN_GIVE_UP = "rituals:echo_arrangement:giveup";
const MODAL_PREFIX = "rituals:echo_arrangement:modal:";
const INPUT_ID = "order";
const SESSION_TTL_MS = 30 * 60 * 1000;
const CLEANUP_DELAY_MS = 90 * 1000;

const sessions = new Map();

function sessionKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function randomInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = randomInt(0, i);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function pick(list, fallback = "") {
  if (!Array.isArray(list) || !list.length) return fallback;
  return list[randomInt(0, list.length - 1)] || fallback;
}

function mistakeLimit(seatCount) {
  if (seatCount <= 5) return 2;
  if (seatCount <= 7) return 3;
  return 4;
}

function clueTarget(seatCount) {
  if (seatCount <= 5) return randomInt(3, 4);
  if (seatCount <= 7) return randomInt(4, 6);
  return randomInt(6, 8);
}

function formatClue(scenario, clue) {
  const templates = scenario.lines?.[clue.type] || [];
  return pick(templates, "{a} knows where to sit.")
    .replaceAll("{a}", clue.a)
    .replaceAll("{b}", clue.b || "")
    .replaceAll("{c}", clue.c || "")
    .replaceAll("{pos}", String(Number(clue.pos || 0) + 1));
}

function positions(order) {
  return new Map(order.map((name, idx) => [name, idx]));
}

function clueSatisfied(order, clue) {
  const pos = positions(order);
  const a = pos.get(clue.a);
  const b = clue.b ? pos.get(clue.b) : null;
  const c = clue.c ? pos.get(clue.c) : null;
  const last = order.length - 1;

  if (clue.type === "edge") return a === 0 || a === last;
  if (clue.type === "notEdge") return a > 0 && a < last;
  if (clue.type === "exact") return a === clue.pos;
  if (clue.type === "leftOf") return a < b;
  if (clue.type === "rightOf") return a > b;
  if (clue.type === "adjacent") return Math.abs(a - b) === 1;
  if (clue.type === "notAdjacent") return Math.abs(a - b) !== 1;
  if (clue.type === "between") return (b < a && a < c) || (c < a && a < b);
  if (clue.type === "distance") return Math.abs(a - b) === clue.distance;
  return true;
}

function partialOk(assign, clue, seatCount) {
  const a = assign.get(clue.a);
  const b = clue.b ? assign.get(clue.b) : null;
  const c = clue.c ? assign.get(clue.c) : null;
  const last = seatCount - 1;

  if (a != null) {
    if (clue.type === "edge" && a !== 0 && a !== last) return false;
    if (clue.type === "notEdge" && (a === 0 || a === last)) return false;
    if (clue.type === "exact" && a !== clue.pos) return false;
  }
  if (a != null && b != null) {
    if (clue.type === "leftOf" && !(a < b)) return false;
    if (clue.type === "rightOf" && !(a > b)) return false;
    if (clue.type === "adjacent" && Math.abs(a - b) !== 1) return false;
    if (clue.type === "notAdjacent" && Math.abs(a - b) === 1) return false;
    if (clue.type === "distance" && Math.abs(a - b) !== clue.distance) return false;
  }
  if (a != null && b != null && c != null && clue.type === "between") {
    if (!((b < a && a < c) || (c < a && a < b))) return false;
  }
  return true;
}

function countSolutions(names, clues, limit = 2) {
  const seatCount = names.length;
  const assignment = new Map();
  const usedSeats = new Set();
  const domains = new Map(names.map((name) => [name, Array.from({ length: seatCount }, (_, idx) => idx)]));

  for (const clue of clues) {
    if (clue.type === "exact") domains.set(clue.a, [clue.pos]);
    if (clue.type === "edge") domains.set(clue.a, domains.get(clue.a).filter((idx) => idx === 0 || idx === seatCount - 1));
    if (clue.type === "notEdge") domains.set(clue.a, domains.get(clue.a).filter((idx) => idx > 0 && idx < seatCount - 1));
  }

  const orderedNames = [...names].sort((a, b) => domains.get(a).length - domains.get(b).length);
  let found = 0;

  function search(depth) {
    if (found >= limit) return;
    if (depth >= orderedNames.length) {
      const order = new Array(seatCount);
      for (const [name, seat] of assignment.entries()) order[seat] = name;
      if (clues.every((clue) => clueSatisfied(order, clue))) found += 1;
      return;
    }

    const name = orderedNames[depth];
    for (const seat of domains.get(name)) {
      if (usedSeats.has(seat)) continue;
      assignment.set(name, seat);
      usedSeats.add(seat);
      const ok = clues.every((clue) => partialOk(assignment, clue, seatCount));
      if (ok) search(depth + 1);
      usedSeats.delete(seat);
      assignment.delete(name);
      if (found >= limit) return;
    }
  }

  search(0);
  return found;
}

function makeCandidateClues(answer) {
  const clues = [];
  const pos = positions(answer);
  const n = answer.length;
  for (const name of answer) {
    const idx = pos.get(name);
    if (idx === 0 || idx === n - 1) clues.push({ type: "edge", a: name });
    else clues.push({ type: "notEdge", a: name });
    clues.push({ type: "exact", a: name, pos: idx });
  }

  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      if (i === j) continue;
      const a = answer[i];
      const b = answer[j];
      if (i < j) clues.push({ type: "leftOf", a, b });
      if (i > j) clues.push({ type: "rightOf", a, b });
      if (Math.abs(i - j) === 1) clues.push({ type: "adjacent", a, b });
      else clues.push({ type: "notAdjacent", a, b });
      if (Math.abs(i - j) === 2) clues.push({ type: "distance", a, b, distance: 2 });
    }
  }

  for (let i = 1; i < n - 1; i += 1) {
    for (let left = 0; left < i; left += 1) {
      for (let right = i + 1; right < n; right += 1) {
        clues.push({ type: "between", a: answer[i], b: answer[left], c: answer[right] });
      }
    }
  }

  return shuffle(clues);
}

function clueWeight(clue, seatCount) {
  if (clue.type === "exact") return seatCount <= 6 ? 3 : 1;
  if (clue.type === "between" || clue.type === "distance") return seatCount >= 8 ? 8 : 5;
  if (clue.type === "adjacent") return 7;
  if (clue.type === "leftOf" || clue.type === "rightOf") return 5;
  if (clue.type === "notAdjacent") return 4;
  return 3;
}

function clueKey(clue) {
  return [clue.type, clue.a, clue.b || "", clue.c || "", clue.pos ?? "", clue.distance ?? ""].join(":");
}

function generatePuzzle() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const scenario = pick(scenarios, scenarios[0]);
    const seatCount = randomInt(5, 10);
    const names = shuffle(scenario.names).slice(0, seatCount);
    const answer = shuffle(names);
    const target = clueTarget(seatCount);
    const maxExact = seatCount <= 5 ? 1 : 0;
    const clues = [];
    const used = new Set();
    let exactUsed = 0;
    const candidates = makeCandidateClues(answer)
      .sort((a, b) => clueWeight(b, seatCount) - clueWeight(a, seatCount) + randomInt(-1, 1));

    for (const clue of candidates) {
      if (clue.type === "exact" && exactUsed >= maxExact) continue;
      const key = clueKey(clue);
      if (used.has(key)) continue;
      const next = [...clues, clue];
      if (!next.every((entry) => clueSatisfied(answer, entry))) continue;
      used.add(key);
      clues.push(clue);
      if (clue.type === "exact") exactUsed += 1;
      if (clues.length > target + 4) break;
      const unique = clues.length >= target && countSolutions(names, clues, 2) === 1;
      if (unique) {
        return {
          scenario,
          seatCount,
          names,
          answer,
          clues,
          clueTexts: clues.map((entry) => formatClue(scenario, entry)),
          mistakesAllowed: mistakeLimit(seatCount),
        };
      }
    }

    const fallback = buildFallbackClues(answer);
    if (countSolutions(names, fallback, 2) === 1) {
      return {
        scenario,
        seatCount,
        names,
        answer,
        clues: fallback,
        clueTexts: fallback.map((entry) => formatClue(scenario, entry)),
        mistakesAllowed: mistakeLimit(seatCount),
      };
    }
  }
  return null;
}

function buildFallbackClues(answer) {
  const clues = [];
  for (let i = 0; i < answer.length - 1; i += 1) {
    clues.push({ type: "leftOf", a: answer[i], b: answer[i + 1] });
  }
  if (answer.length >= 6) {
    clues.push({ type: "adjacent", a: answer[1], b: answer[2] });
  }
  return clues;
}

function pruneSessions() {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [key, session] of sessions.entries()) {
    if (!session || Number(session.updatedAt || 0) < cutoff) {
      if (session?.message) scheduleCleanup(session.message, 5000);
      sessions.delete(key);
    }
  }
}

function getSession(guildId, userId) {
  pruneSessions();
  return sessions.get(sessionKey(guildId, userId)) || null;
}

function getSessionByMessageId(messageId) {
  pruneSessions();
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

async function setCooldown(guildId, userId, nextClaimAt) {
  await pool.query(
    `INSERT INTO cooldowns (guild_id, user_id, key, next_claim_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (guild_id, user_id, key) DO UPDATE SET next_claim_at = EXCLUDED.next_claim_at`,
    [String(guildId), String(userId), "echo_arrangement", nextClaimAt]
  );
}

function seatLine(seatCount) {
  return Array.from({ length: seatCount }, (_, idx) => `[${idx + 1}]`).join(" ");
}

function buildEmbed(session, latest = null, reveal = false) {
  const embed = new EmbedBuilder()
    .setTitle(`Echo Seating - ${session.scenario.name}`)
    .setDescription(session.scenario.intro)
    .addFields(
      { name: "Seats", value: `\`${seatLine(session.seatCount)}\`` },
      { name: "Members", value: session.names.join(", ") },
      { name: "Clues", value: session.clueTexts.map((line) => `- ${line}`).join("\n").slice(0, 1024) },
      {
        name: "Submit Your Answer As",
        value: `\`${session.names.join(", ")}\`\nUse every listed name once, in seat order.`,
      },
      {
        name: "Mistakes Remaining",
        value: `**${Math.max(0, session.mistakesAllowed - session.mistakesUsed)} / ${session.mistakesAllowed}**`,
        inline: true,
      }
    );

  if (latest) embed.addFields({ name: "Latest Echo", value: String(latest).slice(0, 1024) });
  if (reveal) {
    embed.addFields(
      {
        name: "Your Order",
        value: session.lastSubmittedOrder?.length
          ? `\`${session.lastSubmittedOrder.join(", ")}\``
          : "No answer submitted.",
      },
      { name: "Correct Order", value: `\`${session.answer.join(", ")}\`` }
    );
  }
  ui.applySystemStyle(embed, "rituals");
  return embed;
}

function buildComponents(disabled = false) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(BTN_SUBMIT).setLabel("Submit Order").setStyle(ButtonStyle.Primary).setDisabled(disabled),
      new ButtonBuilder().setCustomId(BTN_GIVE_UP).setLabel("Give Up").setStyle(ButtonStyle.Danger).setDisabled(disabled)
    ),
  ];
}

function buildModal(userId) {
  return new ModalBuilder()
    .setCustomId(`${MODAL_PREFIX}${userId}`)
    .setTitle("Echo Seating Answer")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(INPUT_ID)
          .setLabel("Seat order")
          .setPlaceholder("Nyx, Axiom, Lume, Thorne, Virex")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
      )
    );
}

function normaliseName(value) {
  return String(value || "").trim().toLowerCase();
}

function parseAnswer(raw, names) {
  const text = String(raw || "").trim();
  if (!text) return { ok: false, reason: "Enter the full seating order." };
  const parts = text.includes(",")
    ? text.split(",").map((part) => part.trim()).filter(Boolean)
    : text.split(/\s+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length !== names.length) {
    return { ok: false, reason: `Enter exactly **${names.length}** names, preferably comma-separated.` };
  }

  const byName = new Map(names.map((name) => [normaliseName(name), name]));
  const seen = new Set();
  const order = [];
  for (const part of parts) {
    const key = normaliseName(part);
    const name = byName.get(key);
    if (!name) return { ok: false, reason: `Unknown name: **${part}**.` };
    if (seen.has(key)) return { ok: false, reason: `Duplicate name: **${name}**.` };
    seen.add(key);
    order.push(name);
  }
  return { ok: true, order };
}

function correctPositions(guess, answer) {
  let count = 0;
  for (let i = 0; i < answer.length; i += 1) {
    if (guess[i] === answer[i]) count += 1;
  }
  return count;
}

function rewardFor(session) {
  const base = 750 + session.seatCount * 350;
  const perfectMult = session.mistakesUsed === 0 ? 1.5 : 1;
  const mistakeMult = Math.max(0.5, 1 - session.mistakesUsed * 0.1);
  return Math.round(base * perfectMult * mistakeMult);
}

async function recordRitualContractProgress(guildId, userId, earnings = 0) {
  try {
    await recordProgress({ guildId, userId, metric: "rituals_completed", amount: 1 });
    if (earnings > 0) await recordProgress({ guildId, userId, metric: "ritual_earnings", amount: earnings });
  } catch (_) {}
}

function scheduleCleanup(message, delayMs = CLEANUP_DELAY_MS) {
  if (!message || typeof message.delete !== "function") return;
  setTimeout(() => message.delete().catch(() => {}), delayMs);
}

async function updateSessionMessage(session, interaction, payload) {
  const channel = interaction.channel || interaction.client?.channels?.cache?.get(session.channelId);
  const message = await channel?.messages?.fetch(session.messageId).catch(() => null);
  if (message) {
    await message.edit(payload).catch(() => {});
    return message;
  }
  return null;
}

async function finishSession(session, interaction, { solved, gaveUp = false } = {}) {
  const nextClaimAt = nextSydneyMidnightUTC();
  await setCooldown(session.guildId, session.userId, nextClaimAt);

  let payout = null;
  let amount = 0;
  if (solved) {
    amount = rewardFor(session);
    payout = await creditUserWithEffects({
      guildId: session.guildId,
      userId: session.userId,
      amount,
      type: "echo_arrangement",
      meta: { ritual: "echo_arrangement", reset: "daily", seatCount: session.seatCount, mistakesUsed: session.mistakesUsed },
      activityEffects: module.exports.successEffects,
      awardSource: "echo_arrangement",
    });
  }

  await recordRitualContractProgress(session.guildId, session.userId, payout?.finalAmount || 0);

  const flavor = solved ? pick(session.scenario.success) : pick(session.scenario.failure);
  const outcome = solved
    ? `Correct. ${flavor}\nReward: **${ui.money(payout?.finalAmount || amount)}**.${payout?.awardResult?.notice ? `\n\n${payout.awardResult.notice}` : ""}`
    : `${gaveUp ? "You gave up." : "No mistakes remain."} ${flavor}`;

  session.finished = true;
  const message = await updateSessionMessage(session, interaction, {
    embeds: [buildEmbed(session, outcome, true)],
    components: buildComponents(true),
  });
  scheduleCleanup(message || session.message);
  clearSession(session.guildId, session.userId);
  return true;
}

module.exports = {
  id: "echo_arrangement",
  placement: "other",
  interactive: true,
  type: "echo_arrangement",
  awardSource: "echo_arrangement",
  cooldownKey: "echo_arrangement",
  name: "Echo Arrangement",
  shortName: "Echo Seating",
  description: "Arrange 5-10 names into seats using daily logic clues.",
  nextClaimAt: nextSydneyMidnightUTC,
  claimText: () => "",
  cooldownText: ({ unix }) => `Echo Arrangement has already been completed today. Return <t:${unix}:R>.`,
  successEffects: {
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

  async begin(interaction) {
    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    const status = await getRitualStatus(guildId, userId, module.exports);
    if (!status.available) {
      await interaction.deferUpdate().catch(() => {});
      await interaction.followUp({ content: module.exports.cooldownText({ unix: status.unix }), flags: MessageFlags.Ephemeral }).catch(() => {});
      return true;
    }

    let session = getSession(guildId, userId);
    if (!session) {
      const puzzle = generatePuzzle();
      if (!puzzle) {
        await interaction.deferUpdate().catch(() => {});
        await interaction.followUp({ content: "Echo failed to settle a fair seating chart. Try again in a moment.", flags: MessageFlags.Ephemeral }).catch(() => {});
        return true;
      }
      session = setSession({
        guildId,
        userId,
        channelId: interaction.channelId,
        messageId: null,
        message: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        mistakesUsed: 0,
        finished: false,
        ...puzzle,
      });
    }

    await interaction.deferUpdate().catch(() => {});
    if (session.messageId) {
      await interaction.followUp({ content: "Your Echo Seating puzzle is already open. Finish it there.", flags: MessageFlags.Ephemeral }).catch(() => {});
      return true;
    }

    const message = await interaction.channel?.send({
      embeds: [buildEmbed(session)],
      components: buildComponents(false),
    }).catch(() => null);
    session.messageId = message?.id || null;
    session.message = message || null;
    session.channelId = message?.channelId || interaction.channelId;
    setSession(session);
    return true;
  },

  async handleInteraction(interaction) {
    const cid = String(interaction.customId || "");
    const isButton = interaction.isButton?.() && (cid === BTN_SUBMIT || cid === BTN_GIVE_UP);
    const isModal = interaction.isModalSubmit?.() && cid.startsWith(MODAL_PREFIX);
    if (!isButton && !isModal) return false;

    if (!interaction.inGuild()) {
      await interaction.reply({ content: "Server only.", flags: MessageFlags.Ephemeral }).catch(() => {});
      return true;
    }

    if (isButton) {
      const messageSession = getSessionByMessageId(interaction.message?.id);
      if (!messageSession) {
        await interaction.reply({ content: "That Echo Seating session has expired. Open a new one from /rituals.", flags: MessageFlags.Ephemeral }).catch(() => {});
        return true;
      }
      if (messageSession.userId !== interaction.user.id) {
        await interaction.reply({ content: `This Echo Seating puzzle belongs to <@${messageSession.userId}>.`, flags: MessageFlags.Ephemeral }).catch(() => {});
        return true;
      }
      if (cid === BTN_SUBMIT) {
        await interaction.showModal(buildModal(interaction.user.id)).catch(() => {});
        return true;
      }
      await interaction.deferUpdate().catch(() => {});
      return finishSession(messageSession, interaction, { solved: false, gaveUp: true });
    }

    const modalUserId = cid.slice(MODAL_PREFIX.length);
    if (modalUserId !== interaction.user.id) {
      await interaction.reply({ content: "This Echo Seating answer box belongs to someone else.", flags: MessageFlags.Ephemeral }).catch(() => {});
      return true;
    }

    const session = getSession(interaction.guildId, interaction.user.id);
    if (!session) {
      await interaction.reply({ content: "That Echo Seating session has expired. Open a new one from /rituals.", flags: MessageFlags.Ephemeral }).catch(() => {});
      return true;
    }

    const parsed = parseAnswer(interaction.fields.getTextInputValue(INPUT_ID), session.names);
    if (!parsed.ok) {
      await interaction.reply({
        content: `Invalid answer. ${parsed.reason}\nFormat example: \`${session.names.join(", ")}\``,
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return true;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
    const solved = parsed.order.join("|") === session.answer.join("|");
    session.lastSubmittedOrder = parsed.order;
    setSession(session);
    if (solved) {
      await finishSession(session, interaction, { solved: true });
      await interaction.deleteReply().catch(() => {});
      return true;
    }

    session.mistakesUsed += 1;
    setSession(session);
    if (session.mistakesUsed >= session.mistakesAllowed) {
      await finishSession(session, interaction, { solved: false });
      await interaction.deleteReply().catch(() => {});
      return true;
    }

    const correct = correctPositions(parsed.order, session.answer);
    const latest = `${pick(session.scenario.wrong)} **${correct}** position${correct === 1 ? "" : "s"} correct.`;
    await updateSessionMessage(session, interaction, {
      embeds: [buildEmbed(session, latest)],
      components: buildComponents(false),
    });
    await interaction.deleteReply().catch(() => {});
    return true;
  },
};
