const M = 60 * 1000;
const H = 60 * M;

module.exports = {
  key: "regional_medical_drive",
  name: "Regional Medical Drive",
  category: "Community Care",
  size: "medium",
  visualType: "route",
  description: "A travelling clinic route through Wallaby Creek, Ironbark Ridge, Wattleford, Banksia Bay, and Murray's Bend.",
  flavour: "The van is stocked, the clipboard is powerful, and the route map has been folded into a legal dispute.",
  recommendedPlayers: "3-6",
  totalRequiredProgress: 2800,
  payoutPool: 105000,
  standingReward: 35,
  bondRewardBase: 45,
  resultText: "The Regional Medical Drive finished its route with stocked kits, completed checkups, and only one parking argument.",
  phases: [
    { key: "wallaby_creek", name: "Wallaby Creek Stop", description: "Checkups and treatment kits at the hall.", requiredProgress: 520 },
    { key: "ironbark_ridge", name: "Ironbark Ridge Stop", description: "Follow-up care and water safety checks.", requiredProgress: 560 },
    { key: "wattleford", name: "Wattleford Stop", description: "Patient intake and clinic referrals.", requiredProgress: 560 },
    { key: "banksia_bay", name: "Banksia Bay Stop", description: "First aid restock and surf club outreach.", requiredProgress: 560 },
    { key: "murrays_bend", name: "Murray's Bend Stop", description: "Final checks and return inventory.", requiredProgress: 600 },
  ],
  tasks: [
    { key: "prepare_kits", label: "Prepare treatment kits", description: "Pack the van before someone adds twelve extra clipboards.", type: "quick", durationMs: 15 * M, minProgress: 40, maxProgress: 70, allowedPhaseKeys: ["wallaby_creek", "ironbark_ridge", "wattleford", "banksia_bay", "murrays_bend"] },
    { key: "run_checkups", label: "Run patient checkups", description: "Steady care at the current stop.", type: "standard", durationMs: 60 * M, minProgress: 95, maxProgress: 155, allowedPhaseKeys: ["wallaby_creek", "ironbark_ridge", "wattleford", "banksia_bay", "murrays_bend"] },
    { key: "process_intake", label: "Process intake forms", description: "Wrangle names, numbers, and handwriting that has seen things.", type: "support", durationMs: 45 * M, minProgress: 70, maxProgress: 120, allowedPhaseKeys: ["wattleford", "murrays_bend"] },
    { key: "deliver_meds", label: "Deliver medicine crates", description: "A longer medicine run with careful handling.", type: "long", durationMs: 3 * H, minProgress: 180, maxProgress: 300, assistable: true, maxHelpers: 3, helperBaseContribution: 85, allowedPhaseKeys: ["ironbark_ridge", "banksia_bay"] },
    { key: "mobile_clinic_day", label: "Run mobile clinic day", description: "Major outreach shift across the stop.", type: "major", durationMs: 8 * H, minProgress: 330, maxProgress: 480, assistable: true, maxHelpers: 4, helperBaseContribution: 130, allowedPhaseKeys: ["wattleford", "murrays_bend"] },
  ],
};
