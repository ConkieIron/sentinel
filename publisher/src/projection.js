// Equal Earth projection (Šavrič, Patterson & Jenny, 2018), scaled to the SVG basemap.
// Shared by the basemap generator and the page renderer so pins line up with countries.

const A1 = 1.340264;
const A2 = -0.081106;
const A3 = 0.000893;
const A4 = 0.003796;
const M = Math.sqrt(3) / 2;

export const MAP_WIDTH = 1000;
export const NORTH_LIMIT = 84;
export const SOUTH_LIMIT = -58;

function raw(lon, lat) {
  const lambda = (lon * Math.PI) / 180;
  const phi = (Math.max(-90, Math.min(90, lat)) * Math.PI) / 180;
  const theta = Math.asin(M * Math.sin(phi));
  const t2 = theta * theta;
  const t6 = t2 * t2 * t2;
  const x = (lambda * Math.cos(theta)) / (M * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2)));
  const y = theta * (A1 + A2 * t2 + t6 * (A3 + A4 * t2));
  return [x, y];
}

const X_MAX = raw(180, 0)[0];
const Y_TOP = raw(0, NORTH_LIMIT)[1];
const Y_BOTTOM = raw(0, SOUTH_LIMIT)[1];
const SCALE = MAP_WIDTH / (2 * X_MAX);

export const MAP_HEIGHT = Math.round((Y_TOP - Y_BOTTOM) * SCALE);

export function project(lon, lat) {
  const [x, y] = raw(lon, lat);
  return [(x + X_MAX) * SCALE, (Y_TOP - y) * SCALE];
}
