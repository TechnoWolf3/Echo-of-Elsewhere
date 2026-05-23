const M = 60 * 1000;
const H = 60 * M;

module.exports = {
  key: "restore_banksia_bay_surf_club",
  name: "Restore Banksia Bay Surf Club",
  category: "Local Works",
  size: "medium",
  visualType: "repair",
  description: "The surf club is half sand, half paperwork, and somehow still expected to host sausage sizzles.",
  flavour: "Banksia Bay Council has declared the building 'mostly vertical', which is not as reassuring as they think.",
  recommendedPlayers: "3-6",
  totalRequiredProgress: 2400,
  payoutPool: 90000,
  standingReward: 28,
  bondRewardBase: 40,
  resultText: "Banksia Bay Surf Club is open again, including the first aid room, the patrol tower, and the haunted laminator.",
  phases: [
    { key: "clear", name: "Clear Sand and Debris", description: "Get the entrances, storage room, and deck back from the beach.", requiredProgress: 450 },
    { key: "tower", name: "Repair Patrol Tower", description: "Replace supports, stairs, and the lookout platform.", requiredProgress: 700 },
    { key: "first_aid", name: "Restock First Aid Room", description: "Restock safety gear and make the room useful again.", requiredProgress: 550 },
    { key: "inspection", name: "Final Safety Check", description: "Clean up, inspect the tower, and reopen the club.", requiredProgress: 700 },
  ],
  tasks: [
    { key: "clear_boards", label: "Clear damaged boards", description: "Stack timber and remove anything that bites back.", type: "quick", durationMs: 15 * M, minProgress: 35, maxProgress: 65, allowedPhaseKeys: ["clear"] },
    { key: "sort_timber", label: "Sort salvageable timber", description: "Find the boards council can pretend were always fine.", type: "standard", durationMs: 45 * M, minProgress: 80, maxProgress: 130, allowedPhaseKeys: ["clear", "tower"] },
    { key: "repair_posts", label: "Repair support posts", description: "Jack up the tower and replace the worst supports.", type: "long", durationMs: 3 * H, minProgress: 180, maxProgress: 270, assistable: true, maxHelpers: 3, helperBaseContribution: 75, allowedPhaseKeys: ["tower"] },
    { key: "replace_roof", label: "Replace roof sheets", description: "A major job, mostly because the wind has opinions.", type: "major", durationMs: 10 * H, minProgress: 380, maxProgress: 520, assistable: true, maxHelpers: 5, helperBaseContribution: 140, allowedPhaseKeys: ["tower"] },
    { key: "stock_safety", label: "Restock safety gear", description: "Kits, towels, radios, sunscreen, and one clipboard too many.", type: "standard", durationMs: 60 * M, minProgress: 90, maxProgress: 150, allowedPhaseKeys: ["first_aid"] },
    { key: "final_inspection", label: "Complete final inspection", description: "Make it official enough for the committee fridge magnet.", type: "support", durationMs: 2 * H, minProgress: 150, maxProgress: 220, allowedPhaseKeys: ["inspection"] },
  ],
};
