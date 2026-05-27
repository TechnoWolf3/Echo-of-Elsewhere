const { pool } = require("./db");
const appLinking = require("./appLinking");
const economy = require("./economy");
const bankLoans = require("./bankLoans");
const recurringDeposits = require("./bankRecurringDeposits");

function requirePool() {
  if (!pool || typeof pool.query !== "function") {
    throw new Error("DATABASE_URL is not configured.");
  }
  return pool;
}

async function ensureSchema() {
  await appLinking.ensureSchema();
  await recurringDeposits.ensureSchema();
  const db = requirePool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS bank_loans (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      offer_id TEXT NOT NULL,
      offer_name TEXT NOT NULL,
      principal BIGINT NOT NULL,
      fee BIGINT NOT NULL DEFAULT 0,
      total_due BIGINT NOT NULL,
      remaining_due BIGINT NOT NULL,
      payments_made BIGINT NOT NULL DEFAULT 0,
      recovered_amount BIGINT NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      due_at TIMESTAMPTZ NOT NULL,
      default_at TIMESTAMPTZ NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_payment_at TIMESTAMPTZ NULL,
      paid_at TIMESTAMPTZ NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_bank_loans_guild_user_issued
    ON bank_loans (guild_id, user_id, issued_at DESC);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_loans_one_active
    ON bank_loans (guild_id, user_id)
    WHERE status IN ('active', 'overdue', 'defaulted');
  `);
}

function assertContext(ctx) {
  if (!ctx?.profileId || !ctx.guildId || !ctx.discordUserId) {
    return { ok: false, statusCode: 401, message: "Linked Discord profile is required." };
  }
  return { ok: true };
}

async function isJailed(ctx) {
  const db = requirePool();
  const res = await db.query(
    `SELECT jailed_until
     FROM jail
     WHERE guild_id=$1 AND user_id=$2 AND jailed_until > NOW()
     LIMIT 1`,
    [ctx.guildId, ctx.discordUserId]
  );
  return Boolean(res.rows?.[0]);
}

async function rawBankSnapshot(ctx) {
  const db = requirePool();
  const res = await db.query(
    `SELECT balance, bank_balance, account_number
     FROM user_balances
     WHERE guild_id=$1 AND user_id=$2
     LIMIT 1`,
    [ctx.guildId, ctx.discordUserId]
  );
  const row = res.rows?.[0] || {};
  const walletBalance = Number(row.balance || 0);
  const bankBalance = Number(row.bank_balance || 0);
  const accountNumber = row.account_number ? String(row.account_number) : null;
  return {
    walletBalance,
    bankBalance,
    totalWealth: walletBalance + bankBalance,
    accountNumber,
    account_number: accountNumber,
  };
}

function publicLoan(loan) {
  if (!loan) return null;
  return {
    id: String(loan.id),
    offerId: loan.offer_id,
    offerName: loan.offer_name,
    principal: Number(loan.principal || 0),
    fee: Number(loan.fee || 0),
    totalDue: Number(loan.total_due || 0),
    remainingDue: Number(loan.remaining_due || 0),
    paymentsMade: Number(loan.payments_made || 0),
    recoveredAmount: Number(loan.recovered_amount || 0),
    status: loan.status,
    dueAt: loan.due_at ? new Date(loan.due_at).toISOString() : null,
    defaultAt: loan.default_at ? new Date(loan.default_at).toISOString() : null,
    issuedAt: loan.issued_at ? new Date(loan.issued_at).toISOString() : null,
    paidAt: loan.paid_at ? new Date(loan.paid_at).toISOString() : null,
  };
}

function publicRecurring(row) {
  if (!row) return null;
  return {
    enabled: Boolean(row.enabled),
    amount: Number(row.amount || 0),
    nextRunAt: row.next_run_at ? new Date(row.next_run_at).toISOString() : null,
    lastRunAt: row.last_run_at ? new Date(row.last_run_at).toISOString() : null,
    lastResult: row.last_result || null,
    failedCount: Number(row.failed_count || 0),
  };
}

async function dashboard(ctx) {
  await ensureSchema();
  const valid = assertContext(ctx);
  if (!valid.ok) return valid;

  const [snapshot, loan, recurringDeposit, profile] = await Promise.all([
    rawBankSnapshot(ctx),
    bankLoans.getActiveLoan(ctx.guildId, ctx.discordUserId).catch(() => null),
    recurringDeposits.getRecurringDeposit(ctx.guildId, ctx.discordUserId).catch(() => null),
    appLinking.buildProfileSnapshot(ctx.profileId),
  ]);

  return {
    ok: true,
    body: {
      ...snapshot,
      loan: publicLoan(loan),
      recurringDeposit: publicRecurring(recurringDeposit),
      profile,
    },
  };
}

function displayAmount(tx) {
  const meta = tx.meta || {};
  if (tx.type === "bank_deposit" || tx.type === "bank_withdraw") return Number(meta.amount || 0);
  if (tx.type === "bank_transfer_out") return Math.abs(Number(meta.amount || tx.amount || 0));
  if (tx.type === "bank_transfer_in") return Number(meta.creditedAmount || meta.amount || tx.amount || 0);
  return Math.abs(Number(tx.amount || 0));
}

async function transactions(ctx, limit = 10) {
  await ensureSchema();
  const valid = assertContext(ctx);
  if (!valid.ok) return valid;

  const db = requirePool();
  const res = await db.query(
    `SELECT id, type, amount, meta, created_at
     FROM transactions
     WHERE guild_id=$1 AND user_id=$2
     ORDER BY created_at DESC
     LIMIT $3`,
    [ctx.guildId, ctx.discordUserId, Math.max(1, Math.min(25, Number(limit) || 10))]
  );

  return {
    ok: true,
    body: {
      transactions: (res.rows || []).map((tx) => ({
        id: String(tx.id),
        type: tx.type,
        amount: Number(tx.amount || 0),
        displayAmount: displayAmount(tx),
        createdAt: tx.created_at ? new Date(tx.created_at).toISOString() : null,
        meta: tx.meta || {},
      })),
    },
  };
}

function parseActionAmount(raw, max) {
  const text = String(raw ?? "").trim().toLowerCase();
  if (text === "all" || text === "max") return Math.max(0, Number(max || 0));
  const amount = Math.floor(Number(text.replace(/[$,\s]/g, "")));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount;
}

async function deposit(ctx, amountInput) {
  await ensureSchema();
  const valid = assertContext(ctx);
  if (!valid.ok) return valid;
  if (await isJailed(ctx)) return { ok: false, statusCode: 403, message: "You cannot deposit while jailed." };

  const before = await rawBankSnapshot(ctx);
  const amount = parseActionAmount(amountInput, before.walletBalance);
  if (!amount || amount > before.walletBalance) {
    return { ok: false, statusCode: 400, message: `You can only deposit up to ${before.walletBalance} from your wallet.` };
  }

  const moved = await economy.depositToBank(ctx.guildId, ctx.discordUserId, amount, { via: "mobile_bank" });
  if (!moved.ok) return { ok: false, statusCode: 400, message: "Deposit failed." };

  const profile = await appLinking.buildProfileSnapshot(ctx.profileId);
  const accountNumber = profile?.accountNumber || profile?.account_number || moved.accountNumber || null;
  return {
    ok: true,
    body: {
      status: "deposited",
      amount,
      walletBalance: Number(moved.wallet || 0),
      bankBalance: Number(moved.bank || 0),
      accountNumber,
      account_number: accountNumber,
      profile,
    },
  };
}

async function withdraw(ctx, amountInput) {
  await ensureSchema();
  const valid = assertContext(ctx);
  if (!valid.ok) return valid;
  if (await isJailed(ctx)) return { ok: false, statusCode: 403, message: "You cannot withdraw while jailed." };

  const before = await rawBankSnapshot(ctx);
  const amount = parseActionAmount(amountInput, before.bankBalance);
  if (!amount || amount > before.bankBalance) {
    return { ok: false, statusCode: 400, message: `You can only withdraw up to ${before.bankBalance} from your bank.` };
  }

  const moved = await economy.withdrawFromBank(ctx.guildId, ctx.discordUserId, amount, { via: "mobile_bank" });
  if (!moved.ok) {
    const message = moved.reason === "loan_defaulted"
      ? "Withdrawals are blocked while your account is in default recovery."
      : "Withdrawal failed.";
    return { ok: false, statusCode: 400, message };
  }

  const profile = await appLinking.buildProfileSnapshot(ctx.profileId);
  const accountNumber = profile?.accountNumber || profile?.account_number || moved.accountNumber || null;
  return {
    ok: true,
    body: {
      status: "withdrawn",
      amount,
      walletBalance: Number(moved.wallet || 0),
      bankBalance: Number(moved.bank || 0),
      accountNumber,
      account_number: accountNumber,
      profile,
    },
  };
}

async function transfer(ctx, { accountNumber, amount }) {
  await ensureSchema();
  const valid = assertContext(ctx);
  if (!valid.ok) return valid;
  if (await isJailed(ctx)) return { ok: false, statusCode: 403, message: "You cannot transfer while jailed." };

  const cleanAccount = String(accountNumber || "").replace(/\D/g, "");
  const transferAmount = parseActionAmount(amount, Infinity);
  if (!cleanAccount || cleanAccount.length < 6) return { ok: false, statusCode: 400, message: "Enter a valid account number." };
  if (!transferAmount) return { ok: false, statusCode: 400, message: "Enter a valid transfer amount." };

  const result = await economy.transferBankByAccount(ctx.guildId, ctx.discordUserId, cleanAccount, transferAmount, { via: "mobile_bank" });
  if (!result.ok) {
    const messages = {
      account_not_found: "That account number could not be found.",
      same_account: "You cannot transfer to your own account.",
      insufficient_funds: "You do not have enough in your bank balance for that transfer.",
      source_missing: "Your bank profile could not be loaded.",
      loan_defaulted: "Transfers are blocked while your account is in default recovery.",
    };
    return { ok: false, statusCode: 400, message: messages[result.reason] || "Transfer failed." };
  }

  const profile = await appLinking.buildProfileSnapshot(ctx.profileId);
  const account = profile?.accountNumber || profile?.account_number || null;
  return {
    ok: true,
    body: {
      status: "transferred",
      amount: transferAmount,
      toAccountNumber: cleanAccount,
      senderBankBalance: Number(result.senderBank || 0),
      recoveredAmount: Number(result.recoveredAmount || 0),
      accountNumber: account,
      account_number: account,
      profile,
    },
  };
}

module.exports = {
  ensureSchema,
  dashboard,
  transactions,
  deposit,
  withdraw,
  transfer,
};
