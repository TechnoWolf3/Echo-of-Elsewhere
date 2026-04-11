const CRIME_GLOBAL_KEY = "crime_global";

const CRIME_KEYS = {
  store: "crime_store",
  chase: "crime_chase",
  drugs: "crime_drugs",
  heist: "crime_heist",
  major: "crime_heist_major",
  scam: "crime_scam",
};

function heatTTLMinutesForHeistOutcome(outcome, { mode = "heist" } = {}) {
  const heist = {
    clean: 30,
    spotted: 60,
    partial: 180,
    busted: 720,
    busted_hard: 720,
  };

  const major = {
    clean: 60,
    spotted: 120,
    partial: 240,
    busted: 720,
    busted_hard: 1440,
  };

  const map = mode === "major" ? major : heist;
  return map[outcome] ?? map.spotted;
}

module.exports = {
  CRIME_GLOBAL_KEY,
  CRIME_KEYS,
  heatTTLMinutesForHeistOutcome,
};
