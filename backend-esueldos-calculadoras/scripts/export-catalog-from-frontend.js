const fs = require("fs");
const path = require("path");
const { loadCatalogFromFrontend, normalizeCatalog } = require("../src/catalog-loader");

const outDir = path.resolve(__dirname, "../src/catalog");
const conventionsDir = path.join(outDir, "conventions");
const catalog = normalizeCatalog(loadCatalogFromFrontend());

fs.mkdirSync(conventionsDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "constants.json"), `${JSON.stringify(catalog.constants, null, 2)}\n`);
fs.writeFileSync(path.join(outDir, "legal-references.json"), `${JSON.stringify(catalog.legalReferences, null, 2)}\n`);

for (const convention of catalog.conventions) {
  fs.writeFileSync(path.join(conventionsDir, `${convention.id}.json`), `${JSON.stringify(convention, null, 2)}\n`);
}

console.log(`Catalogo exportado: ${catalog.conventions.length} convenios.`);
