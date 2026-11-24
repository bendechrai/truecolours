#!/usr/bin/env node
// Build script: transforms downloaded raw election data into compact JSON.
// Output: public/data/{country}-elections.json
//
// Prerequisites: run scripts/download-data.sh first to fetch raw data to /tmp/
//
// Usage: node scripts/build-election-data.mjs [us] [uk] [au] [ca] [au-boundaries] [ca-boundaries]
//        (no arguments builds everything)
//
// Data sources:
//   US: stiles/presidential-elections (GitHub) → /tmp/us_county_results.json
//       MEDSL 2024 precinct returns for Alaska and Virginia (GitHub)
//         → /tmp/us_medsl_ak24.csv, /tmp/us_medsl_va24.csv
//   UK: Electoral Calculus flat files → /tmp/uk_electdata_*.txt
//   AU: AEC Tally Room first preferences CSVs → /tmp/au_*_candidates.csv
//   CA: bwbecker/cdnFedElectionData + Lucas-Czarnecki/Canadian-Federal-Elections

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'public', 'data');
const TMP = '/tmp';

mkdirSync(OUT_DIR, { recursive: true });

// ── Helpers ────────────────────────────────────────────────────────

function parseCSV(text, delimiter = ',') {
  const lines = text.trim().split('\n');
  // Find the actual header row (skip AEC metadata lines)
  let headerIdx = 0;
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    const cols = parseLine(lines[i], delimiter);
    if (cols.length >= 3 && !lines[i].includes('Generated:') && !lines[i].includes('Phase:')) {
      headerIdx = i;
      break;
    }
  }

  const header = parseLine(lines[headerIdx], delimiter);
  const rows = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const vals = parseLine(lines[i], delimiter);
    const row = {};
    for (let j = 0; j < header.length; j++) {
      row[header[j]] = vals[j] || '';
    }
    rows.push(row);
  }
  return rows;
}

function parseLine(line, delimiter) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function num(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : Math.round(n);
}

function readLocal(filename) {
  const path = join(TMP, filename);
  if (!existsSync(path)) throw new Error(`Missing file: ${path}`);
  return readFileSync(path, 'utf8');
}

// ── US ─────────────────────────────────────────────────────────────
//
// Output keys must match the county features in us-atlas@3 counties-10m.json
// (feature.id = 5-digit county FIPS), because that is what the map joins on.
//
// The upstream county file needs three kinds of repair to get there:
//
// 1. FIPS codes the boundary file doesn't draw (US_FIPS_MERGE below) are folded
//    into the feature that covers them.
//
// 2. Alaska counts votes by state house district, not by borough, and upstream
//    carries those rows under made-up FIPS codes 02001–02040. They are dropped:
//    most match no feature, and 02013/02016/02020 collide with real boroughs
//    (district 20's votes would be drawn as the whole of Anchorage).
//    For 2024, boroughs are rebuilt from MEDSL's official precinct returns —
//    see alaskaByBorough(). No borough-coded source was found for 2000–2020,
//    so Alaska is empty on the map for those years.
//
// 3. Upstream's 2024 file omits 25 Virginia independent cities. They are filled
//    from MEDSL's 2024 precinct returns, which code every locality.
//
// Features that still have no data, by design:
//   - Kalawao County HI (15005): its handful of votes are counted with Maui.
//   - Broomfield County CO (08014) in 2000: the county was created in 2001.
//   - Puerto Rico and the other territories: no presidential electors.

const US_FIPS_MERGE = {
  '46113': '46102',   // Shannon County SD, renamed Oglala Lakota County in 2015
  '51515': '51019',   // Bedford city VA, absorbed into Bedford County in 2013
  '2938000': '29095', // Kansas City MO, reported apart from the rest of Jackson County
  '02063': '02261',   // Chugach and Copper River census areas AK: carved out of
  '02066': '02261',   //   Valdez-Cordova in 2019; the boundary file predates the split
};

function addVotes(target, fips, votes) {
  const key = US_FIPS_MERGE[fips] || fips;
  const t = target[key] || (target[key] = { dem: 0, rep: 0, oth: 0 });
  t.dem += votes.dem;
  t.rep += votes.rep;
  t.oth += votes.oth;
}

// Presidential rows from a MEDSL precinct-returns CSV, one per precinct/mode/candidate.
function medslPresident(filename) {
  const partyIds = { DEMOCRAT: 'dem', REPUBLICAN: 'rep' };
  return parseCSV(readLocal(filename))
    .filter(r => r.office === 'US PRESIDENT' && r.candidate !== 'UNDERVOTES' && r.candidate !== 'OVERVOTES')
    .map(r => ({
      fips: r.county_fips,
      district: r.jurisdiction_name,
      party: partyIds[r.party_simplified] || 'oth',
      votes: num(r.votes),
    }));
}

// Split an integer total across keys in proportion to weights, keeping the sum exact.
function apportion(total, weights) {
  const keys = Object.keys(weights);
  const sum = keys.reduce((s, k) => s + weights[k], 0);
  const exact = keys.map(k => (total * weights[k]) / sum);
  const shares = exact.map(Math.floor);
  const leftover = total - shares.reduce((s, v) => s + v, 0);
  const byRemainder = keys.map((_, i) => i).sort((a, b) => (exact[b] - shares[b]) - (exact[a] - shares[a]));
  for (let i = 0; i < leftover; i++) shares[byRemainder[i]]++;
  return Object.fromEntries(keys.map((k, i) => [k, shares[i]]));
}

// Alaska reports election-day votes by precinct, which MEDSL codes to a borough,
// but absentee, early and questioned ballots only as one pool per house district.
// Each district's pool is shared between the boroughs it covers in proportion to
// each party's election-day votes there. 28 of the 40 districts sit inside a
// single borough, so their pools need no estimate; in 2024 the estimated part
// was about 42,000 of 338,000 votes. Federal overseas ballots (~400) are counted
// statewide only and cannot be placed, so they are left out.
function alaskaByBorough(rows) {
  const parties = ['dem', 'rep', 'oth'];
  const counted = {}; // district → borough FIPS → votes
  const pooled = {};  // district → votes with no borough
  for (const r of rows) {
    if (r.fips) {
      const boroughs = counted[r.district] || (counted[r.district] = {});
      const b = boroughs[r.fips] || (boroughs[r.fips] = { dem: 0, rep: 0, oth: 0 });
      b[r.party] += r.votes;
    } else {
      const p = pooled[r.district] || (pooled[r.district] = { dem: 0, rep: 0, oth: 0 });
      p[r.party] += r.votes;
    }
  }

  const result = {};
  let unplaced = 0;
  for (const boroughs of Object.values(counted)) {
    for (const [fips, votes] of Object.entries(boroughs)) addVotes(result, fips, votes);
  }
  for (const [district, pool] of Object.entries(pooled)) {
    const boroughs = counted[district];
    if (!boroughs) {
      unplaced += pool.dem + pool.rep + pool.oth;
      continue;
    }
    for (const party of parties) {
      let weights = Object.fromEntries(Object.entries(boroughs).map(([f, v]) => [f, v[party]]));
      if (Object.values(weights).every(w => w === 0)) {
        weights = Object.fromEntries(Object.entries(boroughs).map(([f, v]) => [f, v.dem + v.rep + v.oth]));
      }
      for (const [fips, share] of Object.entries(apportion(pool[party], weights))) {
        addVotes(result, fips, { dem: 0, rep: 0, oth: 0, [party]: share });
      }
    }
  }
  return { result, unplaced };
}

function byCounty(rows) {
  const result = {};
  for (const r of rows) addVotes(result, r.fips, { dem: 0, rep: 0, oth: 0, [r.party]: r.votes });
  return result;
}

function buildUS() {
  console.log('US: Processing county results...');
  const raw = JSON.parse(readLocal('us_county_results.json'));

  const result = {};
  const seen = new Set(); // upstream repeats a few rows verbatim
  let alaskaDistrictRows = 0;
  for (const r of raw) {
    const year = String(r.year);
    if (!result[year]) result[year] = {};
    const fips = String(r.fips).padStart(5, '0');
    if (seen.has(`${year}/${fips}`)) continue;
    seen.add(`${year}/${fips}`);
    if (r.state_po === 'AK') {
      alaskaDistrictRows++;
      continue;
    }
    const dem = num(r.votes_dem);
    const rep = num(r.votes_rep);
    const all = num(r.votes_all);
    addVotes(result[year], fips, { dem, rep, oth: Math.max(0, all - dem - rep) });
  }
  console.log(`US: dropped ${alaskaDistrictRows} Alaska house-district rows`);

  // 2024: Alaska boroughs
  const alaska = alaskaByBorough(medslPresident('us_medsl_ak24.csv'));
  Object.assign(result['2024'], alaska.result);
  console.log(`US 2024: ${Object.keys(alaska.result).length} Alaska boroughs from MEDSL (${alaska.unplaced} overseas votes not placed)`);

  // 2024: Virginia localities missing upstream
  const virginia = byCounty(medslPresident('us_medsl_va24.csv'));
  let filled = 0;
  for (const [fips, votes] of Object.entries(virginia)) {
    if (result['2024'][fips]) continue;
    result['2024'][fips] = votes;
    filled++;
  }
  console.log(`US 2024: ${filled} Virginia localities filled from MEDSL`);

  const outPath = join(OUT_DIR, 'us-elections.json');
  writeFileSync(outPath, JSON.stringify(result));
  const years = Object.keys(result).sort();
  for (const year of years) console.log(`US ${year}: ${Object.keys(result[year]).length} counties`);
  console.log(`US: ${(readFileSync(outPath).length / 1024).toFixed(0)} KB`);
}

// ── UK ─────────────────────────────────────────────────────────────

function buildUK() {
  console.log('UK: Processing Electoral Calculus data...');

  const files = {
    2024: 'uk_electdata_2024.txt',
    2019: 'uk_electdata_2019nb.txt',   // 2019 implied on 2024 boundaries
    2017: 'uk_electdata_2017.txt',
    2015: 'uk_electdata_2015.txt',
    2010: 'uk_electdata_2010.txt',
    2005: 'uk_electdata_2005ob.txt',
    2001: 'uk_electdata_2001ob.txt',
  };

  const result = {};

  for (const [year, filename] of Object.entries(files)) {
    const text = readLocal(filename);
    const rows = parseCSV(text, ';');

    const yearData = {};
    for (const row of rows) {
      const name = row['Name'];
      if (!name) continue;

      const electorate = num(row['Electorate']);
      const con = num(row['CON']);
      const lab = num(row['LAB']);
      const lib = num(row['LIB']);
      const nat = num(row['NAT']); // SNP + Plaid Cymru
      const grn = num(row['Green']);
      // Reform/UKIP/Brexit - column name varies by year
      const reform = num(row['Reform']) + num(row['UKIP']) + num(row['Brexit']);
      const min = num(row['MIN']);
      const oth = num(row['OTH']);

      yearData[name] = {
        con, lab, lib, snp: nat, grn,
        oth: reform + min + oth,
        eligible: electorate,
      };
    }

    result[year] = yearData;
    console.log(`UK ${year}: ${Object.keys(yearData).length} constituencies`);
  }

  const outPath = join(OUT_DIR, 'uk-elections.json');
  writeFileSync(outPath, JSON.stringify(result));
  console.log(`UK: ${(readFileSync(outPath).length / 1024).toFixed(0)} KB`);
}

// ── AU ─────────────────────────────────────────────────────────────

function buildAU() {
  console.log('AU: Processing AEC data...');

  const COALITION = new Set(['LP', 'NP', 'LNP', 'CLP', 'NCP']);
  const ALP_SET = new Set(['ALP']);
  const GREENS = new Set(['GRN', 'GVIC']);

  const years = [2004, 2007, 2010, 2013, 2016, 2019, 2022, 2025];
  const result = {};

  for (const year of years) {
    const text = readLocal(`au_${year}_candidates.csv`);
    const rows = parseCSV(text);

    const divisionVotes = {};
    for (const row of rows) {
      const divName = row['DivisionNm'];
      if (!divName) continue;
      const partyAb = row['PartyAb'] || '';
      const votes = num(row['TotalVotes']);

      if (!divisionVotes[divName]) {
        divisionVotes[divName] = { coa: 0, alp: 0, grn: 0, oth: 0 };
      }

      if (COALITION.has(partyAb)) {
        divisionVotes[divName].coa += votes;
      } else if (ALP_SET.has(partyAb)) {
        divisionVotes[divName].alp += votes;
      } else if (GREENS.has(partyAb)) {
        divisionVotes[divName].grn += votes;
      } else {
        divisionVotes[divName].oth += votes;
      }
    }

    result[year] = divisionVotes;
    console.log(`AU ${year}: ${Object.keys(divisionVotes).length} divisions`);
  }

  const outPath = join(OUT_DIR, 'au-elections.json');
  writeFileSync(outPath, JSON.stringify(result));
  console.log(`AU: ${(readFileSync(outPath).length / 1024).toFixed(0)} KB`);
}

// ── CA ─────────────────────────────────────────────────────────────

function buildCA() {
  console.log('CA: Processing election data...');
  const result = {};

  // bwbecker by-riding CSVs (2000-2019)
  const bwYears = [2000, 2004, 2006, 2008, 2011, 2015, 2019];
  for (const year of bwYears) {
    const text = readLocal(`ca_riding_${year}.csv`);
    const rows = parseCSV(text);

    const yearData = {};
    for (const row of rows) {
      let name = row['ed_name'];
      if (!name) continue;
      name = name.replace(/^"|"$/g, '');

      // Handle party column name changes across years
      let con;
      if (row['Con'] !== undefined && row['Con'] !== '') {
        con = num(row['Con']);
      } else if (row['ConParty'] !== undefined && row['ConParty'] !== '') {
        con = num(row['ConParty']);
      } else {
        // Pre-2004: Canadian Alliance + Progressive Conservative
        con = num(row['CdnAll']) + num(row['PC']);
      }

      yearData[name] = {
        lib: num(row['Lib']),
        con,
        ndp: num(row['NDP']),
        bq: num(row['Bloc']),
        grn: num(row['Grn']),
        oth: num(row['Other']),
      };
    }

    result[year] = yearData;
    console.log(`CA ${year}: ${Object.keys(yearData).length} ridings`);
  }

  // Lucas-Czarnecki candidate CSVs (2021, 2025): need aggregation
  function mapParty(affiliation) {
    const a = (affiliation || '').toLowerCase();
    if (a.includes('liberal') && !a.includes('libertarian')) return 'lib';
    if (a.includes('conservative')) return 'con';
    if (a.includes('new democratic') || a.includes('ndp') || a.includes('n.d.p.')) return 'ndp';
    if (a.includes('bloc') || a.includes('québécois') || a.includes('quebecois')) return 'bq';
    if (a.includes('green')) return 'grn';
    return 'oth';
  }

  for (const [year, filename] of Object.entries({ 2021: 'ca_cand_2021.csv', 2025: 'ca_cand_2025.csv' })) {
    const text = readLocal(filename);
    const rows = parseCSV(text);

    const yearData = {};
    for (const row of rows) {
      let name = row['Constituency'];
      if (!name) continue;
      name = name.replace(/^"|"$/g, '');
      const partyId = mapParty(row['Political_Affiliation']);
      const votes = num(row['Votes']);

      if (!yearData[name]) {
        yearData[name] = { lib: 0, con: 0, ndp: 0, bq: 0, grn: 0, oth: 0 };
      }
      yearData[name][partyId] += votes;
    }

    result[year] = yearData;
    console.log(`CA ${year}: ${Object.keys(yearData).length} ridings`);
  }

  const outPath = join(OUT_DIR, 'ca-elections.json');
  writeFileSync(outPath, JSON.stringify(result));
  console.log(`CA: ${(readFileSync(outPath).length / 1024).toFixed(0)} KB`);
}

// ── AU Boundaries ──────────────────────────────────────────────────

function buildAUBoundaries() {
  const rawPath = join(TMP, 'au_boundaries_raw.geojson');
  if (!existsSync(rawPath)) {
    console.log('AU boundaries: skipped (no raw file)');
    return;
  }

  console.log('AU boundaries: clipping offshore + simplifying...');
  const data = JSON.parse(readFileSync(rawPath, 'utf8'));

  // Clip to mainland Australia + Tasmania
  const lonMin = 113, lonMax = 154, latMin = -44, latMax = -10;

  function roundCoords(coords, precision) {
    if (typeof coords[0] === 'number') {
      return coords.map(c => Math.round(c * precision) / precision);
    }
    return coords.map(c => roundCoords(c, precision));
  }

  const features = data.features
    .filter(f => f.geometry && f.geometry.coordinates?.length > 0)
    .map(f => {
      const name = f.properties.electorateName;
      if (f.geometry.type === 'Polygon') {
        const ring = f.geometry.coordinates[0];
        const avgLon = ring.reduce((s, c) => s + c[0], 0) / ring.length;
        const avgLat = ring.reduce((s, c) => s + c[1], 0) / ring.length;
        if (avgLon < lonMin || avgLon > lonMax || avgLat < latMin || avgLat > latMax) return null;
        return {
          type: 'Feature',
          properties: { name },
          geometry: { type: 'Polygon', coordinates: roundCoords(f.geometry.coordinates, 1000) },
        };
      }
      if (f.geometry.type === 'MultiPolygon') {
        const kept = f.geometry.coordinates.filter(poly => {
          const ring = poly[0];
          const avgLon = ring.reduce((s, c) => s + c[0], 0) / ring.length;
          const avgLat = ring.reduce((s, c) => s + c[1], 0) / ring.length;
          return avgLon >= lonMin && avgLon <= lonMax && avgLat >= latMin && avgLat <= latMax;
        });
        if (kept.length === 0) return null;
        return {
          type: 'Feature',
          properties: { name },
          geometry: kept.length === 1
            ? { type: 'Polygon', coordinates: roundCoords(kept[0], 1000) }
            : { type: 'MultiPolygon', coordinates: roundCoords(kept, 1000) },
        };
      }
      return null;
    })
    .filter(Boolean);

  const outPath = join(OUT_DIR, 'au-boundaries.geojson');
  const out = JSON.stringify({ type: 'FeatureCollection', features });
  writeFileSync(outPath, out);
  console.log(`AU boundaries: ${features.length} divisions, ${(out.length / 1024).toFixed(0)} KB`);
}

// ── CA Boundaries ──────────────────────────────────────────────────

function buildCABoundaries() {
  const rawPath = join(TMP, 'ca_boundaries_raw.geojson');
  if (!existsSync(rawPath)) {
    console.log('CA boundaries: skipped (no raw file)');
    return;
  }

  console.log('CA boundaries: simplifying...');
  const data = JSON.parse(readFileSync(rawPath, 'utf8'));

  function roundCoords(coords, precision) {
    if (typeof coords[0] === 'number') {
      return coords.map(c => Math.round(c * precision) / precision);
    }
    return coords.map(c => roundCoords(c, precision));
  }

  const simplified = {
    type: 'FeatureCollection',
    features: data.features.map(f => ({
      type: 'Feature',
      properties: {
        name: Array.isArray(f.properties.fed_name_en)
          ? f.properties.fed_name_en[0]
          : f.properties.fed_name_en,
      },
      geometry: {
        type: f.geometry.type,
        coordinates: roundCoords(f.geometry.coordinates, 1000),
      },
    })),
  };

  const outPath = join(OUT_DIR, 'ca-boundaries.geojson');
  writeFileSync(outPath, JSON.stringify(simplified));
  console.log(`CA boundaries: ${simplified.features.length} ridings, ${(readFileSync(outPath).length / 1024).toFixed(0)} KB`);
}

// ── Main ───────────────────────────────────────────────────────────

console.log('Building election data...\n');

const builders = {
  us: buildUS,
  uk: buildUK,
  au: buildAU,
  ca: buildCA,
  'au-boundaries': buildAUBoundaries,
  'ca-boundaries': buildCABoundaries,
};
const requested = process.argv.slice(2);
for (const name of requested) {
  if (!builders[name]) throw new Error(`Unknown target "${name}". Choose from: ${Object.keys(builders).join(', ')}`);
}
for (const name of requested.length ? requested : Object.keys(builders)) builders[name]();

console.log('\nDone! Files written to public/data/');
