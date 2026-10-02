// Canada-wide city list with approximate centre coordinates (GeoNames, CC BY 4.0, rounded to about 1 km).
// The app only ever knows which city a player picked, never an address (privacy plan 12.1), so distances
// are measured between city centres. Radius search and the map both work that way.
// Stored values are "City, PROV" because some names repeat across provinces (Windsor ON/NS, Cornwall ON/PE).

export const PROVINCES = {
  AB: "Alberta",
  BC: "British Columbia",
  MB: "Manitoba",
  NB: "New Brunswick",
  NL: "Newfoundland and Labrador",
  NS: "Nova Scotia",
  NT: "Northwest Territories",
  NU: "Nunavut",
  ON: "Ontario",
  PE: "Prince Edward Island",
  QC: "Quebec",
  SK: "Saskatchewan",
  YT: "Yukon",
};

// [name, latitude, longitude], grouped by province or territory.
const CITY_DATA = {
  AB: [
    ["Airdrie", 51.30, -114.04], ["Brooks", 50.58, -111.89], ["Calgary", 51.05, -114.09],
    ["Camrose", 53.02, -112.84], ["Canmore", 51.08, -115.35], ["Chestermere", 51.03, -113.82],
    ["Cochrane", 51.18, -114.47], ["Edmonton", 53.55, -113.47], ["Fort McMurray", 56.73, -111.38],
    ["Fort Saskatchewan", 53.70, -113.21], ["Grande Prairie", 55.17, -118.80], ["Leduc", 53.27, -113.55],
    ["Lethbridge", 49.70, -112.82], ["Lloydminster", 53.27, -110.02], ["Medicine Hat", 50.04, -110.68],
    ["Okotoks", 50.73, -113.98], ["Red Deer", 52.27, -113.80], ["Sherwood Park", 53.52, -113.32],
    ["Spruce Grove", 53.53, -113.92], ["St. Albert", 53.63, -113.64],
  ],
  BC: [
    ["Abbotsford", 49.06, -122.25], ["Burnaby", 49.27, -122.95], ["Campbell River", 50.02, -125.24],
    ["Chilliwack", 49.17, -121.95], ["Coquitlam", 49.28, -122.78], ["Courtenay", 49.69, -124.99],
    ["Cranbrook", 49.50, -115.77], ["Delta", 49.09, -123.05], ["Fort St. John", 56.25, -120.85],
    ["Kamloops", 50.67, -120.32], ["Kelowna", 49.88, -119.49], ["Langley", 49.10, -122.66],
    ["Maple Ridge", 49.22, -122.60], ["Mission", 49.13, -122.30], ["Nanaimo", 49.17, -123.94],
    ["Nelson", 49.50, -117.29], ["New Westminster", 49.21, -122.91], ["North Vancouver", 49.32, -123.07],
    ["Penticton", 49.48, -119.59], ["Port Coquitlam", 49.27, -122.77], ["Prince George", 53.92, -122.75],
    ["Prince Rupert", 54.32, -130.32], ["Richmond", 49.17, -123.14], ["Saanich", 48.55, -123.37],
    ["Salmon Arm", 50.70, -119.27], ["Squamish", 49.70, -123.16], ["Surrey", 49.11, -122.83],
    ["Terrace", 54.52, -128.60], ["Vancouver", 49.25, -123.12], ["Vernon", 50.27, -119.27],
    ["Victoria", 48.44, -123.35], ["West Vancouver", 49.33, -123.16], ["Williams Lake", 52.14, -122.14],
  ],
  MB: [
    ["Brandon", 49.85, -99.95], ["Dauphin", 51.15, -100.05], ["Morden", 49.19, -98.10],
    ["Portage la Prairie", 49.97, -98.29], ["Selkirk", 50.14, -96.88], ["Steinbach", 49.53, -96.68],
    ["The Pas", 53.82, -101.24], ["Thompson", 55.74, -97.86], ["Winkler", 49.18, -97.94],
    ["Winnipeg", 49.88, -97.15],
  ],
  NB: [
    ["Bathurst", 47.62, -65.65], ["Campbellton", 48.01, -66.67], ["Dieppe", 46.08, -64.69],
    ["Edmundston", 47.37, -68.33], ["Fredericton", 45.95, -66.67], ["Miramichi", 47.03, -65.50],
    ["Moncton", 46.09, -64.80], ["Quispamsis", 45.42, -65.95], ["Riverview", 46.05, -64.82],
    ["Saint John", 45.27, -66.06],
  ],
  NL: [
    ["Conception Bay South", 47.50, -53.00], ["Corner Brook", 48.95, -57.95], ["Gander", 48.96, -54.62],
    ["Grand Falls-Windsor", 48.93, -55.66], ["Happy Valley-Goose Bay", 53.30, -60.33], ["Labrador City", 52.95, -66.91],
    ["Mount Pearl", 47.52, -52.78], ["Paradise", 47.53, -52.88], ["St. John's", 47.56, -52.71],
  ],
  NS: [
    ["Amherst", 45.83, -64.20], ["Antigonish", 45.62, -62.00], ["Bridgewater", 44.38, -64.52],
    ["Dartmouth", 44.67, -63.58], ["Halifax", 44.64, -63.58], ["Kentville", 45.08, -64.50],
    ["New Glasgow", 45.58, -62.65], ["Sydney", 46.14, -60.18], ["Truro", 45.37, -63.27],
    ["Windsor", 44.98, -64.13], ["Wolfville", 45.08, -64.37], ["Yarmouth", 43.83, -66.12],
  ],
  NT: [
    ["Hay River", 60.82, -115.80], ["Inuvik", 68.36, -133.73], ["Yellowknife", 62.45, -114.37],
  ],
  NU: [
    ["Iqaluit", 63.75, -68.52], ["Rankin Inlet", 62.81, -92.09],
  ],
  ON: [
    ["Ajax", 43.85, -79.03], ["Ancaster", 43.22, -79.99], ["Aurora", 44.00, -79.47],
    ["Barrie", 44.40, -79.67], ["Belleville", 44.17, -77.38], ["Brampton", 43.68, -79.77],
    ["Brantford", 43.13, -80.27], ["Brockville", 44.59, -75.69], ["Burlington", 43.39, -79.84],
    ["Cambridge", 43.36, -80.31], ["Chatham", 42.41, -82.18], ["Cobourg", 43.96, -78.17],
    ["Collingwood", 44.48, -80.22], ["Cornwall", 45.02, -74.73], ["Dundas", 43.27, -79.94],
    ["Grimsby", 43.20, -79.57], ["Guelph", 43.55, -80.26], ["Hamilton", 43.25, -79.85],
    ["Kenora", 49.77, -94.49], ["Kingston", 44.23, -76.48], ["Kitchener", 43.43, -80.51],
    ["Leamington", 42.05, -82.60], ["London", 42.98, -81.23], ["Markham", 43.87, -79.27],
    ["Milton", 43.52, -79.88], ["Mississauga", 43.58, -79.66], ["Newmarket", 44.05, -79.47],
    ["Niagara Falls", 43.10, -79.07], ["North Bay", 46.32, -79.47], ["Oakville", 43.45, -79.68],
    ["Orangeville", 43.92, -80.10], ["Orillia", 44.61, -79.42], ["Oshawa", 43.90, -78.85],
    ["Ottawa", 45.41, -75.70], ["Owen Sound", 44.57, -80.94], ["Pembroke", 45.82, -77.12],
    ["Peterborough", 44.30, -78.32], ["Pickering", 43.90, -79.13], ["Richmond Hill", 43.87, -79.44],
    ["Sarnia", 42.98, -82.40], ["Sault Ste. Marie", 46.52, -84.33], ["St. Catharines", 43.17, -79.24],
    ["Stoney Creek", 43.22, -79.77], ["Stratford", 43.37, -80.95], ["Sudbury", 46.49, -80.99],
    ["Thunder Bay", 48.38, -89.25], ["Timmins", 48.47, -81.33], ["Toronto", 43.71, -79.40],
    ["Vaughan", 43.84, -79.50], ["Waterloo", 43.47, -80.52], ["Welland", 42.98, -79.25],
    ["Whitby", 43.88, -78.93], ["Windsor", 42.30, -83.02], ["Woodstock", 43.13, -80.75],
  ],
  PE: [
    ["Charlottetown", 46.23, -63.13], ["Cornwall", 46.23, -63.22], ["Stratford", 46.22, -63.08],
    ["Summerside", 46.39, -63.79],
  ],
  QC: [
    ["Blainville", 45.67, -73.88], ["Boucherville", 45.59, -73.44], ["Brossard", 45.45, -73.47],
    ["Drummondville", 45.88, -72.48], ["Gatineau", 45.48, -75.70], ["Granby", 45.40, -72.73],
    ["Joliette", 46.02, -73.42], ["Laval", 45.57, -73.69], ["Lévis", 46.80, -71.18],
    ["Longueuil", 45.52, -73.47], ["Magog", 45.27, -72.15], ["Mirabel", 45.65, -74.08],
    ["Montréal", 45.51, -73.59], ["Québec City", 46.81, -71.21], ["Repentigny", 45.74, -73.45],
    ["Rimouski", 48.45, -68.52], ["Rouyn-Noranda", 48.24, -79.02], ["Saguenay", 48.42, -71.07],
    ["Saint-Hyacinthe", 45.63, -72.96], ["Saint-Jean-sur-Richelieu", 45.31, -73.26], ["Saint-Jérôme", 45.78, -74.00],
    ["Sept-Îles", 50.20, -66.38], ["Shawinigan", 46.57, -72.75], ["Sherbrooke", 45.40, -71.90],
    ["Terrebonne", 45.70, -73.65], ["Trois-Rivières", 46.35, -72.55], ["Val-d'Or", 48.10, -77.80],
    ["Vaudreuil-Dorion", 45.40, -74.03], ["Victoriaville", 46.05, -71.97],
  ],
  SK: [
    ["Estevan", 49.13, -102.98], ["Martensville", 52.28, -106.67], ["Moose Jaw", 50.40, -105.53],
    ["North Battleford", 52.78, -108.30], ["Prince Albert", 53.20, -105.77], ["Regina", 50.45, -104.62],
    ["Saskatoon", 52.13, -106.67], ["Swift Current", 50.28, -107.80], ["Warman", 52.32, -106.57],
    ["Weyburn", 49.67, -103.85], ["Yorkton", 51.22, -102.47],
  ],
  YT: [
    ["Dawson City", 64.06, -139.43], ["Whitehorse", 60.72, -135.05],
  ],
};

// For grouped dropdowns: [{ code: "AB", name: "Alberta", cities: ["Airdrie, AB", ...] }, ...]
export const CITY_GROUPS = Object.entries(CITY_DATA).map(([code, rows]) => ({
  code,
  name: PROVINCES[code],
  cities: rows.map(([n]) => `${n}, ${code}`),
}));
export const CITIES = CITY_GROUPS.flatMap((g) => g.cities);

// "Hamilton, ON" -> [43.26, -79.84]
const COORDS = new Map(
  Object.entries(CITY_DATA).flatMap(([code, rows]) => rows.map(([n, lat, lng]) => [`${n}, ${code}`, [lat, lng]])),
);
export const cityCoords = (city) => COORDS.get(city);

// Distance choices offered in search and in the meetup-range setting, in km.
export const RADII = [10, 25, 50, 100, 250];

/** Great-circle distance in km between two [lat, lng] points (haversine). */
function distanceKm([lat1, lng1], [lat2, lng2]) {
  const rad = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

/** Distance between two listed cities in whole km, or null if either one is not on the list. */
export function cityDistance(a, b) {
  const p = COORDS.get(a);
  const q = COORDS.get(b);
  return p && q ? Math.round(distanceKm(p, q)) : null;
}

/** Cities within `km` of `origin` (origin included), nearest first. With no limit, every city by distance. */
export function citiesWithin(origin, km = Infinity) {
  const from = COORDS.get(origin);
  if (!from) return [];
  return [...COORDS]
    .map(([city, at]) => [city, distanceKm(from, at)])
    .filter(([, d]) => d <= km)
    .sort((x, y) => x[1] - y[1])
    .map(([city]) => city);
}

/** The listed city closest to a point, e.g. the browser's location. The point itself never leaves the browser. */
export function nearestCity(lat, lng) {
  let best = null;
  let bestKm = Infinity;
  for (const [city, at] of COORDS) {
    const d = distanceKm([lat, lng], at);
    if (d < bestKm) [best, bestKm] = [city, d];
  }
  return best;
}
