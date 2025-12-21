// utils/inventoryHelpers.js
async function getItemUses(db, guildId, userId, itemId) {
  const res = await db.query(
    `SELECT qty, uses_remaining
     FROM user_inventory
     WHERE guild_id=$1 AND user_id=$2 AND item_id=$3`,
    [guildId, userId, itemId]
  );

  if (!res.rowCount) return { qty: 0, uses: 0 };
  return {
    qty: Number(res.rows[0].qty || 0),
    uses: Number(res.rows[0].uses_remaining || 0),
  };
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

module.exports = { getItemUses, randInt };
