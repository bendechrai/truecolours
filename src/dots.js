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

export function renderSymbols(ctx, symbols, pieData, dpr, positions = null) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (!symbols.length) return;

  const order = symbols.map((_, i) => i);
  order.sort((a, b) => symbols[a].radius - symbols[b].radius);

  for (const idx of order) {
    const sym = symbols[idx];
    const pd = pieData[idx];
    if (!pd?.slices.length) continue;

    const cx = (positions ? positions[idx].x : sym.x) * dpr;
    const cy = (positions ? positions[idx].y : sym.y) * dpr;
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

export function renderChoropleth(ctx, features, projection, electionData, parties, year, dpr,
  cartogramScales = null, morphT = 0) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const yearData = electionData[year];
  if (!yearData) return;

  const useCartogram = cartogramScales && morphT > 0;
  const pathGen = d3.geoPath(projection, ctx);
  ctx.save();
  ctx.scale(dpr, dpr);

  const indices = features.map((_, i) => i);
  if (useCartogram) {
    indices.sort((a, b) => cartogramScales[a].scale - cartogramScales[b].scale);
  }

  for (const i of indices) {
    const rd = yearData[i];

    let fillColor = '#e0e0e0';
    if (rd) {
      let maxVotes = 0;
      for (const party of parties) {
        const count = rd.votes[party.id] || 0;
        if (count > maxVotes) {
          maxVotes = count;
          fillColor = party.colour;
        }
      }
    }

    ctx.save();
    if (useCartogram) {
      const cs = cartogramScales[i];
      const s = 1 + (cs.scale - 1) * morphT;
      ctx.translate(cs.cx, cs.cy);
      ctx.scale(s, s);
      ctx.translate(-cs.cx, -cs.cy);
    }

    ctx.fillStyle = fillColor;
    ctx.beginPath();
    pathGen(features[i]);
    ctx.fill();

    if (useCartogram) {
      const cs = cartogramScales[i];
      const s = 1 + (cs.scale - 1) * morphT;
      ctx.strokeStyle = 'rgba(0,0,0,0.2)';
      ctx.lineWidth = 0.5 / s;
      ctx.beginPath();
      pathGen(features[i]);
      ctx.stroke();
    }
    ctx.restore();
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
          fi: i,
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

export function renderDots(ctx, dots, dpr, featureTransforms = null) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (!dots.length) return;

  const r = DOT_RADIUS * dpr;

  // Batch by colour for efficient canvas rendering
  const byColor = new Map();
  for (const dot of dots) {
    let dx = dot.x, dy = dot.y;
    if (featureTransforms && dot.fi !== undefined) {
      const ft = featureTransforms[dot.fi];
      dx = ft.ax * dot.x + ft.bx;
      dy = ft.ay * dot.y + ft.by;
    }
    const key = (dot.r << 16) | (dot.g << 8) | dot.b;
    if (!byColor.has(key)) {
      byColor.set(key, { r: dot.r, g: dot.g, b: dot.b, pts: [] });
    }
    byColor.get(key).pts.push({ x: dx, y: dy });
  }

  for (const [, group] of byColor) {
    ctx.fillStyle = `rgb(${group.r},${group.g},${group.b})`;
    ctx.beginPath();
    for (const pt of group.pts) {
      const cx = pt.x * dpr;
      const cy = pt.y * dpr;
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

    const entries = [];
    for (const party of parties) {
      const count = votes[party.id] || 0;
      if (count <= 0) continue;
      const rgb = hexToRgb(party.colour);
      entries.push({ count, r: rgb[0], g: rgb[1], b: rgb[2] });
    }

    if (showNonVoters) {
      const nonVoters = eligible - totalVotes;
      if (nonVoters > 0) {
        const rgb = hexToRgb('#CFCFCF');
        entries.push({ count: nonVoters, r: rgb[0], g: rgb[1], b: rgb[2] });
      }
    }

    // Sort ascending by count — smallest drawn on top, largest behind.
    // Build cumulative radii so each visible ring area ∝ that party's votes.
    entries.sort((a, b) => a.count - b.count);

    const circles = [];
    let cumCount = 0;
    for (const e of entries) {
      cumCount += e.count;
      circles.push({
        radius: sym.radius * Math.sqrt(cumCount / denominator),
        weight: e.count,
        r: e.r, g: e.g, b: e.b,
      });
    }

    // Largest drawn first (behind), smallest on top
    circles.reverse();
    return { circles };
  });
}

export function renderBubbles(ctx, symbols, bubbleData, dpr, positions = null) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (!symbols.length) return;

  const order = symbols.map((_, i) => i);
  order.sort((a, b) => symbols[a].radius - symbols[b].radius);

  for (const idx of order) {
    const sym = symbols[idx];
    const bd = bubbleData[idx];
    if (!bd?.circles.length) continue;

    const cx = (positions ? positions[idx].x : sym.x) * dpr;
    const cy = (positions ? positions[idx].y : sym.y) * dpr;

    if (sym.radius < BLEND_RADIUS) {
      let tr = 0, tg = 0, tb = 0, tw = 0;
      for (const c of bd.circles) {
        const w = c.weight || c.radius * c.radius;
        tr += w * c.r; tg += w * c.g; tb += w * c.b;
        tw += w;
      }
      if (tw > 0) { tr /= tw; tg /= tw; tb /= tw; }
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

export function renderAlpha(ctx, features, projection, electionData, parties, year, showNonVoters, dpr,
  cartogramScales = null, morphT = 0) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const yearData = electionData[year];
  if (!yearData) return;

  const useCartogram = cartogramScales && morphT > 0;
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

  const indices = features.map((_, i) => i);
  if (useCartogram) {
    indices.sort((a, b) => cartogramScales[a].scale - cartogramScales[b].scale);
  }

  for (const i of indices) {
    const rd = yearData[i];

    // Find winner
    let winnerRgb = [200, 200, 200];
    if (rd) {
      let maxVotes = 0;
      for (const party of parties) {
        const count = rd.votes[party.id] || 0;
        if (count > maxVotes) {
          maxVotes = count;
          winnerRgb = hexToRgb(party.colour);
        }
      }
    }

    // Alpha from density (log scale to avoid extreme values crushing)
    const alpha = rd && maxDensity > 0
      ? Math.min(1, 0.05 + 0.95 * Math.log(1 + densities[i]) / Math.log(1 + maxDensity))
      : 0.05;

    ctx.save();
    if (useCartogram) {
      const cs = cartogramScales[i];
      const s = 1 + (cs.scale - 1) * morphT;
      ctx.translate(cs.cx, cs.cy);
      ctx.scale(s, s);
      ctx.translate(-cs.cx, -cs.cy);
    }

    ctx.fillStyle = `rgba(${winnerRgb[0]},${winnerRgb[1]},${winnerRgb[2]},${alpha.toFixed(3)})`;
    ctx.beginPath();
    pathGen(features[i]);
    ctx.fill();

    if (useCartogram) {
      const cs = cartogramScales[i];
      const s = 1 + (cs.scale - 1) * morphT;
      ctx.strokeStyle = 'rgba(0,0,0,0.15)';
      ctx.lineWidth = 0.3 / s;
      ctx.beginPath();
      pathGen(features[i]);
      ctx.stroke();
    }
    ctx.restore();
  }

  ctx.restore();
}

// ─── Non-contiguous Cartogram ─────────────────────────────────────
// Each feature is scaled around its centroid so that its visual area
// is proportional to eligible voters.  Returns per-feature { scale, cx, cy }.

export function computeCartogramScales(features, projection, electionData, elections) {
  const pathGen = d3.geoPath(projection);

  // Use latest election year with data for stable sizing
  let yearData = null;
  if (electionData && elections) {
    for (let yi = elections.length - 1; yi >= 0; yi--) {
      const yd = electionData[elections[yi]];
      if (yd && Object.keys(yd).length > 0) { yearData = yd; break; }
    }
  }

  let totalEligible = 0;
  let totalGeoArea = 0;
  const featureInfo = [];

  for (let i = 0; i < features.length; i++) {
    const geoArea = pathGen.area(features[i]);
    const eligible = yearData?.[i]?.eligible || 0;
    totalEligible += eligible;
    totalGeoArea += geoArea;
    const centroid = pathGen.centroid(features[i]);
    featureInfo.push({ geoArea, eligible, centroid });
  }

  if (totalEligible === 0 || totalGeoArea === 0) {
    return features.map(() => ({ scale: 1, cx: 0, cy: 0 }));
  }

  return featureInfo.map(fd => {
    const cx = (fd.centroid && !isNaN(fd.centroid[0])) ? fd.centroid[0] : 0;
    const cy = (fd.centroid && !isNaN(fd.centroid[1])) ? fd.centroid[1] : 0;
    if (fd.geoArea === 0 || fd.eligible === 0) {
      return { scale: 0, cx, cy };
    }
    // targetArea / totalGeoArea = eligible / totalEligible
    const targetArea = (fd.eligible / totalEligible) * totalGeoArea;
    const scale = Math.sqrt(targetArea / fd.geoArea);
    return { scale, cx, cy };
  });
}

/**
 * Render scaled feature outlines on the border canvas during cartogram morph.
 * Used for viz modes that don't draw their own feature paths (dots, pies, bubbles).
 */
export function renderCartogramOutlines(ctx, features, projection, cartogramScales, morphT, dpr) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (morphT <= 0) return;

  const pathGen = d3.geoPath(projection, ctx);
  ctx.save();
  ctx.scale(dpr, dpr);

  const indices = features.map((_, i) => i);
  indices.sort((a, b) => cartogramScales[a].scale - cartogramScales[b].scale);

  for (const i of indices) {
    const cs = cartogramScales[i];
    const s = 1 + (cs.scale - 1) * morphT;

    ctx.save();
    ctx.translate(cs.cx, cs.cy);
    ctx.scale(s, s);
    ctx.translate(-cs.cx, -cs.cy);

    ctx.fillStyle = '#f0ede8';
    ctx.beginPath();
    pathGen(features[i]);
    ctx.fill();

    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 0.3 / s;
    ctx.beginPath();
    pathGen(features[i]);
    ctx.stroke();

    ctx.restore();
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

// ─── Shape transforms (geo ↔ dorling ↔ cartogram) ────────────────

const IDENTITY_AFFINE = { ax: 1, bx: 0, ay: 1, by: 0 };

function getAffine(fi, shape, geoCentroids, dorlingSymbolMap, cartogramScales) {
  if (shape === 'cartogram' && cartogramScales) {
    const cs = cartogramScales[fi];
    if (!cs || cs.scale === 0) return IDENTITY_AFFINE;
    return {
      ax: cs.scale,
      bx: cs.cx * (1 - cs.scale),
      ay: cs.scale,
      by: cs.cy * (1 - cs.scale),
    };
  }
  if (shape === 'dorling' && dorlingSymbolMap) {
    const geo = geoCentroids.get(fi);
    const ds = dorlingSymbolMap.get(fi);
    if (geo && ds) {
      return { ax: 1, bx: ds.x - geo.x, ay: 1, by: ds.y - geo.y };
    }
  }
  return IDENTITY_AFFINE;
}

/**
 * Per-feature affine transforms for dot-density rendering.
 * newX = ax * x + bx,  newY = ay * y + by
 */
export function computeFeatureTransforms(featureCount, symbols, dorlingSymbolMap, cartogramScales, fromShape, toShape, t) {
  const geoCentroids = new Map();
  for (const sym of symbols) {
    geoCentroids.set(sym.featureIndex, { x: sym.x, y: sym.y });
  }

  const transforms = new Array(featureCount);
  for (let fi = 0; fi < featureCount; fi++) {
    const from = getAffine(fi, fromShape, geoCentroids, dorlingSymbolMap, cartogramScales);
    const to = getAffine(fi, toShape, geoCentroids, dorlingSymbolMap, cartogramScales);
    transforms[fi] = {
      ax: from.ax + (to.ax - from.ax) * t,
      bx: from.bx + (to.bx - from.bx) * t,
      ay: from.ay + (to.ay - from.ay) * t,
      by: from.by + (to.by - from.by) * t,
    };
  }
  return transforms;
}

/**
 * Interpolated positions for symbol-based renderers (pies, bubbles).
 */
export function computeSymbolPositions(symbols, dorlingSymbolMap, fromShape, toShape, t) {
  return symbols.map(sym => {
    const fi = sym.featureIndex;
    const from = getSymbolPos(sym, fi, dorlingSymbolMap, fromShape);
    const to = getSymbolPos(sym, fi, dorlingSymbolMap, toShape);
    return {
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
    };
  });
}

function getSymbolPos(sym, fi, dorlingSymbolMap, shape) {
  if (shape === 'dorling' && dorlingSymbolMap) {
    const ds = dorlingSymbolMap.get(fi);
    if (ds) return ds;
  }
  return sym; // geo and cartogram both use the geo centroid
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
