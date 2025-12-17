// data/crime/storeRobbery.scenarios.js
// Big scenario pools for Store Robbery (S1)
// Notes:
// - Keep IDs unique within each phase.
// - Choices support: label, heat, lootAdd, evidenceRisk, evidenceClear, usedCar, timerRisk, witnessRisk, crowdBlend, style
// - StoreRobbery.js clamps final payout to $2k–$6k, so lootAdd values here can be modest.

module.exports = {
  // -----------------
  // APPROACH (Step 1)
  // -----------------
  approach: [
    {
      id: "ap_late_night_scroll",
      text: "It’s late. The clerk is half-asleep, doom-scrolling behind the counter.",
      choices: [
        { label: "Act casual", heat: 0, evidenceRisk: true },
        { label: "Create a distraction", heat: 5 },
        { label: "Mask up", heat: 10 },
      ],
    },
    {
      id: "ap_busy_two_customers",
      text: "Two customers are inside. One keeps glancing at the counter like they’re nosy.",
      choices: [
        { label: "Wait for a gap", heat: -5 },
        { label: "Go now anyway", heat: 10, witnessRisk: true },
        { label: "Circle back later", heat: 0 },
      ],
    },
    {
      id: "ap_rainy_hood_up",
      text: "Rain’s hammering down. Your hoodie is already soaked and heavy.",
      choices: [
        { label: "Blend in with hoodie", heat: 0, evidenceRisk: true },
        { label: "Mask up under the hood", heat: 10 },
        { label: "Fake a phone call distraction", heat: 5 },
      ],
    },
    {
      id: "ap_delivery_truck_block",
      text: "A delivery truck is blocking half the storefront. Perfect cover… or perfect trap.",
      choices: [
        { label: "Slip in behind the truck", heat: 5 },
        { label: "Walk in casual", heat: 0, evidenceRisk: true },
        { label: "Wait till it leaves", heat: -5 },
      ],
    },
    {
      id: "ap_camera_in_window",
      text: "You notice a little camera sticker on the door. Might be real, might be bait.",
      choices: [
        { label: "Mask up anyway", heat: 10 },
        { label: "Act casual (risk ID)", heat: 0, evidenceRisk: true },
        { label: "Cause a distraction first", heat: 5 },
      ],
    },
    {
      id: "ap_clerk_on_call",
      text: "The clerk is on a call, laughing too loud. They’re distracted—but also unpredictable.",
      choices: [
        { label: "Quick move while distracted", heat: 5 },
        { label: "Act casual, browse aisles", heat: 0, evidenceRisk: true },
        { label: "Mask up and commit", heat: 10 },
      ],
    },
    {
      id: "ap_security_guard_outside",
      text: "A bored security guard is outside… but they look like they’re about to wander off.",
      choices: [
        { label: "Wait for them to move", heat: -5 },
        { label: "Act casual, walk past", heat: 0, evidenceRisk: true },
        { label: "Create a distraction outside", heat: 5, witnessRisk: true },
      ],
    },
    {
      id: "ap_kids_nearby",
      text: "A group of kids are hanging near the entrance, messing around.",
      choices: [
        { label: "Abort & come back later", heat: 0 },
        { label: "Act casual and slip in", heat: 0, evidenceRisk: true, witnessRisk: true },
        { label: "Shoo them off with a scene", heat: 10, witnessRisk: true },
      ],
    },
    {
      id: "ap_store_just_opened",
      text: "The store just opened. Fresh register… and a fresh memory of your face.",
      choices: [
        { label: "Mask up (safer later)", heat: 10 },
        { label: "Act casual, grab a drink first", heat: 0, evidenceRisk: true },
        { label: "Create a distraction in aisle 2", heat: 5 },
      ],
    },
    {
      id: "ap_nervous_stomach",
      text: "Your nerves are screaming. One wrong move and you’ll look guilty without even doing anything.",
      choices: [
        { label: "Act casual (risky evidence)", heat: 0, evidenceRisk: true },
        { label: "Mask up to commit", heat: 10 },
        { label: "Bail out completely", heat: -10 },
      ],
    },
    {
      id: "ap_old_friend_in_line",
      text: "You swear you recognize someone near the checkout. That’s… not ideal.",
      choices: [
        { label: "Abort & leave", heat: 0 },
        { label: "Act casual, avoid eye contact", heat: 0, evidenceRisk: true, witnessRisk: true },
        { label: "Create a distraction to split attention", heat: 5 },
      ],
    },
    {
      id: "ap_power_flicker",
      text: "The lights flicker. Could be nothing—could be a perfect moment of confusion.",
      choices: [
        { label: "Use the moment (quick move)", heat: 5 },
        { label: "Act casual, pretend browsing", heat: 0, evidenceRisk: true },
        { label: "Mask up and strike", heat: 10 },
      ],
    },
  ],

  // ----------------
  // METHOD (Step 2)
  // ----------------
  method: [
    {
      id: "me_counter_reach",
      text: "You’re close enough to the till to make a move.",
      choices: [
        { label: "Quick snatch", heat: 5, lootAdd: 650 },
        { label: "Intimidate the clerk", heat: 10, lootAdd: 900 },
        { label: "Bluff threat", heat: 15, lootAdd: 1100 },
      ],
    },
    {
      id: "me_clerk_shaky_hands",
      text: "The clerk’s hands are shaking already. They look like they’ll panic fast.",
      choices: [
        { label: "Keep it quiet", heat: 5, lootAdd: 700 },
        { label: "Push harder", heat: 15, lootAdd: 1200, witnessRisk: true },
        { label: "Steal from the side shelves", heat: 5, lootAdd: 550 },
      ],
    },
    {
      id: "me_register_open_ping",
      text: "You hear the register ping like it’s been opened recently.",
      choices: [
        { label: "Snatch and move", heat: 5, lootAdd: 800 },
        { label: "Intimidate for more", heat: 10, lootAdd: 1050 },
        { label: "Act like you’re paying, then grab", heat: 0, lootAdd: 700, evidenceRisk: true },
      ],
    },
    {
      id: "me_customer_walks_in",
      text: "A customer walks in mid-move. Bad timing.",
      choices: [
        { label: "Freeze and act casual", heat: 0, evidenceRisk: true, witnessRisk: true },
        { label: "Threaten quickly and rush", heat: 15, lootAdd: 950, witnessRisk: true },
        { label: "Abort the counter, grab shelves", heat: 5, lootAdd: 600, witnessRisk: true },
      ],
    },
    {
      id: "me_clerk_hits_panic_button",
      text: "The clerk’s hand twitches toward something under the counter.",
      choices: [
        { label: "Slap the hand away", heat: 15, lootAdd: 900, timerRisk: true },
        { label: "Back off and take shelves", heat: 5, lootAdd: 650 },
        { label: "Bluff harder to scare them", heat: 20, lootAdd: 1200, witnessRisk: true },
      ],
    },
    {
      id: "me_cash_drawer_sticky",
      text: "The cash drawer sticks. It’s not sliding out cleanly.",
      choices: [
        { label: "Force it open", heat: 10, lootAdd: 850, timerRisk: true },
        { label: "Take what you can and go", heat: 5, lootAdd: 600 },
        { label: "Switch to intimidation", heat: 15, lootAdd: 1000 },
      ],
    },
    {
      id: "me_clerk_mouthy",
      text: "The clerk talks tough like they’re not scared. Either bravado… or they’ve got help nearby.",
      choices: [
        { label: "Quiet intimidation", heat: 10, lootAdd: 850 },
        { label: "Bluff threat (high swing)", heat: 15, lootAdd: 1200, witnessRisk: true },
        { label: "Stealth grab & move", heat: 5, lootAdd: 650, evidenceRisk: true },
      ],
    },
    {
      id: "me_camera_angle",
      text: "You catch your reflection in a convex mirror. Cameras might have a perfect angle right now.",
      choices: [
        { label: "Move to a blind spot", heat: 5 },
        { label: "Commit fast, grab and go", heat: 10, lootAdd: 900 },
        { label: "Act casual (risk ID)", heat: 0, lootAdd: 700, evidenceRisk: true },
      ],
    },
    {
      id: "me_clerk_drops_keys",
      text: "The clerk drops a set of keys and fumbles to pick them up.",
      choices: [
        { label: "Use the moment (snatch cash)", heat: 5, lootAdd: 850 },
        { label: "Intimidate for safe access", heat: 15, lootAdd: 950, timerRisk: true },
        { label: "Grab shelves while they’re down", heat: 5, lootAdd: 650 },
      ],
    },
    {
      id: "me_side_door_chime",
      text: "A side door chime rings. Someone might be coming from the back room.",
      choices: [
        { label: "Rush the till", heat: 10, lootAdd: 900, timerRisk: true },
        { label: "Switch to shelves and exit", heat: 5, lootAdd: 650 },
        { label: "Bluff threat to freeze them", heat: 15, lootAdd: 1100, witnessRisk: true },
      ],
    },
    {
      id: "me_change_in_till",
      text: "The till is heavy on coins and small notes—annoying to carry, easy to spill.",
      choices: [
        { label: "Take it anyway", heat: 5, lootAdd: 750 },
        { label: "Demand notes only", heat: 10, lootAdd: 900, timerRisk: true },
        { label: "Grab shelves instead", heat: 5, lootAdd: 600 },
      ],
    },
    {
      id: "me_clerk_calls_manager",
      text: "The clerk blurts ‘manager!’ toward the back room.",
      choices: [
        { label: "Bolt with shelves", heat: 10, lootAdd: 700, witnessRisk: true },
        { label: "Intimidate harder, grab till", heat: 15, lootAdd: 950, witnessRisk: true },
        { label: "Act casual and abort", heat: 0, evidenceRisk: true, witnessRisk: true },
      ],
    },
  ],

  // ---------------
  // GREED (Step 3)
  // ---------------
  greed: [
    {
      id: "gr_till_and_bounce",
      text: "You’ve got a moment. Do you just take the till and bounce?",
      choices: [
        { label: "Grab till & bounce", heat: 5, lootAdd: 900 },
        { label: "Push for safe", heat: 15, lootAdd: 1200, timerRisk: true },
        { label: "Sweep shelves fast", heat: 10, lootAdd: 850, witnessRisk: true },
      ],
    },
    {
      id: "gr_safe_hesitation",
      text: "The clerk hesitates at the safe keypad. Every second feels loud.",
      choices: [
        { label: "Push harder", heat: 15, lootAdd: 1400, timerRisk: true },
        { label: "Take what you have & leave", heat: 5, lootAdd: 700 },
        { label: "Switch to shelves", heat: 10, lootAdd: 900, witnessRisk: true },
      ],
    },
    {
      id: "gr_backroom_noise",
      text: "You hear movement in the back room. Someone might be coming out.",
      choices: [
        { label: "Leave immediately", heat: 5, lootAdd: 650 },
        { label: "Grab one more handful", heat: 10, lootAdd: 900, witnessRisk: true },
        { label: "Demand safe NOW", heat: 20, lootAdd: 1500, timerRisk: true, witnessRisk: true },
      ],
    },
    {
      id: "gr_wallet_on_counter",
      text: "There’s a wallet sitting on the counter. Probably a customer’s.",
      choices: [
        { label: "Ignore it, stick to cash", heat: 5, lootAdd: 850 },
        { label: "Snatch wallet too", heat: 10, lootAdd: 950, witnessRisk: true },
        { label: "Demand safe instead", heat: 15, lootAdd: 1300, timerRisk: true },
      ],
    },
    {
      id: "gr_tip_jar",
      text: "A tip jar sits right in reach. Petty… but easy.",
      choices: [
        { label: "Take it and go", heat: 5, lootAdd: 650 },
        { label: "Take it + till", heat: 10, lootAdd: 950, witnessRisk: true },
        { label: "Skip it, push for safe", heat: 15, lootAdd: 1300, timerRisk: true },
      ],
    },
    {
      id: "gr_clerk_pleading",
      text: "The clerk pleads quietly: ‘Please… just take it and go.’",
      choices: [
        { label: "Fine. Take till and leave", heat: 5, lootAdd: 850 },
        { label: "Push for more anyway", heat: 15, lootAdd: 1400, timerRisk: true },
        { label: "Sweep shelves on the way out", heat: 10, lootAdd: 900, witnessRisk: true },
      ],
    },
    {
      id: "gr_register_open_longer",
      text: "The register is open. The longer it stays open, the more obvious this gets.",
      choices: [
        { label: "Close it and leave", heat: 5, lootAdd: 700 },
        { label: "Scoop more notes fast", heat: 10, lootAdd: 950, timerRisk: true },
        { label: "Demand safe for big score", heat: 20, lootAdd: 1500, timerRisk: true },
      ],
    },
    {
      id: "gr_customer_outside_peeking",
      text: "You see a silhouette outside the window peeking in.",
      choices: [
        { label: "Exit immediately", heat: 5, lootAdd: 650 },
        { label: "Finish shelves fast", heat: 10, lootAdd: 900, witnessRisk: true },
        { label: "Threaten clerk louder (bad idea)", heat: 20, lootAdd: 1000, witnessRisk: true },
      ],
    },
    {
      id: "gr_safe_is_slow",
      text: "The safe has a time delay. Not long… but long enough to feel like forever.",
      choices: [
        { label: "Wait it out", heat: 20, lootAdd: 1500, timerRisk: true, witnessRisk: true },
        { label: "Abort safe, grab till", heat: 10, lootAdd: 950 },
        { label: "Shelves + bounce", heat: 10, lootAdd: 900, witnessRisk: true },
      ],
    },
    {
      id: "gr_clerk_offers_compromise",
      text: "The clerk offers to hand over a bundle from under the counter if you leave now.",
      choices: [
        { label: "Take bundle & leave", heat: 5, lootAdd: 950 },
        { label: "Demand safe too", heat: 15, lootAdd: 1400, timerRisk: true },
        { label: "Sweep shelves as well", heat: 10, lootAdd: 1050, witnessRisk: true },
      ],
    },
    {
      id: "gr_you_see_cctv_monitor",
      text: "There’s a CCTV monitor behind the counter showing multiple angles—including yours.",
      choices: [
        { label: "Leave immediately", heat: 5, lootAdd: 650 },
        { label: "Grab till anyway", heat: 10, lootAdd: 950 },
        { label: "Push for safe (risky)", heat: 20, lootAdd: 1500, timerRisk: true, witnessRisk: true },
      ],
    },
    {
      id: "gr_clerk_stalls",
      text: "The clerk starts stalling with fake fumbling: ‘I can’t… it’s stuck…’",
      choices: [
        { label: "Take shelves and go", heat: 10, lootAdd: 900, witnessRisk: true },
        { label: "Push harder (timer risk)", heat: 15, lootAdd: 1200, timerRisk: true },
        { label: "Cut losses, bounce now", heat: 5, lootAdd: 650 },
      ],
    },
  ],

  // ------------
  // EXIT (Step 4)
  // ------------
  exit: [
    {
      id: "ex_rear_door",
      text: "You spot a rear door behind the counter. It’s slightly ajar.",
      choices: [
        { label: "Back alley", heat: 5 },
        { label: "Blend into crowd", heat: 0, crowdBlend: true },
        { label: "Car waiting", heat: 10, usedCar: true },
      ],
    },
    {
      id: "ex_front_door_bell",
      text: "The front door bell is loud. Leaving through it will be obvious.",
      choices: [
        { label: "Slip out back", heat: 5 },
        { label: "Front door sprint", heat: 10, witnessRisk: true },
        { label: "Blend out slow", heat: 0, crowdBlend: true, evidenceRisk: true },
      ],
    },
    {
      id: "ex_customer_nearby",
      text: "A customer is right near the entrance, staring like they know something’s up.",
      choices: [
        { label: "Back alley exit", heat: 5 },
        { label: "Shoulder past them", heat: 15, witnessRisk: true },
        { label: "Blend into crowd", heat: 0, crowdBlend: true, witnessRisk: true },
      ],
    },
    {
      id: "ex_police_siren_far",
      text: "You hear a siren in the distance. Could be unrelated… or not.",
      choices: [
        { label: "Leave immediately (quiet)", heat: 5 },
        { label: "Run (draws attention)", heat: 10, witnessRisk: true },
        { label: "Car getaway", heat: 10, usedCar: true },
      ],
    },
    {
      id: "ex_alley_has_people",
      text: "The alley has two people smoking. They look up as you approach.",
      choices: [
        { label: "Walk casual past them", heat: 0, evidenceRisk: true, witnessRisk: true },
        { label: "Go front door instead", heat: 10, witnessRisk: true },
        { label: "Car waiting—skip alley", heat: 10, usedCar: true },
      ],
    },
    {
      id: "ex_trip_on_kerb",
      text: "You nearly trip off the curb. One more stumble and you’ll eat pavement.",
      choices: [
        { label: "Slow down, steady yourself", heat: 0, crowdBlend: true },
        { label: "Sprint anyway", heat: 10, witnessRisk: true },
        { label: "Car escape", heat: 10, usedCar: true },
      ],
    },
    {
      id: "ex_back_fence_gap",
      text: "There’s a gap in a back fence that leads to a quiet street.",
      choices: [
        { label: "Slip through gap", heat: 5 },
        { label: "Stick to main road (blend)", heat: 0, crowdBlend: true, evidenceRisk: true },
        { label: "Car waiting nearby", heat: 10, usedCar: true },
      ],
    },
    {
      id: "ex_neighbor_watches",
      text: "A neighbor is watering plants and watching the storefront like it’s their hobby.",
      choices: [
        { label: "Back alley exit", heat: 5 },
        { label: "Blend into crowd", heat: 0, crowdBlend: true, witnessRisk: true },
        { label: "Run (bad look)", heat: 10, witnessRisk: true },
      ],
    },
    {
      id: "ex_phone_camera",
      text: "Someone across the street raises their phone. Recording? Or just texting?",
      choices: [
        { label: "Blend away calmly", heat: 0, crowdBlend: true, evidenceRisk: true },
        { label: "Run immediately", heat: 10, witnessRisk: true },
        { label: "Car getaway", heat: 10, usedCar: true, witnessRisk: true },
      ],
    },
    {
      id: "ex_shortcut_through_storefront",
      text: "A small shortcut cuts between buildings—tight, dark, and fast.",
      choices: [
        { label: "Take shortcut", heat: 5 },
        { label: "Main street blend", heat: 0, crowdBlend: true, evidenceRisk: true },
        { label: "Car escape", heat: 10, usedCar: true },
      ],
    },
    {
      id: "ex_bus_stop_crowd",
      text: "There’s a small crowd at a bus stop right where you’d normally run past.",
      choices: [
        { label: "Blend into bus crowd", heat: 0, crowdBlend: true, evidenceRisk: true },
        { label: "Detour through alley", heat: 5 },
        { label: "Car escape", heat: 10, usedCar: true },
      ],
    },
    {
      id: "ex_light_turns_red",
      text: "At the corner, the pedestrian light flips red. Stopping looks normal. Running looks guilty.",
      choices: [
        { label: "Stop and act normal", heat: 0, crowdBlend: true, evidenceRisk: true },
        { label: "Run anyway", heat: 10, witnessRisk: true },
        { label: "Hop into car", heat: 10, usedCar: true },
      ],
    },
  ],

  // -----------------
  // AFTERMATH (Step 5)
  // -----------------
  aftermath: [
    {
      id: "af_ditch_evidence",
      text: "You duck into a side street. Your heart’s still hammering.",
      choices: [
        { label: "Dump evidence", heat: -10, evidenceClear: true },
        { label: "Lay low", heat: -5 },
        { label: "Do nothing", heat: 0 },
      ],
    },
    {
      id: "af_change_clothes",
      text: "You pass a dumpster and a dark doorway. Easy place to swap layers.",
      choices: [
        { label: "Change clothes quickly", heat: -5, evidenceClear: true },
        { label: "Keep moving (no stop)", heat: 0 },
        { label: "Dump anything obvious", heat: -10, evidenceClear: true },
      ],
    },
    {
      id: "af_wash_hands",
      text: "A public restroom is open. Cameras might be there… but so is a sink.",
      choices: [
        { label: "Wash hands & tidy up", heat: -5, evidenceClear: true },
        { label: "Avoid it—keep moving", heat: 0 },
        { label: "Use it to blend in (risky)", heat: 0, evidenceRisk: true },
      ],
    },
    {
      id: "af_call_a_ride",
      text: "You could call a ride and vanish… but phones leave trails.",
      choices: [
        { label: "Call a ride anyway", heat: -5, usedCar: true, evidenceRisk: true },
        { label: "Walk it off", heat: -5 },
        { label: "Take side streets (quiet)", heat: -10 },
      ],
    },
    {
      id: "af_check_news",
      text: "You’re tempted to check social media—see if anyone posted about it.",
      choices: [
        { label: "Don’t touch the phone", heat: -5 },
        { label: "Quick check (risky)", heat: 5, evidenceRisk: true },
        { label: "Dump the SIM paranoia-style", heat: -10, evidenceClear: true },
      ],
    },
    {
      id: "af_meetup_spot",
      text: "A meetup spot is nearby. It’s safe… unless someone followed.",
      choices: [
        { label: "Go to meetup", heat: 0, witnessRisk: true },
        { label: "Lay low first", heat: -5 },
        { label: "Change route twice", heat: -10 },
      ],
    },
    {
      id: "af_bag_tears",
      text: "Your bag strap feels weak. If it snaps, you’ll leave a trail.",
      choices: [
        { label: "Repack and secure it", heat: 0, evidenceRisk: true },
        { label: "Dump loose items", heat: -5, evidenceClear: true },
        { label: "Keep moving fast", heat: 5, witnessRisk: true },
      ],
    },
    {
      id: "af_face_in_reflection",
      text: "You catch your face in a shop window reflection. Too identifiable?",
      choices: [
        { label: "Adjust hat/hood, keep moving", heat: -5 },
        { label: "Stop and swap outer layer", heat: -10, evidenceClear: true },
        { label: "Ignore it", heat: 0, evidenceRisk: true },
      ],
    },
    {
      id: "af_safehouse_choice",
      text: "You can go home… or you can go somewhere anonymous until things cool down.",
      choices: [
        { label: "Go somewhere anonymous", heat: -10 },
        { label: "Go home (risky)", heat: 0, evidenceRisk: true },
        { label: "Lay low nearby", heat: -5 },
      ],
    },
    {
      id: "af_dump_receipts",
      text: "You notice receipts and packaging mixed in with the loot. That’s traceable junk.",
      choices: [
        { label: "Dump it all", heat: -10, evidenceClear: true },
        { label: "Sort it later", heat: 0, evidenceRisk: true },
        { label: "Only dump obvious stuff", heat: -5, evidenceClear: true },
      ],
    },
    {
      id: "af_slow_breath",
      text: "You force yourself to breathe slower. Panic makes mistakes.",
      choices: [
        { label: "Slow down and blend", heat: -10 },
        { label: "Keep pace, stay alert", heat: -5 },
        { label: "Rush home", heat: 5, witnessRisk: true },
      ],
    },
    {
      id: "af_change_route",
      text: "You hear footsteps behind you. Might be nothing. Might be everything.",
      choices: [
        { label: "Change route twice", heat: -10 },
        { label: "Duck into a shop to blend", heat: 0, crowdBlend: true, evidenceRisk: true },
        { label: "Speed up and cut corners", heat: 5, witnessRisk: true },
      ],
    },
  ],
};
