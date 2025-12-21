// utils/store.js
const { pool } = require("./db");

// Small helper: positive integer clamp
function clampQty(qty) {
  const n = Number(qty);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.floor(n));
}

// Postgres expression: start of current UTC day
const SQL_UTC_DAY_START = `(date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')`;

async function listStoreItems(guildId, { enabledOnly = true } = {}) {
  const res = await pool.query(
    `
    SELECT item_id, name, description, price, kind, stackable, enabled, meta, sort_order,
           max_owned, max_uses, max_purchase_ever, cooldown_seconds, daily_stock
    FROM store_items
    WHERE guild_id = $1
      AND ($2::bool = false OR enabled = true)
    ORDER BY sort_order ASC, price ASC, name ASC
    `,
    [guildId, enabledOnly]
  );
  return res.rows;
}

async function getStoreItem(guildId, itemId) {
  const res = await pool.query(
    `SELECT * FROM store_items WHERE guild_id=$1 AND item_id=$2`,
    [guildId, itemId]
  );
  return res.rows?.[0] ?? null;
}

async function getInventory(guildId, userId) {
  const res = await pool.query(
    `
    SELECT ui.item_id, ui.qty, ui.uses_remaining, ui.meta,
           si.name, si.kind, si.max_uses, si.max_owned
    FROM user_inventory ui
    LEFT JOIN store_items si
      ON si.guild_id = ui.guild_id AND si.item_id = ui.item_id
    WHERE ui.guild_id=$1 AND ui.user_id=$2
    ORDER BY COALESCE(si.sort_order, 999999) ASC, ui.item_id ASC
    `,
    [guildId, userId]
  );
  return res.rows;
}

/**
 * Spend uses from an inventory item safely (for future games/jobs).
 *
 * Returns:
 * { ok:true, usesRemaining }
 * { ok:false, reason:"not_owned"|"insufficient_uses" }
 */
async function consumeUses(guildId, userId, itemId, amountRaw = 1) {
  const amount = clampQty(amountRaw);

  const res = await pool.query(
    `
    UPDATE user_inventory
    SET uses_remaining = uses_remaining - $4,
        updated_at = NOW()
    WHERE guild_id=$1 AND user_id=$2 AND item_id=$3
      AND uses_remaining >= $4
    RETURNING uses_remaining
    `,
    [guildId, userId, itemId, amount]
  );

  if (res.rowCount === 0) {
    const check = await pool.query(
      `SELECT qty, uses_remaining FROM user_inventory WHERE guild_id=$1 AND user_id=$2 AND item_id=$3`,
      [guildId, userId, itemId]
    );

    if (!check.rowCount || Number(check.rows[0].qty || 0) <= 0) {
      return { ok: false, reason: "not_owned" };
    }
    return { ok: false, reason: "insufficient_uses" };
  }

  return { ok: true, usesRemaining: Number(res.rows[0].uses_remaining) };
}

/**
 * Remove item from inventory if it's broken (uses_remaining <= 0).
 * Useful for max_owned=1 items so they can buy again after it breaks.
 */
async function removeBrokenIfZero(guildId, userId, itemId) {
  await pool.query(
    `
    DELETE FROM user_inventory
    WHERE guild_id=$1 AND user_id=$2 AND item_id=$3 AND uses_remaining <= 0
    `,
    [guildId, userId, itemId]
  );
}

/**
 * Safe purchase:
 * - guild-scoped
 * - never negative balances
 * - logs transactions
 * - logs store_purchases
 * - enforces:
 *   - max_owned
 *   - max_uses -> uses_remaining
 *   - max_purchase_ever (one-time purchase per person)
 *   - cooldown_seconds (per-user cooldown)
 *   - daily_stock (global daily stock for current UTC day)
 *
 * Reasons:
 * - not_found
 * - disabled
 * - bad_price
 * - insufficient_funds
 * - max_owned
 * - sold_out_daily
 * - cooldown
 * - max_purchase_ever
 */
async function purchaseItem(guildId, userId, itemId, qtyRaw, meta = {}) {
  const qty = clampQty(qtyRaw);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Ensure required base rows exist
    await client.query(
      `INSERT INTO guilds (guild_id) VALUES ($1)
       ON CONFLICT (guild_id) DO NOTHING`,
      [guildId]
    );

    await client.query(
      `INSERT INTO user_balances (guild_id, user_id) VALUES ($1, $2)
       ON CONFLICT (guild_id, user_id) DO NOTHING`,
      [guildId, userId]
    );

    // Lock item row during purchase
    const itemRes = await client.query(
      `
      SELECT item_id, name, description, price, kind, stackable, enabled, meta,
             COALESCE(max_owned, 0) AS max_owned,
             COALESCE(max_uses, 0) AS max_uses,
             COALESCE(max_purchase_ever, 0) AS max_purchase_ever,
             COALESCE(cooldown_seconds, 0) AS cooldown_seconds,
             COALESCE(daily_stock, 0) AS daily_stock
      FROM store_items
      WHERE guild_id=$1 AND item_id=$2
      FOR UPDATE
      `,
      [guildId, itemId]
    );

    const item = itemRes.rows?.[0] ?? null;
    if (!item) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "not_found" };
    }
    if (!item.enabled) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "disabled" };
    }

    const unitPrice = Number(item.price || 0);
    if (unitPrice <= 0) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "bad_price" };
    }

    const maxOwned = Number(item.max_owned || 0);
    const maxUses = Number(item.max_uses || 0);
    const isUsesItem = maxUses > 0;

    const maxPurchaseEver = Number(item.max_purchase_ever || 0); // 1 = once ever
    const cooldownSeconds = Number(item.cooldown_seconds || 0);  // e.g. 86400
    const dailyStock = Number(item.daily_stock || 0);           // e.g. 5

    // For uses-based items, force qty=1 (keeps charges tracking sane)
    const qtyBought = (item.stackable && !isUsesItem) ? qty : 1;

    // A) One-time purchase per person (ever)
    if (maxPurchaseEver > 0) {
      const everRes = await client.query(
        `
        SELECT 1
        FROM store_purchases
        WHERE guild_id=$1 AND user_id=$2 AND item_id=$3
        LIMIT 1
        `,
        [guildId, userId, itemId]
      );

      if (everRes.rowCount > 0) {
        await client.query("ROLLBACK");
        return { ok: false, reason: "max_purchase_ever" };
      }
    }

    // B) Per-user cooldown (seconds)
    if (cooldownSeconds > 0) {
      const lastRes = await client.query(
        `
        SELECT created_at
        FROM store_purchases
        WHERE guild_id=$1 AND user_id=$2 AND item_id=$3
        ORDER BY created_at DESC
        LIMIT 1
        `,
        [guildId, userId, itemId]
      );

      if (lastRes.rowCount > 0) {
        const lastMs = new Date(lastRes.rows[0].created_at).getTime();
        const nextOkMs = lastMs + cooldownSeconds * 1000;
        const remainingMs = nextOkMs - Date.now();

        if (remainingMs > 0) {
          await client.query("ROLLBACK");
          return {
            ok: false,
            reason: "cooldown",
            retryAfterSec: Math.ceil(remainingMs / 1000),
          };
        }
      }
    }

    // C) Global daily stock for current UTC day
    if (dailyStock > 0) {
      const stockRes = await client.query(
        `
        SELECT COALESCE(SUM(qty), 0) AS bought_today
        FROM store_purchases
        WHERE guild_id=$1 AND item_id=$2
          AND created_at >= ${SQL_UTC_DAY_START}
        `,
        [guildId, itemId]
      );

      const boughtToday = Number(stockRes.rows?.[0]?.bought_today ?? 0);
      const remaining = dailyStock - boughtToday;

      if (remaining < qtyBought) {
        await client.query("ROLLBACK");
        return { ok: false, reason: "sold_out_daily", remaining: Math.max(0, remaining) };
      }
    }

    // D) Max owned in inventory
    if (maxOwned > 0) {
      const ownedRes = await client.query(
        `SELECT qty FROM user_inventory WHERE guild_id=$1 AND user_id=$2 AND item_id=$3`,
        [guildId, userId, itemId]
      );
      const ownedQty = ownedRes.rowCount ? Number(ownedRes.rows[0].qty || 0) : 0;

      if (ownedQty + qtyBought > maxOwned) {
        await client.query("ROLLBACK");
        return { ok: false, reason: "max_owned" };
      }
    }

    const totalPrice = unitPrice * qtyBought;

    // Debit ONLY if enough
    const debitRes = await client.query(
      `
      UPDATE user_balances
      SET balance = balance - $3
      WHERE guild_id=$1 AND user_id=$2 AND balance >= $3
      RETURNING balance
      `,
      [guildId, userId, totalPrice]
    );

    if (debitRes.rowCount === 0) {
      const balNow = await client.query(
        `SELECT balance FROM user_balances WHERE guild_id=$1 AND user_id=$2`,
        [guildId, userId]
      );
      await client.query("ROLLBACK");
      return { ok: false, reason: "insufficient_funds", balance: Number(balNow.rows?.[0]?.balance ?? 0) };
    }

    const newBalance = Number(debitRes.rows[0].balance);

    // Inventory upsert:
    // - Uses items: on INSERT set uses_remaining=maxUses
    // - On UPDATE: do NOT refill uses (prevents “recharge abuse”)
    const invRes = await client.query(
      `
      INSERT INTO user_inventory (guild_id, user_id, item_id, qty, uses_remaining, meta, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())
      ON CONFLICT (guild_id, user_id, item_id)
      DO UPDATE SET
        qty = user_inventory.qty + EXCLUDED.qty,
        updated_at = NOW()
      RETURNING qty, uses_remaining
      `,
      [guildId, userId, itemId, qtyBought, isUsesItem ? maxUses : 0, JSON.stringify(meta)]
    );

    const newQty = Number(invRes.rows?.[0]?.qty ?? qtyBought);
    const usesRemaining = Number(invRes.rows?.[0]?.uses_remaining ?? 0);

    // Transactions audit
    await client.query(
      `
      INSERT INTO transactions (guild_id, user_id, amount, type, meta)
      VALUES ($1, $2, $3, $4, $5::jsonb)
      `,
      [
        guildId,
        userId,
        -totalPrice,
        "shop_purchase",
        JSON.stringify({
          itemId,
          qty: qtyBought,
          unitPrice,
          totalPrice,
          kind: item.kind,
          maxOwned,
          maxUses,
          maxPurchaseEver,
          cooldownSeconds,
          dailyStock,
          itemMeta: item.meta,
          ...meta,
        }),
      ]
    );

    // Purchase log (drives limits)
    await client.query(
      `
      INSERT INTO store_purchases (guild_id, user_id, item_id, qty, unit_price, total_price)
      VALUES ($1,$2,$3,$4,$5,$6)
      `,
      [guildId, userId, itemId, qtyBought, unitPrice, totalPrice]
    );

    await client.query("COMMIT");

    return {
      ok: true,
      item,
      qtyBought,
      totalPrice,
      newBalance,
      newQty,
      usesRemaining: isUsesItem ? usesRemaining : undefined,
    };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

module.exports = {
  listStoreItems,
  getStoreItem,
  getInventory,
  purchaseItem,
  consumeUses,
  removeBrokenIfZero,
};
