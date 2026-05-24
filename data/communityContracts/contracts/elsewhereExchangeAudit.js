const M = 60 * 1000;
const H = 60 * M;

module.exports = {
  key: "elsewhere_exchange_audit",
  name: "Elsewhere Exchange Audit",
  category: "Civic Systems",
  size: "medium",
  visualType: "route",
  description: "The exchange needs trade logs checked, terminals patched, ledgers reconciled, and public confidence restored.",
  flavour: "The market bell works. The spreadsheet does not. This is apparently worse.",
  recommendedPlayers: "3-5",
  totalRequiredProgress: 3600,
  payoutPool: 680000,
  standingReward: 45,
  bondRewardBase: 45,
  resultText: "The Elsewhere Exchange is reconciled, audited, and only making regular financial noises again.",
  phases: [
    { key: "logs", name: "Pull Trade Logs", description: "Gather the recent ledgers and find the missing entries.", requiredProgress: 650 },
    { key: "terminals", name: "Patch Trading Terminals", description: "Get the public terminals clean and responsive.", requiredProgress: 800 },
    { key: "reconcile", name: "Reconcile Ledgers", description: "Balance the books before someone says liquidity again.", requiredProgress: 900 },
    { key: "notice", name: "Publish Public Notice", description: "Prepare the update and reopen normal trading.", requiredProgress: 550 },
    { key: "review", name: "Final Audit Review", description: "Complete the last checks and sign it off.", requiredProgress: 700 },
  ],
  tasks: [
    { key: "pull_logs", label: "Pull trade logs", description: "Export rows until the machine gets warm.", type: "quick", durationMs: 20 * M, minProgress: 45, maxProgress: 80, allowedPhaseKeys: ["logs", "reconcile"] },
    { key: "patch_terminal", label: "Patch a terminal", description: "Updates, restarts, and ritual clicking.", type: "standard", durationMs: 60 * M, minProgress: 95, maxProgress: 160, allowedPhaseKeys: ["terminals"] },
    { key: "reconcile_batch", label: "Reconcile ledger batch", description: "A careful accounting pass through bad numbers.", type: "long", durationMs: 4 * H, minProgress: 210, maxProgress: 340, assistable: true, maxHelpers: 3, helperBaseContribution: 90, allowedPhaseKeys: ["reconcile"] },
    { key: "security_review", label: "Run security review", description: "Trace suspicious trades and lock down the boring parts.", type: "major", durationMs: 9 * H, minProgress: 360, maxProgress: 540, assistable: true, maxHelpers: 4, helperBaseContribution: 135, allowedPhaseKeys: ["terminals", "review"] },
    { key: "draft_notice", label: "Draft market notice", description: "Write something calm enough for investors.", type: "support", durationMs: 90 * M, minProgress: 110, maxProgress: 190, allowedPhaseKeys: ["notice"] },
    { key: "audit_signoff", label: "Complete audit sign-off", description: "Make the final report official.", type: "specialist", durationMs: 3 * H, minProgress: 190, maxProgress: 300, assistable: true, maxHelpers: 2, helperBaseContribution: 80, allowedPhaseKeys: ["review"] },
  ],
};
