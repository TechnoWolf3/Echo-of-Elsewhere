// utils/adminPanel.js
// Bot Master Admin Panel (role-gated) — replaces a bunch of individual /admin commands

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  MessageFlags,
} = require("discord.js");

const BOT_MASTER_ROLE_ID = "741251069002121236";

// Legacy command modules (moved out of /commands so they are NOT deployed as slash commands)
const legacy = {
  addbalance: () => require("../admin/legacy_commands/addbalance"),
  addserverbal: () => require("../admin/legacy_commands/addserverbal"),
  board: () => require("../admin/legacy_commands/board"),
  cooldown: () => require("../admin/legacy_commands/cooldown"),
  invadmin: () => require("../admin/legacy_commands/invadmin"),
  patchboard: () => require("../admin/legacy_commands/patchboard"),
  ping: () => require("../admin/legacy_commands/ping"),
  purge: () => require("../admin/legacy_commands/purge"),
  resetachievements: () => require("../admin/legacy_commands/resetachievements"),
  riftdebug: () => require("../admin/legacy_commands/riftdebug"),
  serverbal: () => require("../admin/legacy_commands/serverbal"),
  setheat: () => require("../admin/legacy_commands/setheat"),
  setjail: () => require("../admin/legacy_commands/setjail"),
  shopadmin: () => require("../admin/legacy_commands/shopadmin"),
};

function isBotMaster(member) {
  return !!member?.roles?.cache?.has?.(BOT_MASTER_ROLE_ID);
}

function naughtyMessage() {
  return "🚫 Oi. Hands off. This panel is for **Bot Masters** only.\n\nBe good, or Echo will notice.";
}

function buildBaseEmbed(page) {
  const e = new EmbedBuilder()
    .setColor(0x0875af)
    .setTitle("🛠️ Admin Panel")
    .setFooter({ text: "Bot Master controls" });

  const desc =
    page === "home"
      ? "Pick a category below. Buttons are locked to the **Bot Master** role."
      : `Category: **${pageLabel(page)}**`;
  e.setDescription(desc);
  return e;
}

function pageLabel(page) {
  switch (page) {
    case "economy":
      return "Economy";
    case "moderation":
      return "Moderation";
    case "boards":
      return "Boards";
    case "shop":
      return "Shop";
    case "debug":
      return "Debug";
    default:
      return "Home";
  }
}

function navRow(current) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("adminpanel:nav")
      .setPlaceholder("Select category…")
      .addOptions(
        {
          label: "Home",
          value: "home",
          default: current === "home",
        },
        {
          label: "Economy",
          value: "economy",
          default: current === "economy",
        },
        {
          label: "Moderation",
          value: "moderation",
          default: current === "moderation",
        },
        {
          label: "Boards",
          value: "boards",
          default: current === "boards",
        },
        {
          label: "Shop",
          value: "shop",
          default: current === "shop",
        },
        {
          label: "Debug",
          value: "debug",
          default: current === "debug",
        }
      )
  );
}

function buttonRow(buttons) {
  const row = new ActionRowBuilder();
  for (const b of buttons) row.addComponents(b);
  return row;
}

function render(page = "home") {
  const embed = buildBaseEmbed(page);

  const rows = [navRow(page)];

  if (page === "economy") {
    rows.push(
      buttonRow([
        new ButtonBuilder().setCustomId("adminpanel:action:addbalance").setLabel("Add Balance").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("adminpanel:action:addserverbal").setLabel("Add Server Bank").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("adminpanel:action:serverbal").setLabel("View Server Bank").setStyle(ButtonStyle.Secondary),
      ])
    );
  }

  if (page === "moderation") {
    rows.push(
      buttonRow([
        new ButtonBuilder().setCustomId("adminpanel:action:purge").setLabel("Purge Messages").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("adminpanel:action:cooldown_clear").setLabel("Clear Cooldowns").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("adminpanel:action:setjail").setLabel("Set Jail").setStyle(ButtonStyle.Secondary),
      ])
    );
    rows.push(
      buttonRow([
        new ButtonBuilder().setCustomId("adminpanel:action:setheat").setLabel("Set Heat").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("adminpanel:action:resetachievements").setLabel("Reset Achievements").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("adminpanel:action:inv_remove").setLabel("Inv: Remove Item").setStyle(ButtonStyle.Secondary),
      ])
    );
  }

  if (page === "boards") {
    rows.push(
      buttonRow([
        new ButtonBuilder().setCustomId("adminpanel:action:board_create").setLabel("Role Board: Create").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("adminpanel:action:board_update").setLabel("Role Board: Update").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("adminpanel:action:board_list").setLabel("Role Board: List").setStyle(ButtonStyle.Secondary),
      ])
    );
    rows.push(
      buttonRow([
        new ButtonBuilder().setCustomId("adminpanel:action:board_bump").setLabel("Role Board: Bump").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("adminpanel:action:board_delete").setLabel("Role Board: Delete").setStyle(ButtonStyle.Danger),
      ])
    );
    rows.push(
      buttonRow([
        new ButtonBuilder().setCustomId("adminpanel:action:patch_set").setLabel("Patch Board: Set").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("adminpanel:action:patch_append").setLabel("Patch Board: Append").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("adminpanel:action:patch_overwrite").setLabel("Patch Board: Overwrite").setStyle(ButtonStyle.Secondary),
      ])
    );
    rows.push(
      buttonRow([
        new ButtonBuilder().setCustomId("adminpanel:action:patch_pause").setLabel("Patch Board: Pause").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("adminpanel:action:patch_resume").setLabel("Patch Board: Resume").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("adminpanel:action:patch_clear").setLabel("Patch Board: Clear").setStyle(ButtonStyle.Danger),
      ])
    );
  }

  if (page === "shop") {
    rows.push(
      buttonRow([
        new ButtonBuilder().setCustomId("adminpanel:action:shop_add").setLabel("Shop: Add Item").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("adminpanel:action:shop_edit").setLabel("Shop: Edit Item").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("adminpanel:action:shop_setcategory").setLabel("Shop: Set Category").setStyle(ButtonStyle.Secondary),
      ])
    );
  }

  if (page === "debug") {
    rows.push(
      buttonRow([
        new ButtonBuilder().setCustomId("adminpanel:action:rift_status").setLabel("Rift: Status").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("adminpanel:action:rift_spawn").setLabel("Rift: Spawn").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("adminpanel:action:rift_clear").setLabel("Rift: Clear").setStyle(ButtonStyle.Secondary),
      ])
    );
    rows.push(
      buttonRow([
        new ButtonBuilder().setCustomId("adminpanel:action:ping").setLabel("Ping").setStyle(ButtonStyle.Secondary),
      ])
    );
  }

  return { embeds: [embed], components: rows };
}

function proxyInteraction(interaction, fakeOptions) {
  // Proxy to override .options for legacy command execution.
  return new Proxy(interaction, {
    get(target, prop) {
      if (prop === "options") return fakeOptions;
      return target[prop];
    },
  });
}

function parseIdFromMention(s) {
  if (!s) return null;
  const str = String(s).trim();
  // <@123>, <@!123>, <#123>, <@&123>
  const m = str.match(/^(?:<[@#]&?!?)?(\d{15,22})>?$/);
  return m ? m[1] : null;
}

async function fetchUserFromInput(interaction, raw) {
  const id = parseIdFromMention(raw);
  if (!id) return null;
  // Prefer guild member fetch (ensures correct guild user)
  const member = await interaction.guild?.members.fetch(id).catch(() => null);
  return member?.user ?? (await interaction.client.users.fetch(id).catch(() => null));
}

async function fetchRoleFromInput(interaction, raw) {
  const id = parseIdFromMention(raw);
  if (!id) return null;
  return await interaction.guild?.roles.fetch(id).catch(() => null);
}

async function fetchChannelFromInput(interaction, raw) {
  const id = parseIdFromMention(raw);
  if (!id) return null;
  return await interaction.guild?.channels.fetch(id).catch(() => null);
}

function modal(customId, title, inputs) {
  const m = new ModalBuilder().setCustomId(customId).setTitle(title);
  for (const inp of inputs) m.addComponents(new ActionRowBuilder().addComponents(inp));
  return m;
}

function textInput(id, label, style = TextInputStyle.Short, required = true, placeholder = "") {
  return new TextInputBuilder()
    .setCustomId(id)
    .setLabel(label)
    .setStyle(style)
    .setRequired(required)
    .setPlaceholder(placeholder);
}

async function runLegacy(interaction, key, fakeOptions) {
  const cmd = legacy[key]?.();
  if (!cmd?.execute) {
    throw new Error(`Legacy command not found: ${key}`);
  }
  const proxied = proxyInteraction(interaction, fakeOptions);
  return cmd.execute(proxied);
}

async function handleNav(interaction) {
  const page = interaction.values?.[0] ?? "home";
  await interaction.update(render(page));
  return true;
}

async function handleAction(interaction, action) {
  // Actions either run immediately or open a modal.
  switch (action) {
    case "serverbal": {
      return runLegacy(interaction, "serverbal", {
        getSubcommand() {
          return null;
        },
      }).then(() => true);
    }
    case "ping": {
      return runLegacy(interaction, "ping", {}).then(() => true);
    }
    case "board_list": {
      return runLegacy(interaction, "board", {
        getSubcommand() {
          return "list";
        },
      }).then(() => true);
    }
    case "rift_status": {
      return runLegacy(interaction, "riftdebug", {
        getSubcommand() {
          return "status";
        },
      }).then(() => true);
    }
    case "rift_spawn": {
      return runLegacy(interaction, "riftdebug", {
        getSubcommand() {
          return "spawn";
        },
      }).then(() => true);
    }
    case "rift_clear": {
      return runLegacy(interaction, "riftdebug", {
        getSubcommand() {
          return "clear";
        },
      }).then(() => true);
    }
  }

  // Everything else needs inputs via modal.
  const modalId = `adminpanel:modal:${action}`;

  if (action === "addbalance") {
    await interaction.showModal(
      modal(modalId, "Add Balance", [
        textInput("user", "User (mention or ID)", TextInputStyle.Short, true, "@user or 123…"),
        textInput("amount", "Amount", TextInputStyle.Short, true, "5000"),
      ])
    );
    return true;
  }

  if (action === "addserverbal") {
    await interaction.showModal(
      modal(modalId, "Add Server Bank", [textInput("amount", "Amount", TextInputStyle.Short, true, "5000")])
    );
    return true;
  }

  if (action === "purge") {
    await interaction.showModal(
      modal(modalId, "Purge Messages", [
        textInput("amount", "Amount (1–200)", TextInputStyle.Short, true, "25"),
      ])
    );
    return true;
  }

  if (action === "cooldown_clear") {
    await interaction.showModal(
      modal(modalId, "Clear Cooldowns", [
        textInput("user", "User (mention/ID) (blank = you)", TextInputStyle.Short, false, "@user or 123…"),
        textInput("key", 'Key (e.g. "job", "crime_heist", or "all")', TextInputStyle.Short, false, "all"),
      ])
    );
    return true;
  }

  if (action === "setjail") {
    await interaction.showModal(
      modal(modalId, "Set Jail", [
        textInput("user", "User (mention/ID)", TextInputStyle.Short, true, "@user or 123…"),
        textInput("minutes", "Minutes (0 clears)", TextInputStyle.Short, true, "30"),
        textInput("reason", "Reason (optional)", TextInputStyle.Short, false, "Because Echo said so"),
      ])
    );
    return true;
  }

  if (action === "setheat") {
    await interaction.showModal(
      modal(modalId, "Set Heat", [
        textInput("user", "User (mention/ID)", TextInputStyle.Short, true, "@user or 123…"),
        textInput("heat", "Heat (0–100)", TextInputStyle.Short, true, "50"),
        textInput("minutes", "Duration minutes (1–1440)", TextInputStyle.Short, true, "60"),
      ])
    );
    return true;
  }

  if (action === "resetachievements") {
    await interaction.showModal(
      modal(modalId, "Reset Achievements", [
        textInput("user", "User (mention/ID)", TextInputStyle.Short, true, "@user or 123…"),
      ])
    );
    return true;
  }

  if (action === "inv_remove") {
    await interaction.showModal(
      modal(modalId, "Inventory: Remove Item", [
        textInput("user", "User (mention/ID)", TextInputStyle.Short, true, "@user or 123…"),
        textInput("item", "Item ID (e.g. Crime_Kit)", TextInputStyle.Short, true, "Crime_Kit"),
        textInput("qty", "Qty (blank = 1)", TextInputStyle.Short, false, "1"),
        textInput("all", "Hard delete? (yes/no)", TextInputStyle.Short, false, "no"),
      ])
    );
    return true;
  }

  if (action.startsWith("board_")) {
    const common = [textInput("channel", "Channel (mention/ID) (blank = current)", TextInputStyle.Short, false, "#channel or 123…")];
    if (action === "board_create") {
      await interaction.showModal(
        modal(modalId, "Role Board: Create", [
          ...common,
          textInput("name", "Board name", TextInputStyle.Short, true, "Bot Games"),
          textInput("role", "Role (mention/ID)", TextInputStyle.Short, true, "@Role or 123…"),
          textInput("emoji", "Emoji (unicode or custom)", TextInputStyle.Short, true, "🎮"),
          textInput("description", "Description (optional)", TextInputStyle.Paragraph, false, ""),
        ])
      );
      return true;
    }
    if (action === "board_update") {
      await interaction.showModal(
        modal(modalId, "Role Board: Update", [
          ...common,
          textInput("name", "New name (optional)", TextInputStyle.Short, false, ""),
          textInput("role", "New role (optional)", TextInputStyle.Short, false, ""),
          textInput("emoji", "New emoji (optional)", TextInputStyle.Short, false, ""),
          textInput("description", "New description (optional)", TextInputStyle.Paragraph, false, ""),
        ])
      );
      return true;
    }
    if (action === "board_bump" || action === "board_delete") {
      await interaction.showModal(
        modal(modalId, action === "board_bump" ? "Role Board: Bump" : "Role Board: Delete", [
          ...common,
          ...(action === "board_delete"
            ? [textInput("delete_message", "Delete message too? (yes/no)", TextInputStyle.Short, false, "no")]
            : []),
        ])
      );
      return true;
    }
  }

  if (action.startsWith("patch_")) {
    const common = [textInput("channel", "Channel (mention/ID) (blank = current)", TextInputStyle.Short, false, "#channel or 123…")];
    if (action === "patch_set") {
      await interaction.showModal(
        modal(modalId, "Patch Board: Set", [
          ...common,
          textInput("title", "Title (optional)", TextInputStyle.Short, false, "Patch Notes"),
        ])
      );
      return true;
    }
    if (action === "patch_append" || action === "patch_overwrite") {
      await interaction.showModal(
        modal(modalId, action === "patch_append" ? "Patch Board: Append" : "Patch Board: Overwrite", [
          ...common,
          textInput("text", "Text (use \\n for new lines)", TextInputStyle.Paragraph, true, "- Added thing\\n- Fixed stuff"),
          ...(action === "patch_overwrite" ? [textInput("title", "Title (optional)", TextInputStyle.Short, false, "")] : []),
        ])
      );
      return true;
    }
    if (action === "patch_pause" || action === "patch_resume" || action === "patch_clear") {
      await interaction.showModal(
        modal(modalId, "Patch Board", [
          ...common,
        ])
      );
      return true;
    }
  }

  if (action.startsWith("shop_")) {
    if (action === "shop_add") {
      await interaction.showModal(
        modal(modalId, "Shop: Add (upsert)", [
          textInput("item_id", "item_id", TextInputStyle.Short, true, "Crime_Kit"),
          textInput("name", "name", TextInputStyle.Short, true, "Crime Kit"),
          textInput("price", "price", TextInputStyle.Short, true, "5000"),
          textInput("kind", "kind (item/consumable/permanent/role/perk)", TextInputStyle.Short, false, "item"),
          textInput("description", "description (optional)", TextInputStyle.Paragraph, false, ""),
        ])
      );
      return true;
    }
    if (action === "shop_edit") {
      await interaction.showModal(
        modal(modalId, "Shop: Edit", [
          textInput("item_id", "item_id", TextInputStyle.Short, true, "Crime_Kit"),
          textInput("name", "name (optional)", TextInputStyle.Short, false, ""),
          textInput("price", "price (optional)", TextInputStyle.Short, false, ""),
          textInput("enabled", "enabled? (true/false) (optional)", TextInputStyle.Short, false, ""),
          textInput("description", "description (optional)", TextInputStyle.Paragraph, false, ""),
        ])
      );
      return true;
    }
    if (action === "shop_setcategory") {
      await interaction.showModal(
        modal(modalId, "Shop: Set Category", [
          textInput("item_id", "item_id", TextInputStyle.Short, true, "Crime_Kit"),
          textInput("category", "category", TextInputStyle.Short, true, "Tools"),
        ])
      );
      return true;
    }
  }

  // Unknown action
  await interaction.reply({ content: "❌ Unknown admin action.", flags: MessageFlags.Ephemeral }).catch(() => {});
  return true;
}

async function handleModalSubmit(interaction, action) {
  // Parse modal fields, build fake options, then run the legacy command.
  const fields = interaction.fields;
  const get = (k) => {
    try {
      return fields.getTextInputValue(k);
    } catch {
      return "";
    }
  };

  // helpers
  const channelRaw = get("channel");
  const channelObj = channelRaw ? await fetchChannelFromInput(interaction, channelRaw) : null;
  const channelFinal = channelObj && channelObj.type === ChannelType.GuildText ? channelObj : null;

  if (action === "addbalance") {
    const user = await fetchUserFromInput(interaction, get("user"));
    const amount = Number(get("amount"));
    const fakeOptions = {
      getUser() {
        return user;
      },
      getInteger() {
        return Number.isFinite(amount) ? Math.floor(amount) : null;
      },
    };
    return runLegacy(interaction, "addbalance", fakeOptions).then(() => true);
  }

  if (action === "addserverbal") {
    const amount = Number(get("amount"));
    return runLegacy(interaction, "addserverbal", {
      getInteger() {
        return Number.isFinite(amount) ? Math.floor(amount) : null;
      },
    }).then(() => true);
  }

  if (action === "purge") {
    const amount = Number(get("amount"));
    return runLegacy(interaction, "purge", {
      getInteger() {
        return Number.isFinite(amount) ? Math.floor(amount) : null;
      },
    }).then(() => true);
  }

  if (action === "cooldown_clear") {
    const userRaw = get("user");
    const keyRaw = get("key");
    const targetUser = userRaw ? await fetchUserFromInput(interaction, userRaw) : null;
    const key = keyRaw?.trim() || "all";
    return runLegacy(interaction, "cooldown", {
      getSubcommand() {
        return "clear";
      },
      getUser(name) {
        if (name === "user") return targetUser;
        return null;
      },
      getString(name) {
        if (name === "key") return key;
        return null;
      },
    }).then(() => true);
  }

  if (action === "setjail") {
    const user = await fetchUserFromInput(interaction, get("user"));
    const minutes = Number(get("minutes"));
    const reason = get("reason");
    return runLegacy(interaction, "setjail", {
      getUser() {
        return user;
      },
      getInteger(name) {
        if (name === "minutes") return Number.isFinite(minutes) ? Math.floor(minutes) : 0;
        return null;
      },
      getString(name) {
        if (name === "reason") return reason || null;
        return null;
      },
    }).then(() => true);
  }

  if (action === "setheat") {
    const user = await fetchUserFromInput(interaction, get("user"));
    const heat = Number(get("heat"));
    const minutes = Number(get("minutes"));
    return runLegacy(interaction, "setheat", {
      getUser() {
        return user;
      },
      getInteger(name) {
        if (name === "heat") return Number.isFinite(heat) ? Math.floor(heat) : 0;
        if (name === "minutes") return Number.isFinite(minutes) ? Math.floor(minutes) : 60;
        return null;
      },
    }).then(() => true);
  }

  if (action === "resetachievements") {
    const user = await fetchUserFromInput(interaction, get("user"));
    return runLegacy(interaction, "resetachievements", {
      getUser() {
        return user;
      },
    }).then(() => true);
  }

  if (action === "inv_remove") {
    const user = await fetchUserFromInput(interaction, get("user"));
    const item = get("item");
    const qtyRaw = get("qty");
    const allRaw = get("all");
    const qty = qtyRaw ? Number(qtyRaw) : 1;
    const hard = (allRaw || "").trim().toLowerCase();
    const hardDelete = hard === "yes" || hard === "y" || hard === "true" || hard === "1";

    return runLegacy(interaction, "invadmin", {
      getSubcommand() {
        return "remove";
      },
      getUser(name) {
        if (name === "user") return user;
        return null;
      },
      getString(name) {
        if (name === "item") return item;
        return null;
      },
      getInteger(name) {
        if (name === "qty") return Number.isFinite(qty) ? Math.floor(qty) : 1;
        return null;
      },
      getBoolean(name) {
        if (name === "all") return hardDelete;
        return null;
      },
    }).then(() => true);
  }

  if (action.startsWith("board_")) {
    const channel = channelFinal ?? interaction.channel;
    const channelOpt = channel && channel.type === ChannelType.GuildText ? channel : null;

    const sub = action.replace("board_", ""); // create/update/bump/delete

    if (sub === "create") {
      const name = get("name");
      const role = await fetchRoleFromInput(interaction, get("role"));
      const emoji = get("emoji");
      const description = get("description");
      return runLegacy(interaction, "board", {
        getSubcommand() {
          return "create";
        },
        getChannel() {
          return channelOpt;
        },
        getString(n) {
          if (n === "name") return name;
          if (n === "emoji") return emoji;
          if (n === "description") return description || null;
          return null;
        },
        getRole() {
          return role;
        },
      }).then(() => true);
    }

    if (sub === "update") {
      const name = get("name");
      const roleRaw = get("role");
      const role = roleRaw ? await fetchRoleFromInput(interaction, roleRaw) : null;
      const emoji = get("emoji");
      const description = get("description");
      return runLegacy(interaction, "board", {
        getSubcommand() {
          return "update";
        },
        getChannel() {
          return channelOpt;
        },
        getString(n) {
          if (n === "name") return name || null;
          if (n === "emoji") return emoji || null;
          if (n === "description") return description || null;
          return null;
        },
        getRole(n) {
          if (n === "role") return role;
          return role;
        },
      }).then(() => true);
    }

    if (sub === "bump") {
      return runLegacy(interaction, "board", {
        getSubcommand() {
          return "bump";
        },
        getChannel() {
          return channelOpt;
        },
      }).then(() => true);
    }

    if (sub === "delete") {
      const delRaw = get("delete_message");
      const del = (delRaw || "").trim().toLowerCase();
      const deleteMsg = del === "yes" || del === "y" || del === "true" || del === "1";
      return runLegacy(interaction, "board", {
        getSubcommand() {
          return "delete";
        },
        getChannel() {
          return channelOpt;
        },
        getBoolean() {
          return deleteMsg;
        },
      }).then(() => true);
    }
  }

  if (action.startsWith("patch_")) {
    const channel = channelFinal ?? interaction.channel;
    const sub = action.replace("patch_", "");
    const text = get("text");
    const title = get("title");

    return runLegacy(interaction, "patchboard", {
      getSubcommand() {
        return sub;
      },
      getChannel() {
        return channel;
      },
      getString(name) {
        if (name === "text") return text;
        if (name === "title") return title || null;
        return null;
      },
    }).then(() => true);
  }

  if (action.startsWith("shop_")) {
    const sub = action.replace("shop_", "");
    const item_id = get("item_id");
    const name = get("name");
    const price = get("price");
    const kind = get("kind");
    const description = get("description");
    const enabledRaw = get("enabled");
    const category = get("category");

    return runLegacy(interaction, "shopadmin", {
      getSubcommand() {
        return sub;
      },
      getString(n) {
        if (n === "item_id") return item_id;
        if (n === "name") return name || null;
        if (n === "kind") return kind || null;
        if (n === "description") return description || null;
        if (n === "category") return category || null;
        return null;
      },
      getInteger(n) {
        if (n === "price") return price ? Number(price) : null;
        return null;
      },
      getBoolean(n) {
        if (n === "enabled") {
          if (!enabledRaw) return null;
          const v = enabledRaw.trim().toLowerCase();
          if (["true", "yes", "y", "1"].includes(v)) return true;
          if (["false", "no", "n", "0"].includes(v)) return false;
          return null;
        }
        return null;
      },
    }).then(() => true);
  }

  await interaction.reply({ content: "❌ Unknown modal action.", flags: MessageFlags.Ephemeral }).catch(() => {});
  return true;
}

async function handleInteraction(interaction) {
  const id = interaction.customId;
  if (typeof id !== "string" || !id.startsWith("adminpanel:")) return false;

  // Role gate for ALL panel interactions.
  if (!interaction.inGuild?.() || !interaction.guild) {
    try {
      await interaction.reply({ content: "❌ This only works in a server.", flags: MessageFlags.Ephemeral });
    } catch {}
    return true;
  }

  if (!isBotMaster(interaction.member)) {
    try {
      if (interaction.isMessageComponent?.() || interaction.isModalSubmit?.()) {
        // Stop people from "pressing" things
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({ content: naughtyMessage(), flags: MessageFlags.Ephemeral });
        } else {
          await interaction.reply({ content: naughtyMessage(), flags: MessageFlags.Ephemeral });
        }
      }
    } catch {}
    return true;
  }

  // Navigation (select menu)
  if (interaction.isStringSelectMenu?.() && id === "adminpanel:nav") {
    return handleNav(interaction);
  }

  // Button actions
  if (interaction.isButton?.() && id.startsWith("adminpanel:action:")) {
    const action = id.split(":").slice(2).join(":");
    return handleAction(interaction, action);
  }

  // Modal submits
  if (interaction.isModalSubmit?.() && id.startsWith("adminpanel:modal:")) {
    const action = id.split(":").slice(2).join(":");
    return handleModalSubmit(interaction, action);
  }

  return false;
}

module.exports = {
  BOT_MASTER_ROLE_ID,
  isBotMaster,
  naughtyMessage,
  render,
  handleInteraction,
};
