// commands/shopadmin.js
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require("discord.js");

const SHOP_ADMIN_ROLE_ID = "741251069002121236";

function money(n) {
  return `$${Number(n || 0).toLocaleString()}`;
}

function safeKind(kind) {
  const allowed = new Set(["item", "consumable", "permanent", "role", "perk"]);
  return allowed.has(kind) ? kind : "item";
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("shopadmin")
    .setDescription("Admin tools for managing the server store.")
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Add a store item (upsert by item_id).")
        .addStringOption((opt) => opt.setName("item_id").setDescription("Stable ID").setRequired(true))
        .addStringOption((opt) => opt.setName("name").setDescription("Display name").setRequired(true))
        .addIntegerOption((opt) => opt.setName("price").setDescription("Price per unit").setMinValue(1).setRequired(true))
        .addStringOption((opt) =>
          opt
            .setName("kind")
            .setDescription("item | consumable | permanent | role | perk")
            .setRequired(false)
            .addChoices(
              { name: "item", value: "item" },
              { name: "consumable", value: "consumable" },
              { name: "permanent", value: "permanent" },
              { name: "role", value: "role" },
              { name: "perk", value: "perk" }
            )
        )
        .addBooleanOption((opt) => opt.setName("stackable").setDescription("If false, qty is always 1").setRequired(false))
        .addIntegerOption((opt) => opt.setName("max_owned").setDescription("Max user can hold (0=unlimited)").setMinValue(0).setRequired(false))
        .addIntegerOption((opt) => opt.setName("max_uses").setDescription("Charges/uses (0=none)").setMinValue(0).setRequired(false))
        .addIntegerOption((opt) => opt.setName("max_purchase_ever").setDescription("Max buys EVER (0=unlimited, 1=one-time)").setMinValue(0).setRequired(false))
        .addIntegerOption((opt) => opt.setName("cooldown_seconds").setDescription("Per-user cooldown (0=none, 86400=24h)").setMinValue(0).setRequired(false))
        .addIntegerOption((opt) => opt.setName("daily_stock").setDescription("Global stock per UTC day (0=unlimited)").setMinValue(0).setRequired(false))
        .addIntegerOption((opt) => opt.setName("sort").setDescription("Sort order (lower first)").setRequired(false))
        .addStringOption((opt) => opt.setName("description").setDescription("Description").setRequired(false))
    )
    .addSubcommand((sub) =>
      sub
        .setName("edit")
        .setDescription("Edit an existing item.")
        .addStringOption((opt) => opt.setName("item_id").setDescription("Item ID").setRequired(true))
        .addStringOption((opt) => opt.setName("name").setDescription("New name").setRequired(false))
        .addIntegerOption((opt) => opt.setName("price").setDescription("New price").setMinValue(1).setRequired(false))
        .addStringOption((opt) =>
          opt
            .setName("kind")
            .setDescription("item | consumable | permanent | role | perk")
            .setRequired(false)
            .addChoices(
              { name: "item", value: "item" },
              { name: "consumable", value: "consumable" },
              { name: "permanent", value: "permanent" },
              { name: "role", value: "role" },
              { name: "perk", value: "perk" }
            )
        )
        .addBooleanOption((opt) => opt.setName("stackable").setDescription("Stackable?").setRequired(false))
        .addIntegerOption((opt) => opt.setName("max_owned").setDescription("Max user can hold (0=unlimited)").setMinValue(0).setRequired(false))
        .addIntegerOption((opt) => opt.setName("max_uses").setDescription("Charges/uses (0=none)").setMinValue(0).setRequired(false))
        .addIntegerOption((opt) => opt.setName("max_purchase_ever").setDescription("Max buys EVER (0=unlimited, 1=one-time)").setMinValue(0).setRequired(false))
        .addIntegerOption((opt) => opt.setName("cooldown_seconds").setDescription("Per-user cooldown (0=none, 86400=24h)").setMinValue(0).setRequired(false))
        .addIntegerOption((opt) => opt.setName("daily_stock").setDescription("Global stock per UTC day (0=unlimited)").setMinValue(0).setRequired(false))
        .addIntegerOption((opt) => opt.setName("sort").setDescription("Sort order").setRequired(false))
        .addBooleanOption((opt) => opt.setName("enabled").setDescription("Enabled?").setRequired(false))
        .addStringOption((opt) => opt.setName("description").setDescription("New description").setRequired(false))
    )
    .addSubcommand((sub) =>
      sub
        .setName("setrole")
        .setDescription("Attach a Discord role to an item.")
        .addStringOption((opt) => opt.setName("item_id").setDescription("Item ID").setRequired(true))
        .addRoleOption((opt) => opt.setName("role").setDescription("Role to grant").setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName("disable")
        .setDescription("Disable an item.")
        .addStringOption((opt) => opt.setName("item_id").setDescription("Item ID").setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName("enable")
        .setDescription("Enable an item.")
        .addStringOption((opt) => opt.setName("item_id").setDescription("Item ID").setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName("list")
        .setDescription("List items.")
        .addBooleanOption((opt) => opt.setName("include_disabled").setDescription("Show disabled too").setRequired(false))
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: "❌ Server only.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    const member = interaction.member;
    if (!member?.roles?.cache?.has(SHOP_ADMIN_ROLE_ID)) {
      return interaction.reply({ content: "❌ You don’t have permission to use shop admin.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
    const db = interaction.client.db;
    const guildId = interaction.guildId;
    const sub = interaction.options.getSubcommand();

    if (sub === "add") {
      const itemId = interaction.options.getString("item_id", true).trim();
      const name = interaction.options.getString("name", true).trim();
      const price = interaction.options.getInteger("price", true);
      const kind = safeKind(interaction.options.getString("kind", false) ?? "item");
      const stackable = interaction.options.getBoolean("stackable", false) ?? true;
      const sortOrder = interaction.options.getInteger("sort", false) ?? 0;
      const description = interaction.options.getString("description", false) ?? "";

      const maxOwned = interaction.options.getInteger("max_owned", false) ?? 0;
      const maxUses = interaction.options.getInteger("max_uses", false) ?? 0;
      const maxPurchaseEver = interaction.options.getInteger("max_purchase_ever", false) ?? 0;
      const cooldownSeconds = interaction.options.getInteger("cooldown_seconds", false) ?? 0;
      const dailyStock = interaction.options.getInteger("daily_stock", false) ?? 0;

      await db.query(
        `
        INSERT INTO store_items
          (guild_id, item_id, name, description, price, kind, stackable, enabled,
           sort_order, meta, max_owned, max_uses, max_purchase_ever, cooldown_seconds, daily_stock, updated_at)
        VALUES
          ($1,$2,$3,$4,$5,$6,$7,true,
           $8,'{}'::jsonb,$9,$10,$11,$12,$13,NOW())
        ON CONFLICT (guild_id, item_id)
        DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          price = EXCLUDED.price,
          kind = EXCLUDED.kind,
          stackable = EXCLUDED.stackable,
          sort_order = EXCLUDED.sort_order,
          max_owned = EXCLUDED.max_owned,
          max_uses = EXCLUDED.max_uses,
          max_purchase_ever = EXCLUDED.max_purchase_ever,
          cooldown_seconds = EXCLUDED.cooldown_seconds,
          daily_stock = EXCLUDED.daily_stock,
          updated_at = NOW()
        `,
        [guildId, itemId, name, description, price, kind, stackable, sortOrder, maxOwned, maxUses, maxPurchaseEver, cooldownSeconds, dailyStock]
      );

      const tags = [];
      if (maxOwned > 0) tags.push(`max_owned=${maxOwned}`);
      if (maxUses > 0) tags.push(`max_uses=${maxUses}`);
      if (maxPurchaseEver > 0) tags.push(`ever=${maxPurchaseEver}`);
      if (cooldownSeconds > 0) tags.push(`cd=${cooldownSeconds}s`);
      if (dailyStock > 0) tags.push(`daily=${dailyStock}`);

      return interaction.editReply(`✅ Saved **${name}** (\`${itemId}\`) @ **${money(price)}**${tags.length ? ` (${tags.join(", ")})` : ""}`);
    }

    if (sub === "edit") {
      const itemId = interaction.options.getString("item_id", true).trim();

      const fields = [];
      const values = [guildId, itemId];
      let i = 3;

      const name = interaction.options.getString("name", false);
      const price = interaction.options.getInteger("price", false);
      const kindRaw = interaction.options.getString("kind", false);
      const stackable = interaction.options.getBoolean("stackable", false);
      const sort = interaction.options.getInteger("sort", false);
      const enabled = interaction.options.getBoolean("enabled", false);
      const desc = interaction.options.getString("description", false);

      const maxOwned = interaction.options.getInteger("max_owned", false);
      const maxUses = interaction.options.getInteger("max_uses", false);
      const maxPurchaseEver = interaction.options.getInteger("max_purchase_ever", false);
      const cooldownSeconds = interaction.options.getInteger("cooldown_seconds", false);
      const dailyStock = interaction.options.getInteger("daily_stock", false);

      if (name != null) { fields.push(`name=$${i++}`); values.push(name.trim()); }
      if (desc != null) { fields.push(`description=$${i++}`); values.push(desc); }
      if (price != null) { fields.push(`price=$${i++}`); values.push(price); }
      if (kindRaw != null) { fields.push(`kind=$${i++}`); values.push(safeKind(kindRaw)); }
      if (stackable != null) { fields.push(`stackable=$${i++}`); values.push(stackable); }
      if (sort != null) { fields.push(`sort_order=$${i++}`); values.push(sort); }
      if (enabled != null) { fields.push(`enabled=$${i++}`); values.push(enabled); }

      if (maxOwned != null) { fields.push(`max_owned=$${i++}`); values.push(maxOwned); }
      if (maxUses != null) { fields.push(`max_uses=$${i++}`); values.push(maxUses); }
      if (maxPurchaseEver != null) { fields.push(`max_purchase_ever=$${i++}`); values.push(maxPurchaseEver); }
      if (cooldownSeconds != null) { fields.push(`cooldown_seconds=$${i++}`); values.push(cooldownSeconds); }
      if (dailyStock != null) { fields.push(`daily_stock=$${i++}`); values.push(dailyStock); }

      if (!fields.length) return interaction.editReply("⚠️ Nothing to update.");

      const res = await db.query(
        `
        UPDATE store_items
        SET ${fields.join(", ")}, updated_at = NOW()
        WHERE guild_id=$1 AND item_id=$2
        RETURNING name, price, kind, enabled, max_owned, max_uses, max_purchase_ever, cooldown_seconds, daily_stock
        `,
        values
      );

      if (!res.rowCount) return interaction.editReply("❌ Item not found.");

      const it = res.rows[0];
      const tags = [];
      if (Number(it.max_owned || 0) > 0) tags.push(`max_owned=${it.max_owned}`);
      if (Number(it.max_uses || 0) > 0) tags.push(`max_uses=${it.max_uses}`);
      if (Number(it.max_purchase_ever || 0) > 0) tags.push(`ever=${it.max_purchase_ever}`);
      if (Number(it.cooldown_seconds || 0) > 0) tags.push(`cd=${it.cooldown_seconds}s`);
      if (Number(it.daily_stock || 0) > 0) tags.push(`daily=${it.daily_stock}`);

      return interaction.editReply(`✅ Updated \`${itemId}\` → **${it.name}** | ${money(it.price)} | ${it.kind} | ${it.enabled ? "enabled" : "disabled"}${tags.length ? ` (${tags.join(", ")})` : ""}`);
    }

    if (sub === "setrole") {
      const itemId = interaction.options.getString("item_id", true).trim();
      const role = interaction.options.getRole("role", true);

      const res = await db.query(
        `
        UPDATE store_items
        SET
          kind = 'role',
          meta = jsonb_set(COALESCE(meta, '{}'::jsonb), '{role_id}', to_jsonb($3::text), true),
          updated_at = NOW()
        WHERE guild_id=$1 AND item_id=$2
        RETURNING name
        `,
        [guildId, itemId, role.id]
      );

      if (!res.rowCount) return interaction.editReply("❌ Item not found.");
      return interaction.editReply(`✅ Linked role **${role.name}** to **${res.rows[0].name}** (\`${itemId}\`).`);
    }

    if (sub === "disable" || sub === "enable") {
      const itemId = interaction.options.getString("item_id", true).trim();
      const enabled = sub === "enable";

      const res = await db.query(
        `UPDATE store_items SET enabled=$3, updated_at=NOW() WHERE guild_id=$1 AND item_id=$2 RETURNING name`,
        [guildId, itemId, enabled]
      );

      if (!res.rowCount) return interaction.editReply("❌ Item not found.");
      return interaction.editReply(`✅ ${enabled ? "Enabled" : "Disabled"} **${res.rows[0].name}** (\`${itemId}\`).`);
    }

    if (sub === "list") {
      const includeDisabled = interaction.options.getBoolean("include_disabled", false) ?? false;

      const res = await db.query(
        `
        SELECT item_id, name, price, kind, stackable, enabled, meta, sort_order,
               max_owned, max_uses, max_purchase_ever, cooldown_seconds, daily_stock
        FROM store_items
        WHERE guild_id=$1
          AND ($2::bool = true OR enabled = true)
        ORDER BY sort_order ASC, price ASC, name ASC
        `,
        [guildId, includeDisabled]
      );

      if (!res.rows.length) return interaction.editReply("🛒 No store items found.");

      const lines = res.rows.slice(0, 25).map((it) => {
        const status = it.enabled ? "✅" : "⛔";
        const roleTag = it.kind === "role" ? ` (role:${it.meta?.role_id ?? "unset"})` : "";

        const tags = [];
        if (Number(it.max_owned || 0) > 0) tags.push(`max_owned=${it.max_owned}`);
        if (Number(it.max_uses || 0) > 0) tags.push(`max_uses=${it.max_uses}`);
        if (Number(it.max_purchase_ever || 0) > 0) tags.push(`ever=${it.max_purchase_ever}`);
        if (Number(it.cooldown_seconds || 0) > 0) tags.push(`cd=${it.cooldown_seconds}s`);
        if (Number(it.daily_stock || 0) > 0) tags.push(`daily=${it.daily_stock}`);

        return `${status} **${it.name}** — \`${it.item_id}\` — ${money(it.price)} — ${it.kind}${roleTag}${tags.length ? ` (${tags.join(", ")})` : ""}`;
      });

      const embed = new EmbedBuilder()
        .setTitle("🧰 Shop Admin — Items")
        .setDescription(lines.join("\n"))
        .setFooter({ text: res.rows.length > 25 ? `Showing 25 of ${res.rows.length}` : " " });

      return interaction.editReply({ embeds: [embed] });
    }

    return interaction.editReply("❌ Unknown subcommand.");
  },
};
