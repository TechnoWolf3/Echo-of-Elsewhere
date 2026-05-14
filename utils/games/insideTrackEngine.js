// utils/games/insideTrackEngine.js
// Race generation and tick simulation for Inside Track.

const config = require("../../data/games/casino/insideTrackConfig");

const FINISH_DISTANCE = 1000;
const TRACK_WIDTH = 38;

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function int(min, max) {
  return Math.floor(rand(min, max + 1));
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, Number(n) || 0));
}

function choice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function sample(arr, count) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}

function weightedPick(weights) {
  const entries = Object.entries(weights || {}).filter(([, w]) => Number(w) > 0);
  const total = entries.reduce((sum, [, w]) => sum + Number(w), 0);
  let roll = Math.random() * total;
  for (const [key, weight] of entries) {
    roll -= Number(weight);
    if (roll <= 0) return key;
  }
  return entries[0]?.[0] || null;
}

function stat() {
  return rand(0.35, 1);
}

function makeStats(condition) {
  const prefs = ["clean", "soft", "heavy", "tactical", "night"];
  const trackPreference = choice(prefs);
  const conditionMatch = trackPreference === condition.preference ? rand(0.05, 0.14) : rand(-0.05, 0.04);
  return {
    speed: stat(),
    stamina: stat(),
    consistency: stat(),
    temperament: stat(),
    sprintChance: stat(),
    chokeChance: rand(0.02, 0.18),
    trackPreference,
    startingStrength: stat(),
    finishingStrength: stat(),
    conditionMatch,
  };
}

function scoreHorse(stats, condition, isMajor) {
  const raw =
    stats.speed * 0.24 +
    stats.stamina * 0.19 +
    stats.consistency * 0.17 +
    stats.temperament * 0.12 +
    stats.sprintChance * 0.08 +
    stats.startingStrength * 0.08 +
    stats.finishingStrength * 0.12 +
    stats.conditionMatch +
    Number(condition.speedBias || 0) +
    Number(condition.staminaBias || 0);
  return clamp(raw + rand(-0.08, 0.08) + (isMajor ? rand(-0.03, 0.05) : 0), 0.18, 1.25);
}

function oddsFromScores(horses, isMajor) {
  const total = horses.reduce((sum, h) => sum + h.rating, 0);
  const maxOdds = isMajor ? config.odds.majorMax : config.odds.max;
  return horses.map((h) => {
    const fair = total / Math.max(0.01, h.rating);
    const market = fair * config.odds.houseFactor * rand(0.92, 1.08);
    return {
      ...h,
      odds: Math.round(clamp(market, config.odds.min, maxOdds) * 10) / 10,
    };
  });
}

function makeForm(stats) {
  const lines = [];
  if (stats.finishingStrength > 0.68) lines.push(choice(config.formLines.closer));
  if (stats.startingStrength > 0.68) lines.push(choice(config.formLines.starter));
  if (stats.temperament > 0.66) lines.push(choice(config.formLines.calm));
  if (stats.stamina > 0.67) lines.push(choice(config.formLines.stamina));
  if (stats.temperament < 0.45) lines.push(choice(config.formLines.restless));
  if (stats.consistency < 0.45) lines.push(choice(config.formLines.traffic));
  if (stats.conditionMatch > 0.06) lines.push(choice(config.formLines.track));
  if (lines.length < 2) lines.push(choice(config.formLines.mid));
  return sample(lines, 2).join(". ");
}

function generateRace(raceNumber) {
  const isMajor = Math.random() < config.majorRaceChance;
  const condition = choice(config.trackConditions);
  const raceName = isMajor ? choice(config.majorRaces) : "Echo Downs";
  const horseCount = isMajor ? config.majorHorseCount : config.standardHorseCount;
  const names = sample(config.horseNames, horseCount);

  let horses = names.map((name, idx) => {
    const stats = makeStats(condition);
    return {
      number: idx + 1,
      name,
      stats,
      rating: scoreHorse(stats, condition, isMajor),
      form: makeForm(stats),
      progress: 0,
      velocity: 0,
      laneNoise: rand(-6, 6),
      eventCooldown: 0,
      modifiers: { burst: 0, drag: 0 },
    };
  });

  horses = oddsFromScores(horses, isMajor);
  horses.sort((a, b) => a.number - b.number);

  return {
    raceNumber,
    raceName,
    isMajor,
    type: isMajor ? "Major" : "Standard",
    condition,
    horses,
    durationMs: isMajor ? config.timing.majorRaceMs : config.timing.standardRaceMs,
    bettingMs: isMajor ? config.timing.majorBettingMs : config.timing.standardBettingMs,
    startedAt: null,
    finished: false,
    order: [],
    commentary: isMajor
      ? [`${raceName} is on the board. The lamps are bright and the odds are restless.`]
      : ["The next field is loading into the gates at Echo Downs."],
    previousOrder: [],
  };
}

function phaseFor(progressRatio) {
  if (progressRatio < 0.22) return "Start";
  if (progressRatio < 0.74) return "Mid-race";
  return "Final stretch";
}

function applyEvent(horse, phase) {
  const key = weightedPick(config.eventWeights);
  if (!key) return null;
  const name = horse.name;

  switch (key) {
    case "slow_start":
      if (phase !== "Start") return null;
      horse.modifiers.drag += 10;
      return `${name} is slow from the gate!`;
    case "clean_break":
      if (phase !== "Start") return null;
      horse.modifiers.burst += 18;
      return `${name} breaks cleanly from the gate!`;
    case "stumble":
      horse.modifiers.drag += 18;
      return `${name} stumbles and loses rhythm!`;
    case "boxed_in":
      horse.modifiers.drag += 12;
      return `${name} is boxed in near the rail!`;
    case "wide_turn":
      horse.modifiers.drag += 9;
      return `${name} is forced wide around the turn.`;
    case "strong_corner":
      horse.modifiers.burst += 14;
      return `${name} takes the corner beautifully.`;
    case "blocked_path":
      horse.modifiers.drag += 13;
      return `${name} has a blocked path and checks stride.`;
    case "burst":
      horse.modifiers.burst += 20;
      return `${name} makes a huge move on the outside!`;
    case "second_wind":
      if (phase === "Start") return null;
      horse.modifiers.burst += 18;
      return `${name} finds a second wind!`;
    case "exhaustion":
      if (phase === "Start") return null;
      horse.modifiers.drag += 16;
      return `${name} is starting to fade.`;
    case "checks_momentum":
      horse.modifiers.drag += 10;
      return `${name}'s rider checks momentum in traffic.`;
    case "late_surge":
      if (phase !== "Final stretch") return null;
      horse.modifiers.burst += 26;
      return `${name} launches a late surge!`;
    default:
      return null;
  }
}

function tickRace(race, now = Date.now()) {
  if (!race.startedAt) race.startedAt = now;
  const elapsed = Math.max(0, now - race.startedAt);
  const ratio = clamp(elapsed / race.durationMs, 0, 1);
  const phase = phaseFor(ratio);
  const baseStep = FINISH_DISTANCE / Math.max(1, race.durationMs / config.timing.raceUpdateMs);
  const comments = [];

  for (const horse of race.horses) {
    if (horse.progress >= FINISH_DISTANCE) continue;

    const s = horse.stats;
    const startBoost = phase === "Start" ? (s.startingStrength - 0.5) * 22 : 0;
    const finishBoost = phase === "Final stretch" ? (s.finishingStrength - 0.5) * 28 : 0;
    const staminaDrop = phase === "Final stretch" ? (0.58 - s.stamina) * 24 : 0;
    const consistencyVariance = (1.08 - s.consistency) * rand(-18, 18);
    const temperamentVariance = phase === "Start" ? (0.8 - s.temperament) * rand(-14, 10) : 0;
    const conditionBonus =
      s.conditionMatch * 32 +
      Number(race.condition.speedBias || 0) * 35 +
      (phase !== "Start" ? Number(race.condition.staminaBias || 0) * 30 : 0);
    const sprint = phase === "Final stretch" && Math.random() < s.sprintChance * 0.12 ? rand(8, 28) : 0;
    const choke = phase === "Final stretch" && Math.random() < s.chokeChance * 0.08 ? rand(-26, -8) : 0;

    if (horse.eventCooldown > 0) horse.eventCooldown -= 1;
    if (horse.eventCooldown <= 0 && Math.random() < (phase === "Final stretch" ? 0.18 : 0.11)) {
      const eventLine = applyEvent(horse, phase);
      if (eventLine) {
        comments.push(eventLine);
        horse.eventCooldown = int(2, 4);
      }
    }

    const eventBoost = horse.modifiers.burst - horse.modifiers.drag;
    horse.modifiers.burst *= 0.35;
    horse.modifiers.drag *= 0.4;

    const movement = baseStep *
      clamp(0.72 + horse.rating * 0.5 + startBoost / 100 + finishBoost / 100 + conditionBonus / 100, 0.45, 1.5) +
      consistencyVariance +
      temperamentVariance +
      staminaDrop +
      sprint +
      choke +
      eventBoost +
      horse.laneNoise;

    horse.velocity = clamp(movement, 8, 110);
    horse.progress = clamp(horse.progress + horse.velocity, 0, FINISH_DISTANCE);
    horse.laneNoise = rand(-5, 5);
  }

  const order = [...race.horses].sort((a, b) => b.progress - a.progress);
  const leader = order[0];
  if (leader) comments.unshift(`${leader.name} leads into the ${phase.toLowerCase()}.`);

  const prev = race.previousOrder || [];
  if (prev.length) {
    for (let i = 0; i < Math.min(3, order.length); i++) {
      const oldPos = prev.indexOf(order[i].number);
      if (oldPos > i && oldPos !== -1) {
        comments.push(`${order[i].name} moves past traffic into ${ordinal(i + 1)}.`);
        break;
      }
    }
  }
  race.previousOrder = order.map((h) => h.number);

  if (ratio >= 1 || order.some((h) => h.progress >= FINISH_DISTANCE)) {
    for (const horse of race.horses) {
      if (horse.progress < FINISH_DISTANCE) horse.progress = clamp(horse.progress + rand(0, 18), 0, FINISH_DISTANCE);
    }
    race.finished = true;
    race.order = [...race.horses].sort((a, b) => b.progress - a.progress);
    const margin = Math.abs((race.order[0]?.progress || 0) - (race.order[1]?.progress || 0));
    if (margin < 12) comments.push("It's a photo finish!");
    if (margin < 7) comments.push("The stewards are reviewing the final stride...");
    comments.push(`${race.order[0].name} wins Race ${race.raceNumber}!`);
  }

  race.commentary = comments.slice(0, 4);
  return { phase, commentary: race.commentary, order: race.finished ? race.order : order, finished: race.finished };
}

function ordinal(n) {
  if (n === 1) return "1st";
  if (n === 2) return "2nd";
  if (n === 3) return "3rd";
  return `${n}th`;
}

function renderTrack(race) {
  const orderByNumber = [...race.horses].sort((a, b) => a.number - b.number);
  const lines = orderByNumber.map((h) => {
    const pos = clamp(Math.round((h.progress / FINISH_DISTANCE) * TRACK_WIDTH), 0, TRACK_WIDTH);
    const left = "-".repeat(pos);
    const right = "-".repeat(Math.max(0, TRACK_WIDTH - pos));
    const label = `#${h.number} ${h.name}`.slice(0, 22);
    return `|${left}🐎 ${label}${right}|`;
  });
  return "```txt\n" + lines.join("\n") + "\n```";
}

function payoutMultiplierForBet(type, odds) {
  const key = String(type || "").toLowerCase();
  const mod = Number(config.payoutMultipliers[key] || 0);
  return Math.max(0, Math.round(Number(odds || 0) * mod * 100) / 100);
}

module.exports = {
  FINISH_DISTANCE,
  generateRace,
  tickRace,
  renderTrack,
  payoutMultiplierForBet,
  ordinal,
};
