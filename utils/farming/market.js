const { pool } = require("../db");
const marketConfig = require("../../data/farming/marketConfig");
const { getCurrentSeason } = require("./engine");
const seasonControl = require("./seasonControl");

function getPrice(cropId, seasonOrGuildId = null, maybeSeason = null) {
  const knownSeasons = new Set(["spring", "summer", "autumn", "winter"]);
  const season = maybeSeason || (knownSeasons.has(String(seasonOrGuildId)) ? seasonOrGuildId : getCurrentSeason(seasonOrGuildId));
  const cfg = marketConfig[cropId];
  if (!cfg) return 0;

  const range = cfg.seasonalRanges?.[season];
  if (!range || !Array.isArray(range) || range.length < 2) {
    return cfg.basePrice || 0;
  }

  const [min, max] = range;
  return Math.floor((Number(min) + Number(max)) / 2);
}

async function getSellableFarmItems(guildId, userId) {
  await seasonControl.ensureSeasonStateLoaded(guildId);
  const res = await pool.query(
    `
    SELECT ui.item_id, ui.qty, si.name
    FROM user_inventory ui
    JOIN store_items si
      ON si.guild_id = ui.guild_id
     AND si.item_id = ui.item_id
    WHERE ui.guild_id = $1
      AND ui.user_id = $2
      AND COALESCE((si.meta->>'farming')::boolean, false) = true
      AND ui.qty > 0
    ORDER BY si.name ASC
    `,
    [guildId, userId]
  );

  return res.rows.map((row) => {
    const unitPrice = getPrice(row.item_id, guildId);
    return {
      itemId: row.item_id,
      name: row.name,
      qty: Number(row.qty) || 0,
      unitPrice,
      totalValue: (Number(row.qty) || 0) * unitPrice,
    };
  });
}

async function sellCrop(guildId, userId, itemId) {
  const items = await getSellableFarmItems(guildId, userId);
  const item = items.find((x) => x.itemId === itemId);

  if (!item || item.qty <= 0) {
    return { ok: false, reasonText: "You do not have any of that crop to sell." };
  }

  await pool.query(
    `
    UPDATE user_inventory
    SET qty = qty - $1,
        updated_at = NOW()
    WHERE guild_id = $2
      AND user_id = $3
      AND item_id = $4
    `,
    [item.qty, guildId, userId, itemId]
  );

  await pool.query(
    `
    UPDATE user_balances
    SET balance = balance + $1
    WHERE guild_id = $2
      AND user_id = $3
    `,
    [item.totalValue, guildId, userId]
  );

  await pool.query(
    `
    DELETE FROM user_inventory
    WHERE guild_id = $1
      AND user_id = $2
      AND item_id = $3
      AND qty <= 0
    `,
    [guildId, userId, itemId]
  );

  return {
    ok: true,
    qty: item.qty,
    name: item.name,
    totalValue: item.totalValue,
    unitPrice: item.unitPrice,
  };
}

module.exports = {
  getPrice,
  getSellableFarmItems,
  sellCrop,
};