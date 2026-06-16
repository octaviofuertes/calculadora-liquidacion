const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createConveniosRouter } = require("../src/routes/convenios.routes");
const convenioService = require("../src/services/convenio-service");

function getPath(doc, key) {
  return String(key).split(".").reduce((value, part) => value?.[part], doc);
}

function matches(doc, filter = {}) {
  return Object.entries(filter).every(([key, value]) => getPath(doc, key) === value);
}

function memoryCursor(rows) {
  let current = [...rows];
  return {
    sort(spec = {}) {
      const [[key, direction]] = Object.entries(spec);
      if (key) {
        current.sort((a, b) => String(getPath(a, key) || "").localeCompare(String(getPath(b, key) || "")) * (direction < 0 ? -1 : 1));
      }
      return this;
    },
    limit(count) {
      current = current.slice(0, count);
      return this;
    },
    async toArray() {
      return current;
    }
  };
}

class MemoryCollection {
  constructor() {
    this.rows = [];
    this.indexes = [];
  }

  async createIndex(keys, options = {}) {
    this.indexes.push({ keys, options });
    return Object.keys(keys).join("_");
  }

  async findOne(filter = {}) {
    return this.rows.find((row) => matches(row, filter)) || null;
  }

  find(filter = {}) {
    return memoryCursor(this.rows.filter((row) => matches(row, filter)));
  }

  async insertOne(doc) {
    const convenioId = doc.convenio?.convenio_id || doc.convenio_id || doc.id;
    if (this.rows.some((row) => (row.convenio?.convenio_id || row.convenio_id || row.id) === convenioId)) {
      const error = new Error("duplicate key");
      error.code = 11000;
      throw error;
    }
    const inserted = { _id: convenioId, ...doc };
    this.rows.push(inserted);
    return { insertedId: inserted._id };
  }

  async replaceOne(filter, doc) {
    const index = this.rows.findIndex((row) => matches(row, filter));
    if (index >= 0) this.rows[index] = doc;
    else this.rows.push(doc);
    return { matchedCount: index >= 0 ? 1 : 0, modifiedCount: 1 };
  }

  async updateOne(filter, update) {
    const row = this.rows.find((item) => matches(item, filter));
    if (!row) return { matchedCount: 0, modifiedCount: 0 };
    Object.assign(row, update.$set || {});
    return { matchedCount: 1, modifiedCount: 1 };
  }

  async deleteOne(filter) {
    const before = this.rows.length;
    this.rows = this.rows.filter((row) => !matches(row, filter));
    return { deletedCount: before - this.rows.length };
  }
}

function memoryDb() {
  const collections = {};
  return {
    collection(name) {
      if (!collections[name]) collections[name] = new MemoryCollection();
      return collections[name];
    }
  };
}

function sampleConvenio() {
  return {
    schemaVersion: "esueldos-cct-estructura-excel-v1",
    convenio: {
      convenio_id: "cct-prueba-001",
      tipo_norma: "CCT",
      numero: "001",
      "a\u00f1o": "2026",
      denominacion: "Convenio de prueba",
      actividad: "Actividad de prueba"
    },
    ambitos: [
      { ambito_id: "general", convenio_id: "cct-prueba-001", tipo_ambito: "territorial", descripcion: "General" }
    ],
    categorias: [
      { categoria_id: "cat-a", convenio_id: "cct-prueba-001", grupo_nombre: "Administrativos", categoria_nombre: "Categoria A" }
    ],
    conceptos: [
      { concepto_id: "basico", convenio_id: "cct-prueba-001", codigo: "BAS", nombre: "Basico", tipo_concepto: "HABER", naturaleza: "REMUNERATIVO" }
    ],
    adicionales: [],
    escalas: [
      {
        escala_id: "escala-junio-2026",
        convenio_id: "cct-prueba-001",
        nombre_escala: "Junio 2026",
        tipo_escala: "mensual",
        periodo_desde: "2026-06",
        periodo_hasta: "2026-06",
        moneda: "ARS",
        zona: "general",
        valores: [
          {
            valor_id: "valor-cat-a-basico",
            escala_id: "escala-junio-2026",
            convenio_id: "cct-prueba-001",
            categoria_id: "cat-a",
            concepto_id: "basico",
            unidad_pago: "mensual",
            periodicidad: "mensual",
            valor: 100000,
            moneda: "ARS",
            zona: "general"
          }
        ]
      }
    ]
  };
}

async function withApp(run) {
  const db = memoryDb();
  await convenioService.ensureConvenioIndexes(db);
  const app = express();
  app.use(express.json());
  app.use(createConveniosRouter({ getDb: () => db }));
  app.use((error, req, res, next) => {
    res.status(error.status || 500).json({ error: error.message, details: error.details || [] });
  });
  const server = app.listen(0);
  try {
    await run(`http://127.0.0.1:${server.address().port}`, db);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("API convenios guarda estructura, escala y consultas para calculadora", async () => {
  await withApp(async (baseUrl) => {
    const createResponse = await fetch(`${baseUrl}/api/convenios`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sampleConvenio())
    });
    assert.equal(createResponse.status, 201);
    const created = await createResponse.json();
    assert.equal(created.schemaVersion, "esueldos-cct-estructura-excel-v1");
    assert.equal(created.convenio.convenio_id, "cct-prueba-001");

    const list = await fetch(`${baseUrl}/api/convenios`).then((res) => res.json());
    assert.equal(list.length, 1);

    const categorias = await fetch(`${baseUrl}/api/convenios/cct-prueba-001/categorias`).then((res) => res.json());
    assert.deepEqual(categorias.map((item) => item.categoria_id), ["CAT_A"]);

    const conceptos = await fetch(`${baseUrl}/api/convenios/cct-prueba-001/conceptos`).then((res) => res.json());
    assert.deepEqual(conceptos.map((item) => item.concepto_id), ["SUELDO_BASICO"]);

    const escalaResponse = await fetch(`${baseUrl}/api/convenios/cct-prueba-001/escalas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        escala_id: "escala-julio-2026",
        nombre_escala: "Julio 2026",
        tipo_escala: "mensual",
        periodo_desde: "2026-07",
        periodo_hasta: "2026-07",
        moneda: "ARS",
        valores: [
          {
            valor_id: "valor-cat-a-basico-julio",
            categoria_id: "cat-a",
            concepto_id: "basico",
            unidad_pago: "mensual",
            periodicidad: "mensual",
            valor: 120000,
            moneda: "ARS"
          }
        ]
      })
    });
    assert.equal(escalaResponse.status, 200);

    const valores = await fetch(`${baseUrl}/api/convenios/cct-prueba-001/escala-valores?categoria_id=cat-a`).then((res) => res.json());
    assert.deepEqual(valores.map((item) => item.valor), [100000, 120000]);
  });
});

test("API convenios rechaza ids duplicados dentro del convenio", async () => {
  await withApp(async (baseUrl) => {
    const payload = sampleConvenio();
    payload.categorias.push({ ...payload.categorias[0] });
    const response = await fetch(`${baseUrl}/api/convenios`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    assert.equal(response.status, 400);
    const error = await response.json();
    assert.match(error.error, /Convenio Excel invalido|duplic/);
  });
});
