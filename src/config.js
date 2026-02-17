// Country configurations: parties, colours, election years, projections

export const COUNTRIES = {
  us: {
    name: 'United States',
    flag: '\u{1F1FA}\u{1F1F8}',
    isoCode: 840,
    elections: [2000, 2004, 2008, 2012, 2016, 2020, 2024],
    parties: [
      { id: 'dem', name: 'Democrat', colour: '#1375B7' },
      { id: 'rep', name: 'Republican', colour: '#E81B23' },
      { id: 'oth', name: 'Other', colour: '#F5C542' },
    ],
    nonVoterColour: '#CFCFCF',
    projection: 'albersUsa',
    boundaryUrl: 'https://cdn.jsdelivr.net/npm/us-atlas@3/counties-10m.json',
    boundaryType: 'counties',
    stateType: 'states',
    aspectRatio: 0.625,
    gridSize: null, // uses real boundaries
    dataSources: [
      { name: 'MIT Election Data + Science Lab', url: 'https://electionlab.mit.edu/' },
      { name: 'US County Presidential Results (stiles)', url: 'https://github.com/stiles/presidential-elections' },
    ],
  },
  uk: {
    name: 'United Kingdom',
    flag: '\u{1F1EC}\u{1F1E7}',
    isoCode: 826,
    elections: [2001, 2005, 2010, 2015, 2017, 2019, 2024],
    parties: [
      { id: 'con', name: 'Conservative', colour: '#0087DC' },
      { id: 'lab', name: 'Labour', colour: '#DC241F' },
      { id: 'lib', name: 'Lib Dem', colour: '#FDBB30' },
      { id: 'snp', name: 'SNP', colour: '#FFF95D' },
      { id: 'grn', name: 'Green', colour: '#6AB023' },
      { id: 'oth', name: 'Other', colour: '#999999' },
    ],
    nonVoterColour: '#CFCFCF',
    projection: 'mercator',
    boundaryUrl: 'https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/Westminster_Parliamentary_Constituencies_July_2024_Boundaries_UK_BUC/FeatureServer/0/query?where=1%3D1&outFields=PCON24CD,PCON24NM&outSR=4326&f=geojson',
    boundaryType: 'geojson',
    nameProperty: 'PCON24NM',
    aspectRatio: 1.6,
    dataSources: [
      { name: 'Electoral Calculus', url: 'https://www.electoralcalculus.co.uk/' },
    ],
  },
  au: {
    name: 'Australia',
    flag: '\u{1F1E6}\u{1F1FA}',
    isoCode: 36,
    elections: [2004, 2007, 2010, 2013, 2016, 2019, 2022, 2025],
    parties: [
      { id: 'coa', name: 'Coalition', colour: '#1C4F9C' },
      { id: 'alp', name: 'Labor', colour: '#DE3533' },
      { id: 'grn', name: 'Greens', colour: '#10C25B' },
      { id: 'oth', name: 'Other', colour: '#FF8C00' },
    ],
    nonVoterColour: '#CFCFCF',
    projection: 'mercator',
    boundaryUrl: './data/au-boundaries.geojson',
    boundaryType: 'geojson',
    nameProperty: 'name',
    aspectRatio: 0.85,
    dataSources: [
      { name: 'Australian Electoral Commission', url: 'https://www.aec.gov.au/' },
    ],
  },
  ca: {
    name: 'Canada',
    flag: '\u{1F1E8}\u{1F1E6}',
    isoCode: 124,
    elections: [2000, 2004, 2006, 2008, 2011, 2015, 2019, 2021, 2025],
    parties: [
      { id: 'lib', name: 'Liberal', colour: '#D71920' },
      { id: 'con', name: 'Conservative', colour: '#1A4782' },
      { id: 'ndp', name: 'NDP', colour: '#F58220' },
      { id: 'bq', name: 'Bloc Qu\u00e9b\u00e9cois', colour: '#87CEEB' },
      { id: 'grn', name: 'Green', colour: '#3D9B35' },
      { id: 'oth', name: 'Other', colour: '#999999' },
    ],
    nonVoterColour: '#CFCFCF',
    projection: 'mercator',
    boundaryUrl: './data/ca-boundaries.geojson',
    boundaryType: 'geojson',
    nameProperty: 'name',
    fitLatMax: 70,
    aspectRatio: 0.7,
    dataSources: [
      { name: 'Elections Canada', url: 'https://www.elections.ca/' },
      { name: 'Canadian Federal Election Data', url: 'https://github.com/bwbecker/cdnFedElectionData' },
    ],
  },
};

export const DEFAULT_COUNTRY = 'us';
export const MOBILE_BREAKPOINT = 768;
export const AUTOPLAY_INTERVAL = 2500;
export const RESIZE_DEBOUNCE = 300;
export const TEST_CANVAS_SIZE = 150;

export const VIZ_MODES = [
  { id: 'choropleth', name: 'Classic' },
  { id: 'dots', name: 'Dot Density' },
  { id: 'pies', name: 'Pie Charts' },
  { id: 'bubbles', name: 'Party Circles' },
  { id: 'alpha', name: 'Shaded' },
];
export const DEFAULT_VIZ_MODE = 'dots';

export const SHAPE_MODES = [
  { id: 'geo', name: 'Geographic' },
  { id: 'dorling', name: 'Dorling' },
  { id: 'cartogram', name: 'Cartogram' },
];
export const DEFAULT_SHAPE = 'geo';

// Which shapes are valid for each viz mode
export const SHAPE_COMPAT = {
  choropleth: ['geo', 'cartogram'],
  dots:       ['geo', 'dorling', 'cartogram'],
  pies:       ['geo', 'dorling', 'cartogram'],
  bubbles:    ['geo', 'dorling', 'cartogram'],
  alpha:      ['geo', 'cartogram'],
};

// ─── Mode descriptions (shown above the map) ─────────────────────
// Keyed by "vizMode:shape" so every valid combination gets a tailored
// title, description, and accuracy rating.
//
// `rank` orders from most accurate (1) to most misleading (14).

export const MODE_INFO = {
  // ── Choropleth ──────────────────────────────────────────────────
  'choropleth:geo': {
    title: 'Classic Choropleth',
    purpose: 'The traditional election map: each region is coloured by its winning party.',
    insight: 'This is the map most often shared on social media. Large rural areas dominate visually, even when they contain fewer voters.',
    accuracy: 'Misleading',
    accuracyDetail: 'A 51\u201349 win looks identical to 80\u201320. Geographic area has no relationship to population.',
    rank: 14,
  },
  'choropleth:cartogram': {
    title: 'Choropleth \u00b7 Cartogram',
    purpose: 'Each region is coloured by its winning party and scaled so its area is proportional to eligible voters.',
    insight: 'Removes geographic distortion: big, empty regions shrink while dense urban areas grow to reflect their true electoral weight.',
    accuracy: 'Moderate',
    accuracyDetail: 'Area now reflects population, but winner-take-all colouring still hides vote margins.',
    rank: 12,
  },

  // ── Dot Density ─────────────────────────────────────────────────
  'dots:geo': {
    title: 'Dot Density',
    purpose: 'Each dot represents a fixed number of voters, coloured by the party they voted for, placed within geographic boundaries.',
    insight: 'Dense urban areas show as tight clusters of mixed colour. Sparse rural areas get proportionally fewer dots.',
    accuracy: 'Moderate',
    accuracyDetail: 'Every vote gets equal visual weight, but geographic layout still gives disproportionate space to sparse rural areas.',
    rank: 9,
  },
  'dots:dorling': {
    title: 'Dot Density \u00b7 Dorling',
    purpose: 'Each dot represents a fixed number of voters. Regions are pushed apart so small urban areas don\u2019t hide behind large neighbours.',
    insight: 'Every region is visible at a proportional size, making it easy to compare dot patterns across regions.',
    accuracy: 'High',
    accuracyDetail: 'Every vote gets equal visual weight, and no region is hidden by overlap.',
    rank: 5,
  },
  'dots:cartogram': {
    title: 'Dot Density \u00b7 Cartogram',
    purpose: 'Each dot represents a fixed number of voters. Regions are scaled so their area matches their eligible voters.',
    insight: 'Urban areas expand to show their full detail; rural areas shrink to reflect fewer voters.',
    accuracy: 'High',
    accuracyDetail: 'Every vote gets equal visual weight within regions that reflect their true electoral significance.',
    rank: 6,
  },

  // ── Pie Charts ──────────────────────────────────────────────────
  'pies:geo': {
    title: 'Pie Charts',
    purpose: 'Each region gets a pie chart sized by eligible voters with slices showing vote share, at its geographic position.',
    insight: 'Compare both total electorate size and party breakdown at a glance, though small regions may overlap with large neighbours.',
    accuracy: 'Moderate',
    accuracyDetail: 'Circle area and slices are accurate, but geographic overlap hides small high-population regions behind large neighbours.',
    rank: 7,
  },
  'pies:dorling': {
    title: 'Pie Charts \u00b7 Dorling',
    purpose: 'Pie charts sized by eligible voters are pushed apart so every region is visible without overlap.',
    insight: 'Easy to compare both total electorate size and vote breakdown across all regions simultaneously.',
    accuracy: 'High',
    accuracyDetail: 'Circle area is proportional to eligible voters; slices show exact vote share; no overlap.',
    rank: 1,
  },
  'pies:cartogram': {
    title: 'Pie Charts \u00b7 Cartogram',
    purpose: 'Pie charts showing vote share are placed on regions scaled to match their eligible voters.',
    insight: 'Region area and pie size both reflect electoral weight, reinforcing the population signal.',
    accuracy: 'High',
    accuracyDetail: 'Both region area and symbol size are proportional to eligible voters; slices show exact vote share.',
    rank: 2,
  },

  // ── Party Circles ───────────────────────────────────────────────
  'bubbles:geo': {
    title: 'Party Circles',
    purpose: 'Concentric rings where each ring\u2019s width is proportional to that party\u2019s vote count, placed at each region\u2019s geographic position.',
    insight: 'Ring width lets you compare party strength at a glance, though small regions may be hidden behind large neighbours.',
    accuracy: 'Moderate',
    accuracyDetail: 'Ring width is proportional to votes (not ring area). Geographic overlap hides densely packed urban regions.',
    rank: 8,
  },
  'bubbles:dorling': {
    title: 'Party Circles \u00b7 Dorling',
    purpose: 'Concentric rings where each ring\u2019s width is proportional to that party\u2019s vote count, pushed apart so every region is visible.',
    insight: 'Clear comparison of party strength across all regions without geographic overlap hiding small areas.',
    accuracy: 'High',
    accuracyDetail: 'Ring width is proportional to votes (not ring area); no overlap between regions.',
    rank: 3,
  },
  'bubbles:cartogram': {
    title: 'Party Circles \u00b7 Cartogram',
    purpose: 'Concentric rings where each ring\u2019s width is proportional to that party\u2019s vote count, placed on regions scaled to match eligible voters.',
    insight: 'Region area reinforces the population signal alongside per-party ring sizing.',
    accuracy: 'High',
    accuracyDetail: 'Ring width is proportional to votes (not ring area) within population-proportional regions.',
    rank: 4,
  },

  // ── Shaded (Value-by-Alpha) ─────────────────────────────────────
  'alpha:geo': {
    title: 'Shaded (Value-by-Alpha)',
    purpose: 'Regions are coloured by winner but faded by population density \u2014 sparse areas become nearly transparent.',
    insight: 'Low-density areas fade toward transparent, so visual weight tracks population rather than land area.',
    accuracy: 'Moderate',
    accuracyDetail: 'Winner-take-all colouring remains, but density weighting reduces geographic distortion.',
    rank: 11,
  },
  'alpha:cartogram': {
    title: 'Shaded \u00b7 Cartogram',
    purpose: 'Regions are coloured by winner, faded by density, and scaled to match eligible voters.',
    insight: 'Combines two population corrections: area scaling and alpha fading. Geographic distortion is significantly reduced.',
    accuracy: 'Moderate',
    accuracyDetail: 'Winner-take-all colouring still hides margins, but both area and opacity corrections reduce distortion.',
    rank: 10,
  },
};
