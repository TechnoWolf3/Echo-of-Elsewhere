module.exports = {
  police_checkpoint: {
    id: "police_checkpoint",
    label: "Police Checkpoint",
    description: "A line of lights blooms ahead. The route suddenly feels very interested in you.",
    options: [
      { id: "back_roads", label: "Take Back Roads", riskDelta: -0.08, durationMultiplier: 1.15, suspicionDelta: -2 },
      { id: "blend_in", label: "Blend In", riskDelta: -0.02 },
      { id: "push_through", label: "Push Through", riskDelta: 0.1, durationMultiplier: 0.9, suspicionDelta: 3 },
    ],
    ignored: {},
  },
  urgent_buyer: {
    id: "urgent_buyer",
    label: "Urgent Buyer",
    description: "A buyer offers extra if you move faster and ask fewer questions.",
    options: [
      { id: "accept", label: "Accept Rush", payoutMultiplier: 1.12, riskDelta: 0.07, suspicionDelta: 3 },
      { id: "decline", label: "Decline", riskDelta: 0 },
    ],
    ignored: {},
  },
  vehicle_rattle: {
    id: "vehicle_rattle",
    label: "Vehicle Rattle",
    description: "The vehicle makes a noise vehicles should not legally be allowed to make.",
    options: [
      { id: "patch", label: "Stop And Patch It", damageDelta: -4, durationMultiplier: 1.12 },
      { id: "keep_moving", label: "Keep Moving", damageDelta: 4, durationMultiplier: 0.95 },
    ],
    ignored: {},
  },
  clean_route_tip: {
    id: "clean_route_tip",
    label: "Clean Route Tip",
    description: "A contact sends a quiet road and a quieter warning.",
    options: [
      { id: "take_tip", label: "Take The Tip", riskDelta: -0.1, suspicionDelta: -3, durationMultiplier: 1.05 },
      { id: "ignore", label: "Ignore", riskDelta: 0 },
    ],
    ignored: {},
  },
  bribe_contact: {
    id: "bribe_contact",
    label: "Bribe Contact",
    description: "A contact can smooth the route for a price.",
    options: [
      { id: "pay", label: "Pay Bribe", costFlat: 55000, riskDelta: -0.12, suspicionDelta: -2 },
      { id: "refuse", label: "Refuse", riskDelta: 0 },
    ],
    ignored: {},
  },
  sketchy_buyer: {
    id: "sketchy_buyer",
    label: "Sketchy Buyer",
    description: "The buyer pays too much attention to exits. Professional. Terrifying.",
    options: [
      { id: "walk", label: "Walk Away", payoutMultiplier: 0.96, riskDelta: -0.08 },
      { id: "push", label: "Push The Sale", payoutMultiplier: 1.16, riskDelta: 0.14, suspicionDelta: 4 },
    ],
    ignored: {},
  },
};
