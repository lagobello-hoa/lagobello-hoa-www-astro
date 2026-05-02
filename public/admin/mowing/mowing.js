/* Lago Bello HOA — Mowing Manifest Generator
 * All processing is browser-only. PayHOA aging data is never uploaded.
 */
(function () {
  "use strict";

  // -----------------------------
  // Constants & state
  // -----------------------------
  const LOTS_JSON_URL = "https://www.lagobello.com/data/lots.json";
  const CONFIG_URL = "/data/mowing-config.json";
  const GEOJSON_URL = "/data/lots.geojson";
  const STORAGE_PREFIX = "lagobello-mowing.";

  const PRICING_KEYS = [
    { key: "lot_1_common_areas", label: "Lot #1 + common areas", min: 0, max: 250, step: 5 },
    { key: "small_house",         label: "School-side house", min: 0, max: 100, step: 5 },
    { key: "small_empty_lot",     label: "School-side vacant lot", min: 0, max: 100, step: 5 },
    { key: "large_house",         label: "Lake-side house", min: 0, max: 100, step: 5 },
    { key: "large_empty_lot",     label: "Lake-side vacant lot", min: 0, max: 100, step: 5 },
  ];

  const CONTRACTOR_LABELS = {
    MOW: "MOW",
    DO_NOT_MOW_HOA_HOLD: "DO NOT MOW — HOA HOLD",
    DEVELOPER_MANAGED: "DEVELOPER MANAGED — DO NOT MOW BY HOA CONTRACTOR",
  };

  const CLASS_LABELS = {
    lot_1_common_areas: "Lot #1 + common areas",
    small_house: "School-side house",
    small_empty_lot: "School-side vacant lot",
    large_house: "Lake-side house",
    large_empty_lot: "Lake-side vacant lot",
  };

  // Same as CLASS_LABELS now that we use side-based naming throughout
  const SIDE_LABELS = CLASS_LABELS;

  const STYLE_BY_ACTION = {
    MOW:                  { color: "#15803d", fillColor: "#22c55e", fillOpacity: 0.45, weight: 3 },
    DO_NOT_MOW_HOA_HOLD:  { color: "#b91c1c", fillColor: "#ef4444", fillOpacity: 0.45, weight: 3 },
    DEVELOPER_MANAGED:    { color: "#1d4ed8", fillColor: "#3b82f6", fillOpacity: 0.45, weight: 3 },
  };

  const STATE = {
    lots: [],
    config: null,
    polygons: null,         // FeatureCollection or null
    polygonsApproximate: false,
    csvRows: [],            // aging CSV rows
    membersByStreet: null,  // Map<streetNumber, ownerInfoString> or null when not loaded
    membersLoaded: false,
    pricing: {},
    builtHouses: [],
    manifest: [],
    warnings: [],
    csvLoaded: false,
    map: null,
    polygonLayer: null,
    markerLayer: null,
  };

  // -----------------------------
  // Utilities
  // -----------------------------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function fmtMoney(n) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);
  }

  function parseMoney(value) {
    if (value == null || value === "") return 0;
    const s = String(value).replace(/[$,\s]/g, "").trim();
    if (s === "" || s === "-") return 0;
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
  }

  function normalizeAddress(value) {
    return String(value || "")
      .toUpperCase()
      .replace(/\./g, "")
      .replace(/\s+/g, " ")
      .replace(/\bAVENUE\b/g, "AVE")
      .trim();
  }

  function extractStreetNumber(value) {
    const m = normalizeAddress(value).match(/\b\d{3,5}\b/);
    return m ? m[0] : null;
  }

  function lotKey(section, block, lot) {
    return `S${section}-B${block}-L${lot}`;
  }

  function loadStorage(key, fallback) {
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + key);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  }
  function saveStorage(key, value) {
    try { localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value)); } catch {}
  }

  function addWarning(text, level) {
    STATE.warnings.push({ text, level: level || "warn" });
  }

  // -----------------------------
  // Data loading
  // -----------------------------
  async function loadAll() {
    STATE.warnings = [];
    const [lotsRes, configRes, geoRes] = await Promise.allSettled([
      fetch(LOTS_JSON_URL).then(r => r.json()),
      fetch(CONFIG_URL).then(r => r.json()),
      fetch(GEOJSON_URL).then(r => r.ok ? r.json() : null),
    ]);

    if (lotsRes.status !== "fulfilled") {
      addWarning("Failed to load lots.json from lagobello.com — map and manifest unavailable.", "error");
      return false;
    }
    if (configRes.status !== "fulfilled") {
      addWarning("Failed to load mowing-config.json — using defaults.", "error");
    }

    const lots = lotsRes.value
      .filter(l => l.Subdivision === "Section 1" || l.Subdivision === "Section 2")
      .map(parseLot);
    STATE.lots = lots;

    STATE.config = configRes.status === "fulfilled" ? configRes.value : defaultConfig();

    // Pricing & built houses: load from storage if present, else use config defaults
    const storedPricing = loadStorage("pricing", null);
    STATE.pricing = storedPricing || { ...STATE.config.pricingDefaults };
    const storedHouses = loadStorage("builtHouses", null);
    STATE.builtHouses = storedHouses || [...STATE.config.builtHouseAddresses];

    // Polygons
    if (geoRes.status === "fulfilled" && geoRes.value && geoRes.value.features?.length) {
      STATE.polygons = geoRes.value;
      STATE.polygonsApproximate = false;
    } else {
      STATE.polygons = generateApproximatePolygons(lots);
      STATE.polygonsApproximate = true;
      addWarning("Using approximate generated lot shapes. Replace public/data/lots.geojson with real lot polygons before issuing contractor PDF.");
    }

    return true;
  }

  function defaultConfig() {
    return {
      version: 2,
      mowingHoldRule: { field: "90+ Days Past", operator: ">", amount: 0 },
      builtHouseAddresses: [],
      pricingDefaults: {
        lot_1_common_areas: 120,
        small_house: 35,
        small_empty_lot: 25,
        large_house: 40,
        large_empty_lot: 40,
      },
      managedLots: [],
    };
  }

  function parseLot(raw) {
    const section = parseInt(String(raw.Subdivision || "").replace(/[^0-9]/g, ""), 10) || null;
    const block = raw["Block Number"] != null ? Math.round(raw["Block Number"]) : null;
    const lot = raw["Lot Number"] != null ? Math.round(raw["Lot Number"]) : null;
    const closeTo = String(raw["Close-to"] || "").toLowerCase();
    let lat = null, lng = null;
    if (raw.Location) {
      const parts = String(raw.Location).split(",").map(s => parseFloat(s.trim()));
      if (parts.length === 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
        [lat, lng] = parts;
      }
    }
    return {
      lot_key: section && block && lot ? lotKey(section, block, lot) : null,
      address: raw.Name || "",
      section, block, lot,
      lot_side: closeTo.includes("school") ? "school" : closeTo.includes("lake") ? "lake" : "unknown",
      lat, lng,
    };
  }

  // Approximate polygons: build a small square (~30 ft) around each lot point.
  function generateApproximatePolygons(lots) {
    const features = [];
    const dLat = 0.00012;  // ~13 m
    const dLng = 0.00018;
    for (const lot of lots) {
      if (lot.lat == null || lot.lng == null) continue;
      const ring = [
        [lot.lng - dLng, lot.lat - dLat],
        [lot.lng + dLng, lot.lat - dLat],
        [lot.lng + dLng, lot.lat + dLat],
        [lot.lng - dLng, lot.lat + dLat],
        [lot.lng - dLng, lot.lat - dLat],
      ];
      features.push({
        type: "Feature",
        properties: {
          section: lot.section,
          block: lot.block,
          lot: lot.lot,
          address: lot.address,
          lot_key: lot.lot_key,
        },
        geometry: { type: "Polygon", coordinates: [ring] },
      });
    }
    return { type: "FeatureCollection", features };
  }

  // -----------------------------
  // CSV parsing & matching
  // -----------------------------
  function handleCsvFile(file) {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      complete: (results) => {
        const headers = results.meta.fields || [];
        if (!headers.includes("90+ Days Past")) {
          showCsvStatus(`Missing required column "90+ Days Past". Generation blocked.`, "err");
          STATE.csvLoaded = false;
          STATE.csvRows = [];
          render();
          return;
        }
        STATE.csvRows = results.data.filter(row => Object.values(row).some(v => v && String(v).trim() !== ""));
        STATE.csvLoaded = true;
        showCsvStatus(`Loaded ${STATE.csvRows.length} rows from ${file.name}.`, "ok");
        computeManifest();
        render();
      },
      error: (err) => {
        showCsvStatus("Failed to parse CSV: " + err.message, "err");
      },
    });
  }

  function showCsvStatus(text, level) {
    const el = $("#csv-status");
    el.textContent = text;
    el.className = "csv-status " + (level || "");
    updateOverallPill();
  }

  function showMembersStatus(text, level) {
    const el = $("#csv-members-status");
    el.textContent = text;
    el.className = "csv-status " + (level || "");
    updateOverallPill();
  }

  function updateOverallPill() {
    const pill = $("#status-pill");
    const parts = [];
    if (STATE.membersLoaded) parts.push("Members");
    if (STATE.csvLoaded) parts.push("Aging");
    if (parts.length === 0) {
      pill.textContent = "No CSV loaded";
      pill.className = "pill pill-warn";
    } else {
      pill.textContent = parts.join(" + ") + " loaded";
      pill.className = "pill pill-ok";
    }
  }

  function handleMembersFile(file) {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      complete: (results) => {
        const headers = results.meta.fields || [];
        if (!headers.includes("Owner Information")) {
          showMembersStatus(`Missing required column "Owner Information".`, "err");
          STATE.membersLoaded = false;
          STATE.membersByStreet = null;
          render();
          return;
        }
        const map = new Map();
        let count = 0;
        for (const row of results.data) {
          const num = extractStreetNumber(row["Unit Name"]) || extractStreetNumber(row["Unit Address"]);
          const owner = String(row["Owner Information"] || "").trim();
          if (num && owner) {
            // Multiple owners may share an address; keep the first non-empty
            if (!map.has(num)) map.set(num, owner);
            count++;
          }
        }
        STATE.membersByStreet = map;
        STATE.membersLoaded = true;
        showMembersStatus(`Loaded ${count} member rows from ${file.name}.`, "ok");
        computeManifest();
        render();
      },
      error: (err) => showMembersStatus("Failed to parse CSV: " + err.message, "err"),
    });
  }

  function isDeveloperOwner(ownerInfo) {
    if (!ownerInfo) return false;
    const upper = ownerInfo.toUpperCase();
    const names = STATE.config?.developerOwnerNames || [];
    return names.some((n) => upper.includes(String(n).toUpperCase()));
  }

  // Index CSV rows by street number for lookup
  function indexCsvByStreetNumber(rows) {
    const map = new Map();
    for (const row of rows) {
      const n = extractStreetNumber(row["Unit Title"]) || extractStreetNumber(row["Unit Address"]);
      if (n) {
        if (!map.has(n)) map.set(n, []);
        map.get(n).push(row);
      }
    }
    return map;
  }

  // -----------------------------
  // Manifest computation
  // -----------------------------
  function getManagedLotConfig(lot_key) {
    if (!STATE.config?.managedLots) return null;
    return STATE.config.managedLots.find(m => m.lot_key === lot_key) || null;
  }

  function deriveMowingClass(lot, builtHouseStreetNumbers, managedLotCfg) {
    if (managedLotCfg?.special_mowing_class) return managedLotCfg.special_mowing_class;
    const sizeClass = lot.lot_side === "school" ? "small" : "large";  // unknown defaults to large
    const num = extractStreetNumber(lot.address);
    const isHouse = num && builtHouseStreetNumbers.has(num);
    return `${sizeClass}_${isHouse ? "house" : "empty_lot"}`;
  }

  function computeManifest() {
    STATE.manifest = [];
    const csvIndex = indexCsvByStreetNumber(STATE.csvRows || []);
    const builtHouseStreetNumbers = new Set(
      (STATE.builtHouses || []).map(extractStreetNumber).filter(Boolean)
    );
    const matchedCsvRows = new Set();

    for (const lot of STATE.lots) {
      if (!lot.lot_key) continue;
      const cfg = getManagedLotConfig(lot.lot_key);
      const mowing_class = deriveMowingClass(lot, builtHouseStreetNumbers, cfg);
      const num = extractStreetNumber(lot.address);
      const csvMatches = num ? (csvIndex.get(num) || []) : [];
      let isNinetyPlus = false;
      for (const row of csvMatches) {
        if (parseMoney(row["90+ Days Past"]) > 0) isNinetyPlus = true;
        matchedCsvRows.add(row);
      }

      // Management rule (priority order):
      //   1. Config override (cfg.managed_by) wins when explicitly set.
      //   2. If member contact CSV is loaded, owner info determines:
      //      - matches a developerOwnerNames entry → "hacienda"
      //      - any other owner → "hoa"
      //   3. Fallback (no member CSV): aging-CSV presence rule.
      let managed_by;
      if (cfg?.managed_by) {
        managed_by = cfg.managed_by;
      } else if (STATE.membersLoaded) {
        const ownerInfo = num ? STATE.membersByStreet.get(num) : null;
        managed_by = isDeveloperOwner(ownerInfo) ? "hacienda" : "hoa";
      } else {
        managed_by = csvMatches.length > 0 ? "hoa" : "hacienda";
      }

      let action;
      if (managed_by === "hacienda") action = "DEVELOPER_MANAGED";
      else if (isNinetyPlus) action = "DO_NOT_MOW_HOA_HOLD";
      else action = "MOW";

      const color = action === "MOW" ? "green" : action === "DO_NOT_MOW_HOA_HOLD" ? "red" : "blue";
      const price = STATE.pricing[mowing_class] ?? 0;

      STATE.manifest.push({
        lot_key: lot.lot_key,
        address: lot.address,
        section: lot.section,
        block: lot.block,
        lot: lot.lot,
        managed_by,
        lot_side: lot.lot_side,
        improvement_status: mowing_class.includes("house") || mowing_class === "lot_1_common_areas" ? "house" : "empty_lot",
        mowing_class,
        action,
        color,
        contractor_label: CONTRACTOR_LABELS[action],
        price,
        payable: action === "MOW" ? price : 0,
        notes: cfg?.notes || "",
      });
    }

    // Warn on unmatched CSV rows
    if (STATE.csvRows && STATE.csvRows.length) {
      const unmatched = STATE.csvRows.filter(r => !matchedCsvRows.has(r));
      if (unmatched.length) {
        addWarning(`${unmatched.length} CSV row(s) did not match any managed lot.`);
      }
    }
  }

  // -----------------------------
  // Rendering
  // -----------------------------
  function render() {
    renderHeader();
    renderSummary();
    renderInvoice();
    renderManifestTable();
    renderMap();
    renderWarnings();
  }

  function renderHeader() {
    const now = new Date();
    const stamp = now.toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" });
    $("#generated-at").textContent = "Generated " + stamp;
    $("#print-generated-at").textContent = "Generated " + stamp;
  }

  function renderSummary() {
    const counts = { green: 0, red: 0, blue: 0 };
    let total = 0;
    for (const m of STATE.manifest) {
      counts[m.color]++;
      total += m.payable;
    }
    $("#count-green").textContent = counts.green;
    $("#count-red").textContent = counts.red;
    $("#count-blue").textContent = counts.blue;
    $("#total-payable").textContent = fmtMoney(total);
  }

  function renderInvoice() {
    const tbody = $("#invoice-table tbody");
    tbody.innerHTML = "";
    const groups = {};
    for (const m of STATE.manifest) {
      if (m.action !== "MOW") continue;
      if (!groups[m.mowing_class]) groups[m.mowing_class] = { count: 0, price: m.price };
      groups[m.mowing_class].count++;
    }
    let total = 0;
    const order = ["lot_1_common_areas", "small_house", "small_empty_lot", "large_house", "large_empty_lot"];
    for (const cls of order) {
      const g = groups[cls];
      if (!g || g.count === 0) continue;
      const amount = g.count * g.price;
      total += amount;
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${CLASS_LABELS[cls]}</td>
        <td class="num">${fmtMoney(g.price)}</td>
        <td class="num">${g.count}</td>
        <td class="num">${fmtMoney(amount)}</td>`;
      tbody.appendChild(tr);
    }
    $("#invoice-total").textContent = fmtMoney(total);
  }

  function renderManifestTable() {
    const tbody = $("#manifest-table tbody");
    tbody.innerHTML = "";
    const sorted = [...STATE.manifest].sort((a, b) => {
      if (a.section !== b.section) return a.section - b.section;
      if (a.block !== b.block) return a.block - b.block;
      return a.lot - b.lot;
    });
    for (const m of sorted) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><span class="action-tag ${m.color}">${m.contractor_label}</span></td>
        <td>${m.lot_key}</td>
        <td>${m.address}</td>
        <td>${CLASS_LABELS[m.mowing_class] || m.mowing_class}</td>
        <td>${SIDE_LABELS[m.mowing_class] || ""}</td>
        <td class="num">${fmtMoney(m.price)}</td>
        <td>${m.notes || ""}</td>`;
      tbody.appendChild(tr);
    }
  }

  function renderMap() {
    if (!STATE.map) {
      STATE.map = L.map("map", { preferCanvas: false });
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
        attribution: "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, USGS, USDA",
        maxZoom: 20,
      }).addTo(STATE.map);
    }
    if (STATE.polygonLayer) STATE.map.removeLayer(STATE.polygonLayer);

    const lookupByKey = new Map(STATE.manifest.map(m => [m.lot_key, m]));

    STATE.polygonLayer = L.geoJSON(STATE.polygons, {
      style: (feature) => {
        const m = lookupByKey.get(feature.properties.lot_key);
        if (!m) return { color: "#94a3b8", fillColor: "#94a3b8", fillOpacity: 0.2, weight: 1 };
        return STYLE_BY_ACTION[m.action];
      },
      onEachFeature: (feature, layer) => {
        const m = lookupByKey.get(feature.properties.lot_key);
        const label = m
          ? `<strong>${m.address}</strong><br>${m.lot_key}<br>${m.contractor_label}<br>${CLASS_LABELS[m.mowing_class]}`
          : `<strong>${feature.properties.address}</strong><br>${feature.properties.lot_key}<br>(no manifest)`;
        layer.bindTooltip(label, { sticky: true });
      },
    }).addTo(STATE.map);

    // Fit bounds
    try {
      const b = STATE.polygonLayer.getBounds();
      if (b.isValid()) STATE.map.fitBounds(b, { padding: [20, 20] });
    } catch {}

    $("#map-warning").textContent = STATE.polygonsApproximate
      ? "⚠️ Using approximate generated lot shapes — replace public/data/lots.geojson with real polygons before issuing contractor PDF."
      : "";

    setTimeout(() => STATE.map.invalidateSize(), 100);
  }

  function renderWarnings() {
    const el = $("#warnings");
    el.innerHTML = "";
    for (const w of STATE.warnings) {
      const div = document.createElement("div");
      div.className = "warning" + (w.level === "error" ? " error" : "");
      div.textContent = w.text;
      el.appendChild(div);
    }
  }

  // -----------------------------
  // Pricing controls
  // -----------------------------
  function renderPricingControls() {
    const container = $("#pricing-controls");
    container.innerHTML = "";
    for (const def of PRICING_KEYS) {
      const value = STATE.pricing[def.key] ?? 0;
      const row = document.createElement("div");
      row.className = "price-row";
      row.innerHTML = `
        <label for="price-${def.key}">${def.label}</label>
        <div class="price-controls">
          <input type="range" id="price-${def.key}-range" min="${def.min}" max="${def.max}" step="${def.step}" value="${value}" />
          <input type="number" id="price-${def.key}" min="0" step="1" value="${value}" />
        </div>`;
      container.appendChild(row);
      const range = row.querySelector(`#price-${def.key}-range`);
      const num = row.querySelector(`#price-${def.key}`);
      const onChange = (v) => {
        const n = parseFloat(v) || 0;
        STATE.pricing[def.key] = n;
        range.value = n;
        num.value = n;
        saveStorage("pricing", STATE.pricing);
        computeManifest();
        render();
      };
      range.addEventListener("input", e => onChange(e.target.value));
      num.addEventListener("input", e => onChange(e.target.value));
    }
  }

  // -----------------------------
  // Built houses editor
  // -----------------------------
  function renderBuiltHousesEditor() {
    $("#built-houses").value = STATE.builtHouses.join("\n");
  }

  // -----------------------------
  // Export
  // -----------------------------
  function downloadFile(filename, content, type) {
    const blob = new Blob([content], { type: type || "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
  }

  function exportContractorCsv() {
    const headers = ["Action", "Lot Key", "Address", "Mowing Class", "Price", "Payable", "Notes"];
    const rows = [headers];
    const sorted = [...STATE.manifest].sort((a, b) =>
      a.section - b.section || a.block - b.block || a.lot - b.lot);
    for (const m of sorted) {
      rows.push([
        m.contractor_label,
        m.lot_key,
        m.address,
        CLASS_LABELS[m.mowing_class] || m.mowing_class,
        m.price,
        m.payable,
        m.notes,
      ]);
    }
    const csv = rows.map(r => r.map(csvCell).join(",")).join("\n");
    downloadFile("mowing-manifest.csv", csv, "text/csv");
  }

  function exportManifestJson() {
    const payload = {
      generated: new Date().toISOString(),
      pricing: STATE.pricing,
      builtHouses: STATE.builtHouses,
      manifest: STATE.manifest.map(m => ({
        lot_key: m.lot_key,
        address: m.address,
        action: m.action,
        contractor_label: m.contractor_label,
        mowing_class: m.mowing_class,
        price: m.price,
        payable: m.payable,
        notes: m.notes,
      })),
    };
    downloadFile("mowing-manifest.json", JSON.stringify(payload, null, 2), "application/json");
  }

  function csvCell(value) {
    const s = value == null ? "" : String(value);
    if (/[,"\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  // -----------------------------
  // Print
  // -----------------------------
  function printManifest() {
    document.body.classList.add("print-mode");
    if (STATE.map) STATE.map.invalidateSize();
    setTimeout(() => window.print(), 250);
  }
  window.addEventListener("afterprint", () => {
    document.body.classList.remove("print-mode");
  });

  // -----------------------------
  // Wiring
  // -----------------------------
  function wireEvents() {
    $("#csv-input").addEventListener("change", e => {
      const file = e.target.files?.[0];
      if (file) handleCsvFile(file);
    });

    $("#csv-members-input").addEventListener("change", e => {
      const file = e.target.files?.[0];
      if (file) handleMembersFile(file);
    });

    $("#save-houses").addEventListener("click", () => {
      const text = $("#built-houses").value;
      STATE.builtHouses = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      saveStorage("builtHouses", STATE.builtHouses);
      computeManifest();
      render();
    });

    $("#reset-houses").addEventListener("click", () => {
      STATE.builtHouses = [...(STATE.config?.builtHouseAddresses || [])];
      saveStorage("builtHouses", STATE.builtHouses);
      renderBuiltHousesEditor();
      computeManifest();
      render();
    });

    $("#reset-pricing").addEventListener("click", () => {
      STATE.pricing = { ...(STATE.config?.pricingDefaults || {}) };
      saveStorage("pricing", STATE.pricing);
      renderPricingControls();
      computeManifest();
      render();
    });

    $("#btn-print").addEventListener("click", printManifest);
    $("#btn-export-csv").addEventListener("click", exportContractorCsv);
    $("#btn-export-json").addEventListener("click", exportManifestJson);
  }

  // -----------------------------
  // Bootstrap
  // -----------------------------
  async function init() {
    wireEvents();
    const ok = await loadAll();
    renderPricingControls();
    renderBuiltHousesEditor();
    if (ok) {
      computeManifest();
      render();
    } else {
      renderWarnings();
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
