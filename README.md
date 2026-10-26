# GBIF Data — GeoLibre plugin

Fetch georeferenced occurrence records from the
[Global Biodiversity Information Facility](https://www.gbif.org) straight onto
the GeoLibre map. A companion to the
[iNaturalist Extractor](https://github.com/Defani/Geolibre-Inaturalist-Extraction-Plugins)
plugin, with the same green accent and a simpler step-by-step panel.

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

Every attribute is a flat column (`gbifKey`, `species`, `family`,
`basisOfRecord`, `eventDate`, `recordedBy`, `iucnRedListCategory`, `image`,
`gbifUrl`, ...), so the attribute table and exports show one value per column.

## Requirements

- GeoLibre 3.0.0 or newer, MapLibre renderer.
- `addTileLayer` support in the host for the density output (points work
  without it).

## Install

Zip the three plugin files with `plugin.json` at the root of the zip:

```powershell
cd geolibre-gbif-data
Compress-Archive -Path plugin.json, index.js, style.css -DestinationPath ..\geolibre-gbif-data-1.0.0.zip
```

Then in GeoLibre: **Settings → Manage Plugins → Install from file** and pick
the zip.

## Data use

Records come from the public GBIF API (`https://api.gbif.org/v1`). GBIF data
is published under CC0, CC BY or CC BY-NC by each dataset's publisher — check
each record's `license` column and
[cite the datasets you use](https://www.gbif.org/citation-guidelines). For a
citable, DOI-backed export of a large query, use a GBIF download instead.

## Licence

[MIT](LICENSE), © 2026 Defani Arman Alfitriansyah. Icons from Google's
Material Symbols (Apache-2.0).
