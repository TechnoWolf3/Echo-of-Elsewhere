// utils/echoCurses.js
  // Echo Rift / Blood Tax support utilities.
  //
  // - Stores temporary "curses" that can block features (/games, botgames events, rifts, etc.)
  // - Provides a standardized prompt to pay Blood Tax, or (if broke) accept jail instead.
  //
  // NOTE: This is intentionally self-contained and safe to call from commands and component handlers.

  const { pool } = require("./db");
  const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
  const economy = require("./economy");
  const jail = require("./jail");

  const CURSE_TYPES = {
    BLOOD_TAX: "blood_tax",
    FEES_LOCK: "fees_lock",
    GAMES_LOCK: "games_lock",
  };

  // Buttons
  const BTN_PAY = "bloodtax:pay";
  const BTN_JAIL = "bloodtax:jail";

  // Jail conversion: roughly 1 hour per $5,000 owed (min 2h, max 72h)
  function jailMinutesForDebt(amount) {
    const hours = Math.ceil(Math.max(1, amount) / 5000); // 1h per 5k
    const clamped = Math.max(2, Math.min(72, hours));    // 2h..72h
    return clamped * 60;
  }

  async function ensureTables() {
    // Best-effort: in case init missed it (should exist via index.js init).
    await pool.query(`
      CREATE TABLE IF NOT EXISTS echo_curses (
        guild_id TEXT NOT NULL,
        user_id  TEXT NOT NULL,
        type     TEXT NOT NULL,
        amount   BIGINT NOT NULL DEFAULT 0,
        expires_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (guild_id, user_id, type)
      );
      CREATE INDEX IF NOT EXISTS echo_curses_user_idx
        ON echo_curses (guild_id, user_id);
    `);
  }

  async function getCurse(guildId, userId, type) {
    await ensureTables();
    const res = await pool.query(
      `SELECT type, amount, expires_at
       FROM echo_curses
       WHERE guild_id=$1 AND user_id=$2 AND type=$3`,
      [String(guildId), String(userId), String(type)]
    );
    const row = res.rows[0];
    if (!row) return null;

    // Auto-expire
    if (row.expires_at && new Date(row.expires_at) <= new Date()) {
      await clearCurse(guildId, userId, type);
      return null;
    }

    return {
      type: row.type,
      amount: Number(row.amount || 0),
      expiresAt: row.expires_at ? new Date(row.expires_at) : null,
    };
  }

  async function setCurse(guildId, userId, type, { amount = 0, expiresAt = null } = {}) {
    await ensureTables();
    await pool.query(
      `INSERT INTO echo_curses (guild_id, user_id, type, amount, expires_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,NOW())
       ON CONFLICT (guild_id, user_id, type)
       DO UPDATE SET amount=EXCLUDED.amount, expires_at=EXCLUDED.expires_at, updated_at=NOW()`,
      [
        String(guildId),
        String(userId),
        String(type),
        Math.max(0, Number(amount || 0)),
        expiresAt ? new Date(expiresAt) : null,
      ]
    );
  }

  async function clearCurse(guildId, userId, type) {
    await ensureTables();
    await pool.query(
      `DELETE FROM echo_curses WHERE guild_id=$1 AND user_id=$2 AND type=$3`,
      [String(guildId), String(userId), String(type)]
    );
  }

  function buildTaxEmbed({ amount, canAfford, extraLine }) {
    const embed = new EmbedBuilder()
      .setTitle("🩸 Blood Tax")
      .setDescription(
        [
          "Echo’s voice is calm — which is somehow worse.",
          "",
          `**Debt:** $${Number(amount).toLocaleString()}`,
          canAfford ? "You *can* afford it. You just don’t want to." : "You **can’t** afford it. Echo finds this… entertaining.",
          extraLine ? `\n${extraLine}` : "",
        ].filter(Boolean).join("\n")
      );

    if (!canAfford) {
      embed.addFields({
        name: "Alternative",
        value:
          "If you’re broke, you can choose to **serve time** instead.\n" +
          "_Echo does not accept IOUs._",
        inline: false,
      });
    }

    return embed;
  }

  async function replyOrEdit(interaction, payload) {
    try {
      if (interaction.deferred || interaction.replied) {
        return await interaction.editReply(payload);
      }
      return await interaction.reply(payload);
    } catch {
      // Ignore
    }
  }

  /**
   * Gate helper for slash commands (/games, etc.)
   * Returns true if blocked.
   */
  async function guardBloodTaxCommand(interaction, { contextLabel = "that" } = {}) {
    if (!interaction?.inGuild?.()) return false;

    const curse = await getCurse(interaction.guildId, interaction.user.id, CURSE_TYPES.BLOOD_TAX);
    if (!curse) return false;

    const amount = curse.amount;
    const balance = await economy.getBalance(interaction.guildId, interaction.user.id);
    const canAfford = balance >= amount;

    const rows = [];
    if (canAfford) {
      rows.push(
        new ButtonBuilder().setCustomId(BTN_PAY).setStyle(ButtonStyle.Danger).setLabel("Pay Tribute").setEmoji("🩸")
      );
    } else {
      // If they can't afford, still show Pay (disabled) + Jail option
      rows.push(
        new ButtonBuilder().setCustomId(BTN_PAY).setStyle(ButtonStyle.Danger).setLabel("Pay Tribute").setEmoji("🩸").setDisabled(true),
        new ButtonBuilder().setCustomId(BTN_JAIL).setStyle(ButtonStyle.Secondary).setLabel("Serve Time Instead").setEmoji("⛓️")
      );
    }

    const embed = buildTaxEmbed({
      amount,
      canAfford,
      extraLine: `You can’t use **/${contextLabel}** until your debt is settled.`,
    });

    await replyOrEdit(interaction, {
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(...rows)],
      flags: MessageFlags.Ephemeral,
    });

    return true;
  }

  /**
   * Gate helper for component interactions (botgames buttons, etc.)
   * Returns true if blocked.
   */
  async function guardBloodTaxComponent(interaction, { contextLabel = "that" } = {}) {
    if (!interaction?.inGuild?.()) return false;

    const curse = await getCurse(interaction.guildId, interaction.user.id, CURSE_TYPES.BLOOD_TAX);
    if (!curse) return false;

    const amount = curse.amount;
    const balance = await economy.getBalance(interaction.guildId, interaction.user.id);
    const canAfford = balance >= amount;

    const rows = [];
    if (canAfford) {
      rows.push(
        new ButtonBuilder().setCustomId(BTN_PAY).setStyle(ButtonStyle.Danger).setLabel("Pay Tribute").setEmoji("🩸")
      );
    } else {
      rows.push(
        new ButtonBuilder().setCustomId(BTN_PAY).setStyle(ButtonStyle.Danger).setLabel("Pay Tribute").setEmoji("🩸").setDisabled(true),
        new ButtonBuilder().setCustomId(BTN_JAIL).setStyle(ButtonStyle.Secondary).setLabel("Serve Time Instead").setEmoji("⛓️")
      );
    }

    const embed = buildTaxEmbed({
      amount,
      canAfford,
      extraLine: `Echo blocks you from **${contextLabel}** until your debt is settled.`,
    });

    try {
      await interaction.reply({
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(...rows)],
        flags: MessageFlags.Ephemeral,
      });
    } catch {
      // ignore
    }

    return true;
  }

  /**
   * Handle payment / jail buttons.
   * Returns true if handled.
   */
  async function handleBloodTaxButtons(interaction) {
    if (!interaction.isButton?.()) return false;
    if (typeof interaction.customId !== "string") return false;
    if (interaction.customId !== BTN_PAY && interaction.customId !== BTN_JAIL) return false;

    // Always ACK quickly
    try {
      if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } catch {}

    const curse = await getCurse(interaction.guildId, interaction.user.id, CURSE_TYPES.BLOOD_TAX);
    if (!curse) {
      await replyOrEdit(interaction, { content: "…It seems your debt no longer exists. Lucky you.", flags: MessageFlags.Ephemeral });
      return true;
    }

    const amount = curse.amount;

    // PAY
    if (interaction.customId === BTN_PAY) {
      const debit = await economy.tryDebitUser(interaction.guildId, interaction.user.id, amount, "blood_tax_paid", {
        reason: "Echo Blood Tax",
      });

      if (!debit.ok) {
        // Can't afford — offer jail (again) with a harsher line
        const mins = jailMinutesForDebt(amount);
        const embed = buildTaxEmbed({
          amount,
          canAfford: false,
          extraLine: `You don’t have enough. If you want out, you’ll need to serve **${Math.round(mins / 60)} hours** instead.`,
        });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(BTN_JAIL).setStyle(ButtonStyle.Secondary).setLabel("Serve Time Instead").setEmoji("⛓️")
        );

        await replyOrEdit(interaction, { embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
        return true;
      }

      await clearCurse(interaction.guildId, interaction.user.id, CURSE_TYPES.BLOOD_TAX);

      await replyOrEdit(interaction, {
        content: `🩸 Tribute accepted. **$${amount.toLocaleString()}** has been paid.
Echo’s gaze lifts… for now.`,
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    // JAIL INSTEAD
    const minutes = jailMinutesForDebt(amount);
    await jail.setJail(interaction.guildId, interaction.user.id, minutes);
    await clearCurse(interaction.guildId, interaction.user.id, CURSE_TYPES.BLOOD_TAX);

    await replyOrEdit(interaction, {
      content:
        `⛓️ You cannot afford the Blood Tax.
` +
        `Echo smiles anyway.

` +
        `You have been jailed for **${Math.round(minutes / 60)} hours** in place of your debt.`,
      flags: MessageFlags.Ephemeral,
    });

    return true;
  }

  module.exports = {
    CURSE_TYPES,
    ensureTables,
    getCurse,
    setCurse,
    clearCurse,
    guardBloodTaxCommand,
    guardBloodTaxComponent,
    handleBloodTaxButtons,
    jailMinutesForDebt,
  };
