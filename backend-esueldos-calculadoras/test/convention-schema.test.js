const test = require("node:test");
const assert = require("node:assert/strict");
const { loadCatalogFromBackend, normalizeCatalog } = require("../src/catalog-loader");
const { legacyConventionSchema: conventionSchema } = require("../src/domain/schemas");

test("todos los convenios del catalogo cumplen el schema declarativo", () => {
  const catalog = normalizeCatalog(loadCatalogFromBackend());
  for (const convention of catalog.conventions) {
    const parsed = conventionSchema.safeParse(convention);
    assert.equal(parsed.success, true, `${convention.id}: ${parsed.error?.message || ""}`);
  }
});

test("rechaza categorias con periodos inexistentes", () => {
  const catalog = normalizeCatalog(loadCatalogFromBackend());
  const convention = structuredClone(catalog.conventions.find((item) => item.id === "afa_553_09"));
  convention.categories[0].monthlyByPeriod.periodo_invalido = 123;

  const parsed = conventionSchema.safeParse(convention);
  assert.equal(parsed.success, false);
  assert.match(parsed.error.issues.map((issue) => issue.message).join("\n"), /periodo de escala/i);
});
