// ═══════════════════════════════════════════════════════════════
//  Weather Forecast Extension — content.js
//  Injected into google.com/maps. Intercepts clicks on the map
//  canvas, reads lat/lng from the URL, then fetches ECMWF IFS
//  weather data from Open-Meteo and renders charts in a panel.
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // Prevent double-injection if page does a soft-navigation
  if (window.__wmfInjected) return;
  window.__wmfInjected = true;

  // ─────────────────────────────────────────────
  //  State
  // ─────────────────────────────────────────────
  let currentData = null;
  let selectedRange = 5;
  const activeCharts = {};

  const LAYERS = [
    { id: 'temp',  label: 'Temperature', icon: '🌡', cls: 'wmf-on-temp',  defaultOn: true  },
    { id: 'rain',  label: 'Precip.',     icon: '🌧', cls: 'wmf-on-rain',  defaultOn: true  },
    { id: 'cloud', label: 'Cloud Cover', icon: '☁️', cls: 'wmf-on-cloud', defaultOn: false },
    { id: 'wind',  label: 'Wind',        icon: '💨', cls: 'wmf-on-wind',  defaultOn: false },
  ];
  let toggleState = Object.fromEntries(LAYERS.map(l => [l.id, l.defaultOn]));

  const CHART_DEFS = {
    temp:  { title: '🌡 Temperature (°C)',   titleCls: 'wmf-ct-temp',  canvasId: 'wmf-c-temp',  color: '#fc8181', gradRgb: '252,129,129', type: 'line', yMin: undefined, yMax: undefined, tickFmt: v => v + '°',   tipFmt: v => v !== null ? v + ' °C'    : '—', agg: 'avg', dataKey: 'temperature_2m' },
    rain:  { title: '🌧 Precipitation (mm)', titleCls: 'wmf-ct-rain',  canvasId: 'wmf-c-rain',  color: '#63b3ed', gradRgb: '99,179,237',  type: 'bar',  yMin: 0,         yMax: undefined, tickFmt: v => v + 'mm',  tipFmt: v => v !== null ? v.toFixed(2) + ' mm'  : '—', agg: 'sum', dataKey: 'precipitation' },
    cloud: { title: '☁️ Cloud Cover (%)',    titleCls: 'wmf-ct-cloud', canvasId: 'wmf-c-cloud', color: '#a78bfa', gradRgb: '167,139,250', type: 'line', yMin: 0,         yMax: 100,       tickFmt: v => v + '%',   tipFmt: v => v !== null ? v.toFixed(0) + '%'    : '—', agg: 'avg', dataKey: 'cloud_cover' },
    wind:  { title: '💨 Wind Speed (km/h)',  titleCls: 'wmf-ct-wind',  canvasId: 'wmf-c-wind',  color: '#48bb78', gradRgb: '72,187,120',  type: 'line', yMin: 0,         yMax: undefined, tickFmt: v => v + '',    tipFmt: v => v !== null ? v.toFixed(1) + ' km/h': '—', agg: 'avg', dataKey: 'wind_speed_10m' },
  };

  // ─────────────────────────────────────────────
  //  Build DOM
  // ─────────────────────────────────────────────
  function buildUI() {
    // Hint
    const hint = document.createElement('div');
    hint.id = 'wmf-hint';
    hint.textContent = '🌍 Click anywhere on the map to see the weather forecast';
    document.body.appendChild(hint);

    // Panel
    const panel = document.createElement('div');
    panel.id = 'wmf-panel';
    panel.innerHTML = `
      <div id="wmf-header">
        <div id="wmf-loc-info">
          <span id="wmf-loc-name">—</span>
          <span id="wmf-loc-coords">—</span>
        </div>
        <div id="wmf-header-right">
          <div class="wmf-badge">ECMWF IFS</div>
          <button id="wmf-close" title="Close">✕</button>
        </div>
      </div>
      <div id="wmf-body">
        <div class="wmf-loading">
          <div class="wmf-spinner"></div>
          <span class="wmf-loading-text">Loading forecast…</span>
        </div>
      </div>
    `;
    // Start with an empty/idle body so opening the collapsed icon
    // before any map click shows a friendly prompt instead of a spinner.
    panel.querySelector('#wmf-body').innerHTML = `
      <div class="wmf-loading">
        <span style="font-size:26px">🌍</span>
        <span class="wmf-loading-text">Click anywhere on the map to load a forecast.</span>
      </div>`;
    document.body.appendChild(panel);

    document.getElementById('wmf-close').addEventListener('click', closePanel);

    // Round floating icon — the panel lives collapsed inside it and
    // expands when clicked.
    const fab = document.createElement('button');
    fab.id = 'wmf-fab';
    fab.title = 'Weather forecast';
    const logoUrl = chrome.runtime.getURL('icons/icon128.png');
    fab.innerHTML = `<img class="wmf-fab-icon" src="${logoUrl}" alt="Weather forecast"><span class="wmf-fab-dot"></span>`;
    fab.addEventListener('click', togglePanel);
    document.body.appendChild(fab);
  }

  // ─────────────────────────────────────────────
  //  Panel open / collapse
  // ─────────────────────────────────────────────
  function openPanel() {
    document.getElementById('wmf-panel').classList.add('wmf-visible');
    const fab = document.getElementById('wmf-fab');
    fab.classList.add('wmf-fab-hidden');
    fab.classList.remove('wmf-fab-ready');
  }

  function togglePanel() {
    const panel = document.getElementById('wmf-panel');
    if (panel.classList.contains('wmf-visible')) closePanel();
    else openPanel();
  }

  function showLoadingState(lat, lng) {
    document.getElementById('wmf-loc-name').textContent = 'Loading…';
    document.getElementById('wmf-loc-coords').textContent =
      `${lat.toFixed(4)}°, ${lng.toFixed(4)}°`;
    document.getElementById('wmf-body').innerHTML = `
      <div class="wmf-loading">
        <div class="wmf-spinner"></div>
        <span class="wmf-loading-text">Fetching ECMWF IFS ENS data…</span>
      </div>`;
    destroyCharts();
    openPanel();
  }

  // Collapse the panel back into the round icon. Flag the icon as
  // "ready" when a forecast is already loaded so the user knows there
  // is something to reopen.
  function closePanel() {
    document.getElementById('wmf-panel').classList.remove('wmf-visible');
    const fab = document.getElementById('wmf-fab');
    fab.classList.remove('wmf-fab-hidden');
    if (currentData) fab.classList.add('wmf-fab-ready');
  }

  // ─────────────────────────────────────────────
  //  Click → lat/lng via Web Mercator projection
  //
  //  A plain click does NOT change the URL, so we can't
  //  read the clicked point from it. Instead we read the
  //  map CENTER + zoom from the URL, measure the click's
  //  pixel offset from the map center, and convert that
  //  offset back to lat/lng using the same Web Mercator
  //  projection Google Maps uses. Works in 2D (top-down)
  //  view; tilted/3D globe view is not supported.
  // ─────────────────────────────────────────────
  const TILE = 256;

  function project(lat, lng) {
    const siny = Math.min(Math.max(Math.sin(lat * Math.PI / 180), -0.9999), 0.9999);
    return {
      x: TILE * (0.5 + lng / 360),
      y: TILE * (0.5 - Math.log((1 + siny) / (1 - siny)) / (4 * Math.PI)),
    };
  }

  function unproject(x, y) {
    const lng = (x / TILE - 0.5) * 360;
    const n = Math.PI - (2 * Math.PI * y) / TILE;
    const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
    return { lat, lng };
  }

  // Parse map center + zoom from the URL: @lat,lng,Zz  (or ,Nm = meters/altitude)
  function getMapState() {
    const m = location.href.match(/@(-?\d+\.?\d+),(-?\d+\.?\d+),([\d.]+)([zm])/);
    if (!m) return null;
    const lat = parseFloat(m[1]);
    const lng = parseFloat(m[2]);
    let zoom;
    if (m[4] === 'z') {
      zoom = parseFloat(m[3]);
    } else {
      // 'm' = camera altitude in meters (satellite/hybrid). Approximate the zoom.
      const meters = parseFloat(m[3]);
      zoom = Math.log2((35200000 * Math.cos(lat * Math.PI / 180)) / meters);
    }
    return { lat, lng, zoom };
  }

  // Find the map canvas element (the visible map fills it).
  function getMapCanvas() {
    return document.querySelector('canvas.widget-scene-canvas')
        || document.querySelector('#scene canvas')
        || document.querySelector('[role="main"] canvas')
        || document.querySelector('canvas');
  }

  // Convert a screen click (clientX, clientY) to lat/lng.
  function clickToLatLng(clientX, clientY) {
    const state = getMapState();
    if (!state) return null;

    const canvas = getMapCanvas();
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();

    // Pixel offset of click from the map-center (URL center = center of canvas)
    const dx = clientX - (rect.left + rect.width / 2);
    const dy = clientY - (rect.top + rect.height / 2);

    const scale = Math.pow(2, state.zoom);
    const center = project(state.lat, state.lng);

    // World-pixel coords of the clicked point
    const worldX = center.x + dx / scale;
    const worldY = center.y + dy / scale;

    return unproject(worldX, worldY);
  }

  // Show a brief ripple at the click point for visual feedback.
  function showRipple(x, y) {
    const dot = document.createElement('div');
    dot.className = 'wmf-ripple';
    dot.style.left = x + 'px';
    dot.style.top = y + 'px';
    document.body.appendChild(dot);
    setTimeout(() => dot.remove(), 700);
  }

  function setupMapClickListener() {
    let downX = 0, downY = 0;

    document.addEventListener('mousedown', (e) => {
      downX = e.clientX; downY = e.clientY;
    }, true);

    document.addEventListener('click', (e) => {
      const panel = document.getElementById('wmf-panel');
      const hint  = document.getElementById('wmf-hint');

      // Ignore clicks on our own panel
      if (panel && panel.contains(e.target)) return;

      // Ignore clicks on Google's own UI controls (buttons, search, sidebar)
      if (e.target.closest('button, a, input, [role="button"], [role="dialog"], [jsaction*="search"]'))
        return;

      // Ignore drags (map panning) — only treat near-stationary clicks as picks
      const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
      if (moved > 6) return;

      const coords = clickToLatLng(e.clientX, e.clientY);
      if (!coords || isNaN(coords.lat) || isNaN(coords.lng)) {
        // Likely on the Maps homepage (no @lat,lng in URL yet) or in 3D view.
        if (hint) {
          hint.textContent = '⚠️ Move/zoom the map once so coordinates appear in the URL, then click.';
          hint.classList.remove('wmf-hidden');
        }
        return;
      }

      // Clamp latitude to valid range
      coords.lat = Math.max(-85, Math.min(85, coords.lat));
      // Wrap longitude to [-180, 180]
      coords.lng = ((coords.lng + 540) % 360) - 180;

      if (hint) hint.classList.add('wmf-hidden');
      showRipple(e.clientX, e.clientY);
      showLoadingState(coords.lat, coords.lng);
      fetchWeather(coords.lat, coords.lng);
    }, true); // capture phase so we fire before Google's handlers
  }

  // ─────────────────────────────────────────────
  //  Reverse geocoding
  // ─────────────────────────────────────────────
  async function reverseGeocode(lat, lng) {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=en`,
        { headers: { 'User-Agent': 'WeatherMapsExtension/1.0' } }
      );
      const data = await res.json();
      const addr = data.address || {};
      return addr.city || addr.town || addr.village || addr.municipality ||
             addr.county || addr.state || data.display_name?.split(',')[0] || '—';
    } catch {
      return '—';
    }
  }

  // ─────────────────────────────────────────────
  //  Weather fetch
  // ─────────────────────────────────────────────
  async function fetchWeather(lat, lng) {
    try {
      const url = new URL('https://api.open-meteo.com/v1/forecast');
      url.searchParams.set('latitude',  lat.toFixed(4));
      url.searchParams.set('longitude', lng.toFixed(4));
      url.searchParams.set('hourly',
        'temperature_2m,rain,snowfall,cloud_cover,wind_speed_10m,relative_humidity_2m');
      url.searchParams.set('forecast_days', '15');
      url.searchParams.set('timezone', 'auto');
      url.searchParams.set('models', 'ecmwf_ifs025');

      const [geoName, weatherRes] = await Promise.all([
        reverseGeocode(lat, lng),
        fetch(url.toString()),
      ]);

      if (!weatherRes.ok) {
        const t = await weatherRes.text();
        throw new Error(`HTTP ${weatherRes.status}: ${t.slice(0, 100)}`);
      }
      const data = await weatherRes.json();
      if (data.error) throw new Error(data.reason || 'Weather API error');

      // Merge rain + snowfall → precipitation
      const rain = data.hourly.rain || [];
      const snow = data.hourly.snowfall || [];
      data.hourly.precipitation = rain.map((r, i) => (r || 0) + (snow[i] || 0));

      document.getElementById('wmf-loc-name').textContent = geoName;
      renderPanel(lat, lng, data);

    } catch (err) {
      console.error('[WeatherMapExt]', err);
      document.getElementById('wmf-body').innerHTML = `
        <div class="wmf-loading">
          <span style="font-size:26px">⚠️</span>
          <span class="wmf-loading-text" style="color:#fc8181">
            Error loading weather data.<br>
            <span style="color:#475569;font-size:10px">${err.message}</span>
          </span>
        </div>`;
    }
  }

  // ─────────────────────────────────────────────
  //  Render panel content
  // ─────────────────────────────────────────────
  function renderPanel(lat, lng, data) {
    currentData = data;
    document.getElementById('wmf-loc-coords').textContent =
      `${lat.toFixed(4)}°, ${lng.toFixed(4)}°`;
    destroyCharts();

    document.getElementById('wmf-body').innerHTML = `
      <div id="wmf-toggle-bar"></div>
      <div id="wmf-day-tabs"></div>
      <div id="wmf-range-label"></div>
      <div id="wmf-charts"></div>
    `;

    buildToggles();
    buildDayTabs();
    rebuildCharts();
  }

  // ─────────────────────────────────────────────
  //  Toggles
  // ─────────────────────────────────────────────
  function buildToggles() {
    const bar = document.getElementById('wmf-toggle-bar');
    if (!bar) return;
    bar.innerHTML = LAYERS.map(l => {
      const cls = toggleState[l.id] ? l.cls : 'wmf-off';
      return `<button class="wmf-tog ${cls}" data-layer="${l.id}" title="${l.label}" aria-label="${l.label}">
        <span class="wmf-tog-icon">${l.icon}</span>
      </button>`;
    }).join('');
    bar.querySelectorAll('.wmf-tog').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.layer;
        toggleState[id] = !toggleState[id];
        buildToggles();
        rebuildCharts();
      });
    });
  }

  // ─────────────────────────────────────────────
  //  Day tabs
  // ─────────────────────────────────────────────
  function buildDayTabs() {
    const tabEl = document.getElementById('wmf-day-tabs');
    if (!tabEl) return;
    const options = [
      { label: '2d', days: 2 },
      { label: '5d', days: 5 },
      { label: '7d', days: 7 },
      { label: '15d', days: 15 },
    ];
    tabEl.innerHTML = options.map(o =>
      `<button class="wmf-day-tab${selectedRange === o.days ? ' wmf-active' : ''}" data-days="${o.days}">${o.label}</button>`
    ).join('');
    tabEl.querySelectorAll('.wmf-day-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedRange = parseInt(btn.dataset.days);
        tabEl.querySelectorAll('.wmf-day-tab').forEach(b =>
          b.classList.toggle('wmf-active', b === btn));
        rebuildCharts();
      });
    });
  }

  // ─────────────────────────────────────────────
  //  Charts
  // ─────────────────────────────────────────────

  // Chart.js reads colors from JS, not CSS, so it can't use the
  // --wmf-* variables. Mirror the light/dark palette here.
  function chartTheme() {
    const light = window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: light)').matches;
    return light
      ? { tickX: '#64748b', tickY: '#475569',
          gridX: 'rgba(15,23,42,0.06)', gridY: 'rgba(15,23,42,0.08)',
          tipBg: 'rgba(255,255,255,0.97)', tipTitle: '#64748b', tipBody: '#1e293b',
          tipBorder: 'rgba(37,99,235,0.18)' }
      : { tickX: '#475569', tickY: '#64748b',
          gridX: 'rgba(255,255,255,0.03)', gridY: 'rgba(255,255,255,0.05)',
          tipBg: 'rgba(13,15,20,0.96)', tipTitle: '#94a3b8', tipBody: '#e2e8f0',
          tipBorder: 'rgba(99,179,237,0.15)' };
  }

  function rebuildCharts() {
    if (!currentData) return;
    const data = currentData;
    const times = data.hourly.time;
    const days = selectedRange;
    const maxHours = days * 24;
    const aggFactor = days > 7 ? 6 : days > 4 ? 3 : 1;

    const slicedTimes = times.slice(0, maxHours);
    const labels = [];
    for (let i = 0; i < slicedTimes.length; i += aggFactor)
      labels.push(formatLabel(slicedTimes[i], aggFactor));

    const rangeEl = document.getElementById('wmf-range-label');
    if (rangeEl) {
      const start = new Date(slicedTimes[0]).toLocaleDateString('en-GB', { day:'2-digit', month:'short' });
      const end   = new Date(slicedTimes[slicedTimes.length-1]).toLocaleDateString('en-GB', { day:'2-digit', month:'short' });
      rangeEl.textContent = `Forecast: ${start} → ${end}`;
    }

    // Destroy charts that are now OFF
    LAYERS.forEach(l => {
      if (!toggleState[l.id] && activeCharts[l.id]) {
        activeCharts[l.id].destroy();
        delete activeCharts[l.id];
      }
    });

    // Rebuild HTML for active charts
    const container = document.getElementById('wmf-charts');
    if (!container) return;
    container.innerHTML = LAYERS
      .filter(l => toggleState[l.id])
      .map(l => {
        const def = CHART_DEFS[l.id];
        return `<div class="wmf-chart-block">
          <div class="wmf-chart-title ${def.titleCls}">${def.title}</div>
          <div class="wmf-chart-wrap"><canvas id="${def.canvasId}"></canvas></div>
        </div>`;
      }).join('');

    // Draw each active chart
    LAYERS.filter(l => toggleState[l.id]).forEach(l => {
      const def = CHART_DEFS[l.id];
      const raw = data.hourly[def.dataKey] || [];
      const sliced = raw.slice(0, maxHours);

      const aggValues = [];
      for (let i = 0; i < sliced.length; i += aggFactor) {
        const chunk = sliced.slice(i, i + aggFactor).filter(v => v !== null);
        if (!chunk.length) { aggValues.push(null); continue; }
        const val = def.agg === 'sum'
          ? chunk.reduce((a,b) => a+b, 0)
          : chunk.reduce((a,b) => a+b, 0) / chunk.length;
        aggValues.push(+val.toFixed(2));
      }

      const canvasEl = document.getElementById(def.canvasId);
      if (!canvasEl) return;
      const ctx = canvasEl.getContext('2d');
      const grad = ctx.createLinearGradient(0, 0, 0, 110);
      grad.addColorStop(0, `rgba(${def.gradRgb},${def.type === 'bar' ? 0.55 : 0.28})`);
      grad.addColorStop(1, `rgba(${def.gradRgb},0.0)`);

      if (activeCharts[l.id]) { activeCharts[l.id].destroy(); }

      const dataset = def.type === 'bar'
        ? { data: aggValues, backgroundColor: grad, borderColor: `rgba(${def.gradRgb},0.8)`,
            borderWidth: 1, borderRadius: 3, borderSkipped: false }
        : { data: aggValues, borderColor: def.color, borderWidth: 2, backgroundColor: grad,
            fill: true, tension: 0.4,
            pointRadius: aggValues.length > 60 ? 0 : 2,
            pointHoverRadius: 4, pointBackgroundColor: def.color };

      const theme = chartTheme();
      const options = {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: theme.tipBg,
            titleColor: theme.tipTitle,
            bodyColor: theme.tipBody,
            borderColor: theme.tipBorder,
            borderWidth: 1,
            padding: 9,
            cornerRadius: 8,
            callbacks: { label: c => ' ' + def.tipFmt(c.parsed.y) },
          },
        },
        scales: {
          x: {
            ticks: { color: theme.tickX, font: { size: 9 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
            grid: { color: theme.gridX },
          },
          y: {
            min: def.yMin,
            max: def.yMax,
            ticks: { color: theme.tickY, font: { size: 9 }, callback: def.tickFmt },
            grid: { color: theme.gridY },
          },
        },
      };

      activeCharts[l.id] = new Chart(ctx, {
        type: def.type,
        data: { labels, datasets: [dataset] },
        options,
      });
    });
  }

  function destroyCharts() {
    LAYERS.forEach(l => {
      if (activeCharts[l.id]) { activeCharts[l.id].destroy(); delete activeCharts[l.id]; }
    });
  }

  function formatLabel(isoStr, aggFactor) {
    const d = new Date(isoStr);
    if (aggFactor >= 6) return d.toLocaleDateString('en-GB', { day:'2-digit', month:'short' });
    if (aggFactor >= 3) return d.toLocaleDateString('en-GB', { weekday:'short' }) + ' ' + d.getHours().toString().padStart(2,'0') + 'h';
    return d.getHours().toString().padStart(2,'0') + ':00';
  }

  // ─────────────────────────────────────────────
  //  Init
  // ─────────────────────────────────────────────
  buildUI();
  setupMapClickListener();

  // Re-theme the charts live if the OS switches between light/dark.
  // (The panel/icon chrome follows via CSS media queries automatically.)
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (currentData) rebuildCharts();
    });
  }

})();
