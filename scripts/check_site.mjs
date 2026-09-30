import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const required = [
  "index.html",
  "app.js",
  "styles.css",
  "data/desktop-impact-data.json",
  "vendor/react.production.min.js",
  "vendor/react-dom.production.min.js",
  "vendor/leaflet.js",
  "vendor/leaflet.css",
];

for (const relativePath of required) {
  await fs.access(path.join(DIST, relativePath));
}

const app = await fs.readFile(path.join(DIST, "app.js"), "utf8");
if (app.includes("Método e dados") || app.includes('active === "metodo"')) {
  throw new Error("A pagina Metodo e dados ainda esta acessivel no build.");
}

const dataText = await fs.readFile(
  path.join(DIST, "data", "desktop-impact-data.json"),
  "utf8",
);
if (/\b[A-Z]:\\/i.test(dataText)) {
  throw new Error("O build contem caminho local absoluto do Windows.");
}

const data = JSON.parse(dataText);
const expected = {
  desktop_cidades: 173,
  aa_lojas: 183,
  vivo_cidades: 154,
};

for (const [field, value] of Object.entries(expected)) {
  if (data.summary?.[field] !== value) {
    throw new Error(`Validacao falhou para ${field}: ${data.summary?.[field]}`);
  }
}

console.log("Check concluido: arquivos, navegacao, privacidade de caminhos e totais principais OK.");
