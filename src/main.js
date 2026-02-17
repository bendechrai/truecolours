// True Colours — Main entry point
// State management, event wiring, init, resize

import './style.css';
import * as d3 from 'd3';
import { COUNTRIES, DEFAULT_COUNTRY, DEFAULT_VIZ_MODE, DEFAULT_SHAPE, SHAPE_COMPAT, RESIZE_DEBOUNCE } from './config.js';
import { loadUS, loadGeoJSONCountry } from './geoLoader.js';
import { loadElectionData } from './electionData.js';
import {
  computeSymbols, colourSymbols, renderSymbols,
  renderChoropleth,
  generateDots, renderDots,
  colourBubbles, renderBubbles,
  renderAlpha,
  computeDorling,
  computeCartogramScales, computeCartogramNudge, computeCartogramBounds,
  renderCartogramOutlines,
  computeFeatureTransforms, computeSymbolPositions,
  renderBorders, buildHitTestCanvas,
} from './dots.js';
import {
  buildUI,
  updateLegend,
  updateYearLabels,
  updateModeDescription,
  showTooltip,
  hideTooltip,
  createAutoplay,
} from './ui.js';

// ─── State ─────────────────────────────────────────────────────────
const state = {
  country: DEFAULT_COUNTRY,
  yearIndex: 0,
  showNonVoters: false,
  vizMode: DEFAULT_VIZ_MODE,
  shape: DEFAULT_SHAPE,
  morphFrom: DEFAULT_SHAPE,
  morphTo: DEFAULT_SHAPE,
  morphT: 0,
  morphRafId: null,
  symbols: [],
  dorlingSymbols: [],
  dorlingSymbolMap: null,
  cartogramScales: null,
  cachedDots: null,
  cachedDotsKey: null,
  pieData: null,
  geoData: null,
  electionData: null,
  hitTest: null,
  loading: false,
};

let ui;
let autoplay;
let dpr = window.devicePixelRatio || 1;

// ─── Init ──────────────────────────────────────────────────────────
function init() {
  const container = document.getElementById('app');
  ui = buildUI(container);

  // Set initial country
  setActiveCountryButton(state.country);

  // Wire country buttons
  for (const [id, btn] of Object.entries(ui.countryButtons)) {
    btn.addEventListener('click', () => switchCountry(id));
  }

  // Wire viz mode buttons
  for (const [id, btn] of Object.entries(ui.vizButtons)) {
    btn.addEventListener('click', () => setVizMode(id));
  }
  setActiveVizButton(state.vizMode);

  // Wire shape buttons
  for (const [id, btn] of Object.entries(ui.shapeButtons)) {
    btn.addEventListener('click', () => setShape(id));
  }
  setActiveShapeButton(state.shape);
  updateShapeButtonStates();

  // Wire timeline controls
  ui.prevBtn.addEventListener('click', () => stepYear(-1));
  ui.nextBtn.addEventListener('click', () => stepYear(1));
  ui.slider.addEventListener('input', () => {
    const idx = parseInt(ui.slider.value, 10);
    goToYearIndex(idx);
  });

  autoplay = createAutoplay(
    ui.playBtn,
    () => COUNTRIES[state.country].elections,
    () => state.yearIndex,
    (idx) => goToYearIndex(idx),
  );
  ui.playBtn.addEventListener('click', () => autoplay.toggle());

  // Wire map container for tooltips (interaction canvas has pointer-events:none)
  ui.mapContainer.addEventListener('mousemove', handleMouseMove);
  ui.mapContainer.addEventListener('mouseleave', () => hideTooltip(ui.tooltip));

  // Pinch / scroll / drag zoom on the map container
  const zoom = d3.zoom()
    .scaleExtent([1, 10])
    .filter((event) => {
      // Allow all touch gestures (single-finger pan + pinch zoom) and mouse
      if (event.type === 'wheel') return true;
      return !event.button; // left-click drag + any touch
    })
    .on('zoom', (event) => {
      const { x, y, k } = event.transform;
      ui.zoomWrapper.style.transform = `translate(${x}px,${y}px) scale(${k})`;
    });

  d3.select(ui.mapContainer)
    .call(zoom)
    .on('dblclick.zoom', null); // disable double-click zoom

  // Reset zoom when switching countries
  state.zoomBehavior = zoom;
  state.mapContainerSelection = d3.select(ui.mapContainer);

  // Debounced resize
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => onResize(), RESIZE_DEBOUNCE);
  });

  // Load initial country
  switchCountry(state.country);
}

// ─── Country switching ─────────────────────────────────────────────
async function switchCountry(id) {
  if (state.loading) return;
  state.loading = true;
  state.country = id;
  autoplay.stop();

  const config = COUNTRIES[id];
  state.yearIndex = config.elections.length - 1; // start at latest

  setActiveCountryButton(id);
  showLoading('Loading boundaries... 0%');

  // Reset zoom to identity when switching countries
  if (state.zoomBehavior && state.mapContainerSelection) {
    state.mapContainerSelection.call(state.zoomBehavior.transform, d3.zoomIdentity);
  }

  try {
    // Set up canvases
    const { width, height } = setupCanvases(config.aspectRatio);

    // Load geo data (step 1 of 4)
    if (config.boundaryType === 'counties') {
      state.geoData = await loadUS(config.boundaryUrl, width, height);
    } else if (config.boundaryType === 'geojson') {
      state.geoData = await loadGeoJSONCountry(config.boundaryUrl, config, width, height);
    }
    updateLoadingProgress('Loading election data... 25%');

    // Allow the UI to repaint before continuing
    await new Promise((r) => requestAnimationFrame(r));

    // Load real election data (step 2 of 4)
    state.electionData = await loadElectionData(id, config, state.geoData.features);
    updateLoadingProgress('Placing dots... 50%');
    await new Promise((r) => requestAnimationFrame(r));

    // Compute proportional symbols (step 3 of 4)
    state.symbols = computeSymbols(state.geoData.features, state.geoData.projection, width, height, state.electionData, config.elections);
    state.dorlingSymbols = computeDorling(state.symbols);
    state.dorlingSymbolMap = new Map();
    for (const ds of state.dorlingSymbols) {
      state.dorlingSymbolMap.set(ds.featureIndex, { x: ds.x, y: ds.y });
    }
    state.cartogramScales = computeCartogramScales(state.geoData.features, state.geoData.projection, state.electionData, config.elections);
    state.cartogramScales = computeCartogramNudge(state.cartogramScales, state.geoData.features, state.geoData.projection);

    // Refit projection so the expanded cartogram fits within the canvas.
    // The geographic map gets natural margins; the cartogram fills the space.
    const cb = computeCartogramBounds(state.geoData.features, state.geoData.projection, state.cartogramScales);
    if (cb.minX < 0 || cb.minY < 0 || cb.maxX > width || cb.maxY > height) {
      const padL = Math.max(0, -cb.minX);
      const padR = Math.max(0, cb.maxX - width);
      const padT = Math.max(0, -cb.minY);
      const padB = Math.max(0, cb.maxY - height);
      // Symmetric padding (use the worst-case side) + 10% safety margin
      const padX = Math.max(padL, padR) * 1.1;
      const padY = Math.max(padT, padB) * 1.1;
      const pad = Math.max(padX, padY);

      state.geoData.projection.fitExtent(
        [[pad, pad], [width - pad, height - pad]],
        state.geoData.fitCollection,
      );

      // Second pass: recompute everything that depends on the projection
      state.symbols = computeSymbols(state.geoData.features, state.geoData.projection, width, height, state.electionData, config.elections);
      state.dorlingSymbols = computeDorling(state.symbols);
      state.dorlingSymbolMap = new Map();
      for (const ds of state.dorlingSymbols) {
        state.dorlingSymbolMap.set(ds.featureIndex, { x: ds.x, y: ds.y });
      }
      state.cartogramScales = computeCartogramScales(state.geoData.features, state.geoData.projection, state.electionData, config.elections);
      state.cartogramScales = computeCartogramNudge(state.cartogramScales, state.geoData.features, state.geoData.projection);
    }

    // Snap to current shape (no animation on country switch)
    state.morphFrom = state.shape;
    state.morphTo = state.shape;
    state.morphT = 0;
    state.cachedDots = null;
    state.cachedDotsKey = null;
    updateLoadingProgress('Rendering... 75%');
    await new Promise((r) => requestAnimationFrame(r));

    // Build hit-test canvas
    state.hitTest = buildHitTestCanvas(
      state.geoData.features,
      state.geoData.projection,
      width,
      height,
      dpr,
    );

    // Colour and render (step 4 of 4)
    colourAndRender();
    updateBorderCanvas();

    // Update UI
    updateLegendUI();
    updateTimelineUI();
    updateModeDescription(ui.modeDescription, state.vizMode, state.shape);
    updateShapeButtonStates();

    hideLoading();
  } catch (err) {
    console.error('Failed to load country:', err);
    hideLoading();
    showError(err.message);
  }

  state.loading = false;
}

// ─── Year navigation ───────────────────────────────────────────────
function stepYear(dir) {
  const config = COUNTRIES[state.country];
  const len = config.elections.length;
  state.yearIndex = (state.yearIndex + dir + len) % len;
  colourAndRender();
  updateTimelineUI();
}

function goToYearIndex(idx) {
  state.yearIndex = idx;
  colourAndRender();
  updateTimelineUI();
}

// ─── Rendering ─────────────────────────────────────────────────────
function colourAndRender() {
  const config = COUNTRIES[state.country];
  const year = config.elections[state.yearIndex];
  const dotCtx = ui.dotCanvas.getContext('2d');

  // Effective cartogram morph for path-based renderers
  const cmt = getCartogramMorphT();

  // Pre-compute shape transforms / positions for non-path renderers
  const isGeoStatic = state.morphFrom === 'geo' && state.morphTo === 'geo';
  const ft = !isGeoStatic ? computeFeatureTransforms(
    state.geoData.features.length, state.symbols, state.dorlingSymbolMap,
    state.cartogramScales, state.morphFrom, state.morphTo,
    easeInOutCubic(state.morphT),
  ) : null;
  const positions = !isGeoStatic ? computeSymbolPositions(
    state.symbols, state.dorlingSymbolMap, state.cartogramScales,
    state.morphFrom, state.morphTo,
    easeInOutCubic(state.morphT),
  ) : null;

  switch (state.vizMode) {
    case 'choropleth':
      renderChoropleth(dotCtx, state.geoData.features, state.geoData.projection,
        state.electionData, config.parties, year, dpr,
        cmt > 0 ? state.cartogramScales : null, cmt);
      break;

    case 'dots': {
      const dotsKey = `${year}-${state.showNonVoters}`;
      if (state.cachedDotsKey !== dotsKey) {
        state.cachedDots = generateDots(
          state.geoData.features, state.geoData.projection,
          state.electionData, config.parties, year,
          state.showNonVoters,
        );
        state.cachedDotsKey = dotsKey;
      }
      renderDots(dotCtx, state.cachedDots, dpr, ft);
      break;
    }

    case 'pies':
      state.pieData = colourSymbols(state.symbols, state.electionData,
        state.geoData.features, config.parties, year, state.showNonVoters);
      renderSymbols(dotCtx, state.symbols, state.pieData, dpr, positions);
      break;

    case 'bubbles': {
      const bubbleData = colourBubbles(state.symbols, state.electionData,
        state.geoData.features, config.parties, year, state.showNonVoters);
      renderBubbles(dotCtx, state.symbols, bubbleData, dpr, positions);
      break;
    }

    case 'alpha':
      renderAlpha(dotCtx, state.geoData.features, state.geoData.projection,
        state.electionData, config.parties, year, state.showNonVoters, dpr,
        cmt > 0 ? state.cartogramScales : null, cmt);
      break;
  }
}

function setVizMode(modeId) {
  state.vizMode = modeId;
  setActiveVizButton(modeId);

  // If current shape is incompatible with this viz mode, fall back to geo
  const compat = SHAPE_COMPAT[modeId] || ['geo'];
  if (!compat.includes(state.shape)) {
    cancelMorph();
    state.shape = 'geo';
    state.morphFrom = 'geo';
    state.morphTo = 'geo';
    state.morphT = 0;
    setActiveShapeButton('geo');
  }
  updateShapeButtonStates();

  // Clear dot cache when switching modes
  state.cachedDots = null;
  state.cachedDotsKey = null;

  colourAndRender();
  updateBorderCanvas();
  updateModeDescription(ui.modeDescription, state.vizMode, state.shape);
}

// ─── Shape switching (geo / dorling / cartogram) ────────────────

function setShape(newShape) {
  if (newShape === state.shape) return;
  const compat = SHAPE_COMPAT[state.vizMode] || ['geo'];
  if (!compat.includes(newShape)) return;

  cancelMorph();
  const prevShape = state.shape;
  state.shape = newShape;
  state.morphFrom = prevShape;
  state.morphTo = newShape;
  setActiveShapeButton(newShape);
  updateModeDescription(ui.modeDescription, state.vizMode, state.shape);

  animateShapeTransition();
}

function animateShapeTransition() {
  cancelMorph();
  const startTime = performance.now();
  const duration = 800;
  state.morphT = 0;

  function frame(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    state.morphT = progress;
    colourAndRender();
    updateBorderCanvas();
    if (progress < 1) {
      state.morphRafId = requestAnimationFrame(frame);
    } else {
      state.morphRafId = null;
      // Snap: both from and to are now the target shape
      state.morphFrom = state.morphTo;
    }
  }

  state.morphRafId = requestAnimationFrame(frame);
}

function cancelMorph() {
  if (state.morphRafId) {
    cancelAnimationFrame(state.morphRafId);
    state.morphRafId = null;
  }
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Effective cartogram morph T for path-based renderers (choropleth, alpha).
 * Returns 0–1 where 0 = no cartogram, 1 = full cartogram.
 */
function getCartogramMorphT() {
  const easedT = easeInOutCubic(state.morphT);
  if (state.morphFrom === 'cartogram' && state.morphTo === 'cartogram') return 1;
  if (state.morphTo === 'cartogram') return easedT;
  if (state.morphFrom === 'cartogram') return 1 - easedT;
  return 0;
}

/**
 * Update border canvas based on current shape state.
 */
function updateBorderCanvas() {
  if (!state.geoData) return;
  const borderCtx = ui.borderCanvas.getContext('2d');
  const isPathMode = state.vizMode === 'choropleth' || state.vizMode === 'alpha';
  const cmt = getCartogramMorphT();
  const atGeo = state.morphFrom === 'geo' && state.morphTo === 'geo';

  if (cmt > 0 && !isPathMode) {
    // Non-path modes with cartogram active: show scaled outlines
    renderCartogramOutlines(borderCtx, state.geoData.features, state.geoData.projection,
      state.cartogramScales, cmt, dpr);
  } else if (atGeo) {
    // Fully at geo: show normal borders
    renderBorders(borderCtx, state.geoData, state.geoData.projection, dpr);
  } else {
    // Dorling transition or path-mode cartogram: clear borders
    borderCtx.clearRect(0, 0, ui.borderCanvas.width, ui.borderCanvas.height);
  }
}

function setActiveVizButton(id) {
  for (const [mid, btn] of Object.entries(ui.vizButtons)) {
    btn.classList.toggle('active', mid === id);
  }
}

function setActiveShapeButton(id) {
  for (const [sid, btn] of Object.entries(ui.shapeButtons)) {
    btn.classList.toggle('active', sid === id);
  }
}

function updateShapeButtonStates() {
  const compat = SHAPE_COMPAT[state.vizMode] || ['geo'];
  for (const [sid, btn] of Object.entries(ui.shapeButtons)) {
    btn.classList.toggle('disabled', !compat.includes(sid));
  }
}

// ─── Canvas setup ──────────────────────────────────────────────────
function setupCanvases(aspectRatio) {
  dpr = window.devicePixelRatio || 1;
  const containerWidth = ui.mapContainer.clientWidth;
  const width = containerWidth;
  const height = Math.round(containerWidth * aspectRatio);

  ui.mapContainer.style.height = `${height}px`;

  for (const canvas of [ui.dotCanvas, ui.borderCanvas, ui.interactionCanvas]) {
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }

  return { width, height };
}

// ─── UI updates ────────────────────────────────────────────────────
function setActiveCountryButton(id) {
  for (const [cid, btn] of Object.entries(ui.countryButtons)) {
    btn.classList.toggle('active', cid === id);
  }
}

function updateLegendUI() {
  const config = COUNTRIES[state.country];
  updateLegend(ui.legend, config, state.showNonVoters, () => {
    state.showNonVoters = !state.showNonVoters;
    colourAndRender();
    updateLegendUI();
  });
}

function updateTimelineUI() {
  const config = COUNTRIES[state.country];
  const year = config.elections[state.yearIndex];

  ui.yearDisplay.textContent = year;
  ui.slider.max = String(config.elections.length - 1);
  ui.slider.value = String(state.yearIndex);

  updateYearLabels(ui.yearLabels, config.elections, year, (clickedYear) => {
    const idx = config.elections.indexOf(clickedYear);
    if (idx >= 0) goToYearIndex(idx);
  });
}

function showLoading(msg = 'Loading...') {
  ui.loadingOverlay.classList.remove('hidden');
  ui.loadingOverlay.querySelector('.loading-text').textContent = msg;

  const dotCtx = ui.dotCanvas.getContext('2d');
  const borderCtx = ui.borderCanvas.getContext('2d');
  dotCtx.clearRect(0, 0, ui.dotCanvas.width, ui.dotCanvas.height);
  borderCtx.clearRect(0, 0, ui.borderCanvas.width, ui.borderCanvas.height);
}

function hideLoading() {
  ui.loadingOverlay.classList.add('hidden');
}

function updateLoadingProgress(msg) {
  ui.loadingOverlay.querySelector('.loading-text').textContent = msg;
}

function showError(msg) {
  const dotCtx = ui.dotCanvas.getContext('2d');
  dotCtx.clearRect(0, 0, ui.dotCanvas.width, ui.dotCanvas.height);
  dotCtx.fillStyle = '#999';
  dotCtx.font = '14px DM Sans, sans-serif';
  dotCtx.textAlign = 'center';
  dotCtx.fillText(`Error: ${msg}`, ui.dotCanvas.width / (2 * dpr), ui.dotCanvas.height / (2 * dpr));
}

// ─── Hit testing / tooltips ────────────────────────────────────────
function handleMouseMove(e) {
  if (!state.hitTest || !state.electionData) return;

  const rect = ui.mapContainer.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  // Invert zoom transform to get coordinates in map-space
  const t = state.mapContainerSelection
    ? d3.zoomTransform(ui.mapContainer)
    : d3.zoomIdentity;
  const x = (mx - t.x) / t.k;
  const y = (my - t.y) / t.k;

  const featureIndex = state.hitTest.getFeatureIndex(x, y);
  if (featureIndex < 0) {
    hideTooltip(ui.tooltip);
    return;
  }

  const config = COUNTRIES[state.country];
  const year = config.elections[state.yearIndex];
  const regionData = state.electionData[year]?.[featureIndex];
  const feature = state.geoData.features[featureIndex];
  const regionName = feature?.properties?._name || feature?.properties?.name || feature?.properties?.NAME || `Region ${featureIndex + 1}`;

  showTooltip(
    ui.tooltip,
    regionData,
    regionName,
    config.parties,
    state.showNonVoters,
    e.clientX,
    e.clientY,
    rect,
  );
}

function handleTouch(e) {
  if (e.touches.length > 0) {
    const touch = e.touches[0];
    handleMouseMove({ clientX: touch.clientX, clientY: touch.clientY, target: e.target });
  }
}

// ─── Resize ────────────────────────────────────────────────────────
function onResize() {
  if (state.loading || !state.geoData) return;
  // Full re-render on resize
  switchCountry(state.country);
}

// ─── Go ────────────────────────────────────────────────────────────
init();
