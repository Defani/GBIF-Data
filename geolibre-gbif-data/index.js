// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Defani Arman Alfitriansyah

// GeoLibre external plugin: GBIF Data
//
// Fetches occurrence records from the Global Biodiversity Information
// Facility (public GBIF API v1 - https://api.gbif.org/v1/occurrence/search),
// adds them to the map as a GeoJSON layer and, optionally, as a GBIF density
// tile layer (https://api.gbif.org/v2/map/occurrence/adhoc) that shows every
// matching record, not just the ones fetched. Clicking a point opens a popup
// with the record's details and its photo when it has one.
//
// Feature set:
//  - Area: current map view, the extent of a layer, a country (ISO code), or
//    the whole world (only with a filter that narrows the search).
//  - Taxon: backbone search with suggestions (species/suggest), several taxa
//    at once, plus one-click major groups (kingdoms / classes).
//  - Basis of record, year range, photos only, IUCN Red List category,
//    coordinate uncertainty, geospatial-issue and "present only" switches,
//    recorded by, dataset key, institution code and full-text search.
//  - A live "N records match" counter (limit=0 requests) in the header.
//  - Licence filter and a "Cite this data" card (citation text, dataset list
//    with record counts for a GBIF derived dataset DOI, link to the same
//    search on GBIF.org), following the GBIF data user agreement and citation
//    guidelines (https://www.gbif.org/terms/data-user).
//
// An independent community plugin: not made, affiliated with or endorsed by
// GBIF. The data belong to their publishers.
//
// This is a self-contained ES module: no bare `import`s, everything the
// plugin needs is written inline below (per the GeoLibre plugin contract,
// relative/bare imports inside the zip are not resolved by the loader).

const SVG_NS = "http://www.w3.org/2000/svg";

const PLUGIN_ID = "geolibre-gbif-data";
const PLUGIN_VERSION = "1.1.1";
const PANEL_ID = `${PLUGIN_ID}-panel`;
const PLUGIN_TITLE = "GBIF Data";

// Marker written on every feature this plugin adds, so the map click handler
// can recognise "one of ours" whatever layer id addGeoJsonLayer() returns.
const MARKER_PROP = "__gbifPlugin";

const API_ROOT = "https://api.gbif.org";
const SEARCH_URL = `${API_ROOT}/v1/occurrence/search`;
const SUGGEST_URL = `${API_ROOT}/v1/species/suggest`;
const MATCH_URL = `${API_ROOT}/v1/species/match`;
const ADHOC_TILE_URL = `${API_ROOT}/v2/map/occurrence/adhoc/{z}/{x}/{y}@1x.png`;
const SITE_ROOT = "https://www.gbif.org";
const SITE_SEARCH_URL = `${SITE_ROOT}/occurrence/search`;
const DERIVED_DATASET_URL = `${SITE_ROOT}/derived-dataset/register`;
const CITATION_GUIDE_URL = `${SITE_ROOT}/citation-guidelines`;
const DATA_USER_TERMS_URL = `${SITE_ROOT}/terms/data-user`;

const PER_PAGE_LIMIT = 300; // GBIF's own per-request ceiling
const DEFAULT_MAX_RECORDS = 500;
const MAX_ALLOWED_RECORDS = 5000; // keep the plugin polite to the public API
const PAGE_DELAY_MS = 200;
const REQUEST_TIMEOUT_MS = 30000;
// GBIF answers 429 when it is busy; back off and retry a few times rather
// than keep hammering it (the data user agreement forbids disrupting the API).
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 2000;

// One-click groups. Keys are GBIF backbone taxon keys, sent as taxonKey
// (several taxonKey values are OR-ed by the API).
const TAXON_GROUPS = [
  { key: 1, label: "Animalia" },
  { key: 6, label: "Plantae" },
  { key: 5, label: "Fungi" },
  { key: 212, label: "Aves" },
  { key: 359, label: "Mammalia" },
  { key: 358, label: "Reptilia" },
  { key: 131, label: "Amphibia" },
  { key: 204, label: "Actinopterygii" },
  { key: 216, label: "Insecta" },
  { key: 367, label: "Arachnida" },
  { key: 52, label: "Mollusca" },
  { key: 4, label: "Chromista" },
];

const BASIS_OF_RECORD = [
  { value: "HUMAN_OBSERVATION", label: "Human observation" },
  { value: "PRESERVED_SPECIMEN", label: "Preserved specimen" },
  { value: "MACHINE_OBSERVATION", label: "Machine observation" },
  { value: "MATERIAL_SAMPLE", label: "Material sample" },
  { value: "LIVING_SPECIMEN", label: "Living specimen" },
  { value: "FOSSIL_SPECIMEN", label: "Fossil specimen" },
  { value: "OBSERVATION", label: "Observation" },
  { value: "MATERIAL_CITATION", label: "Material citation" },
  { value: "OCCURRENCE", label: "Occurrence" },
];

const IUCN_CATEGORIES = [
  { value: "CR", label: "CR", title: "Critically endangered" },
  { value: "EN", label: "EN", title: "Endangered" },
  { value: "VU", label: "VU", title: "Vulnerable" },
  { value: "NT", label: "NT", title: "Near threatened" },
  { value: "LC", label: "LC", title: "Least concern" },
  { value: "DD", label: "DD", title: "Data deficient" },
];

// The three licences GBIF allows for occurrence data (values of `license`).
const LICENSES = [
  { value: "CC0_1_0", label: "CC0", title: "Public domain dedication - no conditions" },
  { value: "CC_BY_4_0", label: "CC BY", title: "Attribution required" },
  { value: "CC_BY_NC_4_0", label: "CC BY-NC", title: "Attribution required, no commercial use" },
];

const UNCERTAINTY_CHOICES = [
  { value: "", label: "Any uncertainty" },
  { value: "100", label: "≤ 100 m" },
  { value: "1000", label: "≤ 1 km" },
  { value: "10000", label: "≤ 10 km" },
];

// ISO 3166-1 alpha-2 codes. Indonesia and its neighbours first, then a short
// world list; GBIF's `country` parameter takes the code.
const COUNTRIES = [
  ["ID", "Indonesia"],
  ["MY", "Malaysia"],
  ["SG", "Singapore"],
  ["BN", "Brunei"],
  ["TL", "Timor-Leste"],
  ["PG", "Papua New Guinea"],
  ["PH", "Philippines"],
  ["TH", "Thailand"],
  ["VN", "Viet Nam"],
  ["KH", "Cambodia"],
  ["LA", "Laos"],
  ["MM", "Myanmar"],
  ["AU", "Australia"],
  ["BD", "Bangladesh"],
  ["BR", "Brazil"],
  ["CA", "Canada"],
  ["CN", "China"],
  ["CO", "Colombia"],
  ["FR", "France"],
  ["DE", "Germany"],
  ["IN", "India"],
  ["JP", "Japan"],
  ["KE", "Kenya"],
  ["MX", "Mexico"],
  ["NL", "Netherlands"],
  ["NZ", "New Zealand"],
  ["PE", "Peru"],
  ["ZA", "South Africa"],
  ["KR", "South Korea"],
  ["ES", "Spain"],
  ["LK", "Sri Lanka"],
  ["GB", "United Kingdom"],
  ["US", "United States"],
];

// ############################################################################
// ########## Icons ##########################################################
// ############################################################################

// Material Symbols (Outlined, weight 400), Apache-2.0, inlined so the plugin
// needs no font request and the icons follow the theme through currentColor.
const MATERIAL_ICONS = {
  map:
    "m612-120-263-93-179 71q-17 9-33.5-1T120-173v-558q0-13 7.5-23t19.5-15l202-71 263 92 178-71q17-8 33.5 1.5T840-788v565q0 11-7.5 19T814-192l-202 72Zm-34-75v-505l-196-66v505l196 66Zm60 0 142-47v-512l-142 54v505Zm-458-12 142-54v-505l-142 47v512Zm458-493v505-505Zm-316-66v505-505Z",
  eco:
    "M213-175q-43.59-45-68.3-104Q120-338 120-400q0-73 25.5-133.5T222-645q35-35 87-59t122.5-37.5Q502-755 591-758.5t198 3.5q8 108 5.5 197.5t-16 160.75q-13.5 71.25-38 124.56Q716-218.87 680-183q-51 51-110 77T444-80q-69 0-126.5-23.5T213-175Zm103 0q25 17 58 26t69.92 9Q497-140 547-162t91-64q27-27 46-70.5t31-103Q727-459 731-534t0-165q-94-2-168.5 2.5T431-680q-57 12-98 30.5T266-604q-42 43-64 91t-22 98q0 48 20.5 100.5T251-230q53-98 127-176t157-123q-87 75-141 162.5T316-175Zm0 0Zm0 0Z",
  calendar_month:
    "M180-80q-24 0-42-18t-18-42v-620q0-24 18-42t42-18h65v-60h65v60h340v-60h65v60h65q24 0 42 18t18 42v620q0 24-18 42t-42 18H180Zm0-60h600v-430H180v430Zm0-490h600v-130H180v130Zm0 0v-130 130Z",
  verified:
    "m346-60-76-130-151-31 17-147-96-112 96-111-17-147 151-31 76-131 134 62 134-62 77 131 150 31-17 147 96 111-96 112 17 147-150 31-77 130-134-62-134 62Zm27-79 107-45 110 45 67-100 117-30-12-119 81-92-81-94 12-119-117-28-69-100-108 45-110-45-67 100-117 28 12 119-81 94 81 92-12 121 117 28 70 100Zm107-341Zm-43 133 227-225-45-41-182 180-95-99-46 45 141 140Z",
  tune:
    "M427-120v-225h60v83h353v60H487v82h-60Zm-307-82v-60h247v60H120Zm187-166v-82H120v-60h187v-84h60v226h-60Zm120-82v-60h413v60H427Zm166-165v-225h60v82h187v60H653v83h-60Zm-473-83v-60h413v60H120Z",
  list_alt:
    "M321-295q9-9 9-21t-9-21q-9-9-21-9t-21 9q-9 9-9 21t9 21q9 9 21 9t21-9Zm0-164q9-9 9-21t-9-21q-9-9-21-9t-21 9q-9 9-9 21t9 21q9 9 21 9t21-9Zm0-164q9-9 9-21t-9-21q-9-9-21-9t-21 9q-9 9-9 21t9 21q9 9 21 9t21-9Zm111 337h244v-60H432v60Zm0-164h244v-60H432v60Zm0-164h244v-60H432v60ZM180-120q-24 0-42-18t-18-42v-600q0-24 18-42t42-18h600q24 0 42 18t18 42v600q0 24-18 42t-42 18H180Zm0-60h600v-600H180v600Zm0-600v600-600Z",
};

function createMaterialIcon(name, size = 16) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 -960 960 960");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", MATERIAL_ICONS[name]);
  svg.appendChild(path);
  return svg;
}

// The plugin's mark is a leaf (Material Symbols "eco"). Deliberately not a
// globe, which GeoLibre already uses for its projection toggle right above
// this button. On the toolbar it is drawn in currentColor, so it follows the
// theme. The rail icon is an <img>, where currentColor can't reach, so it is
// drawn black and style.css inverts it to white under html.dark; the id in
// the SVG is what that rule matches.
const RAIL_ICON_DATA_URI =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" id="geolibre-gbif-data-icon" width="24" height="24" viewBox="0 -960 960 960">' +
      '<path fill="#111111" d="' + MATERIAL_ICONS.eco + '"/>' +
      "</svg>",
  );

// ############################################################################
// ########## Module state ###################################################
// ############################################################################

const state = {
  app: null,
  map: null,
  mapHandlers: null,
  disposePanel: null,
  panelKind: null, // "right" | "floating" | null
  popup: null,
  fetching: false,
  abortController: null,
  disposers: [],
};

// ############################################################################
// ########## Small helpers ##################################################
// ############################################################################

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatCount(n) {
  return new Intl.NumberFormat().format(n);
}

function compactCount(n) {
  if (n < 10000) return formatCount(n);
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

function httpUrl(value) {
  return typeof value === "string" && /^https?:\/\//i.test(value) ? value : null;
}

// Built through the DOM API (not innerHTML) so nothing from an API response
// is ever parsed as markup.
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function button(className, text) {
  const node = el("button", className, text);
  node.type = "button";
  return node;
}

function splitList(raw) {
  return String(raw || "")
    .split(/[,;\n]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function formatEventDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function prettyEnum(value) {
  if (!value) return null;
  const s = String(value).replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function extendBounds(bounds, coords) {
  if (!Array.isArray(coords) || coords.length === 0) return;
  if (typeof coords[0] === "number") {
    const [lng, lat] = coords;
    if (typeof lng !== "number" || typeof lat !== "number") return;
    if (lng < bounds[0]) bounds[0] = lng;
    if (lat < bounds[1]) bounds[1] = lat;
    if (lng > bounds[2]) bounds[2] = lng;
    if (lat > bounds[3]) bounds[3] = lat;
    return;
  }
  for (const child of coords) extendBounds(bounds, child);
}

function boundsOfGeometry(geometry, bounds) {
  if (!geometry) return;
  if (geometry.type === "GeometryCollection") {
    for (const g of geometry.geometries || []) boundsOfGeometry(g, bounds);
    return;
  }
  extendBounds(bounds, geometry.coordinates);
}

// [west, south, east, north] of a list of features, or null.
function computeBoundsFromFeatures(features) {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const feature of features || []) boundsOfGeometry(feature && feature.geometry, bounds);
  return bounds.every(Number.isFinite) ? bounds : null;
}

// GBIF takes coordinate ranges as "min,max". A view wider than the world (or
// wrapped across the antimeridian) drops the longitude range rather than send
// an inverted one.
function boundsToRanges(bounds) {
  const [west, south, east, north] = bounds;
  const lat = `${clamp(south, -90, 90).toFixed(5)},${clamp(north, -90, 90).toFixed(5)}`;
  if (east - west >= 360 || west < -180 || east > 180 || west > east) {
    return { lat, lng: null };
  }
  return { lat, lng: `${west.toFixed(5)},${east.toFixed(5)}` };
}

// Small-image URL for a record photo. iNaturalist (the biggest photo source in
// GBIF) publishes "original" files, which are far too large for a popup, so
// those are swapped for the "medium" rendition; other publishers' files are
// used as they are (GBIF's resizing cache only accepts signed requests).
function thumbnailUrl(url) {
  const safe = httpUrl(url);
  if (!safe) return null;
  if (/inaturalist-open-data|static\.inaturalist\.org/i.test(safe)) {
    return safe.replace(/\/original\.([a-z]+)/i, "/medium.$1");
  }
  return safe;
}

// GBIF returns a licence as a Creative Commons URL (record) or an enum such
// as CC_BY_4_0 (filter); both become a short label.
function licenseLabel(value) {
  if (!value) return null;
  const s = String(value).toLowerCase();
  if (/publicdomain\/zero|cc0/.test(s)) return "CC0";
  if (/by[-_]nc/.test(s)) return "CC BY-NC";
  if (/licenses\/by\/|cc_by_4_0|^cc[- ]by$/.test(s)) return "CC BY";
  return String(value);
}

function isoDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function longDate(date = new Date()) {
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API refused (no permission / insecure context): fall back to
    // a temporary selection.
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

function saveTextFile(name, text, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ############################################################################
// ########## Requests #######################################################
// ############################################################################

// Turns the filter object the panel builds into GBIF search parameters (no
// paging). The same parameters drive the record search, the live counter and
// the density tiles, so all three always describe the same set of records.
function buildFilterParams(f) {
  const params = new URLSearchParams();
  params.set("hasCoordinate", "true");
  if (f.noGeoIssues) params.set("hasGeospatialIssue", "false");
  if (f.presentOnly) params.set("occurrenceStatus", "PRESENT");

  if (f.bounds) {
    const { lat, lng } = boundsToRanges(f.bounds);
    params.set("decimalLatitude", lat);
    if (lng) params.set("decimalLongitude", lng);
  }
  if (f.country) params.set("country", f.country);

  for (const key of f.taxonKeys) params.append("taxonKey", String(key));
  for (const basis of f.basis) params.append("basisOfRecord", basis);
  for (const cat of f.iucn) params.append("iucnRedListCategory", cat);
  for (const lic of f.licenses) params.append("license", lic);

  if (f.yearFrom || f.yearTo) {
    const from = f.yearFrom || "*";
    const to = f.yearTo || "*";
    params.set("year", from === to ? String(from) : `${from},${to}`);
  }
  if (f.photosOnly) params.set("mediaType", "StillImage");
  if (f.maxUncertainty) params.set("coordinateUncertaintyInMeters", `0,${f.maxUncertainty}`);
  for (const name of f.recordedBy) params.append("recordedBy", name);
  for (const key of f.datasetKeys) params.append("datasetKey", key);
  for (const code of f.institutionCodes) params.append("institutionCode", code);
  if (f.q) params.set("q", f.q);
  return params;
}

function searchUrl(filters, limit, offset) {
  const params = buildFilterParams(filters);
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  return `${SEARCH_URL}?${params.toString()}`;
}

function densityTileUrl(filters) {
  const params = buildFilterParams(filters);
  params.set("style", "classic.poly");
  params.set("bin", "hex");
  params.set("hexPerTile", "40");
  params.set("srs", "EPSG:3857");
  // The tile template keeps {z}/{x}/{y} unescaped; only the query is encoded.
  return `${ADHOC_TILE_URL}?${params.toString()}`;
}

// The same search on GBIF.org, where the person can make a download with its
// own DOI. The website takes the API's parameters in snake_case, and an area
// as a WKT polygon.
function siteSearchUrl(filters) {
  const api = buildFilterParams({ ...filters, bounds: null });
  const params = new URLSearchParams();
  for (const [key, value] of api) {
    params.append(key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`), value);
  }
  if (filters.bounds) {
    const { lat, lng } = boundsToRanges(filters.bounds);
    const [s, n] = lat.split(",");
    const [w, e] = lng ? lng.split(",") : ["-180", "180"];
    params.set("geometry", `POLYGON((${w} ${s},${e} ${s},${e} ${n},${w} ${n},${w} ${s}))`);
  }
  return `${SITE_SEARCH_URL}?${params.toString()}`;
}

function retryDelayMs(response, attempt) {
  const header = Number(response.headers.get("Retry-After"));
  if (Number.isFinite(header) && header > 0) return Math.min(header, 60) * 1000;
  return RETRY_BASE_MS * 2 ** attempt;
}

// One GBIF request with a hard time limit. A timeout becomes a visible error;
// an abort from the panel (Cancel, plugin closed) stays an AbortError. A 429
// or 503 is retried after the delay GBIF asks for (or an exponential one).
async function fetchJsonWithTimeout(url, outerSignal, timeoutMs = REQUEST_TIMEOUT_MS) {
  for (let attempt = 0; ; attempt += 1) {
    const result = await fetchJsonOnce(url, outerSignal, timeoutMs);
    if (!result.retry || attempt >= MAX_RETRIES) {
      if (result.retry) throw new Error("GBIF is busy (too many requests) - wait a minute and try again.");
      return result.data;
    }
    await sleep(retryDelayMs(result.response, attempt));
    if (outerSignal?.aborted) throw new DOMException("Aborted", "AbortError");
  }
}

async function fetchJsonOnce(url, outerSignal, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const onOuterAbort = () => controller.abort();
  if (outerSignal) {
    if (outerSignal.aborted) controller.abort();
    else outerSignal.addEventListener("abort", onOuterAbort, { once: true });
  }
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (response.status === 429 || response.status === 503) {
      return { retry: true, response };
    }
    if (!response.ok) {
      let detail = "";
      try {
        detail = (await response.text()).slice(0, 160);
      } catch {
        // body unreadable - status alone is enough
      }
      throw new Error(`GBIF API responded with ${response.status}${detail ? `: ${detail}` : ""}`);
    }
    return { retry: false, data: await response.json() };
  } catch (error) {
    if (timedOut) {
      throw new Error(`GBIF did not answer within ${Math.round(timeoutMs / 1000)} s - try again in a moment.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    if (outerSignal) outerSignal.removeEventListener("abort", onOuterAbort);
  }
}

// Maps one GBIF occurrence to a flat GeoJSON Feature (every value a scalar, so
// the attribute table and exports show one column per field).
// `accessedOn` (YYYY-MM-DD) goes on every record: citations of GBIF data
// state the access date. Dataset key, publisher and licence stay on each
// record too, as the data user agreement asks for data shared onward.
function occurrenceToFeature(rec, accessedOn) {
  const lat = rec.decimalLatitude;
  const lng = rec.decimalLongitude;
  if (typeof lat !== "number" || typeof lng !== "number") return null;

  const images = Array.isArray(rec.media)
    ? rec.media.filter((m) => m && m.type === "StillImage" && httpUrl(m.identifier))
    : [];
  const image = images[0] || null;

  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [lng, lat] },
    properties: {
      [MARKER_PROP]: true,
      gbifKey: rec.key,
      scientificName: rec.scientificName || null,
      species: rec.species || null,
      vernacularName: rec.vernacularName || null,
      taxonRank: rec.taxonRank || null,
      kingdom: rec.kingdom || null,
      phylum: rec.phylum || null,
      class: rec.class || null,
      order: rec.order || null,
      family: rec.family || null,
      genus: rec.genus || null,
      taxonKey: rec.taxonKey || null,
      speciesKey: rec.speciesKey || null,
      basisOfRecord: rec.basisOfRecord || null,
      eventDate: rec.eventDate || null,
      year: rec.year || null,
      recordedBy: rec.recordedBy || null,
      country: rec.country || null,
      countryCode: rec.countryCode || null,
      stateProvince: rec.stateProvince || null,
      locality: rec.locality || null,
      uncertaintyM:
        typeof rec.coordinateUncertaintyInMeters === "number" ? rec.coordinateUncertaintyInMeters : null,
      iucnRedListCategory: rec.iucnRedListCategory || null,
      occurrenceStatus: rec.occurrenceStatus || null,
      datasetName: rec.datasetName || null,
      datasetKey: rec.datasetKey || null,
      datasetUrl: rec.datasetKey ? `${SITE_ROOT}/dataset/${rec.datasetKey}` : null,
      institutionCode: rec.institutionCode || null,
      publisher: rec.publishingOrgKey || null,
      rightsHolder: rec.rightsHolder || null,
      occurrenceID: rec.occurrenceID || null,
      license: rec.license || null,
      licenseLabel: licenseLabel(rec.license),
      imageCount: images.length,
      image: image ? image.identifier : null,
      imageCreator: image ? image.rightsHolder || image.creator || null : null,
      imageLicense: image ? image.license || null : null,
      gbifUrl: `${SITE_ROOT}/occurrence/${rec.key}`,
      accessed: accessedOn,
    },
  };
}

// ############################################################################
// ########## Map control (toolbar button) ###################################
// ############################################################################

const control = {
  _container: null,
  onAdd() {
    const container = el("div", "maplibregl-ctrl maplibregl-ctrl-group geolibre-gbif-control");
    const btn = button();
    btn.title = PLUGIN_TITLE;
    btn.setAttribute("aria-label", "Open the GBIF Data panel");
    btn.appendChild(createMaterialIcon("eco", 20));
    btn.addEventListener("click", () => {
      if (state.panelKind === "right") state.app?.openRightPanel?.(PANEL_ID);
      else if (state.panelKind === "floating") state.app?.openFloatingPanel?.(PANEL_ID);
    });
    container.appendChild(btn);
    this._container = container;
    return container;
  },
  onRemove() {
    this._container?.remove();
    this._container = null;
  },
};

// ############################################################################
// ########## Panel UI ########################################################
// ############################################################################

// A row of mutually exclusive square buttons. Returns { root, get, set }.
function segmented(options, initial, onChange) {
  const root = el("div", "geolibre-gbif-seg");
  root.setAttribute("role", "radiogroup");
  let value = initial;
  const buttons = [];
  for (const opt of options) {
    const b = button("geolibre-gbif-seg-btn", opt.label);
    b.setAttribute("role", "radio");
    if (opt.title) b.title = opt.title;
    b.addEventListener("click", () => {
      if (value === opt.value) return;
      set(opt.value);
      onChange(value);
    });
    buttons.push({ b, value: opt.value });
    root.appendChild(b);
  }
  function set(v) {
    value = v;
    for (const x of buttons) x.b.setAttribute("aria-checked", String(x.value === value));
  }
  set(initial);
  return { root, get: () => value, set };
}

// An on/off switch row. Returns the checkbox input.
function switchRow(parent, label, help, checked) {
  const row = el("label", "geolibre-gbif-switch");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  const track = el("span", "geolibre-gbif-switch-track");
  const text = el("span", "geolibre-gbif-switch-text");
  text.appendChild(el("strong", null, label));
  if (help) text.appendChild(el("small", null, help));
  row.append(input, track, text);
  parent.appendChild(row);
  return input;
}

function textInput(placeholder) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "geolibre-gbif-input";
  input.placeholder = placeholder;
  input.autocomplete = "off";
  input.spellcheck = false;
  return input;
}

function field(labelText, control, helpText) {
  const wrap = el("label", "geolibre-gbif-field");
  wrap.appendChild(el("span", "geolibre-gbif-field-label", labelText));
  wrap.appendChild(control);
  if (helpText) wrap.appendChild(el("p", "geolibre-gbif-help", helpText));
  return wrap;
}

function renderPanel(container) {
  const root = el("div", "geolibre-gbif-panel");

  // ---- Header: title, reset, live counter ------------------------------------
  const head = el("div", "geolibre-gbif-head");
  // The host's panel chrome already shows the title, so only the subtitle here.
  const headText = el("div", "geolibre-gbif-head-text");
  headText.appendChild(el("span", "geolibre-gbif-subtitle", "Occurrence records from gbif.org"));
  head.appendChild(headText);
  const resetButton = button("geolibre-gbif-reset", "Reset");
  resetButton.title = "Clear every filter";
  head.appendChild(resetButton);
  root.appendChild(head);

  const counter = el("div", "geolibre-gbif-counter");
  const counterNum = el("span", "geolibre-gbif-counter-num", "—");
  const counterLabel = el("span", "geolibre-gbif-counter-label", "records match");
  counter.append(counterNum, counterLabel);
  root.appendChild(counter);

  // ---- Body: numbered steps ------------------------------------------------
  const body = el("div", "geolibre-gbif-body");
  root.appendChild(body);

  const steps = new Map();
  let stepNo = 0;
  function addStep(id, iconName, label, open = true) {
    stepNo += 1;
    const sec = el("section", "geolibre-gbif-step");
    sec.dataset.open = String(open);
    const head = button("geolibre-gbif-step-head");
    head.setAttribute("aria-expanded", String(open));
    head.appendChild(el("span", "geolibre-gbif-step-no", String(stepNo).padStart(2, "0")));
    head.appendChild(createMaterialIcon(iconName, 16));
    head.appendChild(el("span", "geolibre-gbif-step-label", label));
    const valueEl = el("span", "geolibre-gbif-step-value");
    head.appendChild(valueEl);
    head.appendChild(el("span", "geolibre-gbif-step-chev"));
    const panel = el("div", "geolibre-gbif-step-body");
    panel.hidden = !open;
    head.addEventListener("click", () => {
      const nowOpen = panel.hidden;
      panel.hidden = !nowOpen;
      sec.dataset.open = String(nowOpen);
      head.setAttribute("aria-expanded", String(nowOpen));
    });
    sec.append(head, panel);
    body.appendChild(sec);
    steps.set(id, { valueEl, panel });
    return panel;
  }
  function setStepValue(id, text, isSet) {
    const s = steps.get(id);
    s.valueEl.textContent = text || "";
    s.valueEl.classList.toggle("is-set", Boolean(isSet));
  }

  // ============================================================
  // 01 Area
  // ============================================================
  const areaPanel = addStep("area", "map", "Area");
  const areaSeg = segmented(
    [
      { value: "view", label: "Map view" },
      { value: "layer", label: "Layer" },
      { value: "country", label: "Country" },
      { value: "world", label: "World", title: "No area limit - needs a taxon or another narrowing filter" },
    ],
    "view",
    () => {
      updateAreaMode();
      refreshAll();
    },
  );
  areaPanel.appendChild(areaSeg.root);

  const layerSelect = document.createElement("select");
  layerSelect.className = "geolibre-gbif-input";
  const layerField = field("Layer", layerSelect, "Its bounding box is used, not its exact shape.");
  areaPanel.appendChild(layerField);

  const countrySelect = document.createElement("select");
  countrySelect.className = "geolibre-gbif-input";
  for (const [code, name] of COUNTRIES) {
    const option = el("option", null, `${name} (${code})`);
    option.value = code;
    countrySelect.appendChild(option);
  }
  const countryField = field("Country", countrySelect, "Records GBIF assigns to this country, wherever the map is.");
  areaPanel.appendChild(countryField);

  const worldNote = el(
    "p",
    "geolibre-gbif-help geolibre-gbif-note",
    "World search needs a taxon, dataset, recorder, institution or keyword so it isn't the whole of GBIF.",
  );
  areaPanel.appendChild(worldNote);

  function populateLayerSelect() {
    const layers = state.app?.listLayers?.() ?? [];
    const activeId = state.app?.getSelectedLayerId?.() ?? null;
    const previous = layerSelect.value;
    layerSelect.replaceChildren();
    if (layers.length === 0) {
      const option = el("option", null, "No layers in the project");
      option.value = "";
      layerSelect.appendChild(option);
      layerSelect.disabled = true;
      return;
    }
    layerSelect.disabled = false;
    for (const layer of layers) {
      const option = el("option", null, layer.name || layer.id);
      option.value = layer.id;
      layerSelect.appendChild(option);
    }
    if (layers.some((l) => l.id === previous)) layerSelect.value = previous;
    else if (activeId && layers.some((l) => l.id === activeId)) layerSelect.value = activeId;
  }

  function updateAreaMode() {
    const mode = areaSeg.get();
    layerField.hidden = mode !== "layer";
    countryField.hidden = mode !== "country";
    worldNote.hidden = mode !== "world";
    if (mode === "layer") populateLayerSelect();
  }
  layerSelect.addEventListener("change", refreshAll);
  countrySelect.addEventListener("change", refreshAll);

  // ============================================================
  // 02 Taxon
  // ============================================================
  const taxonPanel = addStep("taxon", "eco", "Taxon");
  const selectedTaxa = new Map(); // key -> { key, name, rank }
  const selectedGroups = new Set(); // backbone keys from TAXON_GROUPS

  const searchWrap = el("div", "geolibre-gbif-search");
  const taxonInput = textInput("Scientific name, e.g. Panthera tigris");
  taxonInput.setAttribute("role", "combobox");
  taxonInput.setAttribute("aria-expanded", "false");
  const suggestList = el("ul", "geolibre-gbif-suggest");
  suggestList.setAttribute("role", "listbox");
  suggestList.hidden = true;
  searchWrap.append(taxonInput, suggestList);
  taxonPanel.appendChild(field("Search the GBIF backbone", searchWrap));

  const tokenRow = el("div", "geolibre-gbif-tokens");
  taxonPanel.appendChild(tokenRow);

  const groupLabel = el("span", "geolibre-gbif-field-label geolibre-gbif-mt", "Major groups");
  taxonPanel.appendChild(groupLabel);
  const groupGrid = el("div", "geolibre-gbif-tiles geolibre-gbif-tiles-3");
  const groupButtons = new Map();
  for (const g of TAXON_GROUPS) {
    const tile = button("geolibre-gbif-tile", g.label);
    tile.setAttribute("aria-pressed", "false");
    tile.addEventListener("click", () => {
      if (selectedGroups.has(g.key)) selectedGroups.delete(g.key);
      else selectedGroups.add(g.key);
      tile.setAttribute("aria-pressed", String(selectedGroups.has(g.key)));
      refreshAll();
    });
    groupButtons.set(g.key, tile);
    groupGrid.appendChild(tile);
  }
  taxonPanel.appendChild(groupGrid);
  taxonPanel.appendChild(
    el("p", "geolibre-gbif-help", "Several taxa and groups are combined with OR."),
  );

  function renderTokens() {
    tokenRow.replaceChildren();
    tokenRow.hidden = selectedTaxa.size === 0;
    for (const t of selectedTaxa.values()) {
      const token = el("div", "geolibre-gbif-token");
      token.appendChild(el("span", "geolibre-gbif-token-rank", (t.rank || "taxon").slice(0, 3)));
      const name = el("span", "geolibre-gbif-token-name", t.name);
      name.title = `${t.name} - GBIF taxon key ${t.key}`;
      token.appendChild(name);
      const remove = button("geolibre-gbif-token-x", "×");
      remove.setAttribute("aria-label", `Remove ${t.name}`);
      remove.addEventListener("click", () => {
        selectedTaxa.delete(t.key);
        renderTokens();
        refreshAll();
      });
      token.appendChild(remove);
      tokenRow.appendChild(token);
    }
  }

  function addTaxon(t) {
    if (!t || !t.key) return;
    selectedTaxa.set(t.key, t);
    taxonInput.value = "";
    hideSuggestions();
    renderTokens();
    refreshAll();
  }

  let suggestTimer = null;
  let suggestController = null;
  let suggestItems = [];
  let suggestActive = -1;

  function hideSuggestions() {
    suggestList.hidden = true;
    suggestList.replaceChildren();
    suggestItems = [];
    suggestActive = -1;
    taxonInput.setAttribute("aria-expanded", "false");
  }

  function highlightSuggestion(index) {
    suggestActive = index;
    suggestList.querySelectorAll("li").forEach((li, i) => li.classList.toggle("is-active", i === index));
  }

  async function loadSuggestions(q) {
    suggestController?.abort();
    const controller = new AbortController();
    suggestController = controller;
    try {
      const url = `${SUGGEST_URL}?${new URLSearchParams({ q, limit: "8" })}`;
      const data = await fetchJsonWithTimeout(url, controller.signal, 10000);
      if (controller.signal.aborted) return;
      suggestItems = (Array.isArray(data) ? data : [])
        .filter((s) => s && s.key)
        .map((s) => ({
          key: s.key,
          name: s.canonicalName || s.scientificName,
          full: s.scientificName,
          rank: (s.rank || "").toLowerCase(),
          kingdom: s.kingdom || "",
          status: s.status || "",
        }));
      suggestList.replaceChildren();
      if (suggestItems.length === 0) {
        suggestList.appendChild(el("li", "geolibre-gbif-suggest-empty", "No match in the GBIF backbone"));
      }
      suggestItems.forEach((s, i) => {
        const li = el("li", "geolibre-gbif-suggest-item");
        li.setAttribute("role", "option");
        const main = el("span", "geolibre-gbif-suggest-name", s.name);
        const meta = el(
          "span",
          "geolibre-gbif-suggest-meta",
          [s.rank, s.kingdom, s.status && s.status !== "ACCEPTED" ? prettyEnum(s.status) : ""]
            .filter(Boolean)
            .join(" · "),
        );
        li.append(main, meta);
        li.addEventListener("mousedown", (event) => {
          event.preventDefault(); // keep focus so blur doesn't close the list first
          addTaxon(s);
        });
        li.addEventListener("mouseenter", () => highlightSuggestion(i));
        suggestList.appendChild(li);
      });
      suggestList.hidden = false;
      taxonInput.setAttribute("aria-expanded", "true");
    } catch {
      if (!controller.signal.aborted) hideSuggestions();
    }
  }

  taxonInput.addEventListener("input", () => {
    clearTimeout(suggestTimer);
    const q = taxonInput.value.trim();
    if (q.length < 2) {
      hideSuggestions();
      return;
    }
    suggestTimer = setTimeout(() => loadSuggestions(q), 250);
  });
  taxonInput.addEventListener("keydown", async (event) => {
    if (event.key === "ArrowDown" && suggestItems.length) {
      event.preventDefault();
      highlightSuggestion((suggestActive + 1) % suggestItems.length);
    } else if (event.key === "ArrowUp" && suggestItems.length) {
      event.preventDefault();
      highlightSuggestion((suggestActive - 1 + suggestItems.length) % suggestItems.length);
    } else if (event.key === "Escape") {
      hideSuggestions();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (suggestActive >= 0 && suggestItems[suggestActive]) {
        addTaxon(suggestItems[suggestActive]);
        return;
      }
      // No suggestion picked: ask the backbone for its best match.
      const q = taxonInput.value.trim();
      if (!q) return;
      try {
        const m = await fetchJsonWithTimeout(`${MATCH_URL}?${new URLSearchParams({ name: q })}`, null, 10000);
        if (m && m.usageKey && m.matchType !== "NONE") {
          addTaxon({ key: m.usageKey, name: m.canonicalName || m.scientificName, rank: (m.rank || "").toLowerCase() });
        } else {
          setProblem(problem, `“${q}” is not in the GBIF backbone - pick a name from the list.`);
        }
      } catch {
        // network trouble: the suggestion list is still there to use
      }
    }
  });
  taxonInput.addEventListener("blur", () => setTimeout(hideSuggestions, 120));

  // ============================================================
  // 03 Record type
  // ============================================================
  const basisPanel = addStep("basis", "list_alt", "Record type", false);
  const selectedBasis = new Set();
  const basisGrid = el("div", "geolibre-gbif-tiles geolibre-gbif-tiles-2");
  const basisButtons = new Map();
  for (const b of BASIS_OF_RECORD) {
    const tile = button("geolibre-gbif-tile", b.label);
    tile.setAttribute("aria-pressed", "false");
    tile.addEventListener("click", () => {
      if (selectedBasis.has(b.value)) selectedBasis.delete(b.value);
      else selectedBasis.add(b.value);
      tile.setAttribute("aria-pressed", String(selectedBasis.has(b.value)));
      refreshAll();
    });
    basisButtons.set(b.value, tile);
    basisGrid.appendChild(tile);
  }
  basisPanel.appendChild(basisGrid);
  basisPanel.appendChild(el("p", "geolibre-gbif-help", "None selected means every record type."));

  // ============================================================
  // 04 Time
  // ============================================================
  const timePanel = addStep("time", "calendar_month", "Time");
  const thisYear = new Date().getFullYear();
  const timeSeg = segmented(
    [
      { value: "all", label: "All years" },
      { value: "range", label: "Year range" },
    ],
    "all",
    () => {
      updateTimeMode();
      refreshAll();
    },
  );
  timePanel.appendChild(timeSeg.root);

  const yearRow = el("div", "geolibre-gbif-year-row");
  function yearInput(label) {
    const input = document.createElement("input");
    input.type = "number";
    input.min = "1600";
    input.max = String(thisYear);
    input.step = "1";
    input.className = "geolibre-gbif-input geolibre-gbif-year";
    input.setAttribute("aria-label", label);
    input.placeholder = label;
    return input;
  }
  const yearFromInput = yearInput("From");
  const yearToInput = yearInput("To");
  yearRow.append(yearFromInput, el("span", "geolibre-gbif-year-sep", "→"), yearToInput);
  timePanel.appendChild(yearRow);

  const presetRow = el("div", "geolibre-gbif-presets");
  const YEAR_PRESETS = [
    ["Last 5 yr", thisYear - 4, thisYear],
    ["Last 10 yr", thisYear - 9, thisYear],
    ["Since 2000", 2000, thisYear],
    ["This year", thisYear, thisYear],
  ];
  for (const [label, from, to] of YEAR_PRESETS) {
    const b = button("geolibre-gbif-preset", label);
    b.addEventListener("click", () => {
      yearFromInput.value = String(from);
      yearToInput.value = String(to);
      timeSeg.set("range");
      updateTimeMode();
      refreshAll();
    });
    presetRow.appendChild(b);
  }
  timePanel.appendChild(presetRow);

  function updateTimeMode() {
    const on = timeSeg.get() === "range";
    yearFromInput.disabled = !on;
    yearToInput.disabled = !on;
    yearRow.classList.toggle("is-off", !on);
  }
  yearFromInput.addEventListener("input", refreshAll);
  yearToInput.addEventListener("input", refreshAll);

  // ============================================================
  // 05 Quality
  // ============================================================
  const qualityPanel = addStep("quality", "verified", "Quality", false);
  const photosOnlyInput = switchRow(qualityPanel, "Only records with photos", "mediaType = StillImage", false);
  const noIssuesInput = switchRow(
    qualityPanel,
    "Drop geospatial issues",
    "Skip records GBIF flags as badly placed",
    true,
  );
  const presentOnlyInput = switchRow(qualityPanel, "Presence records only", "Leave out recorded absences", true);

  const uncertaintySelect = document.createElement("select");
  uncertaintySelect.className = "geolibre-gbif-input";
  for (const u of UNCERTAINTY_CHOICES) {
    const option = el("option", null, u.label);
    option.value = u.value;
    uncertaintySelect.appendChild(option);
  }
  qualityPanel.appendChild(
    field(
      "Coordinate uncertainty",
      uncertaintySelect,
      "A limit also drops records that don't state their uncertainty.",
    ),
  );

  qualityPanel.appendChild(el("span", "geolibre-gbif-field-label geolibre-gbif-mt", "IUCN Red List"));
  const selectedIucn = new Set();
  const iucnRow = el("div", "geolibre-gbif-iucn");
  const iucnButtons = new Map();
  for (const c of IUCN_CATEGORIES) {
    const b = button("geolibre-gbif-iucn-btn", c.label);
    b.dataset.cat = c.value;
    b.title = c.title;
    b.setAttribute("aria-pressed", "false");
    b.addEventListener("click", () => {
      if (selectedIucn.has(c.value)) selectedIucn.delete(c.value);
      else selectedIucn.add(c.value);
      b.setAttribute("aria-pressed", String(selectedIucn.has(c.value)));
      refreshAll();
    });
    iucnButtons.set(c.value, b);
    iucnRow.appendChild(b);
  }
  qualityPanel.appendChild(iucnRow);

  qualityPanel.appendChild(el("span", "geolibre-gbif-field-label geolibre-gbif-mt", "Data licence"));
  const selectedLicenses = new Set();
  const licenseGrid = el("div", "geolibre-gbif-tiles geolibre-gbif-tiles-3");
  const licenseButtons = new Map();
  for (const l of LICENSES) {
    const tile = button("geolibre-gbif-tile", l.label);
    tile.title = l.title;
    tile.setAttribute("aria-pressed", "false");
    tile.addEventListener("click", () => {
      if (selectedLicenses.has(l.value)) selectedLicenses.delete(l.value);
      else selectedLicenses.add(l.value);
      tile.setAttribute("aria-pressed", String(selectedLicenses.has(l.value)));
      refreshAll();
    });
    licenseButtons.set(l.value, tile);
    licenseGrid.appendChild(tile);
  }
  qualityPanel.appendChild(licenseGrid);
  qualityPanel.appendChild(
    el("p", "geolibre-gbif-help", "None selected means every licence. Leave out CC BY-NC for commercial work."),
  );

  for (const input of [photosOnlyInput, noIssuesInput, presentOnlyInput]) {
    input.addEventListener("change", refreshAll);
  }
  uncertaintySelect.addEventListener("change", refreshAll);

  // ============================================================
  // 06 More filters
  // ============================================================
  const morePanel = addStep("more", "tune", "More filters", false);
  const recordedByInput = textInput("Names, comma-separated");
  morePanel.appendChild(field("Recorded by", recordedByInput));
  const datasetInput = textInput("e.g. 50c9509d-22c7-4a22-a47d-8c48425ef4a7");
  morePanel.appendChild(
    field("Dataset key", datasetInput, "UUID from a gbif.org/dataset/… page; comma-separate several."),
  );
  const institutionInput = textInput("e.g. MZB, LIPI, NHMUK");
  morePanel.appendChild(field("Institution code", institutionInput));
  const qInput = textInput("Full-text search across the record");
  morePanel.appendChild(field("Keyword", qInput));
  for (const input of [recordedByInput, datasetInput, institutionInput, qInput]) {
    input.addEventListener("input", refreshAll);
  }

  // ---- Output settings + results -------------------------------------------
  // They live inside the scrolling body (not a fixed footer), so a long result
  // card never squeezes the filters or gets clipped; only the action bar with
  // the Fetch button stays pinned at the bottom.
  const foot = el("div", "geolibre-gbif-foot");
  body.appendChild(foot);
  const actions = el("div", "geolibre-gbif-actions");
  root.appendChild(actions);

  const tagRow = el("div", "geolibre-gbif-tags");
  foot.appendChild(tagRow);

  const outRow = el("div", "geolibre-gbif-out");
  outRow.appendChild(el("span", "geolibre-gbif-field-label", "Add to map"));
  const outputSeg = segmented(
    [
      { value: "points", label: "Points", title: "Fetched records as a GeoJSON point layer" },
      { value: "density", label: "Density", title: "GBIF hexagon tiles of every matching record" },
      { value: "both", label: "Both" },
    ],
    "points",
    () => refreshAll(),
  );
  outRow.appendChild(outputSeg.root);
  foot.appendChild(outRow);

  const limitRow = el("div", "geolibre-gbif-limit");
  limitRow.appendChild(el("span", "geolibre-gbif-field-label", "Max records"));
  const maxInput = document.createElement("input");
  maxInput.type = "number";
  maxInput.min = "10";
  maxInput.max = String(MAX_ALLOWED_RECORDS);
  maxInput.step = "50";
  maxInput.value = String(DEFAULT_MAX_RECORDS);
  maxInput.className = "geolibre-gbif-input geolibre-gbif-max";
  maxInput.setAttribute("aria-label", "Max records");
  limitRow.appendChild(maxInput);
  foot.appendChild(limitRow);

  const rangeInput = document.createElement("input");
  rangeInput.type = "range";
  rangeInput.min = "50";
  rangeInput.max = String(MAX_ALLOWED_RECORDS);
  rangeInput.step = "50";
  rangeInput.value = String(DEFAULT_MAX_RECORDS);
  rangeInput.className = "geolibre-gbif-range";
  rangeInput.setAttribute("aria-label", "Max records");
  foot.appendChild(rangeInput);

  // The slider's filled part is painted by style.css from --fill.
  function paintRange() {
    const min = Number(rangeInput.min);
    const pct = ((Number(rangeInput.value) - min) / (Number(rangeInput.max) - min)) * 100;
    rangeInput.style.setProperty("--fill", `${clamp(pct, 0, 100)}%`);
  }
  maxInput.addEventListener("input", () => {
    rangeInput.value = String(currentMax());
    paintRange();
    refreshAll();
  });
  rangeInput.addEventListener("input", () => {
    maxInput.value = rangeInput.value;
    paintRange();
    refreshAll();
  });
  paintRange();

  const problem = el("p", "geolibre-gbif-problem");
  problem.hidden = true;
  actions.appendChild(problem);

  const progress = el("div", "geolibre-gbif-progress");
  const progressBar = el("div", "geolibre-gbif-progress-bar");
  const progressText = el("span", "geolibre-gbif-progress-text");
  progress.append(progressBar, progressText);
  progress.hidden = true;
  actions.appendChild(progress);

  const results = el("div", "geolibre-gbif-results");
  results.hidden = true;
  foot.appendChild(results);

  const go = button("geolibre-gbif-go");
  actions.appendChild(go);

  const credit = el("p", "geolibre-gbif-credit");
  credit.appendChild(document.createTextNode("Data: GBIF.org and its publishers · "));
  const citeLink = el("a", null, "cite the datasets you use");
  citeLink.href = CITATION_GUIDE_URL;
  citeLink.target = "_blank";
  citeLink.rel = "noopener";
  credit.appendChild(citeLink);
  actions.appendChild(credit);

  // GBIF neither makes this plugin nor guarantees the data it serves.
  const disclaimer = el("p", "geolibre-gbif-disclaimer");
  disclaimer.appendChild(
    document.createTextNode("Independent plugin, not affiliated with GBIF. Data quality is not guaranteed; see the "),
  );
  const termsLink = el("a", null, "data user agreement");
  termsLink.href = DATA_USER_TERMS_URL;
  termsLink.target = "_blank";
  termsLink.rel = "noopener";
  disclaimer.appendChild(termsLink);
  disclaimer.appendChild(document.createTextNode("."));
  actions.appendChild(disclaimer);

  // ---- Reading the form ------------------------------------------------------
  function currentMax() {
    return clamp(parseInt(maxInput.value, 10) || DEFAULT_MAX_RECORDS, 10, MAX_ALLOWED_RECORDS);
  }

  function readYear(input) {
    const v = parseInt(input.value, 10);
    return Number.isFinite(v) ? clamp(v, 1600, thisYear) : null;
  }

  // Collects the form into the filter object buildFilterParams() takes.
  // Returns { filters } or { error } with a sentence for the person.
  function collectFilters() {
    const mode = areaSeg.get();
    const f = {
      bounds: null,
      country: null,
      taxonKeys: [...selectedTaxa.keys(), ...selectedGroups],
      basis: [...selectedBasis],
      iucn: [...selectedIucn],
      licenses: [...selectedLicenses],
      yearFrom: null,
      yearTo: null,
      photosOnly: photosOnlyInput.checked,
      noGeoIssues: noIssuesInput.checked,
      presentOnly: presentOnlyInput.checked,
      maxUncertainty: uncertaintySelect.value || null,
      recordedBy: splitList(recordedByInput.value),
      datasetKeys: splitList(datasetInput.value),
      institutionCodes: splitList(institutionInput.value),
      q: qInput.value.trim() || null,
    };

    if (mode === "view") {
      f.bounds = state.app?.getViewBounds?.() ?? null;
      if (!f.bounds) return { error: "The map extent isn't available yet - pan or zoom the map and try again." };
    } else if (mode === "layer") {
      if (!layerSelect.value) return { error: "Pick a layer, or switch the Area to “Map view”." };
      let features = [];
      try {
        features = state.app?.getLayerFeatures?.(layerSelect.value) ?? [];
      } catch {
        return { error: "That layer is gone - pick another one." };
      }
      f.bounds = computeBoundsFromFeatures(features);
      if (!f.bounds) return { error: "That layer has no vector features to take an extent from (raster and tile layers can't be used)." };
    } else if (mode === "country") {
      f.country = countrySelect.value;
    } else if (mode === "world") {
      const narrowing =
        f.taxonKeys.length || f.recordedBy.length || f.datasetKeys.length || f.institutionCodes.length || f.q;
      if (!narrowing) {
        return { error: "A world search needs a taxon, dataset, recorder, institution or keyword." };
      }
    }

    if (timeSeg.get() === "range") {
      f.yearFrom = readYear(yearFromInput);
      f.yearTo = readYear(yearToInput);
      if (!f.yearFrom && !f.yearTo) return { error: "Enter a start or end year, or switch Time to “All years”." };
      if (f.yearFrom && f.yearTo && f.yearFrom > f.yearTo) [f.yearFrom, f.yearTo] = [f.yearTo, f.yearFrom];
    }
    return { filters: f };
  }

  // ---- Active filter tags -----------------------------------------------------
  function renderTags() {
    tagRow.replaceChildren();
    const tags = [];
    for (const t of selectedTaxa.values()) {
      tags.push([t.name, () => { selectedTaxa.delete(t.key); renderTokens(); }]);
    }
    for (const key of selectedGroups) {
      const g = TAXON_GROUPS.find((x) => x.key === key);
      tags.push([g ? g.label : `Taxon ${key}`, () => { selectedGroups.delete(key); groupButtons.get(key)?.setAttribute("aria-pressed", "false"); }]);
    }
    for (const value of selectedBasis) {
      const b = BASIS_OF_RECORD.find((x) => x.value === value);
      tags.push([b ? b.label : value, () => { selectedBasis.delete(value); basisButtons.get(value)?.setAttribute("aria-pressed", "false"); }]);
    }
    if (timeSeg.get() === "range") {
      tags.push([`${yearFromInput.value || "…"}–${yearToInput.value || "…"}`, () => { timeSeg.set("all"); updateTimeMode(); }]);
    }
    if (photosOnlyInput.checked) tags.push(["With photo", () => { photosOnlyInput.checked = false; }]);
    for (const c of selectedIucn) {
      tags.push([`IUCN ${c}`, () => { selectedIucn.delete(c); iucnButtons.get(c)?.setAttribute("aria-pressed", "false"); }]);
    }
    for (const value of selectedLicenses) {
      tags.push([licenseLabel(value), () => { selectedLicenses.delete(value); licenseButtons.get(value)?.setAttribute("aria-pressed", "false"); }]);
    }
    if (uncertaintySelect.value) {
      tags.push([uncertaintySelect.options[uncertaintySelect.selectedIndex].text, () => { uncertaintySelect.value = ""; }]);
    }
    if (recordedByInput.value.trim()) tags.push([`By: ${recordedByInput.value.trim()}`, () => { recordedByInput.value = ""; }]);
    if (datasetInput.value.trim()) tags.push(["Dataset", () => { datasetInput.value = ""; }]);
    if (institutionInput.value.trim()) tags.push([`Inst: ${institutionInput.value.trim()}`, () => { institutionInput.value = ""; }]);
    if (qInput.value.trim()) tags.push([`“${qInput.value.trim()}”`, () => { qInput.value = ""; }]);

    tagRow.hidden = tags.length === 0;
    for (const [text, remove] of tags) {
      const tag = el("span", "geolibre-gbif-tag");
      tag.appendChild(el("span", "geolibre-gbif-tag-text", text));
      const x = button(null, "×");
      x.setAttribute("aria-label", `Remove ${text}`);
      x.addEventListener("click", () => {
        remove();
        refreshAll();
      });
      tag.appendChild(x);
      tagRow.appendChild(tag);
    }
  }

  // ---- Step header summaries -------------------------------------------------
  function updateStepValues() {
    const mode = areaSeg.get();
    const areaText = {
      view: "Map view",
      layer: layerSelect.options[layerSelect.selectedIndex]?.text || "Layer",
      country: countrySelect.value,
      world: "World",
    }[mode];
    setStepValue("area", areaText, mode !== "view");

    const nTaxa = selectedTaxa.size + selectedGroups.size;
    const firstTaxon = selectedTaxa.values().next().value;
    setStepValue(
      "taxon",
      nTaxa === 0 ? "All life" : nTaxa === 1 && firstTaxon ? firstTaxon.name : `${nTaxa} selected`,
      nTaxa > 0,
    );
    setStepValue("basis", selectedBasis.size ? `${selectedBasis.size} type${selectedBasis.size === 1 ? "" : "s"}` : "All", selectedBasis.size > 0);
    const ranged = timeSeg.get() === "range";
    setStepValue("time", ranged ? `${yearFromInput.value || "…"}–${yearToInput.value || "…"}` : "All years", ranged);
    const q = [
      photosOnlyInput.checked && "Photo",
      selectedIucn.size && `IUCN×${selectedIucn.size}`,
      uncertaintySelect.value && "Precise",
      selectedLicenses.size && "Licence",
    ].filter(Boolean);
    setStepValue("quality", q.join(" + "), q.length > 0);
    const more = [recordedByInput, datasetInput, institutionInput, qInput].filter((i) => i.value.trim()).length;
    setStepValue("more", more ? `${more} set` : "", more > 0);
  }

  function idleGoLabel() {
    const out = outputSeg.get();
    if (out === "density") return "Add density layer";
    return `Fetch ${formatCount(currentMax())} records`;
  }
  function updateGoButton() {
    go.replaceChildren();
    go.classList.toggle("is-busy", state.fetching);
    // Drawn in CSS: Windows renders the ▶ character as a colour emoji.
    const icon = el("span", "geolibre-gbif-go-icon");
    icon.dataset.kind = state.fetching ? "stop" : "play";
    go.appendChild(icon);
    go.appendChild(document.createTextNode(state.fetching ? "Cancel" : idleGoLabel()));
  }

  // ---- Live match counter ------------------------------------------------------
  let countTimer = null;
  let countController = null;
  let lastCount = null;

  function scheduleCount() {
    clearTimeout(countTimer);
    countTimer = setTimeout(updateCount, 450);
  }

  async function updateCount() {
    countController?.abort();
    const controller = new AbortController();
    countController = controller;
    const { filters, error } = collectFilters();
    if (error) {
      counter.dataset.state = "idle";
      counterNum.textContent = "—";
      counterLabel.textContent = "set the filters to count records";
      lastCount = null;
      return;
    }
    counter.dataset.state = "loading";
    counterLabel.textContent = "counting…";
    try {
      const data = await fetchJsonWithTimeout(searchUrl(filters, 0, 0), controller.signal, 15000);
      if (controller.signal.aborted) return;
      lastCount = typeof data.count === "number" ? data.count : null;
      counter.dataset.state = "ready";
      counterNum.textContent = lastCount === null ? "?" : compactCount(lastCount);
      counterNum.title = lastCount === null ? "" : formatCount(lastCount);
      counterLabel.textContent = lastCount === 1 ? "record matches" : "records match";
    } catch {
      if (controller.signal.aborted) return;
      counter.dataset.state = "error";
      counterNum.textContent = "!";
      counterLabel.textContent = "GBIF is unreachable right now";
    }
  }

  function refreshAll() {
    updateStepValues();
    renderTags();
    updateGoButton();
    scheduleCount();
  }

  // The view counter follows the map while "Map view" is the area.
  const onMoveEnd = () => {
    if (areaSeg.get() === "view" && !state.fetching) scheduleCount();
  };
  state.map?.on?.("moveend", onMoveEnd);

  // ---- Results card ------------------------------------------------------------
  function link(text, href) {
    const a = el("a", null, text);
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener";
    return a;
  }

  // The GBIF data user agreement asks users to cite the publishers of the data
  // they use, ideally with a DOI. Records fetched through the search API have
  // no DOI of their own, so GBIF's guidance is to register a derived dataset
  // (dataset keys + record counts) or to make a download of the same search.
  function renderCitation(filters, features, accessedOn) {
    const box = el("div", "geolibre-gbif-cite");
    box.appendChild(el("span", "geolibre-gbif-field-label", "Cite this data"));
    const searchHref = siteSearchUrl(filters);

    if (!features) {
      box.appendChild(
        el("p", "geolibre-gbif-help", "When you use this map, cite a GBIF.org download of the same search: it gets its own DOI."),
      );
      const links = el("div", "geolibre-gbif-cite-links");
      links.appendChild(link("Open this search on GBIF.org ↗", searchHref));
      box.appendChild(links);
      return box;
    }

    const licences = new Map();
    const datasets = new Map(); // key -> { name, count }
    for (const f of features) {
      const p = f.properties;
      const lic = p.licenseLabel || "Unknown licence";
      licences.set(lic, (licences.get(lic) || 0) + 1);
      if (p.datasetKey) {
        const d = datasets.get(p.datasetKey) || { name: p.datasetName || p.institutionCode || "", count: 0 };
        d.count += 1;
        datasets.set(p.datasetKey, d);
      }
    }
    const datasetRows = [...datasets.entries()].sort((a, b) => b[1].count - a[1].count);

    const licRow = el("div", "geolibre-gbif-lic");
    for (const [name, n] of [...licences.entries()].sort((a, b) => b[1] - a[1])) {
      const chip = el("span", null, `${name} · ${formatCount(n)}`);
      chip.dataset.nc = String(name === "CC BY-NC");
      licRow.appendChild(chip);
    }
    box.appendChild(licRow);
    const nc = licences.get("CC BY-NC") || 0;
    if (nc) {
      box.appendChild(
        el("p", "geolibre-gbif-help", `${formatCount(nc)} records are CC BY-NC: not for commercial use. Filter by Data licence to leave them out.`),
      );
    }
    box.appendChild(
      el(
        "p",
        "geolibre-gbif-help",
        `${formatCount(features.length)} records from ${formatCount(datasetRows.length)} datasets. GBIF asks you to cite them with a DOI: register a derived dataset with the dataset list, or download this search on GBIF.org.`,
      ),
    );

    const queryUrl = `${SEARCH_URL}?${buildFilterParams(filters).toString()}`;
    const citation = [
      `GBIF.org (${longDate()}) GBIF Occurrence Data, ${formatCount(features.length)} records accessed via the GBIF occurrence search API: ${queryUrl}`,
      "",
      `Source datasets (datasetKey, records, title), ${datasetRows.length} in all:`,
      ...datasetRows.map(([key, d]) => `${key}\t${d.count}\t${d.name}`),
      "",
      `Register these as a derived dataset to get a DOI to cite: ${DERIVED_DATASET_URL}`,
    ].join("\n");
    // Two columns, no header: the layout GBIF's derived-dataset form takes.
    const csv = datasetRows.map(([key, d]) => `${key},${d.count}`).join("\n") + "\n";

    const actionsRow = el("div", "geolibre-gbif-cite-actions");
    const copyBtn = button("geolibre-gbif-preset", "Copy citation");
    copyBtn.addEventListener("click", async () => {
      const ok = await copyText(citation);
      copyBtn.textContent = ok ? "Copied ✓" : "Copy failed";
      setTimeout(() => {
        copyBtn.textContent = "Copy citation";
      }, 1800);
    });
    const csvBtn = button("geolibre-gbif-preset", "Save dataset list (CSV)");
    csvBtn.title = "datasetKey,count per line - upload it when registering a derived dataset";
    csvBtn.addEventListener("click", () => saveTextFile(`gbif-datasets-${accessedOn}.csv`, csv));
    actionsRow.append(copyBtn, csvBtn);
    box.appendChild(actionsRow);

    const links = el("div", "geolibre-gbif-cite-links");
    links.appendChild(link("Register a derived dataset (DOI) ↗", DERIVED_DATASET_URL));
    links.appendChild(link("Open this search on GBIF.org ↗", searchHref));
    links.appendChild(link("GBIF citation guidelines ↗", CITATION_GUIDE_URL));
    box.appendChild(links);
    return box;
  }

  function showResults({ added, withPhoto, speciesCount, available, topSpecies, densityAdded, layerName, citation }) {
    results.replaceChildren();
    results.hidden = false;
    const grid = el("div", "geolibre-gbif-stats");
    const stat = (num, label) => {
      const s = el("div", "geolibre-gbif-stat");
      s.appendChild(el("strong", null, num));
      s.appendChild(el("span", null, label));
      grid.appendChild(s);
    };
    if (added !== null) {
      stat(formatCount(added), "on map");
      stat(formatCount(withPhoto), "with photo");
      stat(formatCount(speciesCount), "species");
    }
    stat(available === null ? "?" : compactCount(available), "in GBIF");
    results.appendChild(grid);

    if (topSpecies && topSpecies.length) {
      results.appendChild(el("span", "geolibre-gbif-field-label geolibre-gbif-mt", "Most recorded"));
      const max = topSpecies[0][1];
      const list = el("ol", "geolibre-gbif-top");
      for (const [name, n] of topSpecies) {
        const li = el("li");
        const bar = el("span", "geolibre-gbif-top-bar");
        bar.style.width = `${Math.max(6, (n / max) * 100)}%`;
        li.append(bar, el("span", "geolibre-gbif-top-name", name), el("span", "geolibre-gbif-top-n", formatCount(n)));
        list.appendChild(li);
      }
      results.appendChild(list);
    }
    const notes = [];
    if (layerName) notes.push(`Layer “${layerName}” added - click a point for details.`);
    if (densityAdded) notes.push("Density layer shows every matching record, not only the fetched ones.");
    if (added !== null && available !== null && available > added) {
      notes.push(`${formatCount(available - added)} more records match - raise Max records or narrow the filters.`);
    }
    for (const n of notes) results.appendChild(el("p", "geolibre-gbif-help", n));
    if (citation) results.appendChild(renderCitation(citation.filters, citation.features, citation.accessedOn));
    results.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  // ---- Running a fetch -----------------------------------------------------------
  function setProgress(fraction, text) {
    progress.hidden = fraction === null;
    progressBar.style.width = `${Math.round(clamp(fraction || 0, 0, 1) * 100)}%`;
    progressText.textContent = text || "";
  }

  function describeFilters(f) {
    const parts = [];
    const names = [...selectedTaxa.values()].map((t) => t.name);
    for (const key of selectedGroups) names.push(TAXON_GROUPS.find((g) => g.key === key)?.label || key);
    if (names.length) parts.push(names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(", "));
    if (f.country) parts.push(f.country);
    if (f.yearFrom || f.yearTo) parts.push(`${f.yearFrom || "…"}–${f.yearTo || "…"}`);
    return parts.length ? parts.join(" · ") : "all taxa";
  }

  async function run() {
    const app = state.app;
    if (!app || state.fetching) return;
    const { filters, error } = collectFilters();
    if (error) {
      setProblem(problem, error);
      return;
    }
    setProblem(problem, "");
    results.hidden = true;

    const out = outputSeg.get();
    const label = describeFilters(filters);
    let densityAdded = false;

    if (out !== "points") {
      if (!app.addTileLayer) {
        setProblem(problem, "This GeoLibre version can't add tile layers - choose “Points”.");
        return;
      }
      app.addTileLayer(`GBIF density – ${label}`, densityTileUrl(filters), {
        tileSize: 512,
        attribution: '<a href="https://www.gbif.org" target="_blank" rel="noopener">GBIF.org</a>',
        opacity: 0.85,
        maxzoom: 16,
        metadata: {
          source: "GBIF occurrence density (adhoc map API)",
          query: buildFilterParams(filters).toString(),
          accessed: isoDate(),
          citation: `Cite a GBIF.org download of this search: ${siteSearchUrl(filters)}`,
        },
      });
      densityAdded = true;
    }

    const accessedOn = isoDate();
    if (out === "density") {
      showResults({
        added: null,
        withPhoto: 0,
        speciesCount: 0,
        available: lastCount,
        topSpecies: null,
        densityAdded,
        layerName: null,
        citation: { filters, features: null, accessedOn },
      });
      return;
    }

    const maxRecords = currentMax();
    state.fetching = true;
    state.abortController = new AbortController();
    updateGoButton();
    setProgress(0, "Contacting GBIF…");

    const collected = [];
    let available = null;
    try {
      let offset = 0;
      while (collected.length < maxRecords) {
        const limit = Math.min(PER_PAGE_LIMIT, maxRecords - collected.length);
        const data = await fetchJsonWithTimeout(searchUrl(filters, limit, offset), state.abortController.signal);
        if (available === null && typeof data.count === "number") available = data.count;
        const page = Array.isArray(data.results) ? data.results : [];
        collected.push(...page);
        offset += page.length;
        const target = Math.min(maxRecords, available ?? maxRecords);
        setProgress(target ? collected.length / target : 1, `${formatCount(collected.length)} / ${formatCount(target)} records`);
        if (page.length < limit || data.endOfRecords) break;
        await sleep(PAGE_DELAY_MS);
      }

      const features = collected.map((rec) => occurrenceToFeature(rec, accessedOn)).filter(Boolean);
      setProgress(null);
      if (features.length === 0) {
        setProblem(problem, "No georeferenced records matched these filters.");
        if (densityAdded) showResults({ added: 0, withPhoto: 0, speciesCount: 0, available, topSpecies: null, densityAdded, layerName: null });
        return;
      }

      const layerName = `GBIF – ${label} (${formatCount(features.length)})`;
      app.addGeoJsonLayer(layerName, { type: "FeatureCollection", features });
      if (areaSeg.get() === "country" || areaSeg.get() === "world") {
        const b = computeBoundsFromFeatures(features);
        if (b) app.fitBounds?.(b);
      }

      const tally = new Map();
      for (const f of features) {
        // Records identified above species level count under their genus
        // (scientificName would carry the author string too).
        const name = f.properties.species || f.properties.genus || f.properties.scientificName;
        if (name) tally.set(name, (tally.get(name) || 0) + 1);
      }
      const topSpecies = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
      showResults({
        added: features.length,
        withPhoto: features.filter((f) => f.properties.imageCount > 0).length,
        speciesCount: tally.size,
        available,
        topSpecies,
        densityAdded,
        layerName,
        citation: { filters, features, accessedOn },
      });
    } catch (err) {
      setProgress(null);
      if (err?.name === "AbortError") setProblem(problem, "Cancelled - nothing was added.");
      else setProblem(problem, `Could not fetch records: ${err.message || err}`);
    } finally {
      state.fetching = false;
      state.abortController = null;
      updateGoButton();
    }
  }

  go.addEventListener("click", () => {
    if (state.fetching) state.abortController?.abort();
    else void run();
  });

  resetButton.addEventListener("click", () => {
    areaSeg.set("view");
    updateAreaMode();
    selectedTaxa.clear();
    renderTokens();
    taxonInput.value = "";
    hideSuggestions();
    selectedGroups.clear();
    for (const b of groupButtons.values()) b.setAttribute("aria-pressed", "false");
    selectedBasis.clear();
    for (const b of basisButtons.values()) b.setAttribute("aria-pressed", "false");
    timeSeg.set("all");
    yearFromInput.value = "";
    yearToInput.value = "";
    updateTimeMode();
    photosOnlyInput.checked = false;
    noIssuesInput.checked = true;
    presentOnlyInput.checked = true;
    uncertaintySelect.value = "";
    selectedIucn.clear();
    for (const b of iucnButtons.values()) b.setAttribute("aria-pressed", "false");
    selectedLicenses.clear();
    for (const b of licenseButtons.values()) b.setAttribute("aria-pressed", "false");
    for (const input of [recordedByInput, datasetInput, institutionInput, qInput]) input.value = "";
    outputSeg.set("points");
    setProblem(problem, "");
    results.hidden = true;
    refreshAll();
  });

  updateAreaMode();
  updateTimeMode();
  renderTokens();
  refreshAll();

  container.appendChild(root);

  return () => {
    clearTimeout(countTimer);
    clearTimeout(suggestTimer);
    countController?.abort();
    suggestController?.abort();
    state.map?.off?.("moveend", onMoveEnd);
    root.remove();
  };
}

function setProblem(problem, text) {
  problem.hidden = !text;
  problem.textContent = text || "";
}

// ############################################################################
// ########## Map interactions: click-to-popup ################################
// ############################################################################

function attachMapInteractions(map) {
  const findOurs = (point) => {
    try {
      return map.queryRenderedFeatures(point).find((f) => f.properties && f.properties[MARKER_PROP]);
    } catch {
      return null;
    }
  };
  const onClick = (event) => {
    // Identify / selection / GeoEditor own the click while they are active.
    if (state.app?.getActiveMapTool?.()) return;
    const feature = findOurs(event.point);
    if (!feature) {
      closePopup();
      return;
    }
    showPopup(map, feature, event.lngLat);
  };
  const onMouseMove = (event) => {
    map.getCanvas().style.cursor = findOurs(event.point) ? "pointer" : "";
  };
  map.on("click", onClick);
  map.on("mousemove", onMouseMove);
  state.mapHandlers = { onClick, onMouseMove };
}

function detachMapInteractions(map) {
  if (!map || !state.mapHandlers) return;
  map.off("click", state.mapHandlers.onClick);
  map.off("mousemove", state.mapHandlers.onMouseMove);
  if (map.getCanvas()) map.getCanvas().style.cursor = "";
  state.mapHandlers = null;
}

// A plain DOM overlay positioned with map.project(), so the plugin doesn't
// need its own copy of maplibre-gl just for a Popup.
function showPopup(map, feature, lngLat) {
  closePopup();
  const p = feature.properties || {};
  const popupEl = el("div", "geolibre-gbif-popup");

  const head = el("div", "geolibre-gbif-popup-head");
  head.appendChild(el("span", "geolibre-gbif-popup-kicker", prettyEnum(p.basisOfRecord) || "Occurrence"));
  head.appendChild(el("div", "geolibre-gbif-popup-title", p.species || p.scientificName || "Unidentified record"));
  if (p.vernacularName) head.appendChild(el("div", "geolibre-gbif-popup-common", p.vernacularName));
  const close = button("geolibre-gbif-popup-close", "×");
  close.setAttribute("aria-label", "Close");
  close.addEventListener("click", (event) => {
    event.stopPropagation();
    closePopup();
  });
  head.appendChild(close);
  popupEl.appendChild(head);

  const thumb = thumbnailUrl(p.image);
  if (thumb) {
    const a = document.createElement("a");
    a.href = httpUrl(p.image);
    a.target = "_blank";
    a.rel = "noopener";
    a.className = "geolibre-gbif-popup-photo";
    const img = document.createElement("img");
    img.src = thumb;
    img.loading = "lazy";
    img.alt = p.species || p.scientificName || "Occurrence photo";
    img.addEventListener("error", () => a.remove());
    a.appendChild(img);
    popupEl.appendChild(a);
    const imageLic = licenseLabel(p.imageLicense);
    const attr = [p.imageCreator && `© ${p.imageCreator}`, imageLic].filter(Boolean).join(" · ");
    if (attr) popupEl.appendChild(el("div", "geolibre-gbif-popup-attr", attr));
  }

  const dl = el("dl", "geolibre-gbif-popup-rows");
  const rows = [
    ["Date", formatEventDate(p.eventDate) || p.year],
    ["Recorded by", p.recordedBy],
    ["Family", p.family],
    ["Place", [p.locality, p.stateProvince, p.country].filter(Boolean).join(", ")],
    ["Uncertainty", typeof p.uncertaintyM === "number" ? `${formatCount(p.uncertaintyM)} m` : null],
    ["IUCN", p.iucnRedListCategory],
    ["Dataset", p.datasetName || p.institutionCode || (p.datasetKey ? "GBIF dataset" : null)],
    ["Licence", p.licenseLabel],
  ].filter(([, v]) => v !== null && v !== undefined && v !== "");
  for (const [k, v] of rows) {
    dl.appendChild(el("dt", null, k));
    const dd = el("dd");
    if (k === "IUCN") {
      // Same official category colours as the IUCN filter buttons.
      const badge = el("span", "geolibre-gbif-iucn-badge", String(v));
      badge.dataset.cat = String(v);
      const cat = IUCN_CATEGORIES.find((c) => c.value === v);
      if (cat) badge.title = cat.title;
      dd.appendChild(badge);
    } else if (k === "Dataset" && httpUrl(p.datasetUrl)) {
      // The publisher's dataset page carries its own citation and DOI.
      const a = el("a", null, String(v));
      a.href = httpUrl(p.datasetUrl);
      a.target = "_blank";
      a.rel = "noopener";
      dd.appendChild(a);
    } else {
      dd.textContent = String(v);
    }
    dl.appendChild(dd);
  }
  popupEl.appendChild(dl);

  const link = document.createElement("a");
  link.className = "geolibre-gbif-popup-link";
  link.href = httpUrl(p.gbifUrl) || `https://www.gbif.org/occurrence/${encodeURIComponent(p.gbifKey)}`;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = "Open record on GBIF.org ↗";
  popupEl.appendChild(link);

  map.getContainer().appendChild(popupEl);
  const onMove = () => positionPopup();
  map.on("move", onMove);
  state.popup = { el: popupEl, lngLat, map, onMove };
  positionPopup();
}

function positionPopup() {
  if (!state.popup) return;
  const { el: popupEl, lngLat, map } = state.popup;
  const point = map.project(lngLat);
  // Keep the whole card inside the map: slide it sideways near the left/right
  // edge (the arrow still points at the record) and open it below the point
  // when there's no room above.
  const mapWidth = map.getContainer().clientWidth;
  const half = popupEl.offsetWidth / 2;
  const x = clamp(point.x, half + 8, Math.max(half + 8, mapWidth - half - 8));
  popupEl.style.left = `${x}px`;
  popupEl.style.top = `${point.y}px`;
  popupEl.style.setProperty("--arrow-x", `${clamp(point.x - x + half, 14, half * 2 - 14)}px`);
  popupEl.classList.toggle("is-below", point.y < popupEl.offsetHeight + 24);
}

function closePopup() {
  if (!state.popup) return;
  const { el: popupEl, map, onMove } = state.popup;
  map.off("move", onMove);
  popupEl.remove();
  state.popup = null;
}

// ############################################################################
// ########## Panel surface registration ######################################
// ############################################################################

function registerSurfaces(app) {
  if (app.registerRightPanel) {
    state.disposePanel = app.registerRightPanel({
      id: PANEL_ID,
      title: PLUGIN_TITLE,
      dock: "replace-style",
      icon: RAIL_ICON_DATA_URI,
      defaultWidth: 360,
      render: renderPanel,
    });
    state.panelKind = "right";
    return;
  }
  if (app.registerFloatingPanel) {
    state.disposePanel = app.registerFloatingPanel({
      id: PANEL_ID,
      title: PLUGIN_TITLE,
      defaultWidth: 340,
      render: renderPanel,
    });
    state.panelKind = "floating";
  }
}

// ############################################################################
// ########## Plugin entry point ##############################################
// ############################################################################

export const plugin = {
  id: PLUGIN_ID,
  name: PLUGIN_TITLE,
  version: PLUGIN_VERSION,
  engines: ["maplibre"],

  activate(app) {
    state.app = app;
    const map = app.getMap?.() ?? null;
    state.map = map;
    if (map) attachMapInteractions(map);
    app.addMapControl(control, "top-right");
    registerSurfaces(app);
  },

  deactivate(app) {
    state.abortController?.abort();
    closePopup();
    if (state.map) detachMapInteractions(state.map);
    state.disposePanel?.();
    state.disposePanel = null;
    state.panelKind = null;
    app.removeMapControl(control);
    state.app = null;
    state.map = null;
    state.fetching = false;
  },
};

export default plugin;
