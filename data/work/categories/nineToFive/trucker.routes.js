const BASE_ROUTES = [
  { from: ["Brisbane", "Queensland"], to: ["Sydney", "New South Wales"], distanceKm: 917 },
  { from: ["Brisbane", "Queensland"], to: ["Toowoomba", "Queensland"], distanceKm: 127 },
  { from: ["Brisbane", "Queensland"], to: ["Rockhampton", "Queensland"], distanceKm: 636 },
  { from: ["Brisbane", "Queensland"], to: ["Bundaberg", "Queensland"], distanceKm: 361 },
  { from: ["Brisbane", "Queensland"], to: ["Gladstone", "Queensland"], distanceKm: 525 },
  { from: ["Brisbane", "Queensland"], to: ["Townsville", "Queensland"], distanceKm: 1348 },
  { from: ["Brisbane", "Queensland"], to: ["Cairns", "Queensland"], distanceKm: 1697 },
  { from: ["Brisbane", "Queensland"], to: ["Mackay", "Queensland"], distanceKm: 973 },
  { from: ["Brisbane", "Queensland"], to: ["Mount Isa", "Queensland"], distanceKm: 1822 },
  { from: ["Brisbane", "Queensland"], to: ["Roma", "Queensland"], distanceKm: 478 },
  { from: ["Brisbane", "Queensland"], to: ["Dubbo", "New South Wales"], distanceKm: 856 },
  { from: ["Brisbane", "Queensland"], to: ["Newcastle", "New South Wales"], distanceKm: 792 },

  { from: ["Sydney", "New South Wales"], to: ["Melbourne", "Victoria"], distanceKm: 878 },
  { from: ["Sydney", "New South Wales"], to: ["Canberra", "ACT"], distanceKm: 286 },
  { from: ["Sydney", "New South Wales"], to: ["Newcastle", "New South Wales"], distanceKm: 161 },
  { from: ["Sydney", "New South Wales"], to: ["Wollongong", "New South Wales"], distanceKm: 84 },
  { from: ["Sydney", "New South Wales"], to: ["Bathurst", "New South Wales"], distanceKm: 200 },
  { from: ["Sydney", "New South Wales"], to: ["Orange", "New South Wales"], distanceKm: 255 },
  { from: ["Sydney", "New South Wales"], to: ["Dubbo", "New South Wales"], distanceKm: 396 },
  { from: ["Sydney", "New South Wales"], to: ["Wagga Wagga", "New South Wales"], distanceKm: 456 },
  { from: ["Sydney", "New South Wales"], to: ["Tamworth", "New South Wales"], distanceKm: 413 },
  { from: ["Sydney", "New South Wales"], to: ["Coffs Harbour", "New South Wales"], distanceKm: 540 },
  { from: ["Sydney", "New South Wales"], to: ["Albury", "New South Wales"], distanceKm: 553 },
  { from: ["Sydney", "New South Wales"], to: ["Adelaide", "South Australia"], distanceKm: 1375 },
  { from: ["Sydney", "New South Wales"], to: ["Brisbane", "Queensland"], distanceKm: 917, bidirectional: false },

  { from: ["Melbourne", "Victoria"], to: ["Geelong", "Victoria"], distanceKm: 75 },
  { from: ["Melbourne", "Victoria"], to: ["Ballarat", "Victoria"], distanceKm: 115 },
  { from: ["Melbourne", "Victoria"], to: ["Bendigo", "Victoria"], distanceKm: 154 },
  { from: ["Melbourne", "Victoria"], to: ["Shepparton", "Victoria"], distanceKm: 181 },
  { from: ["Melbourne", "Victoria"], to: ["Mildura", "Victoria"], distanceKm: 541 },
  { from: ["Melbourne", "Victoria"], to: ["Albury", "New South Wales"], distanceKm: 328 },
  { from: ["Melbourne", "Victoria"], to: ["Canberra", "ACT"], distanceKm: 663 },
  { from: ["Melbourne", "Victoria"], to: ["Adelaide", "South Australia"], distanceKm: 727 },
  { from: ["Melbourne", "Victoria"], to: ["Port Augusta", "South Australia"], distanceKm: 1035 },
  { from: ["Melbourne", "Victoria"], to: ["Perth", "Western Australia"], distanceKm: 3332 },
  { from: ["Melbourne", "Victoria"], to: ["Mount Gambier", "South Australia"], distanceKm: 443 },
  { from: ["Melbourne", "Victoria"], to: ["Horsham", "Victoria"], distanceKm: 299 },
  { from: ["Melbourne", "Victoria"], to: ["Traralgon", "Victoria"], distanceKm: 162 },

  { from: ["Adelaide", "South Australia"], to: ["Port Augusta", "South Australia"], distanceKm: 306 },
  { from: ["Adelaide", "South Australia"], to: ["Whyalla", "South Australia"], distanceKm: 395 },
  { from: ["Adelaide", "South Australia"], to: ["Ceduna", "South Australia"], distanceKm: 780 },
  { from: ["Adelaide", "South Australia"], to: ["Mildura", "Victoria"], distanceKm: 399 },
  { from: ["Adelaide", "South Australia"], to: ["Broken Hill", "New South Wales"], distanceKm: 516 },
  { from: ["Adelaide", "South Australia"], to: ["Alice Springs", "Northern Territory"], distanceKm: 1532 },
  { from: ["Adelaide", "South Australia"], to: ["Darwin", "Northern Territory"], distanceKm: 3025 },
  { from: ["Adelaide", "South Australia"], to: ["Perth", "Western Australia"], distanceKm: 2697 },
  { from: ["Adelaide", "South Australia"], to: ["Mount Gambier", "South Australia"], distanceKm: 436 },

  { from: ["Perth", "Western Australia"], to: ["Bunbury", "Western Australia"], distanceKm: 175 },
  { from: ["Perth", "Western Australia"], to: ["Geraldton", "Western Australia"], distanceKm: 424 },
  { from: ["Perth", "Western Australia"], to: ["Kalgoorlie", "Western Australia"], distanceKm: 592 },
  { from: ["Perth", "Western Australia"], to: ["Albany", "Western Australia"], distanceKm: 415 },
  { from: ["Perth", "Western Australia"], to: ["Esperance", "Western Australia"], distanceKm: 721 },
  { from: ["Perth", "Western Australia"], to: ["Karratha", "Western Australia"], distanceKm: 1535 },
  { from: ["Perth", "Western Australia"], to: ["Port Hedland", "Western Australia"], distanceKm: 1624 },
  { from: ["Perth", "Western Australia"], to: ["Broome", "Western Australia"], distanceKm: 2225 },
  { from: ["Perth", "Western Australia"], to: ["Adelaide", "South Australia"], distanceKm: 2697, bidirectional: false },

  { from: ["Darwin", "Northern Territory"], to: ["Katherine", "Northern Territory"], distanceKm: 317 },
  { from: ["Darwin", "Northern Territory"], to: ["Tennant Creek", "Northern Territory"], distanceKm: 989 },
  { from: ["Darwin", "Northern Territory"], to: ["Alice Springs", "Northern Territory"], distanceKm: 1498 },
  { from: ["Darwin", "Northern Territory"], to: ["Mount Isa", "Queensland"], distanceKm: 1702 },
  { from: ["Darwin", "Northern Territory"], to: ["Townsville", "Queensland"], distanceKm: 2810 },
  { from: ["Darwin", "Northern Territory"], to: ["Adelaide", "South Australia"], distanceKm: 3025, bidirectional: false },
  { from: ["Darwin", "Northern Territory"], to: ["Perth", "Western Australia"], distanceKm: 4027 },

  { from: ["Canberra", "ACT"], to: ["Wagga Wagga", "New South Wales"], distanceKm: 244 },
  { from: ["Canberra", "ACT"], to: ["Albury", "New South Wales"], distanceKm: 343 },
  { from: ["Canberra", "ACT"], to: ["Melbourne", "Victoria"], distanceKm: 663, bidirectional: false },

  { from: ["Newcastle", "New South Wales"], to: ["Tamworth", "New South Wales"], distanceKm: 280 },
  { from: ["Newcastle", "New South Wales"], to: ["Coffs Harbour", "New South Wales"], distanceKm: 392 },
  { from: ["Newcastle", "New South Wales"], to: ["Dubbo", "New South Wales"], distanceKm: 390 },

  { from: ["Townsville", "Queensland"], to: ["Cairns", "Queensland"], distanceKm: 347 },
  { from: ["Townsville", "Queensland"], to: ["Mackay", "Queensland"], distanceKm: 388 },
  { from: ["Townsville", "Queensland"], to: ["Mount Isa", "Queensland"], distanceKm: 904 },

  { from: ["Rockhampton", "Queensland"], to: ["Mackay", "Queensland"], distanceKm: 336 },
  { from: ["Rockhampton", "Queensland"], to: ["Gladstone", "Queensland"], distanceKm: 111 },

  { from: ["Toowoomba", "Queensland"], to: ["Roma", "Queensland"], distanceKm: 352 },
  { from: ["Toowoomba", "Queensland"], to: ["Dubbo", "New South Wales"], distanceKm: 742 },

  { from: ["Mildura", "Victoria"], to: ["Broken Hill", "New South Wales"], distanceKm: 299 },
  { from: ["Mildura", "Victoria"], to: ["Port Augusta", "South Australia"], distanceKm: 516 },

  { from: ["Kalgoorlie", "Western Australia"], to: ["Esperance", "Western Australia"], distanceKm: 398 },
  { from: ["Kalgoorlie", "Western Australia"], to: ["Port Hedland", "Western Australia"], distanceKm: 1368 },

  { from: ["Port Augusta", "South Australia"], to: ["Alice Springs", "Northern Territory"], distanceKm: 1228 },
  { from: ["Port Augusta", "South Australia"], to: ["Ceduna", "South Australia"], distanceKm: 470 },
  { from: ["Port Augusta", "South Australia"], to: ["Kalgoorlie", "Western Australia"], distanceKm: 1560 },

  { from: ["Wagga Wagga", "New South Wales"], to: ["Albury", "New South Wales"], distanceKm: 146 },
  { from: ["Wagga Wagga", "New South Wales"], to: ["Dubbo", "New South Wales"], distanceKm: 392 },
];

function normalisePlace([city, state]) {
  return { city, state };
}

function expandRoutes(baseRoutes) {
  const expanded = [];
  for (const route of baseRoutes) {
    const from = normalisePlace(route.from);
    const to = normalisePlace(route.to);
    expanded.push({ from, to, distanceKm: route.distanceKm });
    if (route.bidirectional !== false) {
      expanded.push({ from: to, to: from, distanceKm: route.distanceKm });
    }
  }
  return expanded;
}

module.exports = expandRoutes(BASE_ROUTES);
