// Fetch TopoJSON, extract features, generate grid subdivisions for non-US countries

import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import { TEST_CANVAS_SIZE } from './config.js';

/**
 * Load US county boundaries (real TopoJSON).
 * Returns { features, stateFeatures, projection }
 */
export async function loadUS(url, width, height) {
  const topo = await d3.json(url);
  const counties = topojson.feature(topo, topo.objects.counties);
  const states = topojson.feature(topo, topo.objects.states);

  const projection = d3.geoAlbersUsa().fitSize([width, height], counties);

  return {
    features: counties.features,
    stateFeatures: states.features,
    outline: topojson.mesh(topo, topo.objects.nation),
    stateBorders: topojson.mesh(topo, topo.objects.states, (a, b) => a !== b),
    projection,
  };
}

/**
 * Load a country outline from world-atlas and generate grid subdivisions.
 * Returns { features, outline, projection }
 *
 * The grid subdivision works by:
 * 1. Extract the country feature by ISO numeric code
 * 2. Project it and rasterise to a mask canvas
 * 3. Create grid cells, keeping only those whose centre falls inside the mask
 */
export async function loadGridCountry(url, isoCode, gridSize, width, height, aspectRatio) {
  const topo = await d3.json(url);
  const countries = topojson.feature(topo, topo.objects.countries);

  // Find the country by ISO numeric code (stored as string id)
  const countryFeature = countries.features.find(
    (f) => +f.id === isoCode || f.properties.name === String(isoCode)
  );
  if (!countryFeature) {
    throw new Error(`Country with ISO code ${isoCode} not found in world-atlas`);
  }

  // Create projection fitted to this country
  const projection = d3.geoMercator().fitSize([width, height], countryFeature);

  // Rasterise country outline to a mask
  const maskSize = 800;
  const maskProjection = d3.geoMercator().fitSize([maskSize, maskSize], countryFeature);
  const maskCanvas = new OffscreenCanvas(maskSize, maskSize);
  const maskCtx = maskCanvas.getContext('2d');
  const maskPath = d3.geoPath(maskProjection, maskCtx);

  maskCtx.fillStyle = '#000';
  maskCtx.beginPath();
  maskPath(countryFeature);
  maskCtx.fill();

  const maskData = maskCtx.getImageData(0, 0, maskSize, maskSize).data;

  function isInsideMask(px, py) {
    const x = Math.round(px);
    const y = Math.round(py);
    if (x < 0 || x >= maskSize || y < 0 || y >= maskSize) return false;
    return maskData[(y * maskSize + x) * 4 + 3] > 0; // check alpha
  }

  // Get projected bounding box
  const pathGen = d3.geoPath(maskProjection);
  const bounds = pathGen.bounds(countryFeature);
  const bx0 = bounds[0][0];
  const by0 = bounds[0][1];
  const bw = bounds[1][0] - bounds[0][0];
  const bh = bounds[1][1] - bounds[0][1];

  // Generate grid cells
  const cellW = bw / gridSize;
  const cellH = bh / gridSize;
  const features = [];
  let regionIndex = 0;

  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const cx = bx0 + (col + 0.5) * cellW;
      const cy = by0 + (row + 0.5) * cellH;

      if (!isInsideMask(cx, cy)) continue;

      // Create a rectangular polygon in projected coordinates, then unproject
      const x0 = bx0 + col * cellW;
      const y0 = by0 + row * cellH;
      const x1 = x0 + cellW;
      const y1 = y0 + cellH;

      // Clip the cell to the mask by checking corners and midpoints
      // For simplicity, we create the full rectangle — dots will be rejection-sampled against the actual shape
      const corners = [
        [x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0],
      ];

      // Unproject corners back to lon/lat
      const coords = corners.map((p) => maskProjection.invert(p)).filter(Boolean);
      if (coords.length < 4) continue;
      coords.push(coords[0]); // close ring

      features.push({
        type: 'Feature',
        id: regionIndex,
        properties: {
          name: `Region ${regionIndex + 1}`,
          gridRow: row,
          gridCol: col,
        },
        geometry: {
          type: 'Polygon',
          coordinates: [coords],
        },
      });
      regionIndex++;
    }
  }

  // Build outline as GeoJSON for border rendering
  const outline = countryFeature;

  return {
    features,
    stateFeatures: null,
    outline: countryFeature,
    stateBorders: null,
    projection,
    maskCanvas,
    maskProjection,
    maskSize,
    maskData,
  };
}

/**
 * Measure the rendered pixel area of a feature using a test canvas.
 * Returns the number of filled pixels in the rasterised polygon.
 */
export function measureFeatureArea(feature, projection) {
  const canvas = new OffscreenCanvas(TEST_CANVAS_SIZE, TEST_CANVAS_SIZE);
  const ctx = canvas.getContext('2d');
  const pathGen = d3.geoPath(projection, ctx);

  // Get the feature's projected bounding box
  const bounds = d3.geoPath(projection).bounds(feature);
  const bx = bounds[0][0];
  const by = bounds[0][1];
  const bw = bounds[1][0] - bounds[0][0];
  const bh = bounds[1][1] - bounds[0][1];

  if (bw <= 0 || bh <= 0) return { pixelArea: 0, bounds, scale: 1 };

  // Scale the feature to fit the test canvas
  const scale = Math.min(TEST_CANVAS_SIZE / bw, TEST_CANVAS_SIZE / bh);

  ctx.save();
  ctx.scale(scale, scale);
  ctx.translate(-bx, -by);
  ctx.fillStyle = '#000';
  ctx.beginPath();
  pathGen(feature);
  ctx.fill();
  ctx.restore();

  // Count filled pixels
  const data = ctx.getImageData(0, 0, TEST_CANVAS_SIZE, TEST_CANVAS_SIZE).data;
  let filled = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 0) filled++;
  }

  // Convert back to screen-space pixel area
  const pixelArea = filled / (scale * scale);

  return { pixelArea, bounds, scale };
}
