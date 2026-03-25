module.exports = {
  settings: {
    maxTurns: 5,
    timeoutMs: 4 * 60_000,
    goInForScamMinTurn: 2,
    goInForScamChance: 0.42,
    rareEventChance: 0.14,
    globalCooldownMinutes: 10,
    scamCooldownMinutes: 10,
    persuasionBands: [
      { max: 14, label: "Nowhere near it", approx: "~0–14%" },
      { max: 29, label: "Shaky", approx: "~15–29%" },
      { max: 44, label: "Warming up", approx: "~30–44%" },
      { max: 59, label: "Leaning in", approx: "~45–59%" },
      { max: 74, label: "Hooked", approx: "~60–74%" },
      { max: 89, label: "Nearly there", approx: "~75–89%" },
      { max: 100, label: "One push away", approx: "~90–100%" },
    ],
    suspicionBands: [
      { max: 19, label: "Calm" },
      { max: 44, label: "Wary" },
      { max: 69, label: "Suspicious" },
      { max: 89, label: "On edge" },
      { max: 100, label: "About to twig" },
    ],
    payoutBands: [
      { min: 40, max: 59, range: [5000, 8000] },
      { min: 60, max: 79, range: [10000, 20000] },
      { min: 80, max: 100, range: [30000, 60000] },
    ],
  },

  targetTypes: [
    {
      id: "tech_guru",
      weight: 20,
      basePersuasion: 15,
      heatMultiplier: 1.4,
      rewardMultiplier: 1.25,
      backfireBase: 15,
      openings: [
        "Yeah? Who's this and why are you calling from a masked number?",
        "You've got thirty seconds before I hang up. Go.",
        "Let me guess — urgent account issue? Heard this one before.",
        "I'm in the middle of something. This had better be good.",
        "Unknown caller, weird timing. Start talking.",
      ],
      hangups: [
        "You hang up before the pitch lands. They probably knew exactly what you were doing anyway.",
        "You bail early. Sensible — that one sounded like they'd trace the call for sport.",
      ],
      persuasionByTag: {
        authority: -8,
        urgency: -10,
        empathy: -4,
        refund: 4,
        tech: 8,
        bank: -6,
        fear: -10,
        verification: -12,
        calm: 4,
        compliance: -6,
        remote: -5,
        money: -4,
      },
      responses: {
        authority: [
          "'Authority card, really?' they mutter. 'Spell the company name for me.'",
          "'Cool. And your staff ID?' The question lands like a trap.",
          "They don't sound impressed. 'Which department? Be specific.'",
        ],
        urgency: [
          "'Urgency is usually where the scam starts,' they reply flatly.",
          "'If it's critical, email me from the official domain.'",
          "They snort. 'Threatening me into compliance? Amateur hour.'",
        ],
        empathy: [
          "They let you speak, but only just. 'Mhm. Go on then.'",
          "'You're laying it on a bit thick,' they say, half amused.",
          "They pause. 'Still not convinced, but continue.'",
        ],
        refund: [
          "'A refund?' That at least gets their attention. 'For what exactly?'",
          "They finally sound curious. 'Okay… explain the refund part.'",
          "'Money back?' They stop trying to end the call for a second.",
        ],
        tech: [
          "They correct one of your technical terms — annoyingly, but not dismissively.",
          "'That's not how that works,' they say… then ask a follow-up anyway.",
          "You hit closer to something believable. 'Right… continue,' they say.",
        ],
        bank: [
          "'Banks don't do this over the phone,' they cut in immediately.",
          "'No bank rep says it like that.' They're onto the script.",
          "The bank angle lands badly. You can hear them losing patience.",
        ],
        fear: [
          "'If there was fraud, you'd have verified me first.' Ouch.",
          "They don't bite. 'Fear isn't a substitute for proof.'",
          "You push too hard and they push right back.",
        ],
        verification: [
          "'Interesting. And now you want my details? Absolutely not.'",
          "The request lands with a thud. 'Yeah, that's not happening.'",
          "They go colder. 'You're asking the wrong person for that.'",
        ],
        calm: [
          "You keep it measured. They don't trust you, but they stop interrupting.",
          "The quieter approach works better. 'Fine… keep going.'",
          "They sound less combative. Not friendly — just curious enough.",
        ],
        compliance: [
          "'Or what?' they ask, clearly enjoying your discomfort.",
          "The pressure lands badly. 'No, you comply.'",
          "'You don't get to order me around,' they reply.",
        ],
        remote: [
          "'You want remote access? Yeah, nah.'",
          "'Remote tools? On a cold call? Absolutely cooked.'",
          "They laugh outright. Not ideal.",
        ],
        money: [
          "'Convenient that money's involved only after you called me.'",
          "You mention money too directly. They instantly stiffen.",
          "The pitch smells too cash-focused and they notice.",
        ],
        positive: [
          "Against all odds, they don't hang up.",
          "You catch a small opening and wedge the script into it.",
          "They still sound sceptical — but they're listening.",
        ],
        negative: [
          "You lose ground. Fast.",
          "That line lands badly and the silence gets sharp.",
          "You can practically hear them reaching for the block button.",
        ],
        backfire: [
          "'Cute.' They start asking you the sort of questions you can't answer.",
          "The line goes icy. You pushed the wrong button.",
          "That backfires hard. They sound one click away from exposing you.",
        ],
        goSuccess: [
          "You push for the details — somehow, they bite.",
          "Against every sane probability, they hand it over.",
        ],
        goFail: [
          "'Oh you're definitely a scammer.' Click.",
          "They let you finish, then calmly inform you the call is being reported.",
          "'Mate, I work in cyber security.' The line goes dead.",
        ],
      },
      failOutcomes: ["reported", "reversed", "trace"],
      successReplies: [
        "They hand over enough to make the call worth it. Barely.",
        "The details come through and you move before they think twice.",
      ],
      declineNotes: [
        "A rare moment of restraint. The call centre manager calls it 'wasted potential'.",
      ],
    },

    {
      id: "average_person",
      weight: 50,
      basePersuasion: 40,
      heatMultiplier: 1.0,
      rewardMultiplier: 1.0,
      backfireBase: 8,
      openings: [
        "Hello? Sorry, who am I speaking with?",
        "Uh… yep? What's this about?",
        "I don't normally answer unknown numbers, but alright.",
        "Hey, is there a problem with my account or something?",
        "Can you just tell me what this is regarding?",
      ],
      hangups: [
        "You drop the call before committing. Not noble — just indecisive.",
        "You hang up. Somewhere, a headset-wearing supervisor sighs theatrically.",
      ],
      persuasionByTag: {
        authority: 5,
        urgency: 6,
        empathy: 6,
        refund: 8,
        tech: -1,
        bank: 5,
        fear: 7,
        verification: 2,
        calm: 4,
        compliance: 3,
        remote: 1,
        money: 3,
      },
      responses: {
        authority: [
          "'Okay… and what company are you with exactly?'",
          "They sound uncertain, but not resistant. 'Right… go on.'",
          "'Official sounding enough,' they mumble. That's something.",
        ],
        urgency: [
          "The urgency rattles them a little. 'Wait — what happened?'",
          "'Hang on, now I'm worried,' they admit.",
          "That gets their attention. Not trust — just attention.",
        ],
        empathy: [
          "They soften. 'Okay, thanks for letting me know.'",
          "The gentler angle helps. 'What do I need to do?'",
          "They stop sounding defensive and start sounding nervous.",
        ],
        refund: [
          "'Refund? I wasn't expecting one, but… alright?'",
          "Money gets them listening fast. Too fast, maybe.",
          "They ask a couple of hesitant questions instead of hanging up.",
        ],
        tech: [
          "Technical jargon loses them a bit, but they don't challenge it.",
          "They don't fully understand you — which, unhelpfully, helps.",
          "You sound just convincing enough on the technical front.",
        ],
        bank: [
          "The banking angle lands. 'Was there a charge or something?'",
          "They sound worried. 'Can you see the account?'",
          "'Oh god, not again…' They stay on the line.",
        ],
        fear: [
          "You hear the panic set in. That moves things along.",
          "The threat of a problem hooks them more than it should.",
          "It works — not gracefully, but it works.",
        ],
        verification: [
          "'You need me to confirm what exactly?' they ask.",
          "They hesitate, but they don't reject it outright.",
          "The verification angle makes them pause instead of flee.",
        ],
        calm: [
          "Keeping it smooth settles them. They keep listening.",
          "The low-pressure delivery buys you trust.",
          "No fireworks, but no alarms either.",
        ],
        compliance: [
          "A firmer tone nudges them along, but only barely.",
          "They don't love being told what to do, but they don't resist either.",
          "You get obedience without much goodwill. It'll do.",
        ],
        remote: [
          "They don't understand the remote access part, which is both useful and concerning.",
          "'If that's what fixes it… sure?' they say, uncertain.",
          "That line sounds sketchy, but they haven't clocked it yet.",
        ],
        money: [
          "Mentioning money sharpens their focus instantly.",
          "They ask the sort of questions a worried customer would ask.",
          "Cash is a strong motivator. Predictable, really.",
        ],
        positive: [
          "They're not convinced — just movable.",
          "You gain a little ground and keep the line alive.",
          "It isn't elegant, but it lands.",
        ],
        negative: [
          "They start sounding less certain about you than about the 'issue'.",
          "A wobble. Not fatal, but not good.",
          "You fumble the rhythm and they notice.",
        ],
        backfire: [
          "'This is sounding weird now,' they say.",
          "That line spooks them more than it persuades them.",
          "You overplay it and the call starts slipping away.",
        ],
        goSuccess: [
          "They cave and give you what you wanted.",
          "One final shove and they comply.",
        ],
        goFail: [
          "'Nope. I'm calling my bank myself.' Click.",
          "They pull back at the last second and the whole thing dies.",
          "You ask for too much, too quickly. They bolt.",
        ],
      },
      failOutcomes: ["hangup", "reported", "trace"],
      successReplies: [
        "They follow your instructions all the way through. Disturbingly easy.",
        "The scam lands cleanly enough to be profitable.",
      ],
      declineNotes: [
        "You spare an average person one rotten phone call. Growth? Probably not.",
      ],
    },

    {
      id: "elderly_victim",
      weight: 30,
      basePersuasion: 65,
      heatMultiplier: 1.8,
      rewardMultiplier: 1.6,
      backfireBase: 4,
      openings: [
        "Oh! Hello dear, who is this?",
        "Sorry love, I didn't quite catch that — what's happened?",
        "Is everything alright? You sound official.",
        "Oh goodness, is this about the card?",
        "Yes? I'm here — just speak up a little.",
      ],
      hangups: [
        "Congratulations on not scamming the elderly! You're such a thoughtful person. Unfortunately, your boss doesn't care.",
        "You hang up on an easy mark. Morally better. Professionally terrible.",
      ],
      persuasionByTag: {
        authority: 9,
        urgency: 8,
        empathy: 10,
        refund: 10,
        tech: -2,
        bank: 8,
        fear: 9,
        verification: 5,
        calm: 7,
        compliance: 5,
        remote: 2,
        money: 6,
      },
      responses: {
        authority: [
          "'Oh, from the company? Right then…' They sound reassured.",
          "The official tone works immediately. Too immediately.",
          "They don't question your authority at all. Grimly useful.",
        ],
        urgency: [
          "'Oh dear… should I be worried?'",
          "That frightens them enough to keep listening closely.",
          "They sound rattled and eager to fix it.",
        ],
        empathy: [
          "The kindness lands hard. 'Thank you for helping me.'",
          "They trust the softer tone almost instantly.",
          "'You're very patient,' they say, which is not ideal for anyone involved.",
        ],
        refund: [
          "'A refund? Oh! Well that would help, dear.'",
          "Money and reassurance is a nasty effective combo here.",
          "They become much more cooperative.",
        ],
        tech: [
          "The jargon confuses them, but they don't challenge it.",
          "They don't follow the technical part — they just trust your confidence.",
          "You probably lost them halfway through, but not in a bad way.",
        ],
        bank: [
          "'My bank card? Oh no…' They sound genuinely frightened.",
          "The bank angle opens them right up.",
          "They sound like they're already reaching for their purse.",
        ],
        fear: [
          "The fear tactic works, though it makes the whole thing uglier.",
          "They panic, which helps the scam and says terrible things about all of this.",
          "That lands brutally well.",
        ],
        verification: [
          "'If you need it to fix the problem, alright…'",
          "They hesitate only briefly before agreeing.",
          "The request doesn't alarm them nearly enough.",
        ],
        calm: [
          "A steady tone keeps them comfortable and compliant.",
          "They relax into the script and follow your lead.",
          "No pressure needed — they simply trust you.",
        ],
        compliance: [
          "They respond to direction more than pressure. Still, it works.",
          "A little firmness gets them moving without much resistance.",
          "They sound apologetic for not understanding faster.",
        ],
        remote: [
          "They don't really know what you're asking, but they try anyway.",
          "The remote access line sounds technical enough to pass.",
          "Confusion helps you here. Not a sentence anyone should like.",
        ],
        money: [
          "Mentioning the transfer focuses them immediately.",
          "They want the issue solved and the money safe. You can work with that.",
          "It sounds like they've stopped doubting you entirely.",
        ],
        positive: [
          "They lean into your instructions with worrying ease.",
          "You gain ground fast. Too fast.",
          "They're with you now, for better or vastly worse.",
        ],
        negative: [
          "Something you said confuses them, and the rhythm stumbles.",
          "They lose the thread for a moment. You need to recover.",
          "A small misstep shakes their trust more than expected.",
        ],
        backfire: [
          "'My grandson said not to do this sort of thing over the phone…'",
          "A flicker of doubt appears. Dangerous, if annoyingly wholesome.",
          "They suddenly sound less certain about you than before.",
        ],
        goSuccess: [
          "They agree and hand it over. Efficient. Awful. Effective.",
          "One more push and they comply almost immediately.",
        ],
        goFail: [
          "'Actually… I'll ask my daughter first.' Click.",
          "Right at the finish line, someone in the back of their memory saves them.",
          "They panic, apologise, and hang up. Somehow that's the good ending here.",
        ],
      },
      failOutcomes: ["hangup", "reported", "trace"],
      successReplies: [
        "They hand everything over with barely any resistance.",
        "The scam lands clean and profitable — and feels worse because of it.",
      ],
      declineNotes: [
        "Congratulations on not scamming the elderly! You're such a thoughtful person! Although, your boss doesn't care.",
      ],
    },
  ],

  dialogueOptions: [
    { id: "microsoft_support", label: "Claim to be Microsoft support", line: "This is Microsoft support calling about unusual activity on your device.", tags: ["authority", "tech"], persuasion: [10, 17], suspicion: [8, 13], risk: 6 },
    { id: "bank_activity", label: "Warn of suspicious bank activity", line: "We've detected suspicious activity against your bank account and need to secure it.", tags: ["bank", "urgency", "fear"], persuasion: [12, 20], suspicion: [10, 16], risk: 9 },
    { id: "account_suspension", label: "Threaten account suspension", line: "If this isn't handled promptly, your account may be suspended for protection.", tags: ["urgency", "compliance", "fear"], persuasion: [13, 21], suspicion: [12, 20], risk: 12 },
    { id: "fake_refund", label: "Offer a fake refund", line: "It looks like you're owed a refund — I can process it right now.", tags: ["refund", "money", "empathy"], persuasion: [11, 19], suspicion: [7, 12], risk: 7 },
    { id: "security_issue", label: "Mention a security issue", line: "I'm calling regarding a serious security issue tied to your profile.", tags: ["authority", "urgency"], persuasion: [9, 16], suspicion: [8, 13], risk: 6 },
    { id: "friendly_helper", label: "Play the helpful expert", line: "I'll walk you through this step by step so nothing gets missed.", tags: ["empathy", "calm"], persuasion: [7, 14], suspicion: [3, 8], risk: 2 },
    { id: "compliance_notice", label: "Quote a compliance requirement", line: "For compliance reasons I need to verify a couple of details with you now.", tags: ["authority", "verification", "compliance"], persuasion: [8, 15], suspicion: [8, 14], risk: 8 },
    { id: "remote_tool", label: "Ask them to open a remote support tool", line: "I'll need you to open a secure support tool so I can stop the intrusion from my end.", tags: ["remote", "tech", "authority"], persuasion: [8, 16], suspicion: [10, 18], risk: 10 },
    { id: "otp_verify", label: "Request a verification code", line: "A one-time verification code will be sent — read it back so I can lock everything down.", tags: ["verification", "urgency"], persuasion: [10, 18], suspicion: [11, 18], risk: 11 },
    { id: "card_check", label: "Ask them to confirm card details", line: "To make sure the correct account is secured, please confirm the card you're using.", tags: ["verification", "bank", "money"], persuasion: [10, 17], suspicion: [10, 16], risk: 10 },
    { id: "calm_assurance", label: "Keep it calm and reassuring", line: "No need to panic — this is exactly why I'm calling before it gets worse.", tags: ["calm", "empathy"], persuasion: [8, 15], suspicion: [3, 7], risk: 2 },
    { id: "fraud_team", label: "Pretend to be the fraud team", line: "I'm with the fraud response team and your file was escalated to us moments ago.", tags: ["authority", "bank", "urgency"], persuasion: [11, 18], suspicion: [9, 15], risk: 8 },
    { id: "login_session", label: "Mention an unauthorised login", line: "We've identified an unauthorised login session and I'm trying to block it before it settles.", tags: ["tech", "fear", "urgency"], persuasion: [10, 18], suspicion: [8, 14], risk: 7 },
    { id: "chargeback_story", label: "Mention a mistaken chargeback", line: "There's a mistaken chargeback attached to your file and I can reverse it for you.", tags: ["refund", "money", "bank"], persuasion: [10, 19], suspicion: [6, 12], risk: 6 },
    { id: "insurance_angle", label: "Promise account protection", line: "I'm trying to make sure you're covered before any losses leave the temporary protection window.", tags: ["authority", "fear", "money"], persuasion: [9, 17], suspicion: [7, 13], risk: 6 },
    { id: "trusted_tone", label: "Use a warm, patient tone", line: "Take your time — I'll stay on the line and make sure this gets sorted with you.", tags: ["empathy", "calm"], persuasion: [7, 14], suspicion: [2, 6], risk: 1 },
    { id: "deadline_push", label: "Say the window is closing", line: "I'm trying to stop this before the security window closes in the next few minutes.", tags: ["urgency", "fear", "compliance"], persuasion: [12, 20], suspicion: [10, 17], risk: 9 },
    { id: "scripted_formality", label: "Sound extra formal", line: "Before I proceed, I am required to complete an immediate account integrity confirmation.", tags: ["authority", "compliance"], persuasion: [8, 14], suspicion: [6, 11], risk: 5 },
    { id: "small_talk", label: "Build rapport first", line: "I know this is out of the blue, but I'm calling to help before this becomes a bigger headache for you.", tags: ["empathy", "calm", "authority"], persuasion: [7, 13], suspicion: [2, 6], risk: 1 },
    { id: "payment_hold", label: "Mention a payment hold", line: "A pending hold has been placed against your account activity and I can release it once we verify you.", tags: ["money", "verification", "bank"], persuasion: [9, 17], suspicion: [7, 12], risk: 6 },
    { id: "reassure_and_direct", label: "Reassure them, then direct them", line: "You're fine for the moment, but I need you to follow my instructions exactly so it stays that way.", tags: ["calm", "compliance", "fear"], persuasion: [10, 17], suspicion: [6, 11], risk: 5 },
    { id: "escalation_bluff", label: "Bluff an escalation", line: "If you don't want this escalated further, I can finalise it with you right now.", tags: ["urgency", "authority", "compliance"], persuasion: [11, 18], suspicion: [8, 14], risk: 7 },
    { id: "device_cleanup", label: "Offer to remove a device threat", line: "There's a flagged process on your device and I can help remove it before it spreads.", tags: ["tech", "authority", "fear"], persuasion: [9, 16], suspicion: [8, 13], risk: 7 },
    { id: "courteous_banker", label: "Sound like a calm banker", line: "I'm just trying to make sure your funds remain secure while this is reviewed.", tags: ["bank", "calm", "authority"], persuasion: [8, 15], suspicion: [4, 9], risk: 3 },
  ],

  rareEvents: [
    {
      id: "supervisor_boost",
      weight: 30,
      text: "☎️ **Call Centre Supervisor:** A hiss in your headset tells you to sound more confident. Somehow, it helps.",
      apply: (state) => {
        state.persuasion += 10;
      },
    },
    {
      id: "victim_calls_out",
      weight: 24,
      text: "☎️ **Victim Calls You Out:** They go quiet for a second. You just lost momentum.",
      apply: (state) => {
        state.persuasion -= 12;
        state.suspicion += 8;
      },
    },
    {
      id: "scam_jackpot",
      weight: 16,
      text: "☎️ **Scam Jackpot:** The file attached to this target looks much juicier than expected.",
      apply: (state) => {
        state.jackpotMultiplier += 0.5;
      },
    },
    {
      id: "police_trace",
      weight: 12,
      text: "☎️ **Police Trace Call:** You hear a faint click on the line. Bad sign.",
      apply: (state) => {
        state.suspicion += 20;
        state.heatBonus += 20;
        state.traceFlag = true;
      },
    },
    {
      id: "script_fumble",
      weight: 18,
      text: "☎️ **Script Fumble:** You lose your place in the script and have to recover mid-lie.",
      apply: (state) => {
        state.persuasion -= 8;
      },
    },
  ],
};
