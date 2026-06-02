const test = require("node:test");
const assert = require("node:assert/strict");
const {
  analyzeConventionDocuments,
  applyConventionArchitecture,
  isSupportedConventionDocument,
  validateStructuredConvention
} = require("../src/domain/convention-pipeline");
const { buildConventionPrompt, conventionAttachmentParts, enrichConventionWithDocumentConcepts, isLikelySalaryCategoryLabel, looksLikeHairdressers730, normalizeConvention, parseCommerceCategories, parseCommerceScaleAdditionals, parseGenericDocumentDeductions, parseGenericDocumentRules, parseGenericScaleAdditionals, parseGenericScaleCategories, sanitizeGenericConventionCategories } = require("../src/convention-ai");
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

test("no identifica peluqueros por una referencia aislada", () => {
  assert.equal(looksLikeHairdressers730({
    draftName: "Convenio general",
    notes: "Incluye una referencia comparativa a peluquerias.",
    cctText: "",
    scaleText: ""
  }), false);
  assert.equal(looksLikeHairdressers730({
    draftName: "CCT 730/15",
    notes: "",
    cctText: "",
    scaleText: ""
  }), true);
});

test("descarta conceptos unitarios confundidos con categorias salariales", () => {
  assert.equal(isLikelySalaryCategoryLabel("Administrativo A"), true);
  assert.equal(isLikelySalaryCategoryLabel("Por los primeros 100 km 89,75"), false);
  assert.equal(isLikelySalaryCategoryLabel("Viatico especial"), false);
  assert.equal(isLikelySalaryCategoryLabel("112,00"), false);
  assert.equal(isLikelySalaryCategoryLabel("92,63", "Art.36 Ayud. Chof. 1º 100Km"), false);
  const convention = sanitizeGenericConventionCategories({
    extraction: { model: "local-pdf-parse/generic-scale-parser" },
    categories: [
      { id: "administrativo-a", label: "Administrativo A" },
      { id: "primeros-100-km", label: "Por los primeros 100 km 89,75" },
      { id: "112-00", label: "112,00", group: "Abr/26 May/26 Jun/26", monthly: 112 },
      { id: "92-63", label: "92,63", group: "Art.36 Ayud. Chof. 1º 100Km", monthly: 92.63 },
      { id: "fragmento", label: "ablecida por el art. 40 del CCT 130/75 (8,33%).", group: "asignación complementaria est", monthly: 8.33 }
    ],
    structuredModel: {
      categorias: [{ codigo: "administrativo-a" }, { codigo: "primeros-100-km" }, { codigo: "112-00" }, { codigo: "92-63" }, { codigo: "fragmento" }],
      escalas_salariales: [{ categoria: "administrativo-a" }, { categoria: "primeros-100-km" }, { categoria: "112-00" }, { categoria: "92-63" }, { categoria: "fragmento" }]
    }
  });
  assert.deepEqual(convention.categories.map((item) => item.id), ["administrativo-a"]);
  assert.deepEqual(convention.structuredModel.escalas_salariales.map((item) => item.categoria), ["administrativo-a"]);
  assert.equal(convention.liquidationModel.concepts.some((item) => item.label.includes("Art.36 Ayud. Chof. 1º 100Km")), true);
  assert.equal(convention.liquidationModel.concepts.some((item) => item.label.includes("asignación complementaria establecida")), true);
});

test("interpreta una tabla separada de adicionales", () => {
  const scaleText = `
    CATEGORIAS
    Administrativo A 1.200.000,00
    ADICIONALES
    Plus responsabilidad 10%
    Viatico diario 15.000,00
    Titulo profesional 120.000,00
  `;
  const concepts = parseGenericScaleAdditionals(scaleText, "2026-06");
  const categories = parseGenericScaleCategories(scaleText, "2026-06");
  assert.deepEqual(categories.map((item) => item.id), ["administrativo-a"]);
  assert.deepEqual(concepts.map((item) => item.id), ["plus-responsabilidad-10", "viatico-diario", "titulo-profesional"]);
  assert.equal(concepts[0].calculation, "percentOfBase");
  assert.equal(concepts[0].percent, 10);
  assert.equal(concepts[1].calculation, "amountPerUnit");
  assert.equal(concepts[1].rowType, "nonRemunerative");
  assert.equal(concepts[1].unitAmount, 15000);
  assert.equal(concepts[2].calculation, "fixed");
  assert.equal(concepts[2].amount, 120000);
});

test("reconstruye la escala compactada de Comercio sin mezclar adicionales con categorias", () => {
  const scaleText = `
    ESCALA SALARIAL PARA EMPLEADOS DE COMERCIO - PARITARIAS 2026
    Abril 2026 Mayo 2026 Junio 2026
    CATEGORIA
    Maestranza "A"1.078.91140.00060.00020.0001.  096.24840.00060.00020.0001.  113.58540.00060.00020.000
    Administratativo "A"1.090.61340.00060.00020.0001.  108.12240.00060.00020.0001.  125.63140.00060.00020.000
    ADICIONALES Abr/26 May/26 Jun/26
    Art.23 Armado de vidriera42.816,5143.502,4944.188,47
    Art. 18 Ac. Jun/111.  635,181.  635,181.  635,18
    Art.36 Ayud. Chof. + 100Km110,39112,16113,93
  `;
  const parsed = parseCommerceCategories(scaleText);
  const concepts = parseCommerceScaleAdditionals(scaleText, ["2026-04", "2026-05", "2026-06"]);
  assert.deepEqual(parsed.categories.map((item) => item.label), ["Maestranza A", "Administrativo A"]);
  assert.deepEqual(parsed.categories.map((item) => item.group), ["Maestranza", "Administrativo"]);
  assert.deepEqual(parsed.categories[0].monthlyByPeriod, {
    "2026-04": 1078911,
    "2026-05": 1096248,
    "2026-06": 1113585
  });
  assert.deepEqual(parsed.categories[0].nonRem, {
    "2026-04": 120000,
    "2026-05": 120000,
    "2026-06": 120000
  });
  assert.deepEqual(concepts.map((item) => item.id), ["adicional-armado-vidriera", "adicional-art-18-ac-jun-11", "adicional-ayudante-chofer-mas-100-km"]);
  assert.equal(concepts[0].amountByPeriod["2026-06"], 44188.47);
  assert.equal(concepts[1].amountByPeriod["2026-06"], 1635.18);
  assert.equal(concepts[2].unitAmountByPeriod["2026-06"], 113.93);
});

test("incorpora haberes remunerativos y no remunerativos detectados en el CCT sin reinterpretar la escala", () => {
  const convention = enrichConventionWithDocumentConcepts(sampleConvention(), {
    cctText: `
      HABERES REMUNERATIVOS
      Premio asistencia 10%
      Adicional caja 120.000,00
      HABERES NO REMUNERATIVOS
      Refrigerio 25.000,00
      DESCUENTOS
      Seguro de sepelio 1,5%
    `,
    cctPdf: { sourceFileName: "cct.pdf" }
  });
  const concepts = convention.liquidationModel.concepts;
  assert.equal(concepts.find((item) => item.id === "premio-asistencia").rowType, "remunerative");
  assert.equal(concepts.find((item) => item.id === "adicional-caja").rowType, "remunerative");
  assert.equal(concepts.find((item) => item.id === "refrigerio").rowType, "nonRemunerative");
  assert.equal(concepts.some((item) => item.id === "seguro-de-sepelio"), false);
});

test("no convierte parrafos narrativos del CCT en haberes", () => {
  const convention = enrichConventionWithDocumentConcepts(sampleConvention(), {
    cctText: `
      REGIMEN REMUNERATIVO
      aumento del 5%
      14 anos de edad 40%
      Por casa y comida, 25%
      la Ley 20.517
    `,
    cctPdf: { sourceFileName: "cct.pdf" }
  });
  assert.deepEqual(convention.liquidationModel.concepts.map((item) => item.id), ["presentismo", "suma-nr"]);
});

test("extrae descuentos, retenciones y reglas explicitas del CCT sin mezclar bloques", () => {
  const cctText = `
    DESCUENTOS
    Cuota sindical 2%
    RETENCIONES
    Embargo judicial 10%
    REGLAS DE LIQUIDACION
    Jornada normal: 44 horas semanales
    Divisor mensual: 30
    Divisor horas extra: 176
    Divisor vacaciones: 25
    Antiguedad: 2% por ano trabajado
    Presentismo: 8,33%
  `;
  const financial = parseGenericDocumentDeductions(cctText, "2026-06", { sourceFileName: "cct.pdf" });
  const rules = parseGenericDocumentRules(cctText, { sourceFileName: "cct.pdf" });
  assert.deepEqual(financial.deductions.map((item) => item.id), ["cuota-sindical"]);
  assert.deepEqual(financial.retentions.map((item) => item.id), ["embargo-judicial"]);
  assert.equal(financial.retentions[0].defaultValue, false);
  assert.equal(rules.rules.weeklyHours, 44);
  assert.equal(rules.rules.monthDivisor, 30);
  assert.equal(rules.rules.hourDivisor, 176);
  assert.equal(rules.rules.vacationDivisor, 25);
  assert.equal(rules.liquidationRules.seniority.percentPerYear, 2);
  assert.equal(rules.liquidationRules.presentism.percent, 8.33);
  assert.equal(rules.evidence.length, 6);
});

test("detecta antiguedad y presentismo aplicados tambien sobre sumas no remunerativas", () => {
  const rules = parseGenericDocumentRules(`
    REGLAS DE LIQUIDACION
    Antiguedad: 1% por ano trabajado
    Presentismo: 8,33%
    La antiguedad y el presentismo se aplican tambien sobre las sumas no remunerativas.
  `, { sourceFileName: "acta.pdf" });

  assert.deepEqual(rules.liquidationRules.nonRemunerativeScale, {
    enabled: true,
    seniorityEnabled: true,
    seniorityPercentPerYear: 1,
    presentismEnabled: true,
    presentismPercent: 8.33
  });
  assert.deepEqual(rules.evidence.slice(-2).map((item) => item.id), [
    "antiguedad-no-remunerativa",
    "presentismo-no-remunerativo"
  ]);
});

test("normaliza y preserva retenciones propias del convenio", () => {
  const convention = normalizeConvention({
    ...sampleConvention(),
    liquidationModel: {
      ...sampleConvention().liquidationModel,
      retentions: [{ id: "embargo", label: "Embargo judicial", percent: 10, base: "remunerative" }]
    }
  });
  assert.equal(convention.liquidationModel.retentions.length, 1);
  assert.equal(convention.liquidationModel.retentions[0].id, "embargo");
  assert.equal(convention.liquidationModel.retentions[0].defaultValue, false);
});

test("incorpora reglas explicitas informadas por el archivo de escala", () => {
  const convention = enrichConventionWithDocumentConcepts(sampleConvention(), {
    scaleText: `
      REGLAS DE LIQUIDACION
      Jornada normal: 40 horas semanales
      Presentismo: asignacion complementaria
      establecida por acta 7%
    `,
    scalePdf: { sourceFileName: "escala.pdf" }
  });
  assert.equal(convention.rules.weeklyHours, 40);
  assert.equal(convention.liquidationModel.rules.presentism.percent, 7);
  assert.deepEqual(convention.extractedRules.map((item) => item.source), ["escala salarial", "escala salarial"]);
});

test("reclasifica adicionales devueltos por la IA dentro de categories", () => {
  const scale = normalizeScale({
    categories: [
      { id: "administrativo-a", label: "Administrativo A", monthly: 1200000 },
      { id: "viatico-diario", label: "Viatico diario", day: 15000 },
      { id: "plus-responsabilidad", label: "Plus responsabilidad", monthly: 120000 }
    ],
    additionals: [{ id: "titulo", label: "Titulo profesional", monthly: 90000 }]
  }, {
    convention: { id: "comercio", name: "Comercio", categories: [{ id: "administrativo-a", label: "Administrativo A" }] },
    period: "2026-06",
    sourceFileName: "escala.pdf"
  });
  assert.deepEqual(scale.categories.map((item) => item.id), ["administrativo-a"]);
  assert.deepEqual(scale.additionals.map((item) => item.id), ["titulo", "viatico-diario", "plus-responsabilidad"]);
});

test("normaliza Base como zona general de la escala salarial", () => {
  const scale = normalizeScale({
    categories: [{ id: "administrativo-a", label: "Administrativo A", zone: "Zona base", monthly: 1200000 }],
    zones: [{ id: "base", label: "Base" }, { id: "patagonica", label: "Patagonica", coefficient: 1.2 }]
  }, {
    convention: { id: "custom", name: "Convenio documental", categories: [{ id: "administrativo-a", label: "Administrativo A" }] },
    period: "2026-06",
    sourceFileName: "escala.pdf"
  });
  assert.deepEqual(scale.zones, [
    { id: "general", label: "General", coefficient: 1 },
    { id: "patagonica", label: "Patagonica", coefficient: 1.2 }
  ]);
  assert.equal(scale.categories[0].zone, "general");
});

test("infiere zona general para filas base sin zona cuando hay zonas derivadas", () => {
  const scale = normalizeScale({
    categories: [{ id: "administrativo-a", label: "Administrativo A", monthly: 1200000 }],
    zones: [{ id: "patagonica", label: "Patagonica", coefficient: 1.2 }]
  }, {
    convention: { id: "custom", name: "Convenio documental", categories: [{ id: "administrativo-a", label: "Administrativo A" }] },
    period: "2026-06",
    sourceFileName: "escala.pdf"
  });
  assert.deepEqual(scale.zones, [
    { id: "patagonica", label: "Patagonica", coefficient: 1.2 },
    { id: "general", label: "General", coefficient: 1 }
  ]);
});

test("normaliza reglas no remunerativas detectadas dentro de una escala", () => {
  const scale = normalizeScale({
    categories: [{ id: "administrativo-a", label: "Administrativo A", monthly: 1200000, nonRemunerative: 100000 }],
    reglasNoRemunerativas: {
      porcentajeAntiguedadPorAnio: "1%",
      porcentajePresentismo: "8,33%",
      presentismoExigeSinInasistenciasInjustificadas: true,
      referenciasLegales: ["Acta salarial junio 2026"]
    }
  }, {
    convention: { id: "custom", name: "Convenio documental", categories: [{ id: "administrativo-a", label: "Administrativo A" }] },
    period: "2026-06",
    sourceFileName: "escala.pdf"
  });

  assert.deepEqual(scale.nonRemunerativeRules, {
    seniorityPercentPerYear: 1,
    presentismPercent: 8.33,
    presentismRequiresNoUnjustifiedAbsence: true,
    legalReferences: ["Acta salarial junio 2026"],
    enabled: true,
    seniorityEnabled: true,
    presentismEnabled: true
  });
});
