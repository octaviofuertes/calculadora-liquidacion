const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ConventionNormalizer,
  normalizeZones,
  normalizeBranches,
  removeFakeCategories,
  removeEmptyCategories,
  resolveOrphanLetters,
  propagateHeaders,
  mergeDuplicates,
  mergeCategoriesByZoneOnly,
  validateSalaries,
  validateCategories,
  DEFAULT_CONFIG
} = require("../src/convention-normalizer");

function category(name, extra = {}) {
  return { categoria_id: extra.categoria_id || name.toLowerCase().replace(/\s+/g, "-"), categoria_nombre: name, ...extra };
}

test("rule 1 extracts zone from category name", () => {
  const fixes = [];
  const [result] = normalizeZones([category("Administrativo A Zona Norte")], fixes, DEFAULT_CONFIG);
  assert.equal(result.categoria_nombre, "Administrativo A");
  assert.equal(result.zona, "Norte");
  assert.equal(fixes[0].type, "zone_extracted");
});

test("rule 2 extracts branch from category name", () => {
  const fixes = [];
  const [result] = normalizeBranches([category("Auxiliar Administrativa")], fixes, DEFAULT_CONFIG);
  assert.equal(result.categoria_nombre, "Auxiliar");
  assert.equal(result.rama, "Administrativa");
});

test("rule 4 removes fake header categories", () => {
  const fixes = [];
  const warnings = [];
  const result = removeFakeCategories(
    [category("ESCALA SALARIAL"), category("Oficial")],
    fixes,
    warnings,
    DEFAULT_CONFIG
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].categoria_nombre, "Oficial");
});

test("rule 5 removes empty categories", () => {
  const fixes = [];
  const result = removeEmptyCategories([category("-"), category("Chofer")], fixes);
  assert.equal(result.length, 1);
  assert.equal(result[0].categoria_nombre, "Chofer");
});

test("rule 11 resolves orphan letters using previous header", () => {
  const fixes = [];
  const result = resolveOrphanLetters(
    [category("Administrativos"), category("A"), category("B")],
    fixes,
    DEFAULT_CONFIG
  );
  assert.equal(result.length, 2);
  assert.equal(result[0].grupo_nombre, "Administrativos");
  assert.equal(result[0].categoria_nombre, "A");
});

test("rule 12 propagates branch headers", () => {
  const fixes = [];
  const result = propagateHeaders(
    [category("Rama Produccion"), category("Oficial")],
    fixes,
    DEFAULT_CONFIG
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].rama, "Produccion");
});

test("rules 3 and 13 merge duplicate categories", () => {
  const fixes = [];
  const warnings = [];
  const convention = { escalas: [] };
  const merged = mergeDuplicates(
    convention,
    [
      category("Chofer", { rama: "Logistica", zona: "Norte", mensual: 1000, categoria_id: "c1" }),
      category("Chofer", { rama: "Logistica", zona: "Norte", mensual: 1100, categoria_id: "c2" })
    ],
    fixes,
    warnings
  );
  assert.equal(merged.length, 1);
  assert.equal(warnings.some((item) => item.type === "duplicate_category"), true);
});

test("rule 9 merges categories duplicated only by zone", () => {
  const fixes = [];
  const warnings = [];
  const convention = { escalas: [] };
  const merged = mergeCategoriesByZoneOnly(
    convention,
    [
      category("Chofer", { zona: "Norte", categoria_id: "c1" }),
      category("Chofer", { zona: "Sur", categoria_id: "c2" })
    ],
    fixes,
    warnings
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].zona, "");
});

test("rule 7 warns about salaries without category", () => {
  const warnings = [];
  validateSalaries({
    escalas: [{ valores: [{ valor: 1000, concepto_id: "SUELDO_BASICO" }] }]
  }, warnings);
  assert.equal(warnings[0].type, "salary_without_category");
});

test("rule 8 warns about categories without basic salary", () => {
  const warnings = [];
  validateCategories({ escalas: [] }, [category("SinBasico")], warnings);
  assert.equal(warnings[0].type, "category_without_basic");
});

test("ConventionNormalizer applies zone branch and fake fixes", () => {
  const normalizer = new ConventionNormalizer();
  const { convention, fixes } = normalizer.normalize({
    categorias: [
      category("Administrativo A Zona Norte"),
      category("Auxiliar Administrativa"),
      category("ESCALA SALARIAL")
    ],
    escalas: []
  });
  assert.equal(convention.categorias.length, 2);
  assert.ok(fixes.some((item) => item.type === "zone_extracted"));
  assert.ok(fixes.some((item) => item.type === "branch_extracted"));
  assert.ok(fixes.some((item) => item.type === "fake_category_removed" || item.type === "header_propagated"));
});

test("ConventionNormalizer remaps categoria_id when merging duplicates", () => {
  const normalizer = new ConventionNormalizer();
  const { convention } = normalizer.normalize({
    categorias: [
      category("Oficial", { rama: "Produccion", categoria_id: "of-1" }),
      category("Oficial", { rama: "Produccion", categoria_id: "of-2" })
    ],
    escalas: [{
      valores: [
        { categoria_id: "of-2", valor: 2000, concepto_id: "SUELDO_BASICO" }
      ]
    }]
  });
  assert.equal(convention.categorias.length, 1);
  assert.equal(convention.escalas[0].valores[0].categoria_id, "of-1");
});
