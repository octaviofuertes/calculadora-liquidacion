const { GeminiConventionError, parseGeminiJson, extractPdfText, callGeminiJson } = require("./convention-gemini");
const { buildConventionPrompt, buildConventionCorePrompt, buildScalePrompt, buildScaleCompactPrompt } = require("./convention-prompts");
const { normalizeConvention } = require("./convention-normalizers");

function hasScaleValues(parsed = {}) {
  return Array.isArray(parsed.escalas) && parsed.escalas.some((scale) => Array.isArray(scale?.valores) && scale.valores.some((value) => value && (value.valor !== null && value.valor !== undefined && value.valor !== "")));
}

async function requestScaleExtraction({ apiKey, model, markdownText, draftName, notes, baseCategories = [], baseConcepts = [] }) {
  let result = await callGeminiJson({
    apiKey,
    model,
    label: "escala-rag",
    parts: [{ text: buildScalePrompt({ draftName, notes, baseCategories, baseConcepts }) }, { text: `Texto de la escala:\n\n${markdownText || ""}` }]
  });
  console.log(`[CCT scale parse] cats=${result.parsed?.categorias?.length || 0} concepts=${result.parsed?.conceptos?.length || 0} scales=${result.parsed?.escalas?.length || 0}`);
  
  if (!hasScaleValues(result.parsed)) {
    console.log(`[CCT scale parse] La extracción de escala no arrojó valores. Reintentando con prompt compacto.`);
    const compactResult = await callGeminiJson({
      apiKey,
      model,
      label: "escala-rag-compact",
      parts: [{ text: buildScaleCompactPrompt({ draftName, notes, baseCategories, baseConcepts }) }, { text: `Texto de la escala:\n\n${markdownText || ""}` }]
    });
    console.log(`[CCT scale compact parse] cats=${compactResult.parsed?.categorias?.length || 0} concepts=${compactResult.parsed?.conceptos?.length || 0} scales=${compactResult.parsed?.escalas?.length || 0}`);
    if (hasScaleValues(compactResult.parsed)) result = compactResult;
    else if ((compactResult.parsed?.escalas || []).length > (result.parsed?.escalas || []).length) result = compactResult;
  }
  return { ...result, parsed: normalizeConvention(result.parsed, { fallbackName: draftName }) };
}

async function requestConventionExtraction({ apiKey, model, markdownText, draftName, notes }) {
  const result = await callGeminiJson({
    apiKey,
    model,
    label: "convenio-rag",
    parts: [{ text: buildConventionPrompt({ draftName, notes }) }, { text: `Texto del CCT:\n\n${markdownText || ""}` }]
  });
  console.log(`[CCT parse] cats=${result.parsed?.categorias?.length || 0} concepts=${result.parsed?.conceptos?.length || 0} scales=${result.parsed?.escalas?.length || 0}`);
  return { ...result, parsed: normalizeConvention(result.parsed, { fallbackName: draftName }) };
}

async function extractConventionFromPdfs({ apiKey, models, markdownText, draftName, notes, isScaleExtraction = false, baseCategories = [], baseConcepts = [] }) {
  let result;
  let lastError;

  for (const currentModel of models) {
    try {
      if (isScaleExtraction) {
        result = await requestScaleExtraction({ apiKey, model: currentModel, markdownText, draftName, notes, baseCategories, baseConcepts });
      } else {
        result = await requestConventionExtraction({ apiKey, model: currentModel, markdownText, draftName, notes });
      }
      break;
    } catch (error) {
      lastError = error;
      if (!/high demand|unavailable|overloaded|try again later|503/i.test(String(error.message || ""))) throw error;
    }
  }

  if (!result) throw lastError || new GeminiConventionError(`No se pudo estructurar el documento (${isScaleExtraction ? 'escala' : 'convenio'}).`);
  
  return result;
}

module.exports = { GeminiConventionError, extractConventionFromPdfs };
