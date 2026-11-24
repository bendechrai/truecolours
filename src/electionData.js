// Fetch real election data and map to feature indices for rendering.
//
// JSON files live in public/data/{country}-elections.json.
// US presidential data is keyed by county FIPS code; the rest by region name.
//
// Returns: { [year]: { [featureIndex]: { votes: { partyId: count }, eligible: number } } }
// A region may also carry `winner` (party id, where an unopposed candidate
// received no tallied votes), `uncontested` and `pending` (why it isn't final).

import * as d3 from 'd3';

const cache = {};

/**
 * Load real election data for a country.
 *
 * @param {string} countryId - key in COUNTRIES, e.g. 'us', 'ushouse', 'uk'
 * @param {object} config    - country config from config.js
 * @param {Array}  features  - GeoJSON features (order = feature indices)
 * @returns election data keyed by year then feature index
 */
export async function loadElectionData(countryId, config, features) {
  // Fetch JSON (cached across country switches)
  if (!cache[countryId]) {
    const url = `${import.meta.env.BASE_URL}data/${countryId}-elections.json`;
    cache[countryId] = await d3.json(url);
  }
  const raw = cache[countryId];

  // Build lookup: regionKey → featureIndex
  const keyToIndex = buildKeyMap(countryId, features);

  // Transform into the format colourSymbols expects
  const data = {};
  const parties = config.parties;

  for (const year of config.elections) {
    const yearStr = String(year);
    const yearRaw = raw[yearStr];
    if (!yearRaw) continue;

    const yearData = {};
    for (const [regionKey, regionVotes] of Object.entries(yearRaw)) {
      const fi = keyToIndex.get(regionKey) ?? keyToIndex.get(normName(regionKey));
      if (fi === undefined) continue;

      const votes = {};
      let total = 0;
      for (const party of parties) {
        const count = regionVotes[party.id] || 0;
        votes[party.id] = count;
        total += count;
      }

      // eligible: use stored value if present, else default to total votes
      const eligible = regionVotes.eligible || total;

      const region = { votes, eligible };
      // Optional flags (see scripts/us-house.mjs)
      if (regionVotes.winner) region.winner = regionVotes.winner;
      if (regionVotes.uncontested) region.uncontested = true;
      if (regionVotes.pending) region.pending = regionVotes.pending;
      yearData[fi] = region;
    }

    data[year] = yearData;
  }

  return data;
}

/**
 * Build a map from region key → feature index.
 *
 * US: key by FIPS code (feature.id)
 * Everything else: key by normalised region name (feature.properties._name)
 */
function buildKeyMap(countryId, features) {
  const map = new Map();

  if (countryId === 'us') {
    // US Atlas features have .id = FIPS code
    for (let i = 0; i < features.length; i++) {
      const fips = String(features[i].id).padStart(5, '0');
      map.set(fips, i);
    }
  } else {
    // Match by name
    for (let i = 0; i < features.length; i++) {
      const name = features[i].properties?._name;
      if (name) {
        map.set(name, i);
        map.set(normName(name), i);
      }
    }
  }

  return map;
}

/**
 * Normalise a region name for fuzzy matching.
 */
function normName(s) {
  return (s || '')
    .toLowerCase()
    .replace(/\u2014/g, '-')
    .replace(/\u2013/g, '-')
    .replace(/[''`\u2018\u2019]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
