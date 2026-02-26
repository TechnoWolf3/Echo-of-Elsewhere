// utils/echoRift/riftTextPools.js
// All flavour text lives here so you can expand it without touching logic.

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Cryptic spawn lines (tier is hidden, but the vibe hints at intensity)
const SPAWN_LINES = {
  1: [
    "A hairline crack appears in reality… then pretends it was never there.",
    "The air tastes like static. Something is watching… patiently.",
    "A whisper curls through the channel and dies mid‑word.",
    "You blink — and the space between seconds feels… wider.",
    "A faint ripple. A distant laugh. A Rift that *almost* isn’t.",
  ],
  2: [
    "The lights don’t flicker… *they hesitate*.",
    "A tear opens, stitched together by unseen hands.",
    "Your shadow moves a fraction late. The Rift approves.",
    "A cold pulse thumps once. The world pretends it didn’t.",
    "Echo is near. Not close. Near.",
  ],
  3: [
    "The void leans in like it has a secret.",
    "A Rift yawns open — and something inside exhales.",
    "Reality buckles. Somewhere, a bell rings underwater.",
    "The air goes heavy. Echo’s attention is… focused.",
    "A thin scream of starlight slices the room, then settles.",
  ],
  4: [
    "The Rift opens like a wound that remembers your name.",
    "Space fractures. Time blinks. Echo does not.",
    "A pressure builds behind your eyes. The Rift is *hungry*.",
    "The channel feels smaller. Like the universe stepped closer.",
    "A silent thunder rolls through nothingness. Echo is listening.",
  ],
};

const ENTER_BUTTON_LINES = [
  "Step forward.",
  "Approach the Rift.",
  "Answer the call.",
  "Touch the edge.",
  "Tempt fate.",
];

const CLAIMED_BY_OTHER_LINES = [
  "Too slow — the Rift has already taken someone.",
  "The Rift seals behind another. You’re left with the echo of it.",
  "Denied. Someone else stepped in first.",
  "You reach out… and hit glass. The Rift is claimed.",
];

const EXPIRED_LINES = [
  "The Rift collapses with a sigh. Nothing remains but embarrassment.",
  "Too late. The crack seals itself like it was never there.",
  "The void closes. Echo is… disappointed.",
  "Silence. The Rift is gone. Your courage arrived late.",
];

const NOTHING_LINES = [
  "You shout loud… but there’s no Echo.",
  "Silence answers. Not even mockery.",
  "The Rift stares back… then closes.",
  "A cold breeze. A blank stare. Nothing.",
  "You feel watched — then forgotten.",
  "No reward. No punishment. Just… judgement.",
  "Echo listens. Then decides you weren’t worth the effort.",
  "The void yawns… and you’re not invited.",
];

const BLESSING_LINES = [
  "Echo has blessed you with **{reward}**.",
  "A warm pulse floods your chest. **+{reward}**.",
  "Echo approves of your audacity. **{reward}**.",
  "The Rift purrs. Coins fall like rain: **{reward}**.",
  "You step out richer — and smug about it. **{reward}**.",
  "A laugh echoes from nowhere. Your wallet feels heavier: **{reward}**.",
  "The universe blinks. You’re rewarded for being reckless: **{reward}**.",
];

const CURSE_LINES = [
  "Your actions have angered Echo and therefore you {curse}.",
  "Echo’s patience snaps. You {curse}.",
  "The Rift bites back. You {curse}.",
  "A cold hand closes around your fate. You {curse}.",
  "Echo judges you… and you {curse}.",
];

const BLOOD_TAX_REJECT_LINES = [
  "You return with unpaid tribute. The Rift refuses you.",
  "Echo remembers debts. You do not enter.",
  "You try to bargain while owing blood tax? Cute.",
  "The Rift laughs. You’re not welcome until you pay what you owe.",
  "Debt first. Glory later.",
];

const BLOOD_TAX_PENALTY_LINES = [
  "Echo adds an extra fee for your audacity.",
  "Echo doubles down on your stupidity. Additional tribute demanded.",
  "Trying to slip past a god with a debt? That costs extra.",
  "Echo charges you for wasting its time.",
];

const CHOSEN_DENY_LINES = [
  "You’ve proven your worth. Echo asks that you rest.",
  "Chosen already. The Rift will not spoil you twice.",
  "Echo has marked you. Don’t get greedy.",
  "The Rift recoils — you’re already wearing Echo’s favour.",
  "No. Not today. Echo doesn’t reward gluttony.",
  "Echo’s Chosen do not gamble with the Rift.",
];

const ACTIVE_CURSE_DENY_LINES = [
  "You’re still paying for your last mistake. The Rift ignores you.",
  "Echo hasn’t finished with you yet.",
  "The chains are still warm. Come back later.",
  "Your curse lingers. The Rift refuses to stack your suffering.",
  "Denied. Echo is already collecting from you.",
];

module.exports = {
  pick,
  SPAWN_LINES,
  ENTER_BUTTON_LINES,
  CLAIMED_BY_OTHER_LINES,
  EXPIRED_LINES,
  NOTHING_LINES,
  BLESSING_LINES,
  CURSE_LINES,
  BLOOD_TAX_REJECT_LINES,
  BLOOD_TAX_PENALTY_LINES,
  CHOSEN_DENY_LINES,
  ACTIVE_CURSE_DENY_LINES,
};
