// Visualization renderers: proportional pies, dot density, choropleth,
// party bubbles, value-by-alpha, Dorling cartogram, borders, hit-test

import * as d3 from 'd3';

// Coverage: fraction of map area allocated to total symbol area (sum of all pies)
const SYMBOL_COVERAGE = 0.10;

// No minimum radius — area is purely proportional to eligible voters.
const SYMBOL_MIN_RADIUS = 0;

// Pies smaller than this (screen px) are drawn as a single blended dot
const BLEND_RADIUS = 2;

const TWO_PI = Math.PI * 2;

// Dot density: target total dot count across all features
const TARGET_DOT_COUNT = 100000;
const DOT_RADIUS = 0.8;

// ─── Seeded PRNG (mulberry32) ───────────────────────────────────

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Compute symbols ─────────────────────────────────────────────

/**
 * Place one proportional symbol per feature.
 * Returns: [{ featureIndex, x, y, radius }]
 */
export function computeSymbols(features, projection, width, height, electionData, elections) {
  if (!width || !height || !features.length) return [];

  const pathGen = d3.geoPath(projection);

  let yearData = null;
  if (electionData && elections) {
    for (let yi = elections.length - 1; yi >= 0; yi--) {
      const yd = electionData[elections[yi]];
      if (yd && Object.keys(yd).length > 0) { yearData = yd; break; }
    }
  }

  let totalEligible = 0;
  const eligibles = new Array(features.length);
  for (let i = 0; i < features.length; i++) {
    const e = yearData?.[i]?.eligible || 0;
    eligibles[i] = e;
    totalEligible += e;
  }

  if (totalEligible === 0) return [];

  const mapArea = width * height;
  const totalSymbolArea = mapArea * SYMBOL_COVERAGE;

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

// ─── Colour symbols (pie slices) ─────────────────────────────────

export function colourSymbols(symbols, electionData, features, parties, year, showNonVoters) {
  const yearData = electionData[year];
  if (!yearData) return symbols.map(() => ({ slices: [] }));

  return symbols.map((sym) => {
    const regionData = yearData[sym.featureIndex];
    if (!regionData) return { slices: [] };

    const { votes, eligible } = regionData;
    const totalVotes = Object.values(votes).reduce((a, b) => a + b, 0);
    const nonVoters = eligible - totalVotes;
    const denominator = showNonVoters ? eligible : totalVotes;
    if (denominator === 0) return { slices: [] };

    const slices = [];
    let angle = -Math.PI / 2;

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

// ─── Render pie symbols ──────────────────────────────────────────

export function renderSymbols(ctx, symbols, pieData, dpr) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (!symbols.length) return;

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
      let tr = 0, tg = 0, tb = 0;
      for (const s of pd.slices) {
        const w = (s.endAngle - s.startAngle) / TWO_PI;
        tr += w * s.r;
        tg += w * s.g;
        tb += w * s.b;
      }
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TWO_PI);
      ctx.fillStyle = `rgb(${Math.round(tr)},${Math.round(tg)},${Math.round(tb)})`;
      ctx.fill();
    } else {
      for (const s of pd.slices) {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r, s.startAngle, s.endAngle);
        ctx.closePath();
        ctx.fillStyle = `rgb(${s.r},${s.g},${s.b})`;
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TWO_PI);
      ctx.strokeStyle = 'rgba(0,0,0,0.15)';
      ctx.lineWidth = 0.5 * dpr;
      ctx.stroke();
    }
  }
}

// ─── Choropleth (classic misleading map) ─────────────────────────

export function renderChoropleth(ctx, features, projection, electionData, parties, year, dpr) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const yearData = electionData[year];
  if (!yearData) return;

  const pathGen = d3.geoPath(projection, ctx);
  ctx.save();
  ctx.scale(dpr, dpr);

  for (let i = 0; i < features.length; i++) {
    const rd = yearData[i];
    if (!rd) {
      ctx.fillStyle = '#e0e0e0';
      ctx.beginPath();
      pathGen(features[i]);
      ctx.fill();
      continue;
    }

    let maxVotes = 0, winnerColour = '#e0e0e0';
    for (const party of parties) {
      const count = rd.votes[party.id] || 0;
      if (count > maxVotes) {
        maxVotes = count;
        winnerColour = party.colour;
      }
    }

    ctx.fillStyle = winnerColour;
    ctx.beginPath();
    pathGen(features[i]);
    ctx.fill();
  }

  ctx.restore();
}

// ─── Dot Density ─────────────────────────────────────────────────
// Dots are scattered around each feature's centroid with jitter proportional
// to the feature's geographic size. This avoids the rejection-sampling problem
// where tiny urban counties can't physically fit enough dots, which silently
// drops blue votes and makes the map look red.

export function generateDots(features, projection, electionData, parties, year, showNonVoters) {
  const yearData = electionData[year];
  if (!yearData) return [];

  const pathGen = d3.geoPath(projection);

  // Total count determines voters per dot
  let totalCount = 0;
  for (let i = 0; i < features.length; i++) {
    const rd = yearData[i];
    if (!rd) continue;
    const totalVotes = Object.values(rd.votes).reduce((a, b) => a + b, 0);
    totalCount += showNonVoters ? rd.eligible : totalVotes;
  }

  if (totalCount === 0) return [];
  const votersPerDot = Math.max(1, Math.round(totalCount / TARGET_DOT_COUNT));

  const dots = [];

  for (let i = 0; i < features.length; i++) {
    const rd = yearData[i];
    if (!rd) continue;

    const centroid = pathGen.centroid(features[i]);
    if (!centroid || isNaN(centroid[0]) || isNaN(centroid[1])) continue;

    // Jitter radius = equivalent circle radius of the projected area
    const area = pathGen.area(features[i]);
    const jitter = Math.sqrt(area / Math.PI);

    // Seeded RNG per feature for deterministic placement
    const rng = mulberry32(i * 31337 + year);

    const groups = [];
    for (const party of parties) {
      const count = rd.votes[party.id] || 0;
      if (count > 0) groups.push({ count, colour: party.colour });
    }
    if (showNonVoters) {
      const totalVotes = Object.values(rd.votes).reduce((a, b) => a + b, 0);
      const nv = rd.eligible - totalVotes;
      if (nv > 0) groups.push({ count: nv, colour: '#CFCFCF' });
    }

    for (const { count, colour } of groups) {
      const numDots = Math.round(count / votersPerDot);
      if (numDots === 0) continue;
      const rgb = hexToRgb(colour);
      for (let d = 0; d < numDots; d++) {
        // Uniform distribution within a circle around the centroid
        const angle = rng() * TWO_PI;
        const r = jitter * Math.sqrt(rng());
        dots.push({
          x: centroid[0] + r * Math.cos(angle),
          y: centroid[1] + r * Math.sin(angle),
          r: rgb[0], g: rgb[1], b: rgb[2],
        });
      }
    }
  }

  // Shuffle so no party is always on top
  const shuffleRng = mulberry32(year * 7919);
  for (let i = dots.length - 1; i > 0; i--) {
    const j = Math.floor(shuffleRng() * (i + 1));
    [dots[i], dots[j]] = [dots[j], dots[i]];
  }

  return dots;
}

export function renderDots(ctx, dots, dpr) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (!dots.length) return;

  const r = DOT_RADIUS * dpr;

  // Batch by colour for efficient canvas rendering
  const byColor = new Map();
  for (const dot of dots) {
    const key = (dot.r << 16) | (dot.g << 8) | dot.b;
    if (!byColor.has(key)) {
      byColor.set(key, { r: dot.r, g: dot.g, b: dot.b, pts: [] });
    }
    byColor.get(key).pts.push(dot);
  }

  for (const [, group] of byColor) {
    ctx.fillStyle = `rgb(${group.r},${group.g},${group.b})`;
    ctx.beginPath();
    for (const dot of group.pts) {
      const cx = dot.x * dpr;
      const cy = dot.y * dpr;
      ctx.moveTo(cx + r, cy);
      ctx.arc(cx, cy, r, 0, TWO_PI);
    }
    ctx.fill();
  }
}

// ─── Party Bubbles (concentric circles) ──────────────────────────

export function colourBubbles(symbols, electionData, features, parties, year, showNonVoters) {
  const yearData = electionData[year];
  if (!yearData) return symbols.map(() => ({ circles: [] }));

  return symbols.map((sym) => {
    const regionData = yearData[sym.featureIndex];
    if (!regionData) return { circles: [] };

    const { votes, eligible } = regionData;
    const totalVotes = Object.values(votes).reduce((a, b) => a + b, 0);
    const denominator = showNonVoters ? eligible : totalVotes;
    if (denominator === 0) return { circles: [] };

    const circles = [];
    for (const party of parties) {
      const count = votes[party.id] || 0;
      if (count <= 0) continue;
      const rgb = hexToRgb(party.colour);
      const radius = sym.radius * Math.sqrt(count / denominator);
      circles.push({ radius, r: rgb[0], g: rgb[1], b: rgb[2] });
    }

    if (showNonVoters) {
      const nonVoters = eligible - totalVotes;
      if (nonVoters > 0) {
        const rgb = hexToRgb('#CFCFCF');
        const radius = sym.radius * Math.sqrt(nonVoters / denominator);
        circles.push({ radius, r: rgb[0], g: rgb[1], b: rgb[2] });
      }
    }

    // Largest drawn first (behind), smallest on top
    circles.sort((a, b) => b.radius - a.radius);
    return { circles };
  });
}

export function renderBubbles(ctx, symbols, bubbleData, dpr) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (!symbols.length) return;

  const order = symbols.map((_, i) => i);
  order.sort((a, b) => symbols[a].radius - symbols[b].radius);

  for (const idx of order) {
    const sym = symbols[idx];
    const bd = bubbleData[idx];
    if (!bd?.circles.length) continue;

    const cx = sym.x * dpr;
    const cy = sym.y * dpr;

    if (sym.radius < BLEND_RADIUS) {
      let tr = 0, tg = 0, tb = 0, totalArea = 0;
      for (const c of bd.circles) {
        const a = c.radius * c.radius;
        tr += a * c.r; tg += a * c.g; tb += a * c.b;
        totalArea += a;
      }
      if (totalArea > 0) { tr /= totalArea; tg /= totalArea; tb /= totalArea; }
      ctx.beginPath();
      ctx.arc(cx, cy, sym.radius * dpr, 0, TWO_PI);
      ctx.fillStyle = `rgb(${Math.round(tr)},${Math.round(tg)},${Math.round(tb)})`;
      ctx.fill();
    } else {
      for (const c of bd.circles) {
        ctx.beginPath();
        ctx.arc(cx, cy, c.radius * dpr, 0, TWO_PI);
        ctx.fillStyle = `rgb(${c.r},${c.g},${c.b})`;
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(cx, cy, bd.circles[0].radius * dpr, 0, TWO_PI);
      ctx.strokeStyle = 'rgba(0,0,0,0.15)';
      ctx.lineWidth = 0.5 * dpr;
      ctx.stroke();
    }
  }
}

// ─── Value-by-Alpha (shaded choropleth) ──────────────────────────

export function renderAlpha(ctx, features, projection, electionData, parties, year, showNonVoters, dpr) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const yearData = electionData[year];
  if (!yearData) return;

  const pathGenNoCtx = d3.geoPath(projection);
  const pathGen = d3.geoPath(projection, ctx);

  // Compute projected-pixel density for each feature
  const densities = [];
  let maxDensity = 0;
  for (let i = 0; i < features.length; i++) {
    const rd = yearData[i];
    const area = pathGenNoCtx.area(features[i]);
    const eligible = rd?.eligible || 0;
    const density = area > 0 ? eligible / area : 0;
    densities.push(density);
    if (density > maxDensity) maxDensity = density;
  }

  ctx.save();
  ctx.scale(dpr, dpr);

  for (let i = 0; i < features.length; i++) {
    const rd = yearData[i];
    if (!rd) {
      ctx.fillStyle = 'rgba(200,200,200,0.05)';
      ctx.beginPath();
      pathGen(features[i]);
      ctx.fill();
      continue;
    }

    // Find winner
    let maxVotes = 0, winnerRgb = [200, 200, 200];
    for (const party of parties) {
      const count = rd.votes[party.id] || 0;
      if (count > maxVotes) {
        maxVotes = count;
        winnerRgb = hexToRgb(party.colour);
      }
    }

    // Alpha from density (log scale to avoid extreme values crushing)
    const alpha = maxDensity > 0
      ? Math.min(1, 0.05 + 0.95 * Math.log(1 + densities[i]) / Math.log(1 + maxDensity))
      : 0.05;

    ctx.fillStyle = `rgba(${winnerRgb[0]},${winnerRgb[1]},${winnerRgb[2]},${alpha.toFixed(3)})`;
    ctx.beginPath();
    pathGen(features[i]);
    ctx.fill();
  }

  ctx.restore();
}

// ─── Dorling Cartogram ───────────────────────────────────────────

export function computeDorling(baseSymbols) {
  const nodes = baseSymbols
    .filter(s => s.radius > 0.3)
    .map(s => ({ ...s }));

  if (!nodes.length) return nodes;

  const sim = d3.forceSimulation(nodes)
    .force('x', d3.forceX(d => d.x).strength(0.05))
    .force('y', d3.forceY(d => d.y).strength(0.05))
    .force('collide', d3.forceCollide(d => d.radius + 0.5).iterations(4))
    .stop();

  for (let i = 0; i < 300; i++) sim.tick();

  return nodes;
}

// ─── Borders ─────────────────────────────────────────────────────

export function renderBorders(ctx, geoData, projection, dpr) {
  const pathGen = d3.geoPath(projection, ctx);

  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.save();
  ctx.scale(dpr, dpr);

  if (geoData.stateBorders) {
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    pathGen(geoData.stateBorders);
    ctx.stroke();
  }

  if (geoData.regionBorders && geoData.features) {
    ctx.strokeStyle = 'rgba(0,0,0,0.1)';
    ctx.lineWidth = 0.3;
    for (const feature of geoData.features) {
      ctx.beginPath();
      pathGen(feature);
      ctx.stroke();
    }
  }

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

export function buildHitTestCanvas(features, projection, width, height, dpr) {
  const canvas = new OffscreenCanvas(width * dpr, height * dpr);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.scale(dpr, dpr);

  const pathGen = d3.geoPath(projection, ctx);

  for (let i = 0; i < features.length; i++) {
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
