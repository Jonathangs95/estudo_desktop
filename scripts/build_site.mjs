import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const DATA_FILE = "desktop-impact-data.json";
const PAYLOAD_MANIFEST = path.join(ROOT, "data", "payload", "manifest.json");

async function copy(relativePath) {
  await fs.cp(path.join(ROOT, relativePath), path.join(DIST, relativePath), {
    recursive: true,
  });
}

function fileNameOnly(value) {
  return typeof value === "string" ? path.basename(value.replaceAll("\\", "/")) : value;
}

async function loadSourceData() {
  const manifest = JSON.parse(await fs.readFile(PAYLOAD_MANIFEST, "utf8"));
  const parts = await Promise.all(
    manifest.parts.map((relativePath) =>
      fs.readFile(path.join(ROOT, "data", relativePath), "utf8"),
    ),
  );
  return JSON.parse(parts.join(""));
}

await fs.rm(DIST, { recursive: true, force: true });
await fs.mkdir(path.join(DIST, "data"), { recursive: true });

for (const item of ["index.html", "app.js", "styles.css", "vendor"]) {
  await copy(item);
}

const sourceData = await loadSourceData();

if (sourceData.summary?.source_files) {
  sourceData.summary.source_files = Object.fromEntries(
    Object.entries(sourceData.summary.source_files).map(([key, value]) => [key, fileNameOnly(value)]),
  );
}

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
