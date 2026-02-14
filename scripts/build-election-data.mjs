#!/usr/bin/env node
// Build script: transforms downloaded raw election data into compact JSON.
// Output: public/data/{country}-elections.json
//
// Prerequisites: run scripts/download-data.sh first to fetch raw data to /tmp/
//
// Data sources:
//   US: stiles/presidential-elections (GitHub) → /tmp/us_county_results.json
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

function buildUS() {
  console.log('US: Processing county results...');
  const raw = JSON.parse(readLocal('us_county_results.json'));

  const result = {};
  for (const r of raw) {
    const year = String(r.year);
    if (!result[year]) result[year] = {};
    const fips = String(r.fips).padStart(5, '0');
    const dem = num(r.votes_dem);
    const rep = num(r.votes_rep);
    const all = num(r.votes_all);
    result[year][fips] = { dem, rep, oth: Math.max(0, all - dem - rep) };
  }

  const outPath = join(OUT_DIR, 'us-elections.json');
  writeFileSync(outPath, JSON.stringify(result));
  const years = Object.keys(result).sort();
  console.log(`US: ${years.length} years, ${Object.keys(result[years[years.length - 1]]).length} counties`);
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

buildUS();
buildUK();
buildAU();
buildCA();
buildCABoundaries();

console.log('\nDone! Files written to public/data/');
