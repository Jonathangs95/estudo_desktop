import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const DATA_FILE = "desktop-impact-data.json";

async function copy(relativePath) {
  await fs.cp(path.join(ROOT, relativePath), path.join(DIST, relativePath), {
    recursive: true,
  });
}

function fileNameOnly(value) {
  return typeof value === "string" ? path.basename(value.replaceAll("\\", "/")) : value;
}

await fs.rm(DIST, { recursive: true, force: true });
await fs.mkdir(path.join(DIST, "data"), { recursive: true });

for (const item of ["index.html", "app.js", "styles.css", "vendor"]) {
  await copy(item);
}

const sourceData = JSON.parse(
  await fs.readFile(path.join(ROOT, "data", DATA_FILE), "utf8"),
);

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
