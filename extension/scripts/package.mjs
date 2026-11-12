// Pakkaa dist/-kansion asennettavaksi .xpi-paketiksi repon juureen:
//   postituomari-<versio>.xpi
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve, sep } from "node:path";
import { zipSync } from "fflate";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const manifestPath = join(dist, "manifest.json");

if (!existsSync(manifestPath)) {
  console.error("❌ dist/manifest.json puuttuu – aja ensin npm run build");
  process.exit(1);
}

const { version } = JSON.parse(readFileSync(manifestPath, "utf8"));

// Kerätään kaikki tiedostot; manifest.json paketin juureen
function collect(dir, files = {}) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      collect(full, files);
    } else if (!name.endsWith(".map")) {
      files[relative(dist, full).split(sep).join("/")] = readFileSync(full);
    }
  }
  return files;
}

const files = collect(dist);
const xpi = zipSync(files, { level: 9 });
const out = resolve(root, "..", `postituomari-${version}.xpi`);
writeFileSync(out, xpi);

console.log(`📦 ${relative(resolve(root, ".."), out)} (${Object.keys(files).length} tiedostoa, ${(xpi.length / 1024).toFixed(1)} kt)`);
