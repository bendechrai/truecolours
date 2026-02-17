// Fetch TopoJSON/GeoJSON, extract features for all country types

import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import { TEST_CANVAS_SIZE } from './config.js';

// Fraction of canvas reserved as padding on each side so cartogram
// expansion doesn't clip against the canvas edge.
const MAP_PADDING = 0.08;

/**
 * Load US county boundaries (real TopoJSON from us-atlas).
 * Returns { features, stateFeatures, outline, stateBorders, projection }
 */
export async function loadUS(url, width, height) {
  const topo = await d3.json(url);
  const counties = topojson.feature(topo, topo.objects.counties);
  const states = topojson.feature(topo, topo.objects.states);

  const pad = Math.min(width, height) * MAP_PADDING;
  const projection = d3.geoAlbersUsa()
    .fitExtent([[pad, pad], [width - pad, height - pad]], counties);

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

  // Rewind polygon rings to the d3-geo / RFC 7946 convention
  // (counterclockwise exterior, clockwise holes).  Many GeoJSON files from
  // Shapefile conversions use the opposite convention, which causes d3-geo's
  // clipping to treat each polygon as its spherical complement.
  for (const f of features) {
    rewindFeature(f);
  }

  // Strip offshore territory polygons outside clipBounds (e.g. Norfolk Island,
  // Christmas Island, Lord Howe Island for Australia)
  if (config.clipBounds) {
    const { lonMin, lonMax, latMin, latMax } = config.clipBounds;
    features = features
      .map((f) => {
        if (f.geometry.type !== 'MultiPolygon') return f;
        const kept = f.geometry.coordinates.filter((poly) => {
          // Check outer ring centroid against bounds
          const ring = poly[0];
          const avgLon = ring.reduce((s, c) => s + c[0], 0) / ring.length;
          const avgLat = ring.reduce((s, c) => s + c[1], 0) / ring.length;
          return avgLon >= lonMin && avgLon <= lonMax &&
                 avgLat >= latMin && avgLat <= latMax;
        });
        if (kept.length === 0) return null;
        return {
          ...f,
          geometry: kept.length === 1
            ? { type: 'Polygon', coordinates: kept[0] }
            : { type: 'MultiPolygon', coordinates: kept },
        };
      })
      .filter(Boolean);
  }

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

  // When fitLatMax is set, fit the projection to features below that latitude
  // so extreme high-latitude features (e.g. Nunavut at 83N in Mercator) don't
  // crush the rest of the map into a tiny sliver.
  let fitCollection = collection;
  if (config.fitLatMax) {
    const focusFeatures = features.filter((f) => {
      const c = d3.geoCentroid(f);
      return c[1] < config.fitLatMax;
    });
    if (focusFeatures.length > 0) {
      fitCollection = { type: 'FeatureCollection', features: focusFeatures };
    }
  }

  const pad = Math.min(width, height) * MAP_PADDING;
  const extent = [[pad, pad], [width - pad, height - pad]];

  if (config.projection === 'conicEqualArea') {
    projection = d3.geoConicEqualArea()
      .rotate([96, 0])
      .parallels([50, 70])
      .fitExtent(extent, fitCollection);
  } else if (config.projection === 'conicConformal') {
    projection = d3.geoConicConformal()
      .rotate([96, 0])
      .parallels([49, 77])
      .fitExtent(extent, fitCollection);
  } else {
    // Default: Mercator fitted to features
    projection = d3.geoMercator().fitExtent(extent, fitCollection);
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
  ctx.fill('evenodd');
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

/**
 * Ensure a GeoJSON feature's polygon rings follow the d3-geo / RFC 7946
 * winding convention.  Uses d3.geoArea — if the computed spherical area
 * exceeds 2π the feature covers more than half the sphere, which means
 * the rings are wound the wrong way.
 */
function rewindFeature(feature) {
  const area = d3.geoArea(feature);
  if (area <= 2 * Math.PI) return; // winding is already correct

  const geom = feature.geometry;
  if (geom.type === 'Polygon') {
    geom.coordinates = geom.coordinates.map((ring) => ring.slice().reverse());
  } else if (geom.type === 'MultiPolygon') {
    geom.coordinates = geom.coordinates.map((poly) =>
      poly.map((ring) => ring.slice().reverse()),
    );
  }
}
