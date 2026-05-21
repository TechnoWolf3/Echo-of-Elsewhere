const LEVEL_UP_LINES = [
  "The Echo hears you a little clearer now.",
  "The walls remember your name.",
  "Your voice carries further through The Place.",
  "Something in the static answered back.",
  "You are no longer just background noise.",
  "The lights flickered. That probably means something.",
  "The Echo added your name to a list. Probably fine.",
  "A nearby toaster whispered congratulations.",
  "The Place has acknowledged your continued existence.",
  "Somewhere, a door unlocked. Not for you, but still.",
  "The vending machine blinked twice in approval.",
  "The carpet knows your footsteps now.",
  "Your presence has become harder to ignore.",
  "Echo filed this under \"concerning but impressive.\"",
  "A suspiciously damp certificate appears.",
  "The server got 3% louder.",
  "The void gave a polite nod.",
  "You have achieved slightly more ominous vibes.",
  "The Echo coughed up confetti.",
  "Someone in the walls is clapping.",
  "The air smells faintly of achievement.",
  "The Place updated your warranty.",
  "You are now statistically more noticeable.",
  "A tiny bell rang in a room nobody can find.",
  "Echo has upgraded you from \"person\" to \"recurring character.\"",
  "Your name has been added to the weird little book.",
  "The static briefly sounded proud.",
  "You are becoming part of the local folklore.",
  "The community has been forced to perceive you.",
  "Your signal survived another layer of static.",
  "The ceiling tiles shifted into a respectful pattern.",
  "Echo underlined your name twice.",
  "A filing cabinet somewhere made room for you.",
  "The lights now recognize your footsteps.",
  "The Place has moved you from maybe to noted.",
  "Your voice left fingerprints in the room.",
  "A clipboard appeared with your name already checked.",
];

function randomLevelUpLine() {
  return LEVEL_UP_LINES[Math.floor(Math.random() * LEVEL_UP_LINES.length)];
}

module.exports = {
  LEVEL_UP_LINES,
  randomLevelUpLine,
};
