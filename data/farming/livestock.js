module.exports = {
  dairy_cows: {
    id: "dairy_cows",
    name: "Dairy Barn",
    animalName: "Dairy cows",
    convertCost: 280000,
    levelRequired: 1,
    capacityBase: 6,
    productionHours: 6,
    output: { itemId: "farm_milk", name: "Milk", min: 8, max: 14 },
    slaughter: { itemId: "farm_beef", name: "Beef", minPerAnimal: 4, maxPerAnimal: 7 },
  },

  chickens: {
    id: "chickens",
    name: "Chicken Coop",
    animalName: "Chickens",
    convertCost: 180000,
    levelRequired: 1,
    capacityBase: 18,
    productionHours: 4,
    output: { itemId: "farm_eggs", name: "Eggs", min: 12, max: 24 },
    slaughter: { itemId: "farm_chicken", name: "Chicken Meat", minPerAnimal: 1, maxPerAnimal: 2 },
  },

  sheep: {
    id: "sheep",
    name: "Sheep Barn",
    animalName: "Sheep",
    convertCost: 240000,
    levelRequired: 1,
    capacityBase: 10,
    productionHours: 8,
    output: { itemId: "farm_wool", name: "Wool", min: 6, max: 12 },
    slaughter: { itemId: "farm_mutton", name: "Mutton", minPerAnimal: 2, maxPerAnimal: 4 },
  },
};
