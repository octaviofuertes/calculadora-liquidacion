const { geminiModelList } = require("../gemini-config");
const { GeminiConventionError, extractPdfText, buildPdfPartsForGemini, callGeminiJson } = require("./convention-gemini");
const { buildClassifierPrompt, buildConventionPrompt, buildScalePrompt, buildScaleCompactPrompt } = require("./convention-prompts");
const { normalizeConvention } = require("./convention-normalizers");

function hasScaleValues(parsed = {}) {
  return Array.isArray(parsed.escalas) && parsed.escalas.some((scale) => (
    Array.isArray(scale?.valores) && scale.valores.some((value) => value && value.valor !== null && value.valor !== undefined && value.valor !== "")
  ));
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

function fallbackClassification({ cctPdf, scalePdfs, text }) {
  const hasCct = Boolean(cctPdf);
  const hasScale = Boolean(scalePdfs?.length);
  const hasText = Boolean(String(text || "").trim());
  if (!hasText) {
    return {
      clasificacion: "REQUIERE_OCR",
      usar_prompt_cct: hasCct,
      usar_prompt_escalas: hasScale,
      requiere_ocr: true,
      requiere_revision_humana: true,
      motivo: "No se pudo extraer texto local suficiente; se intenta con Gemini y revision humana.",
      datos_detectados: {},
      accion_recomendada: "Usar Gemini con el archivo original y revisar resultado."
    };
  }
  return {
    clasificacion: hasCct && hasScale ? "DOCUMENTO_MIXTO" : (hasScale ? "ESCALA_SALARIAL" : "CCT_CONVENIO"),
    usar_prompt_cct: hasCct || !hasScale,
    usar_prompt_escalas: hasScale,
    requiere_ocr: false,
    requiere_revision_humana: true,
    motivo: "Clasificacion tecnica por campos cargados; Gemini clasificador no fue concluyente.",
    datos_detectados: {},
    accion_recomendada: "Procesar con los prompts correspondientes y auditar."
  };
}

async function textFromFiles(files = []) {
  const chunks = await Promise.all(files.map(async (file) => {
    const text = await extractPdfText(file);
    return text ? `## ${file.sourceFileName || "documento"}\n\n${text}` : "";
  }));
  return chunks.filter(Boolean).join("\n\n---\n\n");
}

async function classifyLaborDocuments({ apiKey, model, files, text, cctPdf, scalePdfs }) {
  const parts = [
    { text: buildClassifierPrompt() },
    { text: `Texto extraido para clasificar:\n\n${String(text || "").slice(0, 12000)}` }
  ];
  const fileParts = await buildPdfPartsForGemini({ apiKey, files, role: "DOCUMENTO A CLASIFICAR" });
  parts.push(...fileParts.parts);
  try {
    const result = await callGeminiJson({ apiKey, model, label: "clasificador-documental", parts });
    return {
      ...fallbackClassification({ cctPdf, scalePdfs, text }),
      ...(result.parsed || {}),
      tokenUsage: result.tokenUsage || null
    };
  } catch (error) {
    console.warn(`[CCT classifier] No se pudo clasificar con Gemini: ${error.message}`);
    return fallbackClassification({ cctPdf, scalePdfs, text });
  }
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
  let result = await callGeminiJson({
    apiKey,
    model,
    label: "escala-rag",
    parts: [
      { text: buildScalePrompt({ draftName, notes, baseCategories, baseConcepts }) },
      { text: `Texto de la escala:\n\n${markdownText || ""}` },
      ...fileParts.parts
    ]
  });
  if (!hasScaleValues(result.parsed)) {
    const compactResult = await callGeminiJson({
      apiKey,
      model,
      label: "escala-rag-compact",
      parts: [
        { text: buildScaleCompactPrompt({ draftName, notes, baseCategories, baseConcepts }) },
        { text: `Texto de la escala:\n\n${markdownText || ""}` },
        ...fileParts.parts
      ]
    });
    if (hasScaleValues(compactResult.parsed)) result = compactResult;
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
  const models = providedModels || geminiModelList(model, fallbackModels);
  const allScalePdfs = scalePdfs.length ? scalePdfs : (scalePdf ? [scalePdf] : []);
  const allFiles = [cctPdf, ...allScalePdfs].filter(Boolean);
  const combinedText = markdownText || await textFromFiles(allFiles);
  if (isScaleExtraction) {
    return extractWithFallback({
      apiKey,
      models,
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
    model: models[0],
    files: allFiles,
    text: combinedText,
    cctPdf,
    scalePdfs: allScalePdfs
  });
  const useCct = documentClassification.usar_prompt_cct !== false;
  const useScale = documentClassification.usar_prompt_escalas === true || allScalePdfs.length > 0;

  let conventionResult = { parsed: normalizeConvention({}, { fallbackName: draftName }), tokenUsage: null };
  let scaleResult = { parsed: normalizeConvention({}, { fallbackName: draftName }), tokenUsage: null };

  if (useCct) {
    conventionResult = await extractWithFallback({
      apiKey,
      models,
      isScaleExtraction: false,
      payload: {
        markdownText: combinedText,
        files: cctPdf ? [cctPdf] : allFiles,
        draftName,
        notes,
        globalLaborLawPdf,
        globalLaborLawText
      }
    });
  }

  if (useScale) {
    const scaleFiles = allScalePdfs.length ? allScalePdfs : allFiles;
    scaleResult = await extractWithFallback({
      apiKey,
      models,
      isScaleExtraction: true,
      payload: {
        markdownText: await textFromFiles(scaleFiles),
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
