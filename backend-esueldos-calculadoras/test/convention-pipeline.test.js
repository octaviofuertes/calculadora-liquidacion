const test = require("node:test");
const assert = require("node:assert/strict");
const {
  analyzeConventionDocuments,
  applyConventionArchitecture,
  isSupportedConventionDocument,
  validateStructuredConvention
} = require("../src/domain/convention-pipeline");
const { normalizeConvention } = require("../src/convention-ai");
const { buildScalePrompt, normalizeScale } = require("../src/scale-ai");

function sampleConvention() {
  return {
    id: "uocra-76-75",
    name: "UOCRA CCT 76/75",
    source: "CCT 76/75",
    type: "monthly",
    periods: [{ id: "2026-05", label: "Mayo 2026" }],
    zones: [{ id: "a", label: "Zona A", coef: 1 }],
    categories: [{ id: "oficial", label: "Oficial", zone: "a", monthly: 1000 }],
    rules: { monthDivisor: 30, hourDivisor: 200 },
    liquidationModel: {
      concepts: [
        { id: "presentismo", label: "Presentismo", rowType: "remunerative", calculation: "percentOfBase", percent: 20 },
        { id: "suma-nr", label: "Suma no remunerativa", rowType: "nonRemunerative", calculation: "fixed", amount: 50 }
      ],
      deductions: [{ id: "cuota", label: "Cuota sindical", calculation: "percentOfBase", percent: 2 }],
      retentions: [{ id: "embargo", label: "Embargo judicial", calculation: "percentOfBase", percent: 10 }]
    }
  };
}

test("acepta PDF e imagenes soportadas para interpretacion visual del agente IA", () => {
  assert.equal(isSupportedConventionDocument({ mimetype: "application/pdf", originalname: "cct.pdf" }), true);
  assert.equal(isSupportedConventionDocument({ mimetype: "image/png", originalname: "tabla.png" }), true);
  assert.equal(isSupportedConventionDocument({ mimetype: "text/plain", originalname: "notas.txt" }), false);
  const pipeline = analyzeConventionDocuments([{ mimeType: "application/pdf", sourceFileName: "cct.pdf" }]);
  assert.equal(pipeline.sourcePolicy, "uploaded_documents_only");
  assert.equal(pipeline.documents[0].extractionStrategy, "ai_agent_document_interpretation");
  assert.equal(pipeline.documents[0].tableStrategy, "ai_agent_table_interpretation");
});

test("entrega a la IA un molde vacio sin valores de convenios precargados", () => {
  const prompt = buildConventionPrompt({ draftName: "Peluqueros borrado", notes: "" });
  assert.match(prompt, /Usa exclusivamente el contenido de los archivos adjuntos como fuente factual/);
  assert.match(prompt, /No uses catalogos, convenios precargados, borradores previos, versiones archivadas ni rastros de convenios eliminados/);
  assert.doesNotMatch(prompt, /categoria-a|adicional-escala-ejemplo|CCT 000\/00|percentPerYear": 1/);
  assert.match(prompt, /Etiqueta informativa escrita por el usuario: Peluqueros borrado\. No la uses como evidencia legal/);
  assert.match(prompt, /DEL CCT O ACTA extrae: identificacion legal, actividad, alcance, vigencia, categorias si aparecen, jornada, divisores, antiguedad, presentismo, horas extra, licencias, adicionales, haberes remunerativos, haberes no remunerativos, descuentos del trabajador, retenciones/);
  assert.match(prompt, /DE LA ESCALA SALARIAL extrae: periodos, zonas, jornadas, categorias laborales, basicos mensuales, jornales, valores hora, importes no remunerativos por categoria y periodo/);
  assert.match(prompt, /No devuelvas arrays vacios si existen filas, importes, porcentajes o reglas legibles/);
  assert.match(prompt, /REGLA CRITICA DE ZONA GENERAL: si una tabla salarial muestra General, Base, Zona general, Zona base o Sin adicional zonal/);
  assert.match(prompt, /REGLA CRITICA DE NO REMUNERATIVOS: si el CCT, acta o escala indica que una suma no remunerativa genera antiguedad no remunerativa o presentismo no remunerativo/);
});

test("etiqueta los adjuntos para que la IA diferencie CCT y escala salarial", () => {
  const parts = conventionAttachmentParts({
    cctPdf: { buffer: Buffer.from("cct"), sourceFileName: "convenio.pdf", mimeType: "application/pdf" },
    scalePdf: { buffer: Buffer.from("escala"), sourceFileName: "escala.png", mimeType: "image/png" }
  });
  assert.equal(parts.length, 4);
  assert.match(parts[0].text, /ARCHIVO 1 - CCT, ACTA O DOCUMENTO PRINCIPAL\. Nombre: convenio\.pdf/);
  assert.equal(parts[1].inlineData.mimeType, "application/pdf");
  assert.match(parts[2].text, /ARCHIVO 2 - ESCALA SALARIAL\. Nombre: escala\.png/);
  assert.equal(parts[3].inlineData.mimeType, "image/png");
});

test("el prompt de escala usa el adjunto como unica fuente factual de importes", () => {
  const prompt = buildScalePrompt({ convention: sampleConvention(), period: "2026-06", periodLabel: "Junio 2026" });
  assert.match(prompt, /La unica fuente factual de importes es el archivo adjunto/);
  assert.match(prompt, /No copies importes anteriores ni completes filas por analogia/);
  assert.match(prompt, /No devuelvas categories, additionals o scales vacios si el archivo contiene filas e importes legibles/);
  assert.match(prompt, /extrae esas reglas separadas en nonRemunerativeRules con seniorityEnabled, seniorityPercentPerYear, seniorityCapYears, presentismEnabled, presentismPercent y presentismRequiresNoUnjustifiedAbsence/);
});

test("normaliza la respuesta IA sin agregar reglas ni periodos precargados", () => {
  const convention = normalizeConvention({
    convention: {
      name: "Convenio documental",
      categories: [{ id: "categoria-documental", label: "Categoria documental", monthly: 1000 }],
      liquidationModel: { concepts: [], deductions: [], retentions: [], employerContributions: [] }
    }
  }, { useFallbackDefaults: false });
  assert.deepEqual(convention.periods, []);
  assert.deepEqual(convention.zones, []);
  assert.deepEqual(convention.rules, {});
  assert.deepEqual(convention.liquidationModel.rules, { salaryType: "monthly" });
  assert.equal(convention.warnings.includes("No se detectaron periodos vigentes. Completar antes de aprobar."), true);
});

test("conserva la zona general documental aunque la tabla la llame Base", () => {
  const convention = normalizeConvention({
    convention: {
      name: "Convenio documental",
      periods: [{ id: "2026-06", label: "Junio 2026" }],
      zones: [{ id: "base", label: "Base" }, { id: "patagonica", label: "Patagonica", coef: 1.2 }],
      categories: [{ id: "categoria-documental", label: "Categoria documental", zone: "Zona general", monthly: 1000 }],
      liquidationModel: { concepts: [], deductions: [], retentions: [], employerContributions: [] }
    }
  }, { useFallbackDefaults: false });
  assert.deepEqual(convention.zones, [
    { id: "general", label: "General", coef: 1 },
    { id: "patagonica", label: "Patagonica", coef: 1.2 }
  ]);
  assert.equal(convention.categories[0].zone, "general");
});

test("no inventa reglas de negocio ni atributos de conceptos en modo documental", () => {
  const convention = applyConventionArchitecture(normalizeConvention({
    convention: {
      name: "Convenio documental",
      periods: [{ id: "2026-06", label: "Junio 2026" }],
      categories: [{ id: "categoria-documental", label: "Categoria documental", monthly: 1000 }],
      liquidationModel: {
        concepts: [{ id: "adicional-documental", label: "Adicional documental", amount: 100 }],
        deductions: [],
        retentions: [],
        employerContributions: []
      }
    }
  }, { useFallbackDefaults: false }));
  assert.equal(convention.liquidationModel.concepts[0].rowType, "");
  assert.equal(convention.liquidationModel.concepts[0].base, "");
  assert.equal(convention.structuredModel.modalidad_liquidacion.divisor_mensual, null);
  assert.equal(convention.structuredModel.modalidad_liquidacion.divisor_horas, null);
  assert.equal(convention.structuredModel.categorias[0].zona, "");
});

test("preserva retenciones descriptas aunque requieran revision del importe", () => {
  const convention = normalizeConvention({
    convention: {
      name: "Convenio documental",
      periods: [{ id: "2026-06", label: "Junio 2026" }],
      categories: [{ id: "categoria-documental", label: "Categoria documental", monthly: 1000 }],
      liquidationModel: {
        concepts: [],
        deductions: [],
        retentions: [{
          id: "retencion-condicional",
          label: "Retencion condicional",
          appliesWhen: "segun legajo",
          detail: "Articulo ilegible: revisar porcentaje",
          requiresHumanValidation: true
        }],
        employerContributions: []
      }
    }
  }, { useFallbackDefaults: false });
  assert.equal(convention.liquidationModel.retentions.length, 1);
  assert.equal(convention.liquidationModel.retentions[0].requiresHumanValidation, true);
});

test("construye el molde y separa haberes remunerativos, no remunerativos y descuentos", () => {
  const pipeline = analyzeConventionDocuments([{ mimeType: "image/png", sourceFileName: "escala.png", field: "scalePdf" }]);
  const convention = applyConventionArchitecture(sampleConvention(), pipeline);
  assert.equal(convention.processingPipeline.architectureVersion, "esueldos-estructurador-v3");
  assert.equal(convention.processingPipeline.requiresAiVisualInterpretation, true);
  assert.equal(convention.processingPipeline.stages.includes("interpretacion_visual_ia"), true);
  assert.equal(convention.processingPipeline.documents[0].extractionStrategy, "ai_agent_visual_interpretation");
  assert.equal(convention.structuredModel.categorias[0].zona, "a");
  assert.equal(convention.structuredModel.conceptos.haberes_remunerativos[0].codigo, "presentismo");
  assert.equal(convention.structuredModel.conceptos.haberes_no_remunerativos[0].codigo, "suma-nr");
  assert.equal(convention.structuredModel.conceptos.descuentos[0].codigo, "cuota");
  assert.equal(convention.structuredModel.conceptos.retenciones[0].codigo, "embargo");
  assert.equal(convention.structuredModel.reglas_liquidacion.monthDivisor, 30);
  assert.equal(convention.structureValidation.valid, true);
});

test("marca como bloqueante un convenio sin categorias", () => {
  const convention = applyConventionArchitecture({ ...sampleConvention(), categories: [] });
  assert.deepEqual(validateStructuredConvention(convention).blocking, ["tiene_categorias"]);
});

test("actualiza pipelines anteriores al aprobar un convenio", () => {
  const convention = applyConventionArchitecture(sampleConvention(), {
    architectureVersion: "esueldos-estructurador-v2",
    stages: ["extraccion", "etapa_anterior", "normalizacion"],
    documents: [{ mimeType: "image/png", sourceFileName: "escala.png", contentType: "legacy_image" }]
  });
  assert.equal(convention.processingPipeline.architectureVersion, "esueldos-estructurador-v3");
  assert.deepEqual(convention.processingPipeline.stages.slice(0, 3), ["extraccion", "interpretacion_visual_ia", "normalizacion"]);
  assert.equal(convention.processingPipeline.documents[0].extractionStrategy, "ai_agent_visual_interpretation");
});














