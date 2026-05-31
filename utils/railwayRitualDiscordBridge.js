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

const railwayApi = require("./railwayApiClient");
const ui = require("./ui");
const { getDisplayProfile } = require("./displayProfile");

const PREFIX = "rr";

function customId(...parts) {
  return [PREFIX, ...parts].map((part) => String(part ?? "")).join(":");
}

function parseCustomId(value) {
  const parts = String(value || "").split(":");
  if (parts[0] !== PREFIX) return null;
  return {
    kind: parts[1] || "",
    sessionId: parts[2] || "",
    action: parts[3] || "",
    value: parts[4] || "",
  };
}

function isRailwayRitualInteraction(interaction) {
  const cid = String(interaction.customId || "");
  return cid.startsWith(`${PREFIX}:`);
}

function money(value) {
  return ui.money ? ui.money(value) : `$${Number(value || 0).toLocaleString("en-AU")}`;
}

function text(value, fallback = "-") {
  const out = String(value ?? "").trim();
  return out || fallback;
}

function truncate(value, max = 1024) {
  const out = text(value, "");
  return out.length > max ? `${out.slice(0, max - 3)}...` : out;
}

function addLatest(embed, message) {
  if (message) embed.addFields({ name: "Latest Echo", value: truncate(message, 1024) });
}

function profileLine(profile) {
  if (!profile) return null;
  const displayProfile = getDisplayProfile(profile);
  const wallet = displayProfile.walletBalance ?? displayProfile.balance;
  const bank = displayProfile.bankBalance;
  if (wallet == null && bank == null) return null;
  return `Wallet: **${money(wallet)}**${bank == null ? "" : ` | Bank: **${money(bank)}**`}`;
}

function row(...buttons) {
  const filtered = buttons.filter(Boolean).slice(0, 5);
  return filtered.length ? new ActionRowBuilder().addComponents(filtered) : null;
}

function button(label, id, style = ButtonStyle.Primary, disabled = false) {
  return new ButtonBuilder()
    .setCustomId(id)
    .setLabel(String(label).slice(0, 80))
    .setStyle(style)
    .setDisabled(Boolean(disabled));
}

function navRow(session) {
  return row(
    button("Refresh", customId("a", session.sessionId, "refresh"), ButtonStyle.Secondary, session.status !== "active"),
    button("Back to Rituals", customId("a", session.sessionId, "back"), ButtonStyle.Secondary)
  );
}

function renderWheel(session, message, profile) {
  const embed = new EmbedBuilder()
    .setTitle("Echo Wheel")
    .setDescription(`Step up, pay **${money(session.cost || 10000)}**, and let Echo decide what kind of day you are having.`)
    .addFields(
      { name: "Cost", value: `${money(session.cost || 10000)} from wallet`, inline: true },
      { name: "Status", value: session.status, inline: true },
      { name: "Free Spin", value: session.canRespin ? "Ready" : "No", inline: true }
    );
  if (session.lastResult) {
    embed.addFields({
      name: "Last Result",
      value: truncate(`**${session.lastResult.title || session.lastResult.label || session.lastResult.result}**\n${session.lastResult.message || ""}`),
    });
  }
  addLatest(embed, message);
  const pLine = profileLine(profile);
  if (pLine) embed.addFields({ name: "Ledger", value: pLine });
  ui.applySystemStyle(embed, "rituals");
  return {
    embeds: [embed],
    components: [
      row(button(session.canRespin ? "Use Free Spin" : `Spin for ${money(session.cost || 10000)}`, customId("a", session.sessionId, "spin"), ButtonStyle.Primary, session.status !== "active")),
      navRow(session),
    ].filter(Boolean),
  };
}

function renderCipher(session, message, profile) {
  const history = Array.isArray(session.history) ? session.history : [];
  const historyText = history.length
    ? history.map((entry, idx) => {
        const markers = Array.isArray(entry.markers) ? entry.markers.join(" ") : text(entry.markers, "");
        return `**${idx + 1}.** \`${entry.guess}\` -> ${markers} _(exact ${entry.correctSpot}, misplaced ${entry.wrongSpot})_`;
      }).join("\n")
    : "_No attempts logged yet._";
  const embed = new EmbedBuilder()
    .setTitle("Echo Cipher")
    .setDescription("Crack the five-digit lock. Digits can repeat.")
    .addFields(
      { name: "Attempts", value: `Used: **${session.attemptsUsed || 0}/${session.maxAttempts || 6}**\nRemaining: **${session.attemptsRemaining ?? 6}**`, inline: true },
      { name: "History", value: truncate(historyText) }
    );
  if (session.result) embed.addFields({ name: "Result", value: truncate(JSON.stringify(session.result)) });
  addLatest(embed, message);
  const pLine = profileLine(profile);
  if (pLine) embed.addFields({ name: "Ledger", value: pLine });
  ui.applySystemStyle(embed, "rituals");
  return {
    embeds: [embed],
    components: [
      row(
        button("Guess Code", customId("a", session.sessionId, "guess_modal"), ButtonStyle.Primary, session.status !== "active"),
        button("Give Up", customId("a", session.sessionId, "give_up"), ButtonStyle.Danger, session.status !== "active")
      ),
      navRow(session),
    ].filter(Boolean),
  };
}

function renderVeil(session, message, profile) {
  const placements = Array.isArray(session.placements) ? session.placements : [];
  const board = placements.map((value, idx) => `[${value == null ? ` ${idx + 1} ` : String(value).padStart(3, " ")}]`).join(" ");
  const embed = new EmbedBuilder()
    .setTitle("Veil Sequence")
    .setDescription("Place each revealed fragment into its final ascending-order slot. Once placed, it locks.")
    .addFields(
      { name: "Your Order", value: `\`${board}\`` },
      { name: session.status === "active" ? "Current Fragment" : "Sequence Complete", value: session.status === "active" ? `**${session.currentFragment ?? "-"}**` : "The veil has resolved." },
      { name: "Progress", value: `Placed: **${session.step || 0}/${session.slotCount || 5}**\nRemaining: **${session.remaining ?? 0}**`, inline: true }
    );
  if (session.result) embed.addFields({ name: "Result", value: truncate(JSON.stringify(session.result)) });
  addLatest(embed, message);
  const pLine = profileLine(profile);
  if (pLine) embed.addFields({ name: "Ledger", value: pLine });
  ui.applySystemStyle(embed, "rituals");
  const slotButtons = [];
  for (let i = 0; i < (session.slotCount || 5); i += 1) {
    slotButtons.push(button(String(i + 1), customId("a", session.sessionId, "place", i + 1), ButtonStyle.Primary, session.status !== "active" || placements[i] != null));
  }
  return {
    embeds: [embed],
    components: [row(...slotButtons), navRow(session)].filter(Boolean),
  };
}

function renderBlade(session, message, profile) {
  const embed = new EmbedBuilder()
    .setTitle("Blade Grid")
    .setDescription("Pick one square. One row and one column will be struck. If either crosses your square, you lose.")
    .addFields(
      { name: "Grid", value: `${session.rows || 3} rows x ${session.cols || 5} columns`, inline: true },
      { name: "Reward", value: `${money(session.rewardRange?.min || 60000)}-${money(session.rewardRange?.max || 90000)}`, inline: true }
    );
  if (session.result) {
    embed.addFields({
      name: "Result",
      value: truncate(`Selected tile: **${session.selectedTile}**\nStrike row: **${Number(session.strikeRow) + 1}**\nStrike column: **${Number(session.strikeCol) + 1}**\n${JSON.stringify(session.result)}`),
    });
  }
  addLatest(embed, message);
  const pLine = profileLine(profile);
  if (pLine) embed.addFields({ name: "Ledger", value: pLine });
  ui.applySystemStyle(embed, "rituals");
  const components = [];
  const rows = Number(session.rows || 3);
  const cols = Number(session.cols || 5);
  for (let r = 0; r < rows; r += 1) {
    const buttons = [];
    for (let c = 0; c < cols; c += 1) {
      const tile = r * cols + c + 1;
      buttons.push(button(String(tile), customId("a", session.sessionId, "choose_tile", tile), ButtonStyle.Secondary, session.status !== "active"));
    }
    components.push(row(...buttons));
  }
  components.push(navRow(session));
  return { embeds: [embed], components: components.filter(Boolean) };
}

function renderArrangement(session, message, profile) {
  const names = Array.isArray(session.names) ? session.names : [];
  const clues = Array.isArray(session.clues) ? session.clues : [];
  const embed = new EmbedBuilder()
    .setTitle(`Echo Seating - ${session.scenario?.name || "Arrangement"}`)
    .setDescription(session.scenario?.intro || "Arrange the names into the correct seat order.")
    .addFields(
      { name: "Seats", value: `\`${(session.seats || []).map((n) => `[${n}]`).join(" ")}\`` || "-", inline: false },
      { name: "Members", value: truncate(names.join(", ")) },
      { name: "Clues", value: truncate(clues.map((line) => `- ${line}`).join("\n")) },
      { name: "Mistakes Remaining", value: `**${Math.max(0, Number(session.mistakesAllowed || 0) - Number(session.mistakesUsed || 0))}/${session.mistakesAllowed || 0}**`, inline: true }
    );
  if (session.lastFeedback) embed.addFields({ name: "Latest Seating", value: truncate(session.lastFeedback.message || JSON.stringify(session.lastFeedback)) });
  if (session.result) embed.addFields({ name: "Result", value: truncate(JSON.stringify(session.result)) });
  addLatest(embed, message);
  const pLine = profileLine(profile);
  if (pLine) embed.addFields({ name: "Ledger", value: pLine });
  ui.applySystemStyle(embed, "rituals");
  return {
    embeds: [embed],
    components: [
      row(
        button("Submit Order", customId("a", session.sessionId, "submit_modal"), ButtonStyle.Primary, session.status !== "active"),
        button("Give Up", customId("a", session.sessionId, "give_up"), ButtonStyle.Danger, session.status !== "active")
      ),
      navRow(session),
    ].filter(Boolean),
  };
}

function renderPayload(apiResult) {
  const session = apiResult?.session || apiResult;
  const message = apiResult?.message || "";
  const profile = apiResult?.profile || null;
  if (!session) return { content: message || "Ritual session unavailable.", embeds: [], components: [] };
  if (session.ritualId === "echo_wheel") return renderWheel(session, message, profile);
  if (session.ritualId === "echo_cipher") return renderCipher(session, message, profile);
  if (session.ritualId === "veil_sequence") return renderVeil(session, message, profile);
  if (session.ritualId === "blade_grid") return renderBlade(session, message, profile);
  if (session.ritualId === "echo_arrangement") return renderArrangement(session, message, profile);
  return { content: message || "Unknown ritual session.", embeds: [], components: [] };
}

function guessModal(sessionId) {
  return new ModalBuilder()
    .setCustomId(customId("m", sessionId, "guess"))
    .setTitle("Echo Cipher Guess")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("guess")
          .setLabel("Enter your 5-digit guess")
          .setPlaceholder("52741")
          .setMinLength(5)
          .setMaxLength(5)
          .setRequired(true)
          .setStyle(TextInputStyle.Short)
      )
    );
}

function seatingModal(sessionId) {
  return new ModalBuilder()
    .setCustomId(customId("m", sessionId, "submit"))
    .setTitle("Echo Seating Answer")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("order")
          .setLabel("Seat order")
          .setPlaceholder("Nyx, Axiom, Lume, Thorne, Virex")
          .setRequired(true)
          .setStyle(TextInputStyle.Paragraph)
      )
    );
}

async function editFromInteraction(interaction, payload) {
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload).catch(async () => {
      if (interaction.message?.edit) await interaction.message.edit(payload).catch(() => {});
    });
    return;
  }
  if (interaction.update) {
    await interaction.update(payload).catch(async () => {
      await interaction.reply({ content: "Ritual updated.", flags: MessageFlags.Ephemeral }).catch(() => {});
    });
  }
}

async function startSession(interaction, ritualId) {
  await interaction.deferUpdate().catch(() => {});
  const result = await railwayApi.startRitualSession(interaction, ritualId);
  await editFromInteraction(interaction, renderPayload(result));
  return true;
}

async function handleInteraction(interaction, { buildHubPayload } = {}) {
  const parsed = parseCustomId(interaction.customId);
  if (!parsed) return false;

  try {
    if (parsed.kind === "a") {
      if (parsed.action === "guess_modal") {
        await interaction.showModal(guessModal(parsed.sessionId)).catch(() => {});
        return true;
      }
      if (parsed.action === "submit_modal") {
        await interaction.showModal(seatingModal(parsed.sessionId)).catch(() => {});
        return true;
      }
      if (parsed.action === "back") {
        await interaction.deferUpdate().catch(() => {});
        const payload = buildHubPayload
          ? await buildHubPayload(interaction.guildId, interaction.user.id)
          : { content: "Back to rituals.", embeds: [], components: [] };
        await editFromInteraction(interaction, payload);
        return true;
      }

      await interaction.deferUpdate().catch(() => {});
      let result;
      if (parsed.action === "refresh") {
        result = await railwayApi.getRitualSession(interaction, parsed.sessionId);
      } else {
        const body = { action: parsed.action };
        if (parsed.action === "place") body.slot = Number(parsed.value);
        if (parsed.action === "choose_tile") body.tile = Number(parsed.value);
        result = await railwayApi.ritualSessionAction(interaction, parsed.sessionId, body);
      }
      await editFromInteraction(interaction, renderPayload(result));
      return true;
    }

    if (parsed.kind === "m") {
      await interaction.deferUpdate().catch(async () => {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
      });
      const body = parsed.action === "guess"
        ? { action: "guess", guess: interaction.fields.getTextInputValue("guess") }
        : { action: "submit", order: interaction.fields.getTextInputValue("order") };
      const result = await railwayApi.ritualSessionAction(interaction, parsed.sessionId, body);
      await editFromInteraction(interaction, renderPayload(result));
      return true;
    }
  } catch (error) {
    const message = error?.message || "Railway could not update that ritual.";
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: message, embeds: [], components: [] }).catch(() => {});
    } else {
      await interaction.reply({ content: message, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    return true;
  }

  return false;
}

module.exports = {
  isRailwayRitualInteraction,
  startSession,
  handleInteraction,
  renderPayload,
};
