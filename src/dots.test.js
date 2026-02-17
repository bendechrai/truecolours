import { describe, it, expect, vi } from 'vitest';

// We test the pure computation functions from dots.js.
// Canvas/D3 functions that need a real projection are tested with mocks.

// ─── Helper: build mock projection + features ───────────────────

function mockProjection() {
  // Simple identity projection
  const proj = (coords) => coords;
  proj.fitSize = () => proj;
  proj.stream = (s) => s;
  return proj;
}

function makeFeatures(n) {
  return Array.from({ length: n }, (_, i) => ({
    type: 'Feature',
    id: String(i).padStart(5, '0'),
    properties: { _name: `Region ${i}` },
    geometry: {
      type: 'Polygon',
      coordinates: [[[i, 0], [i + 1, 0], [i + 1, 1], [i, 1], [i, 0]]],
    },
  }));
}

function makeElectionData(features, partySplits, eligible) {
  // partySplits: [{ dem: 0.6, rep: 0.4 }, ...]  (one per feature)
  const year = 2020;
  const data = { [year]: {} };
  features.forEach((_, i) => {
    const split = partySplits[i] || partySplits[0];
    const elig = eligible || 10000;
    const votes = {};
    for (const [partyId, frac] of Object.entries(split)) {
      votes[partyId] = Math.round(frac * elig * 0.7); // 70% turnout
    }
    data[year][i] = { votes, eligible: elig };
  });
  return data;
}

const parties = [
  { id: 'dem', name: 'Democrat', colour: '#1375B7' },
  { id: 'rep', name: 'Republican', colour: '#E81B23' },
];

// ─── Import after mocks ─────────────────────────────────────────

import {
  computeSymbols,
  colourSymbols,
  colourBubbles,
  generateDots,
  computeDorling,
  computeCartogramScales,
  computeCartogramNudge,
  computeFeatureTransforms,
  computeSymbolPositions,
} from './dots.js';

// ─── computeSymbols ─────────────────────────────────────────────

describe('computeSymbols', () => {
  it('returns empty for no features', () => {
    expect(computeSymbols([], mockProjection(), 100, 100, {}, [2020])).toEqual([]);
  });

  it('returns empty for zero-size canvas', () => {
    const features = makeFeatures(3);
    expect(computeSymbols(features, mockProjection(), 0, 100, {}, [2020])).toEqual([]);
  });

  it('returns one symbol per feature with election data', () => {
    const features = makeFeatures(3);
    const electionData = makeElectionData(features, [{ dem: 0.6, rep: 0.4 }]);
    const symbols = computeSymbols(features, mockProjection(), 800, 500, electionData, [2020]);
    expect(symbols.length).toBe(3);
    symbols.forEach((s) => {
      expect(s).toHaveProperty('featureIndex');
      expect(s).toHaveProperty('x');
      expect(s).toHaveProperty('y');
      expect(s).toHaveProperty('radius');
      expect(s.radius).toBeGreaterThan(0);
    });
  });

  it('gives larger radius to features with more eligible voters', () => {
    const features = makeFeatures(2);
    const data = {
      2020: {
        0: { votes: { dem: 500, rep: 500 }, eligible: 1000 },
        1: { votes: { dem: 5000, rep: 5000 }, eligible: 100000 },
      },
    };
    const symbols = computeSymbols(features, mockProjection(), 800, 500, data, [2020]);
    expect(symbols.length).toBe(2);
    const small = symbols.find((s) => s.featureIndex === 0);
    const large = symbols.find((s) => s.featureIndex === 1);
    expect(large.radius).toBeGreaterThan(small.radius);
  });

  it('total symbol area is proportional to SYMBOL_COVERAGE', () => {
    const features = makeFeatures(5);
    const data = makeElectionData(features, [{ dem: 0.5, rep: 0.5 }]);
    const symbols = computeSymbols(features, mockProjection(), 800, 500, data, [2020]);
    const totalArea = symbols.reduce((sum, s) => sum + Math.PI * s.radius * s.radius, 0);
    const mapArea = 800 * 500;
    // Should be approximately 10% of map area
    expect(totalArea).toBeGreaterThan(mapArea * 0.08);
    expect(totalArea).toBeLessThan(mapArea * 0.12);
  });
});

// ─── colourSymbols ──────────────────────────────────────────────

describe('colourSymbols', () => {
  it('returns empty slices for missing year data', () => {
    const symbols = [{ featureIndex: 0, x: 0, y: 0, radius: 10 }];
    const result = colourSymbols(symbols, {}, [], parties, 2020, false);
    expect(result).toHaveLength(1);
    expect(result[0].slices).toEqual([]);
  });

  it('creates slices for each party with votes', () => {
    const symbols = [{ featureIndex: 0, x: 0, y: 0, radius: 10 }];
    const data = {
      2020: { 0: { votes: { dem: 600, rep: 400 }, eligible: 1000 } },
    };
    const result = colourSymbols(symbols, data, [], parties, 2020, false);
    expect(result[0].slices).toHaveLength(2);

    // Slices should span 2*PI total
    const totalAngle = result[0].slices.reduce(
      (sum, s) => sum + (s.endAngle - s.startAngle),
      0,
    );
    expect(totalAngle).toBeCloseTo(Math.PI * 2, 5);
  });

  it('dem slice is larger than rep slice when dem has more votes', () => {
    const symbols = [{ featureIndex: 0, x: 0, y: 0, radius: 10 }];
    const data = {
      2020: { 0: { votes: { dem: 700, rep: 300 }, eligible: 1000 } },
    };
    const result = colourSymbols(symbols, data, [], parties, 2020, false);
    const [demSlice, repSlice] = result[0].slices;
    const demArc = demSlice.endAngle - demSlice.startAngle;
    const repArc = repSlice.endAngle - repSlice.startAngle;
    expect(demArc).toBeGreaterThan(repArc);
  });

  it('includes non-voter slice when showNonVoters is true', () => {
    const symbols = [{ featureIndex: 0, x: 0, y: 0, radius: 10 }];
    const data = {
      2020: { 0: { votes: { dem: 400, rep: 300 }, eligible: 1000 } },
    };
    const result = colourSymbols(symbols, data, [], parties, 2020, true);
    // dem + rep + non-voter = 3 slices
    expect(result[0].slices).toHaveLength(3);

    const totalAngle = result[0].slices.reduce(
      (sum, s) => sum + (s.endAngle - s.startAngle),
      0,
    );
    expect(totalAngle).toBeCloseTo(Math.PI * 2, 5);
  });

  it('skips parties with zero votes', () => {
    const symbols = [{ featureIndex: 0, x: 0, y: 0, radius: 10 }];
    const data = {
      2020: { 0: { votes: { dem: 1000, rep: 0 }, eligible: 1000 } },
    };
    const result = colourSymbols(symbols, data, [], parties, 2020, false);
    expect(result[0].slices).toHaveLength(1);
  });
});

// ─── colourBubbles ──────────────────────────────────────────────

describe('colourBubbles', () => {
  it('returns circles sorted largest-first', () => {
    const symbols = [{ featureIndex: 0, x: 0, y: 0, radius: 20 }];
    const data = {
      2020: { 0: { votes: { dem: 700, rep: 300 }, eligible: 1000 } },
    };
    const result = colourBubbles(symbols, data, [], parties, 2020, false);
    expect(result[0].circles).toHaveLength(2);
    expect(result[0].circles[0].radius).toBeGreaterThan(result[0].circles[1].radius);
  });

  it('outermost circle area equals the symbol area', () => {
    const R = 20;
    const symbols = [{ featureIndex: 0, x: 0, y: 0, radius: R }];
    const data = {
      2020: { 0: { votes: { dem: 600, rep: 400 }, eligible: 1000 } },
    };
    const result = colourBubbles(symbols, data, [], parties, 2020, false);
    // Outermost (first) circle encompasses all votes → area = πR²
    const outerArea = Math.PI * result[0].circles[0].radius * result[0].circles[0].radius;
    expect(outerArea).toBeCloseTo(Math.PI * R * R, 1);
  });

  it('visible ring areas are proportional to votes', () => {
    const R = 20;
    const symbols = [{ featureIndex: 0, x: 0, y: 0, radius: R }];
    const data = {
      2020: { 0: { votes: { dem: 600, rep: 400 }, eligible: 1000 } },
    };
    const result = colourBubbles(symbols, data, [], parties, 2020, false);
    const circles = result[0].circles; // [largest (outer), smallest (inner)]
    // Dem has more votes → its circle is the outer one
    const demCircle = circles.find((c) => c.r === 0x13);
    const repCircle = circles.find((c) => c.r === 0xe8);
    // Visible ring area of outer (dem) = πR_dem² - πR_rep²
    const demVisibleArea = Math.PI * (demCircle.radius ** 2 - repCircle.radius ** 2);
    const repVisibleArea = Math.PI * repCircle.radius ** 2;
    // Ratio of visible areas should match vote ratio (600:400 = 1.5)
    expect(demVisibleArea / repVisibleArea).toBeCloseTo(600 / 400, 2);
  });
});

// ─── generateDots ───────────────────────────────────────────────

describe('generateDots', () => {
  it('returns empty for no election data', () => {
    const features = makeFeatures(2);
    const result = generateDots(features, mockProjection(), {}, parties, 2020, false);
    expect(result).toEqual([]);
  });

  it('generates dots proportional to vote counts', () => {
    const features = makeFeatures(2);
    const data = {
      2020: {
        0: { votes: { dem: 10000, rep: 5000 }, eligible: 15000 },
        1: { votes: { dem: 5000, rep: 10000 }, eligible: 15000 },
      },
    };
    const dots = generateDots(features, mockProjection(), data, parties, 2020, false);
    expect(dots.length).toBeGreaterThan(0);

    // Count dots by color
    const demRgb = [0x13, 0x75, 0xb7];
    const repRgb = [0xe8, 0x1b, 0x23];
    const demDots = dots.filter((d) => d.r === demRgb[0] && d.g === demRgb[1]);
    const repDots = dots.filter((d) => d.r === repRgb[0] && d.g === repRgb[1]);

    // Total dem = 15000, total rep = 15000, so should be roughly equal
    expect(demDots.length).toBe(repDots.length);
  });

  it('is deterministic (same seed produces same dots)', () => {
    const features = makeFeatures(3);
    const data = makeElectionData(features, [{ dem: 0.55, rep: 0.45 }]);
    const dots1 = generateDots(features, mockProjection(), data, parties, 2020, false);
    const dots2 = generateDots(features, mockProjection(), data, parties, 2020, false);
    expect(dots1).toEqual(dots2);
  });

  it('produces different dots for different years', () => {
    const features = makeFeatures(3);
    const split = [{ dem: 0.55, rep: 0.45 }];
    const data2020 = makeElectionData(features, split);
    // Also create 2024 data
    const data = { ...data2020, 2024: data2020[2020] };
    const dots2020 = generateDots(features, mockProjection(), data, parties, 2020, false);
    const dots2024 = generateDots(features, mockProjection(), data, parties, 2024, false);
    // Same counts but different positions (different seed from year)
    expect(dots2020.length).toBe(dots2024.length);
    expect(dots2020[0].x).not.toBe(dots2024[0].x);
  });

  it('includes non-voter dots when showNonVoters is true', () => {
    const features = makeFeatures(1);
    const data = {
      2020: {
        0: { votes: { dem: 3000, rep: 2000 }, eligible: 10000 },
      },
    };
    const dotsWithout = generateDots(features, mockProjection(), data, parties, 2020, false);
    const dotsWith = generateDots(features, mockProjection(), data, parties, 2020, true);
    // With non-voters should have more dots (5000 votes + 5000 non-voters)
    expect(dotsWith.length).toBeGreaterThan(dotsWithout.length);
  });

  it('each dot has a feature index (fi) for cartogram transforms', () => {
    const features = makeFeatures(2);
    const data = {
      2020: {
        0: { votes: { dem: 10000, rep: 5000 }, eligible: 15000 },
        1: { votes: { dem: 5000, rep: 10000 }, eligible: 15000 },
      },
    };
    const dots = generateDots(features, mockProjection(), data, parties, 2020, false);
    for (const dot of dots) {
      expect(dot).toHaveProperty('fi');
      expect(dot.fi).toBeGreaterThanOrEqual(0);
      expect(dot.fi).toBeLessThan(features.length);
    }
  });

  it('dots are shuffled across parties', () => {
    const features = makeFeatures(1);
    const data = {
      2020: {
        0: { votes: { dem: 50000, rep: 50000 }, eligible: 100000 },
      },
    };
    const dots = generateDots(features, mockProjection(), data, parties, 2020, false);
    // First 10 dots should not all be the same color (they're shuffled)
    const first10 = dots.slice(0, 10);
    const uniqueColors = new Set(first10.map((d) => `${d.r},${d.g},${d.b}`));
    expect(uniqueColors.size).toBeGreaterThan(1);
  });
});

// ─── computeDorling ─────────────────────────────────────────────

describe('computeDorling', () => {
  it('returns empty for empty input', () => {
    expect(computeDorling([])).toEqual([]);
  });

  it('filters out tiny symbols (radius <= 0.3)', () => {
    const symbols = [
      { featureIndex: 0, x: 100, y: 100, radius: 0.1 },
      { featureIndex: 1, x: 200, y: 200, radius: 5 },
    ];
    const result = computeDorling(symbols);
    expect(result).toHaveLength(1);
    expect(result[0].featureIndex).toBe(1);
  });

  it('does not modify original symbols', () => {
    const symbols = [
      { featureIndex: 0, x: 100, y: 100, radius: 10 },
      { featureIndex: 1, x: 100, y: 100, radius: 10 },
    ];
    const origX = symbols[0].x;
    computeDorling(symbols);
    expect(symbols[0].x).toBe(origX);
  });

  it('separates overlapping symbols', () => {
    // Two large symbols at the same position — force simulation should push them apart
    const symbols = [
      { featureIndex: 0, x: 100, y: 100, radius: 20 },
      { featureIndex: 1, x: 100, y: 100, radius: 20 },
    ];
    const result = computeDorling(symbols);
    const dist = Math.hypot(result[0].x - result[1].x, result[0].y - result[1].y);
    // Should be at least close to the sum of radii (some overlap allowed due to spring forces)
    expect(dist).toBeGreaterThan(10);
  });

  it('preserves featureIndex on all nodes', () => {
    const symbols = [
      { featureIndex: 5, x: 50, y: 50, radius: 8 },
      { featureIndex: 12, x: 200, y: 200, radius: 12 },
    ];
    const result = computeDorling(symbols);
    expect(result.map((n) => n.featureIndex).sort((a, b) => a - b)).toEqual([5, 12]);
  });
});

// ─── computeCartogramScales ──────────────────────────────────────

describe('computeCartogramScales', () => {
  it('returns scale 1 for all features when no election data', () => {
    const features = makeFeatures(3);
    const result = computeCartogramScales(features, mockProjection(), {}, [2020]);
    expect(result).toHaveLength(3);
    result.forEach(cs => expect(cs.scale).toBe(1));
  });

  it('returns one entry per feature', () => {
    const features = makeFeatures(4);
    const data = makeElectionData(features, [{ dem: 0.5, rep: 0.5 }]);
    const result = computeCartogramScales(features, mockProjection(), data, [2020]);
    expect(result).toHaveLength(4);
    result.forEach(cs => {
      expect(cs).toHaveProperty('scale');
      expect(cs).toHaveProperty('cx');
      expect(cs).toHaveProperty('cy');
    });
  });

  it('gives larger scale to features with high eligible-to-area ratio', () => {
    const features = makeFeatures(2);
    // Both features have the same geographic area (1x1 unit square),
    // but feature 1 has 10× the eligible voters
    const data = {
      2020: {
        0: { votes: { dem: 500, rep: 500 }, eligible: 1000 },
        1: { votes: { dem: 5000, rep: 5000 }, eligible: 10000 },
      },
    };
    const result = computeCartogramScales(features, mockProjection(), data, [2020]);
    expect(result[1].scale).toBeGreaterThan(result[0].scale);
  });

  it('gives scale 0 to features with zero eligible voters', () => {
    const features = makeFeatures(2);
    const data = {
      2020: {
        0: { votes: { dem: 500, rep: 500 }, eligible: 1000 },
        1: { votes: {}, eligible: 0 },
      },
    };
    const result = computeCartogramScales(features, mockProjection(), data, [2020]);
    expect(result[1].scale).toBe(0);
  });
});

// ─── computeCartogramNudge ────────────────────────────────────────

describe('computeCartogramNudge', () => {
  it('returns dx=0, dy=0 for non-overlapping features', () => {
    // Two features far apart — no collision needed
    const scales = [
      { scale: 1, cx: 10, cy: 10 },
      { scale: 1, cx: 200, cy: 200 },
    ];
    const features = makeFeatures(2);
    const result = computeCartogramNudge(scales, features, mockProjection());
    expect(result).toHaveLength(2);
    // With features far apart, nudge should be near zero
    expect(Math.abs(result[0].dx)).toBeLessThan(5);
    expect(Math.abs(result[0].dy)).toBeLessThan(5);
    expect(Math.abs(result[1].dx)).toBeLessThan(5);
    expect(Math.abs(result[1].dy)).toBeLessThan(5);
  });

  it('pushes overlapping features apart', () => {
    // Two features at the same centroid with large scale — should be pushed apart
    const scales = [
      { scale: 5, cx: 100, cy: 100 },
      { scale: 5, cx: 100, cy: 100 },
    ];
    const features = makeFeatures(2);
    const result = computeCartogramNudge(scales, features, mockProjection());
    // At least one feature should have a non-zero nudge
    const totalNudge = Math.abs(result[0].dx) + Math.abs(result[0].dy) +
                       Math.abs(result[1].dx) + Math.abs(result[1].dy);
    expect(totalNudge).toBeGreaterThan(0);
  });

  it('preserves scale, cx, cy from input', () => {
    const scales = [
      { scale: 2, cx: 50, cy: 60 },
    ];
    const features = makeFeatures(1);
    const result = computeCartogramNudge(scales, features, mockProjection());
    expect(result[0].scale).toBe(2);
    expect(result[0].cx).toBe(50);
    expect(result[0].cy).toBe(60);
  });

  it('handles features with scale=0', () => {
    const scales = [
      { scale: 0, cx: 10, cy: 10 },
      { scale: 2, cx: 50, cy: 50 },
    ];
    const features = makeFeatures(2);
    const result = computeCartogramNudge(scales, features, mockProjection());
    expect(result[0].dx).toBe(0);
    expect(result[0].dy).toBe(0);
  });
});

// ─── VIZ_MODES / SHAPE_MODES config ─────────────────────────────

describe('VIZ_MODES config', () => {
  it('exports all expected viz modes', async () => {
    const { VIZ_MODES, DEFAULT_VIZ_MODE } = await import('./config.js');
    expect(VIZ_MODES).toHaveLength(5);
    const ids = VIZ_MODES.map((m) => m.id);
    expect(ids).toContain('choropleth');
    expect(ids).toContain('dots');
    expect(ids).toContain('pies');
    expect(ids).toContain('bubbles');
    expect(ids).toContain('alpha');
    expect(ids).toContain(DEFAULT_VIZ_MODE);
  });

  it('default mode is dot density', async () => {
    const { DEFAULT_VIZ_MODE } = await import('./config.js');
    expect(DEFAULT_VIZ_MODE).toBe('dots');
  });
});

describe('SHAPE_MODES config', () => {
  it('exports all expected shape modes', async () => {
    const { SHAPE_MODES, DEFAULT_SHAPE, SHAPE_COMPAT } = await import('./config.js');
    expect(SHAPE_MODES).toHaveLength(3);
    const ids = SHAPE_MODES.map((m) => m.id);
    expect(ids).toContain('geo');
    expect(ids).toContain('dorling');
    expect(ids).toContain('cartogram');
    expect(ids).toContain(DEFAULT_SHAPE);
  });

  it('classic and shaded do not support dorling', async () => {
    const { SHAPE_COMPAT } = await import('./config.js');
    expect(SHAPE_COMPAT.choropleth).not.toContain('dorling');
    expect(SHAPE_COMPAT.alpha).not.toContain('dorling');
  });

  it('dot density supports all three shapes', async () => {
    const { SHAPE_COMPAT } = await import('./config.js');
    expect(SHAPE_COMPAT.dots).toContain('geo');
    expect(SHAPE_COMPAT.dots).toContain('dorling');
    expect(SHAPE_COMPAT.dots).toContain('cartogram');
  });
});

// ─── computeFeatureTransforms ────────────────────────────────────

describe('computeFeatureTransforms', () => {
  it('returns identity transforms for geo→geo', () => {
    const symbols = [
      { featureIndex: 0, x: 10, y: 20, radius: 5 },
      { featureIndex: 1, x: 30, y: 40, radius: 8 },
    ];
    const result = computeFeatureTransforms(2, symbols, null, null, 'geo', 'geo', 1);
    expect(result).toHaveLength(2);
    result.forEach(ft => {
      expect(ft.ax).toBe(1);
      expect(ft.bx).toBe(0);
      expect(ft.ay).toBe(1);
      expect(ft.by).toBe(0);
    });
  });

  it('returns cartogram affine at t=1 for geo→cartogram', () => {
    const symbols = [{ featureIndex: 0, x: 100, y: 200, radius: 5 }];
    const cartogramScales = [{ scale: 2, cx: 100, cy: 200 }];
    const result = computeFeatureTransforms(1, symbols, null, cartogramScales, 'geo', 'cartogram', 1);
    const ft = result[0];
    expect(ft.ax).toBe(2);
    expect(ft.bx).toBeCloseTo(100 * (1 - 2));
    expect(ft.ay).toBe(2);
    expect(ft.by).toBeCloseTo(200 * (1 - 2));
  });

  it('includes nudge offsets in cartogram affine', () => {
    const symbols = [{ featureIndex: 0, x: 100, y: 200, radius: 5 }];
    const cartogramScales = [{ scale: 2, cx: 100, cy: 200, dx: 15, dy: -10 }];
    const result = computeFeatureTransforms(1, symbols, null, cartogramScales, 'geo', 'cartogram', 1);
    const ft = result[0];
    expect(ft.ax).toBe(2);
    expect(ft.bx).toBeCloseTo(100 * (1 - 2) + 15);
    expect(ft.ay).toBe(2);
    expect(ft.by).toBeCloseTo(200 * (1 - 2) + (-10));
  });

  it('interpolates between geo and dorling', () => {
    const symbols = [{ featureIndex: 0, x: 10, y: 20, radius: 5 }];
    const dorlingMap = new Map([[0, { x: 30, y: 50 }]]);
    const result = computeFeatureTransforms(1, symbols, dorlingMap, null, 'geo', 'dorling', 0.5);
    const ft = result[0];
    // At t=0.5: bx should be halfway between 0 and (30-10)=20 → 10
    expect(ft.ax).toBe(1);
    expect(ft.bx).toBeCloseTo(10);
    expect(ft.ay).toBe(1);
    expect(ft.by).toBeCloseTo(15);
  });
});

// ─── computeSymbolPositions ──────────────────────────────────────

describe('computeSymbolPositions', () => {
  it('returns geo positions for geo→geo', () => {
    const symbols = [
      { featureIndex: 0, x: 10, y: 20, radius: 5 },
      { featureIndex: 1, x: 30, y: 40, radius: 8 },
    ];
    const result = computeSymbolPositions(symbols, null, null, 'geo', 'geo', 1);
    expect(result[0]).toEqual({ x: 10, y: 20 });
    expect(result[1]).toEqual({ x: 30, y: 40 });
  });

  it('returns dorling positions at t=1 for geo→dorling', () => {
    const symbols = [{ featureIndex: 0, x: 10, y: 20, radius: 5 }];
    const dorlingMap = new Map([[0, { x: 50, y: 60 }]]);
    const result = computeSymbolPositions(symbols, dorlingMap, null, 'geo', 'dorling', 1);
    expect(result[0]).toEqual({ x: 50, y: 60 });
  });

  it('interpolates positions at t=0.5', () => {
    const symbols = [{ featureIndex: 0, x: 10, y: 20, radius: 5 }];
    const dorlingMap = new Map([[0, { x: 30, y: 40 }]]);
    const result = computeSymbolPositions(symbols, dorlingMap, null, 'geo', 'dorling', 0.5);
    expect(result[0].x).toBeCloseTo(20);
    expect(result[0].y).toBeCloseTo(30);
  });

  it('returns nudged positions for cartogram at t=1', () => {
    const symbols = [{ featureIndex: 0, x: 100, y: 200, radius: 5 }];
    const cartogramScales = [{ scale: 2, cx: 100, cy: 200, dx: 15, dy: -10 }];
    const result = computeSymbolPositions(symbols, null, cartogramScales, 'geo', 'cartogram', 1);
    expect(result[0].x).toBeCloseTo(115);
    expect(result[0].y).toBeCloseTo(190);
  });
});

// ─── Election data loading ──────────────────────────────────────

describe('election data integrity', () => {
  it('US data has correct popular vote winners', async () => {
    const { readFileSync } = await import('fs');
    const raw = JSON.parse(readFileSync('public/data/us-elections.json', 'utf8'));

    const demWinYears = [2000, 2008, 2012, 2016, 2020]; // Dem won popular vote
    const repWinYears = [2004, 2024]; // Rep won popular vote

    for (const year of [...demWinYears, ...repWinYears]) {
      const yearData = raw[String(year)];
      if (!yearData) continue;
      let totalDem = 0, totalRep = 0;
      for (const county of Object.values(yearData)) {
        totalDem += county.dem || 0;
        totalRep += county.rep || 0;
      }

      if (demWinYears.includes(year)) {
        expect(totalDem, `${year}: Dem should win popular vote`).toBeGreaterThan(totalRep);
      } else {
        expect(totalRep, `${year}: Rep should win popular vote`).toBeGreaterThan(totalDem);
      }
    }
  });

  it('no county has negative vote counts', async () => {
    const { readFileSync } = await import('fs');
    const raw = JSON.parse(readFileSync('public/data/us-elections.json', 'utf8'));

    for (const [year, yearData] of Object.entries(raw)) {
      for (const [fips, county] of Object.entries(yearData)) {
        for (const [party, count] of Object.entries(county)) {
          expect(count, `${year}/${fips}/${party}`).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});
