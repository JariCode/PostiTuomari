// Rakentaa laajennuksen kansioon dist/.
//   node scripts/build.mjs          → kertarakennus
//   node scripts/build.mjs --watch  → rakentaa uudelleen aina kun lähdekoodi muuttuu
//
// Kaksi erillistä Vite-buildia:
//   1. Sivut (asetukset ja popup, React) → ES-moduulit, public/ kopioidaan mukaan
//   2. Taustaskripti → yksi bundlattu IIFE-tiedosto background.js (ei importteja),
//      joten se toimii Thunderbird 128+:n MV3:ssa ilman "type": "module" -asetusta.
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { rmSync, mkdirSync, existsSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const watch = process.argv.includes("--watch");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const common = {
  configFile: false,
  logLevel: "info",
  build: {
    outDir: dist,
    emptyOutDir: false,
    target: "firefox128",
    sourcemap: watch ? "inline" : false,
    chunkSizeWarningLimit: 2000, // inline-sourcemapit kasvattavat dev-buildia
    watch: watch ? {} : null,
  },
};

const pages = {
  ...common,
  root: resolve(root, "src"),
  base: "./",
  publicDir: resolve(root, "public"),
  plugins: [react()],
  build: {
    ...common.build,
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        options: resolve(root, "src/options/index.html"),
        popup: resolve(root, "src/popup/index.html"),
      },
      output: {
        // Kiinteät nimet ilman hashia: watch-tilassa vanhat tiedostot korvautuvat eivätkä kasaannu
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
        // Riippuvuudet (React) omaan tiedostoonsa selkeämmällä nimellä
        manualChunks: (id) => (id.includes("node_modules") ? "vendor" : undefined),
      },
    },
  },
};

const background = {
  ...common,
  root,
  publicDir: false,
  define: { "process.env.NODE_ENV": JSON.stringify(watch ? "development" : "production") },
  build: {
    ...common.build,
    minify: false,
    lib: {
      entry: resolve(root, "src/background/index.js"),
      formats: ["iife"],
      name: "PostiTuomariBackground",
      fileName: () => "background.js",
    },
  },
};

await build(pages);
await build(background);

// Väliaikainen (poistuu vaiheessa 2): omat säännöt kopioidaan distiin, jos tiedosto on olemassa.
// dist/ on .gitignoressa, joten kopio ei päädy Gittiin.
const localRules = resolve(root, "rules.local.js");
if (existsSync(localRules)) {
  copyFileSync(localRules, resolve(dist, "rules.local.js"));
} else {
  console.warn("⚠️ rules.local.js puuttuu – kopioi rules.local.example.js ja täytä omilla tiedoilla");
}

if (watch) console.log("👀 Seurataan muutoksia – dist/ päivittyy automaattisesti");
