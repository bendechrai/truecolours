// Two-pass dot placement, colouring, canvas rendering, and hit-test ID canvas

import * as d3 from 'd3';
import { measureFeatureArea } from './geoLoader.js';
import { seededShuffle } from './sampleData.js';
import { DOT_RADIUS_DESKTOP, DOT_RADIUS_MOBILE, MOBILE_BREAKPOINT, TEST_CANVAS_SIZE } from './config.js';

/**
 * Pass 1 & 2: Compute dot positions for all features.
 *
 * 1. Measure actual rendered area of each feature
 * 2. Distribute global dot budget proportionally by area
 * 3. Place dots via rejection sampling inside each feature
 *
 * Returns: [{ featureIndex, x, y }]  (screen-space coordinates)
 */
export function computeDots(features, projection, dotBudget) {
  // Pass 1: measure areas
  const areas = features.map((f) => measureFeatureArea(f, projection));
  const totalArea = areas.reduce((sum, a) => sum + a.pixelArea, 0);

  if (totalArea === 0) return [];

  // Pass 2: distribute dots and place via rejection sampling
  const allDots = [];
  const pathGen = d3.geoPath(projection);

  for (let i = 0; i < features.length; i++) {
    const { pixelArea, bounds } = areas[i];
    if (pixelArea <= 0) continue;

    const share = pixelArea / totalArea;
    const numDots = Math.max(1, Math.round(share * dotBudget));

    const bx = bounds[0][0];
    const by = bounds[0][1];
    const bw = bounds[1][0] - bounds[0][0];
    const bh = bounds[1][1] - bounds[0][1];

    if (bw <= 0 || bh <= 0) continue;

    // Rasterise this feature for point-in-polygon testing
    const scale = Math.min(TEST_CANVAS_SIZE / bw, TEST_CANVAS_SIZE / bh);
    const testCanvas = new OffscreenCanvas(TEST_CANVAS_SIZE, TEST_CANVAS_SIZE);
    const testCtx = testCanvas.getContext('2d');
    testCtx.save();
    testCtx.scale(scale, scale);
    testCtx.translate(-bx, -by);
    testCtx.fillStyle = '#000';
    testCtx.beginPath();
    d3.geoPath(projection, testCtx)(features[i]);
    testCtx.fill();
    testCtx.restore();

    const testData = testCtx.getImageData(0, 0, TEST_CANVAS_SIZE, TEST_CANVAS_SIZE).data;

    // Seeded rejection sampling
    let seed = i * 7919 + 12345;
    function lcg() {
      seed = (seed * 1664525 + 1013904223) & 0xffffffff;
      return (seed >>> 0) / 4294967296;
    }

    let placed = 0;
    let attempts = 0;
    const maxAttempts = numDots * 100;

    while (placed < numDots && attempts < maxAttempts) {
      attempts++;
      const rx = lcg();
      const ry = lcg();
      const sx = bx + rx * bw; // screen x
      const sy = by + ry * bh; // screen y

      // Check against rasterised mask
      const tx = Math.floor(rx * bw * scale);
      const ty = Math.floor(ry * bh * scale);
      if (tx < 0 || tx >= TEST_CANVAS_SIZE || ty < 0 || ty >= TEST_CANVAS_SIZE) continue;

      const alpha = testData[(ty * TEST_CANVAS_SIZE + tx) * 4 + 3];
      if (alpha === 0) continue;

      allDots.push({ featureIndex: i, x: sx, y: sy });
      placed++;
    }
  }

  return allDots;
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

  for (const [fi, dotIndices] of featureGroups) {
    const regionData = yearData[fi];
    if (!regionData) continue;

    const { votes, eligible } = regionData;
    const totalVotes = Object.values(votes).reduce((a, b) => a + b, 0);
    const nonVoters = eligible - totalVotes;

    // Build colour assignments
    const colourAssignments = [];
    const denominator = showNonVoters ? eligible : totalVotes;

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

  // State/region borders (thin, light)
  if (geoData.stateBorders) {
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    pathGen(geoData.stateBorders);
    ctx.stroke();
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
    ctx.fill();
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
