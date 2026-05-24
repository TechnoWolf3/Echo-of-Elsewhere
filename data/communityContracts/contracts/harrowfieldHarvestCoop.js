const M = 60 * 1000;
const H = 60 * M;

module.exports = {
  key: "harrowfield_harvest_coop",
  name: "Harrowfield Harvest Co-op",
  category: "Food & Farming",
  size: "medium",
  visualType: "zones",
  description: "A regional food co-op needs fields harvested, cold storage cleaned, and produce packed before the week turns.",
  flavour: "The farmhands are optimistic, which means nobody has opened the cold room yet.",
  recommendedPlayers: "3-5",
  totalRequiredProgress: 3400,
  payoutPool: 620000,
  standingReward: 42,
  bondRewardBase: 45,
  resultText: "Harrowfield Harvest Co-op is stocked, packed, chilled, and ready to feed people instead of spreadsheets.",
  phases: [
    { key: "fields", name: "Bring In Fields", description: "Harvest the ready rows and sort the good produce.", requiredProgress: 750 },
    { key: "storage", name: "Clean Cold Storage", description: "Prepare crates, shelves, and cooling gear.", requiredProgress: 650 },
    { key: "packing", name: "Pack Produce Orders", description: "Build boxes for shops, shelters, and kitchens.", requiredProgress: 850 },
    { key: "routes", name: "Plan Delivery Routes", description: "Assign drivers and sensible drop order.", requiredProgress: 500 },
    { key: "market", name: "Open Co-op Market", description: "Finish the stall setup and handover.", requiredProgress: 650 },
  ],
  tasks: [
    { key: "pick_rows", label: "Pick ready rows", description: "Harvest quickly while everything still looks proud.", type: "quick", durationMs: 20 * M, minProgress: 45, maxProgress: 80, allowedPhaseKeys: ["fields"] },
    { key: "sort_crates", label: "Sort produce crates", description: "Good, better, soup, mystery.", type: "standard", durationMs: 60 * M, minProgress: 95, maxProgress: 160, allowedPhaseKeys: ["fields", "packing"] },
    { key: "clean_coldroom", label: "Clean cold storage", description: "A longer scrub of shelves, seals, and questionable corners.", type: "long", durationMs: 4 * H, minProgress: 210, maxProgress: 330, assistable: true, maxHelpers: 3, helperBaseContribution: 90, allowedPhaseKeys: ["storage"] },
    { key: "pack_orders", label: "Pack bulk orders", description: "Pack, weigh, label, stack, repeat until your hands know vegetables.", type: "major", durationMs: 8 * H, minProgress: 340, maxProgress: 500, assistable: true, maxHelpers: 4, helperBaseContribution: 130, allowedPhaseKeys: ["packing"] },
    { key: "map_routes", label: "Map delivery routes", description: "Make five towns feel like a plan.", type: "support", durationMs: 90 * M, minProgress: 115, maxProgress: 185, allowedPhaseKeys: ["routes"] },
    { key: "market_setup", label: "Set up co-op market", description: "Tables, signs, shade, scales, and one heroic extension cord.", type: "specialist", durationMs: 3 * H, minProgress: 180, maxProgress: 290, assistable: true, maxHelpers: 2, helperBaseContribution: 75, allowedPhaseKeys: ["market"] },
  ],
};
