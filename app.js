const PADUS_LAYER_URL =
  "https://edits.nationalmap.gov/arcgis/rest/services/PAD-US/PAD_US_4_1/MapServer/0";

const STORAGE_KEY = "parks-passport.visited.v1";
const NPS_KEY_STORAGE = "parks-passport.nps-key";
const SOURCE_LABELS = {
  nps: "NPS",
  usfs: "National Forest",
  state: "State Park",
};

const stateNames = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  DC: "District of Columbia",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
  AS: "American Samoa",
  GU: "Guam",
  MP: "Northern Mariana Islands",
  PR: "Puerto Rico",
  VI: "U.S. Virgin Islands",
};

const stateAbbrByName = Object.fromEntries(
  Object.entries(stateNames).map(([abbr, name]) => [name.toLowerCase(), abbr])
);

const state = {
  view: null,
  npsLayer: null,
  usfsLayer: null,
  stateLayer: null,
  sitesLayer: null,
  visitedLayer: null,
  renderSiteMarkers: null,
  renderVisitedMarkers: null,
  selectedGraphic: null,
  items: [],
  filteredItems: [],
  visited: new Set(readJson(STORAGE_KEY, [])),
  filters: {
    query: "",
    source: "all",
    state: "all",
    status: "all",
  },
};

const els = {};

document.addEventListener("DOMContentLoaded", () => {
  bindElements();
  bindControls();
  renderIcons();
  loadSavedNpsKey();
});

require([
  "esri/Map",
  "esri/Basemap",
  "esri/views/MapView",
  "esri/layers/GraphicsLayer",
  "esri/layers/WebTileLayer",
  "esri/Graphic",
  "esri/geometry/Point",
  "esri/symbols/SimpleMarkerSymbol",
  "esri/symbols/TextSymbol",
], (
  Map,
  Basemap,
  MapView,
  GraphicsLayer,
  WebTileLayer,
  Graphic,
  Point,
  SimpleMarkerSymbol,
  TextSymbol
) => {
  const basemap = new Basemap({
    baseLayers: [
      new WebTileLayer({
        urlTemplate:
          "https://{subDomain}.basemaps.cartocdn.com/rastertiles/voyager/{level}/{col}/{row}.png",
        subDomains: ["a", "b", "c", "d"],
        opacity: 0.95,
        copyright: "Carto, OpenStreetMap contributors",
      }),
    ],
  });

  state.npsLayer = makePadusSource("nps", "Mang_Name = 'NPS'");
  state.usfsLayer = makePadusSource(
    "usfs",
    "Mang_Name = 'USFS' AND Des_Tp = 'NF' AND Unit_Nm NOT LIKE '% Other' AND Unit_Nm NOT LIKE '%Purchase Unit%'"
  );
  state.stateLayer = makePadusSource("state", "Des_Tp = 'SP'");

  state.sitesLayer = new GraphicsLayer({
    title: "Park sites",
    listMode: "hide",
  });

  state.visitedLayer = new GraphicsLayer({
    title: "Visited sites",
    listMode: "hide",
  });

  const map = new Map({
    basemap,
    layers: [state.sitesLayer, state.visitedLayer],
  });

  state.view = new MapView({
    container: "viewDiv",
    map,
    center: [-98.58, 39.83],
    zoom: 4,
    constraints: {
      minZoom: 3,
      snapToZoom: false,
    },
    popup: {
      dockEnabled: true,
      dockOptions: {
        buttonEnabled: false,
        breakpoint: false,
        position: "bottom-right",
      },
    },
    ui: {
      components: ["zoom", "attribution"],
    },
  });

  state.view.when(async () => {
    state.renderSiteMarkers = renderSiteMarkers;
    state.renderVisitedMarkers = renderVisitedMarkers;
    await loadPadusDirectory();
  });

  window.addEventListener("resize", () => renderList());

  function makePadusSource(source, definitionExpression) {
    return {
      source,
      definitionExpression,
      outFields: [
        "OBJECTID",
        "Unit_Nm",
        "Loc_Nm",
        "State_Nm",
        "Mang_Name",
        "Loc_Mang",
        "Des_Tp",
        "Loc_Ds",
        "GIS_Acres",
        "Pub_Access",
        "GIS_Src",
      ],
    };
  }

  async function loadPadusDirectory() {
    setSourceNote("Loading PAD-US park directory...");
    try {
      const [npsFeatures, usfsFeatures, stateFeatures] = await Promise.all([
        queryAllFeatures(state.npsLayer, "nps"),
        queryAllFeatures(state.usfsLayer, "usfs"),
        queryAllFeatures(state.stateLayer, "state"),
      ]);

      const padusItems = dedupeItems([...npsFeatures, ...usfsFeatures, ...stateFeatures]);
      state.items = padusItems.sort(sortItems);
      migrateVisitedIds(state.items);
      populateStateFilter();
      applyFilters();
      setSourceNote(
        `Loaded ${formatNumber(state.items.length)} records from USGS PAD-US 4.1, including NPS sites, National Forests, and state parks.`
      );
    } catch (error) {
      console.error(error);
      state.items = [];
      populateStateFilter();
      applyFilters();
      setSourceNote("Could not load the PAD-US directory. Check network access and reload the page.");
    }
  }

  async function queryAllFeatures(layer, source) {
    const features = [];
    let start = 0;
    let hasMore = true;
    const pageSize = source === "nps" ? 500 : 2000;

    while (hasMore && start < 24000) {
      const url = new URL(`${PADUS_LAYER_URL}/query`);
      url.searchParams.set("f", "json");
      url.searchParams.set("where", layer.definitionExpression);
      url.searchParams.set("outFields", layer.outFields.join(","));
      url.searchParams.set("returnGeometry", "true");
      url.searchParams.set("outSR", "4326");
      url.searchParams.set("geometryPrecision", "4");
      url.searchParams.set("maxAllowableOffset", "0.05");
      url.searchParams.set("resultOffset", String(start));
      url.searchParams.set("resultRecordCount", String(pageSize));
      url.searchParams.set("orderByFields", "State_Nm ASC,Unit_Nm ASC");

      const response = await fetch(url);
      if (!response.ok) throw new Error(`PAD-US query returned ${response.status}`);

      const result = await response.json();
      if (result.error) throw new Error(result.error.message || "PAD-US query failed");

      const page = result.features || [];
      features.push(...page.map((feature) => normalizeFeature(feature, source)));
      hasMore = Boolean(result.exceededTransferLimit) || page.length === pageSize;
      start += pageSize;
    }

    return features.filter((item) => item.name && item.point && !isExcludedItem(item));
  }

  function normalizeFeature(feature, source) {
    const attrs = feature?.attributes || {};
    const name = cleanName(attrs.Unit_Nm || attrs.Loc_Nm || "Unnamed park");
    const stateAbbr = normalizeState(attrs.State_Nm);
    const point = geometryToPoint(feature?.geometry);
    const nameSlug = slug(name);
    const stateKey = stateAbbr || "na";
    const id = source === "state" ? `padus:${source}:${nameSlug}:${stateKey}` : `padus:${source}:${nameSlug}`;
    const legacyIds = [`padus:${source}:${nameSlug}:${stateKey}`];

    return {
      id,
      legacyIds,
      source,
      name,
      state: stateAbbr,
      states: stateAbbr ? [stateAbbr] : [],
      stateName: formatStateNames(stateAbbr ? [stateAbbr] : []) || attrs.State_Nm || "",
      rawDesignation: cleanName(attrs.Des_Tp),
      designation: cleanName(designationName(attrs.Des_Tp) || attrs.Loc_Ds),
      manager: cleanName(attrs.Loc_Mang || attrs.Mang_Name || ""),
      acres: Number(attrs.GIS_Acres) || 0,
      access: accessName(attrs.Pub_Access),
      point,
      feature,
      searchText: "",
    };
  }

  function geometryToPoint(geometry) {
    if (!geometry) return null;
    const point = geometry.extent?.center || geometry.centroid || geometry;
    if (Number.isFinite(point.longitude) && Number.isFinite(point.latitude)) {
      return { longitude: point.longitude, latitude: point.latitude };
    }
    if (Number.isFinite(point.x) && Number.isFinite(point.y)) {
      return { longitude: point.x, latitude: point.y };
    }
    const bounds = coordinatesToBounds(geometry.rings || geometry.paths || geometry.points);
    if (bounds) {
      return {
        longitude: (bounds.minX + bounds.maxX) / 2,
        latitude: (bounds.minY + bounds.maxY) / 2,
      };
    }
    return null;
  }

  function renderSiteMarkers() {
    state.sitesLayer.removeAll();

    for (const item of state.filteredItems) {
      if (!item.point) continue;

      state.sitesLayer.add(
        new Graphic({
          geometry: new Point(item.point),
          attributes: { id: item.id, name: item.name, source: item.source },
          symbol: new SimpleMarkerSymbol(markerStyleForItem(item)),
          popupTemplate: {
            title: item.name,
            content: () => popupHtml(item),
          },
        })
      );
    }
  }

  function renderVisitedMarkers() {
    state.visitedLayer.removeAll();

    const visibleIds = new Set(state.filteredItems.map((item) => item.id));
    for (const item of state.items) {
      if (!visibleIds.has(item.id)) continue;
      if (!state.visited.has(item.id) || !item.point) continue;

      state.visitedLayer.add(
        new Graphic({
          geometry: new Point(item.point),
          attributes: { id: item.id, name: item.name },
          symbol: new TextSymbol({
            text: String.fromCharCode(10003),
            color: [255, 253, 246, 0.98],
            haloColor: markerHaloForItem(item),
            haloSize: 1,
            yoffset: -1,
            font: {
              family: "Arial Unicode MS",
              size: 10,
            },
          }),
          popupTemplate: {
            title: item.name,
            content: () => popupHtml(item),
          },
        })
      );
    }
  }
});

function bindElements() {
  Object.assign(els, {
    searchInput: document.getElementById("searchInput"),
    stateFilter: document.getElementById("stateFilter"),
    statusFilter: document.getElementById("statusFilter"),
    parkList: document.getElementById("parkList"),
    template: document.getElementById("parkItemTemplate"),
    visitedCount: document.getElementById("visitedCount"),
    visibleCount: document.getElementById("visibleCount"),
    totalCount: document.getElementById("totalCount"),
    sourceNote: document.getElementById("sourceNote"),
    sourceNoteText: document.getElementById("sourceNoteText"),
    sourceNoteClose: document.getElementById("sourceNoteClose"),
    resetViewButton: document.getElementById("resetViewButton"),
    exportButton: document.getElementById("exportButton"),
    clearButton: document.getElementById("clearButton"),
    importButton: document.getElementById("importButton"),
    importInput: document.getElementById("importInput"),
    npsKeyInput: document.getElementById("npsKeyInput"),
    loadNpsButton: document.getElementById("loadNpsButton"),
    sourceButtons: [...document.querySelectorAll("[data-source]")],
  });
}

function bindControls() {
  els.searchInput.addEventListener("input", () => {
    state.filters.query = els.searchInput.value.trim().toLowerCase();
    applyFilters();
  });

  els.stateFilter.addEventListener("change", () => {
    state.filters.state = els.stateFilter.value;
    applyFilters();
  });

  els.statusFilter.addEventListener("change", () => {
    state.filters.status = els.statusFilter.value;
    applyFilters();
  });

  els.sourceButtons.forEach((button) => {
    button.addEventListener("click", () => {
      els.sourceButtons.forEach((sourceButton) => sourceButton.classList.remove("active"));
      button.classList.add("active");
      state.filters.source = button.dataset.source;
      applyFilters();
      updateLayerVisibility();
    });
  });

  els.resetViewButton.addEventListener("click", () => {
    state.view?.goTo({ center: [-98.58, 39.83], zoom: 4 }, { duration: 650 });
  });

  els.exportButton.addEventListener("click", exportVisited);
  els.clearButton.addEventListener("click", clearVisited);
  els.importButton.addEventListener("click", () => els.importInput.click());
  els.importInput.addEventListener("change", importVisited);
  els.loadNpsButton.addEventListener("click", loadNpsApiDirectory);
  els.sourceNoteClose.addEventListener("click", () => {
    els.sourceNote.classList.add("hidden");
  });
}

function applyFilters() {
  state.filteredItems = state.items.filter((item) => {
    const matchesQuery = !state.filters.query || item.searchText.includes(state.filters.query);
    const matchesSource = state.filters.source === "all" || item.source === state.filters.source;
    const matchesState = state.filters.state === "all" || item.state === state.filters.state;
    const visited = state.visited.has(item.id);
    const matchesStatus =
      state.filters.status === "all" ||
      (state.filters.status === "visited" && visited) ||
      (state.filters.status === "unvisited" && !visited);

    return matchesQuery && matchesSource && matchesState && matchesStatus;
  });

  renderList();
  renderStats();
  state.renderSiteMarkers?.();
  state.renderVisitedMarkers?.();
}

function renderList() {
  if (!els.parkList) return;
  els.parkList.innerHTML = "";

  const pageItems = state.filteredItems.slice(0, 650);
  if (!pageItems.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = state.items.length
      ? "No parks match the current filters."
      : "Loading park records...";
    els.parkList.append(empty);
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const item of pageItems) {
    const node = els.template.content.firstElementChild.cloneNode(true);
    node.dataset.id = item.id;
    node.classList.toggle("visited", state.visited.has(item.id));

    const type = node.querySelector(".park-type");
    type.className = "park-type";
    type.textContent = labelForItem(item);
    type.classList.add(displayKindForItem(item));

    node.querySelector(".park-name").textContent = item.name;
    node.querySelector(".park-meta").textContent = [
      item.stateName,
      item.designation,
      item.acres ? `${formatNumber(item.acres)} acres` : "",
    ]
      .filter(Boolean)
      .join(" / ");

    node.querySelector(".park-main").addEventListener("click", () => zoomToItem(item));
    node.querySelector(".visit-button").addEventListener("click", () => toggleVisited(item.id));
    fragment.append(node);
  }

  if (state.filteredItems.length > pageItems.length) {
    const notice = document.createElement("div");
    notice.className = "empty";
    notice.textContent = `Showing the first ${formatNumber(pageItems.length)} matches. Use search or filters to narrow ${formatNumber(
      state.filteredItems.length
    )} records.`;
    fragment.append(notice);
  }

  els.parkList.append(fragment);
  renderIcons();
}

function renderStats() {
  const loadedVisited = state.items.filter((item) => state.visited.has(item.id)).length;
  els.visitedCount.textContent = formatNumber(loadedVisited);
  els.visibleCount.textContent = formatNumber(state.filteredItems.length);
  els.totalCount.textContent = formatNumber(state.items.length);
}

function populateStateFilter() {
  const current = els.stateFilter.value;
  const states = [...new Set(state.items.map((item) => item.state).filter(Boolean))].sort();
  els.stateFilter.innerHTML = '<option value="all">All states</option>';

  for (const abbr of states) {
    const option = document.createElement("option");
    option.value = abbr;
    option.textContent = stateNames[abbr] || abbr;
    els.stateFilter.append(option);
  }

  els.stateFilter.value = states.includes(current) ? current : "all";
}

function zoomToItem(item) {
  if (!state.view || !item.point) return;

  document
    .querySelectorAll(".park-item")
    .forEach((node) => node.classList.toggle("active", node.dataset.id === item.id));

  state.view.goTo(
    {
      center: [item.point.longitude, item.point.latitude],
      zoom: zoomForItem(item),
    },
    { duration: 650 }
  );

  state.view.openPopup({
    title: item.name,
    location: {
      type: "point",
      longitude: item.point.longitude,
      latitude: item.point.latitude,
    },
    content: popupHtml(item),
  });
}

function popupHtml(item) {
  const visited = state.visited.has(item.id);
  const details = [
    labelForItem(item),
    item.stateName,
    item.designation,
    item.acres ? `${formatNumber(item.acres)} acres` : "",
  ]
    .filter(Boolean)
    .join(" / ");

  const wrapper = document.createElement("div");
  wrapper.innerHTML = `
    <p>${escapeHtml(details)}</p>
    <button class="popup-visit" type="button">${visited ? "Mark unvisited" : "Mark visited"}</button>
  `;
  const button = wrapper.querySelector("button");
  button.addEventListener("click", () => {
    toggleVisited(item.id);
    button.textContent = state.visited.has(item.id) ? "Mark unvisited" : "Mark visited";
  });
  return wrapper;
}

function toggleVisited(id) {
  if (state.visited.has(id)) {
    state.visited.delete(id);
  } else {
    state.visited.add(id);
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify([...state.visited]));
  applyFilters();
}

function clearVisited() {
  const count = state.items.filter((item) => state.visited.has(item.id)).length;
  if (!count) {
    setSourceNote("There are no visited sites to clear.");
    return;
  }

  const confirmed = window.confirm(`Mark all ${formatNumber(count)} visited sites as unvisited?`);
  if (!confirmed) return;

  state.visited.clear();
  localStorage.setItem(STORAGE_KEY, JSON.stringify([]));
  if (state.filters.status === "visited") {
    els.statusFilter.value = "all";
    state.filters.status = "all";
  }
  applyFilters();
  state.view?.closePopup?.();
  setSourceNote(`Cleared ${formatNumber(count)} visited sites.`);
}

function updateLayerVisibility() {
  state.renderSiteMarkers?.();
}

function markerStyleForItem(item) {
  const styles = {
    "national-park": {
      style: "diamond",
      size: 10,
      color: [31, 93, 66, 0.88],
      outline: { color: [255, 253, 246, 0.9], width: 0.9 },
    },
    nps: {
      style: "circle",
      size: 7,
      color: [47, 125, 87, 0.72],
      outline: { color: [255, 253, 246, 0.82], width: 0.7 },
    },
    usfs: {
      style: "triangle",
      size: 9,
      color: [34, 109, 119, 0.78],
      outline: { color: [255, 253, 246, 0.84], width: 0.8 },
    },
    state: {
      style: "square",
      size: 7,
      color: [168, 85, 53, 0.68],
      outline: { color: [255, 253, 246, 0.82], width: 0.7 },
    },
  };

  return styles[displayKindForItem(item)] || styles.nps;
}

function markerHaloForItem(item) {
  const halos = {
    "national-park": [31, 93, 66, 0.96],
    nps: [31, 93, 66, 0.9],
    usfs: [24, 86, 94, 0.92],
    state: [145, 69, 42, 0.9],
  };

  return halos[displayKindForItem(item)] || halos.nps;
}

function displayKindForItem(item) {
  if (isNationalPark(item)) return "national-park";
  return item.source;
}

function labelForItem(item) {
  if (isNationalPark(item)) return "National Park";
  return SOURCE_LABELS[item.source] || item.source;
}

function isNationalPark(item) {
  if (item.source !== "nps") return false;
  const rawDesignation = String(item.rawDesignation || "").toUpperCase();
  const designation = String(item.designation || "").toLowerCase();
  return rawDesignation === "NP" || designation === "national park";
}

function isExcludedItem(item) {
  return item.source === "usfs" && /\bother$/i.test(item.name);
}

function zoomForItem(item) {
  if (item.source === "state") return 11;
  if (item.source === "usfs") return 8;
  return isNationalPark(item) ? 8 : 9;
}

async function loadNpsApiDirectory() {
  const key = els.npsKeyInput.value.trim();
  if (!key) {
    setSourceNote("Enter a free NPS API key from developer.nps.gov, then load the official NPS directory.");
    return;
  }

  localStorage.setItem(NPS_KEY_STORAGE, key);
  setSourceNote("Loading official NPS site directory...");

  try {
    const endpoint = new URL("https://developer.nps.gov/api/v1/parks");
    endpoint.searchParams.set("limit", "600");
    endpoint.searchParams.set("fields", "images");
    endpoint.searchParams.set("api_key", key);

    const response = await fetch(endpoint);
    if (!response.ok) throw new Error(`NPS API returned ${response.status}`);
    const payload = await response.json();

    const npsItems = (payload.data || [])
      .map(normalizeNpsApiPark)
      .filter((item) => item.name && item.point);

    const stateItems = state.items.filter((item) => item.source !== "nps");
    state.items = dedupeItems([...stateItems, ...npsItems]).sort(sortItems);
    migrateVisitedIds(state.items);
    populateStateFilter();
    applyFilters();
    setSourceNote(`Loaded official NPS directory plus USGS PAD-US National Forests and state parks.`);
  } catch (error) {
    console.error(error);
    setSourceNote("Could not load NPS API data. Check the key and network access; PAD-US records remain available.");
  }
}

function normalizeNpsApiPark(park) {
  const coords = parseLatLong(park.latLong);
  const states = (park.states || "").split(",").map((value) => value.trim()).filter(Boolean);
  const primaryState = states[0] || "";
  const designation = park.designation || "National Park Service site";

  const item = {
    id: `nps-api:${park.parkCode}`,
    legacyIds: [],
    source: "nps",
    name: cleanName(park.fullName || park.name),
    state: primaryState,
    states,
    stateName: states.map((abbr) => stateNames[abbr] || abbr).join(", "),
    rawDesignation: cleanName(park.designation),
    designation: cleanName(designation),
    manager: "National Park Service",
    acres: 0,
    access: "",
    point: coords,
    feature: null,
    searchText: "",
  };

  item.searchText = makeSearchText(item);
  return item;
}

function parseLatLong(value) {
  const latMatch = String(value || "").match(/lat:\s*(-?\d+(\.\d+)?)/i);
  const lonMatch = String(value || "").match(/long:\s*(-?\d+(\.\d+)?)/i);
  if (!latMatch || !lonMatch) return null;
  return {
    latitude: Number(latMatch[1]),
    longitude: Number(lonMatch[1]),
  };
}

function loadSavedNpsKey() {
  const key = localStorage.getItem(NPS_KEY_STORAGE);
  if (key) els.npsKeyInput.value = key;
}

function exportVisited() {
  const visitedItems = state.items.filter((item) => state.visited.has(item.id));
  const rows = [
    ["Id", "Name", "Type", "State", "Designation", "Acres"],
    ...visitedItems.map((item) => [
      item.id,
      item.name,
      labelForItem(item),
      item.stateName,
      item.designation,
      item.acres || "",
    ]),
  ];

  const csv = rows
    .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "parks-passport-visited.csv";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function importVisited(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;

  if (!state.items.length) {
    setSourceNote("Wait for the park directory to finish loading before importing a CSV.");
    return;
  }

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      const result = importVisitedCsv(String(reader.result || ""));
      if (!result.matched) {
        setSourceNote(`No matching sites found in ${file.name}. Check that the CSV includes park names.`);
        return;
      }

      localStorage.setItem(STORAGE_KEY, JSON.stringify([...state.visited]));
      els.searchInput.value = "";
      state.filters.query = "";
      state.filters.source = "all";
      els.sourceButtons.forEach((button) => {
        button.classList.toggle("active", button.dataset.source === "all");
      });
      els.statusFilter.value = "visited";
      state.filters.status = "visited";
      applyFilters();
      setSourceNote(
        `Imported ${formatNumber(result.matched)} visited sites from ${file.name}. ${formatNumber(result.unmatched)} rows were not matched.`
      );
    } catch (error) {
      console.error(error);
      setSourceNote(`Could not import ${file.name}. Make sure it is a valid CSV file.`);
    }
  });
  reader.readAsText(file);
}

function importVisitedCsv(csvText) {
  const rows = parseCsv(csvText).filter((row) => row.some((cell) => cleanName(cell)));
  if (!rows.length) return { matched: 0, unmatched: 0 };

  const headers = rows[0].map(headerKey);
  const hasHeaders = headers.some((header) => ["id", "name", "type", "state", "visited", "status"].includes(header));
  const dataRows = hasHeaders ? rows.slice(1) : rows;
  const indexes = hasHeaders
    ? headerIndexes(headers)
    : { name: 0, type: 1, state: 2, designation: 3 };
  const itemIndex = buildImportIndex();
  let matched = 0;
  let unmatched = 0;

  for (const row of dataRows) {
    if (shouldSkipImportRow(row, indexes)) continue;

    const item = findImportMatch(row, indexes, itemIndex);
    if (item) {
      state.visited.add(item.id);
      matched += 1;
    } else {
      unmatched += 1;
    }
  }

  return { matched, unmatched };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell);
  rows.push(row);
  return rows;
}

function headerKey(value) {
  const key = slug(value).replace(/-/g, "");
  const aliases = {
    id: "id",
    siteid: "id",
    parkid: "id",
    name: "name",
    site: "name",
    park: "name",
    unit: "name",
    sitename: "name",
    parkname: "name",
    type: "type",
    source: "type",
    category: "type",
    state: "state",
    states: "state",
    designation: "designation",
    status: "status",
    visited: "visited",
  };
  return aliases[key] || key;
}

function headerIndexes(headers) {
  return headers.reduce((indexes, header, index) => {
    if (indexes[header] === undefined) indexes[header] = index;
    return indexes;
  }, {});
}

function shouldSkipImportRow(row, indexes) {
  const status = cellAt(row, indexes.status).toLowerCase();
  const visited = cellAt(row, indexes.visited).toLowerCase();
  if (status && ["unvisited", "no", "false", "0"].includes(status)) return true;
  if (visited && ["unvisited", "no", "false", "0"].includes(visited)) return true;
  return !cellAt(row, indexes.id) && !cellAt(row, indexes.name);
}

function findImportMatch(row, indexes, itemIndex) {
  const id = cellAt(row, indexes.id);
  if (id && itemIndex.byId.has(id)) return itemIndex.byId.get(id);

  const name = cleanImportName(cellAt(row, indexes.name));
  if (!name) return null;

  const type = sourceKeyFromLabel(cellAt(row, indexes.type));
  const stateValue = cellAt(row, indexes.state);
  const stateTokens = stateValue
    .split(/[,;/]/)
    .map((value) => normalizeState(value))
    .filter(Boolean);
  const stateToken = stateTokens[0] || "";
  const candidates = itemIndex.byName.get(name) || [];

  return (
    candidates.find((item) => type && displayKindForItem(item) === type && stateMatches(item, stateTokens)) ||
    candidates.find((item) => type && item.source === type && stateMatches(item, stateTokens)) ||
    candidates.find((item) => type && displayKindForItem(item) === type) ||
    candidates.find((item) => type && item.source === type) ||
    candidates.find((item) => stateToken && stateMatches(item, stateTokens)) ||
    candidates[0] ||
    null
  );
}

function buildImportIndex() {
  const byId = new Map();
  const byName = new Map();

  for (const item of state.items) {
    byId.set(item.id, item);
    for (const legacyId of item.legacyIds || []) byId.set(legacyId, item);

    const key = cleanImportName(item.name);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(item);
  }

  return { byId, byName };
}

function stateMatches(item, states) {
  if (!states.length) return true;
  return states.some((abbr) => (item.states || []).includes(abbr) || item.state === abbr);
}

function sourceKeyFromLabel(value) {
  const key = slug(value);
  const labels = {
    nps: "nps",
    "other-nps": "nps",
    "national-park-service": "nps",
    "national-park": "national-park",
    "national-forest": "usfs",
    forest: "usfs",
    usfs: "usfs",
    "state-park": "state",
    state: "state",
  };
  return labels[key] || "";
}

function cleanImportName(value) {
  return slug(String(value || "").replace(/\s+\([^)]*\)$/g, ""));
}

function cellAt(row, index) {
  return index === undefined ? "" : cleanName(row[index]);
}

function makeSearchText(item) {
  return [
    item.name,
    item.state,
    item.stateName,
    item.designation,
    item.manager,
    item.source,
    SOURCE_LABELS[item.source],
    labelForItem(item),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function dedupeItems(items) {
  const byKey = new Map();

  for (const item of items) {
    const existing = byKey.get(item.id);
    if (!existing) {
      byKey.set(item.id, prepareItem(item));
      continue;
    }

    byKey.set(item.id, mergeItems(existing, item));
  }

  return [...byKey.values()].map(prepareItem);
}

function prepareItem(item) {
  item.states = [...new Set(item.states || (item.state ? [item.state] : []))].filter(Boolean).sort();
  item.state = item.states[0] || item.state || "";
  item.stateName = formatStateNames(item.states) || item.stateName || "";
  item.legacyIds = [...new Set(item.legacyIds || [])];
  item.searchText = makeSearchText(item);
  return item;
}

function mergeItems(existing, next) {
  const primary = (next.acres || 0) > (existing.acres || 0) ? next : existing;
  const states = [...new Set([...(existing.states || []), ...(next.states || [])])].filter(Boolean).sort();
  const legacyIds = [...new Set([...(existing.legacyIds || []), ...(next.legacyIds || [])])];

  return prepareItem({
    ...primary,
    id: existing.id,
    states,
    state: states[0] || existing.state || next.state || "",
    stateName: formatStateNames(states) || primary.stateName,
    acres: (existing.acres || 0) + (next.acres || 0),
    legacyIds,
  });
}

function migrateVisitedIds(items) {
  let changed = false;

  for (const item of items) {
    for (const legacyId of item.legacyIds || []) {
      if (legacyId === item.id || !state.visited.has(legacyId)) continue;
      state.visited.delete(legacyId);
      state.visited.add(item.id);
      changed = true;
    }
  }

  if (changed) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...state.visited]));
  }
}

function formatStateNames(states) {
  return (states || []).map((abbr) => stateNames[abbr] || abbr).filter(Boolean).join(", ");
}

function coordinatesToBounds(coordinates) {
  if (!Array.isArray(coordinates)) return null;

  const bounds = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };

  const visit = (value) => {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1])) {
      bounds.minX = Math.min(bounds.minX, value[0]);
      bounds.maxX = Math.max(bounds.maxX, value[0]);
      bounds.minY = Math.min(bounds.minY, value[1]);
      bounds.maxY = Math.max(bounds.maxY, value[1]);
      return;
    }
    value.forEach(visit);
  };

  visit(coordinates);
  return Number.isFinite(bounds.minX) ? bounds : null;
}

function normalizeState(value) {
  if (!value) return "";
  const trimmed = String(value).trim();
  if (stateNames[trimmed]) return trimmed;
  return stateAbbrByName[trimmed.toLowerCase()] || trimmed.slice(0, 2).toUpperCase();
}

function designationName(value) {
  const labels = {
    NP: "National Park",
    NM: "National Monument",
    NPres: "National Preserve",
    NHS: "National Historic Site",
    NHP: "National Historical Park",
    NB: "National Battlefield",
    NRA: "National Recreation Area",
    NS: "National Seashore",
    NL: "National Lakeshore",
    NF: "National Forest",
    SP: "State Park",
  };
  return labels[value] || value || "";
}

function accessName(value) {
  const labels = {
    OA: "Open access",
    RA: "Restricted access",
    XA: "Closed",
    UK: "Unknown access",
  };
  return labels[value] || value || "";
}

function cleanName(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function slug(value) {
  return cleanName(value)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function sortItems(a, b) {
  return (
    a.source.localeCompare(b.source) ||
    (a.stateName || "").localeCompare(b.stateName || "") ||
    a.name.localeCompare(b.name)
  );
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value || 0);
}

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
}

function setSourceNote(message) {
  if (!els.sourceNoteText) return;
  els.sourceNoteText.textContent = message;
  els.sourceNote?.classList.remove("hidden");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderIcons() {
  if (window.lucide) window.lucide.createIcons();
}

