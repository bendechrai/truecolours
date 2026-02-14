#!/bin/bash
# Download raw election data from open APIs and GitHub repos.
# Run this before scripts/build-election-data.mjs.
#
# Data sources:
#   US: stiles/presidential-elections (2000-2024 county results)
#   UK: Electoral Calculus (constituency results per election)
#   AU: AEC Tally Room (first preferences by candidate by division)
#   CA: bwbecker/cdnFedElectionData (by riding) + Lucas-Czarnecki (candidates)
#   CA boundaries: OpenDataSoft federal electoral districts

set -e

echo "=== Downloading election data ==="

# ── US ──────────────────────────────────────────────────────────
echo "US: county presidential results..."
curl -sL --max-time 60 \
  "https://raw.githubusercontent.com/stiles/presidential-elections/main/data/processed/presidential_county_results.json" \
  -o /tmp/us_county_results.json
echo "  $(wc -c < /tmp/us_county_results.json) bytes"

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

# ── CA boundaries ───────────────────────────────────────────────
echo "CA: electoral district boundaries..."
curl -sL --max-time 30 \
  "https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets/georef-canada-federal-electoral-district/exports/geojson?limit=400" \
  -o /tmp/ca_boundaries_raw.geojson
echo "  $(wc -c < /tmp/ca_boundaries_raw.geojson) bytes"

echo ""
echo "=== Download complete ==="
echo "Now run: node scripts/build-election-data.mjs"
