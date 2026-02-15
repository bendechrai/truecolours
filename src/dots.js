// Two-pass dot placement, colouring, canvas rendering, and hit-test ID canvas

import * as d3 from 'd3';
import { DOT_RADIUS_DESKTOP, DOT_RADIUS_MOBILE, MOBILE_BREAKPOINT } from './config.js';

// Seeded PRNG (mulberry32)
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fisher-Yates shuffle with a seed
function seededShuffle(arr, seed) {
  const rng = mulberry32(seed);
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Place dots proportional to each feature's eligible voter count.
 *
 * 1. Rasterise all features into a feature-ID canvas
 * 2. Collect pixel coordinates per feature
 * 3. Allocate dots to features proportional to eligible voters (latest year)
 * 4. Randomly sample that many pixels per feature (seeded for determinism)
 *
 * Dense urban areas receive many dots; sparse rural areas receive few —
 * so the visual weight matches the actual number of voters, not the
 * geographic size of the region.
 *
 * Returns: [{ featureIndex, x, y }]  (screen-space coordinates)
 */
export function computeDots(features, projection, dotBudget, width, height, electionData, elections) {
  if (!width || !height) return [];

  // Step 1: build a feature-ID raster (same idea as the hit-test canvas)
  const idCanvas = new OffscreenCanvas(width, height);
  const idCtx = idCanvas.getContext('2d', { willReadFrequently: true });
  const pathGen = d3.geoPath(projection, idCtx);

  for (let i = 0; i < features.length; i++) {
    const r = (i + 1) & 0xff;
    const g = ((i + 1) >> 8) & 0xff;
    const b = ((i + 1) >> 16) & 0xff;
    idCtx.fillStyle = `rgb(${r},${g},${b})`;
    idCtx.beginPath();
    pathGen(features[i]);
    idCtx.fill('evenodd');
  }

  const idData = idCtx.getImageData(0, 0, width, height).data;

  // Step 2: collect pixel positions per feature
  const featurePixels = new Map(); // featureIndex → [pixelIndex, …]
  const totalPixels = width * height;

  for (let i = 0; i < totalPixels; i++) {
    const offset = i * 4;
    if (idData[offset + 3] === 0) continue;
    const fi = (idData[offset] | (idData[offset + 1] << 8) | (idData[offset + 2] << 16)) - 1;
    if (!featurePixels.has(fi)) featurePixels.set(fi, []);
    featurePixels.get(fi).push(i);
  }

  if (featurePixels.size === 0) return [];

  // Step 3: determine dot allocation per feature from eligible voter counts.
  // Use the latest election year that has data; fall back to geographic if
  // no election data is available.
  let yearData = null;
  if (electionData && elections) {
    for (let yi = elections.length - 1; yi >= 0; yi--) {
      const yd = electionData[elections[yi]];
      if (yd && Object.keys(yd).length > 0) { yearData = yd; break; }
    }
  }

  let totalEligible = 0;
  if (yearData) {
    for (const fi of featurePixels.keys()) {
      totalEligible += yearData[fi]?.eligible || 0;
    }
  }

  // If we have no voter data, fall back to uniform geographic placement
  const usePopulation = totalEligible > 0;

  // Step 4: sample dots per feature
  const rng = mulberry32(42);
  const dots = [];

  for (const [fi, pixels] of featurePixels) {
    let targetDots;

    if (usePopulation) {
      const eligible = yearData[fi]?.eligible || 0;
      targetDots = Math.round((eligible / totalEligible) * dotBudget);
      // Ensure at least 1 dot for any feature with voters
      if (eligible > 0 && targetDots === 0) targetDots = 1;
    } else {
      // Geographic fallback: dots proportional to pixel area
      targetDots = Math.round((pixels.length / totalPixels) * dotBudget);
      if (targetDots === 0 && pixels.length > 0) targetDots = 1;
    }

    // Cap at available pixels (each pixel can hold at most one dot)
    targetDots = Math.min(targetDots, pixels.length);

    // Fisher-Yates partial shuffle to pick targetDots random pixels
    const arr = pixels.slice();
    for (let i = 0; i < targetDots; i++) {
      const j = i + Math.floor(rng() * (arr.length - i));
      const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }

    for (let i = 0; i < targetDots; i++) {
      const px = arr[i] % width;
      const py = (arr[i] / width) | 0;
      // Small jitter for a natural scattered look
      dots.push({ featureIndex: fi, x: px + rng() * 0.6 - 0.3, y: py + rng() * 0.6 - 0.3 });
    }
  }

  return dots;
}

/**
 * Colour dots based on election data for a given year.
 * Returns a typed array of RGB colours for each dot: Uint8Array of length dots.length * 3
 */
export function colourDots(dots, electionData, features, parties, year, showNonVoters) {
  const yearData = electionData[year];
  if (!yearData) return new Uint8Array(dots.length * 3);

  // Group dots by feature index
  const featureGroups = new Map();
  for (let i = 0; i < dots.length; i++) {
    const fi = dots[i].featureIndex;
    if (!featureGroups.has(fi)) featureGroups.set(fi, []);
    featureGroups.get(fi).push(i);
  }

  const colours = new Uint8Array(dots.length * 3);

  // Threshold: features with this many dots or fewer get blended colours
  // so that even a single dot faithfully represents the vote split.
  const BLEND_THRESHOLD = 6;

  for (const [fi, dotIndices] of featureGroups) {
    const regionData = yearData[fi];
    if (!regionData) continue;

    const { votes, eligible } = regionData;
    const totalVotes = Object.values(votes).reduce((a, b) => a + b, 0);
    const nonVoters = eligible - totalVotes;
    const denominator = showNonVoters ? eligible : totalVotes;
    if (denominator === 0) continue;

    if (dotIndices.length <= BLEND_THRESHOLD) {
      // Blend to weighted average colour — each dot shows the proportional mix
      const blended = [0, 0, 0];
      for (const party of parties) {
        const share = (votes[party.id] || 0) / denominator;
        const rgb = hexToRgb(party.colour);
        blended[0] += share * rgb[0];
        blended[1] += share * rgb[1];
        blended[2] += share * rgb[2];
      }
      if (showNonVoters) {
        const nvShare = nonVoters / denominator;
        const nvRgb = hexToRgb('#CFCFCF');
        blended[0] += nvShare * nvRgb[0];
        blended[1] += nvShare * nvRgb[1];
        blended[2] += nvShare * nvRgb[2];
      }
      const br = Math.round(blended[0]);
      const bg = Math.round(blended[1]);
      const bb = Math.round(blended[2]);
      for (const di of dotIndices) {
        colours[di * 3] = br;
        colours[di * 3 + 1] = bg;
        colours[di * 3 + 2] = bb;
      }
    } else {
      // Enough dots — assign each to a single party for the speckled effect
      const colourAssignments = [];
      for (const party of parties) {
        const count = votes[party.id] || 0;
        const share = count / denominator;
        const numDots = Math.round(share * dotIndices.length);
        const rgb = hexToRgb(party.colour);
        for (let j = 0; j < numDots; j++) {
          colourAssignments.push(rgb);
        }
      }

      if (showNonVoters) {
        const nonVoterShare = nonVoters / denominator;
        const numNonVoterDots = Math.round(nonVoterShare * dotIndices.length);
        const rgb = hexToRgb('#CFCFCF');
        for (let j = 0; j < numNonVoterDots; j++) {
          colourAssignments.push(rgb);
        }
      }

      // Pad or trim to match dot count
      while (colourAssignments.length < dotIndices.length) {
        colourAssignments.push(colourAssignments[colourAssignments.length - 1] || [0, 0, 0]);
      }
      colourAssignments.length = dotIndices.length;

      // Shuffle colours deterministically (seeded by year + feature index)
      const shuffled = seededShuffle(colourAssignments, year * 10000 + fi);

      // Assign to output
      for (let j = 0; j < dotIndices.length; j++) {
        const di = dotIndices[j];
        const rgb = shuffled[j];
        colours[di * 3] = rgb[0];
        colours[di * 3 + 1] = rgb[1];
        colours[di * 3 + 2] = rgb[2];
      }
    }
  }

  return colours;
}

/**
 * Render dots to a canvas.
 */
export function renderDots(ctx, dots, colours, dpr) {
  const isMobile = window.innerWidth < MOBILE_BREAKPOINT;
  const radius = (isMobile ? DOT_RADIUS_MOBILE : DOT_RADIUS_DESKTOP) * dpr;

  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  for (let i = 0; i < dots.length; i++) {
    const r = colours[i * 3];
    const g = colours[i * 3 + 1];
    const b = colours[i * 3 + 2];

    // Skip dots with no election data (unmapped regions default to 0,0,0)
    if (r === 0 && g === 0 && b === 0) continue;

    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.beginPath();
    ctx.arc(dots[i].x * dpr, dots[i].y * dpr, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Render region borders and country outline.
 */
export function renderBorders(ctx, geoData, projection, dpr) {
  const pathGen = d3.geoPath(projection, ctx);

  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.save();
  ctx.scale(dpr, dpr);

  // US-style pre-computed mesh borders (state lines)
  if (geoData.stateBorders) {
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    pathGen(geoData.stateBorders);
    ctx.stroke();
  }

  // GeoJSON countries: draw individual region borders
  if (geoData.regionBorders && geoData.features) {
    ctx.strokeStyle = 'rgba(0,0,0,0.1)';
    ctx.lineWidth = 0.3;
    for (const feature of geoData.features) {
      ctx.beginPath();
      pathGen(feature);
      ctx.stroke();
    }
  }

  // Country outline (darker, thicker)
  if (geoData.outline) {
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    pathGen(geoData.outline);
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Build an offscreen ID canvas for fast hit-testing.
 * Each feature is rendered with a unique colour encoding its index.
 * Returns: { canvas, getFeatureIndex(x, y) }
 */
export function buildHitTestCanvas(features, projection, width, height, dpr) {
  const canvas = new OffscreenCanvas(width * dpr, height * dpr);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.scale(dpr, dpr);

  const pathGen = d3.geoPath(projection, ctx);

  for (let i = 0; i < features.length; i++) {
    // Encode feature index as RGB (supports up to 16M features)
    const r = (i + 1) & 0xff;
    const g = ((i + 1) >> 8) & 0xff;
    const b = ((i + 1) >> 16) & 0xff;
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.beginPath();
    pathGen(features[i]);
    ctx.fill('evenodd');
  }

  const imageData = ctx.getImageData(0, 0, width * dpr, height * dpr);
  const data = imageData.data;

  function getFeatureIndex(x, y) {
    const px = Math.round(x * dpr);
    const py = Math.round(y * dpr);
    if (px < 0 || px >= width * dpr || py < 0 || py >= height * dpr) return -1;
    const offset = (py * width * dpr + px) * 4;
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    const a = data[offset + 3];
    if (a === 0) return -1;
    return (r | (g << 8) | (b << 16)) - 1;
  }

  return { canvas, getFeatureIndex };
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}
