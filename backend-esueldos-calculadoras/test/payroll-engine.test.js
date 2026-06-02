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

test("aplica deducciones y contribuciones propias de un convenio generico", () => {
  const catalog = {
    constants: {},
    conventions: {
      custom: {
        id: "custom",
        name: "Convenio generico de prueba",
        calculationMode: "generic-v1",
        categories: [{ id: "administrativo", label: "Administrativo", monthly: 100000 }],
        zones: [{ id: "general", label: "General", coef: 1 }],
        liquidationModel: {
          rules: {
            salaryType: "monthly",
            seniority: { enabled: false },
            nonRemunerativeScale: { enabled: false }
          },
          deductions: [
            { id: "aporte-convenio", label: "Aporte convenio 2%", percent: 2, base: "remunerative" },
            { id: "aporte-fijo", label: "Aporte fijo por periodo", amountByPeriod: { may26: 500 } }
          ],
          retentions: [
            { id: "embargo", label: "Retencion embargo 1%", percent: 1, base: "remunerative", defaultValue: true }
          ],
          employerContributions: [
            { id: "contribucion-empleador", label: "Contribucion empleador 1%", percent: 1, base: "gross" }
          ]
        }
      }
    }
  };
  const payload = {
    conventionId: "custom",
    period: "may26",
    categoryId: "administrativo",
    zoneId: "general",
    employee: {
      name: "Trabajadora generica",
      entryDate: "2026-01-01"
    },
    inputs: {}
  };

  const result = calculatePayroll({ catalog, payload });

  assert.equal(result.totals.gross, 100000);
  assert.equal(result.totals.deductions, 3500);
  assert.equal(result.totals.employerContribs, 1000);
  assert.equal(result.totals.net, 96500);
  assert.deepEqual(result.deductions.map((row) => row.label), ["Aporte convenio 2%", "Aporte fijo por periodo", "Retencion embargo 1%"]);
  assert.deepEqual(result.employer.map((row) => row.label), ["Contribucion empleador 1%"]);

  const withoutPercentDeduction = calculatePayroll({
    catalog,
    payload: { ...payload, inputs: { "gen_deduction_aporte-convenio": false } }
  });
  assert.equal(withoutPercentDeduction.totals.deductions, 1500);
  assert.deepEqual(withoutPercentDeduction.deductions.map((row) => row.label), ["Aporte fijo por periodo", "Retencion embargo 1%"]);

  const withoutRetention = calculatePayroll({
    catalog,
    payload: { ...payload, inputs: { "gen_retention_embargo": false } }
  });
  assert.equal(withoutRetention.totals.deductions, 2500);
  assert.deepEqual(withoutRetention.deductions.map((row) => row.label), ["Aporte convenio 2%", "Aporte fijo por periodo"]);
});

test("aplica coeficiente derivado cuando la escala aprobada trae una fila general", () => {
  const convention = {
    id: "custom-zones",
    name: "Convenio generico con zonas",
    calculationMode: "generic-v1",
    categories: [{ id: "administrativo", label: "Administrativo", monthly: 100000 }],
    zones: [
      { id: "general", label: "General", coef: 1 },
      { id: "patagonica", label: "Patagonica", coef: 1.2 }
    ],
    liquidationModel: {
      rules: {
        salaryType: "monthly",
        seniority: { enabled: false },
        nonRemunerativeScale: { enabled: false }
      },
      concepts: [],
      deductions: [],
      retentions: [],
      employerContributions: []
    }
  };
  const catalog = { constants: {}, conventions: { [convention.id]: convention } };
  const payload = {
    conventionId: convention.id,
    period: "2026-06",
    categoryId: "administrativo",
    zoneId: "patagonica",
    employee: { name: "Trabajadora generica", entryDate: "2026-01-01" },
    inputs: {}
  };
  const generalScale = {
    parsedScale: {
      categories: [{ id: "administrativo", label: "Administrativo", zone: "general", monthly: 100000 }]
    }
  };
  const specificScale = {
    parsedScale: {
      categories: [{ id: "administrativo", label: "Administrativo", zone: "patagonica", monthly: 130000 }]
    }
  };

  const fromGeneral = calculatePayroll({ catalog, payload, activeScale: generalScale });
  const fromSpecific = calculatePayroll({ catalog, payload, activeScale: specificScale });

  assert.equal(fromGeneral.remunerative.find((row) => row.label === "Basico").amount, 120000);
  assert.equal(fromSpecific.remunerative.find((row) => row.label === "Basico").amount, 130000);
});

test("liquida antiguedad y presentismo no remunerativos como reglas independientes", () => {
  const convention = {
    id: "custom-no-rem",
    name: "Convenio generico con no remunerativos",
    calculationMode: "generic-v1",
    categories: [{ id: "administrativo", label: "Administrativo", monthly: 100000, nonRem: { "2026-06": 10000 } }],
    zones: [{ id: "general", label: "General", coef: 1 }],
    liquidationModel: {
      rules: {
        salaryType: "monthly",
        seniority: { enabled: false },
        presentism: { enabled: false },
        nonRemunerativeScale: {
          enabled: true,
          seniorityEnabled: true,
          seniorityPercentPerYear: 1,
          presentismEnabled: true,
          presentismPercent: 10,
          presentismRequiresNoUnjustifiedAbsence: true
        }
      },
      concepts: [],
      deductions: [],
      retentions: [],
      employerContributions: []
    }
  };
  const result = calculatePayroll({
    catalog: { constants: {}, conventions: { [convention.id]: convention } },
    payload: {
      conventionId: convention.id,
      period: "2026-06",
      categoryId: "administrativo",
      zoneId: "general",
      employee: { name: "Trabajadora generica", entryDate: "2021-01-01" },
      inputs: {}
    }
  });
  const years = result.employee.years;
  const seniority = 10000 * (years / 100);

  assert.deepEqual(result.nonRemunerative.map((row) => row.label), [
    "Suma no remunerativa escala",
    "Antiguedad no remunerativa",
    "Presentismo no remunerativo"
  ]);
  assert.equal(result.nonRemunerative.find((row) => row.label === "Antiguedad no remunerativa").amount, seniority);
  assert.equal(result.nonRemunerative.find((row) => row.label === "Presentismo no remunerativo").amount, (10000 + seniority) * 0.1);
});

test("usa reglas no remunerativas de la escala vigente sin exigir una reaprobacion", () => {
  const convention = {
    id: "custom-active-scale-no-rem",
    name: "Convenio generico con reglas NR en escala",
    calculationMode: "generic-v1",
    categories: [{ id: "administrativo", label: "Administrativo", monthly: 100000 }],
    zones: [{ id: "general", label: "General", coef: 1 }],
    liquidationModel: {
      rules: {
        salaryType: "monthly",
        seniority: { enabled: false },
        presentism: { enabled: false },
        nonRemunerativeScale: { enabled: true }
      },
      concepts: [],
      deductions: [],
      retentions: [],
      employerContributions: []
    }
  };
  const result = calculatePayroll({
    catalog: { constants: {}, conventions: { [convention.id]: convention } },
    activeScale: {
      parsedScale: {
        categories: [{ id: "administrativo", label: "Administrativo", monthly: 100000, nonRemunerative: 10000 }],
        nonRemunerativeRules: {
          seniorityPercentPerYear: 1,
          presentismPercent: 10
        }
      }
    },
    payload: {
      conventionId: convention.id,
      period: "2026-06",
      categoryId: "administrativo",
      zoneId: "general",
      employee: { name: "Trabajadora generica", entryDate: "2021-01-01" },
      inputs: {}
    }
  });

  assert.deepEqual(result.nonRemunerative.map((row) => row.label), [
    "Suma no remunerativa escala",
    "Antiguedad no remunerativa",
    "Presentismo no remunerativo"
  ]);
});
