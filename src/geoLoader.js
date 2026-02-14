// Fetch TopoJSON/GeoJSON, extract features for all country types

import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import { TEST_CANVAS_SIZE } from './config.js';

/**
 * Load US county boundaries (real TopoJSON from us-atlas).
 * Returns { features, stateFeatures, outline, stateBorders, projection }
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
 * Load real GeoJSON boundaries for UK, Australia, or Canada.
 * Returns { features, outline, regionBorders, projection }
 */
export async function loadGeoJSONCountry(url, config, width, height) {
  const geojson = await d3.json(url);

  // The response should be a GeoJSON FeatureCollection
  let features = geojson.features || geojson;
  if (!Array.isArray(features)) {
    throw new Error('Expected a GeoJSON FeatureCollection');
  }

  // Filter out features with null/empty geometry
  features = features.filter(
    (f) => f.geometry && f.geometry.coordinates && f.geometry.coordinates.length > 0
  );

  // Normalize the name property so tooltips can find it consistently
  const nameProp = config.nameProperty;
  for (let i = 0; i < features.length; i++) {
    const props = features[i].properties || {};
    let name = props[nameProp];
    // Some APIs return arrays (e.g. OpenDataSoft)
    if (Array.isArray(name)) name = name[0];
    features[i].properties = { ...props, _name: name || `Region ${i + 1}` };
    features[i].id = i;
  }

  // Choose projection
  const collection = { type: 'FeatureCollection', features };
  let projection;

  if (config.projection === 'conicConformal') {
    // Good for Canada — preserves shapes at high latitudes
    projection = d3.geoConicConformal()
      .rotate([96, 0])
      .parallels([49, 77])
      .fitSize([width, height], collection);
  } else {
    // Default: Mercator fitted to features
    projection = d3.geoMercator().fitSize([width, height], collection);
  }

  // Build a merged outline from all features for border rendering
  // We draw individual region borders instead of a single mesh
  return {
    features,
    stateFeatures: null,
    outline: collection,        // country outline = union of all features
    stateBorders: null,
    regionBorders: true,        // flag to draw individual feature borders
    projection,
  };
}

/**
 * Measure the rendered pixel area of a feature using a test canvas.
 * Returns { pixelArea, bounds, scale }
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
