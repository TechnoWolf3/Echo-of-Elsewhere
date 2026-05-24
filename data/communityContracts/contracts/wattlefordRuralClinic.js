const M = 60 * 1000;
const H = 60 * M;

module.exports = {
  key: "wattleford_rural_clinic_build",
  name: "Wattleford Rural Clinic Build",
  category: "Community Care",
  size: "large",
  visualType: "facility",
  description: "Wattleford needs a clinic that can handle checkups, heatstroke, and arguments about whose ute is blocking the bay.",
  flavour: "The old site has power, water, and a sign that says 'temporary' from nine years ago.",
  recommendedPlayers: "3-6",
  totalRequiredProgress: 5200,
  payoutPool: 1050000,
  standingReward: 75,
  bondRewardBase: 55,
  resultText: "Wattleford Rural Clinic is operational, stocked, and ready to stop treating splinters in the bakery storeroom.",
  phases: [
    { key: "site", name: "Clear the Site", description: "Prepare the block and mark the services.", requiredProgress: 800 },
    { key: "rooms", name: "Fit Treatment Rooms", description: "Fit rooms, privacy screens, and storage.", requiredProgress: 1300 },
    { key: "utilities", name: "Connect Water and Power", description: "Get services running without angering the switchboard.", requiredProgress: 1100 },
    { key: "stock", name: "Stock Medical Supplies", description: "Move medicine, kits, and intake gear into place.", requiredProgress: 1200 },
    { key: "inspect", name: "Final Health Inspection", description: "Make the paperwork look less cursed.", requiredProgress: 800 },
  ],
  tasks: [
    { key: "prepare_kits", label: "Prepare treatment kits", description: "Pack basics for the first week of chaos.", type: "quick", durationMs: 20 * M, minProgress: 45, maxProgress: 80, allowedPhaseKeys: ["stock"] },
    { key: "clear_site", label: "Clear clinic site", description: "Remove rubbish, weeds, and one mystery filing cabinet.", type: "standard", durationMs: 75 * M, minProgress: 110, maxProgress: 180, allowedPhaseKeys: ["site"] },
    { key: "fit_rooms", label: "Fit treatment rooms", description: "Install benches, screens, lights, and hope.", type: "long", durationMs: 5 * H, minProgress: 260, maxProgress: 420, assistable: true, maxHelpers: 4, helperBaseContribution: 110, allowedPhaseKeys: ["rooms"] },
    { key: "connect_services", label: "Connect water and power", description: "A major utility push with several forms nobody respects.", type: "major", durationMs: 18 * H, minProgress: 620, maxProgress: 850, assistable: true, maxHelpers: 5, helperBaseContribution: 190, allowedPhaseKeys: ["utilities"] },
    { key: "deliver_medicine", label: "Deliver medicine crates", description: "Run the cold boxes before the esky starts judging you.", type: "long", durationMs: 4 * H, minProgress: 230, maxProgress: 360, assistable: true, maxHelpers: 3, helperBaseContribution: 95, allowedPhaseKeys: ["stock"] },
    { key: "process_forms", label: "Process intake forms", description: "The real final boss, laminated and triplicate.", type: "specialist", durationMs: 90 * M, minProgress: 130, maxProgress: 220, allowedPhaseKeys: ["inspect"] },
  ],
};
