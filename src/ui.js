// DOM generation, legend, tooltips, year display, timeline controls

import { COUNTRIES, AUTOPLAY_INTERVAL, VIZ_MODES } from './config.js';

/**
 * Build the entire page DOM structure.
 * Returns references to key elements.
 */
export function buildUI(container) {
  const isEmbed = new URLSearchParams(window.location.search).get('embed') === 'true';

  container.innerHTML = '';

  // Header
  let header = null;
  if (!isEmbed) {
    header = el('header', { className: 'site-header' }, [
      el('h1', { className: 'site-title' }, ['True Colours']),
      el('p', { className: 'site-subtitle' }, ['Every vote visible. No vote hidden.']),
    ]);
    container.appendChild(header);
  }

  // Country selector
  const countryBar = el('div', { className: 'country-bar' });
  const countryButtons = {};
  for (const [id, cfg] of Object.entries(COUNTRIES)) {
    const btn = el('button', { className: 'country-btn', 'data-country': id }, [
      `${cfg.flag}\u00A0${cfg.name}`,
    ]);
    countryButtons[id] = btn;
    countryBar.appendChild(btn);
  }
  container.appendChild(countryBar);

  // Data source banner
  const banner = el('div', { className: 'sample-banner' }, [
    el('strong', {}, ['Real election data']),
    ' \u2014 Results sourced from official electoral commissions and open datasets. ',
    'Scroll down for details.',
  ]);
  container.appendChild(banner);

  // Map card
  const mapCard = el('div', { className: 'map-card' });
  const mapContainer = el('div', { className: 'map-container' });

  // Inner wrapper for zoom transforms (all canvases move together)
  const zoomWrapper = el('div', { className: 'zoom-wrapper' });

  const dotCanvas = el('canvas', { className: 'map-canvas dot-canvas' });
  const borderCanvas = el('canvas', { className: 'map-canvas border-canvas' });
  const interactionCanvas = el('canvas', { className: 'map-canvas interaction-canvas' });

  zoomWrapper.append(dotCanvas, borderCanvas, interactionCanvas);
  mapContainer.appendChild(zoomWrapper);
  mapCard.appendChild(mapContainer);

  // Legend
  const legend = el('div', { className: 'legend' });
  mapCard.appendChild(legend);

  // Visualization mode selector
  const vizBar = el('div', { className: 'viz-bar' });
  const vizButtons = {};
  for (const mode of VIZ_MODES) {
    const btn = el('button', { className: 'viz-btn', 'data-mode': mode.id }, [mode.name]);
    vizButtons[mode.id] = btn;
    vizBar.appendChild(btn);
  }
  mapCard.appendChild(vizBar);

  // Cartogram shape toggle
  const cartogramToggle = el('button', {
    className: 'cartogram-toggle',
    title: 'Scale regions by population',
  }, ['\u2B21 Cartogram']);
  mapCard.appendChild(cartogramToggle);

  // Timeline
  const timeline = el('div', { className: 'timeline' });
  const yearDisplay = el('div', { className: 'year-display' }, ['2024']);
  const timelineControls = el('div', { className: 'timeline-controls' });

  const prevBtn = el('button', { className: 'timeline-btn', title: 'Previous' }, ['\u25C2']);
  const playBtn = el('button', { className: 'timeline-btn play-btn', title: 'Play/Pause' }, ['\u25B6']);
  const nextBtn = el('button', { className: 'timeline-btn', title: 'Next' }, ['\u25B8']);
  timelineControls.append(prevBtn, playBtn, nextBtn);

  const slider = el('input', {
    type: 'range',
    className: 'timeline-slider',
    min: '0',
    max: '6',
    value: '6',
    step: '1',
  });

  const yearLabels = el('div', { className: 'year-labels' });

  timeline.append(yearDisplay, timelineControls, slider, yearLabels);
  mapCard.appendChild(timeline);

  container.appendChild(mapCard);

  // Loading overlay (inside map container)
  const loadingOverlay = el('div', { className: 'loading-overlay hidden' }, [
    el('div', { className: 'loading-spinner' }),
    el('div', { className: 'loading-text' }, ['Loading...']),
  ]);
  mapContainer.appendChild(loadingOverlay);

  // Tooltip
  const tooltip = el('div', { className: 'tooltip hidden' });
  container.appendChild(tooltip);

  // Explainer
  let explainer = null;
  if (!isEmbed) {
    explainer = buildExplainer();
    container.appendChild(explainer);

    // Embed section
    const embedSection = buildEmbedSection();
    container.appendChild(embedSection);

    // Footer
    const year = new Date().getFullYear();
    const footer = el('footer', { className: 'site-footer' }, [
      el('p', {}, ['True Colours \u2014 Making every vote visible.']),
      el('p', { className: 'contribute' }, [
        '\u00a9 ' + year + ' ',
        el('a', { href: 'https://bendechr.ai', target: '_blank', rel: 'noopener' }, ['Ben Dechrai']),
        '. Open source on ',
        el('a', { href: 'https://github.com/bendechrai/truecolours', target: '_blank', rel: 'noopener' }, ['GitHub']),
        ' \u2014 issues and pull requests welcome.',
      ]),
    ]);
    container.appendChild(footer);
  }

  return {
    countryBar,
    countryButtons,
    vizBar,
    vizButtons,
    cartogramToggle,
    banner,
    mapCard,
    mapContainer,
    zoomWrapper,
    dotCanvas,
    borderCanvas,
    interactionCanvas,
    legend,
    timeline,
    yearDisplay,
    prevBtn,
    playBtn,
    nextBtn,
    slider,
    yearLabels,
    loadingOverlay,
    tooltip,
    isEmbed,
  };
}

/**
 * Update the legend for a given country config and non-voter toggle state.
 */
export function updateLegend(legendEl, config, showNonVoters, onToggleNonVoters) {
  legendEl.innerHTML = '';
  for (const party of config.parties) {
    const item = el('span', { className: 'legend-item' }, [
      el('span', { className: 'legend-dot', style: `background:${party.colour}` }),
      ` ${party.name}`,
    ]);
    legendEl.appendChild(item);
  }

  // Non-voter toggle
  const nvBtn = el('button', {
    className: `legend-item legend-toggle ${showNonVoters ? 'active' : ''}`,
  }, [
    el('span', { className: 'legend-dot', style: `background:${config.nonVoterColour}` }),
    ` Non-voters ${showNonVoters ? '\u2713' : '\u25CB'}`,
  ]);
  nvBtn.addEventListener('click', onToggleNonVoters);
  legendEl.appendChild(nvBtn);
}

/**
 * Update year labels below the slider.
 */
export function updateYearLabels(yearLabelsEl, elections, currentYear, onClickYear) {
  yearLabelsEl.innerHTML = '';
  for (const year of elections) {
    const label = el('button', {
      className: `year-label ${year === currentYear ? 'active' : ''}`,
    }, [String(year)]);
    label.addEventListener('click', () => onClickYear(year));
    yearLabelsEl.appendChild(label);
  }
}

/**
 * Show tooltip near the cursor for a given region.
 */
export function showTooltip(tooltipEl, regionData, regionName, parties, showNonVoters, x, y, mapRect) {
  if (!regionData) {
    tooltipEl.classList.add('hidden');
    return;
  }

  const { votes, eligible } = regionData;
  const totalVotes = Object.values(votes).reduce((a, b) => a + b, 0);
  const turnout = ((totalVotes / eligible) * 100).toFixed(1);

  let html = `<div class="tooltip-name">${regionName}</div>`;
  html += `<div class="tooltip-bars">`;

  const denominator = showNonVoters ? eligible : totalVotes;

  for (const party of parties) {
    const count = votes[party.id] || 0;
    const pct = ((count / denominator) * 100).toFixed(1);
    const barWidth = (count / denominator) * 100;
    html += `<div class="tooltip-row">
      <span class="tooltip-dot" style="background:${party.colour}"></span>
      <span class="tooltip-party">${party.name}</span>
      <div class="tooltip-bar-track"><div class="tooltip-bar-fill" style="width:${barWidth}%;background:${party.colour}"></div></div>
      <span class="tooltip-pct">${pct}%</span>
    </div>`;
  }

  if (showNonVoters) {
    const nonVoters = eligible - totalVotes;
    const pct = ((nonVoters / denominator) * 100).toFixed(1);
    const barWidth = (nonVoters / denominator) * 100;
    html += `<div class="tooltip-row">
      <span class="tooltip-dot" style="background:#CFCFCF"></span>
      <span class="tooltip-party">Non-voters</span>
      <div class="tooltip-bar-track"><div class="tooltip-bar-fill" style="width:${barWidth}%;background:#CFCFCF"></div></div>
      <span class="tooltip-pct">${pct}%</span>
    </div>`;
  }

  html += `</div>`;
  html += `<div class="tooltip-turnout">Turnout: ${turnout}% (${totalVotes.toLocaleString()} / ${eligible.toLocaleString()})</div>`;

  tooltipEl.innerHTML = html;
  tooltipEl.classList.remove('hidden');

  // Position near cursor, kept within map bounds
  const tw = tooltipEl.offsetWidth;
  const th = tooltipEl.offsetHeight;
  let left = x + 16;
  let top = y - th / 2;

  if (left + tw > mapRect.right - 8) left = x - tw - 16;
  if (top < mapRect.top + 8) top = mapRect.top + 8;
  if (top + th > mapRect.bottom - 8) top = mapRect.bottom - th - 8;

  tooltipEl.style.left = `${left}px`;
  tooltipEl.style.top = `${top}px`;
}

export function hideTooltip(tooltipEl) {
  tooltipEl.classList.add('hidden');
}

/**
 * Autoplay controller.
 */
export function createAutoplay(playBtn, getElections, getCurrentIndex, goToIndex) {
  let interval = null;

  function toggle() {
    if (interval) {
      stop();
    } else {
      start();
    }
  }

  function start() {
    playBtn.textContent = '\u23F8';
    interval = setInterval(() => {
      const elections = getElections();
      let idx = getCurrentIndex();
      idx = (idx + 1) % elections.length;
      goToIndex(idx);
    }, AUTOPLAY_INTERVAL);
  }

  function stop() {
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
    playBtn.textContent = '\u25B6';
  }

  return { toggle, start, stop, isPlaying: () => !!interval };
}

function buildExplainer() {
  return el('section', { className: 'explainer' }, [
    el('h2', {}, ['How True Colours Works']),
    el('p', {}, [
      'Traditional election maps colour entire regions by their winning party. ',
      'A county that voted 51\u201349 looks identical to one that voted 80\u201320. ',
      'Large rural areas dominate visually even when they contain fewer voters.',
    ]),
    el('p', {}, [
      'These distortions are regularly weaponised. In the ',
      el('strong', {}, ['US']),
      ', a county-level map of the 2016 election was ',
      el('a', { href: 'https://www.cnn.com/2019/10/01/politics/donald-trump-map-2016-election/index.html', target: '_blank', rel: 'noopener' }, ['tweeted with the caption \u201cTry to impeach this\u201d']),
      ' \u2014 a sea of red that obscured the fact Clinton won the popular vote by 2.8\u00a0million, with several counties ',
      el('a', { href: 'https://www.snopes.com/news/2019/10/02/donald-trump-impeach-this-map/', target: '_blank', rel: 'noopener' }, ['coloured incorrectly']),
      '. After the 2022 Pennsylvania Senate race, a similar map ',
      el('a', { href: 'https://www.politifact.com/factchecks/2022/nov/10/instagram-posts/map-does-not-prove-pennsylvania-election-was-rigge/', target: '_blank', rel: 'noopener' }, ['went viral']),
      ' as supposed proof the election was rigged. The same format ',
      el('a', { href: 'https://www.33sticks.com/articles/the-map-that-never-dies-why-this-misleading-electoral-visualization-still-works-in-2025', target: '_blank', rel: 'noopener' }, ['reappeared after 2024']),
      ', shared by an official government account.',
    ]),
    el('p', {}, [
      'The problem is just as acute elsewhere. In the ',
      el('strong', {}, ['UK']),
      ', Labour won a historic 411-seat landslide in 2024 \u2014 yet on the standard constituency map, ',
      el('a', { href: 'https://www.esri.com/arcgis-blog/products/arcgis-pro/mapping/a-melange-of-maps/', target: '_blank', rel: 'noopener' }, ['Conservative blue occupied more area than Labour red']),
      ' because Tory-voting rural seats are geographically vast while Labour urban seats are tiny. ',
      'As one ',
      el('a', { href: 'https://andrewmoss.me/ive-just-discovered-a-new-chart-and-its-well-suited-to-politics/', target: '_blank', rel: 'noopener' }, ['pixel-counting analysis']),
      ' found, \u201cif you had no prior knowledge about UK politics, a quick glance is bound to make ',
      'you think Conservative won.\u201d In ',
      el('strong', {}, ['Australia']),
      ', the outback electorate of Durack is 43,000\u00d7 larger than inner-city Grayndler, yet both have the same number of voters. ',
      'After Labor\u2019s 2025 landslide (89+ seats to the Coalition\u2019s 40), a geographic map was ',
      el('a', { href: 'https://www.aap.com.au/factcheck/map-does-not-show-whole-of-australia-voted-for-the-liberals/', target: '_blank', rel: 'noopener' }, ['shared on social media']),
      ' claiming it proved \u201cthe whole country voted Liberal\u201d \u2014 a claim ',
      el('a', { href: 'https://www.abc.net.au/news/2022-05-20/federal-election-map-lying-to-you/101070758', target: '_blank', rel: 'noopener' }, ['the ABC had already debunked']),
      '. In ',
      el('strong', {}, ['Canada']),
      ', the Liberals won government in both 2019 and 2021 despite losing the popular vote, producing maps ',
      'that appeared overwhelmingly Conservative blue. Canada\u2019s largest riding (Nunavut, 2.1\u00a0million\u00a0km\u00b2) ',
      'dwarfs tiny urban ridings like Papineau (9\u00a0km\u00b2), making ',
      el('a', { href: 'https://www.maproomblog.com/2025/05/empty-land-doesnt-vote-and-neither-do-kangaroos-what-australian-and-canadian-election-maps-do-and-dont-do-about-it/', target: '_blank', rel: 'noopener' }, ['empty land look like a mandate']),
      '.',
    ]),
    el('div', { className: 'map-examples' }, [
      el('figure', { className: 'map-example' }, [
        el('img', {
          src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/02/2024_United_Kingdom_general_election_-_Result.svg/600px-2024_United_Kingdom_general_election_-_Result.svg.png',
          alt: 'UK 2024 general election constituency map \u2014 Labour won 411 seats but blue dominates the map',
          loading: 'lazy',
        }),
        el('figcaption', {}, [
          'UK 2024: Labour won 63% of seats, but Conservative blue covers more map area. ',
          el('a', { href: 'https://commons.wikimedia.org/wiki/File:2024_United_Kingdom_general_election_-_Result.svg', target: '_blank', rel: 'noopener' }, ['CC\u00a0BY-SA\u00a04.0']),
        ]),
      ]),
      el('figure', { className: 'map-example' }, [
        el('img', {
          src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/ed/2019_Australian_federal_election_-_Simple_Results.svg/600px-2019_Australian_federal_election_-_Simple_Results.svg.png',
          alt: 'Australia 2019 federal election map \u2014 vast outback electorates make the Coalition appear dominant',
          loading: 'lazy',
        }),
        el('figcaption', {}, [
          'Australia 2019: huge outback seats dwarf urban Labor electorates. ',
          el('a', { href: 'https://commons.wikimedia.org/wiki/File:2019_Australian_federal_election_-_Simple_Results.svg', target: '_blank', rel: 'noopener' }, ['CC\u00a0BY-SA\u00a04.0']),
        ]),
      ]),
      el('figure', { className: 'map-example' }, [
        el('img', {
          src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b0/Canada_Election_2019_Results_Map_%28Simple%29.svg/600px-Canada_Election_2019_Results_Map_%28Simple%29.svg.png',
          alt: 'Canada 2019 federal election map \u2014 Liberals won government but the map appears overwhelmingly Conservative blue',
          loading: 'lazy',
        }),
        el('figcaption', {}, [
          'Canada 2019: Liberals won government, but the map is a sea of Conservative blue. ',
          el('a', { href: 'https://commons.wikimedia.org/wiki/File:Canada_Election_2019_Results_Map.svg', target: '_blank', rel: 'noopener' }, ['CC\u00a0BY-SA\u00a04.0']),
        ]),
      ]),
    ]),
    el('p', {}, [
      'As researchers have ',
      el('a', { href: 'https://www.washingtonpost.com/graphics/politics/2016-election/how-election-maps-lie/', target: '_blank', rel: 'noopener' }, ['repeatedly shown']),
      ', these maps are effectively visualisations of population density, not political sentiment.',
    ]),
    el('p', {}, [
      'True Colours takes a different approach: each region receives dots proportional to its ',
      'number of eligible voters \u2014 not its geographic size \u2014 then colours each dot by the actual ',
      'vote share. Dense urban areas get many tightly packed dots; sparse rural areas get few. ',
      'The result is a map where every vote carries equal visual weight.',
    ]),
    el('h3', {}, ['The Non-Voter Toggle']),
    el('p', {}, [
      'Enable "Non-voters" in the legend to see the full picture. When active, dots represent ',
      'all eligible voters \u2014 not just those who cast a ballot. Grey dots show people who could ',
      'have voted but didn\u2019t. In many elections, non-voters are the largest group.',
    ]),
    el('h3', {}, ['Data Sources']),
    el('p', {}, [
      'Election results are sourced from:',
    ]),
    el('ul', {}, [
      el('li', {}, [
        el('strong', {}, ['US: ']),
        'MIT Election Data + Science Lab (',
        el('a', { href: 'https://electionlab.mit.edu/', target: '_blank', rel: 'noopener' }, ['electionlab.mit.edu']),
        ')',
      ]),
      el('li', {}, [
        el('strong', {}, ['UK: ']),
        'Electoral Commission (',
        el('a', { href: 'https://www.electoralcommission.org.uk/', target: '_blank', rel: 'noopener' }, ['electoralcommission.org.uk']),
        ')',
      ]),
      el('li', {}, [
        el('strong', {}, ['Australia: ']),
        'Australian Electoral Commission (',
        el('a', { href: 'https://www.aec.gov.au/', target: '_blank', rel: 'noopener' }, ['aec.gov.au']),
        ')',
      ]),
      el('li', {}, [
        el('strong', {}, ['Canada: ']),
        'Elections Canada (',
        el('a', { href: 'https://www.elections.ca/', target: '_blank', rel: 'noopener' }, ['elections.ca']),
        ')',
      ]),
    ]),
  ]);
}

function buildEmbedSection() {
  const embedUrl = `${window.location.origin}${window.location.pathname}?embed=true`;
  const embedCode = `<iframe src="${embedUrl}" width="100%" height="700" frameborder="0"></iframe>`;

  const codeEl = el('code', { className: 'embed-code' }, [embedCode]);
  const copyBtn = el('button', { className: 'embed-copy' }, ['Copy']);

  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(embedCode).then(() => {
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
    });
  });

  return el('section', { className: 'embed-section' }, [
    el('h2', {}, ['Embed This Map']),
    el('div', { className: 'embed-box' }, [codeEl, copyBtn]),
  ]);
}

/**
 * Tiny DOM helper.
 */
function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'className') e.className = v;
    else if (k === 'style' && typeof v === 'string') e.style.cssText = v;
    else e.setAttribute(k, v);
  }
  for (const child of children) {
    if (typeof child === 'string') e.appendChild(document.createTextNode(child));
    else if (child) e.appendChild(child);
  }
  return e;
}
