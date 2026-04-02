function getAvailableMachines(playerMachines, type) {
  const machines = Object.values(playerMachines).filter(m => m.type === type);

  let total = 0;
  let busy = 0;

  for (const m of machines) {
    total += m.owned || 0;
    busy += m.busy || 0;
  }

  return total - busy;
}

module.exports = {
  getAvailableMachines
};