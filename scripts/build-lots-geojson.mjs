#!/usr/bin/env node
/**
 * Build public/data/lots.geojson by:
 *   1. Fetching the canonical PLAT-HATCH-LOTS-S{1,2}.geojson polygons
 *      from lagobello.github.io/lagobello-drawings (EPSG:3857)
 *   2. Reprojecting to WGS84
 *   3. Matching each polygon to a lot in lots.json via point-in-polygon
 *   4. Writing a combined file with lot_key/address/section/block/lot
 *
 * Re-run any time the upstream polygons or lots.json changes.
 *
 * Usage:  node scripts/build-lots-geojson.mjs
 */
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "..", "public", "data", "lots.geojson");

const SOURCES = [
  { section: 1, url: "https://lagobello.github.io/lagobello-drawings/web/PLAT-HATCH-LOTS-S1.geojson" },
  { section: 2, url: "https://lagobello.github.io/lagobello-drawings/web/PLAT-HATCH-LOTS-S2.geojson" },
];
const LOTS_JSON_URL = "https://www.lagobello.com/data/lots.json";

// EPSG:3857 → WGS84
function mercToLngLat([x, y]) {
  const lng = (x / 20037508.34) * 180;
  let lat = (y / 20037508.34) * 180;
  lat = (180 / Math.PI) * (2 * Math.atan(Math.exp((lat * Math.PI) / 180)) - Math.PI / 2);
  return [lng, lat];
}

// Convert all coordinates in a geometry recursively
function reprojectGeom(geom) {
  const reproj = (rings) => rings.map((ring) => ring.map(mercToLngLat));
  if (geom.type === "Polygon") {
    return { type: "Polygon", coordinates: reproj(geom.coordinates) };
  }
  if (geom.type === "MultiPolygon") {
    return {
      type: "MultiPolygon",
      coordinates: geom.coordinates.map((poly) => reproj(poly)),
    };
  }
  throw new Error("Unsupported geometry type: " + geom.type);
}

// Ray-casting point-in-polygon (a polygon = array of rings, ring 0 outer, rest holes)
function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
function pointInPolygon(pt, polygon) {
  if (!pointInRing(pt, polygon[0])) return false;
  for (let h = 1; h < polygon.length; h++) {
    if (pointInRing(pt, polygon[h])) return false;
  }
  return true;
}
function pointInGeom(pt, geom) {
  if (geom.type === "Polygon") return pointInPolygon(pt, geom.coordinates);
  if (geom.type === "MultiPolygon")
    return geom.coordinates.some((poly) => pointInPolygon(pt, poly));
  return false;
}

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Fetch failed: ${url} → ${r.status}`);
  return r.json();
}

async function main() {
  console.log("Fetching lot points from", LOTS_JSON_URL);
  const lots = (await fetchJson(LOTS_JSON_URL))
    .filter((l) => l.Subdivision === "Section 1" || l.Subdivision === "Section 2")
    .map((l) => {
      const sec = parseInt(String(l.Subdivision).replace(/[^0-9]/g, ""), 10);
      const block = Math.round(l["Block Number"]);
      const lot = Math.round(l["Lot Number"]);
      const [lat, lng] = String(l.Location).split(",").map((s) => parseFloat(s.trim()));
      return {
        lot_key: `S${sec}-B${block}-L${lot}`,
        address: l.Name,
        section: sec,
        block,
        lot,
        lat,
        lng,
      };
    });
  console.log(`  ${lots.length} lots`);

  const outFeatures = [];
  const claimed = new Set();
  let unmatched = 0;

  for (const src of SOURCES) {
    console.log("Fetching", src.url);
    const fc = await fetchJson(src.url);
    console.log(`  ${fc.features.length} polygons`);
    const sectionLots = lots.filter((l) => l.section === src.section);

    for (const feature of fc.features) {
      const geom = reprojectGeom(feature.geometry);
      // Find the unique lot point inside this polygon
      const candidates = sectionLots.filter(
        (l) => !claimed.has(l.lot_key) && pointInGeom([l.lng, l.lat], geom)
      );
      if (candidates.length === 1) {
        const m = candidates[0];
        claimed.add(m.lot_key);
        outFeatures.push({
          type: "Feature",
          properties: {
            section: m.section,
            block: m.block,
            lot: m.lot,
            address: m.address,
            lot_key: m.lot_key,
          },
          geometry: geom,
        });
      } else if (candidates.length > 1) {
        console.warn(`  ! polygon contains multiple lots: ${candidates.map((c) => c.lot_key).join(", ")}`);
        unmatched++;
      } else {
        console.warn(`  ! polygon contains no lot point (handle ${feature.properties?.EntityHandle})`);
        unmatched++;
      }
    }
  }

  console.log(`Matched ${outFeatures.length}/${lots.length} lots; ${unmatched} polygons unmatched.`);
  const missing = lots.filter((l) => !claimed.has(l.lot_key));
  if (missing.length) {
    console.warn("Lots without polygons:", missing.map((m) => m.lot_key).join(", "));
  }

  const out = { type: "FeatureCollection", features: outFeatures };
  writeFileSync(OUT, JSON.stringify(out));
  console.log("Wrote", OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
