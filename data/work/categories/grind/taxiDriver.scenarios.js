module.exports = {
  easy: [
    "A tired nurse flags you down after a long shift.",
    "A tourist holding a folded city map waves from the curb.",
    "A university student hurries over with a backpack slung on one shoulder.",
    "An office worker steps out of a lobby checking the time on their phone.",
    "A grocery shopper loads a few bags into the back seat.",
    "A suburban dad asks for a quick ride home from the train station.",
    "A quiet barista asks for a lift back across town.",
    "A museum visitor wants a simple ride to their hotel.",
    "A librarian gives you a polite wave from outside the bus stop.",
    "A couple coming from dinner ask for a calm trip home.",
  ],
  vip: [
    "A well dressed businessman waves you down outside a luxury hotel.",
    "A casino high roller steps out with two security guards watching from the door.",
    "A celebrity in sunglasses slips into the back seat and asks to keep moving.",
    "A wealthy tourist with designer luggage offers extra for speed.",
    "A business executive leaves a waterfront event and asks for discretion.",
    "A private party guest in formalwear asks for a smooth ride to the penthouse district.",
    "A social media star slides into the back seat with a hurry-up attitude.",
    "A jewellery buyer from the casino precinct offers a fat fare if you do not waste time.",
  ],
  sketchy: [
    "A hooded stranger asks for an alley drop-off and keeps looking over their shoulder.",
    "A drunk clubgoer stumbles into the back seat smelling like cheap vodka.",
    "A nervous passenger insists you keep driving before they name the destination.",
    "A masked rider taps on the window and asks if you take cash only.",
    "A fidgety passenger wants to be dropped behind a shuttered pawn shop.",
    "A twitchy rider slides in, says 'no questions', and points toward the industrial blocks.",
    "A homeless man with a duffel bag promises he can pay when he gets there.",
    "A passenger in a stained suit asks you not to use the main roads tonight.",
  ],
  routeIntros: [
    "They mumble directions fast and expect you to keep up.",
    "You glance in the mirror as they start barking out turns.",
    "The passenger points ahead and rattles off a route from memory.",
    "They lean forward between the seats and give you a rapid set of turns.",
  ],
  declineLines: [
    "You shake your head and the fare moves on to the next cab.",
    "You pass on the fare and keep the meter idle for another minute.",
    "You decide it is not worth the trouble and drive past.",
    "You decline the job and wait for a better fare.",
  ],
  completeLines: {
    easy: [
      "A clean, quiet fare. Exactly the kind of ride you want on shift.",
      "Easy money. No drama, no mess, no nonsense.",
      "The passenger thanks you, pays up, and heads inside.",
    ],
    vip: [
      "A premium fare with premium money attached.",
      "Smooth driving. The kind of ride that keeps your stars up.",
      "They barely say thanks, but the payout does the talking.",
    ],
    sketchy: [
      "For once, the weird fare actually pays like promised.",
      "They slide out of the cab and toss the money in without argument.",
      "The ride felt cursed, but the cash at least looked real.",
    ],
  },
  wrongTurnLines: [
    "You miss the turn and the passenger blows up, storms out, and refuses to pay.",
    "Wrong street. Wrong mood. The fare bails on the ride and you get nothing.",
    "One bad turn and the passenger is done with you. No payout.",
  ],
  sketchyOutcomes: {
    noPay: [
      "At the destination they shrug, laugh, and walk off without paying.",
      "The rider disappears the moment the door opens. Not a dollar left behind.",
    ],
    pukeFee: [
      "They throw up all over the back seat. You eat a nasty cleaning bill.",
      "The passenger paints the interior. The cab is a biohazard until you clean it.",
    ],
    reducedShift: [
      "They spew across the floor mats. The smell kills your tips for the rest of the shift.",
      "The rider leaves your taxi rancid. Every fare after this feels lighter on the wallet.",
    ],
    robbery: [
      "Before they leave, they snatch your last fare's cash and bolt into the dark.",
      "The rider shoves your arm aside, grabs your recent earnings, and runs.",
    ],
    runAway: [
      "They slam the door and sprint off down a side lane before you can react.",
      "You barely stop before they are out and gone. Fare skipped.",
    ],
    normal: [
      "Somehow, the sketchy fare actually pays you properly.",
      "Against all odds, they count out the cash and leave without trouble.",
    ],
  },
  vipEvents: {
    tip: [
      "The passenger leaves a heavy tip for keeping it smooth.",
      "A crisp extra note lands on the centre console. Nice.",
    ],
    double: [
      "They liked the service so much they doubled the fare on the spot.",
      "VIP treatment recognised. They pay far above the meter.",
    ],
    escape: [
      "Halfway through, they tell you to lose a tail and sweeten the deal if you do.",
      "A black SUV lingers a little too long behind you. Your passenger offers more to keep moving.",
    ],
  },
};
