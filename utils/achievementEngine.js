// utils/achievementEngine.js
// Records achievement unlocks ONCE per player, mints rewards, and best-effort logs a transaction.
// IMPORTANT: Logging must never rollback the unlock.
// We also schema-qualify tables with `public.` to avoid search_path surprises.

async function unlockAchievement({ db, guildId, userId, achievementId }) {
  if (!db) return { unlocked: false, reason: "No DB" };

  const cleanUserId = String(userId).replace(/[<@!>]/g, "");

  const client = await db.connect();
  try {
    // 1) Insert “earned” record (AUTOCOMMIT) — cannot be rolled back by later steps
    // Using public.user_achievements prevents schema/search_path mismatch.
    const ins = await client.query(
      `INSERT INTO public.user_achievements (guild_id, user_id, achievement_id)
       VALUES ($1,$2,$3)
       ON CONFLICT DO NOTHING
       RETURNING earned_at`,
      [guildId, cleanUserId, achievementId]
    );

    if (ins.rowCount === 0) {
      return { unlocked: false, reason: "Already unlocked" };
    }

    console.log("[ACH] persisted user_achievement", {
      guildId,
      userId: cleanUserId,
      achievementId,
      earned_at: ins.rows?.[0]?.earned_at,
    });

    // 2) Pull achievement definition (reward info)
    const achRes = await client.query(
      `SELECT id, name, reward_coins, reward_role_id
       FROM public.achievements
       WHERE id = $1`,
      [achievementId]
    );

    const ach = achRes.rows[0] || {
      id: achievementId,
      name: achievementId,
      reward_coins: 0,
      reward_role_id: null,
    };

    const rewardCoins = Number(ach.reward_coins || 0);
    const rewardRoleId = ach.reward_role_id || null;

    // 3) Mint coins to user (no server bank involved)
    if (rewardCoins > 0) {
      await client.query(
        `INSERT INTO public.user_balances (guild_id, user_id, balance)
         VALUES ($1,$2,$3)
         ON CONFLICT (guild_id, user_id)
         DO UPDATE SET balance = public.user_balances.balance + EXCLUDED.balance`,
        [guildId, cleanUserId, rewardCoins]
      );
    }

    // 4) Best-effort transaction log (MUST NOT FAIL ACHIEVEMENT)
    try {
      const colsRes = await client.query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'transactions'`
      );

      const cols = new Set((colsRes.rows || []).map((r) => r.column_name));

      // Minimal expected columns
      const hasCore =
        cols.has("guild_id") &&
        cols.has("user_id") &&
        (cols.has("type") || cols.has("tx_type")) &&
        (cols.has("amount") || cols.has("value")) &&
        (cols.has("created_at") || cols.has("createdAt") || cols.has("timestamp"));

      if (hasCore && rewardCoins > 0) {
        const typeCol = cols.has("type") ? "type" : "tx_type";
        const amountCol = cols.has("amount") ? "amount" : "value";
        const createdCol = cols.has("created_at")
          ? "created_at"
          : cols.has("createdAt")
          ? "createdAt"
          : "timestamp";

        const noteCol = cols.has("note")
          ? "note"
          : cols.has("description")
          ? "description"
          : cols.has("reason")
          ? "reason"
          : null;

        if (noteCol) {
          await client.query(
            `INSERT INTO public.transactions (guild_id, user_id, ${typeCol}, ${amountCol}, ${noteCol}, ${createdCol})
             VALUES ($1,$2,$3,$4,$5,NOW())`,
            [guildId, cleanUserId, "ACHIEVEMENT_REWARD", rewardCoins, `Unlocked: ${achievementId}`]
          );
        } else {
          await client.query(
            `INSERT INTO public.transactions (guild_id, user_id, ${typeCol}, ${amountCol}, ${createdCol})
             VALUES ($1,$2,$3,$4,NOW())`,
            [guildId, cleanUserId, "ACHIEVEMENT_REWARD", rewardCoins]
          );
        }
      }
    } catch (logErr) {
      console.warn("⚠️ Transaction log skipped (achievement still granted):", logErr?.message || logErr);
    }

    return { unlocked: true, name: ach.name, rewardCoins, rewardRoleId };
  } finally {
    client.release();
  }
}

module.exports = { unlockAchievement };
