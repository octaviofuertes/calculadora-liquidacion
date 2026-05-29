const fs = require("fs");
const path = require("path");
const vm = require("vm");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadCatalogFromBackend() {
  const catalogRoot = path.resolve(__dirname, "catalog");
  const conventionsDir = path.join(catalogRoot, "conventions");
  const conventions = {};
  const constants = readJson(path.join(catalogRoot, "constants.json"));
  const legalReferences = readJson(path.join(catalogRoot, "legal-references.json"));

  fs.readdirSync(conventionsDir)
    .filter((fileName) => fileName.endsWith(".json"))
    .sort()
    .forEach((fileName) => {
      const convention = readJson(path.join(conventionsDir, fileName));
      conventions[convention.id] = convention;
    });

  return { constants, conventions, legalReferences };
}

function loadCatalogFromFrontend() {
  const dataPath = path.resolve(__dirname, "../../frontend-esueldos-calculadoras/data.js");
  const source = fs.readFileSync(dataPath, "utf8");
  const sandbox = { window: {} };

  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: dataPath });

  if (!sandbox.window.PAYROLL_DATA) {
    throw new Error("No se encontro window.PAYROLL_DATA en frontend/data.js");
  }

  return sandbox.window.PAYROLL_DATA;
}

function normalizeCatalog(catalog) {
  return {
    constants: catalog.constants,
    conventions: Object.values(catalog.conventions),
    legalReferences: catalog.legalReferences || []
  };
}

module.exports = {
  loadCatalogFromBackend,
  loadCatalogFromFrontend,
  normalizeCatalog
};
