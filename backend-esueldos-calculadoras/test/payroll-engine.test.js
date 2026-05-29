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

function afaPayload(categoryId, inputs = {}) {
  return {
    conventionId: "afa_553_09",
    period: "may26",
    categoryId,
    zoneId: "general",
    employee: {
      legajo: "AFA-001",
      name: "Trabajador AFA",
      cuil: "20-00000000-0",
      entryDate: "2021-05-01",
      civilStatus: "soltero"
    },
    inputs: {
      genMonthPct: 100,
      genWorkUnits: 30,
      genSeniority: true,
      genPresentism: true,
      genNonRemScale: true,
      gen_puntualidad: true,
      gen_puntualidad_no_rem: true,
      ...inputs
    }
  };
}

function rowAmount(rows, label) {
  return rows.find((row) => row.label === label)?.amount || 0;
}

test("AFA CCT 553/09 liquida categoria mensual con no remunerativos del periodo", () => {
  const result = calculatePayroll({
    catalog: catalogForEngine(),
    payload: afaPayload("afa553_administrativo_1ra_categoria")
  });

  assert.equal(result.category.salaryType, "monthly");
  assert.equal(rowAmount(result.remunerative, "Basico"), 1636406);
  assert.equal(rowAmount(result.remunerative, "Presentismo"), 245460.9);
  assert.equal(rowAmount(result.remunerative, "Puntualidad"), 163640.6);
  assert.equal(rowAmount(result.nonRemunerative, "Suma no remunerativa escala"), 49092);
  assert.equal(rowAmount(result.nonRemunerative, "Presentismo no remunerativo"), 7363.8);
});

test("AFA CCT 553/09 liquida categorias horarias como hora semanal por 4,33", () => {
  const result = calculatePayroll({
    catalog: catalogForEngine(),
    payload: afaPayload("afa553_profesores_categoria_a", { genWorkUnits: 20 })
  });

  assert.equal(result.category.salaryType, "hourly");
  assert.equal(rowAmount(result.remunerative, "Basico"), 1124241.2);
  assert.equal(rowAmount(result.nonRemunerative, "Suma no remunerativa escala"), 33687.4);
});

test("AFA CCT 553/09 no duplica cuota sindical y contribucion solidaria", () => {
  const result = calculatePayroll({
    catalog: catalogForEngine(),
    payload: afaPayload("afa553_administrativo_1ra_categoria", {
      gen_cuota_sindical_utedyc: true,
      gen_contribucion_solidaria_utedyc: true
    })
  });

  assert.ok(result.deductions.some((row) => row.label.includes("Cuota sindical UTEDYC")));
  assert.equal(result.deductions.some((row) => row.label.includes("Contribucion solidaria UTEDYC")), false);
});

test("AFA CCT 553/09 contempla cobradores por comision con base de referencia", () => {
  const result = calculatePayroll({
    catalog: catalogForEngine(),
    payload: afaPayload("afa553_cobradores_cobrador", {
      genWorkUnits: 0,
      gen_comision_cobrador: 2000000,
      gen_puntualidad: false,
      gen_puntualidad_no_rem: false,
      genNonRemScale: false
    })
  });

  assert.equal(result.category.salaryType, "commission");
  assert.equal(rowAmount(result.remunerative, "Comision cobrador informada"), 2000000);
  assert.equal(rowAmount(result.remunerative, "Antiguedad"), 158948.7);
});
