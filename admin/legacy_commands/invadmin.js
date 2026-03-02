// commands/invadmin.js
const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { pool } = require("../../utils/db");

const SHOP_ADMIN_ROLE_ID = "741251069002121236";

module.exports = {
  data: new SlashCommandBuilder()
    .setName("invadmin")
    .setDescription("Admin tools for player inventories.")
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("Remove an item from a user's inventory (even if not in shop).")
        .addUserOption((opt) =>
          opt.setName("user").setDescription("Target user").setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName("item")
            .setDescription("Item ID to remove (e.g. Crime_Kit)")
            .setRequired(true)
        )
        .addIntegerOption((opt) =>
          opt
            .setName("qty")
            .setDescription("Quantity to remove (ignored if all=true)")
            .setMinValue(1)
            .setRequired(false)
        )
        .addBooleanOption((opt) =>
          opt
            .setName("all")
            .setDescription("Hard delete the item row (remove everything)")
            .setRequired(false)
        )
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
    if (!interaction.inGuild()) return interaction.editReply("❌ Server only.");

    // Role gate
    const member = interaction.member;
    const hasRole =
      member?.roles?.cache?.has?.(SHOP_ADMIN_ROLE_ID) ||
      member?.roles?.cache?.some?.((r) => r.id === SHOP_ADMIN_ROLE_ID);

    if (!hasRole) {
      return interaction.editReply("❌ You don’t have permission to use this command.");
    }

    const sub = interaction.options.getSubcommand();
    if (sub !== "remove") return interaction.editReply("❌ Unknown subcommand.");

    const guildId = interaction.guildId;
    const target = interaction.options.getUser("user", true);
    const targetId = target.id;

    const itemIdRaw = interaction.options.getString("item", true);
    const itemId = String(itemIdRaw).trim();

    if (!itemId || itemId.length > 64) {
      return interaction.editReply("❌ Invalid item ID.");
    }

    const hardDelete = interaction.options.getBoolean("all") ?? false;
    const qtyToRemove = hardDelete ? null : (interaction.options.getInteger("qty") ?? 1);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const curRes = await client.query(
        `SELECT qty, uses_remaining
         FROM user_inventory
         WHERE guild_id=$1 AND user_id=$2 AND item_id=$3
         FOR UPDATE`,
        [guildId, targetId, itemId]
      );

      if (!curRes.rowCount) {
        await client.query("ROLLBACK");
        return interaction.editReply(`❌ **${target.username}** does not have \`${itemId}\`.`);
      }

      const currentQty = Number(curRes.rows[0].qty || 0);
      const currentUses = curRes.rows[0].uses_remaining;

      if (hardDelete) {
        await client.query(
          `DELETE FROM user_inventory
           WHERE guild_id=$1 AND user_id=$2 AND item_id=$3`,
          [guildId, targetId, itemId]
        );

        await client.query("COMMIT");
        return interaction.editReply(
          `✅ Hard deleted \`${itemId}\` from **${target.username}**.\n` +
            `(was qty: **${currentQty}**${currentUses !== null && currentUses !== undefined ? `, uses: **${Number(currentUses)}**` : ""})`
        );
      }

      const removeQty = Math.max(1, Number(qtyToRemove || 1));

      if (currentQty <= removeQty) {
        await client.query(
          `DELETE FROM user_inventory
           WHERE guild_id=$1 AND user_id=$2 AND item_id=$3`,
          [guildId, targetId, itemId]
        );

        await client.query("COMMIT");
        return interaction.editReply(
          `✅ Removed \`${itemId}\` from **${target.username}** (removed **${currentQty}**, remaining **0**).`
        );
      }

      const newQty = currentQty - removeQty;

      await client.query(
        `UPDATE user_inventory
         SET qty = $4,
             updated_at = NOW()
         WHERE guild_id=$1 AND user_id=$2 AND item_id=$3`,
        [guildId, targetId, itemId, newQty]
      );

      await client.query("COMMIT");
      return interaction.editReply(
        `✅ Removed **${removeQty}** of \`${itemId}\` from **${target.username}**.\n` +
          `Remaining: **${newQty}**`
      );
    } catch (e) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      console.error("[invadmin remove] failed:", e);
      return interaction.editReply("❌ Failed to remove item (DB error). Check logs.");
    } finally {
      client.release();
    }
  },
};
