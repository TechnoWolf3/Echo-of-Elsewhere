module.exports = {
  defaultDayCondition: {
    id: 'clear',
    name: 'Clear / Sunny',
    messages: {
      headline: 'Clear and stable conditions today.',
      forecast: 'No major weather events expected.',
      impact: 'Fields are operating at normal capacity.',
      reports: [
        'A quiet day on the weather front, giving farmers a solid window to plant, harvest, or prepare their land without interruption.',
        'Conditions are looking settled across the region, with no major fronts expected to trouble the paddocks today.',
      ],
    },
  },

  timeWindows: [
    { key: 'early_morning', label: 'early morning', startHour: 6, endHour: 9 },
    { key: 'late_morning', label: 'late morning', startHour: 9, endHour: 12 },
    { key: 'midday', label: 'midday', startHour: 11, endHour: 14 },
    { key: 'afternoon', label: 'the afternoon', startHour: 13, endHour: 17 },
    { key: 'late_afternoon', label: 'late afternoon', startHour: 15, endHour: 19 },
    { key: 'evening', label: 'the evening', startHour: 17, endHour: 21 },
  ],

  weatherTypes: {
    rain: {
      id: 'rain',
      name: 'Rain',
      severity: 'normal',
      durationHours: [3, 6],
      fieldImpactChance: 0.55,
      appliesTo: 'growing_or_newly_planted',
      cropEffect: {
        type: 'yield_bonus',
        label: 'Rain Boost',
        yieldMultiplier: 1.08,
        clearsOn: 'harvest',
      },
      messages: {
        headline: 'Clear skies early.',
        forecast: 'A light rain front is expected {window}.',
        impact: 'Some growing fields may receive a small harvest boost if touched by the rain.',
        reports: [
          'Farmers are welcoming the incoming showers, with conditions looking ideal for crop growth through the middle of the day.',
          'A passing rain band is expected to bring welcome moisture, with some crops likely to benefit if the timing lines up.',
        ],
      },
    },

    heatwave: {
      id: 'heatwave',
      name: 'Heatwave',
      severity: 'severe',
      durationHours: [3, 5],
      fieldImpactChance: 0.4,
      appliesTo: 'growing_or_newly_planted',
      cropEffect: {
        type: 'heat_stress',
        label: 'Heat Stress',
        yieldMultiplier: 0.88,
        clearsOn: 'harvest',
      },
      messages: {
        headline: 'Hot and dry conditions today.',
        forecast: 'A heatwave is expected around {window}.',
        impact: 'Some growing fields may suffer reduced harvests until collected.',
        reports: [
          'Authorities are warning of rising temperatures across the region. Crops already in the ground may struggle under the heat, and farmers are advised to keep a close eye on their fields.',
          'A sharp burst of heat is building through the district, and any fields caught in it could see stressed plants and lighter harvests.',
        ],
      },
    },

    storm: {
      id: 'storm',
      name: 'Storm',
      severity: 'severe',
      durationHours: [1, 3],
      fieldImpactChance: 0.3,
      appliesTo: 'all_fields',
      fieldEffect: {
        type: 'storm_damage',
        label: 'Storm Damage',
        usablePlotMultiplier: 0.75,
        requiresCultivation: true,
        clearsOn: 'cultivate',
      },
      messages: {
        headline: 'Calm conditions to start the day.',
        forecast: 'A storm front is expected {window}.',
        impact: 'Some fields may be damaged and require cultivation to restore full use.',
        reports: [
          'A fast-moving storm system is building strength and could hit later today. While not all farms will be affected, those in its path may need to rework their fields before planting again.',
          'Forecasters are tracking unstable conditions moving across the region, with a chance of field damage where the storm lands hardest.',
        ],
      },
    },

    frost: {
      id: 'frost',
      name: 'Frost',
      severity: 'normal',
      durationHours: [2, 4],
      fieldImpactChance: 0.35,
      appliesTo: 'growing_or_newly_planted',
      cropEffect: {
        type: 'frost_bite',
        label: 'Frost Bite',
        yieldMultiplier: 0.9,
        clearsOn: 'harvest',
      },
      messages: {
        headline: 'Cool conditions throughout the day.',
        forecast: 'A frost is expected around {window}.',
        impact: 'Some growing fields may suffer reduced harvests until collected.',
        reports: [
          'Temperatures are set to dip, with frost expected to settle across parts of the region. Sensitive crops could take a hit if the chill bites hard enough.',
          'A cold snap is building, and growers with vulnerable crops may want to brace for lighter yields after the frost passes.',
        ],
      },
    },
  },
};
