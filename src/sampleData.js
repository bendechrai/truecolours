// Seeded PRNG (mulberry32) and deterministic sample election data generator

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Hash a string to a number for seeding
function hashStr(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}

/**
 * Generate sample election data for a country.
 * Returns: { [year]: { [regionIndex]: { votes: { partyId: count }, eligible: number } } }
 *
 * Each region gets a persistent partisan lean that drifts slightly per election.
 * National swing alternates to avoid systematic bias.
 */
export function generateSampleData(countryId, config, regionCount) {
  const { parties, elections } = config;
  const data = {};
  const baseSeed = hashStr(countryId);
  const rng = mulberry32(baseSeed);

  // Generate persistent base lean for each region
  const regionLeans = [];
  for (let r = 0; r < regionCount; r++) {
    const lean = {};
    let total = 0;
    for (const party of parties) {
      const val = rng() * rng(); // skew toward lower values for variety
      lean[party.id] = val;
      total += val;
    }
    // Normalise
    for (const party of parties) {
      lean[party.id] /= total;
    }
    regionLeans.push(lean);
  }

  // Generate swing pattern — alternates direction
  const swings = elections.map((_, i) => {
    const magnitude = 0.04 + 0.06 * Math.sin(i * 1.7);
    const partyIndex = i % parties.length;
    return { partyIndex, magnitude };
  });

  for (let ei = 0; ei < elections.length; ei++) {
    const year = elections[ei];
    const yearData = {};
    const yearRng = mulberry32(baseSeed + year);
    const swing = swings[ei];

    for (let r = 0; r < regionCount; r++) {
      const baseLean = regionLeans[r];
      const eligible = 20000 + Math.floor(yearRng() * 80000); // 20k-100k eligible voters

      // Apply drift: slight random walk per region per election
      const driftedLean = {};
      let total = 0;
      for (let pi = 0; pi < parties.length; pi++) {
        const party = parties[pi];
        let val = baseLean[party.id];
        // Per-region random drift
        val += (yearRng() - 0.5) * 0.08;
        // National swing
        if (pi === swing.partyIndex) {
          val += swing.magnitude;
        } else {
          val -= swing.magnitude / (parties.length - 1);
        }
        val = Math.max(0.001, val);
        driftedLean[party.id] = val;
        total += val;
      }
      // Normalise
      for (const party of parties) {
        driftedLean[party.id] /= total;
      }

      // Turnout: 45-75%
      const turnout = 0.45 + yearRng() * 0.30;
      const totalVotes = Math.floor(eligible * turnout);

      // Distribute votes
      const votes = {};
      let assigned = 0;
      for (let pi = 0; pi < parties.length; pi++) {
        const party = parties[pi];
        if (pi === parties.length - 1) {
          votes[party.id] = totalVotes - assigned;
        } else {
          const count = Math.floor(driftedLean[party.id] * totalVotes);
          votes[party.id] = count;
          assigned += count;
        }
      }

      yearData[r] = { votes, eligible };
    }
    data[year] = yearData;
  }

  return data;
}

/**
 * Fisher-Yates shuffle with a seed
 */
export function seededShuffle(arr, seed) {
  const rng = mulberry32(seed);
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
