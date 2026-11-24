// US House of Representatives (2026 midterms) data build.
//
// Results:     Call the Map (callthemap.com/results/data), CC BY 4.0.  One row
//              per candidate per race, read from each state's election office
//              or civicAPI.  Counts are UNOFFICIAL until each state certifies;
//              re-run the download + build to refresh them.
// Boundaries:  Census TIGER/Line 120th Congress districts (cd120), clipped
//              to the shoreline and simplified by scripts/download-data.sh.
// Eligible:    Census CVAP special tabulation (2020-2024 ACS).  Published
//              for 119th Congress districts; states that redrew for 2026 are
//              re-aggregated from block groups via the cd120 block files.
//
// Raw inputs live in <RAW_DIR>/ushouse/ (see scripts/download-data.sh).

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

export const USHOUSE_YEAR = 2026;

// name → [postal, FIPS, number of House seats in the 120th Congress]
export const STATES = {
  Alabama: ['AL', '01', 7], Alaska: ['AK', '02', 1], Arizona: ['AZ', '04', 9],
  Arkansas: ['AR', '05', 4], California: ['CA', '06', 52], Colorado: ['CO', '08', 8],
  Connecticut: ['CT', '09', 5], Delaware: ['DE', '10', 1], Florida: ['FL', '12', 28],
  Georgia: ['GA', '13', 14], Hawaii: ['HI', '15', 2], Idaho: ['ID', '16', 2],
  Illinois: ['IL', '17', 17], Indiana: ['IN', '18', 9], Iowa: ['IA', '19', 4],
  Kansas: ['KS', '20', 4], Kentucky: ['KY', '21', 6], Louisiana: ['LA', '22', 6],
  Maine: ['ME', '23', 2], Maryland: ['MD', '24', 8], Massachusetts: ['MA', '25', 9],
  Michigan: ['MI', '26', 13], Minnesota: ['MN', '27', 8], Mississippi: ['MS', '28', 4],
  Missouri: ['MO', '29', 8], Montana: ['MT', '30', 2], Nebraska: ['NE', '31', 3],
  Nevada: ['NV', '32', 4], 'New Hampshire': ['NH', '33', 2], 'New Jersey': ['NJ', '34', 12],
  'New Mexico': ['NM', '35', 3], 'New York': ['NY', '36', 26], 'North Carolina': ['NC', '37', 14],
  'North Dakota': ['ND', '38', 1], Ohio: ['OH', '39', 15], Oklahoma: ['OK', '40', 5],
  Oregon: ['OR', '41', 6], Pennsylvania: ['PA', '42', 17], 'Rhode Island': ['RI', '44', 2],
  'South Carolina': ['SC', '45', 7], 'South Dakota': ['SD', '46', 1], Tennessee: ['TN', '47', 9],
  Texas: ['TX', '48', 38], Utah: ['UT', '49', 4], Vermont: ['VT', '50', 1],
  Virginia: ['VA', '51', 11], Washington: ['WA', '53', 10], 'West Virginia': ['WV', '54', 2],
  Wisconsin: ['WI', '55', 8], Wyoming: ['WY', '56', 1],
};

const FIPS_TO_STATE = Object.fromEntries(
  Object.entries(STATES).map(([name, [, fips]]) => [fips, name]),
);

/** Region key shared by the results file and the boundary file. */
export function districtName(state, district) {
  return STATES[state][2] === 1 ? `${state} At-Large` : `${state} District ${district}`;
}

// ─── Eligible voters (CVAP) ────────────────────────────────────────

/** Minimal CSV line splitter (handles quoted fields). */
function csvSplit(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Read a CVAP csv and return Map(geoid → total CVAP estimate). */
function readCvapTotals(path) {
  const lines = readFileSync(path, 'latin1').split(/\r?\n/);
  const head = csvSplit(lines[0]).map((h) => h.trim().toLowerCase());
  const iGeo = head.indexOf('geoid');
  const iLine = head.indexOf('lnnumber');
  const iCvap = head.indexOf('cvap_est');
  const map = new Map();
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const c = csvSplit(lines[i]);
    if (c[iLine] !== '1') continue; // line 1 = Total
    // geoid looks like "5001900US0101" / "1500000US010010201001"
    map.set(c[iGeo].split('US')[1], parseInt(c[iCvap], 10) || 0);
  }
  return map;
}

/**
 * Citizen voting-age population per 2026 district, keyed by 4-digit GEOID
 * (state FIPS + district, "00" for at-large).
 *
 * States with a cd120 block file are re-aggregated: each block group's CVAP
 * is split between districts in proportion to how many of its census blocks
 * fall in each.  Most block groups sit wholly inside one district, so the
 * approximation only touches the ones a boundary cuts through.
 */
export function buildEligible(rawDir) {
  const dir = join(rawDir, 'ushouse', 'cvap');
  const cd = readCvapTotals(join(dir, 'CD.csv'));
  const eligible = new Map(cd);

  const befDir = join(rawDir, 'ushouse', 'cd120_bef');
  const befFiles = existsSync(befDir) ? readdirSync(befDir).filter((f) => /^CD120_\d\d\.txt$/i.test(f)) : [];
  if (!befFiles.length) return { eligible, redrawn: [] };

  const bg = readCvapTotals(join(dir, 'BlockGr.csv'));
  const redrawn = [];
  for (const file of befFiles) {
    const lines = readFileSync(join(befDir, file), 'utf8').split(/\r?\n/);
    // bg → Map(district → block count)
    const split = new Map();
    let stateFips = null;
    for (const line of lines) {
      // GEOID,STATEFP,COUNTYFP,TRACTCE,BLOCKCE,CDFP
      const cols = line.split(',');
      const block = cols[0].trim();
      const district = (cols[cols.length - 1] || '').trim();
      if (!/^\d{15}$/.test(block) || !/^\d+$/.test(district)) continue;
      stateFips = block.slice(0, 2);
      const key = block.slice(0, 12);
      let d = split.get(key);
      if (!d) split.set(key, (d = new Map()));
      d.set(district, (d.get(district) || 0) + 1);
    }
    if (!stateFips || !FIPS_TO_STATE[stateFips]) continue;

    const totals = new Map();
    for (const [key, dists] of split) {
      const pop = bg.get(key) || 0;
      if (!pop) continue;
      let blocks = 0;
      for (const n of dists.values()) blocks += n;
      for (const [district, n] of dists) {
        totals.set(district, (totals.get(district) || 0) + (pop * n) / blocks);
      }
    }
    for (const key of [...eligible.keys()]) if (key.startsWith(stateFips)) eligible.delete(key);
    for (const [district, pop] of totals) {
      eligible.set(stateFips + district.padStart(2, '0'), Math.round(pop));
    }
    redrawn.push(FIPS_TO_STATE[stateFips]);
  }
  return { eligible, redrawn: redrawn.sort() };
}

// ─── Results ───────────────────────────────────────────────────────

const PARTY = { D: 'dem', R: 'rep' }; // everything else → 'oth'

/** Read races.csv and group the House rows by race id ("NV-01", "AK-AL"). */
function readHouseRaces(path) {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  const head = csvSplit(lines[0]);
  const races = new Map();
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const cols = csvSplit(lines[i]);
    const row = Object.fromEntries(head.map((h, j) => [h, cols[j] ?? '']));
    if (row.office !== 'House') continue;
    if (!races.has(row.race_id)) races.set(row.race_id, []);
    races.get(row.race_id).push(row);
  }
  return races;
}

export function buildUSHouse(rawDir, outDir) {
  const racesPath = join(rawDir, 'ushouse', 'races.csv');
  if (!existsSync(racesPath)) {
    console.log('US House: skipped (no raw files)');
    return;
  }
  console.log('US House: Processing 2026 district results...');

  const races = readHouseRaces(racesPath);
  const { eligible, redrawn } = buildEligible(rawDir);
  if (redrawn.length) console.log(`US House: eligible voters re-aggregated for ${redrawn.join(', ')}`);

  const yearData = {};
  const problems = [];
  const tally = { uncontested: 0, pending: 0 };
  let asOf = '';
  for (const [state, [postal, fips, seats]] of Object.entries(STATES)) {
    for (let d = 1; d <= seats; d++) {
      const name = districtName(state, d);
      const at = seats === 1;
      const rows = races.get(`${postal}-${at ? 'AL' : String(d).padStart(2, '0')}`);
      if (!rows) { problems.push(`${name}: no result rows`); continue; }

      const entry = { dem: 0, rep: 0, oth: 0 };
      for (const r of rows) {
        entry[PARTY[r.party] || 'oth'] += parseInt(r.votes, 10) || 0;
        if (r.source_read_utc > asOf) asOf = r.source_read_utc;
      }
      const total = entry.dem + entry.rep + entry.oth;

      const elig = eligible.get(fips + (at ? '00' : String(d).padStart(2, '0')));
      if (elig) entry.eligible = Math.max(elig, total);
      else problems.push(`${name}: no eligible-voter figure`);

      // The winner is only stored where the votes can't show it: an unopposed
      // candidate whose state tallied no votes.
      const won = rows.filter((r) => r.outcome === 'won');
      if (won.length === 1) {
        if (total === 0) entry.winner = PARTY[won[0].party] || 'oth';
      } else {
        // Still counting, recount, runoff or ranked-choice rounds to come.
        entry.pending = rows[0].reason || 'not yet called';
        tally.pending++;
      }
      if (rows.length === 1) { entry.uncontested = true; tally.uncontested++; }
      if (total === 0 && !entry.winner) problems.push(`${name}: no votes and no winner`);
      yearData[name] = entry;
    }
  }

  const outPath = join(outDir, 'ushouse-elections.json');
  writeFileSync(outPath, JSON.stringify({ [USHOUSE_YEAR]: yearData }));
  console.log(`US House ${USHOUSE_YEAR}: ${Object.keys(yearData).length} districts, `
    + `${tally.uncontested} uncontested, ${tally.pending} not final, counts as of ${asOf}`);
  for (const p of problems) console.log(`  ! ${p}`);
  console.log(`US House: ${(readFileSync(outPath).length / 1024).toFixed(0)} KB`);
  return { yearData, problems, asOf };
}

// ─── Boundaries ────────────────────────────────────────────────────

export function buildUSHouseBoundaries(rawDir, outDir) {
  // Clipped, simplified and coordinate-rounded by mapshaper in download-data.sh.
  const rawPath = join(rawDir, 'ushouse', 'boundaries_raw.geojson');
  if (!existsSync(rawPath)) {
    console.log('US House boundaries: skipped (no raw file)');
    return;
  }
  console.log('US House boundaries: naming districts...');
  const data = JSON.parse(readFileSync(rawPath, 'utf8'));

  const features = [];
  for (const f of data.features) {
    const state = FIPS_TO_STATE[f.properties.STATEFP];
    const cd = f.properties.CD120FP;
    // Skips DC, territories and the "ZZ" water-only areas.
    if (!state || !/^\d\d$/.test(cd) || !f.geometry) continue;
    features.push({
      type: 'Feature',
      properties: { name: districtName(state, parseInt(cd, 10) || 1) },
      geometry: f.geometry,
    });
  }
  features.sort((a, b) => a.properties.name.localeCompare(b.properties.name, 'en', { numeric: true }));

  const outPath = join(outDir, 'ushouse-boundaries.geojson');
  const out = JSON.stringify({ type: 'FeatureCollection', features });
  writeFileSync(outPath, out);
  console.log(`US House boundaries: ${features.length} districts, ${(out.length / 1024).toFixed(0)} KB`);

  // State outlines dissolved from the same simplified districts, so the
  // heavier state borders sit exactly on top of the district borders.
  const statesPath = join(rawDir, 'ushouse', 'states_raw.geojson');
  if (!existsSync(statesPath)) return;
  const states = JSON.parse(readFileSync(statesPath, 'utf8')).features
    .filter((f) => FIPS_TO_STATE[f.properties.STATEFP] && f.geometry)
    .map((f) => ({ type: 'Feature', properties: {}, geometry: f.geometry }));
  const statesOut = JSON.stringify({ type: 'FeatureCollection', features: states });
  writeFileSync(join(outDir, 'ushouse-states.geojson'), statesOut);
  console.log(`US House state outlines: ${states.length} states, ${(statesOut.length / 1024).toFixed(0)} KB`);
}
