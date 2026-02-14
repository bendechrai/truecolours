// True Colours — Main entry point
// State management, event wiring, init, resize

import './style.css';
import * as d3 from 'd3';
import { COUNTRIES, DEFAULT_COUNTRY, RESIZE_DEBOUNCE } from './config.js';
import { loadUS, loadGeoJSONCountry } from './geoLoader.js';
import { loadElectionData } from './electionData.js';
import { computeDots, colourDots, renderDots, renderBorders, buildHitTestCanvas } from './dots.js';
import {
  buildUI,
  updateLegend,
  updateYearLabels,
  showTooltip,
  hideTooltip,
  createAutoplay,
} from './ui.js';

// ─── State ─────────────────────────────────────────────────────────
const state = {
  country: DEFAULT_COUNTRY,
  yearIndex: 0,
  showNonVoters: false,
  dots: [],
  colours: null,
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

  // Pinch / scroll zoom via d3-zoom on the map container
  const zoom = d3.zoom()
    .scaleExtent([1, 10])
    .filter((event) => {
      // Allow pinch (multi-touch), wheel, and mouse drag — but NOT single-
      // touch drag so mobile users can still scroll the page.
      if (event.type === 'touchstart' || event.type === 'touchmove') {
        return event.touches && event.touches.length >= 2;
      }
      return !event.button; // left-click drag + wheel
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

    // Compute dot positions on hex grid (step 3 of 4)
    state.dots = computeDots(state.geoData.features, state.geoData.projection, config.dotBudget, width, height);
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

    // Render borders
    const borderCtx = ui.borderCanvas.getContext('2d');
    renderBorders(borderCtx, state.geoData, state.geoData.projection, dpr);

    // Update UI
    updateLegendUI();
    updateTimelineUI();

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

  state.colours = colourDots(
    state.dots,
    state.electionData,
    state.geoData.features,
    config.parties,
    year,
    state.showNonVoters,
  );

  const dotCtx = ui.dotCanvas.getContext('2d');
  renderDots(dotCtx, state.dots, state.colours, dpr);
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
