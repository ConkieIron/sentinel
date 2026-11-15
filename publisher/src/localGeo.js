// Client Local-tab geolocation helpers.
//
// Pure nearest-centroid fails for large countries (Brighton is closer to Belgium's label point
// than to the UK's northern one) and for microstates (Jersey sits nearer London than the UK
// centroid does). We combine:
//   1. Optional regional anchor points for large countries
//   2. Tight catchments for microstates so they only win when you are essentially there

/** Max distance (km) at which a country may win. Tiny dependencies need to be underfoot. */
export const CATCH_KM = {
  JEY: 25,
  GGY: 25,
  IMN: 40,
  MCO: 20,
  AND: 30,
  LIE: 25,
  SMR: 25,
  VAT: 15,
  GIB: 20,
  SGP: 40,
  MLT: 60,
  BHR: 45,
  HKG: 40,
  MAC: 25,
  BMU: 40,
  CYM: 40,
  VGB: 30,
  AIA: 30,
  MSR: 30,
  TCA: 40,
  FLK: 80,
  FRO: 50,
  PCN: 40,
  SHN: 40,
  SJM: 80,
  LUX: 50,
  QAT: 80,
  KWT: 100,
};

export const DEFAULT_CATCH_KM = 1100;

/** Extra hubs so sprawling countries are not reduced to one distant label point. */
export const LOCAL_POINTS = {
  GBR: [
    [54.4, -2.12],
    [51.51, -0.13],
    [52.48, -1.9],
    [53.48, -2.24],
    [55.95, -3.19],
    [54.6, -5.93],
    [51.45, -2.6],
    [50.91, -1.4],
  ],
  FRA: [
    [46.6, 2.5],
    [48.86, 2.35],
    [49.63, -1.62], // Cherbourg — Normandy coast without stealing Dover
    [48.11, -1.68],
    [43.3, 5.37],
    [44.84, -0.58],
    [45.75, 4.85],
    [50.63, 3.06], // Lille
  ],
  USA: [
    [39.54, -97.48],
    [40.71, -74.01],
    [34.05, -118.24],
    [41.88, -87.63],
    [29.76, -95.37],
    [33.75, -84.39],
    [47.61, -122.33],
    [25.76, -80.19],
  ],
  CAN: [
    [60.32, -101.91],
    [43.65, -79.38],
    [45.5, -73.57],
    [49.28, -123.12],
    [45.42, -75.69],
    [53.55, -113.49],
  ],
  AUS: [
    [-24.13, 134.05],
    [-33.87, 151.21],
    [-37.81, 144.96],
    [-27.47, 153.03],
    [-31.95, 115.86],
    [-34.93, 138.6],
  ],
  DEU: [
    [51.2, 10.4],
    [52.52, 13.4],
    [48.14, 11.58],
    [50.11, 8.68],
    [53.55, 9.99],
  ],
  ITA: [
    [42.5, 12.5],
    [41.9, 12.5],
    [45.46, 9.19],
    [40.85, 14.27],
    [45.07, 7.69],
  ],
  ESP: [
    [40.2, -3.5],
    [40.42, -3.7],
    [41.39, 2.17],
    [37.39, -5.98],
    [39.47, -0.38],
  ],
};

export function distanceKm(aLat, aLon, bLat, bLon) {
  const r = Math.PI / 180;
  const x =
    Math.sin(((bLat - aLat) * r) / 2) ** 2 +
    Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(((bLon - aLon) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(x));
}

function distanceToCountry(lat, lon, c) {
  const hubs = LOCAL_POINTS[c.iso3];
  if (hubs?.length) {
    let best = Infinity;
    for (const [hLat, hLon] of hubs) best = Math.min(best, distanceKm(lat, lon, hLat, hLon));
    return best;
  }
  return distanceKm(lat, lon, c.lat, c.lon);
}

/**
 * Pick the nearest country whose catchment you fall inside. Microstate catchments are tiny, so
 * Jersey only wins on-island; among the rest, absolute distance to the nearest hub wins.
 */
export function nearestCountry(lat, lon, countries, { maxKm = 1500 } = {}) {
  let best = null;
  for (const c of countries || []) {
    const d = distanceToCountry(lat, lon, c);
    if (d > maxKm) continue;
    const catchKm = c.catchKm ?? CATCH_KM[c.iso3] ?? DEFAULT_CATCH_KM;
    if (d > catchKm) continue;
    if (!best || d < best.d) best = { c, d };
  }
  return best?.c || null;
}
