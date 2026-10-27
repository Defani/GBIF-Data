# GBIF Data — GeoLibre plugin

![version](https://img.shields.io/badge/version-1.0.0-2e7d32)
![GeoLibre](https://img.shields.io/badge/GeoLibre-%E2%89%A5%203.0.0-2e7d32)
![renderer](https://img.shields.io/badge/renderer-MapLibre-396cb2)
![license](https://img.shields.io/badge/license-MIT-blue)

Fetch georeferenced occurrence records from the
[Global Biodiversity Information Facility](https://www.gbif.org) straight onto
the GeoLibre map. A companion to the
[iNaturalist Extractor](https://github.com/Defani/Geolibre-Inaturalist-Extraction-Plugins)
plugin, with the same green accent and a simpler step-by-step panel.

> **Ringkasan (Bahasa Indonesia)** — Plugin GeoLibre untuk mengambil data
> kemunculan (occurrence) spesies dari GBIF langsung ke peta. Filter
> berdasarkan area (tampilan peta, extent layer, negara, atau seluruh dunia),
> takson, jenis rekaman, tahun, kualitas data, kategori IUCN, dan lainnya.
> Hasil bisa ditambahkan sebagai titik (GeoJSON, maks. 5.000 rekaman), sebagai
> layer kepadatan heksagon GBIF, atau keduanya. Klik titik untuk melihat
> detail dan foto rekaman.

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Install](#install)
- [Quick start](#quick-start)
- [The panel, step by step](#the-panel-step-by-step)
- [Output](#output)
- [Attribute columns](#attribute-columns)
- [Limits and defaults](#limits-and-defaults)
- [How it works](#how-it-works)
- [Troubleshooting](#troubleshooting)
- [Repository layout](#repository-layout)
- [Development](#development)
- [Data use](#data-use)
- [Privacy](#privacy)
- [Changelog](#changelog)
- [Licence](#licence)

## Features

- **Live counter** — the header shows how many GBIF records match the current
  filters (a `limit=0` request), and follows the map while the area is the
  map view.
- **01 Area** — map view, extent of a layer, a country (ISO code), or the whole
  world (only together with a narrowing filter).
- **02 Taxon** — search the GBIF backbone with suggestions (`species/suggest`,
  Enter falls back to `species/match`), pick several taxa, and/or one-click
  major groups (Animalia, Plantae, Fungi, Aves, Mammalia, ...). Everything
  selected is combined with OR.
- **03 Record type** — basis of record (human observation, preserved specimen,
  machine observation, ...).
- **04 Time** — all years or a year range, with presets.
- **05 Quality** — photos only, drop geospatial issues, presence records only,
  maximum coordinate uncertainty, IUCN Red List category.
- **06 More filters** — recorded by, dataset key, institution code, keyword.
- **Add to map** as points (GeoJSON, up to 5,000 records), as GBIF hexagon
  density tiles (every matching record, via the ad-hoc map API), or both.
- **Results card** — records added, records with a photo, species count,
  total in GBIF, and the five most recorded species.
- **Popup** — click a point for its name, date, recorder, family, place,
  coordinate uncertainty, IUCN category, dataset and photo, with a link to the
  record on GBIF.org. The popup stays inside the map near the edges.
- **Active filter tags** — every filter in use shows as a removable chip above
  the Fetch button; **Reset** clears them all at once.
- **No API key, no dependencies** — a single self-contained ES module that
  talks to the public GBIF API directly.

## Requirements

- GeoLibre 3.0.0 or newer, MapLibre renderer.
- `addTileLayer` support in the host for the density output (points work
  without it).
- An internet connection that can reach `api.gbif.org` (and the photo hosts,
  for record images in the popup).

## Install

### From a release zip

Zip the three plugin files with `plugin.json` at the root of the zip:

```powershell
cd geolibre-gbif-data
Compress-Archive -Path plugin.json, index.js, style.css -DestinationPath ..\geolibre-gbif-data-1.0.0.zip
```

On macOS / Linux:

```bash
cd geolibre-gbif-data && zip ../geolibre-gbif-data-1.0.0.zip plugin.json index.js style.css
```

Then in GeoLibre: **Settings → Manage Plugins → Install from file** and pick
the zip.

### From the marketplace

[`marketplace/registry-entry.json`](marketplace/registry-entry.json) is the
entry for the GeoLibre plugin registry (id `geolibre-gbif-data`, category
*Data*, `minGeoLibreVersion` 3.0.0). Once it is listed, install the plugin
from **Settings → Manage Plugins** like any other.

## Quick start

1. Open the panel with the **leaf** button in the map's top-right toolbar (or
   the GBIF Data icon on the right panel rail).
2. Pan and zoom the map to the area you care about — **Area** defaults to
   *Map view*.
3. Under **Taxon**, type a scientific name (e.g. `Panthera tigris`) and pick
   it from the list, or click a major group such as **Aves**.
4. Watch the counter in the header update with the number of matching
   records.
5. Press **Fetch 500 records**. A point layer named
   `GBIF – <taxa> (<count>)` is added, and the results card lists the most
   recorded species.
6. Click any point to open its popup.

## The panel, step by step

| Step | What it sets | Notes |
| --- | --- | --- |
| **01 Area** | `decimalLatitude` / `decimalLongitude` ranges, or `country` | *Map view* follows the map. *Layer* uses the bounding box of a vector layer, not its exact shape. *Country* uses GBIF's country assignment, wherever the map is. *World* needs a taxon, dataset, recorder, institution or keyword. |
| **02 Taxon** | `taxonKey` (repeated) | Suggestions appear after 2 characters. Arrow keys + Enter pick a suggestion; Enter with nothing highlighted asks `species/match` for the best backbone match. Groups: Animalia, Plantae, Fungi, Aves, Mammalia, Reptilia, Amphibia, Actinopterygii, Insecta, Arachnida, Mollusca, Chromista. |
| **03 Record type** | `basisOfRecord` (repeated) | None selected = every type. |
| **04 Time** | `year` | Presets: last 5 years, last 10 years, since 2000, this year. A reversed range is swapped automatically. |
| **05 Quality** | `mediaType`, `hasGeospatialIssue`, `occurrenceStatus`, `coordinateUncertaintyInMeters`, `iucnRedListCategory` | *Drop geospatial issues* and *Presence records only* are on by default. An uncertainty limit (≤ 100 m, ≤ 1 km, ≤ 10 km) also drops records that don't state their uncertainty. IUCN: CR, EN, VU, NT, LC, DD. |
| **06 More filters** | `recordedBy`, `datasetKey`, `institutionCode`, `q` | Comma-, semicolon- or newline-separated lists for the first three. |

Within a step, multiple values are OR-ed; different steps are AND-ed.

## Output

Choose under **Add to map**:

- **Points** — fetches up to *Max records* (10–5,000, default 500) in pages of
  300 and adds a GeoJSON point layer. When the area is *Country* or *World*,
  the map zooms to the fetched records.
- **Density** — adds a raster tile layer from GBIF's ad-hoc map API
  (`classic.poly` style, hexagon bins, 40 hexagons per tile, 85 % opacity)
  that shows **every** matching record, not only the fetched ones. Nothing is
  downloaded record by record, so it is instant even for millions of records.
- **Both** — the density layer plus the point layer.

Points, counter and density tiles are built from the same filter parameters,
so they always describe the same set of records.

## Attribute columns

Every attribute is a flat column, so the attribute table and exports show one
value per column:

| Column | Meaning |
| --- | --- |
| `gbifKey` | GBIF occurrence key |
| `scientificName`, `species`, `vernacularName`, `taxonRank` | Name as interpreted by GBIF |
| `kingdom`, `phylum`, `class`, `order`, `family`, `genus` | Backbone classification |
| `taxonKey`, `speciesKey` | Backbone keys |
| `basisOfRecord` | Record type |
| `eventDate`, `year` | When it was recorded |
| `recordedBy` | Observer / collector |
| `country`, `countryCode`, `stateProvince`, `locality` | Where it was recorded |
| `uncertaintyM` | Coordinate uncertainty in metres |
| `iucnRedListCategory` | IUCN Red List category |
| `occurrenceStatus` | `PRESENT` / `ABSENT` |
| `datasetName`, `datasetKey`, `institutionCode`, `publisher` | Source dataset and publishing organisation key |
| `license` | Licence of the record |
| `imageCount`, `image`, `imageCreator`, `imageLicense` | First still image and its rights holder / licence |
| `gbifUrl` | Link to the record on GBIF.org |

Each feature also carries an internal `__gbifPlugin` flag that the plugin uses
to recognise its own points for the popup.

## Limits and defaults

| Setting | Value |
| --- | --- |
| Records per request | 300 (GBIF's ceiling) |
| Max records per fetch | 5,000 (default 500) |
| Pause between pages | 200 ms |
| Request timeout | 30 s (10 s for taxon search, 15 s for the counter) |
| Counter refresh | 450 ms after the last change or map move |

The cap keeps the plugin polite to the public API. For larger or citable
extracts use a [GBIF download](https://www.gbif.org/occurrence/search), which
gets a DOI.

## How it works

GBIF endpoints used:

| Endpoint | Purpose |
| --- | --- |
| `GET /v1/occurrence/search` | Records (paged) and the live counter (`limit=0`) |
| `GET /v1/species/suggest` | Taxon autocomplete |
| `GET /v1/species/match` | Best backbone match on Enter |
| `GET /v2/map/occurrence/adhoc/{z}/{x}/{y}@1x.png` | Density tiles |

GeoLibre host API used: `getMap`, `addMapControl` / `removeMapControl`,
`registerRightPanel` (falls back to `registerFloatingPanel`),
`openRightPanel` / `openFloatingPanel`, `getViewBounds`, `listLayers`,
`getSelectedLayerId`, `getLayerFeatures`, `addGeoJsonLayer`, `addTileLayer`,
`fitBounds` and `getActiveMapTool` (the popup steps aside while Identify,
selection or GeoEditor own the click).

Other details:

- A map view wider than the world or crossing the antimeridian drops the
  longitude range instead of sending an inverted one.
- iNaturalist photos (the biggest photo source in GBIF) are shown in their
  *medium* rendition rather than the full-size original.
- All panel and popup content is built through the DOM API, never
  `innerHTML`, so nothing from an API response is parsed as markup.
- The popup is a plain DOM overlay positioned with `map.project()`, so the
  plugin needs no copy of `maplibre-gl`.
- Deactivating the plugin cancels a running fetch and removes the control,
  panel, popup and map listeners.

## Troubleshooting

| Message | What to do |
| --- | --- |
| *A world search needs a taxon, dataset, recorder, institution or keyword.* | Add a narrowing filter, or pick another Area. |
| *That layer has no vector features to take an extent from* | Raster and tile layers have no extent to read — pick a vector layer or use Map view. |
| *This GeoLibre version can't add tile layers* | Your host lacks `addTileLayer`; choose **Points**. |
| *GBIF did not answer within 30 s* | The public API is busy; try again, or narrow the filters. |
| Counter shows **!** | `api.gbif.org` is unreachable — check the connection or a firewall/proxy. |
| *No georeferenced records matched these filters.* | Loosen the filters (uncertainty limit, year range, photos only). |
| Fewer points than the counter | Expected: points are capped at *Max records*. Raise it, narrow the filters, or add the Density layer. |

## Repository layout

```
GBIF-Data/
├── geolibre-gbif-data/          # the plugin (zip these three files)
│   ├── plugin.json              # manifest: id, version, entry, style, engines
│   ├── index.js                 # self-contained ES module, exports `plugin`
│   ├── style.css                # panel, popup and control styles (light + dark)
│   └── LICENSE
├── marketplace/
│   └── registry-entry.json      # entry for the GeoLibre plugin registry
├── LICENSE
└── README.md
```

## Development

There is no build step. Edit the files in `geolibre-gbif-data/`, zip them as
shown in [Install](#install), and reinstall the zip in GeoLibre.

- Keep `index.js` self-contained: the GeoLibre loader does not resolve bare or
  relative `import`s inside a plugin zip.
- When releasing, bump the version in `plugin.json`,
  `marketplace/registry-entry.json` and `PLUGIN_VERSION` in `index.js`
  together.
- All CSS classes are prefixed `geolibre-gbif-` to avoid clashing with the
  host or other plugins.

Issues and pull requests are welcome on
[GitHub](https://github.com/Defani/GBIF-Data/issues).

## Data use

Records come from the public GBIF API (`https://api.gbif.org/v1`). GBIF data
is published under CC0, CC BY or CC BY-NC by each dataset's publisher — check
each record's `license` column and
[cite the datasets you use](https://www.gbif.org/citation-guidelines). For a
citable, DOI-backed export of a large query, use a GBIF download instead.
Photos belong to their rights holders (`imageCreator`, `imageLicense`).

## Privacy

The plugin sends only your filter parameters (area bounds, taxon keys, years,
etc.) to `api.gbif.org`, and loads record photos from their publishers'
servers when a popup opens. It stores nothing and needs no account or key.

## Changelog

### 1.0.0

- First release: six-step filter panel, live counter, point and density
  output, results card and record popup.

## Licence

[MIT](LICENSE), © 2026 Defani Arman Alfitriansyah. Icons from Google's
Material Symbols (Apache-2.0).
