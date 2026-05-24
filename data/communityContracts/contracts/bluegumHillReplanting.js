const M = 60 * 1000;
const H = 60 * M;

module.exports = {
  key: "bluegum_hill_replanting_effort",
  name: "Bluegum Hill Replanting Effort",
  category: "Land & Wildlife",
  size: "medium",
  visualType: "zones",
  description: "Restore damaged bushland with seed collection, saplings, mulch, fencing, and ranger sign-off.",
  flavour: "The council has supplied gloves, a ute, and exactly three useful shovels.",
  recommendedPlayers: "3-5",
  totalRequiredProgress: 3000,
  payoutPool: 600000,
  standingReward: 38,
  bondRewardBase: 45,
  resultText: "Bluegum Hill has new saplings, safer creek banks, repaired habitat fencing, and a ranger who almost smiled.",
  phases: [
    { key: "soil", name: "Prepare Soil", description: "Clear weeds and loosen compacted ground.", requiredProgress: 520 },
    { key: "plant", name: "Plant Saplings", description: "Plant native saplings across the hill.", requiredProgress: 800 },
    { key: "water", name: "Water and Mulch", description: "Set up watering, mulch, and shade covers.", requiredProgress: 680 },
    { key: "habitat", name: "Wildlife Habitat Check", description: "Repair fencing and creek-bank shelter.", requiredProgress: 600 },
    { key: "review", name: "Final Ranger Review", description: "Complete the final land care inspection.", requiredProgress: 400 },
  ],
  tasks: [
    { key: "collect_seed", label: "Collect native seed", description: "Gather seed without starting a botany argument.", type: "quick", durationMs: 20 * M, minProgress: 45, maxProgress: 75, allowedPhaseKeys: ["soil", "plant"] },
    { key: "plant_saplings", label: "Plant saplings", description: "Rows, water crystals, guards, repeat.", type: "standard", durationMs: 75 * M, minProgress: 110, maxProgress: 180, allowedPhaseKeys: ["plant"] },
    { key: "mulch_zone", label: "Water and mulch a zone", description: "A longer push to keep saplings alive.", type: "long", durationMs: 4 * H, minProgress: 210, maxProgress: 340, assistable: true, maxHelpers: 3, helperBaseContribution: 90, allowedPhaseKeys: ["water"] },
    { key: "habitat_fencing", label: "Repair habitat fencing", description: "Posts, wire, warning signs, and patience.", type: "major", durationMs: 9 * H, minProgress: 340, maxProgress: 500, assistable: true, maxHelpers: 4, helperBaseContribution: 135, allowedPhaseKeys: ["habitat"] },
    { key: "check_banks", label: "Check creek banks", description: "Mark erosion and patch small washouts.", type: "support", durationMs: 90 * M, minProgress: 120, maxProgress: 190, allowedPhaseKeys: ["habitat", "review"] },
    { key: "ranger_review", label: "Complete ranger review", description: "Walk the site with someone who owns too many high-vis vests.", type: "specialist", durationMs: 2 * H, minProgress: 150, maxProgress: 230, allowedPhaseKeys: ["review"] },
  ],
};
