// utils/economy.js
// Central money movement utilities.
// Wallet = active cash (old balance column)
// Bank   = protected stored funds

const { pool } = require("./db");
const achievementEngine = require("./achievementEngine");
const achievementProgress = require("./achievementProgress");

let _chosenCache = new Map();
async function getActiveEchoChosenPerk(guildId, userId) {
  try {
    const key = `${guildId}:${userId}`;
    const now = Date.now();
    const cached = _chosenCache.get(key);
    if (cached && (now - cached.cachedAtMs) < 30_000) {
      if (cached.expiresAtMs && cached.expiresAtMs <= now) return null;
      return cached.perk || null;
    }

    const res = await pool.query(
      `SELECT perk, expires_at
       FROM echo_chosen
       WHERE guild_id=$1 AND user_id=$2 AND expires_at > NOW()
       LIMIT 1`,
      [String(guildId), String(userId)]
    );

    const row = res.rows?.[0];
    const perk = row?.perk ? String(row.perk) : null;
    const exp = row?.expires_at ? new Date(row.expires_at).getTime() : null;
    _chosenCache.set(key, { perk, expiresAtMs: exp, cachedAtMs: now });
    return perk;
  } catch {
    return null;
  }
}

function shouldDoubleCasinoPayout(type) {
  const t = String(type || "");
  return (
    t === "blackjack_payout" ||
    t === "roulette_payout" ||
    t === "higherlower_payout" ||
    t === "bullshit_payout"
  );
}

let _countersReady = false;
async function ensureCountersReady() {
  if (_countersReady) return;
  try {
    await achievementProgress.ensureCounterTables(pool);
    _countersReady = true;
  } catch (e) {
    console.warn("[ECON][ACH] ensureCounterTables failed:", e?.message || e);
  }
}

async function safeUnlock(guildId, userId, achievementId) {
  try {
    await achievementEngine.unlockAchievement({
      db: pool,
      guildId,
      userId,
      achievementId,
    });
  } catch (e) {
    console.warn("[ECON][ACH] unlock failed:", achievementId, e?.message || e);
  }
}

async function safeIncAndCheck({ guildId, userId, key, delta }) {
  await ensureCountersReady();
  try {
    const val = await achievementProgress.incCounter(pool, guildId, userId, key, delta);
    await achievementProgress.checkAndUnlockProgressAchievements({
      db: pool,
      guildId,
      userId,
      key,
      currentValue: val,
    });
    return val;
  } catch (e) {
    console.warn("[ECON][ACH] incCounter failed:", key, e?.message || e);
    return null;
  }
}

async function safeMaxAndCheck({ guildId, userId, key, candidate }) {
  await ensureCountersReady();
  try {
    const val = await achievementProgress.maxCounter(pool, guildId, userId, key, candidate);
    await achievementProgress.checkAndUnlockProgressAchievements({
      db: pool,
      guildId,
      userId,
      key,
      currentValue: val,
    });
    return val;
  } catch (e) {
    console.warn("[ECON][ACH] maxCounter failed:", key, e?.message || e);
    return null;
  }
}

async function trackCredit({ guildId, userId, amount, newBalance }) {
  const credits = await safeIncAndCheck({ guildId, userId, key: "economy_credits", delta: 1 });
  await safeIncAndCheck({ guildId, userId, key: "economy_transactions", delta: 1 });
  await safeMaxAndCheck({ guildId, userId, key: "economy_max_credit", candidate: amount });
  await safeMaxAndCheck({ guildId, userId, key: "economy_max_balance", candidate: newBalance });
  if (credits === 1) await safeUnlock(guildId, userId, "eco_first_coin");
}

async function trackDebit({ guildId, userId, amount, newBalance }) {
  const debits = await safeIncAndCheck({ guildId, userId, key: "economy_debits", delta: 1 });
  await safeIncAndCheck({ guildId, userId, key: "economy_transactions", delta: 1 });
  await safeMaxAndCheck({ guildId, userId, key: "economy_max_debit", candidate: amount });
  await safeMaxAndCheck({ guildId, userId, key: "economy_max_balance", candidate: newBalance });
  if (debits === 1) await safeUnlock(guildId, userId, "eco_first_spend");
  if (Number(newBalance) === 0) await safeUnlock(guildId, userId, "eco_broke");
}

async function ensureGuild(guildId) {
  await pool.query(
    `INSERT INTO guilds (guild_id) VALUES ($1)
     ON CONFLICT (guild_id) DO NOTHING`,
    [guildId]
  );
}

async function generateUniqueAccountNumber(client) {
  for (let i = 0; i < 10; i++) {
    const accountNumber = String(Math.floor(1000000000 + Math.random() * 9000000000));
    const exists = await client.query(
      `SELECT 1 FROM user_balances WHERE account_number=$1 LIMIT 1`,
      [accountNumber]
    );
    if (exists.rowCount === 0) return accountNumber;
  }
  return `${Date.now()}`.slice(-10);
}

async function ensureUser(guildId, userId) {
  await ensureGuild(guildId);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO user_balances (guild_id, user_id) VALUES ($1, $2)
       ON CONFLICT (guild_id, user_id) DO NOTHING`,
      [guildId, userId]
    );

    const rowRes = await client.query(
      `SELECT account_number FROM user_balances WHERE guild_id=$1 AND user_id=$2 FOR UPDATE`,
      [guildId, userId]
    );
    if (!rowRes.rows?.[0]?.account_number) {
      const newAccount = await generateUniqueAccountNumber(client);
      await client.query(
        `UPDATE user_balances
         SET account_number=$3
         WHERE guild_id=$1 AND user_id=$2`,
        [guildId, userId, newAccount]
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function getWalletBalance(guildId, userId) {
  await ensureUser(guildId, userId);
  const res = await pool.query(
    `SELECT balance FROM user_balances WHERE guild_id=$1 AND user_id=$2`,
    [guildId, userId]
  );
  return Number(res.rows[0]?.balance ?? 0);
}

async function getBankBalance(guildId, userId) {
  await ensureUser(guildId, userId);
  const res = await pool.query(
    `SELECT bank_balance FROM user_balances WHERE guild_id=$1 AND user_id=$2`,
    [guildId, userId]
  );
  return Number(res.rows[0]?.bank_balance ?? 0);
}

async function getAccountNumber(guildId, userId) {
  await ensureUser(guildId, userId);
  const res = await pool.query(
    `SELECT account_number FROM user_balances WHERE guild_id=$1 AND user_id=$2`,
    [guildId, userId]
  );
  return String(res.rows[0]?.account_number ?? "");
}

async function getEconomySnapshot(guildId, userId) {
  await ensureUser(guildId, userId);
  const res = await pool.query(
    `SELECT balance, bank_balance, account_number
     FROM user_balances
     WHERE guild_id=$1 AND user_id=$2`,
    [guildId, userId]
  );
  const row = res.rows?.[0] || {};
  const wallet = Number(row.balance ?? 0);
  const bank = Number(row.bank_balance ?? 0);
  return {
    wallet,
    bank,
    total: wallet + bank,
    accountNumber: String(row.account_number ?? ""),
  };
}

async function getBalance(guildId, userId) {
  return getWalletBalance(guildId, userId);
}

async function getServerBank(guildId) {
  await ensureGuild(guildId);
  const res = await pool.query(
    `SELECT bank_balance FROM guilds WHERE guild_id=$1`,
    [guildId]
  );
  return Number(res.rows[0]?.bank_balance ?? 0);
}

async function tryDebitUser(guildId, userId, amount, type, meta = {}) {
  if (amount <= 0) throw new Error("Amount must be positive");
  await ensureUser(guildId, userId);

  const res = await pool.query(
    `UPDATE user_balances
     SET balance = balance - $3
     WHERE guild_id=$1 AND user_id=$2 AND balance >= $3
     RETURNING balance`,
    [guildId, userId, amount]
  );

  if (res.rowCount === 0) return { ok: false };

  await pool.query(
    `INSERT INTO transactions (guild_id, user_id, amount, type, meta)
     VALUES ($1, $2, $3, $4, $5)`,
    [guildId, userId, -amount, type, { ...meta, balance_type: "wallet" }]
  );

  const newBalance = Number(res.rows[0].balance);
  trackDebit({ guildId, userId, amount, newBalance }).catch(() => {});
  return { ok: true, newBalance };
}

async function creditUser(guildId, userId, amount, type, meta = {}) {
  if (amount <= 0) throw new Error("Amount must be positive");
  await ensureUser(guildId, userId);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const recovery = await bankLoans.applyRecoveryToIncoming({
      client, guildId, userId, amount, balanceType: "wallet", type, meta,
    });

    let creditedAmount = Number(recovery.creditedAmount || 0);
    let newBalance = null;
    if (creditedAmount > 0) {
      const res = await client.query(
        `UPDATE user_balances
         SET balance = balance + $3
         WHERE guild_id=$1 AND user_id=$2
         RETURNING balance`,
        [guildId, userId, creditedAmount]
      );
      newBalance = Number(res.rows[0].balance);
      await client.query(
        `INSERT INTO transactions (guild_id, user_id, amount, type, meta)
         VALUES ($1, $2, $3, $4, $5)`,
        [guildId, userId, creditedAmount, type, { ...meta, balance_type: "wallet" }]
      );
    } else {
      const bal = await client.query(`SELECT balance FROM user_balances WHERE guild_id=$1 AND user_id=$2`, [guildId, userId]);
      newBalance = Number(bal.rows?.[0]?.balance ?? 0);
    }

    if (Number(recovery.recoveredAmount || 0) > 0) {
      await client.query(
        `INSERT INTO transactions (guild_id, user_id, amount, type, meta)
         VALUES ($1, $2, 0, 'loan_recovery_garnish', $3)`,
        [guildId, userId, {
          amount: Number(recovery.recoveredAmount || 0),
          status: recovery.status,
          sourceType: type,
          creditedAmount,
          originalAmount: amount,
          balance_type: "wallet",
        }]
      );
    }

    await client.query("COMMIT");
    if (creditedAmount > 0) trackCredit({ guildId, userId, amount: creditedAmount, newBalance }).catch(() => {});
    return { ok: true, newBalance, creditedAmount, recoveredAmount: Number(recovery.recoveredAmount || 0), loanStatus: recovery.status };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function creditBank(guildId, userId, amount, type, meta = {}) {
  if (amount <= 0) throw new Error("Amount must be positive");
  await ensureUser(guildId, userId);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const recovery = await bankLoans.applyRecoveryToIncoming({
      client, guildId, userId, amount, balanceType: "bank", type, meta,
    });

    let creditedAmount = Number(recovery.creditedAmount || 0);
    let newBalance = null;
    if (creditedAmount > 0) {
      const res = await client.query(
        `UPDATE user_balances
         SET bank_balance = bank_balance + $3
         WHERE guild_id=$1 AND user_id=$2
         RETURNING bank_balance`,
        [guildId, userId, creditedAmount]
      );
      newBalance = Number(res.rows[0].bank_balance);
      await client.query(
        `INSERT INTO transactions (guild_id, user_id, amount, type, meta)
         VALUES ($1, $2, $3, $4, $5)`,
        [guildId, userId, creditedAmount, type, { ...meta, balance_type: "bank" }]
      );
    } else {
      const bal = await client.query(`SELECT bank_balance FROM user_balances WHERE guild_id=$1 AND user_id=$2`, [guildId, userId]);
      newBalance = Number(bal.rows?.[0]?.bank_balance ?? 0);
    }

    if (Number(recovery.recoveredAmount || 0) > 0) {
      await client.query(
        `INSERT INTO transactions (guild_id, user_id, amount, type, meta)
         VALUES ($1, $2, 0, 'loan_recovery_garnish', $3)`,
        [guildId, userId, {
          amount: Number(recovery.recoveredAmount || 0),
          status: recovery.status,
          sourceType: type,
          creditedAmount,
          originalAmount: amount,
          balance_type: "bank",
        }]
      );
    }

    await client.query("COMMIT");
    return { ok: true, newBalance, creditedAmount, recoveredAmount: Number(recovery.recoveredAmount || 0), loanStatus: recovery.status };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function tryDebitBank(guildId, userId, amount, type, meta = {}) {
  if (amount <= 0) throw new Error("Amount must be positive");
  await ensureUser(guildId, userId);

  const res = await pool.query(
    `UPDATE user_balances
     SET bank_balance = bank_balance - $3
     WHERE guild_id=$1 AND user_id=$2 AND bank_balance >= $3
     RETURNING bank_balance`,
    [guildId, userId, amount]
  );

  if (res.rowCount === 0) return { ok: false };

  await pool.query(
    `INSERT INTO transactions (guild_id, user_id, amount, type, meta)
     VALUES ($1, $2, $3, $4, $5)`,
    [guildId, userId, -amount, type, { ...meta, balance_type: "bank" }]
  );

  return { ok: true, newBalance: Number(res.rows[0].bank_balance) };
}

async function depositToBank(guildId, userId, amount, meta = {}) {
  if (amount <= 0) throw new Error("Amount must be positive");
  await ensureUser(guildId, userId);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const move = await client.query(
      `UPDATE user_balances
       SET balance = balance - $3,
           bank_balance = bank_balance + $3
       WHERE guild_id=$1 AND user_id=$2 AND balance >= $3
       RETURNING balance, bank_balance, account_number`,
      [guildId, userId, amount]
    );

    if (move.rowCount === 0) {
      await client.query("ROLLBACK");
      return { ok: false };
    }

    await client.query(
      `INSERT INTO transactions (guild_id, user_id, amount, type, meta)
       VALUES ($1, $2, $3, $4, $5)`,
      [guildId, userId, 0, "bank_deposit", { ...meta, amount, from: "wallet", to: "bank" }]
    );

    await client.query("COMMIT");
    const row = move.rows[0];
    return {
      ok: true,
      wallet: Number(row.balance ?? 0),
      bank: Number(row.bank_balance ?? 0),
      accountNumber: String(row.account_number ?? ""),
    };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function withdrawFromBank(guildId, userId, amount, meta = {}) {
  if (amount <= 0) throw new Error("Amount must be positive");
  await ensureUser(guildId, userId);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const transferCheck = await bankLoans.canTransferOut(guildId, userId);
    if (!transferCheck.ok) {
      await client.query("ROLLBACK");
      return { ok: false, reason: transferCheck.reason };
    }
    const move = await client.query(
      `UPDATE user_balances
       SET bank_balance = bank_balance - $3,
           balance = balance + $3
       WHERE guild_id=$1 AND user_id=$2 AND bank_balance >= $3
       RETURNING balance, bank_balance, account_number`,
      [guildId, userId, amount]
    );

    if (move.rowCount === 0) {
      await client.query("ROLLBACK");
      return { ok: false };
    }

    await client.query(
      `INSERT INTO transactions (guild_id, user_id, amount, type, meta)
       VALUES ($1, $2, $3, $4, $5)`,
      [guildId, userId, 0, "bank_withdraw", { ...meta, amount, from: "bank", to: "wallet" }]
    );

    await client.query("COMMIT");
    const row = move.rows[0];
    return {
      ok: true,
      wallet: Number(row.balance ?? 0),
      bank: Number(row.bank_balance ?? 0),
      accountNumber: String(row.account_number ?? ""),
    };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function transferBankByAccount(guildId, fromUserId, toAccountNumber, amount, meta = {}) {
  if (amount <= 0) throw new Error("Amount must be positive");
  await ensureUser(guildId, fromUserId);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const transferCheck = await bankLoans.canTransferOut(guildId, fromUserId);
    if (!transferCheck.ok) {
      await client.query("ROLLBACK");
      return { ok: false, reason: transferCheck.reason };
    }

    const sourceRes = await client.query(
      `SELECT user_id, bank_balance, account_number
       FROM user_balances
       WHERE guild_id=$1 AND user_id=$2
       FOR UPDATE`,
      [guildId, fromUserId]
    );
    const source = sourceRes.rows?.[0];
    if (!source) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "source_missing" };
    }

    const targetRes = await client.query(
      `SELECT user_id, account_number
       FROM user_balances
       WHERE guild_id=$1 AND account_number=$2
       FOR UPDATE`,
      [guildId, String(toAccountNumber)]
    );
    const target = targetRes.rows?.[0];
    if (!target) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "account_not_found" };
    }
    if (String(target.user_id) === String(fromUserId)) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "same_account" };
    }

    const debit = await client.query(
      `UPDATE user_balances
       SET bank_balance = bank_balance - $3
       WHERE guild_id=$1 AND user_id=$2 AND bank_balance >= $3
       RETURNING bank_balance`,
      [guildId, fromUserId, amount]
    );
    if (debit.rowCount === 0) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "insufficient_funds" };
    }

    const recovery = await bankLoans.applyRecoveryToIncoming({
      client,
      guildId,
      userId: String(target.user_id),
      amount,
      balanceType: "bank",
      type: "bank_transfer_in",
      meta: { ...meta, fromUserId: String(fromUserId), fromAccountNumber: String(source.account_number || "") },
    });

    let recipientBank = null;
    if (Number(recovery.creditedAmount || 0) > 0) {
      const credit = await client.query(
        `UPDATE user_balances
         SET bank_balance = bank_balance + $3
         WHERE guild_id=$1 AND user_id=$2
         RETURNING bank_balance`,
        [guildId, target.user_id, Number(recovery.creditedAmount || 0)]
      );
      recipientBank = Number(credit.rows[0].bank_balance ?? 0);
    } else {
      const snap = await client.query(`SELECT bank_balance FROM user_balances WHERE guild_id=$1 AND user_id=$2`, [guildId, target.user_id]);
      recipientBank = Number(snap.rows?.[0]?.bank_balance ?? 0);
    }

    await client.query(
      `INSERT INTO transactions (guild_id, user_id, amount, type, meta)
       VALUES ($1, $2, $3, $4, $5),
              ($1, $6, $7, $8, $9)`,
      [
        guildId,
        fromUserId,
        -amount,
        "bank_transfer_out",
        { ...meta, amount, balance_type: "bank", toAccountNumber: String(toAccountNumber), toUserId: String(target.user_id) },
        target.user_id,
        Number(recovery.creditedAmount || 0),
        "bank_transfer_in",
        { ...meta, amount, creditedAmount: Number(recovery.creditedAmount || 0), recoveredAmount: Number(recovery.recoveredAmount || 0), balance_type: "bank", fromUserId: String(fromUserId), fromAccountNumber: String(source.account_number || "") },
      ]
    );

    if (Number(recovery.recoveredAmount || 0) > 0) {
      await client.query(
        `INSERT INTO transactions (guild_id, user_id, amount, type, meta)
         VALUES ($1, $2, 0, 'loan_recovery_garnish', $3)`,
        [guildId, target.user_id, {
          amount: Number(recovery.recoveredAmount || 0),
          status: recovery.status,
          sourceType: 'bank_transfer_in',
          creditedAmount: Number(recovery.creditedAmount || 0),
          originalAmount: amount,
          balance_type: 'bank',
        }]
      );
    }

    await client.query("COMMIT");
    return {
      ok: true,
      toUserId: String(target.user_id),
      senderBank: Number(debit.rows[0].bank_balance ?? 0),
      recipientBank,
      recoveredAmount: Number(recovery.recoveredAmount || 0),
    };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function getRecentTransactions(guildId, userId, limit = 10) {
  await ensureUser(guildId, userId);
  const res = await pool.query(
    `SELECT amount, type, meta, created_at
     FROM transactions
     WHERE guild_id=$1 AND user_id=$2
     ORDER BY created_at DESC
     LIMIT $3`,
    [guildId, userId, Math.max(1, Math.min(25, Number(limit) || 10))]
  );
  return res.rows || [];
}

async function addServerBank(guildId, amount, type, meta = {}) {
  await ensureGuild(guildId);
  const res = await pool.query(
    `UPDATE guilds
     SET bank_balance = bank_balance + $2
     WHERE guild_id=$1
     RETURNING bank_balance`,
    [guildId, amount]
  );

  await pool.query(
    `INSERT INTO transactions (guild_id, user_id, amount, type, meta)
     VALUES ($1, NULL, $2, $3, $4)`,
    [guildId, amount, type, meta]
  );

  if (Number(amount) > 0) {
    const actorId = meta?.userId || meta?.actorId || meta?.user_id || meta?.actor_id;
    if (actorId) {
      safeIncAndCheck({ guildId, userId: String(actorId), key: "economy_bank_adds", delta: 1 }).catch(() => {});
    }
  }

  return Number(res.rows[0].bank_balance);
}

async function bankToUserIfEnough(guildId, userId, amount, type, meta = {}) {
  if (amount <= 0) throw new Error("Amount must be positive");

  if (!meta?.echoChosenApplied && shouldDoubleCasinoPayout(type)) {
    const perk = await getActiveEchoChosenPerk(guildId, userId);
    if (perk === "double_casino") {
      amount = Math.floor(Number(amount) * 2);
      meta = { ...meta, echoChosenApplied: true, echoChosenPerk: perk };
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO guilds (guild_id) VALUES ($1) ON CONFLICT (guild_id) DO NOTHING`, [guildId]);
    await client.query(`INSERT INTO user_balances (guild_id, user_id) VALUES ($1, $2) ON CONFLICT (guild_id, user_id) DO NOTHING`, [guildId, userId]);

    const bankUpdate = await client.query(
      `UPDATE guilds
       SET bank_balance = bank_balance - $2
       WHERE guild_id=$1 AND bank_balance >= $2
       RETURNING bank_balance`,
      [guildId, amount]
    );

    if (bankUpdate.rowCount === 0) {
      const bankNow = await client.query(`SELECT bank_balance FROM guilds WHERE guild_id=$1`, [guildId]);
      await client.query("ROLLBACK");
      return { ok: false, bankBalance: Number(bankNow.rows[0]?.bank_balance ?? 0) };
    }

    const recovery = await bankLoans.applyRecoveryToIncoming({
      client, guildId, userId, amount, balanceType: "wallet", type, meta,
    });

    let newBalance = null;
    if (Number(recovery.creditedAmount || 0) > 0) {
      const userUpdate = await client.query(
        `UPDATE user_balances
         SET balance = balance + $3
         WHERE guild_id=$1 AND user_id=$2
         RETURNING balance`,
        [guildId, userId, Number(recovery.creditedAmount || 0)]
      );
      newBalance = Number(userUpdate.rows?.[0]?.balance ?? 0);
      await client.query(
        `INSERT INTO transactions (guild_id, user_id, amount, type, meta)
         VALUES ($1, $2, $3, $4, $5)`,
        [guildId, userId, Number(recovery.creditedAmount || 0), type, { ...meta, balance_type: "wallet" }]
      );
    } else {
      const bal = await client.query(`SELECT balance FROM user_balances WHERE guild_id=$1 AND user_id=$2`, [guildId, userId]);
      newBalance = Number(bal.rows?.[0]?.balance ?? 0);
    }
    if (Number(recovery.recoveredAmount || 0) > 0) {
      await client.query(
        `INSERT INTO transactions (guild_id, user_id, amount, type, meta)
         VALUES ($1, $2, 0, 'loan_recovery_garnish', $3)`,
        [guildId, userId, {
          amount: Number(recovery.recoveredAmount || 0),
          status: recovery.status,
          sourceType: type,
          creditedAmount: Number(recovery.creditedAmount || 0),
          originalAmount: amount,
          balance_type: 'wallet',
        }]
      );
    }
    await client.query(
      `INSERT INTO transactions (guild_id, user_id, amount, type, meta)
       VALUES ($1, NULL, $2, $3, $4)`,
      [guildId, -amount, `${type}_bank`, meta]
    );

    await client.query("COMMIT");
    if (Number(recovery.creditedAmount || 0) > 0) trackCredit({ guildId, userId, amount: Number(recovery.creditedAmount || 0), newBalance }).catch(() => {});
    safeIncAndCheck({ guildId, userId, key: "economy_bank_payouts", delta: 1 }).catch(() => {});

    return { ok: true, bankBalance: Number(bankUpdate.rows[0].bank_balance), creditedAmount: Number(recovery.creditedAmount || 0), recoveredAmount: Number(recovery.recoveredAmount || 0), loanStatus: recovery.status };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

module.exports = {
  ensureGuild,
  ensureUser,
  getBalance,
  getWalletBalance,
  getBankBalance,
  getAccountNumber,
  getEconomySnapshot,
  getRecentTransactions,
  getServerBank,
  tryDebitUser,
  tryDebitBank,
  creditUser,
  creditBank,
  depositToBank,
  withdrawFromBank,
  transferBankByAccount,
  addServerBank,
  bankToUserIfEnough,
};
