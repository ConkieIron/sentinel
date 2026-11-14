// Threat-index regions. Countries are assigned by Natural Earth / UN M49 subregion,
// with a small number of editorial overrides where news geography differs.

export const REGIONS = [
  { id: 'north-america', name: 'North America', subregions: ['Northern America'] },
  { id: 'central-america', name: 'Central America & Caribbean', subregions: ['Central America', 'Caribbean'] },
  { id: 'south-america', name: 'South America', subregions: ['South America'] },
  { id: 'western-europe', name: 'Western & Northern Europe', subregions: ['Western Europe', 'Northern Europe'] },
  { id: 'southern-europe', name: 'Southern Europe & Balkans', subregions: ['Southern Europe'] },
  { id: 'eastern-europe', name: 'Eastern Europe & Russia', subregions: ['Eastern Europe'] },
  { id: 'middle-east', name: 'Middle East & Caucasus', subregions: ['Western Asia'] },
  { id: 'north-africa', name: 'North Africa', subregions: ['Northern Africa'] },
  { id: 'west-africa', name: 'West Africa & Sahel', subregions: ['Western Africa'] },
  { id: 'east-africa', name: 'East Africa & Horn', subregions: ['Eastern Africa'] },
  { id: 'central-southern-africa', name: 'Central & Southern Africa', subregions: ['Middle Africa', 'Southern Africa'] },
  { id: 'central-asia', name: 'Central Asia', subregions: ['Central Asia'] },
  { id: 'south-asia', name: 'South Asia', subregions: ['Southern Asia'] },
  { id: 'east-asia', name: 'East Asia', subregions: ['Eastern Asia'] },
  { id: 'southeast-asia', name: 'Southeast Asia', subregions: ['South-Eastern Asia'] },
  { id: 'oceania', name: 'Oceania & Pacific', subregions: ['Australia and New Zealand', 'Melanesia', 'Micronesia', 'Polynesia'] },
];

export const REGION_OVERRIDES = {
  IRN: 'middle-east',
  CYP: 'southern-europe',
};

export const REGION_BY_ID = Object.fromEntries(REGIONS.map((r) => [r.id, r]));

export function regionForSubregion(iso3, subregion) {
  if (REGION_OVERRIDES[iso3]) return REGION_OVERRIDES[iso3];
  const match = REGIONS.find((r) => r.subregions.includes(subregion));
  return match ? match.id : null;
}
