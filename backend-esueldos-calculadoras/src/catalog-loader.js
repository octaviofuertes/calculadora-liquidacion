const fs = require("fs");
const path = require("path");
const vm = require("vm");

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
  loadCatalogFromFrontend,
  normalizeCatalog
};
