// data/features/categories/farming.js
module.exports = {
  id: "farming",
  order: 4,
  name: "Farming",
  emoji: "🌾",
  blurb: "Buy land, work the seasons, watch the sky, and build a harvest empire.",
  description:
    "Farming turns land, machinery, weather, and timing into a full progression system. Players can buy fields, manage crops, deal with changing conditions, and turn careful planning into serious profit.",

  items: [
    {
      id: "farm_overview",
      name: "🚜 Farm System",
      short: "A long-term grow, harvest, and reinvest progression path.",
      detail:
        "Farming gives players a more strategic earning path built around planning instead of instant payouts.\n\n" +
        "Plant your fields, watch the conditions, wait for the crop cycle to play out, then harvest and reinvest. It is designed to feel like something you build up over time rather than spam in one sitting.",
    },
    {
      id: "fields_and_ownership",
      name: "🧾 Fields & Ownership",
      short: "Buy your own land and expand plot by plot.",
      detail:
        "Players can purchase fields and grow their farm over time, turning land ownership into a proper progression target.\n\n" +
        "More fields means more potential income, but also more planning, more crop exposure, and more reason to keep an eye on the forecast.",
    },
    {
      id: "machinery",
      name: "🛠 Machinery",
      short: "Buy or rent the gear needed to keep the farm moving.",
      detail:
        "Machinery is part of the farming loop too. Players can buy or rent equipment depending on how established they are and how much they want to invest up front.\n\n" +
        "That creates a nice balance between accessibility for newer players and long-term value for players building a bigger operation.",
    },
    {
      id: "seasons",
      name: "🍂 Weekly Seasons",
      short: "The season changes regularly, pushing different planting decisions.",
      detail:
        "Farming runs on a rotating seasonal structure, with seasons changing weekly.\n\n" +
        "That means crop choices are not static forever. What works well one week may not be the smart play the next, keeping the system fresh and encouraging players to adapt.",
    },
    {
      id: "weather_and_events",
      name: "⛅ Weather, Storms & Heatwaves",
      short: "Short weather events can help or hurt fields depending on timing.",
      detail:
        "Weather plays a direct role in the farming loop. Rain can boost the right fields, while storms and heatwaves can reduce returns or damage crops.\n\n" +
        "These weather events are not just cosmetic. They create real moments of opportunity and risk, especially when players time their harvests and replanting well.",
    },
    {
      id: "weather_channel",
      name: "📺 Weather Channel",
      short: "A farm forecast panel that warns players what the day may bring.",
      detail:
        "The farming homepage includes a weather report so players can see what conditions are building before they commit.\n\n" +
        "Instead of raw stats only, it is presented like a proper forecast update, giving the system flavour while still warning players about incoming rain, storms, or harsh heat.",
    },
  ],
};
