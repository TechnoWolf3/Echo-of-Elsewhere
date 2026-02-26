// utils/echoRift/riftScenarios.js

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function buildScenario(step, depth) {
  // Step is 1..depth
  const stage = Math.min(Math.max(Number(step) || 1, 1), Number(depth) || 2);

  // A small library of surreal prompts.
  const prompts = [
    "A corridor of mirrors stretches into darkness. Each reflection smiles differently.",
    "A door floats in open air, humming with distant laughter.",
    "A coin spins mid-air, refusing to land. The Rift waits.",
    "A staircase descends into a starless ocean. You hear your name.",
    "A lantern burns with black flame. Shadows gather around it.",
    "A chessboard appears. Every piece is you.",
    "A heartbeat echoes from the walls. The tempo changes when you blink.",
    "A bouquet of severed seconds wilts in your hands.",
    "A bell rings without sound. The Rift’s edge trembles.",
  ];

  const optionSets = [
    [
      { label: "Hold your breath and step through", hint: "bravery", risk: 2 },
      { label: "Speak your name into the dark", hint: "identity", risk: 1 },
      { label: "Turn back and pretend you never came", hint: "cowardice", risk: -1 },
    ],
    [
      { label: "Touch the coin before it lands", hint: "greed", risk: 2 },
      { label: "Let it fall and accept the result", hint: "acceptance", risk: 0 },
      { label: "Swallow it to keep it forever", hint: "madness", risk: 3 },
    ],
    [
      { label: "Open the door without looking", hint: "faith", risk: 1 },
      { label: "Knock three times and wait", hint: "patience", risk: 0 },
      { label: "Kick it in until it submits", hint: "violence", risk: 2 },
    ],
    [
      { label: "Trade a memory for passage", hint: "sacrifice", risk: 2 },
      { label: "Offer a joke to the void", hint: "defiance", risk: 1 },
      { label: "Demand a reward upfront", hint: "arrogance", risk: 3 },
    ],
    [
      { label: "Follow the smiling reflection", hint: "temptation", risk: 2 },
      { label: "Follow the crying reflection", hint: "empathy", risk: 1 },
      { label: "Smash the mirror", hint: "rupture", risk: 3 },
    ],
  ];

  const prompt = prompts[randInt(0, prompts.length - 1)];
  const set = optionSets[randInt(0, optionSets.length - 1)];

  // Add some subtle scaling so later steps are riskier.
  const scale = stage >= depth ? 1 : 0;

  const options = set.map((o) => ({
    label: o.label,
    // make later steps slightly swingier
    riskDelta: o.risk + scale,
  }));

  const narrationLines = [
    "The Rift listens.",
    "Something shifts.",
    "Echo notices.",
    "The air tightens.",
    "A distant laugh ripples through nothing.",
  ];

  return {
    prompt,
    options,
    narration: narrationLines[randInt(0, narrationLines.length - 1)],
  };
}

module.exports = { buildScenario };
