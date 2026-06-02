const path = require("path");

const SUPPORTED_DOCUMENT_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp"
]);
const SUPPORTED_DOCUMENT_EXTENSIONS = new Set([".pdf", ".jpg", ".jpeg", ".png", ".webp"]);
const LIQUIDATION_FLOW = [
  "validar_convenio",
  "validar_conceptos",
  "calcular_haberes_remunerativos",
  "calcular_haberes_no_remunerativos",
  "calcular_bruto",
  "aplicar_descuentos",
  "aplicar_retenciones",
  "calcular_neto",
  "auditar_resultado",
  "generar_recibo"
];

function isSupportedConventionDocument(file = {}) {
  const extension = path.extname(file.originalname || file.sourceFileName || "").toLowerCase();
  return SUPPORTED_DOCUMENT_MIME_TYPES.has(file.mimetype || file.mimeType) || SUPPORTED_DOCUMENT_EXTENSIONS.has(extension);
}

function analyzeConventionDocuments(documents = []) {
  const files = documents.filter(Boolean).map((document) => {
    const mimeType = document.mimeType || document.mimetype || "";
    const image = mimeType.startsWith("image/");
    return {
      field: document.field || "",
      sourceFileName: document.sourceFileName || document.originalname || "",
      mimeType,
      contentType: image ? "visual_image" : "pdf_document",
      extractionStrategy: image ? "ai_agent_visual_interpretation" : "ai_agent_document_interpretation",
      tableStrategy: "ai_agent_table_interpretation"
    };
  });
  return {
    architectureVersion: "esueldos-estructurador-v3",
    stages: ["extraccion", "interpretacion_visual_ia", "normalizacion", "clasificacion", "estructuracion_json", "validacion", "versionado", "persistencia"],
    documents: files,
    sourcePolicy: "uploaded_documents_only",
    requiresAiVisualInterpretation: files.some((file) => file.contentType === "visual_image")
  };
}

function normalizeConventionPipeline(pipeline = {}) {
  return analyzeConventionDocuments(pipeline.documents || []);
}

function conceptBlock(concept = {}) {
  const rowType = String(concept.rowType || concept.type || "").toLowerCase();
  if (rowType.includes("non") || rowType.includes("no_rem") || rowType.includes("noremun")) return "haberes_no_remunerativos";
  if (rowType.includes("deduction") || rowType.includes("descuento")) return "descuentos";
  if (rowType.includes("retencion")) return "retenciones";
  return "haberes_remunerativos";
}

function sourceReferences(convention) {
  const documents = convention.documents || convention.sourceFiles || [];
  return (Array.isArray(documents) ? documents : []).map((document) => ({
    documento: typeof document === "string" ? document : (document.name || document.fileName || ""),
    articulo: typeof document === "object" ? (document.article || "") : "",
    pagina: typeof document === "object" ? (document.page || "") : "",
    texto_referencia: typeof document === "object" ? (document.reference || "") : ""
  }));
}

function salaryScales(convention) {
  return (convention.categories || []).flatMap((category) => (convention.periods || []).map((period) => ({
    periodo_desde: period.id,
    periodo_hasta: period.id,
    categoria: category.id,
    basico: Number(category.monthlyByPeriod?.[period.id] ?? category.monthly ?? 0) || 0,
    valor_hora: Number(category.hourlyByPeriod?.[period.id] ?? category.hourly ?? 0) || 0,
    valor_jornal: Number(category.dayByPeriod?.[period.id] ?? category.day ?? 0) || 0,
    moneda: "ARS",
    zona: category.zone || "",
    fuente: convention.source || ""
  })));
}

function optionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function structuredConcept(concept = {}) {
  return {
    codigo: concept.id || "",
    nombre: concept.label || concept.name || "",
    tipo_calculo: concept.calculation || "",
    valor: Number(concept.value ?? concept.amount ?? concept.percent ?? 0) || 0,
    base_calculo: concept.base || "",
    condiciones: concept.conditions || [],
    fuente: concept.source || concept.legalReference || ""
  };
}

function buildStructuredModel(convention, pipeline = analyzeConventionDocuments()) {
  const grouped = {
    haberes_remunerativos: [],
    haberes_no_remunerativos: [],
    descuentos: [],
    retenciones: []
  };
  (convention.liquidationModel?.concepts || []).forEach((concept) => grouped[conceptBlock(concept)].push(structuredConcept(concept)));
  (convention.liquidationModel?.deductions || []).forEach((concept) => grouped.descuentos.push(structuredConcept(concept)));
  (convention.liquidationModel?.retentions || []).forEach((concept) => grouped.retenciones.push(structuredConcept(concept)));
  const validationRules = convention.validation?.rules || convention.validation?.autoChecks || [];
  const liquidationRules = { ...(convention.rules || {}), ...(convention.liquidationModel?.rules || {}) };
  return {
    convenio: {
      codigo: convention.id || "",
      nombre: convention.name || "",
      actividad: convention.metadata?.activity || "",
      ambito_aplicacion: {
        geografico: convention.scope?.geographic || "",
        personal: convention.scope?.personal || "",
        empresa_actividad: convention.scope?.activity || ""
      },
      partes_firmantes: convention.metadata?.signatories || [],
      vigencia: {
        fecha_inicio: convention.metadata?.validFrom || convention.periods?.[0]?.id || "",
        fecha_fin: convention.metadata?.validTo || convention.periods?.at(-1)?.id || "",
        renovacion: convention.metadata?.renewal || ""
      },
      fuentes: sourceReferences(convention)
    },
    categorias: (convention.categories || []).map((category) => ({
      codigo: category.id || "",
      nombre: category.label || category.name || "",
      descripcion: category.description || "",
      nivel: category.level || "",
      funciones: category.functions || [],
      zona: category.zone || "",
      fuente: convention.source || ""
    })),
    modalidad_liquidacion: {
      tipo: convention.type || "",
      base_calculo: convention.type === "daily" ? "valor_jornal" : convention.type === "hourly" ? "valor_hora" : (convention.type === "monthly" ? "sueldo_basico" : ""),
      divisor_mensual: optionalNumber(convention.rules?.monthDivisor),
      divisor_horas: optionalNumber(convention.rules?.hourDivisor),
      observaciones: ""
    },
    escalas_salariales: salaryScales(convention),
    conceptos: grouped,
    reglas_liquidacion: {
      ...liquidationRules,
      evidencia_extraida: convention.extractedRules || []
    },
    novedades_requeridas: convention.employeeRequirements || [],
    reglas_validacion: Array.isArray(validationRules) ? validationRules : [],
    flujo_liquidacion: LIQUIDATION_FLOW,
    auditoria: {
      checklist: convention.auditChecklist || [],
      warnings: convention.warnings || [],
      pipeline
    },
    metadata: {
      version: convention.metadata?.version || "1.0",
      estado: convention.metadata?.status || "borrador",
      fecha_estructuracion: new Date().toISOString(),
      estructurado_por: convention.generatedByLeia ? "IA" : "mixto",
      observaciones: ""
    }
  };
}

function validateStructuredConvention(convention) {
  const checks = [
    ["tiene_identificacion", Boolean(convention.id && convention.name)],
    ["tiene_vigencia", Boolean(convention.periods?.length)],
    ["tiene_categorias", Boolean(convention.categories?.length)],
    ["tiene_conceptos_clasificados", Boolean(convention.structuredModel?.conceptos)],
    ["tiene_flujo_liquidacion", Boolean(convention.structuredModel?.flujo_liquidacion?.length)]
  ];
  const blocking = checks.filter(([, valid]) => !valid).map(([id]) => id);
  return { valid: blocking.length === 0, blocking, checks: checks.map(([id, valid]) => ({ id, valid })) };
}

function applyConventionArchitecture(convention, pipeline = analyzeConventionDocuments()) {
  const normalizedPipeline = normalizeConventionPipeline(pipeline);
  const enriched = { ...convention, architectureVersion: normalizedPipeline.architectureVersion, processingPipeline: normalizedPipeline };
  enriched.structuredModel = buildStructuredModel(enriched, normalizedPipeline);
  enriched.structureValidation = validateStructuredConvention(enriched);
  return enriched;
}

function conventionFingerprint(convention = {}) {
  return JSON.stringify({
    id: convention.id,
    name: convention.name,
    source: convention.source,
    type: convention.type,
    periods: convention.periods,
    zones: convention.zones,
    categories: convention.categories,
    rules: convention.rules,
    liquidationModel: convention.liquidationModel,
    validation: convention.validation
  });
}

module.exports = {
  SUPPORTED_DOCUMENT_MIME_TYPES,
  isSupportedConventionDocument,
  analyzeConventionDocuments,
  normalizeConventionPipeline,
  buildStructuredModel,
  validateStructuredConvention,
  applyConventionArchitecture,
  conventionFingerprint
};
