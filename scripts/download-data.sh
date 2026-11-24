#!/bin/bash
# Download raw election data from open APIs and GitHub repos.
# Run this before scripts/build-election-data.mjs.
#
# Data sources:
#   US: stiles/presidential-elections (2000-2024 county results)
#       MEDSL/2024-elections-official (2024 precinct returns for AK and VA,
#       which fill the Alaska boroughs and Virginia cities the county file lacks)
#   UK: Electoral Calculus (constituency results per election)
#   AU: AEC Tally Room (first preferences by candidate by division)
#   CA: bwbecker/cdnFedElectionData (by riding) + Lucas-Czarnecki (candidates)
#   CA boundaries: OpenDataSoft federal electoral districts
#   US House: Call the Map (2026 results, CC BY 4.0), Census TIGER/Line cd120
#             (boundaries), Census CVAP special tabulation (eligible voters)
#
# The US House files go to ${RAW_DIR:-/tmp}/ushouse; everything else to /tmp.
# The US House section needs unzip, and npx to fetch mapshaper.

set -e

echo "=== Downloading election data ==="

# ── US ──────────────────────────────────────────────────────────
echo "US: county presidential results..."
curl -sL --max-time 60 \
  "https://raw.githubusercontent.com/stiles/presidential-elections/main/data/processed/presidential_county_results.json" \
  -o /tmp/us_county_results.json
echo "  $(wc -c < /tmp/us_county_results.json) bytes"

echo "US: MEDSL 2024 precinct returns (Alaska, Virginia)..."
for st in ak va; do
  curl -sL --max-time 120 \
    "https://raw.githubusercontent.com/MEDSL/2024-elections-official/main/individual_states/${st}24.zip" \
    -o "/tmp/us_medsl_${st}24.zip"
  unzip -p "/tmp/us_medsl_${st}24.zip" "${st}24.csv" > "/tmp/us_medsl_${st}24.csv"
  echo "  ${st}: $(wc -c < /tmp/us_medsl_${st}24.csv) bytes"
done

# ── UK ──────────────────────────────────────────────────────────
echo "UK: Electoral Calculus flat files..."
for file in electdata_2024.txt electdata_2019nb.txt electdata_2017.txt electdata_2015.txt electdata_2010.txt electdata_2005ob.txt electdata_2001ob.txt; do
  curl -sL --max-time 15 "https://www.electoralcalculus.co.uk/${file}" -o "/tmp/uk_${file}"
  echo "  ${file}: $(wc -c < /tmp/uk_${file}) bytes"
done

# ── AU ──────────────────────────────────────────────────────────
echo "AU: AEC first preferences by candidate..."
declare -A AEC_EVENTS=(
  [2025]=31496 [2022]=27966 [2019]=24310 [2016]=20499
  [2013]=17496 [2010]=15508 [2007]=13745 [2004]=12246
)
declare -A AEC_PATHS=(
  [2025]=Website [2022]=Website [2019]=Website [2016]=Website
  [2013]=Website [2010]=Website [2007]=website [2004]=results
)
for year in 2025 2022 2019 2016 2013 2010 2007 2004; do
  eid=${AEC_EVENTS[$year]}
  path=${AEC_PATHS[$year]}
  curl -sL --max-time 20 \
    "https://results.aec.gov.au/${eid}/${path}/Downloads/HouseFirstPrefsByCandidateByVoteTypeDownload-${eid}.csv" \
    -o "/tmp/au_${year}_candidates.csv"
  echo "  ${year}: $(wc -c < /tmp/au_${year}_candidates.csv) bytes"
done

# ── CA ──────────────────────────────────────────────────────────
echo "CA: bwbecker by-riding CSVs (2000-2019)..."
for year in 2000 2004 2006 2008 2011 2015 2019; do
  curl -sL --max-time 15 \
    "https://raw.githubusercontent.com/bwbecker/cdnFedElectionData/master/csv_by_riding/by_riding_${year}.csv" \
    -o "/tmp/ca_riding_${year}.csv"
  echo "  ${year}: $(wc -c < /tmp/ca_riding_${year}.csv) bytes"
done

echo "CA: Lucas-Czarnecki candidate CSVs (2021, 2025)..."
curl -sL --max-time 15 \
  "https://raw.githubusercontent.com/Lucas-Czarnecki/Canadian-Federal-Elections/main/data/cleaned/general_elections/2021-09-20.csv" \
  -o /tmp/ca_cand_2021.csv
echo "  2021: $(wc -c < /tmp/ca_cand_2021.csv) bytes"
curl -sL --max-time 15 \
  "https://raw.githubusercontent.com/Lucas-Czarnecki/Canadian-Federal-Elections/main/data/cleaned/general_elections/2025-04-28.csv" \
  -o /tmp/ca_cand_2025.csv
echo "  2025: $(wc -c < /tmp/ca_cand_2025.csv) bytes"

# ── AU boundaries ───────────────────────────────────────────────
echo "AU: electorate boundaries..."
curl -sL --max-time 30 \
  "https://raw.githubusercontent.com/pmcau/AustralianElectorates/main/Data/Maps/2025/australia_01.geojson" \
  -o /tmp/au_boundaries_raw.geojson
echo "  $(wc -c < /tmp/au_boundaries_raw.geojson) bytes"

# ── CA boundaries ───────────────────────────────────────────────
echo "CA: electoral district boundaries..."
curl -sL --max-time 30 \
  "https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets/georef-canada-federal-electoral-district/exports/geojson?limit=400" \
  -o /tmp/ca_boundaries_raw.geojson
echo "  $(wc -c < /tmp/ca_boundaries_raw.geojson) bytes"

# ── US House (2026 midterms) ────────────────────────────────────
USH="${RAW_DIR:-/tmp}/ushouse"
UA="truecolours-data-build"
mkdir -p "$USH/cd120" "$USH/shp" "$USH/states" "$USH/cvap" "$USH/cd120_bef"

echo "US House: district results (Call the Map)..."
curl -sL -A "$UA" --max-time 60 \
  "https://www.callthemap.com/results/data/2026/races.csv" -o "$USH/races.csv"
echo "  $(wc -c < "$USH/races.csv") bytes"

echo "US House: 120th Congress district boundaries (Census TIGER/Line)..."
for fips in 01 02 04 05 06 08 09 10 12 13 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 \
            30 31 32 33 34 35 36 37 38 39 40 41 42 44 45 46 47 48 49 50 51 53 54 55 56; do
  curl -sL -A "$UA" --max-time 120 \
    "https://www2.census.gov/geo/tiger/TIGER2026/CD/tl_2026_${fips}_cd120.zip" \
    -o "$USH/cd120/tl_2026_${fips}_cd120.zip"
  unzip -o -q "$USH/cd120/tl_2026_${fips}_cd120.zip" -d "$USH/shp"
done
echo "  $(ls "$USH"/shp/*.shp | wc -l) state files"

# TIGER/Line districts run out into the water; clip them to the shoreline
# with the cartographic state outlines.
curl -sL -A "$UA" --max-time 120 \
  "https://www2.census.gov/geo/tiger/GENZ2025/shp/cb_2025_us_state_5m.zip" -o "$USH/states_5m.zip"
unzip -o -q "$USH/states_5m.zip" -d "$USH/states"

echo "US House: clipping + simplifying boundaries..."
npx --yes mapshaper@0.8.9 -i "$USH"/shp/*.shp combine-files -merge-layers \
  -clip "$USH/states/cb_2025_us_state_5m.shp" \
  -simplify 1% keep-shapes -clean -filter-fields STATEFP,CD120FP \
  -o precision=0.001 format=geojson "$USH/boundaries_raw.geojson" \
  -dissolve STATEFP \
  -o precision=0.001 format=geojson "$USH/states_raw.geojson"
echo "  districts $(wc -c < "$USH/boundaries_raw.geojson") bytes, state outlines $(wc -c < "$USH/states_raw.geojson") bytes"

echo "US House: citizen voting-age population (Census CVAP, ~60 MB)..."
curl -sL -A "$UA" --max-time 300 \
  "https://www2.census.gov/programs-surveys/decennial/rdo/datasets/2024/2024-cvap/CVAP_2020-2024_ACS_csv_files.zip" \
  -o "$USH/cvap.zip"
unzip -o -q "$USH/cvap.zip" CD.csv BlockGr.csv -d "$USH/cvap"

echo "US House: block files for states redrawn for 2026 (~55 MB)..."
curl -sL -A "$UA" --max-time 300 \
  "https://www2.census.gov/programs-surveys/decennial/rdo/mapping-files/2027/120-congressional-district-befs/cd120.zip" \
  -o "$USH/cd120_bef.zip"
unzip -o -q "$USH/cd120_bef.zip" 'CD120_*.txt' -d "$USH/cd120_bef"

echo ""
echo "=== Download complete ==="
echo "Now run: node scripts/build-election-data.mjs"
