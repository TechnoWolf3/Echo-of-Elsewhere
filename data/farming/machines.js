module.exports = {
  // =========================
  // Tractors
  // =========================

  tractor_mf_4707: {
    id: "tractor_mf_4707",
    name: "Massey Ferguson 4707",
    brand: "Massey Ferguson",
    horsepower: 74,
    type: "tractor",
    tier: 1,
    buyPrice: 145000,
    rentPrice: 18000,
    taskSpeedMult: 1.0,
    requiredFor: ["cultivate", "seed"],
  },

  tractor_nh_t5_100: {
    id: "tractor_nh_t5_100",
    name: "New Holland T5.100",
    brand: "New Holland",
    horsepower: 99,
    type: "tractor",
    tier: 1,
    buyPrice: 185000,
    rentPrice: 22000,
    taskSpeedMult: 0.96,
    requiredFor: ["cultivate", "seed"],
  },

  tractor_jd_6120m: {
    id: "tractor_jd_6120m",
    name: "John Deere 6120M",
    brand: "John Deere",
    horsepower: 120,
    type: "tractor",
    tier: 2,
    buyPrice: 310000,
    rentPrice: 34000,
    taskSpeedMult: 0.88,
    requiredFor: ["cultivate", "seed", "fertilise"],
  },

  tractor_case_puma_165: {
    id: "tractor_case_puma_165",
    name: "Case IH Puma 165",
    brand: "Case IH",
    horsepower: 165,
    type: "tractor",
    tier: 2,
    buyPrice: 395000,
    rentPrice: 42000,
    taskSpeedMult: 0.84,
    requiredFor: ["cultivate", "seed", "fertilise"],
  },

  tractor_fendt_724: {
    id: "tractor_fendt_724",
    name: "Fendt 724 Vario",
    brand: "Fendt",
    horsepower: 240,
    type: "tractor",
    tier: 3,
    buyPrice: 610000,
    rentPrice: 62000,
    taskSpeedMult: 0.74,
    requiredFor: ["cultivate", "seed", "fertilise"],
  },

  tractor_jd_8r_280: {
    id: "tractor_jd_8r_280",
    name: "John Deere 8R 280",
    brand: "John Deere",
    horsepower: 280,
    type: "tractor",
    tier: 3,
    buyPrice: 760000,
    rentPrice: 76000,
    taskSpeedMult: 0.68,
    requiredFor: ["cultivate", "seed", "fertilise"],
  },

  // =========================
  // Cultivators
  // =========================

  cultivator_lemken_koralin_9: {
    id: "cultivator_lemken_koralin_9",
    name: "Lemken Koralin 9",
    brand: "Lemken",
    type: "cultivator",
    tier: 1,
    minHorsepower: 70,
    buyPrice: 65000,
    rentPrice: 7000,
    taskSpeedMult: 1.0,
    requiredFor: ["cultivate"],
  },

  cultivator_kuhn_cultimer_l300: {
    id: "cultivator_kuhn_cultimer_l300",
    name: "Kuhn Cultimer L 300",
    brand: "Kuhn",
    type: "cultivator",
    tier: 1,
    minHorsepower: 90,
    buyPrice: 89000,
    rentPrice: 9500,
    taskSpeedMult: 0.95,
    requiredFor: ["cultivate"],
  },

  cultivator_horsch_tiger_4mt: {
    id: "cultivator_horsch_tiger_4mt",
    name: "Horsch Tiger 4 MT",
    brand: "Horsch",
    type: "cultivator",
    tier: 2,
    minHorsepower: 150,
    buyPrice: 155000,
    rentPrice: 15500,
    taskSpeedMult: 0.85,
    requiredFor: ["cultivate"],
  },

  cultivator_kuhn_performer_4000: {
    id: "cultivator_kuhn_performer_4000",
    name: "Kuhn Performer 4000",
    brand: "Kuhn",
    type: "cultivator",
    tier: 2,
    minHorsepower: 180,
    buyPrice: 205000,
    rentPrice: 19500,
    taskSpeedMult: 0.8,
    requiredFor: ["cultivate"],
  },

  cultivator_horsch_tiger_6lt: {
    id: "cultivator_horsch_tiger_6lt",
    name: "Horsch Tiger 6 LT",
    brand: "Horsch",
    type: "cultivator",
    tier: 3,
    minHorsepower: 240,
    buyPrice: 315000,
    rentPrice: 29000,
    taskSpeedMult: 0.72,
    requiredFor: ["cultivate"],
  },

  // =========================
  // Seeders
  // =========================

  seeder_great_plains_3p1006nt: {
    id: "seeder_great_plains_3p1006nt",
    name: "Great Plains 3P1006NT",
    brand: "Great Plains",
    type: "seeder",
    tier: 1,
    minHorsepower: 75,
    buyPrice: 85000,
    rentPrice: 8500,
    taskSpeedMult: 1.0,
    requiredFor: ["seed"],
  },

  seeder_maschio_gaspardo_nina_300: {
    id: "seeder_maschio_gaspardo_nina_300",
    name: "Maschio Gaspardo Nina 300",
    brand: "Maschio Gaspardo",
    type: "seeder",
    tier: 1,
    minHorsepower: 95,
    buyPrice: 110000,
    rentPrice: 10500,
    taskSpeedMult: 0.94,
    requiredFor: ["seed"],
  },

  seeder_horsch_pronto_6dc: {
    id: "seeder_horsch_pronto_6dc",
    name: "Horsch Pronto 6 DC",
    brand: "Horsch",
    type: "seeder",
    tier: 2,
    minHorsepower: 140,
    buyPrice: 235000,
    rentPrice: 22000,
    taskSpeedMult: 0.82,
    requiredFor: ["seed"],
  },

  seeder_amazone_cirrus_6003: {
    id: "seeder_amazone_cirrus_6003",
    name: "Amazone Cirrus 6003-2",
    brand: "Amazone",
    type: "seeder",
    tier: 2,
    minHorsepower: 170,
    buyPrice: 295000,
    rentPrice: 26500,
    taskSpeedMult: 0.78,
    requiredFor: ["seed"],
  },

  seeder_jd_1890: {
    id: "seeder_jd_1890",
    name: "John Deere 1890 Air Drill",
    brand: "John Deere",
    type: "seeder",
    tier: 3,
    minHorsepower: 240,
    buyPrice: 465000,
    rentPrice: 39000,
    taskSpeedMult: 0.68,
    requiredFor: ["seed"],
  },

  // =========================
  // Sprayers
  // =========================

  sprayer_hardi_navigator_3000: {
    id: "sprayer_hardi_navigator_3000",
    name: "Hardi Navigator 3000",
    brand: "Hardi",
    type: "sprayer",
    tier: 1,
    minHorsepower: 70,
    buyPrice: 78000,
    rentPrice: 8000,
    taskSpeedMult: 1.0,
    requiredFor: ["fertilise"],
  },

  sprayer_kuhn_deltis_1302: {
    id: "sprayer_kuhn_deltis_1302",
    name: "Kuhn Deltis 1302",
    brand: "Kuhn",
    type: "sprayer",
    tier: 1,
    minHorsepower: 90,
    buyPrice: 108000,
    rentPrice: 10200,
    taskSpeedMult: 0.94,
    requiredFor: ["fertilise"],
  },

  sprayer_amazone_ux_4201: {
    id: "sprayer_amazone_ux_4201",
    name: "Amazone UX 4201",
    brand: "Amazone",
    type: "sprayer",
    tier: 2,
    minHorsepower: 140,
    buyPrice: 215000,
    rentPrice: 19500,
    taskSpeedMult: 0.82,
    requiredFor: ["fertilise"],
  },

  sprayer_hardi_rubicon_9000: {
    id: "sprayer_hardi_rubicon_9000",
    name: "Hardi Rubicon 9000",
    brand: "Hardi",
    type: "sprayer",
    tier: 3,
    minHorsepower: 220,
    buyPrice: 410000,
    rentPrice: 34500,
    taskSpeedMult: 0.7,
    requiredFor: ["fertilise"],
  },

  // =========================
  // Harvesters
  // =========================

  harvester_deutz_5465h: {
    id: "harvester_deutz_5465h",
    name: "Deutz-Fahr 5465 H",
    brand: "Deutz-Fahr",
    type: "harvester",
    tier: 1,
    minHorsepower: 150,
    buyPrice: 285000,
    rentPrice: 26000,
    taskSpeedMult: 1.0,
    requiredFor: ["harvest"],
  },

  harvester_nh_tc5_90: {
    id: "harvester_nh_tc5_90",
    name: "New Holland TC5.90",
    brand: "New Holland",
    type: "harvester",
    tier: 1,
    minHorsepower: 175,
    buyPrice: 345000,
    rentPrice: 31000,
    taskSpeedMult: 0.94,
    requiredFor: ["harvest"],
  },

  harvester_case_5140: {
    id: "harvester_case_5140",
    name: "Case IH Axial-Flow 5140",
    brand: "Case IH",
    type: "harvester",
    tier: 2,
    minHorsepower: 220,
    buyPrice: 590000,
    rentPrice: 47000,
    taskSpeedMult: 0.82,
    requiredFor: ["harvest"],
  },

  harvester_jd_t550: {
    id: "harvester_jd_t550",
    name: "John Deere T550",
    brand: "John Deere",
    type: "harvester",
    tier: 2,
    minHorsepower: 245,
    buyPrice: 675000,
    rentPrice: 54000,
    taskSpeedMult: 0.78,
    requiredFor: ["harvest"],
  },

  harvester_claas_lexion_7700: {
    id: "harvester_claas_lexion_7700",
    name: "CLAAS LEXION 7700",
    brand: "CLAAS",
    type: "harvester",
    tier: 3,
    minHorsepower: 280,
    buyPrice: 980000,
    rentPrice: 78000,
    taskSpeedMult: 0.68,
    requiredFor: ["harvest"],
  },
};