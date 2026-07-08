const { EXCEL_SCHEMA_VERSION, normalizeConvenio, parseConvenio, parseEscala, toRuntimeConvention } = require("../models/convenio.model");
const { normalizePeriod } = require("../repositories/scale-repository");

const COLLECTION = "conventions";

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
  const raw = String(value).trim().replace(/\\s/g, "").replace(/\\$/g, "");
  const lastComma = raw.lastIndexOf(",");
  const lastDot = raw.lastIndexOf(".");
  let cleaned = raw;
  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSep = lastComma > lastDot ? "," : ".";
    const thousandsSep = decimalSep === "," ? "." : ",";
    cleaned = raw.replace(new RegExp(`\\\\${thousandsSep}`, "g"), "").replace(decimalSep, ".");
  } else if (lastComma >= 0) {
    cleaned = /^\\d{1,3}(,\\d{3})+$/.test(raw) ? raw.replace(/,/g, "") : raw.replace(",", ".");
  } else if (lastDot >= 0) {
    cleaned = /^\\d{1,3}(\\.\\d{3})+$/.test(raw) ? raw.replace(/\\./g, "") : raw;
  }
  cleaned = cleaned.replace(/[^0-9.-]/g, "");
  const parsed = Number(cleaned);
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
  const { canonCategoryId, canonConceptId } = require("../models/convenio.model");
  const scales = await getScales(db, convenioId);
  return scales
    .flatMap((scale) => (scale.valores || []).map((value) => ({ ...value, escala_id: value.escala_id || scale.escala_id, nombre_escala: scale.nombre_escala || "" })))
    .filter((value) => {
      if (filters.escala_id && value.escala_id !== filters.escala_id) return false;
      if (filters.scaleId && value.escala_id !== filters.scaleId) return false;
      
      const filterCat = filters.categoria_id || filters.categoryId;
      if (filterCat && value.categoria_id !== canonCategoryId(filterCat)) return false;
      
      const filterConcept = filters.concepto_id || filters.conceptId;
      if (filterConcept && value.concepto_id !== canonConceptId(filterConcept)) return false;
      
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
  return sorted.find((scale) => {
    const from = periodOf(scale);
    const to = normalizePeriod(scale.periodo_hasta) || scale.periodo_hasta || "";
    return (!from || from <= normalizedPeriod) && (!to || to >= normalizedPeriod);
  }) || null;
}

function selectScales(scales = [], period) {
  const normalizedPeriod = normalizePeriod(period) || period;
  return [...scales].filter((scale) => {
    const from = periodOf(scale);
    const to = normalizePeriod(scale.periodo_hasta) || scale.periodo_hasta || "";
    return (!from || from <= normalizedPeriod) && (!to || to >= normalizedPeriod);
  }).sort((a, b) => String(periodOf(b)).localeCompare(String(periodOf(a))));
}

function conceptMap(convenio) {
  return new Map((convenio.conceptos || []).map((concept) => [concept.concepto_id, concept]));
}

function isBasicConcept(concept = {}) {
  return /basico|sueldo basico|salario basico/.test(matchText([concept.concepto_id, concept.codigo, concept.nombre].join(" ")));
}

function salaryField(concept = {}, value = {}) {
  const raw = matchText([concept.concepto_id, concept.codigo, concept.nombre, value.unidad_pago, value.periodicidad].join(" "));
  if (/valor hora|hourly|por hora|\bhora\b/.test(raw)) return "hourly";
  if (/valor jornal|jornal|daily|por dia|\bdia\b/.test(raw)) return "day";
  return isBasicConcept(concept) || !value.concepto_id ? "monthly" : "";
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

function extractRules(conceptos = []) {
  const rules = {};
  const ruleConceptIds = new Set();
  for (const concept of conceptos) {
    const id = concept.concepto_id;
    const pct = numberValue(concept.porcentaje);
    if (id === "ANTIGUEDAD" && pct) {
      rules.seniority = { enabled: true, percentPerYear: pct };
      ruleConceptIds.add(id);
    }
    if (/^PRESENTISMO/.test(id) && pct) {
      rules.presentism = { enabled: true, percent: pct };
      ruleConceptIds.add(id);
    }
  }
  return { rules, ruleConceptIds };
}

function extractZones(escalas = []) {
  const zoneMap = new Map();
  for (const esc of escalas) {
    for (const value of esc.valores || []) {
      const zone = normalizeZone(value.zona || esc.zona);
      if (zone && !zoneMap.has(zone)) {
        zoneMap.set(zone, { id: zone, label: value.zona || esc.zona || "General", coef: 1 });
      }
    }
  }
  if (!zoneMap.size) zoneMap.set("general", { id: "general", label: "General", coef: 1 });
  return Array.from(zoneMap.values());
}

function buildActiveScale(convenio, scale) {
  if (!scale) return null;
  const concepts = conceptMap(convenio);
  const categories = new Map((convenio.categorias || []).map((category) => [category.categoria_id, category]));
  const rows = new Map();
  (scale.valores || []).forEach((value) => {
    const category = categories.get(value.categoria_id) || { categoria_id: value.categoria_id, categoria_nombre: value.categoria_id };
    const concept = concepts.get(value.concepto_id) || { concepto_id: value.concepto_id, nombre: value.concepto_id };
    const modality = value.modalidad || value.modalidad_aplicable || value.jornada || value.alcance || "";
    const key = `${value.categoria_id}:${normalizeZone(value.zona || scale.zona)}:${matchText(modality)}`;
    if (!rows.has(key)) {
      rows.set(key, {
        id: value.categoria_id,
        label: category.categoria_nombre || category.grupo_nombre || value.categoria_id,
        group: category.grupo_nombre || "",
        zone: normalizeZone(value.zona || scale.zona),
        modality,
        modalidad: modality
      });
    }
    const row = rows.get(key);
    const valueAmount = numberValue(value.valor);
    const salaryTarget = salaryField(concept, value);
    if (salaryTarget) {
      row[salaryTarget] = valueAmount;
    } else if (conceptKind(concept) === "nonRemunerative") {
      row.nonRemunerative = numberValue(row.nonRemunerative) + valueAmount;
    } else if (value.concepto_id && valueAmount) {
      if (!row.conceptValues) row.conceptValues = {};
      row.conceptValues[value.concepto_id] = (row.conceptValues[value.concepto_id] || 0) + valueAmount;
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
  const runtime = toRuntimeConvention(convenio);
  const extractedRules = extractRules(convenio.conceptos || []);
  const sourceById = new Map((convenio.conceptos || []).map((concept) => [concept.concepto_id, concept]));
  const grouped = { concepts: [], deductions: [], retentions: [], employerContributions: [], references: [] };
  (runtime.liquidationModel?.concepts || []).forEach((concept) => {
    const source = sourceById.get(concept.id) || {};
    const kind = concept.rowType || conceptKind(source);
    if (concept.rowType === "reference" || isBasicConcept(source) || extractedRules.ruleConceptIds.has(concept.id)) {
      grouped.references.push({ ...concept, defaultValue: false });
      return;
    }
    if (kind === "employer") grouped.employerContributions.push({ ...concept, defaultValue: true });
    else if (kind === "deduction" && /retencion/.test(matchText(source.tipo_concepto))) grouped.retentions.push({ ...concept, defaultValue: true });
    else if (kind === "deduction") grouped.deductions.push({ ...concept, defaultValue: true });
    else grouped.concepts.push({ ...concept, defaultValue: source.defaultValue === true });
  });
  return {
    ...runtime,
    structuredFromConvention: true,
    rules: { ...(runtime.rules || {}), ...extractedRules.rules },
    periods: runtime.periods?.length ? runtime.periods : [{ id: period, label: period, validFrom: period }],
    liquidationModel: {
      ...(runtime.liquidationModel || {}),
      rules: { ...(runtime.liquidationModel?.rules || {}), ...extractedRules.rules },
      ...grouped
    }
  };
}

async function buildPayrollDataForConvenio(db, convenioId, period, baseCatalog = {}) {
  const convenio = await getConvenio(db, convenioId);
  const scales = selectScales(convenio.escalas || [], period);
  const activeScales = scales.map((scale) => buildActiveScale(convenio, scale)).filter(Boolean);
  const mergedCategories = Array.from(new Map(activeScales.flatMap((scale) => (scale.parsedScale?.categories || [])).map((row) => [
    `${row.id || ""}:${normalizeZone(row.zone || "")}:${matchText(row.modalidad || row.modality || "")}`,
    row
  ])).values());
  const activeScale = activeScales[0] ? {
    ...activeScales[0],
    availableScales: activeScales,
    parsedScale: {
      ...activeScales[0].parsedScale,
      categories: mergedCategories
    },
    zone: activeScales.map((scale) => scale.parsedScale?.categories || []).flatMap((rows) => rows.map((row) => row.zone)).filter(Boolean)
  } : null;
  if (!activeScale?.parsedScale?.categories?.length) {
    const error = new Error(`No existe una escala salarial vigente para ${period}`);
    error.status = 422;
    throw error;
  }
  const payrollConvention = buildPayrollConvention(convenio, period);
  return {
    catalog: {
      ...baseCatalog,
      conventions: { ...(baseCatalog.conventions || {}), [payrollConvention.id]: payrollConvention }
    },
    activeScale,
    activeScales
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
