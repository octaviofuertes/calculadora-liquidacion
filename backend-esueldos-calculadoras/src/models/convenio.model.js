const { z } = require("zod");

const EXCEL_SCHEMA_VERSION = "esueldos-cct-estructura-excel-v1";
const emptyText = z.union([z.string(), z.null()]).optional().default("");
const requiredText = z.string().min(1);
const amountValue = z.union([z.number().finite(), z.string(), z.null()]).optional().default(null);

function text(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.filter(Boolean).map(String).join(", ");
  return String(value);
}

function array(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function amount(value) {
  if (value === undefined || value === "") return null;
  return value;
}

function yearFrom(source = {}) {
  return text(source["a\u00f1o"] ?? source["aÃ±o"] ?? source.anio ?? source.year);
}

function convenioIdFrom(payload = {}) {
  return text(payload.convenio_id || payload.id || payload.conventionId || payload.convenio?.convenio_id);
}

function normalizeConvenioRoot(source = {}) {
  return {
    convenio_id: convenioIdFrom(source),
    tipo_norma: text(source.tipo_norma || source.type),
    numero: text(source.numero),
    "a\u00f1o": yearFrom(source),
    denominacion: text(source.denominacion || source.name),
    actividad: text(source.actividad || source.metadata?.activity),
    rama: text(source.rama),
    jurisdiccion: text(source.jurisdiccion || source.metadata?.jurisdiction),
    organismo: text(source.organismo || source.metadata?.homologation?.authority),
    partes_sindicales: text(source.partes_sindicales || source.metadata?.union),
    partes_empleadoras: text(source.partes_empleadoras || source.metadata?.employerChamber),
    fecha_homologacion: text(source.fecha_homologacion || source.metadata?.homologation?.date),
    vigencia_desde: text(source.vigencia_desde || source.normative?.validFrom),
    vigencia_hasta: text(source.vigencia_hasta || source.normative?.validTo),
    ambito_territorial: text(source.ambito_territorial || source.scope?.territory),
    personal_comprendido: text(source.personal_comprendido || source.scope?.workersIncluded),
    personal_excluido: text(source.personal_excluido || source.scope?.workersExcluded),
    fuente_documento: text(source.fuente_documento || source.source)
  };
}

function normalizeAmbito(item = {}, convenioId = "", index = 0) {
  return {
    ambito_id: text(item.ambito_id || item.id || `ambito-${index + 1}`),
    convenio_id: text(item.convenio_id || convenioId),
    tipo_ambito: text(item.tipo_ambito || item.type),
    descripcion: text(item.descripcion || item.description || item),
    incluido: text(item.incluido),
    excluido: text(item.excluido),
    fuente_documento: text(item.fuente_documento || item.source)
  };
}

function normalizeCategoria(item = {}, convenioId = "", index = 0) {
  return {
    categoria_id: text(item.categoria_id || item.id || `categoria-${index + 1}`),
    convenio_id: text(item.convenio_id || convenioId),
    grupo_nombre: text(item.grupo_nombre || item.groupName || item.group),
    categoria_nombre: text(item.categoria_nombre || item.name || item.label),
    descripcion: text(item.descripcion || item.description),
    tareas_incluidas: text(item.tareas_incluidas || item.includedTasks),
    modalidad_aplicable: text(item.modalidad_aplicable || item.applicableMode),
    nivel_jerarquico: text(item.nivel_jerarquico || item.hierarchyLevel),
    fuente_documento: text(item.fuente_documento || item.source)
  };
}

function normalizeConcepto(item = {}, convenioId = "", index = 0, forcedType = "") {
  return {
    concepto_id: text(item.concepto_id || item.id || `concepto-${index + 1}`),
    convenio_id: text(item.convenio_id || convenioId),
    codigo: text(item.codigo || item.code),
    nombre: text(item.nombre || item.name || item.label),
    tipo_concepto: text(item.tipo_concepto || item.type || forcedType),
    naturaleza: text(item.naturaleza || item.nature || item.rowType),
    unidad_calculo: text(item.unidad_calculo || item.unit || item.inputType),
    formula_base: text(item.formula_base || item.formula || item.calculation),
    base_calculo: text(item.base_calculo || item.base),
    porcentaje: text(item.porcentaje ?? item.percentage ?? item.percent),
    importe_fijo: amount(item.importe_fijo ?? item.fixedAmount ?? item.amount),
    aplica_a: text(item.aplica_a || item.appliesTo),
    condicion: text(item.condicion || item.condition || item.detail),
    fuente_documento: text(item.fuente_documento || item.source)
  };
}

function normalizeValor(item = {}, convenioId = "", escalaId = "", index = 0) {
  return {
    valor_id: text(item.valor_id || item.id || `valor-${index + 1}`),
    escala_id: text(item.escala_id || item.scaleId || escalaId),
    convenio_id: text(item.convenio_id || convenioId),
    categoria_id: text(item.categoria_id || item.categoryId),
    concepto_id: text(item.concepto_id || item.conceptId),
    modalidad: text(item.modalidad || item.modality),
    unidad_pago: text(item.unidad_pago || item.paymentUnit),
    periodicidad: text(item.periodicidad || item.periodicity),
    valor: amount(item.valor ?? item.value),
    valor_minimo: amount(item.valor_minimo ?? item.minValue),
    valor_maximo: amount(item.valor_maximo ?? item.maxValue),
    moneda: text(item.moneda || item.currency),
    alcance: text(item.alcance || item.scope),
    zona: text(item.zona || item.zone),
    vigencia_desde: text(item.vigencia_desde || item.validFrom),
    vigencia_hasta: text(item.vigencia_hasta || item.validTo),
    fuente_documento: text(item.fuente_documento || item.source)
  };
}

function normalizeEscala(item = {}, convenioId = "", index = 0) {
  const escalaId = text(item.escala_id || item.id || `escala-${index + 1}`);
  return {
    escala_id: escalaId,
    convenio_id: text(item.convenio_id || convenioId),
    nombre_escala: text(item.nombre_escala || item.name),
    tipo_escala: text(item.tipo_escala || item.type),
    periodo_desde: text(item.periodo_desde || item.periodFrom || item.period),
    periodo_hasta: text(item.periodo_hasta || item.periodTo),
    moneda: text(item.moneda || item.currency),
    alcance: text(item.alcance || item.scope),
    zona: text(item.zona || item.zone),
    fuente_documento: text(item.fuente_documento || item.source),
    valores: array(item.valores || item.values).map((value, valueIndex) => normalizeValor(value, convenioId, escalaId, valueIndex))
  };
}

function normalizeAdicional(item = {}, convenioId = "", index = 0) {
  return {
    adicional_id: text(item.adicional_id || item.id || `adicional-${index + 1}`),
    convenio_id: text(item.convenio_id || convenioId),
    concepto_id: text(item.concepto_id || item.conceptId),
    nombre: text(item.nombre || item.name),
    tipo: text(item.tipo || item.type),
    porcentaje: amount(item.porcentaje ?? item.percentage),
    importe: amount(item.importe ?? item.amount),
    base_calculo: text(item.base_calculo || item.base),
    condicion: text(item.condicion || item.condition),
    zonas_aplica: text(item.zonas_aplica || item.zones),
    vigencia_desde: text(item.vigencia_desde || item.validFrom),
    vigencia_hasta: text(item.vigencia_hasta || item.validTo),
    fuente_documento: text(item.fuente_documento || item.source),
    articulo_anexo: text(item.articulo_anexo),
    estado_revision: text(item.estado_revision || item.status)
  };
}

function universalConcepts(source = {}) {
  const model = source.liquidationModel || {};
  return [
    ...array(model.concepts).map((item) => ({ ...item, __forcedType: item.type || "HABER" })),
    ...array(model.deductions).map((item) => ({ ...item, __forcedType: item.type || "DESCUENTO" })),
    ...array(model.retentions).map((item) => ({ ...item, __forcedType: item.type || "RETENCION" })),
    ...array(model.employerContributions).map((item) => ({ ...item, __forcedType: item.type || "APORTE_PATRONAL" }))
  ];
}

function normalizeConvenio(input = {}) {
  const source = input.schemaVersion === EXCEL_SCHEMA_VERSION || input.convenio
    ? input
    : { convenio: input, ambitos: input.ambitos, categorias: input.categorias, conceptos: input.conceptos, escalas: input.escalas, adicionales: input.adicionales };
  const universal = input.id && input.categories ? input : null;
  const convenio = normalizeConvenioRoot(source.convenio || universal || input);
  const convenioId = convenio.convenio_id;
  const conceptos = source.conceptos || (universal ? universalConcepts(universal) : []);
  const adicionales = source.adicionales || (universal?.additionals ? Object.values(universal.additionals) : []);
  return {
    schemaVersion: EXCEL_SCHEMA_VERSION,
    convenio,
    ambitos: array(source.ambitos).map((item, index) => normalizeAmbito(item, convenioId, index)),
    categorias: array(source.categorias || universal?.categories).map((item, index) => normalizeCategoria(item, convenioId, index)),
    conceptos: array(conceptos).map((item, index) => normalizeConcepto(item, convenioId, index, item.__forcedType)),
    escalas: array(source.escalas || universal?.payrollBases?.scales).map((item, index) => normalizeEscala(item, convenioId, index)),
    adicionales: array(adicionales).map((item, index) => normalizeAdicional(item, convenioId, index))
  };
}

const convenioRootSchema = z.object({
  convenio_id: requiredText,
  tipo_norma: emptyText,
  numero: emptyText,
  "a\u00f1o": emptyText,
  denominacion: requiredText,
  actividad: emptyText,
  rama: emptyText,
  jurisdiccion: emptyText,
  organismo: emptyText,
  partes_sindicales: emptyText,
  partes_empleadoras: emptyText,
  fecha_homologacion: emptyText,
  vigencia_desde: emptyText,
  vigencia_hasta: emptyText,
  ambito_territorial: emptyText,
  personal_comprendido: emptyText,
  personal_excluido: emptyText,
  fuente_documento: emptyText
}).passthrough();

const ambitoSchema = z.object({
  ambito_id: requiredText,
  convenio_id: emptyText,
  tipo_ambito: emptyText,
  descripcion: emptyText,
  incluido: emptyText,
  excluido: emptyText,
  fuente_documento: emptyText
}).passthrough();

const categoriaSchema = z.object({
  categoria_id: requiredText,
  convenio_id: emptyText,
  grupo_nombre: emptyText,
  categoria_nombre: emptyText,
  descripcion: emptyText,
  tareas_incluidas: emptyText,
  modalidad_aplicable: emptyText,
  nivel_jerarquico: emptyText,
  fuente_documento: emptyText
}).passthrough();

const conceptoSchema = z.object({
  concepto_id: requiredText,
  convenio_id: emptyText,
  codigo: emptyText,
  nombre: emptyText,
  tipo_concepto: emptyText,
  naturaleza: emptyText,
  unidad_calculo: emptyText,
  formula_base: emptyText,
  base_calculo: emptyText,
  porcentaje: emptyText,
  importe_fijo: amountValue,
  aplica_a: emptyText,
  condicion: emptyText,
  fuente_documento: emptyText
}).passthrough();

const escalaValorSchema = z.object({
  valor_id: requiredText,
  escala_id: requiredText,
  convenio_id: emptyText,
  categoria_id: emptyText,
  concepto_id: emptyText,
  modalidad: emptyText,
  unidad_pago: emptyText,
  periodicidad: emptyText,
  valor: amountValue,
  valor_minimo: amountValue,
  valor_maximo: amountValue,
  moneda: emptyText,
  alcance: emptyText,
  zona: emptyText,
  vigencia_desde: emptyText,
  vigencia_hasta: emptyText,
  fuente_documento: emptyText
}).passthrough();

const escalaSchema = z.object({
  escala_id: requiredText,
  convenio_id: emptyText,
  nombre_escala: emptyText,
  tipo_escala: emptyText,
  periodo_desde: emptyText,
  periodo_hasta: emptyText,
  moneda: emptyText,
  alcance: emptyText,
  zona: emptyText,
  fuente_documento: emptyText,
  valores: z.array(escalaValorSchema).optional().default([])
}).passthrough();

const adicionalSchema = z.object({
  adicional_id: requiredText,
  convenio_id: emptyText,
  concepto_id: emptyText,
  nombre: emptyText,
  tipo: emptyText,
  porcentaje: amountValue,
  importe: amountValue,
  base_calculo: emptyText,
  condicion: emptyText,
  zonas_aplica: emptyText,
  vigencia_desde: emptyText,
  vigencia_hasta: emptyText,
  fuente_documento: emptyText,
  articulo_anexo: emptyText,
  estado_revision: emptyText
}).passthrough();

const convenioSchema = z.preprocess(normalizeConvenio, z.object({
  schemaVersion: z.literal(EXCEL_SCHEMA_VERSION),
  convenio: convenioRootSchema,
  ambitos: z.array(ambitoSchema).optional().default([]),
  categorias: z.array(categoriaSchema).optional().default([]),
  conceptos: z.array(conceptoSchema).optional().default([]),
  escalas: z.array(escalaSchema).optional().default([]),
  adicionales: z.array(adicionalSchema).optional().default([])
}).passthrough());

function validationError(message, details = []) {
  const error = new Error(message);
  error.status = 400;
  error.details = details;
  return error;
}

function duplicateIds(items = [], key) {
  const seen = new Set();
  const duplicates = new Set();
  items.forEach((item) => {
    const value = text(item?.[key]).trim();
    if (!value) return;
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  });
  return Array.from(duplicates);
}

function assertNoDuplicates(items, key, label) {
  const duplicates = duplicateIds(items, key);
  if (duplicates.length) {
    throw validationError(`${label} duplicados`, duplicates.map((id) => ({ path: `${label}.${key}`, message: `${key} duplicado: ${id}` })));
  }
}

function validateConvenioBusinessRules(convenio) {
  assertNoDuplicates(convenio.categorias, "categoria_id", "categorias");
  assertNoDuplicates(convenio.conceptos, "concepto_id", "conceptos");
  assertNoDuplicates(convenio.escalas, "escala_id", "escalas");
  convenio.escalas.forEach((escala) => assertNoDuplicates(escala.valores, "valor_id", `valores de escala ${escala.escala_id}`));
}

function parseConvenio(input) {
  const result = convenioSchema.safeParse(input);
  if (!result.success) {
    throw validationError("Convenio Excel invalido", result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })));
  }
  validateConvenioBusinessRules(result.data);
  return result.data;
}

function parseEscala(input, convenioId = "") {
  const result = escalaSchema.safeParse(normalizeEscala(input.escala || input, convenioId));
  if (!result.success) {
    throw validationError("Escala invalida", result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })));
  }
  assertNoDuplicates(result.data.valores, "valor_id", `valores de escala ${result.data.escala_id}`);
  return result.data;
}

module.exports = {
  EXCEL_SCHEMA_VERSION,
  adicionalSchema,
  ambitoSchema,
  categoriaSchema,
  conceptoSchema,
  convenioSchema,
  escalaSchema,
  escalaValorSchema,
  normalizeConvenio,
  parseConvenio,
  parseEscala
};
