// data/features/categories/enterprises.js
module.exports = {
  id: "enterprises",
  order: 5,
  name: "Enterprises",
  emoji: "🏢",
  blurb: "Move beyond wages and start building something bigger.",
  description:
    "Enterprises are long-term progression systems for players who want ownership, reinvestment, and slower strategic earning paths. Farming is the current enterprise, with land, crops, machinery, barns, weather, and market selling all feeding into one operation.",

  items: [
    {
      id: "enterprise_overview",
      name: "Enterprise System",
      short: "Long-term ownership paths with room to grow.",
      detail:
        "Enterprises push the economy beyond one-off jobs and gambling by giving players something bigger to build over time.\n\n" +
        "The focus is reinvestment: players can take money earned elsewhere and turn it into land, equipment, production capacity, and future earning potential.\n\n" +
        "Enterprise systems still connect back into the wider economy through wallets, banks, inventory items, markets, contracts, and progression costs.",
    },
    {
      id: "farm_overview",
      name: "Farming Overview",
      short: "A strategic land, crop, livestock, and machinery enterprise.",
      detail:
        "Farming lives under **/job** -> **Enterprises** and is designed as a slower, more deliberate earning path.\n\n" +
        "Players buy fields, cultivate land, plant seasonal crops, wait through growth timers, harvest produce, sell through the Farm Market, and reinvest into more fields, higher levels, machines, fertiliser, barns, and livestock.\n\n" +
        "The farming hub shows a clean overview of plots, barns, active work, crop status, weather, and market/store/machine navigation.",
    },
    {
      id: "farm_fields_crops",
      name: "Farming - Fields & Crops",
      short: "Buy land, cultivate fields, plant crops, harvest, and upgrade.",
      detail:
        "Fields are the core crop-growing plots. Players can buy up to the configured field limit, then cultivate empty land before planting.\n\n" +
        "Crops are level-gated and season-gated. Higher field levels unlock stronger crops, larger plot sizes, and higher yield potential.\n\n" +
        "Field actions such as cultivating, seeding, harvesting, fertilising, and upgrading are timed tasks. A field can only run one task at a time, and field upgrades only apply when the upgrade task completes.",
    },
    {
      id: "farm_weather_seasons",
      name: "Farming - Seasons, Weather & Conditions",
      short: "Weekly seasons and weather can change crop choices and field outcomes.",
      detail:
        "Farming uses rotating seasons, so available crops change over time. A crop must be valid for the current season before it can be planted.\n\n" +
        "The Weather Channel on the farming hub explains current conditions. Clear weather is neutral, rain can help yields, heatwaves and frost can reduce crop output, and storms can damage fields.\n\n" +
        "Field detail pages show active crop effects and field conditions so players can see whether a plot is healthy, damaged, ready, growing, spoiled, or in need of cleanup.",
    },
    {
      id: "farm_store_fertiliser",
      name: "Farming - Store & Fertiliser",
      short: "Buy fertiliser and apply it during crop growth windows.",
      detail:
        "The Farm Store is a category hub for farming supplies. It currently stocks Fertiliser and Animal Husbandry items.\n\n" +
        "Fertiliser is bought through a select-to-modal quantity flow and stored on the farm. It can be applied only while a crop is growing: during the first 10% of the growth cycle or after 75% growth, before the crop is ready.\n\n" +
        "Fertiliser can reduce remaining growth time, increase yield, or provide a smaller mix of both depending on the item.",
    },
    {
      id: "farm_machine_shed",
      name: "Farming - Machine Shed",
      short: "Buy, rent, sell, and reserve machinery for field tasks.",
      detail:
        "The Machine Shed handles the equipment side of farming. Players can buy, rent, or sell machines from categories such as tractors, cultivators, seeders, harvesters, and other task equipment.\n\n" +
        "Field work requires compatible machinery. Owned and rented machines can be reserved by active tasks, so busy equipment cannot be reused until the task completes.\n\n" +
        "Rentals are short-term, purchases are permanent, and selling owned free machines returns part of the buy price.",
    },
    {
      id: "farm_barns_livestock",
      name: "Farming - Barns & Livestock",
      short: "Convert fields into barns for chickens, sheep, or dairy cows.",
      detail:
        "Players can convert an empty cultivated field into any available barn type: Chicken Coop, Sheep Barn, or Dairy Barn.\n\n" +
        "Converting a field into a barn resets the new barn to level 1. Demolishing a barn back into a field also resets the resulting field to level 1, making conversion choices meaningful.\n\n" +
        "Barns produce over time from adult animals only. Players can collect produce, slaughter the stock for meat outputs, restock an empty barn, upgrade the barn, or demolish it back into a field.",
    },
    {
      id: "farm_husbandry_breeding",
      name: "Farming - Animal Husbandry & Breeding",
      short: "Use husbandry items to breed livestock and grow animal counts.",
      detail:
        "Animal Husbandry items are bought from the Farm Store and used from matching barn pages.\n\n" +
        "Breeding requires the matching item, at least two adult animals, and enough free barn capacity. It adds young animals such as chicks, lambs, or calves.\n\n" +
        "Young animals count toward barn capacity but do not produce until they mature. Barn level increases capacity, which lets players hold more animals and earn more produce once the animals are adults.\n\n" +
        "Barn upgrades are timed tasks. Animals remain inside, but production pauses until the upgrade completes.",
    },
    {
      id: "farm_market_contracts",
      name: "Farming - Market & Contracts",
      short: "Sell farm outputs and feed progress into farming contracts.",
      detail:
        "Harvested crops and barn outputs are stored as inventory items. The Farm Market lists sellable farm items with seasonal market pricing and lets players sell their stock.\n\n" +
        "Farming also contributes to contract progress. Planting can count as field work, while harvested crop quantities and barn output quantities feed the farming harvest metric.\n\n" +
        "This ties the long-term farm loop back into the wider economy and contract systems.",
    },
  ],
};
