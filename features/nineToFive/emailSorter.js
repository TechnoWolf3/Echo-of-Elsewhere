const emailSorterCfg = require('../../data/work/categories/nineToFive/emailSorter');

function randInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function weightedPick(weightMap = {}) {
  const entries = Object.entries(weightMap).filter(([, weight]) => Number(weight) > 0);
  const total = entries.reduce((sum, [, weight]) => sum + Number(weight), 0);
  if (!entries.length || total <= 0) return 'todo';

  let roll = Math.random() * total;
  for (const [key, weight] of entries) {
    roll -= Number(weight);
    if (roll <= 0) return key;
  }
  return entries[entries.length - 1][0];
}

function buildEmailFromFamily(category, family) {
  const from = pick(family.fromPool || []);
  const subject = pick(family.subjectPool || []);
  const paragraph1 = pick(family.paragraph1Pool || []);
  const paragraph2 = pick(family.paragraph2Pool || []);
  const signoff = pick(family.signoffPool || []);

  return {
    id: `${category}:${family.key}:${Date.now()}:${Math.floor(Math.random() * 1e6)}`,
    category,
    familyKey: family.key,
    from,
    subject,
    body: [paragraph1, '', paragraph2, '', signoff].join('\n').trim(),
  };
}

function buildEmail(category) {
  const families = emailSorterCfg.templates?.[category] || [];
  if (!families.length) {
    throw new Error(`No email sorter templates configured for category: ${category}`);
  }

  return buildEmailFromFamily(category, pick(families));
}

function generateRun() {
  const count = Math.max(1, Number(emailSorterCfg.emailsPerRun) || 1);
  const guaranteedScams = Math.max(0, Math.min(count, Number(emailSorterCfg.guaranteedScamEmailsPerRun) || 0));

  const emails = [];
  for (let i = 0; i < guaranteedScams; i += 1) {
    emails.push(buildEmail('scam'));
  }

  while (emails.length < count) {
    emails.push(buildEmail(weightedPick(emailSorterCfg.generation?.weights || {})));
  }

  return {
    currentIndex: 0,
    emails: shuffle(emails),
    results: [],
    failed: false,
    failedReason: null,
    totals: {
      correct: 0,
      penalties: 0,
      subtotal: 0,
      perfectBonus: 0,
      total: 0,
    },
  };
}

function normaliseFolder(value) {
  return String(value || '').trim().toLowerCase();
}

function isMissionFail(actualCategory, chosenFolder) {
  if (normaliseFolder(actualCategory) !== 'scam') return false;
  const failFolders = (emailSorterCfg.failureRules?.missionFailOnScamIn || []).map(normaliseFolder);
  return failFolders.includes(normaliseFolder(chosenFolder));
}

function scoreRun(run) {
  const payoutCfg = emailSorterCfg.payout || {};
  let subtotal = randInt(payoutCfg.runCompletion?.min ?? 0, payoutCfg.runCompletion?.max ?? 0);
  let penalties = 0;
  let correct = 0;
  let failed = false;
  let failedReason = null;

  for (const result of run.results) {
    if (isMissionFail(result.actual, result.chosen)) {
      failed = true;
      failedReason = 'A phishing email was escalated into a live work folder and the queue was compromised.';
      result.outcome = 'mission_fail';
      continue;
    }

    if (result.actual === result.chosen) {
      correct += 1;
      result.outcome = 'correct';
      subtotal += randInt(payoutCfg.correctEmail?.min ?? 0, payoutCfg.correctEmail?.max ?? 0);
      continue;
    }

    if (result.actual === 'scam' && result.chosen === 'spam') {
      const penalty = randInt(payoutCfg.scamInSpamPenalty?.min ?? 0, payoutCfg.scamInSpamPenalty?.max ?? 0);
      penalties += penalty;
      result.penalty = penalty;
      result.outcome = 'scam_to_spam';
      continue;
    }

    result.outcome = 'incorrect';
  }

  const perfectBonus = !failed && run.results.length > 0 && correct === run.results.length
    ? Math.round(subtotal * Number(payoutCfg.perfectBonusPct || 0))
    : 0;

  const total = failed ? 0 : Math.max(0, subtotal + perfectBonus - penalties);

  run.failed = failed;
  run.failedReason = failedReason;
  run.totals = { correct, penalties, subtotal, perfectBonus, total };
  return run.totals;
}

function folderMeta(folderId) {
  return emailSorterCfg.folders?.[folderId] || { label: folderId, emoji: '📁' };
}

module.exports = {
  emailSorterCfg,
  generateRun,
  scoreRun,
  folderMeta,
};
