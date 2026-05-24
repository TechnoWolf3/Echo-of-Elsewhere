const M = 60 * 1000;
const H = 60 * M;

module.exports = {
  key: "ironbark_ridge_bushfire_recovery",
  name: "Ironbark Ridge Bushfire Recovery",
  category: "Disaster Recovery",
  size: "emergency",
  visualType: "zones",
  description: "Ironbark Ridge needs firebreaks cleared, fences repaired, water delivered, and the wildlife shelter kept upright.",
  flavour: "The recovery map has three colours of marker, two missing pins, and one councillor saying 'resilience' too much.",
  recommendedPlayers: "3-6",
  totalRequiredProgress: 4200,
  payoutPool: 850000,
  standingReward: 65,
  bondRewardBase: 55,
  resultText: "Ironbark Ridge is stable again, with safer access tracks, working water tanks, and a wildlife shelter that no longer leaks sideways.",
  phases: [
    { key: "firebreaks", name: "Clear Firebreaks", description: "Reopen safe lines around the ridge.", requiredProgress: 850 },
    { key: "fencing", name: "Repair Fencing", description: "Fix boundaries and temporary stock runs.", requiredProgress: 900 },
    { key: "water", name: "Deliver Water", description: "Get tanks filled and pumps checked.", requiredProgress: 850 },
    { key: "wildlife", name: "Support Wildlife Shelter", description: "Repair shade, bedding, and feed storage.", requiredProgress: 900 },
    { key: "sweep", name: "Final Recovery Sweep", description: "Check hazards and reopen access.", requiredProgress: 700 },
  ],
  tasks: [
    { key: "clear_debris", label: "Clear burnt debris", description: "Slow, careful, smoky work.", type: "quick", durationMs: 15 * M, minProgress: 40, maxProgress: 75, allowedPhaseKeys: ["firebreaks", "sweep"] },
    { key: "reopen_track", label: "Reopen access track", description: "Move fallen timber and mark unsafe edges.", type: "long", durationMs: 4 * H, minProgress: 230, maxProgress: 360, assistable: true, maxHelpers: 4, helperBaseContribution: 100, allowedPhaseKeys: ["firebreaks", "sweep"] },
    { key: "repair_fencing", label: "Repair boundary fencing", description: "Posts, wire, gates, and regional optimism.", type: "standard", durationMs: 90 * M, minProgress: 120, maxProgress: 190, allowedPhaseKeys: ["fencing"] },
    { key: "deliver_tanks", label: "Deliver water tanks", description: "Major delivery run over rough roads.", type: "major", durationMs: 12 * H, minProgress: 480, maxProgress: 680, assistable: true, maxHelpers: 5, helperBaseContribution: 160, allowedPhaseKeys: ["water"] },
    { key: "support_carers", label: "Support wildlife carers", description: "Feed, bedding, shade cloth, and patient calm.", type: "support", durationMs: 2 * H, minProgress: 150, maxProgress: 240, allowedPhaseKeys: ["wildlife"] },
    { key: "inspect_structures", label: "Inspect damaged structures", description: "Find what is safe before someone leans on it.", type: "specialist", durationMs: 3 * H, minProgress: 190, maxProgress: 300, assistable: true, maxHelpers: 2, helperBaseContribution: 80, allowedPhaseKeys: ["sweep"] },
  ],
};
