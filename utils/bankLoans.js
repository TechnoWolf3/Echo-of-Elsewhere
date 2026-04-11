const { pool } = require('./db');
const OFFERS = require('../data/bank/loanOffers');

const STATUS = {
  ACTIVE: 'active',
  OVERDUE: 'overdue',
  DEFAULTED: 'defaulted',
  PAID: 'paid',
};

const GARNISH_PCT = {
  [STATUS.OVERDUE]: 0.50,
  [STATUS.DEFAULTED]: 0.90,
};

function nowIso() {
  return new Date().toISOString();
}

function addDays(base, days) {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d;
}

function money(n) {
  return `$${Number(n || 0).toLocaleString('en-AU')}`;
}

function shouldBypassRecovery(type, meta = {}) {
  if (meta?.bypassLoanRecovery) return true;
  return String(type || '').startsWith('loan_');
}

async function getRawActiveLoan(guildId, userId, client = pool) {
  const res = await client.query(
    `SELECT *
       FROM bank_loans
      WHERE guild_id=$1 AND user_id=$2 AND status IN ('active','overdue','defaulted')
      ORDER BY issued_at DESC
      LIMIT 1`,
    [guildId, userId]
  );
  return res.rows?.[0] || null;
}

async function refreshLoanStatus(guildId, userId, client = pool) {
  const loan = await getRawActiveLoan(guildId, userId, client);
  if (!loan) return null;

  let nextStatus = loan.status;
  const now = new Date();
  if (Number(loan.remaining_due || 0) <= 0) {
    nextStatus = STATUS.PAID;
  } else if (loan.default_at && now >= new Date(loan.default_at)) {
    nextStatus = STATUS.DEFAULTED;
  } else if (loan.due_at && now >= new Date(loan.due_at)) {
    nextStatus = STATUS.OVERDUE;
  } else {
    nextStatus = STATUS.ACTIVE;
  }

  if (nextStatus !== loan.status) {
    const updated = await client.query(
      `UPDATE bank_loans
          SET status=$4,
              updated_at=NOW(),
              paid_at=CASE WHEN $4='paid' THEN COALESCE(paid_at, NOW()) ELSE paid_at END
        WHERE guild_id=$1 AND user_id=$2 AND id=$3
        RETURNING *`,
      [guildId, userId, loan.id, nextStatus]
    );
    return updated.rows?.[0] || { ...loan, status: nextStatus };
  }

  return loan;
}

async function getActiveLoan(guildId, userId, opts = {}) {
  const loan = await refreshLoanStatus(guildId, userId, opts.client || pool);
  return loan && loan.status !== STATUS.PAID ? loan : null;
}

async function getLoanHistory(guildId, userId, limit = 5) {
  const res = await pool.query(
    `SELECT *
       FROM bank_loans
      WHERE guild_id=$1 AND user_id=$2
      ORDER BY issued_at DESC
      LIMIT $3`,
    [guildId, userId, Math.max(1, Math.min(10, Number(limit) || 5))]
  );
  return res.rows || [];
}

async function getLoanOffersForUser(guildId, userId, snapshot) {
  const active = await getActiveLoan(guildId, userId);
  return OFFERS.map((offer) => {
    const totalDue = Number(offer.principal) + Number(offer.fee);
    let unavailableReason = null;
    if (active) unavailableReason = 'You already have an active Reserve obligation.';
    else if (Number(snapshot.total || 0) < Number(offer.minTotalWealth || 0)) {
      unavailableReason = `Requires total wealth of ${money(offer.minTotalWealth)}.`;
    }
    return {
      ...offer,
      totalDue,
      unavailableReason,
      available: !unavailableReason,
    };
  });
}

async function acceptLoanOffer(guildId, userId, offerId) {
  const offer = OFFERS.find((x) => x.id === offerId);
  if (!offer) return { ok: false, reason: 'offer_not_found' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await refreshLoanStatus(guildId, userId, client);
    if (existing && existing.status !== STATUS.PAID) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'active_loan_exists' };
    }

    const snapRes = await client.query(
      `SELECT balance, bank_balance, account_number
         FROM user_balances
        WHERE guild_id=$1 AND user_id=$2
        FOR UPDATE`,
      [guildId, userId]
    );
    const snap = snapRes.rows?.[0] || { balance: 0, bank_balance: 0 };
    const total = Number(snap.balance || 0) + Number(snap.bank_balance || 0);
    if (total < Number(offer.minTotalWealth || 0)) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'offer_locked' };
    }

    const issuedAt = new Date();
    const dueAt = addDays(issuedAt, offer.days);
    const defaultAt = addDays(dueAt, offer.graceDays);
    const totalDue = Number(offer.principal) + Number(offer.fee);

    const loanRes = await client.query(
      `INSERT INTO bank_loans (
         guild_id, user_id, offer_id, offer_name, principal, fee, total_due, remaining_due,
         status, due_at, default_at, metadata
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$7,'active',$8,$9,$10)
       RETURNING *`,
      [
        guildId,
        userId,
        offer.id,
        offer.name,
        offer.principal,
        offer.fee,
        totalDue,
        dueAt.toISOString(),
        defaultAt.toISOString(),
        JSON.stringify({
          days: offer.days,
          graceDays: offer.graceDays,
          minTotalWealth: offer.minTotalWealth,
          description: offer.description,
        }),
      ]
    );

    const credit = await client.query(
      `UPDATE user_balances
          SET bank_balance = bank_balance + $3
        WHERE guild_id=$1 AND user_id=$2
        RETURNING balance, bank_balance, account_number`,
      [guildId, userId, offer.principal]
    );

    await client.query(
      `INSERT INTO transactions (guild_id, user_id, amount, type, meta)
       VALUES ($1, $2, $3, 'loan_disbursed', $4)`,
      [guildId, userId, offer.principal, {
        balance_type: 'bank',
        offerId: offer.id,
        offerName: offer.name,
        totalDue,
        dueAt: dueAt.toISOString(),
        defaultAt: defaultAt.toISOString(),
      }]
    );

    await client.query('COMMIT');
    const row = credit.rows?.[0] || {};
    return {
      ok: true,
      loan: loanRes.rows?.[0] || null,
      snapshot: {
        wallet: Number(row.balance || 0),
        bank: Number(row.bank_balance || 0),
        total: Number(row.balance || 0) + Number(row.bank_balance || 0),
        accountNumber: String(row.account_number || ''),
      },
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function applyPaymentToLoan(client, loan, amount, meta = {}) {
  const applied = Math.min(Number(amount || 0), Number(loan.remaining_due || 0));
  if (applied <= 0) return { applied: 0, loan };
  const remainingDue = Number(loan.remaining_due) - applied;
  const status = remainingDue <= 0 ? STATUS.PAID : loan.status;

  const updated = await client.query(
    `UPDATE bank_loans
        SET remaining_due = remaining_due - $4,
            payments_made = payments_made + $4,
            recovered_amount = recovered_amount + $4,
            status = CASE WHEN remaining_due - $4 <= 0 THEN 'paid' ELSE status END,
            last_payment_at = NOW(),
            paid_at = CASE WHEN remaining_due - $4 <= 0 THEN NOW() ELSE paid_at END,
            updated_at = NOW()
      WHERE guild_id=$1 AND user_id=$2 AND id=$3
      RETURNING *`,
    [loan.guild_id, loan.user_id, loan.id, applied]
  );

  const newLoan = updated.rows?.[0] || { ...loan, remaining_due: remainingDue, status };
  await client.query(
    `INSERT INTO transactions (guild_id, user_id, amount, type, meta)
     VALUES ($1, $2, 0, 'loan_payment_recorded', $3)`,
    [loan.guild_id, loan.user_id, {
      applied,
      remainingDue: Number(newLoan.remaining_due || 0),
      loanId: loan.id,
      ...meta,
    }]
  );

  return { applied, loan: newLoan };
}

async function repayLoan(guildId, userId, requestedAmount) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let loan = await refreshLoanStatus(guildId, userId, client);
    if (!loan || loan.status === STATUS.PAID) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'no_active_loan' };
    }

    const balRes = await client.query(
      `SELECT balance, bank_balance, account_number
         FROM user_balances
        WHERE guild_id=$1 AND user_id=$2
        FOR UPDATE`,
      [guildId, userId]
    );
    const row = balRes.rows?.[0] || { balance: 0, bank_balance: 0 };
    const available = Number(row.bank_balance || 0) + Number(row.balance || 0);
    const want = Math.max(1, Math.floor(Number(requestedAmount || 0)));
    const amount = Math.min(want, available, Number(loan.remaining_due || 0));
    if (!amount || amount <= 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'insufficient_funds' };
    }

    let remaining = amount;
    const takeBank = Math.min(remaining, Number(row.bank_balance || 0));
    if (takeBank > 0) {
      await client.query(
        `UPDATE user_balances SET bank_balance = bank_balance - $3 WHERE guild_id=$1 AND user_id=$2`,
        [guildId, userId, takeBank]
      );
      await client.query(
        `INSERT INTO transactions (guild_id, user_id, amount, type, meta)
         VALUES ($1, $2, $3, 'loan_manual_payment_bank', $4)`,
        [guildId, userId, -takeBank, { balance_type: 'bank', loanId: loan.id }]
      );
      remaining -= takeBank;
    }

    const takeWallet = Math.min(remaining, Number(row.balance || 0));
    if (takeWallet > 0) {
      await client.query(
        `UPDATE user_balances SET balance = balance - $3 WHERE guild_id=$1 AND user_id=$2`,
        [guildId, userId, takeWallet]
      );
      await client.query(
        `INSERT INTO transactions (guild_id, user_id, amount, type, meta)
         VALUES ($1, $2, $3, 'loan_manual_payment_wallet', $4)`,
        [guildId, userId, -takeWallet, { balance_type: 'wallet', loanId: loan.id }]
      );
    }

    const payment = await applyPaymentToLoan(client, loan, amount, { source: 'manual' });
    loan = payment.loan;

    const snapRes = await client.query(
      `SELECT balance, bank_balance, account_number FROM user_balances WHERE guild_id=$1 AND user_id=$2`,
      [guildId, userId]
    );
    const snap = snapRes.rows?.[0] || {};
    await client.query('COMMIT');
    return {
      ok: true,
      paid: amount,
      loan,
      snapshot: {
        wallet: Number(snap.balance || 0),
        bank: Number(snap.bank_balance || 0),
        total: Number(snap.balance || 0) + Number(snap.bank_balance || 0),
        accountNumber: String(snap.account_number || ''),
      },
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function sweepRecoverableBalances(guildId, userId, client = pool) {
  let loan = await refreshLoanStatus(guildId, userId, client);
  if (!loan || ![STATUS.OVERDUE, STATUS.DEFAULTED].includes(loan.status)) {
    return { recovered: 0, loan };
  }

  const balRes = await client.query(
    `SELECT balance, bank_balance FROM user_balances WHERE guild_id=$1 AND user_id=$2 FOR UPDATE`,
    [guildId, userId]
  );
  const row = balRes.rows?.[0] || { balance: 0, bank_balance: 0 };
  let recovered = 0;

  const takeBank = Math.min(Number(row.bank_balance || 0), Number(loan.remaining_due || 0));
  if (takeBank > 0) {
    await client.query(
      `UPDATE user_balances SET bank_balance = bank_balance - $3 WHERE guild_id=$1 AND user_id=$2`,
      [guildId, userId, takeBank]
    );
    await client.query(
      `INSERT INTO transactions (guild_id, user_id, amount, type, meta)
       VALUES ($1, $2, $3, 'loan_recovery_bank_sweep', $4)`,
      [guildId, userId, -takeBank, { balance_type: 'bank', loanId: loan.id, status: loan.status }]
    );
    const payment = await applyPaymentToLoan(client, loan, takeBank, { source: 'bank_sweep', status: loan.status });
    loan = payment.loan;
    recovered += takeBank;
  }

  if (Number(loan.remaining_due || 0) > 0) {
    const takeWallet = Math.min(Number(row.balance || 0), Number(loan.remaining_due || 0));
    if (takeWallet > 0) {
      await client.query(
        `UPDATE user_balances SET balance = balance - $3 WHERE guild_id=$1 AND user_id=$2`,
        [guildId, userId, takeWallet]
      );
      await client.query(
        `INSERT INTO transactions (guild_id, user_id, amount, type, meta)
         VALUES ($1, $2, $3, 'loan_recovery_wallet_sweep', $4)`,
        [guildId, userId, -takeWallet, { balance_type: 'wallet', loanId: loan.id, status: loan.status }]
      );
      const payment = await applyPaymentToLoan(client, loan, takeWallet, { source: 'wallet_sweep', status: loan.status });
      loan = payment.loan;
      recovered += takeWallet;
    }
  }

  return { recovered, loan };
}

async function applyRecoveryToIncoming({ client = pool, guildId, userId, amount, balanceType, type, meta = {} }) {
  if (!amount || amount <= 0 || shouldBypassRecovery(type, meta)) {
    return { creditedAmount: amount, recoveredAmount: 0, status: null, loan: null };
  }

  let loan = await refreshLoanStatus(guildId, userId, client);
  if (!loan) return { creditedAmount: amount, recoveredAmount: 0, status: null, loan: null };

  if ([STATUS.OVERDUE, STATUS.DEFAULTED].includes(loan.status)) {
    const sweep = await sweepRecoverableBalances(guildId, userId, client);
    loan = sweep.loan || loan;
  }

  if ([STATUS.OVERDUE, STATUS.DEFAULTED].includes(loan.status)) {
    const pct = GARNISH_PCT[loan.status] || 0;
    let recoveredAmount = Math.floor(Number(amount) * pct);
    if (recoveredAmount <= 0 && Number(amount) > 0) recoveredAmount = 1;
    recoveredAmount = Math.min(recoveredAmount, Number(amount), Number(loan.remaining_due || 0));
    if (recoveredAmount > 0) {
      const payment = await applyPaymentToLoan(client, loan, recoveredAmount, {
        source: 'incoming_garnish',
        status: loan.status,
        creditedBalanceType: balanceType,
        sourceType: type,
      });
      loan = payment.loan;
      return {
        creditedAmount: Number(amount) - recoveredAmount,
        recoveredAmount,
        status: loan.status,
        loan,
      };
    }
  }

  return { creditedAmount: amount, recoveredAmount: 0, status: loan.status, loan };
}

async function canTransferOut(guildId, userId) {
  const loan = await getActiveLoan(guildId, userId);
  if (!loan) return { ok: true, loan: null };
  if (loan.status === STATUS.DEFAULTED) {
    return { ok: false, reason: 'loan_defaulted', loan };
  }
  return { ok: true, loan };
}

function formatLoanStatus(status) {
  if (status === STATUS.ACTIVE) return 'Active';
  if (status === STATUS.OVERDUE) return 'Overdue';
  if (status === STATUS.DEFAULTED) return 'Defaulted';
  if (status === STATUS.PAID) return 'Paid';
  return 'Unknown';
}

module.exports = {
  STATUS,
  GARNISH_PCT,
  money,
  getActiveLoan,
  getLoanHistory,
  getLoanOffersForUser,
  acceptLoanOffer,
  repayLoan,
  refreshLoanStatus,
  sweepRecoverableBalances,
  applyRecoveryToIncoming,
  canTransferOut,
  formatLoanStatus,
};
