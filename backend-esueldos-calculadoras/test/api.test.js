const test = require("node:test");
const assert = require("node:assert/strict");
const { app, mergeConventionNonRemunerativeRules, mergeConventionZones, setDbForTest } = require("../src/server");
const { loadCatalogFromBackend, normalizeCatalog } = require("../src/catalog-loader");
const fixtures = require("./fixtures/liquidation-payloads");

function fakeCursor(rows) {
  return {
    sort() { return this; },
    limit() { return this; },
    async toArray() { return rows; },
    async next() { return rows[0] || null; }
  };
}

function fakeDb() {
  const catalog = normalizeCatalog(loadCatalogFromBackend());
  const collections = {
    constants: [{ _id: "global", ...catalog.constants }],
    conventions: catalog.conventions.map((item, index) => ({ _id: item.id, order: index + 1, ...item })),
    legalReferences: catalog.legalReferences.map((item, index) => ({ ...item, order: index + 1 })),
    salaryScales: []
  };
  return {
    databaseName: "test",
    async command() {
      return { ok: 1 };
    },
    collection(name) {
      const rows = collections[name] || [];
      return {
        async findOne(filter = {}) {
          if (name === "constants") return rows[0] || null;
          if (filter.id) return rows.find((item) => item.id === filter.id) || null;
          return rows[0] || null;
        },
        find() {
          return fakeCursor(rows);
        }
      };
    }
  };
}

async function withServer(run) {
  setDbForTest(fakeDb());
  const server = app.listen(0);
  try {
    const port = server.address().port;
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("GET /api/health responde ok", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
  });
});

test("POST /api/liquidations/calculate calcula desde API", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/liquidations/calculate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fixtures.camionerosBasic)
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.conventionId, "camioneros");
    assert.ok(payload.totals.gross > 0);
  });
});

test("sincroniza zonas aprobadas de escala y canoniza Base como General", () => {
  const zones = mergeConventionZones(
    [{ id: "patagonica", label: "Patagonica", coef: 1.2 }],
    [{ id: "base", label: "Base" }, { id: "austral", label: "Austral", coefficient: 1.4 }]
  );
  assert.deepEqual(zones, [
    { id: "patagonica", label: "Patagonica", coef: 1.2 },
    { id: "general", label: "General", coef: 1 },
    { id: "austral", label: "Austral", coef: 1.4 }
  ]);
});

test("sincroniza reglas no remunerativas detectadas en una escala aprobada", () => {
  const rules = mergeConventionNonRemunerativeRules(
    { enabled: true, subjectToHealthInsurance: true, legalReferences: ["CCT"] },
    {
      seniorityEnabled: true,
      seniorityPercentPerYear: 1,
      presentismEnabled: true,
      presentismPercent: 8.33,
      legalReferences: ["Acta salarial"]
    }
  );
  assert.deepEqual(rules, {
    enabled: true,
    subjectToHealthInsurance: true,
    legalReferences: ["CCT", "Acta salarial"],
    seniorityEnabled: true,
    seniorityPercentPerYear: 1,
    presentismEnabled: true,
    presentismPercent: 8.33
  });
});
