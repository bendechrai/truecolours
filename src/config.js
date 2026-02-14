// Country configurations: parties, colours, election years, projections

export const COUNTRIES = {
  us: {
    name: 'United States',
    flag: '\u{1F1FA}\u{1F1F8}',
    isoCode: 840,
    elections: [2000, 2004, 2008, 2012, 2016, 2020, 2024],
    dotBudget: 30000,
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
    ],
  },
  uk: {
    name: 'United Kingdom',
    flag: '\u{1F1EC}\u{1F1E7}',
    isoCode: 826,
    elections: [2001, 2005, 2010, 2015, 2017, 2019, 2024],
    dotBudget: 18000,
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
      { name: 'Electoral Commission', url: 'https://www.electoralcommission.org.uk/' },
    ],
  },
  au: {
    name: 'Australia',
    flag: '\u{1F1E6}\u{1F1FA}',
    isoCode: 36,
    elections: [2001, 2004, 2007, 2010, 2013, 2016, 2019, 2022, 2025],
    dotBudget: 14000,
    parties: [
      { id: 'coa', name: 'Coalition', colour: '#1C4F9C' },
      { id: 'alp', name: 'Labor', colour: '#DE3533' },
      { id: 'grn', name: 'Greens', colour: '#10C25B' },
      { id: 'oth', name: 'Other', colour: '#FF8C00' },
    ],
    nonVoterColour: '#CFCFCF',
    projection: 'mercator',
    boundaryUrl: 'https://raw.githubusercontent.com/pmcau/AustralianElectorates/main/Data/Maps/2025/australia_01.geojson',
    boundaryType: 'geojson',
    nameProperty: 'electorateName',
    clipBounds: { lonMin: 112, lonMax: 155, latMin: -45, latMax: -9 },
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
    dotBudget: 20000,
    parties: [
      { id: 'lib', name: 'Liberal', colour: '#D71920' },
      { id: 'con', name: 'Conservative', colour: '#1A4782' },
      { id: 'ndp', name: 'NDP', colour: '#F58220' },
      { id: 'bq', name: 'Bloc Qu\u00e9b\u00e9cois', colour: '#87CEEB' },
      { id: 'grn', name: 'Green', colour: '#3D9B35' },
      { id: 'oth', name: 'Other', colour: '#999999' },
    ],
    nonVoterColour: '#CFCFCF',
    projection: 'conicConformal',
    boundaryUrl: 'https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets/georef-canada-federal-electoral-district/exports/geojson',
    boundaryType: 'geojson',
    nameProperty: 'fed_name_en',
    aspectRatio: 0.75,
    dataSources: [
      { name: 'Elections Canada', url: 'https://www.elections.ca/' },
    ],
  },
};

export const DEFAULT_COUNTRY = 'us';
export const DOT_RADIUS_DESKTOP = 1.4;
export const DOT_RADIUS_MOBILE = 1.0;
export const MOBILE_BREAKPOINT = 768;
export const AUTOPLAY_INTERVAL = 2500;
export const RESIZE_DEBOUNCE = 300;
export const TEST_CANVAS_SIZE = 150;
