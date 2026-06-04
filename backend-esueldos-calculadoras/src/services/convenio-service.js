const { EXCEL_SCHEMA_VERSION, normalizeConvenio, parseConvenio, parseEscala } = require("../models/convenio.model");
const { normalizePeriod } = require("../repositories/scale-repository");

const COLLECTION = "convenios";

function collection(db) {
  return db.collection(COLLECTION);
}

function serialize(doc) {
  if (!doc) return null;
  const { _id, ...payload } = doc;
  return { mongoId: _id?.toString?.(), ...payload };
}

function notFound() {
  const error = new Error("Convenio no encontrado");
  error.status = 404;
  return error;
}

function numberValue(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value).replace(/\$/g, "").replace(/\./g, "").replace(",", ".").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function matchText(value) {
  return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizeZone(value) {
  const text = matchText(value);
  return !text || ["general", "base", "zona general", "sin adicional"].includes(text) ? "general" : text;
}

async function ensureConvenioIndexes(db) {
  const convenios = collection(db);
  await convenios.createIndex({ "convenio.convenio_id": 1 }, { unique: true, sparse: true });
  await convenios.createIndex({ "convenio.denominacion": 1 });
  await convenios.createIndex({ "convenio.actividad": 1 });
  await convenios.createIndex({ "categorias.categoria_id": 1 });
  await convenios.createIndex({ "conceptos.concepto_id": 1 });
  await convenios.createIndex({ "escalas.escala_id": 1 });
  await convenios.createIndex({ "escalas.valores.categoria_id": 1 });
  await convenios.createIndex({ "escalas.valores.concepto_id": 1 });
}

async function normalizeStoredConvention(db, doc) {
  if (!doc) return null;
  if (doc.schemaVersion === EXCEL_SCHEMA_VERSION && doc.convenio?.convenio_id) return doc;
  const normalized = normalizeConvenio(doc);
  const saved = { _id: doc._id, ...normalized, createdAt: doc.createdAt || new Date(), updatedAt: new Date(), migratedFromLegacy: true };
  await collection(db).replaceOne({ _id: doc._id }, saved);
  return saved;
}

async function findConventionDoc(db, convenioId) {
  return await collection(db).findOne({ "convenio.convenio_id": convenioId })
    || await collection(db).findOne({ convenio_id: convenioId })
    || await collection(db).findOne({ id: convenioId });
}

async function createConvenio(db, payload) {
  const convenio = parseConvenio(payload);
  const convenioId = convenio.convenio.convenio_id;
  const existing = await findConventionDoc(db, convenioId);
  if (existing) {
    const error = new Error("convenio_id ya existe");
    error.status = 409;
    throw error;
  }
  const now = new Date();
  const doc = { ...convenio, createdAt: now, updatedAt: now };
  const result = await collection(db).insertOne(doc);
  return serialize({ _id: result.insertedId, ...doc });
}

async function listConvenios(db, { limit = 100 } = {}) {
  const docs = await collection(db)
    .find({})
    .sort({ "convenio.denominacion": 1, "convenio.convenio_id": 1 })
    .limit(Math.min(Number(limit) || 100, 300))
    .toArray();
  const normalized = [];
  for (const doc of docs) normalized.push(await normalizeStoredConvention(db, doc));
  return normalized.map(serialize);
}

async function getConvenio(db, convenioId) {
  const doc = await findConventionDoc(db, convenioId);
  if (!doc) throw notFound();
  return serialize(await normalizeStoredConvention(db, doc));
}

async function updateConvenio(db, convenioId, payload) {
  const current = await findConventionDoc(db, convenioId);
  if (!current) throw notFound();
  const currentNormalized = await normalizeStoredConvention(db, current);
  const requestedId = payload?.convenio?.convenio_id || payload?.convenio_id || payload?.id;
  if (requestedId && requestedId !== convenioId) {
    const error = new Error("No se puede cambiar convenio_id desde este endpoint");
    error.status = 400;
    throw error;
  }
  const merged = parseConvenio({
    ...currentNormalized,
    ...payload,
    convenio: { ...(currentNormalized.convenio || {}), ...(payload.convenio || payload), convenio_id: convenioId },
    ambitos: payload.ambitos || currentNormalized.ambitos,
    categorias: payload.categorias || currentNormalized.categorias,
    conceptos: payload.conceptos || currentNormalized.conceptos,
    escalas: payload.escalas || currentNormalized.escalas,
    adicionales: payload.adicionales || currentNormalized.adicionales
  });
  const doc = { _id: current._id, ...merged, createdAt: current.createdAt, updatedAt: new Date() };
  await collection(db).replaceOne({ _id: current._id }, doc);
  return serialize(doc);
}

async function deleteConvenio(db, convenioId) {
  const doc = await findConventionDoc(db, convenioId);
  if (!doc) throw notFound();
  const result = await collection(db).deleteOne({ _id: doc._id });
  return { ok: true, deletedConvenioId: convenioId, deletedCount: result.deletedCount };
}

async function saveEscala(db, convenioId, payload) {
  const stored = await findConventionDoc(db, convenioId);
  if (!stored) throw notFound();
  const convenio = await normalizeStoredConvention(db, stored);
  const escala = parseEscala(payload, convenioId);
  const escalas = Array.isArray(convenio.escalas) ? [...convenio.escalas] : [];
  const index = escalas.findIndex((item) => item.escala_id === escala.escala_id);
  if (index >= 0) escalas[index] = escala;
  else escalas.push(escala);
  await collection(db).updateOne({ _id: stored._id }, { $set: { escalas, updatedAt: new Date() } });
  return escala;
}

async function getCategories(db, convenioId) {
  const convenio = await getConvenio(db, convenioId);
  return convenio.categorias || [];
}

async function getConcepts(db, convenioId) {
  const convenio = await getConvenio(db, convenioId);
  return convenio.conceptos || [];
}

async function getPayrollBases(db, convenioId) {
  const convenio = await getConvenio(db, convenioId);
  return { escalas: convenio.escalas || [] };
}

async function getScales(db, convenioId) {
  const convenio = await getConvenio(db, convenioId);
  return convenio.escalas || [];
}

async function getAdditionals(db, convenioId) {
  const convenio = await getConvenio(db, convenioId);
  return convenio.adicionales || [];
}

async function getScaleValues(db, convenioId, filters = {}) {
  const scales = await getScales(db, convenioId);
  return scales
    .flatMap((scale) => (scale.valores || []).map((value) => ({ ...value, escala_id: value.escala_id || scale.escala_id, nombre_escala: scale.nombre_escala || "" })))
    .filter((value) => {
      if (filters.escala_id && value.escala_id !== filters.escala_id) return false;
      if (filters.scaleId && value.escala_id !== filters.scaleId) return false;
      if (filters.categoria_id && value.categoria_id !== filters.categoria_id) return false;
      if (filters.categoryId && value.categoria_id !== filters.categoryId) return false;
      if (filters.concepto_id && value.concepto_id !== filters.concepto_id) return false;
      if (filters.conceptId && value.concepto_id !== filters.conceptId) return false;
      if (filters.zona && value.zona !== filters.zona) return false;
      if (filters.zone && value.zona !== filters.zone) return false;
      return true;
    });
}

function periodOf(scale = {}) {
  return normalizePeriod(scale.periodo_desde) || scale.periodo_desde || "";
}

function selectScale(scales = [], period) {
  const normalizedPeriod = normalizePeriod(period) || period;
  const sorted = [...scales].sort((a, b) => String(periodOf(b)).localeCompare(String(periodOf(a))));
  return sorted.find((scale) => !periodOf(scale) || periodOf(scale) <= normalizedPeriod) || sorted[0] || null;
}

function conceptMap(convenio) {
  return new Map((convenio.conceptos || []).map((concept) => [concept.concepto_id, concept]));
}

function isBasicConcept(concept = {}) {
  return /basico|sueldo basico|salario basico/.test(matchText([concept.concepto_id, concept.codigo, concept.nombre].join(" ")));
}

function conceptKind(concept = {}) {
  const text = matchText([concept.tipo_concepto, concept.naturaleza, concept.nombre].join(" "));
  if (/aporte patronal|contribucion patronal|empleador/.test(text)) return "employer";
  if (/retencion|deduccion|descuento|aporte trabajador|cuota sindical|solidario/.test(text)) return "deduction";
  if (/no remuner/.test(text)) return "nonRemunerative";
  return "remunerative";
}

function conceptToEngine(concept, rowType = conceptKind(concept)) {
  const pct = numberValue(concept.porcentaje);
  const fixed = numberValue(concept.importe_fijo);
  return {
    id: concept.concepto_id,
    label: concept.nombre || concept.codigo || concept.concepto_id,
    rowType,
    calculation: pct ? "percent" : "fixed",
    percent: pct,
    amount: fixed,
    base: matchText(concept.base_calculo || concept.formula_base).includes("basico") ? "basic" : "remunerative",
    defaultValue: rowType !== "deduction",
    detail: concept.condicion || "Concepto del convenio"
  };
}

function buildActiveScale(convenio, scale) {
  if (!scale) return null;
  const concepts = conceptMap(convenio);
  const categories = new Map((convenio.categorias || []).map((category) => [category.categoria_id, category]));
  const rows = new Map();
  (scale.valores || []).forEach((value) => {
    const category = categories.get(value.categoria_id) || { categoria_id: value.categoria_id, categoria_nombre: value.categoria_id };
    const concept = concepts.get(value.concepto_id) || { concepto_id: value.concepto_id, nombre: value.concepto_id };
    const key = `${value.categoria_id}:${normalizeZone(value.zona || scale.zona)}`;
    if (!rows.has(key)) {
      rows.set(key, {
        id: value.categoria_id,
        label: category.categoria_nombre || category.grupo_nombre || value.categoria_id,
        group: category.grupo_nombre || "",
        zone: normalizeZone(value.zona || scale.zona)
      });
    }
    const row = rows.get(key);
    const valueAmount = numberValue(value.valor);
    const unit = matchText(value.unidad_pago || value.periodicidad || value.modalidad);
    if (isBasicConcept(concept) || !value.concepto_id) {
      if (/hora/.test(unit)) row.hourly = valueAmount;
      else if (/dia|jornal/.test(unit)) row.day = valueAmount;
      else row.monthly = valueAmount;
    } else if (conceptKind(concept) === "nonRemunerative") {
      row.nonRemunerative = numberValue(row.nonRemunerative) + valueAmount;
    }
  });
  return {
    id: scale.escala_id,
    conventionId: convenio.convenio.convenio_id,
    period: periodOf(scale),
    periodLabel: scale.nombre_escala || periodOf(scale),
    status: "APROBADA",
    parsedScale: { categories: Array.from(rows.values()), additionals: [], nonRemunerativeRules: {} }
  };
}

function buildPayrollConvention(convenio, period) {
  const concepts = [];
  const deductions = [];
  const retentions = [];
  const employerContributions = [];
  (convenio.conceptos || []).forEach((concept) => {
    if (isBasicConcept(concept)) return;
    const kind = conceptKind(concept);
    if (kind === "employer") employerContributions.push(conceptToEngine(concept, "employer"));
    else if (kind === "deduction" && /retencion/.test(matchText(concept.tipo_concepto))) retentions.push(conceptToEngine(concept, "deduction"));
    else if (kind === "deduction") deductions.push(conceptToEngine(concept, "deduction"));
    else concepts.push(conceptToEngine(concept, kind));
  });
  (convenio.adicionales || []).forEach((additional) => {
    concepts.push(conceptToEngine({
      concepto_id: additional.concepto_id || additional.adicional_id,
      nombre: additional.nombre,
      tipo_concepto: additional.tipo || "ADICIONAL",
      porcentaje: additional.porcentaje,
      importe_fijo: additional.importe,
      base_calculo: additional.base_calculo,
      condicion: additional.condicion
    }, "remunerative"));
  });
  const periods = (convenio.escalas || []).map((scale) => ({
    id: periodOf(scale) || period,
    label: scale.nombre_escala || periodOf(scale) || period,
    validFrom: periodOf(scale) || period
  }));
  return {
    id: convenio.convenio.convenio_id,
    name: convenio.convenio.denominacion,
    shortName: convenio.convenio.numero || convenio.convenio.denominacion,
    source: convenio.convenio.fuente_documento || convenio.convenio.tipo_norma,
    type: "monthly",
    calculationMode: "generic-v1",
    periods: periods.length ? periods : [{ id: period, label: period, validFrom: period }],
    zones: [{ id: "general", label: "General", coef: 1 }],
    categories: (convenio.categorias || []).map((category) => ({
      id: category.categoria_id,
      label: category.categoria_nombre || category.grupo_nombre || category.categoria_id,
      group: category.grupo_nombre || "",
      monthly: 0
    })),
    rules: {},
    liquidationModel: { concepts, deductions, retentions, employerContributions }
  };
}

async function buildPayrollDataForConvenio(db, convenioId, period, baseCatalog = {}) {
  const convenio = await getConvenio(db, convenioId);
  const scale = selectScale(convenio.escalas || [], period);
  const activeScale = buildActiveScale(convenio, scale);
  if (!activeScale?.parsedScale?.categories?.length) {
    const error = new Error("No hay escalas.valores suficientes para calcular este convenio");
    error.status = 400;
    throw error;
  }
  const payrollConvention = buildPayrollConvention(convenio, period);
  return {
    catalog: {
      ...baseCatalog,
      conventions: { ...(baseCatalog.conventions || {}), [payrollConvention.id]: payrollConvention }
    },
    activeScale
  };
}

module.exports = {
  buildPayrollDataForConvenio,
  ensureConvenioIndexes,
  createConvenio,
  deleteConvenio,
  getAdditionals,
  getCategories,
  getCategorias: getCategories,
  getConceptos: getConcepts,
  getConcepts,
  getConvenio,
  getEscalaValores: getScaleValues,
  getEscalas: getScales,
  getPayrollBases,
  getScaleValues,
  getScales,
  listConvenios,
  saveEscala,
  updateConvenio
};
