<p align="center">
  <img src="logo.png" alt="Weather Forecast for Google Maps logo" width="160" height="160">
</p>

# 🌦 Weather Forecast for Google Maps — Chrome Extension

Click anywhere on Google Maps to see a **15-day ECMWF IFS weather forecast** 
in a floating panel: temperature, precipitation, cloud cover, and wind speed.

Data source: **ECMWF IFS ENS 0.25°** via [Open-Meteo](https://open-meteo.com) — free, no API key required.

---

## Installation

### Step 1 — Download Chart.js dependency

The extension bundles Chart.js locally (Chrome MV3 extensions cannot load from CDNs).
Run the setup script once:

```bash
cd weather-maps-extension
bash setup.sh
```

Or manually:
```bash
mkdir -p lib
curl -L "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js" \
     -o lib/chart.umd.min.js
```

### Step 2 — Load in Chrome

1. Open Chrome and go to **`chrome://extensions`**
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **"Load unpacked"**
4. Select the `weather-maps-extension` folder
5. The extension is now active ✅

### Step 3 — Use it

1. Go to **[google.com/maps](https://www.google.com/maps)**
2. Click anywhere on the map
3. A weather panel appears in the **bottom-right corner**

---

## Features

| Feature | Details |
|---|---|
| **Data source** | ECMWF IFS ENS 0.25° (same model as dynamical.org) |
| **Forecast range** | Up to 15 days |
| **Charts** | Temperature, Precipitation, Cloud Cover, Wind Speed |
| **Toggles** | Show/hide each chart independently |
| **Time ranges** | 2d / 5d / 7d / 15d selector |
| **Location name** | Reverse geocoded via OpenStreetMap Nominatim |
| **API key** | None required |

---

## File structure

```
weather-maps-extension/
├── manifest.json       ← Extension config (Manifest V3)
├── content.js          ← Injected into Google Maps
├── content.css         ← Panel styles (scoped with #wmf- prefix)
├── setup.sh            ← Downloads Chart.js dependency
├── lib/
│   └── chart.umd.min.js   ← Chart.js (downloaded by setup.sh)
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

---

## How it works

1. **Click detection**: The content script listens for clicks on the Google Maps page. After a short delay (120ms), it reads the latitude/longitude from the URL — Google Maps always updates the URL to `@lat,lng,zoom` when you click.

2. **Weather fetch**: Calls `api.open-meteo.com/v1/forecast` with `models=ecmwf_ifs025`, which provides the same ECMWF IFS ENS 0.25° data indexed by [dynamical.org](https://dynamical.org/catalog/ecmwf-ifs-ens-forecast-15-day-0-25-degree/).

3. **Reverse geocoding**: Calls Nominatim (OpenStreetMap) to resolve coordinates to a place name.

---

## Permissions

| Permission | Reason |
|---|---|
| `https://api.open-meteo.com/*` | Fetch weather forecast data |
| `https://nominatim.openstreetmap.org/*` | Reverse geocode clicked coordinates |

No data is stored or sent anywhere else.
