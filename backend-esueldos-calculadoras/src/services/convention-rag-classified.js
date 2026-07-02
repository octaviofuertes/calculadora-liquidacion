const { geminiModelList, geminiConventionApiKey, geminiConventionModel, geminiScaleApiKey, geminiScaleModel } = require("../gemini-config");
const { GeminiConventionError, extractDocumentText, buildPdfPartsForGemini, callGeminiJson } = require("./convention-gemini");
const { buildClassifierPrompt, buildConventionPrompt, buildScalePrompt, buildScaleCompactPrompt } = require("./convention-prompts");
const { normalizeConvention } = require("./convention-normalizers");

function hasScaleValues(parsed = {}) {
  return Array.isArray(parsed.escalas) && parsed.escalas.some((scale) => (
    Array.isArray(scale?.valores) && scale.valores.some((value) => value && value.valor !== null && value.valor !== undefined && value.valor !== "")
  ));
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function detectScaleSignals(text = "") {
  const raw = String(text || "");
  const months = unique((raw.match(/\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|ene|feb|mar|abr|may|jun|jul|ago|sep|set|oct|nov|dic)\b(?:\s*[-/]\s*(?:19|20)?\d{2})?/gi) || []).map((item) => item.replace(/\s+/g, " ").trim().toLowerCase()));
  const zones = unique((raw.match(/\bzona\s*["']?[a-z0-9\-áéíóúü]+["']?/gi) || []).map((item) => item.replace(/\s+/g, " ").trim().toLowerCase()));
  const branches = unique(
    raw.split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => {
        const normalized = line.replace(/[^a-z0-9áéíóúüñ\s\/\-]+/gi, "").trim();
        return normalized.length >= 6 && normalized.length <= 80 && line === line.toUpperCase() && !/[0-9]/.test(normalized);
      })
      .map((line) => line.replace(/\s+/g, " ").trim())
  );
  return { months, zones, branches };
}

function summarizeScaleParsed(parsed = {}) {
  const scales = Array.isArray(parsed.escalas) ? parsed.escalas : [];
  const values = scales.flatMap((scale) => Array.isArray(scale.valores) ? scale.valores : []);
  return {
    scales: scales.length,
    values: values.length,
    zones: unique([].concat(
      scales.map((scale) => scale.zona),
      values.map((value) => value.zona)
    )),
    months: unique([].concat(
      scales.map((scale) => scale.nombre_escala || scale.periodo_desde || scale.periodo_hasta),
      values.map((value) => value.periodicidad || value.vigencia_desde || value.vigencia_hasta)
    ))
  };
}

function detectScaleBlocks(text = "") {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const interesting = lines.filter((line) => /anexo|zona|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|ene|feb|mar|abr|may|jun|jul|ago|sep|set|oct|nov|dic|canalizacion|lineas|instalacion|empalme|personal|oficial|ayudante|sereno/i.test(line));
  return interesting.slice(0, 18);
}

function mergeTokenUsage(...usages) {
  return usages.filter(Boolean).reduce((acc, usage) => ({
    promptTokenCount: (acc.promptTokenCount || 0) + (usage.promptTokenCount || 0),
    candidatesTokenCount: (acc.candidatesTokenCount || 0) + (usage.candidatesTokenCount || 0),
    outputTokenCount: (acc.outputTokenCount || 0) + (usage.outputTokenCount || usage.candidatesTokenCount || 0),
    totalTokenCount: (acc.totalTokenCount || 0) + (usage.totalTokenCount || 0)
  }), {});
}

function mergeUnique(left = [], right = [], key) {
  const seen = new Set();
  return [...left, ...right].filter((item) => {
    const value = String(item?.[key] || item?.id || item?.nombre || item?.categoria_nombre || JSON.stringify(item));
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

const DOCUMENT_CLASSIFICATIONS = new Set([
  "CCT_CONVENIO",
  "ESCALA_SALARIAL",
  "DOCUMENTO_MIXTO",
  "HOMOLOGACION_COMPLEMENTARIA",
  "DOCUMENTO_NO_APTO",
  "REQUIERE_OCR"
]);

function fallbackClassification({ file, role, text }) {
  const hasCct = role === "cctPdf";
  const hasScale = role === "scalePdf";
  const hasText = Boolean(String(text || "").trim());
  if (!hasText) {
    return {
      clasificacion: "REQUIERE_OCR",
      usar_prompt_cct: hasCct,
      usar_prompt_escalas: hasScale,
      requiere_ocr: true,
      requiere_revision_humana: true,
      motivo: "No se pudo extraer texto local suficiente; se intenta con Gemini y revision humana.",
      requiere_escala_anexa: false,
      confianza_general: "baja",
      alertas: ["El archivo no contiene texto extraible; debe interpretarse visualmente con Gemini."],
      datos_detectados: {},
      archivo_fuente: file?.sourceFileName || "",
      accion_recomendada: "Usar Gemini con el archivo original y revisar resultado."
    };
  }
  return {
    clasificacion: hasCct && hasScale ? "DOCUMENTO_MIXTO" : (hasScale ? "ESCALA_SALARIAL" : "CCT_CONVENIO"),
    usar_prompt_cct: hasCct || !hasScale,
    usar_prompt_escalas: hasScale,
    requiere_ocr: false,
    requiere_revision_humana: false,
    requiere_escala_anexa: false,
    confianza_general: "media",
    alertas: [],
    motivo: "Clasificacion tecnica por campos cargados; Gemini clasificador no fue concluyente.",
    datos_detectados: {},
    archivo_fuente: file?.sourceFileName || "",
    accion_recomendada: "Procesar con los prompts correspondientes y auditar."
  };
}

async function textFromFiles(files = []) {
  const chunks = await Promise.all(files.map(async (file) => {
    const text = await extractDocumentText(file);
    return text ? `## ${file.sourceFileName || "documento"}\n\n${text}` : "";
  }));
  return chunks.filter(Boolean).join("\n\n---\n\n");
}

function normalizeDocumentClassification(parsed, fallback) {
  const source = parsed && typeof parsed === "object" ? parsed : {};
  const clasificacion = DOCUMENT_CLASSIFICATIONS.has(source.clasificacion) ? source.clasificacion : fallback.clasificacion;
  return {
    ...fallback,
    ...source,
    clasificacion,
    usar_prompt_cct: typeof source.usar_prompt_cct === "boolean" ? source.usar_prompt_cct : fallback.usar_prompt_cct,
    usar_prompt_escalas: typeof source.usar_prompt_escalas === "boolean" ? source.usar_prompt_escalas : fallback.usar_prompt_escalas,
    requiere_ocr: source.requiere_ocr === true || clasificacion === "REQUIERE_OCR",
    requiere_revision_humana: source.requiere_revision_humana !== false,
    requiere_escala_anexa: source.requiere_escala_anexa === true,
    confianza_general: ["alta", "media", "baja"].includes(source.confianza_general) ? source.confianza_general : fallback.confianza_general,
    alertas: Array.isArray(source.alertas) ? source.alertas.filter(Boolean).map(String) : fallback.alertas
  };
}

async function classifySingleDocument({ apiKey, models, file, role, text, documentId }) {
  const fallback = fallbackClassification({ file, role, text });
  const parts = [
    { text: buildClassifierPrompt() },
    { text: `Rol declarado por el usuario: ${role === "scalePdf" ? "ESCALA" : "CCT_O_ACTA"}. Clasifica por contenido real, no por este rol.` },
    { text: `Archivo: ${file?.sourceFileName || "documento"}\n\nTexto extraido para clasificar:\n\n${String(text || "").slice(0, 16000)}` }
  ];
  const fileParts = await buildPdfPartsForGemini({ apiKey, files: [file], role: "DOCUMENTO A CLASIFICAR" });
  parts.push(...fileParts.parts);
  for (const model of models) {
    try {
      const result = await callGeminiJson({ apiKey, model, label: "clasificador-documental", parts });
      return {
        ...normalizeDocumentClassification(result.parsed, fallback),
        document_id: documentId,
        archivo_fuente: file?.sourceFileName || "",
        rol_declarado: role,
        tokenUsage: result.tokenUsage || null,
        modelo: model
      };
    } catch (error) {
      console.warn(`[CCT classifier] ${file?.sourceFileName || "documento"} con ${model}: ${error.message}`);
      if (!/high demand|unavailable|overloaded|try again later|503/i.test(String(error.message || ""))) break;
    }
  }
  return { ...fallback, document_id: documentId, rol_declarado: role, tokenUsage: null, modelo: "fallback-tecnico" };
}

function aggregateDocumentClassifications(documents) {
  const useCct = documents.some((item) => item.usar_prompt_cct);
  const useScale = documents.some((item) => item.usar_prompt_escalas);
  const requiresOcr = documents.some((item) => item.requiere_ocr);
  const requiresAnnex = documents.some((item) => item.requiere_escala_anexa);
  const noApt = documents.length > 0 && documents.every((item) => item.clasificacion === "DOCUMENTO_NO_APTO");
  const onlyHomologation = documents.length > 0 && documents.every((item) => item.clasificacion === "HOMOLOGACION_COMPLEMENTARIA");
  const alertas = Array.from(new Set(documents.flatMap((item) => item.alertas || []).filter(Boolean)));
  if (requiresAnnex) alertas.push("La documentacion menciona una escala o anexo que no fue incluido.");
  return {
    clasificacion: noApt ? "DOCUMENTO_NO_APTO" : onlyHomologation ? "HOMOLOGACION_COMPLEMENTARIA" : (useCct && useScale ? "DOCUMENTO_MIXTO" : useScale ? "ESCALA_SALARIAL" : useCct ? "CCT_CONVENIO" : "DOCUMENTO_NO_APTO"),
    usar_prompt_cct: useCct,
    usar_prompt_escalas: useScale,
    requiere_ocr: requiresOcr,
    requiere_revision_humana: documents.some((item) => item.requiere_revision_humana) || requiresOcr || requiresAnnex || onlyHomologation,
    requiere_escala_anexa: requiresAnnex,
    estado_extraccion: noApt || onlyHomologation ? "INSUFICIENTE" : (requiresOcr || requiresAnnex || alertas.length ? "PARCIAL" : "COMPLETO"),
    confianza_general: noApt || requiresOcr ? "baja" : documents.some((item) => item.confianza_general !== "alta") ? "media" : "alta",
    motivo: documents.map((item) => `${item.archivo_fuente || "Documento"}: ${item.motivo || item.clasificacion}`).join(" | "),
    alertas: Array.from(new Set(alertas)),
    documentos: documents,
    datos_detectados: {
      periodos_salariales: Array.from(new Set(documents.flatMap((item) => item.datos_detectados?.periodos_salariales || []))),
      hay_tablas: documents.some((item) => item.datos_detectados?.hay_tablas),
      hay_importes: documents.some((item) => item.datos_detectados?.hay_importes),
      hay_reglas_laborales: documents.some((item) => item.datos_detectados?.hay_reglas_laborales),
      hay_anexos_mencionados: documents.some((item) => item.datos_detectados?.hay_anexos_mencionados)
    },
    accion_recomendada: noApt ? "Solicitar documentacion legible y completa." : onlyHomologation ? "Adjuntar el CCT, acuerdo o anexo salarial homologado." : "Procesar cada archivo con el prompt indicado y someter el resultado a auditoria humana.",
    tokenUsage: mergeTokenUsage(...documents.map((item) => item.tokenUsage))
  };
}

async function classifyLaborDocuments({ apiKey, models, documents }) {
  const results = [];
  for (const document of documents) {
    results.push(await classifySingleDocument({ apiKey, models, ...document }));
  }
  return aggregateDocumentClassifications(results);
}

async function requestConventionExtraction({ apiKey, model, markdownText, files = [], draftName, notes, globalLaborLawPdf, globalLaborLawText }) {
  const documentParts = await buildPdfPartsForGemini({ apiKey, files, role: "CCT / ACTA / DOCUMENTO LABORAL" });
  const laborLawParts = await buildPdfPartsForGemini({
    apiKey,
    files: globalLaborLawPdf ? [globalLaborLawPdf] : [],
    role: "LEY DE TRABAJO APLICABLE"
  });
  const result = await callGeminiJson({
    apiKey,
    model,
    label: "convenio-rag",
    parts: [
      { text: buildConventionPrompt({ draftName, notes }) },
      { text: `Texto del CCT:\n\n${markdownText || ""}` },
      globalLaborLawText ? { text: `Ley de Trabajo Aplicable cargada globalmente:\n\n${globalLaborLawText}` } : null,
      ...documentParts.parts,
      ...laborLawParts.parts
    ].filter(Boolean)
  });
  return { ...result, parsed: normalizeConvention(result.parsed, { fallbackName: draftName }) };
}

async function requestScaleExtraction({ apiKey, model, markdownText, files = [], draftName, notes, baseCategories = [], baseConcepts = [] }) {
  const fileParts = await buildPdfPartsForGemini({ apiKey, files, role: "ESCALA SALARIAL" });
  const signals = detectScaleSignals(markdownText || "");
  const blocks = detectScaleBlocks(markdownText || "");
  const scaleHint = [
    signals.months.length ? `Meses detectados en el texto: ${signals.months.join(", ")}.` : "Meses detectados en el texto: ninguno.",
    signals.zones.length ? `Zonas detectadas en el texto: ${signals.zones.join(", ")}.` : "Zonas detectadas en el texto: ninguna.",
    signals.branches.length ? `Ramas/bloques detectados en el texto: ${signals.branches.join(" | ")}.` : "Ramas/bloques detectados en el texto: ninguno.",
    blocks.length ? `Bloques visibles detectados: ${blocks.join(" || ")}.` : "Bloques visibles detectados: ninguno.",
    "Regla crítica: si el documento muestra más de una zona, no colapses toda la escala en una sola zona."
  ].join(" ");
  console.log(`[CCT scale] files=${files.length} parts=${fileParts.parts.length} meses=${signals.months.length} zonas=${signals.zones.length} ramas=${signals.branches.length} bloques=${blocks.length}`);
  let result = await callGeminiJson({
    apiKey,
    model,
    label: "escala-rag",
    maxOutputTokens: 32000,
    parts: [
      { text: buildScalePrompt({ draftName, notes: [notes, scaleHint].filter(Boolean).join("\n") + (signals.zones.length ? `\nZonas detectadas: ${signals.zones.join(", ")}.` : ""), baseCategories, baseConcepts }) },
      { text: `Texto de la escala:\n\n${markdownText || ""}` },
      ...fileParts.parts
    ]
  });
  console.log(`[CCT scale] parse inicial escalas=${Array.isArray(result.parsed?.escalas) ? result.parsed.escalas.length : 0} zonas=${summarizeScaleParsed(result.parsed).zones.length} valores=${summarizeScaleParsed(result.parsed).values}`);
  if (!hasScaleValues(result.parsed)) {
    const compactResult = await callGeminiJson({
      apiKey,
      model,
      label: "escala-rag-compact",
      maxOutputTokens: 32000,
      parts: [
        { text: buildScaleCompactPrompt({ draftName, notes: [notes, scaleHint].filter(Boolean).join("\n"), baseCategories, baseConcepts }) },
        { text: `Texto de la escala:\n\n${markdownText || ""}` },
        ...fileParts.parts
      ]
    });
    if (hasScaleValues(compactResult.parsed)) result = compactResult;
  }
  const parsedSummary = summarizeScaleParsed(result.parsed);
  if (signals.zones.length > 1 && parsedSummary.zones.length <= 1) {
    console.log(`[CCT scale] reintento por colapso de zonas. detectadas=${signals.zones.join(", ")} parseadas=${parsedSummary.zones.join(", ") || "ninguna"}`);
    const zoneStrictResult = await callGeminiJson({
      apiKey,
      model,
      label: "escala-rag-zones",
      maxOutputTokens: 32000,
      parts: [
        { text: buildScaleCompactPrompt({ draftName, notes: `${notes || ""}\n${scaleHint}\nOBLIGATORIO: conservar cada zona por separado y no usar Zona A como valor universal.`, baseCategories, baseConcepts }) },
        { text: `Encabezados de zona detectados: ${signals.zones.join(", ")}.\n\nTexto de la escala:\n\n${markdownText || ""}` },
        ...fileParts.parts
      ]
    });
    if (hasScaleValues(zoneStrictResult.parsed) && summarizeScaleParsed(zoneStrictResult.parsed).zones.length >= signals.zones.length) {
      result = zoneStrictResult;
      console.log(`[CCT scale] reintento zonas aplicado correctamente. zonas=${summarizeScaleParsed(result.parsed).zones.join(", ")}`);
    }
  }
  return { ...result, parsed: normalizeConvention(result.parsed, { fallbackName: draftName }) };
}

async function extractWithFallback({ apiKey, models, isScaleExtraction, payload }) {
  let lastError;
  for (const currentModel of models) {
    try {
      return isScaleExtraction
        ? await requestScaleExtraction({ apiKey, model: currentModel, ...payload })
        : await requestConventionExtraction({ apiKey, model: currentModel, ...payload });
    } catch (error) {
      lastError = error;
      if (!/high demand|unavailable|overloaded|try again later|503/i.test(String(error.message || ""))) throw error;
    }
  }
  throw lastError || new GeminiConventionError("No se pudo estructurar el documento.");
}

async function extractConventionFromPdfs({
  apiKey,
  model,
  fallbackModels = [],
  models: providedModels,
  cctApiKey,
  cctModel,
  cctFallbackModels = [],
  scaleApiKey,
  scaleModel,
  scaleFallbackModels = [],
  cctPdf,
  scalePdf,
  scalePdfs = [],
  draftName,
  notes,
  globalLaborLawPdf,
  globalLaborLawText,
  markdownText,
  isScaleExtraction = false,
  baseCategories = [],
  baseConcepts = []
}) {
  const resolvedCctApiKey = cctApiKey || apiKey || geminiConventionApiKey();
  const resolvedScaleApiKey = scaleApiKey || apiKey || geminiScaleApiKey();
  const resolvedCctModel = cctModel || model || geminiConventionModel();
  const resolvedScaleModel = scaleModel || model || geminiScaleModel();
  const models = providedModels || geminiModelList(resolvedCctModel, cctFallbackModels.length ? cctFallbackModels : fallbackModels);
  const scaleModels = providedModels || geminiModelList(resolvedScaleModel, scaleFallbackModels.length ? scaleFallbackModels : fallbackModels);
  const allScalePdfs = scalePdfs.length ? scalePdfs : (scalePdf ? [scalePdf] : []);
  const allFiles = [cctPdf, ...allScalePdfs].filter(Boolean);
  const inputDocuments = [
    ...(cctPdf ? [{ file: cctPdf, role: "cctPdf" }] : []),
    ...allScalePdfs.map((file) => ({ file, role: "scalePdf" }))
  ];
  if (!inputDocuments.length && markdownText) {
    inputDocuments.push({
      file: { sourceFileName: isScaleExtraction ? "escala-texto-extraido" : "cct-texto-extraido" },
      role: isScaleExtraction ? "scalePdf" : "cctPdf",
      text: String(markdownText)
    });
  }
  const preparedDocuments = await Promise.all(inputDocuments.map(async (document, index) => ({
    ...document,
    documentId: `documento-${index + 1}`,
    text: document.text ?? await extractDocumentText(document.file)
  })));
  const preparedText = (documents) => documents
    .filter((document) => document.text)
    .map((document) => `## ${document.file.sourceFileName || "documento"}\n\n${document.text}`)
    .join("\n\n---\n\n");
  const combinedText = markdownText || preparedText(preparedDocuments);
  if (isScaleExtraction) {
    return extractWithFallback({
      apiKey: resolvedScaleApiKey,
      models: scaleModels,
      isScaleExtraction: true,
      payload: {
        markdownText: combinedText,
        files: allFiles,
        draftName,
        notes,
        baseCategories,
        baseConcepts
      }
    });
  }
  const documentClassification = await classifyLaborDocuments({
    apiKey,
    models,
    documents: preparedDocuments
  });
  const useCct = documentClassification.usar_prompt_cct !== false;
  const useScale = documentClassification.usar_prompt_escalas === true;
  const classificationFor = (document) => documentClassification.documentos.find((item) => item.document_id === document.documentId);
  const conventionDocuments = preparedDocuments.filter((document) => {
    const classification = classificationFor(document);
    return classification?.usar_prompt_cct || (useCct && classification?.clasificacion === "HOMOLOGACION_COMPLEMENTARIA");
  });
  const scaleDocuments = preparedDocuments.filter((document) => classificationFor(document)?.usar_prompt_escalas);

  let conventionResult = { parsed: normalizeConvention({}, { fallbackName: draftName }), tokenUsage: null };
  let scaleResult = { parsed: normalizeConvention({}, { fallbackName: draftName }), tokenUsage: null };

  if (useCct) {
    conventionResult = await extractWithFallback({
      apiKey: resolvedCctApiKey,
      models,
      isScaleExtraction: false,
      payload: {
        markdownText: preparedText(conventionDocuments) || combinedText,
        files: conventionDocuments.map((document) => document.file),
        draftName,
        notes,
        globalLaborLawPdf,
        globalLaborLawText
      }
    });
  }

  if (useScale) {
    const scaleFiles = scaleDocuments.map((document) => document.file);
    scaleResult = await extractWithFallback({
      apiKey: resolvedScaleApiKey,
      models: scaleModels,
      isScaleExtraction: true,
      payload: {
        markdownText: preparedText(scaleDocuments) || await textFromFiles(scaleFiles),
        files: scaleFiles,
        draftName,
        notes,
        baseCategories: conventionResult.parsed?.categorias || [],
        baseConcepts: conventionResult.parsed?.conceptos || []
      }
    });
  }

  const parsedConvention = normalizeConvention({
    ...conventionResult.parsed,
    convenio: { ...(scaleResult.parsed?.convenio || {}), ...(conventionResult.parsed?.convenio || {}) },
    ambitos: mergeUnique(conventionResult.parsed?.ambitos, scaleResult.parsed?.ambitos, "ambito_id"),
    categorias: mergeUnique(conventionResult.parsed?.categorias, scaleResult.parsed?.categorias, "categoria_id"),
    conceptos: mergeUnique(conventionResult.parsed?.conceptos, scaleResult.parsed?.conceptos, "concepto_id"),
    escalas: scaleResult.parsed?.escalas?.length ? scaleResult.parsed.escalas : (conventionResult.parsed?.escalas || []),
    adicionales: mergeUnique(conventionResult.parsed?.adicionales, scaleResult.parsed?.adicionales, "adicional_id")
  }, { fallbackName: draftName });

  parsedConvention.clasificacionDocumental = documentClassification;
  return {
    parsedConvention,
    parsed: parsedConvention,
    documentClassification,
    laborLawStatus: {
      available: Boolean(globalLaborLawPdf || globalLaborLawText),
      sourceFileName: globalLaborLawPdf?.sourceFileName || "Ley de Trabajo Aplicable",
      mode: globalLaborLawText ? "edited_text" : (globalLaborLawPdf ? "gemini_file" : "none"),
      used: Boolean(useCct && (globalLaborLawPdf || globalLaborLawText)),
      readable: Boolean(globalLaborLawPdf || globalLaborLawText),
      message: globalLaborLawPdf || globalLaborLawText
        ? "Ley de Trabajo Aplicable usada como contexto complementario."
        : "No hay Ley de Trabajo Aplicable cargada."
    },
    tokenUsage: mergeTokenUsage(documentClassification.tokenUsage, conventionResult.tokenUsage, scaleResult.tokenUsage),
    model: models[0],
    modelsTried: models
  };
}

module.exports = { GeminiConventionError, extractConventionFromPdfs };
