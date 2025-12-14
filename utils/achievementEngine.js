// utils/achievementEngine.js

async function tryLogTransaction(client, { guildId, userId, rewardCoins, achievementId }) {
  const attempts = [
    {
      sql: `INSERT INTO transactions (guild_id, user_id, type, amount, note, created_at)
            VALUES ($1,$2,$3,$4,$5,NOW())`,
      params: [guildId, userId, "ACHIEVEMENT_REWARD", rewardCoins, `Unlocked: ${achievementId}`],
    },
    {
      sql: `INSERT INTO transactions (guild_id, user_id, type, amount, created_at)
            VALUES ($1,$2,$3,$4,NOW())`,
      params: [guildId, userId, "ACHIEVEMENT_REWARD", rewardCoins],
    },
    {
      sql: `INSERT INTO transactions (guild_id, user_id, type, amount)
            VALUES ($1,$2,$3,$4)`,
      params: [guildId, userId, "ACHIEVEMENT_REWARD", rewardCoins],
    },
  ];

  for (const a of attempts) {
    try {
      await client.query(a.sql, a.params);
      return true;
    } catch {
      // try next schema
    }
  }
  return false;
}

async function unlockAchievement({ db, guildId, userId, achievementId }) {
  if (!db) return { unlocked: false, reason: "No DB" };

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const ins = await client.query(
      `INSERT INTO user_achievements (guild_id, user_id, achievement_id)
       VALUES ($1,$2,$3)
       ON CONFLICT DO NOTHING`,
      [guildId, userId, achievementId]
    );

    if (ins.rowCount === 0) {
      await client.query("ROLLBACK");
      return { unlocked: false, reason: "Already unlocked" };
    }

    const { rows } = await client.query(
      `SELECT name, reward_coins, reward_role_id
       FROM achievements
       WHERE id = $1`,
      [achievementId]
    );

    const ach = rows[0] || { name: achievementId, reward_coins: 0, reward_role_id: null };
    const rewardCoins = Number(ach.reward_coins || 0);
    const rewardRoleId = ach.reward_role_id || null;

    if (rewardCoins > 0) {
      await client.query(
        `INSERT INTO user_balances (guild_id, user_id, balance)
         VALUES ($1,$2,$3)
         ON CONFLICT (guild_id, user_id)
         DO UPDATE SET balance = user_balances.balance + EXCLUDED.balance`,
        [guildId, userId, rewardCoins]
      );

      const logged = await tryLogTransaction(client, { guildId, userId, rewardCoins, achievementId });
      if (!logged) {
        console.warn("⚠️ Transaction log failed (achievement still granted): schema mismatch");
      }
    }

    await client.query("COMMIT");
    return { unlocked: true, name: ach.name, rewardCoins, rewardRoleId };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { unlockAchievement };
