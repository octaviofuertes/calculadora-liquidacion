const test = require("node:test");
const assert = require("node:assert/strict");
const { loadCatalogFromBackend, normalizeCatalog } = require("../src/catalog-loader");
const { calculatePayroll } = require("../src/domain/payroll-engine");
const { liquidationResultSchema } = require("../src/domain/schemas");
const fixtures = require("./fixtures/liquidation-payloads");

function catalogForEngine() {
  const normalized = normalizeCatalog(loadCatalogFromBackend());
  return {
    constants: normalized.constants,
    conventions: Object.fromEntries(normalized.conventions.map((item) => [item.id, item])),
    legalReferences: normalized.legalReferences
  };
}

for (const [name, payload] of Object.entries(fixtures)) {
  test(`calcula liquidacion ${name}`, () => {
    const result = calculatePayroll({ catalog: catalogForEngine(), payload });
    const parsed = liquidationResultSchema.safeParse(result);
    assert.equal(parsed.success, true, parsed.error?.message);
    assert.equal(result.conventionId, payload.conventionId);
    assert.ok(result.totals.gross > 0);
    assert.ok(result.totals.employerCost >= result.totals.gross);
    assert.ok(result.remunerative.length > 0);
  });
}
