module.exports = [
  {
    id: "basic_debris",
    title: "Clear Debris",
    tasks: ["clear_debris"],
    sizes: ["small", "medium"],
    weight: 10
  },

  {
    id: "prep_and_seed",
    title: "Prepare & Seed Field",
    tasks: ["clear_debris", "plow", "seed"],
    sizes: ["medium", "large"],
    weight: 7
  },

  {
    id: "harvest_job",
    title: "Harvest Crop",
    tasks: ["harvest"],
    sizes: ["medium", "large"],
    weight: 9
  }
];