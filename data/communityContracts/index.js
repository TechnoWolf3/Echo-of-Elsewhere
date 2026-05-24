const contracts = [
  require("./contracts/banksiaBaySurfClub"),
  require("./contracts/wattlefordRuralClinic"),
  require("./contracts/ironbarkBushfireRecovery"),
  require("./contracts/regionalMedicalDrive"),
  require("./contracts/bluegumHillReplanting"),
  require("./contracts/murraysBendFreightYard"),
  require("./contracts/elsewhereExchangeAudit"),
  require("./contracts/harrowfieldHarvestCoop"),
];

const byKey = new Map(contracts.map((contract) => [contract.key, contract]));

function getContract(key) {
  return byKey.get(String(key || "")) || null;
}

function listContracts() {
  return contracts.slice();
}

function pickContract({ excludeKeys = [], size = null, category = null } = {}) {
  const excluded = new Set((excludeKeys || []).map(String));
  const filtered = contracts.filter((contract) => {
    if (excluded.has(contract.key)) return false;
    if (size && contract.size !== size) return false;
    if (category && contract.category !== category) return false;
    return true;
  });
  const pool = filtered.length ? filtered : contracts;
  return pool[Math.floor(Math.random() * pool.length)] || contracts[0] || null;
}

module.exports = {
  contracts,
  getContract,
  listContracts,
  pickContract,
  config: require("./config"),
  visuals: require("./visuals"),
  places: require("./places"),
};
