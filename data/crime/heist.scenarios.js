// data/crime/heist.scenarios.js
// Expanded to 8+ scenarios per phase to reduce repetition.
// Tuned for "hard but winnable" WITHOUT Theft Kit.
// Theft Kit should make "clean/spotted" runs noticeably more achievable.

module.exports = {
  // ----------------
  // SCOUT — low heat, planning phase
  // ----------------
  scout: [
    {
      id: "sc_shift_change",
      text: "You notice a brief staff overlap during shift change. Confusing, but busy.",
      choices: [
        { label: "Wait it out and observe", heat: -3 },
        { label: "Blend in nearby", heat: 2, maskless: true, camerasSeenYou: true },
        { label: "Move during the overlap", heat: 4, timeOverrun: true },
      ],
    },
    {
      id: "sc_camera_blindspot",
      text: "A side entrance might be in a camera blind spot — hard to tell from here.",
      choices: [
        { label: "Take note and proceed carefully", heat: 2 },
        { label: "Back off and rescope", heat: -4 },
        { label: "Assume the camera saw you", heat: 1, camerasSeenYou: true },
      ],
    },
    {
      id: "sc_police_patrols",
      text: "A patrol rolls by. Normal presence, nothing aggressive yet.",
      choices: [
        { label: "Pause and let them pass", heat: -5 },
        { label: "Proceed slowly", heat: 3 },
        { label: "Rush before they loop back", heat: 6, timeOverrun: true },
      ],
    },
    {
      id: "sc_delivery_window",
      text: "A delivery truck blocks a side view of the entrance for a moment.",
      choices: [
        { label: "Use the cover to reposition", heat: 1 },
        { label: "Wait for a better moment", heat: -4 },
        { label: "Move fast while blocked", heat: 5, timeOverrun: true },
      ],
    },
    {
      id: "sc_smoker_break",
      text: "An employee takes a smoke break near the side door.",
      choices: [
        { label: "Hold position until they leave", heat: -3 },
        { label: "Walk past like you belong", heat: 2, maskless: true, witnesses: true },
        { label: "Slip in behind them", heat: 6, camerasSeenYou: true },
      ],
    },
    {
      id: "sc_camera_sweep",
      text: "A camera does a slow motorized sweep across the lobby windows.",
      choices: [
        { label: "Time your movement between sweeps", heat: 2 },
        { label: "Stay still; let it pass", heat: -5 },
        { label: "Ignore it and go", heat: 4, camerasSeenYou: true },
      ],
    },
    {
      id: "sc_radio_chatter",
      text: "You hear faint radio chatter from inside — security is alert but not alarmed.",
      choices: [
        { label: "Adjust plan: slower and quieter", heat: -2 },
        { label: "Stick with plan", heat: 2 },
        { label: "Force the timeline", heat: 6, timeOverrun: true },
      ],
    },
    {
      id: "sc_loose_construction",
      text: "Construction scaffolding provides an alternate sightline to a side corridor.",
      choices: [
        { label: "Use it to map cameras", heat: -4 },
        { label: "Use it to get closer", heat: 3, camerasSeenYou: true },
        { label: "Climb quickly and commit", heat: 5, timeOverrun: true },
      ],
    },
  ],

  // ----------------
  // ENTRY — controlled risk
  // ----------------
  entry: [
    {
      id: "en_side_door",
      text: "The side door sticks slightly.",
      choices: [
        { label: "Work it patiently", heat: 3, timeOverrun: true },
        { label: "Force it quickly", heat: 8, alarmTriggered: true },
        { label: "Abort and reroute", heat: 4, routeSwapped: true },
      ],
    },
    {
      id: "en_lobby_presence",
      text: "A couple of late customers linger in the lobby.",
      choices: [
        { label: "Wait for a clear moment", heat: -4 },
        { label: "Mask up and move through", heat: 5 },
        { label: "Go maskless and blend", heat: 2, maskless: true, witnesses: true },
      ],
    },
    {
      id: "en_metal_detector",
      text: "A metal detector at the threshold beeps softly when someone passes.",
      choices: [
        { label: "Avoid it via side corridor", heat: 4, routeSwapped: true },
        { label: "Pass through carefully", heat: 7, camerasSeenYou: true },
        { label: "Disable quickly", heat: 11, timeOverrun: true, leftEvidence: true },
      ],
    },
    {
      id: "en_keypad_access",
      text: "A keypad guards a staff-only doorway.",
      choices: [
        { label: "Wait for someone to enter, then slip in", heat: 3, witnesses: true },
        { label: "Attempt a quick bypass", heat: 9, timeOverrun: true, leftEvidence: true },
        { label: "Pick an alternate route", heat: 5, routeSwapped: true },
      ],
    },
    {
      id: "en_security_greeting",
      text: "A security guard glances your way near the entrance.",
      choices: [
        { label: "Hold back and let them lose interest", heat: -2 },
        { label: "Nod and walk in confidently", heat: 3, maskless: true, camerasSeenYou: true },
        { label: "Commit fast before they react", heat: 9, witnesses: true },
      ],
    },
    {
      id: "en_employee_badge",
      text: "You spot an employee badge left on a counter near a side hallway.",
      choices: [
        { label: "Leave it — too risky", heat: -1 },
        { label: "Take it discreetly", heat: 4, leftEvidence: true },
        { label: "Use it immediately to access a door", heat: 7, camerasSeenYou: true },
      ],
    },
    {
      id: "en_cleaner_cart",
      text: "A cleaner cart sits unattended, blocking a camera angle.",
      choices: [
        { label: "Use the cover and move slowly", heat: 2 },
        { label: "Move the cart to create a path", heat: 5, witnesses: true },
        { label: "Rush while the angle is blocked", heat: 7, timeOverrun: true },
      ],
    },
    {
      id: "en_alarm_panel",
      text: "You find an alarm panel near the staff entrance.",
      choices: [
        { label: "Ignore it and proceed", heat: 2 },
        { label: "Try to disable (carefully)", heat: 8, timeOverrun: true, leftEvidence: true },
        { label: "Trip it and go loud", heat: 16, heatMajor: 22, alarmTriggered: true, shotsFired: true },
      ],
    },
  ],

  // ----------------
  // INSIDE — pressure begins
  // ----------------
  inside: [
    {
      id: "in_security_room",
      text: "You locate the security room controlling internal cameras.",
      choices: [
        { label: "Ignore it for now", heat: 2, camerasSeenYou: true },
        { label: "Jam cameras quickly", heat: 5, jammedCameras: true },
        { label: "Scrub footage (takes time)", heat: 6, timeOverrun: true, scrubbedFootage: true },
      ],
    },
    {
      id: "in_guard_pass",
      text: "Footsteps echo nearby — a guard doing rounds.",
      choices: [
        { label: "Hide and wait", heat: 3 },
        { label: "Talk your way past", heat: 2, maskless: true, witnesses: true },
        { label: "Neutralize quietly", heat: 11, leftEvidence: true },
      ],
    },
    {
      id: "in_camera_triangle",
      text: "Three cameras overlap in a corridor — a nasty triangle of coverage.",
      choices: [
        { label: "Time the sweep and slip through", heat: 5 },
        { label: "Take a longer route", heat: 4, routeSwapped: true },
        { label: "Sprint it", heat: 12, camerasSeenYou: true, timeOverrun: true },
      ],
    },
    {
      id: "in_civilian_close",
      text: "A civilian steps out of a hallway unexpectedly.",
      choices: [
        { label: "Freeze and let them pass", heat: 4, witnesses: true },
        { label: "Act normal and redirect them", heat: 6, maskless: true, witnesses: true },
        { label: "Threaten them to keep quiet", heat: 14, leftEvidence: true, witnesses: true },
      ],
    },
    {
      id: "in_lockbox_room",
      text: "A room of small lockboxes is within reach.",
      choices: [
        { label: "Skip it — stay focused", heat: -2 },
        { label: "Take a quick handful", heat: 8, lootAdd: 2500, lootAddMajor: 6000 },
        { label: "Clear the room", heat: 14, heatMajor: 20, timeOverrun: true, lootAdd: 5000, lootAddMajor: 12000 },
      ],
    },
    {
      id: "in_inside_man",
      text: "A message pings: an inside contact offers a shortcut… for a cut.",
      choices: [
        { label: "Decline; no loose ends", heat: -1 },
        { label: "Accept and move faster", heat: 6, insideMan: true, lootAdd: 2000, lootAddMajor: 8000 },
        { label: "Accept but double-cross", heat: 13, leftEvidence: true, witnesses: true },
      ],
    },
    {
      id: "in_back_office",
      text: "The back office has a safe and employee records on the desk.",
      choices: [
        { label: "Ignore it", heat: 0 },
        { label: "Crack the safe quickly", heat: 9, lootAdd: 3000, lootAddMajor: 7000 },
        { label: "Rummage for keys/IDs", heat: 6, leftEvidence: true },
      ],
    },
    {
      id: "in_floor_manager",
      text: "A floor manager appears, confused and suspicious.",
      choices: [
        { label: "Disappear and reroute", heat: 5, routeSwapped: true },
        { label: "Control the situation quietly", heat: 10, witnesses: true },
        { label: "Go loud to force compliance", heat: 18, heatMajor: 26, witnesses: true, shotsFired: true },
      ],
    },
  ],

  // ----------------
  // VAULT — major risk / reward
  // ----------------
  vault: [
    {
      id: "va_time_lock",
      text: "The vault is on a time lock.",
      choices: [
        { label: "Wait it out", heat: 7, timeOverrun: true, lootAdd: 4000, lootAddMajor: 12000 },
        { label: "Force it", heat: 17, heatMajor: 24, alarmTriggered: true, lootAdd: 3000 },
        { label: "Abort vault for side storage", heat: 5, lootAdd: 1500 },
      ],
    },
    {
      id: "va_laser_grid",
      text: "A laser grid hums faintly.",
      choices: [
        { label: "Carefully thread through", heat: 6, lootAdd: 2500, lootAddMajor: 7000 },
        { label: "Disable system", heat: 10, timeOverrun: true, lootAdd: 3500, lootAddMajor: 9000 },
        { label: "Trip it and rush", heat: 20, heatMajor: 30, alarmTriggered: true },
      ],
    },
    {
      id: "va_dual_auth",
      text: "A dual-auth lock demands two keys or codes.",
      choices: [
        { label: "Search quietly for the second code", heat: 8, timeOverrun: true },
        { label: "Brute force it", heat: 18, heatMajor: 25, leftEvidence: true, alarmTriggered: true },
        { label: "Bypass to a lesser vault", heat: 6, lootAdd: 2000, lootAddMajor: 5000 },
      ],
    },
    {
      id: "va_drill_noise",
      text: "A thermal drill will work, but the noise will carry.",
      choices: [
        { label: "Use it briefly, then pause", heat: 10, lootAdd: 2500, lootAddMajor: 6000 },
        { label: "Commit to drilling through", heat: 16, heatMajor: 22, timeOverrun: true, witnesses: true, lootAdd: 4500, lootAddMajor: 12000 },
        { label: "Don’t drill; take what’s accessible", heat: 4, lootAdd: 1200, lootAddMajor: 3000 },
      ],
    },
    {
      id: "va_gas_fail_safe",
      text: "A fail-safe can flood the vault corridor with gas if tampered with.",
      choices: [
        { label: "Proceed cautiously", heat: 7, timeOverrun: true },
        { label: "Disable the fail-safe", heat: 12, leftEvidence: true },
        { label: "Trigger it and rush", heat: 21, heatMajor: 30, alarmTriggered: true },
      ],
    },
    {
      id: "va_camera_core",
      text: "You reach the camera core near the vault corridor.",
      choices: [
        { label: "Leave it", heat: 3, camerasSeenYou: true },
        { label: "Jam cameras", heat: 6, jammedCameras: true },
        { label: "Scrub footage thoroughly", heat: 9, timeOverrun: true, scrubbedFootage: true },
      ],
    },
    {
      id: "va_guard_response",
      text: "A rapid response unit is moving internally — they’re closing in.",
      choices: [
        { label: "Hold position; stay silent", heat: 8 },
        { label: "Relocate route to stay ahead", heat: 10, routeSwapped: true },
        { label: "Fight through", heat: 22, heatMajor: 32, shotsFired: true, witnesses: true },
      ],
    },
    {
      id: "va_bag_limit",
      text: "You’re hitting the limit of what you can carry out cleanly.",
      choices: [
        { label: "Take only what you can hide", heat: 4, lootAdd: 1500, lootAddMajor: 4000 },
        { label: "Take one extra bag", heat: 9, lootAdd: 3500, lootAddMajor: 9000 },
        { label: "Stack bags and run", heat: 16, heatMajor: 22, witnesses: true, timeOverrun: true, lootAdd: 6000, lootAddMajor: 16000 },
      ],
    },
  ],

  // ----------------
  // LOOT — greed decisions
  // ----------------
  loot: [
    {
      id: "lo_second_pass",
      text: "You could grab more before leaving.",
      choices: [
        { label: "Leave now", heat: -1 },
        { label: "Quick extra grab", heat: 7, lootAdd: 3000, lootAddMajor: 7000 },
        { label: "Go all in", heat: 14, heatMajor: 20, timeOverrun: true, lootAdd: 6000, lootAddMajor: 16000 },
      ],
    },
    {
      id: "lo_heavy_bag",
      text: "One bag is heavy and awkward.",
      choices: [
        { label: "Dump some weight", heat: -3, lootAdd: -2000, lootAddMajor: -5000 },
        { label: "Carry it carefully", heat: 5, lootAdd: 1200, lootAddMajor: 3000 },
        { label: "Sprint with it", heat: 12, witnesses: true, lootAdd: 2500, lootAddMajor: 7000 },
      ],
    },
    {
      id: "lo_cash_vs_bonds",
      text: "You find a stash: easy cash or slower-to-move bonds.",
      choices: [
        { label: "Take cash only", heat: 6, lootAdd: 2500, lootAddMajor: 6000 },
        { label: "Take bonds too (slow)", heat: 11, timeOverrun: true, lootAdd: 5000, lootAddMajor: 13000 },
        { label: "Skip it to stay clean", heat: -2 },
      ],
    },
    {
      id: "lo_dye_pack_risk",
      text: "Some bundles might have dye packs. Hard to tell at a glance.",
      choices: [
        { label: "Avoid suspicious bundles", heat: 2, lootAdd: 1500, lootAddMajor: 4000 },
        { label: "Grab fast and hope", heat: 9, leftEvidence: true, lootAdd: 4500, lootAddMajor: 12000 },
        { label: "Take nothing extra", heat: -3 },
      ],
    },
    {
      id: "lo_vault_drawer",
      text: "A side drawer in the vault has small valuables and keys.",
      choices: [
        { label: "Take only keys", heat: 5, lootAdd: 1200, lootAddMajor: 3500 },
        { label: "Take everything", heat: 10, lootAdd: 3500, lootAddMajor: 9000 },
        { label: "Leave it", heat: -1 },
      ],
    },
    {
      id: "lo_employee_lockers",
      text: "Employee lockers sit unattended — quick gains, but messy.",
      choices: [
        { label: "Skip; don’t create a mess", heat: -1 },
        { label: "Hit a couple quickly", heat: 8, lootAdd: 2200, lootAddMajor: 5000, leftEvidence: true },
        { label: "Empty rows of lockers", heat: 14, heatMajor: 20, timeOverrun: true, lootAdd: 5000, lootAddMajor: 12000, leftEvidence: true },
      ],
    },
    {
      id: "lo_alarm_clock",
      text: "You hear a distant alarm clock — someone might be checking the back office soon.",
      choices: [
        { label: "Leave immediately", heat: -2 },
        { label: "Finish one more thing", heat: 7, timeOverrun: true, lootAdd: 2500, lootAddMajor: 6500 },
        { label: "Go loud and control the area", heat: 16, heatMajor: 24, witnesses: true, alarmTriggered: true },
      ],
    },
    {
      id: "lo_hidden_compartment",
      text: "You spot a hidden compartment behind a loose panel. It could be big… or nothing.",
      choices: [
        { label: "Ignore it", heat: -2 },
        { label: "Check it quickly", heat: 8, lootAdd: 3000, lootAddMajor: 8000 },
        { label: "Rip it open fast", heat: 12, leftEvidence: true, lootAdd: 4500, lootAddMajor: 12000 },
      ],
    },
  ],

  // ----------------
  // ESCAPE — most dangerous phase
  // ----------------
  escape: [
    {
      id: "es_exit_choice",
      text: "You reach the exit routes.",
      choices: [
        { label: "Back exit, slow and steady", heat: 5 },
        { label: "Front exit, fast", heat: 12, witnesses: true },
        { label: "Detour through alleys", heat: 9, routeSwapped: true },
      ],
    },
    {
      id: "es_siren_close",
      text: "A siren sounds nearby.",
      choices: [
        { label: "Blend in and walk", heat: 4, maskless: true },
        { label: "Cut through side streets", heat: 10, routeSwapped: true },
        { label: "Run hard", heat: 18, heatMajor: 26, witnesses: true },
      ],
    },
    {
      id: "es_getaway_car",
      text: "Your planned getaway car is visible — but so are a few cameras.",
      choices: [
        { label: "Take it and go", heat: 10, usedGetawayCar: true, camerasSeenYou: true },
        { label: "Walk away first, then circle back", heat: 7, routeSwapped: true },
        { label: "Ditch the car plan; go on foot", heat: 9, routeSwapped: true },
      ],
    },
    {
      id: "es_checkpoint",
      text: "A temporary checkpoint is forming two streets away.",
      choices: [
        { label: "Take side streets early", heat: 10, routeSwapped: true },
        { label: "Blend with civilians", heat: 6, maskless: true, witnesses: true },
        { label: "Punch through before it forms", heat: 18, heatMajor: 24, timeOverrun: true, witnesses: true },
      ],
    },
    {
      id: "es_witness_phone",
      text: "A witness is filming on their phone.",
      choices: [
        { label: "Back off and reroute", heat: 9, routeSwapped: true },
        { label: "Threaten them", heat: 16, heatMajor: 22, witnesses: true, leftEvidence: true },
        { label: "Disappear into a crowd", heat: 7, witnesses: true },
      ],
    },
    {
      id: "es_alarm_screech",
      text: "The alarm is blaring now — everything feels louder.",
      choices: [
        { label: "Keep calm and move steadily", heat: 9, alarmTriggered: true },
        { label: "Take a risky shortcut", heat: 14, heatMajor: 20, routeSwapped: true },
        { label: "Fire a warning shot", heat: 22, heatMajor: 30, shotsFired: true, witnesses: true },
      ],
    },
    {
      id: "es_rooftop_route",
      text: "A rooftop access door is unlocked. It’s a clean line — if you’re lucky.",
      choices: [
        { label: "Take rooftops carefully", heat: 11, routeSwapped: true, timeOverrun: true },
        { label: "Stay ground level", heat: 9 },
        { label: "Sprint rooftops and leap gaps", heat: 18, heatMajor: 26, witnesses: true },
      ],
    },
    {
      id: "es_shed_tools",
      text: "You can ditch tools and bags to run lighter — but it costs money.",
      choices: [
        { label: "Ditch tools now", heat: 6, ditchedTools: true, lootAdd: -2000, lootAddMajor: -6000 },
        { label: "Keep everything", heat: 11 },
        { label: "Dump one bag and run", heat: 8, lootAdd: -3500, lootAddMajor: -9000 },
      ],
    },
  ],

  // ----------------
  // CLEANUP — recovery phase
  // ----------------
  cleanUp: [
    {
      id: "cu_change_clothes",
      text: "You duck into cover and have a moment.",
      choices: [
        { label: "Change clothes", heat: -7, changedClothes: true },
        { label: "Keep moving", heat: 1 },
        { label: "Change and ditch tools", heat: -5, ditchedTools: true },
      ],
    },
    {
      id: "cu_dump_evidence",
      text: "You still have minor evidence on you.",
      choices: [
        { label: "Dump everything", heat: -9, ditchedTools: true },
        { label: "Dump some of it", heat: -3 },
        { label: "Keep it", heat: 3, leftEvidence: true },
      ],
    },
    {
      id: "cu_scrub_footage",
      text: "A contact offers to scrub security footage — but it takes time and focus.",
      choices: [
        { label: "Pay and scrub thoroughly", heat: 7, scrubbedFootage: true, timeOverrun: true },
        { label: "Skip it", heat: 2 },
        { label: "Quick partial scrub", heat: 5, scrubbedFootage: true },
      ],
    },
    {
      id: "cu_safehouse_wait",
      text: "You reach a safehouse. Waiting longer reduces attention, but eats time.",
      choices: [
        { label: "Lay low for a while", heat: -8 },
        { label: "Leave quickly", heat: 2 },
        { label: "Leave immediately and swap route", heat: 6, routeSwapped: true },
      ],
    },
    {
      id: "cu_vehicle_swap",
      text: "You can swap vehicles and plates, but it’s risky and time-consuming.",
      choices: [
        { label: "Swap vehicle/plates", heat: 8, routeSwapped: true, timeOverrun: true },
        { label: "Don’t risk it", heat: 2 },
        { label: "Quick swap and go", heat: 6, routeSwapped: true },
      ],
    },
    {
      id: "cu_wash_clothes",
      text: "You can wash clothes and gloves to reduce traces.",
      choices: [
        { label: "Do it properly", heat: 6, changedClothes: true, timeOverrun: true },
        { label: "Skip it", heat: 2 },
        { label: "Quick rinse and leave", heat: 4, changedClothes: true },
      ],
    },
    {
      id: "cu_dump_bag",
      text: "A bag could be ditched — it lowers risk but costs money.",
      choices: [
        { label: "Ditch the bag", heat: -6, lootAdd: -2500, lootAddMajor: -7000, ditchedTools: true },
        { label: "Keep it", heat: 3, leftEvidence: true },
        { label: "Split the contents and dump half", heat: -3, lootAdd: -1500, lootAddMajor: -4500 },
      ],
    },
    {
      id: "cu_contact_warning",
      text: "A contact warns that your description is circulating.",
      choices: [
        { label: "Change clothes and lay low", heat: 10, changedClothes: true, timeOverrun: true },
        { label: "Stay calm and keep moving", heat: 4 },
        { label: "Swap route and go dark", heat: 8, routeSwapped: true },
      ],
    },
  ],
};
