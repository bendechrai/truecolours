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
// Each key is `vizMode` or `vizMode+shape` for shape-specific overrides.

export const MODE_INFO = {
  choropleth: {
    title: 'Classic Choropleth',
    purpose: 'The traditional election map: each region is coloured by its winning party.',
    insight: 'This is the map most often shared on social media. Large rural areas dominate visually, even when they contain fewer voters.',
    accuracy: 'Misleading',
    accuracyDetail: 'A 51\u201349 win looks identical to 80\u201320. Geographic area has no relationship to population.',
  },
  dots: {
    title: 'Dot Density',
    purpose: 'Each dot represents a fixed number of voters, coloured by the party they voted for.',
    insight: 'Dense urban areas show as tight clusters of mixed colour. Sparse rural areas get proportionally fewer dots.',
    accuracy: 'High',
    accuracyDetail: 'Every vote gets equal visual weight regardless of geography.',
  },
  pies: {
    title: 'Pie Charts',
    purpose: 'Each region gets a proportional symbol with pie slices showing vote share.',
    insight: 'You can compare both total size (eligible voters) and party breakdown at a glance.',
    accuracy: 'High',
    accuracyDetail: 'Circle area is proportional to eligible voters; slices show exact vote share.',
  },
  bubbles: {
    title: 'Party Circles',
    purpose: 'Concentric circles sized by each party\u2019s vote count, largest behind.',
    insight: 'Makes it easy to see which party dominates each region and by how much.',
    accuracy: 'High',
    accuracyDetail: 'Each circle\u2019s area is proportional to that party\u2019s votes.',
  },
  alpha: {
    title: 'Shaded (Value-by-Alpha)',
    purpose: 'Regions are coloured by winner but faded by population density.',
    insight: 'Low-density areas fade toward transparent, so visual weight tracks population.',
    accuracy: 'Moderate',
    accuracyDetail: 'Winner-takes-all colouring remains, but density weighting reduces geographic distortion.',
  },
};

export const SHAPE_INFO = {
  geo: {
    label: 'Geographic',
    detail: 'Regions shown at their real geographic positions and sizes.',
  },
  dorling: {
    label: 'Dorling',
    detail: 'Symbols are pushed apart so they don\u2019t overlap, making small urban regions visible.',
  },
  cartogram: {
    label: 'Cartogram',
    detail: 'Each region is scaled so its visual area is proportional to its eligible voters.',
  },
};
