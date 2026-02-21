const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionsBitField,
} = require("discord.js");

const config = require("../data/botgames/config");
const { loadEvents } = require("../data/botgames");

let lastSpawnAt = 0;
let activeEvent = null;

function pickWeighted(events) {
  const total = events.reduce((sum, e) => sum + (Number(e.weight) || 1), 0);
  let roll = Math.random() * total;

  for (const e of events) {
    roll -= Number(e.weight) || 1;
    if (roll <= 0) return e;
  }
  return events[0];
}

async function findPostChannel(guild) {
  // Prefer configured channel
  if (config.channelId) {
    const ch = await guild.channels.fetch(config.channelId).catch(() => null);
    if (ch?.isTextBased?.()) return ch;
  }

  // System channel next
  if (guild.systemChannelId) {
    const sys = await guild.channels.fetch(guild.systemChannelId).catch(() => null);
    if (sys?.isTextBased?.()) return sys;
  }

  // Fallback: first channel we can send in
  for (const ch of guild.channels.cache.values()) {
    if (!ch?.isTextBased?.()) continue;
    const me = guild.members.me;
    if (!me) return ch;

    const perms = ch.permissionsFor(me);
    if (!perms) continue;
    if (perms.has(PermissionsBitField.Flags.ViewChannel) && perms.has(PermissionsBitField.Flags.SendMessages)) {
      return ch;
    }
  }

  return null;
}

// -----------------------------
// DB helpers (uses existing tables: user_balances)
// -----------------------------
async function getBalance(db, guildId, userId) {
  const res = await db.query(
    `SELECT balance FROM user_balances WHERE guild_id=$1 AND user_id=$2`,
    [guildId, userId]
  );
  return Number(res.rows?.[0]?.balance ?? 0);
}

async function addBalance(db, guildId, userId, amount) {
  await db.query(
    `
    INSERT INTO user_balances (guild_id, user_id, balance)
    VALUES ($1, $2, $3)
    ON CONFLICT (guild_id, user_id)
    DO UPDATE SET balance = user_balances.balance + EXCLUDED.balance
    `,
    [guildId, userId, amount]
  );
}

async function removeBalance(db, guildId, userId, amount) {
  // transaction + row lock so balance can't go negative with concurrent clicks
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const res = await client.query(
      `SELECT balance FROM user_balances WHERE guild_id=$1 AND user_id=$2 FOR UPDATE`,
      [guildId, userId]
    );

    const current = Number(res.rows?.[0]?.balance ?? 0);
    if (current < amount) {
      await client.query("ROLLBACK");
      return { ok: false, balance: current };
    }

    if (!res.rows?.length) {
      // ensure row exists (edge case)
      await client.query(
        `INSERT INTO user_balances (guild_id, user_id, balance) VALUES ($1,$2,$3)
         ON CONFLICT (guild_id, user_id) DO NOTHING`,
        [guildId, userId, 0]
      );
    }

    await client.query(
      `UPDATE user_balances SET balance = balance - $3 WHERE guild_id=$1 AND user_id=$2`,
      [guildId, userId, amount]
    );

    await client.query("COMMIT");
    return { ok: true, balance: current - amount };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// -----------------------------
// Spawning
// -----------------------------
async function maybeSpawn(client) {
  if (!config.enabled) return;
  if (activeEvent) {
    // expire unclaimed
    if (Date.now() > activeEvent.expiresAt && !activeEvent.claimedUserId) {
      try {
        const guild = await client.guilds.fetch(activeEvent.guildId).catch(() => null);
        const ch = guild ? await guild.channels.fetch(activeEvent.channelId).catch(() => null) : null;
        const msg = ch?.isTextBased?.() ? await ch.messages.fetch(activeEvent.messageId).catch(() => null) : null;
        if (msg) {
          await msg.edit({ components: [] }).catch(() => {});
        }
      } catch (_) {}
      activeEvent = null;
    }
    return;
  }

  const now = Date.now();
  if (now - lastSpawnAt < config.minIntervalMs) return;
  if (Math.random() > config.spawnChance) return;

  const events = loadEvents();
  if (!events.length) return;

  const chosen = pickWeighted(events);
  const instance = chosen.create();

  // First available guild (your bot is single-guild anyway)
  const guild = client.guilds.cache.first();
  if (!guild) return;

  const channel = await findPostChannel(guild);
  if (!channel) return;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`botgames:claim:${chosen.id}`)
      .setLabel("Claim & Play")
      .setStyle(ButtonStyle.Success)
  );

  const msg = await channel.send({
    content: `<@&${config.roleId}>`,
    embeds: [
      {
        title: instance.title,
        description: instance.description,
        color: 0x5865F2,
        footer: { text: `Expires in ${config.expireMinutes} minutes` },
      },
    ],
    components: [row],
  });

  activeEvent = {
    guildId: guild.id,
    channelId: channel.id,
    messageId: msg.id,
    eventId: chosen.id,
    state: instance,
    claimedUserId: null,
    createdAt: now,
    expiresAt: now + config.expireMinutes * 60_000,
  };

  lastSpawnAt = now;
}

function startScheduler(client) {
  setInterval(() => {
    maybeSpawn(client).catch((e) => console.error("[BOTGAMES] spawn tick failed:", e));
  }, config.tickMs);
}

// -----------------------------
// Interaction handling
// Returns true if handled
// -----------------------------
async function handleInteraction(interaction) {
  if (!interaction.isButton?.()) return false;
  if (typeof interaction.customId !== "string") return false;
  if (!interaction.customId.startsWith("botgames:claim:")) return false;

  if (!interaction.inGuild?.() || !interaction.guildId) {
    await interaction.reply({ content: "❌ This only works in a server.", flags: MessageFlags.Ephemeral });
    return true;
  }

  if (!activeEvent) {
    await interaction.reply({ content: "Too slow — there isn't an active Bot Game right now.", flags: MessageFlags.Ephemeral });
    return true;
  }

  // Wrong message or wrong event -> ignore but ephemeral feedback
  if (interaction.message?.id !== activeEvent.messageId) {
    await interaction.reply({ content: "That Bot Game is no longer active.", flags: MessageFlags.Ephemeral });
    return true;
  }

  if (Date.now() > activeEvent.expiresAt) {
    activeEvent = null;
    await interaction.update({ components: [] }).catch(() => {});
    return true;
  }

  if (activeEvent.claimedUserId) {
    await interaction.reply({
      content: `Already claimed by <@${activeEvent.claimedUserId}>. First in best dressed 😈`,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  // Claim it
  activeEvent.claimedUserId = interaction.user.id;

  // Disable button immediately so others stop clicking
  const disabledRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("botgames:claimed")
      .setLabel("Claimed")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true)
  );

  const db = interaction.client?.db;
  if (!db?.query) {
    activeEvent = null;
    await interaction.update({
      embeds: [{ title: "⚠️ Bot Game Error", description: "Database not available.", color: 0xED4245 }],
      components: [],
    });
    return true;
  }

  const bet = Number(activeEvent.state?.bet || 0);
  if (bet <= 0) {
    activeEvent = null;
    await interaction.update({
      embeds: [{ title: "⚠️ Bot Game Error", description: "Invalid bet configuration.", color: 0xED4245 }],
      components: [],
    });
    return true;
  }

  // Take bet
  const taken = await removeBalance(db, interaction.guildId, interaction.user.id, bet);
  if (!taken.ok) {
    activeEvent.claimedUserId = null; // allow someone else
    await interaction.reply({
      content: `You need **$${bet.toLocaleString()}** to play. You currently have **$${Number(taken.balance).toLocaleString()}**.`,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const win = Math.random() < 0.5;

  if (win) {
    await addBalance(db, interaction.guildId, interaction.user.id, bet * 2);
  }

  const resultEmbed = {
    title: win ? "💰 Double or Nothing — WIN!" : "💀 Double or Nothing — LOSE!",
    description: win
      ? `**${interaction.user}** doubled it!\n\nWager: **$${bet.toLocaleString()}**\nPayout: **$${(bet * 2).toLocaleString()}**`
      : `**${interaction.user}** got smoked.\n\nLost: **$${bet.toLocaleString()}**`,
    color: win ? 0x57F287 : 0xED4245,
  };

  activeEvent = null;

  await interaction.update({
    embeds: [resultEmbed],
    components: [disabledRow],
    content: " ",
  });

  // Clean up components after a moment
  setTimeout(() => {
    interaction.message?.edit({ components: [] }).catch(() => {});
  }, 15_000);

  return true;
}

module.exports = { startScheduler, handleInteraction };
