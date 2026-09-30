import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const DATA_FILE = "desktop-impact-data.json";
const DESKTOP_STORE_OVERRIDES_FILE = "desktop-store-overrides.json";

async function copy(relativePath) {
  await fs.cp(path.join(ROOT, relativePath), path.join(DIST, relativePath), {
    recursive: true,
  });
}

function fileNameOnly(value) {
  return typeof value === "string" ? path.basename(value.replaceAll("\\", "/")) : value;
}


function isHpKey(key) {
  return /(^|_)hp(?:_|$)/i.test(String(key));
}

function stripHpContent(value) {
  if (Array.isArray(value)) {
    return value
      .filter((item) => !(typeof item === "string" && /\bHP(?:_|\s)/i.test(item)))
      .map(stripHpContent);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !isHpKey(key))
        .map(([key, item]) => [key, stripHpContent(item)]),
    );
  }
  if (typeof value === "string" && /\bHP(?:_|\s)/i.test(value)) return null;
  return value;
}

async function loadDesktopStoreOverrides() {
  try {
    const text = await fs.readFile(
      path.join(ROOT, "data", DESKTOP_STORE_OVERRIDES_FILE),
      "utf8",
    );
    return JSON.parse(text);
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

function applyDesktopStoreOverrides(data, overrides) {
  const storeByIbge = new Map(
    Object.entries(overrides || {}).map(([ibge, stores]) => [
      Number(ibge),
      Number(stores) || 0,
    ]),
  );

  const patchCity = (city) => {
    const stores = storeByIbge.get(Number(city?.ibge));
    if (stores === undefined) return false;
    city.lojas_desktop = stores;
    city.tem_loja_desktop = stores > 0;
    return true;
  };

  for (const city of data.desktopCities || []) patchCity(city);

  for (const rows of Object.values(data.top || {})) {
    for (const city of rows || []) patchCity(city);
  }

  for (const cluster of data.clusterCandidates || []) {
    for (const city of cluster.members || []) patchCity(city);
    cluster.lojas_desktop = (cluster.members || []).reduce(
      (sum, city) => sum + (Number(city.lojas_desktop) || 0),
      0,
    );
  }

  if (data.summary && Array.isArray(data.desktopCities)) {
    data.summary.desktop_lojas = data.desktopCities.reduce(
      (sum, city) => sum + (Number(city.lojas_desktop) || 0),
      0,
    );
    data.summary.desktop_cidades_com_loja = data.desktopCities.filter(
      (city) => Number(city.lojas_desktop) > 0,
    ).length;
  }

  for (const segment of data.coverageSegments || []) {
    segment.lojas_desktop = (data.desktopCities || [])
      .filter((city) => city.status_competitivo === segment.segmento)
      .reduce((sum, city) => sum + (Number(city.lojas_desktop) || 0), 0);
  }

  return [...storeByIbge.keys()].filter((ibge) =>
    (data.desktopCities || []).some((city) => Number(city.ibge) === ibge),
  ).length;
}

await fs.rm(DIST, { recursive: true, force: true });
await fs.mkdir(path.join(DIST, "data"), { recursive: true });

for (const item of ["index.html", "app.js", "styles.css", "vendor"]) {
  await copy(item);
}

let sourceData = JSON.parse(
  await fs.readFile(path.join(ROOT, "data", DATA_FILE), "utf8"),
);
sourceData = stripHpContent(sourceData);

if (sourceData.summary?.source_files) {
  sourceData.summary.source_files = Object.fromEntries(
    Object.entries(sourceData.summary.source_files).map(([key, value]) => [key, fileNameOnly(value)]),
  );
}

const desktopStoreOverrides = await loadDesktopStoreOverrides();
const appliedDesktopStoreOverrides = applyDesktopStoreOverrides(
  sourceData,
  desktopStoreOverrides,
);

await fs.writeFile(
  path.join(DIST, "data", DATA_FILE),
  `${JSON.stringify(sourceData)}\n`,
  "utf8",
);

await fs.writeFile(
  path.join(DIST, "robots.txt"),
  "User-agent: *\nDisallow: /\n",
  "utf8",
);

console.log(`Build concluido: ${DIST}`);
console.log(`Overrides LOJA_DESKTOP aplicados: ${appliedDesktopStoreOverrides}`);
