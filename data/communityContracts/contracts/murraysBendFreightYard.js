const M = 60 * 1000;
const H = 60 * M;

module.exports = {
  key: "murrays_bend_freight_yard",
  name: "Murray's Bend Freight Yard",
  category: "Trade & Transport",
  size: "large",
  visualType: "facility",
  description: "A half-working freight yard needs sorting lanes, loading gear, fuel stock, and enough paperwork to move goods again.",
  flavour: "Every crate is labelled urgently, which is a brave choice for crates that have not moved since last Tuesday.",
  recommendedPlayers: "3-6",
  totalRequiredProgress: 5600,
  payoutPool: 1150000,
  standingReward: 70,
  bondRewardBase: 55,
  resultText: "Murray's Bend Freight Yard is moving goods again, with the loading lanes clear and the clipboards only mildly hostile.",
  phases: [
    { key: "sort", name: "Sort Stranded Freight", description: "Identify what is late, broken, lost, or pretending to be all three.", requiredProgress: 900 },
    { key: "lanes", name: "Clear Loading Lanes", description: "Open the lanes and mark safe forklift paths.", requiredProgress: 1100 },
    { key: "fuel", name: "Restock Fuel and Parts", description: "Get trucks, loaders, and generators supplied.", requiredProgress: 1150 },
    { key: "dispatch", name: "Rebuild Dispatch Desk", description: "Fix manifests, radios, and routing boards.", requiredProgress: 1200 },
    { key: "haul", name: "Run Final Haul", description: "Move the first clean convoy through the yard.", requiredProgress: 1250 },
  ],
  tasks: [
    { key: "count_crates", label: "Count stranded crates", description: "Make the manifest less fictional.", type: "quick", durationMs: 20 * M, minProgress: 45, maxProgress: 85, allowedPhaseKeys: ["sort"] },
    { key: "clear_lanes", label: "Clear loading lanes", description: "Move pallets, cones, and one suspicious tarp.", type: "standard", durationMs: 75 * M, minProgress: 115, maxProgress: 190, allowedPhaseKeys: ["sort", "lanes"] },
    { key: "repair_loader", label: "Repair loading gear", description: "A longer mechanical push to get the heavy gear moving.", type: "long", durationMs: 5 * H, minProgress: 260, maxProgress: 420, assistable: true, maxHelpers: 4, helperBaseContribution: 110, allowedPhaseKeys: ["lanes", "fuel"] },
    { key: "fuel_run", label: "Run fuel convoy", description: "Bring in fuel and parts without turning the yard into a queue.", type: "major", durationMs: 14 * H, minProgress: 520, maxProgress: 760, assistable: true, maxHelpers: 5, helperBaseContribution: 170, allowedPhaseKeys: ["fuel"] },
    { key: "dispatch_boards", label: "Rebuild dispatch boards", description: "Routes, names, bay numbers, and other lies made useful.", type: "support", durationMs: 2 * H, minProgress: 150, maxProgress: 240, allowedPhaseKeys: ["dispatch"] },
    { key: "final_haul", label: "Run final haul", description: "Prove the yard works by actually moving freight out of it.", type: "major", durationMs: 10 * H, minProgress: 420, maxProgress: 620, assistable: true, maxHelpers: 4, helperBaseContribution: 145, allowedPhaseKeys: ["haul"] },
  ],
};
