// Proportional pie-chart symbols, border rendering, and hit-test ID canvas

import * as d3 from 'd3';

// Coverage: fraction of map area allocated to total symbol area (sum of all pies)
const SYMBOL_COVERAGE = 0.10;

// Minimum symbol radius in screen pixels (so tiny features stay visible)
const SYMBOL_MIN_RADIUS = 1.5;

// Pies smaller than this (screen px) are drawn as a single blended dot
const BLEND_RADIUS = 2;

// ─── Compute symbols ─────────────────────────────────────────────

/**
 * Place one proportional pie-chart symbol per feature.
 *
 * Each symbol is positioned at the projected centroid of its feature.
 * Radius is set so that circle AREA is proportional to eligible voters.
 * Dense urban areas get large pies; sparse rural areas get small dots.
 *
 * Returns: [{ featureIndex, x, y, radius }]  (screen-space coordinates)
 */
export function computeSymbols(features, projection, width, height, electionData, elections) {
  if (!width || !height || !features.length) return [];

  const pathGen = d3.geoPath(projection);

  // Find the latest year with election data
  let yearData = null;
  if (electionData && elections) {
    for (let yi = elections.length - 1; yi >= 0; yi--) {
      const yd = electionData[elections[yi]];
      if (yd && Object.keys(yd).length > 0) { yearData = yd; break; }
    }
  }

  // Gather per-feature eligible voter counts
  let totalEligible = 0;
  const eligibles = new Array(features.length);
  for (let i = 0; i < features.length; i++) {
    const e = yearData?.[i]?.eligible || 0;
    eligibles[i] = e;
    totalEligible += e;
  }

  if (totalEligible === 0) return [];

  // Area budget: the total circle area across all symbols
  const mapArea = width * height;
  const totalSymbolArea = mapArea * SYMBOL_COVERAGE;

  // Build one symbol per feature
  const symbols = [];
  for (let i = 0; i < features.length; i++) {
    if (eligibles[i] === 0) continue;

    const centroid = pathGen.centroid(features[i]);
    if (!centroid || isNaN(centroid[0]) || isNaN(centroid[1])) continue;

    const area = (eligibles[i] / totalEligible) * totalSymbolArea;
    const radius = Math.max(Math.sqrt(area / Math.PI), SYMBOL_MIN_RADIUS);

    symbols.push({ featureIndex: i, x: centroid[0], y: centroid[1], radius });
  }

  return symbols;
}

// ─── Colour symbols ──────────────────────────────────────────────

/**
 * Compute pie-chart slices for each symbol for a given election year.
 *
 * Returns an array parallel to `symbols`.  Each element is:
 *   { slices: [{ startAngle, endAngle, r, g, b }] }
 */
export function colourSymbols(symbols, electionData, features, parties, year, showNonVoters) {
  const yearData = electionData[year];
  if (!yearData) return symbols.map(() => ({ slices: [] }));

  const TWO_PI = Math.PI * 2;

  return symbols.map((sym) => {
    const regionData = yearData[sym.featureIndex];
    if (!regionData) return { slices: [] };

    const { votes, eligible } = regionData;
    const totalVotes = Object.values(votes).reduce((a, b) => a + b, 0);
    const nonVoters = eligible - totalVotes;
    const denominator = showNonVoters ? eligible : totalVotes;
    if (denominator === 0) return { slices: [] };

    const slices = [];
    let angle = -Math.PI / 2; // start at 12 o'clock

    for (const party of parties) {
      const count = votes[party.id] || 0;
      if (count <= 0) continue;
      const endAngle = angle + (count / denominator) * TWO_PI;
      const rgb = hexToRgb(party.colour);
      slices.push({ startAngle: angle, endAngle, r: rgb[0], g: rgb[1], b: rgb[2] });
      angle = endAngle;
    }

    if (showNonVoters && nonVoters > 0) {
      const endAngle = angle + (nonVoters / denominator) * TWO_PI;
      const rgb = hexToRgb('#CFCFCF');
      slices.push({ startAngle: angle, endAngle, r: rgb[0], g: rgb[1], b: rgb[2] });
    }

    return { slices };
  });
}

// ─── Render ──────────────────────────────────────────────────────

/**
 * Render pie-chart symbols to a canvas.
 *
 * Draws smallest symbols first (behind), largest on top, so the most
 * populous areas dominate visually when pies overlap.
 */
export function renderSymbols(ctx, symbols, pieData, dpr) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (!symbols.length) return;

  // Draw order: smallest first, largest on top
  const order = symbols.map((_, i) => i);
  order.sort((a, b) => symbols[a].radius - symbols[b].radius);

  for (const idx of order) {
    const sym = symbols[idx];
    const pd = pieData[idx];
    if (!pd?.slices.length) continue;

    const cx = sym.x * dpr;
    const cy = sym.y * dpr;
    const r = sym.radius * dpr;

    if (sym.radius < BLEND_RADIUS) {
      // Too small for visible pie segments — draw a single blended dot
      let tr = 0, tg = 0, tb = 0;
      for (const s of pd.slices) {
        const w = (s.endAngle - s.startAngle) / TWO_PI;
        tr += w * s.r;
        tg += w * s.g;
        tb += w * s.b;
      }
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgb(${Math.round(tr)},${Math.round(tg)},${Math.round(tb)})`;
      ctx.fill();
    } else {
      // Draw pie wedges
      for (const s of pd.slices) {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r, s.startAngle, s.endAngle);
        ctx.closePath();
        ctx.fillStyle = `rgb(${s.r},${s.g},${s.b})`;
        ctx.fill();
      }
      // Subtle outline for definition
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0,0,0,0.15)';
      ctx.lineWidth = 0.5 * dpr;
      ctx.stroke();
    }
  }
}

// Need TWO_PI at module scope for renderSymbols
const TWO_PI = Math.PI * 2;

// ─── Borders ─────────────────────────────────────────────────────

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

// ─── Hit-test canvas ─────────────────────────────────────────────

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

// ─── Helpers ─────────────────────────────────────────────────────

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}
