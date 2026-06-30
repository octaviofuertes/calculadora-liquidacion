const { GeminiConventionError, extractConventionFromPdfs } = require("./convention-rag-classified");
const { normalizeConvention } = require("./convention-normalizers");
const { buildConventionPrompt, buildScalePrompt, buildScaleCompactPrompt } = require("./convention-prompts");
const { sanitizeGenericConventionCategories } = require("./convention-generic");
const { classifyDocument } = require("./document-classifier");
const { extractPdfText } = require("./convention-gemini");
const { geminiModelList } = require("../gemini-config");
const UNIVERSAL_CONVENTION_TEMPLATE = require("../../convenio-universal-template.json");

/**
 * Procesa y estructura un conjunto de documentos laborales (PDFs) utilizando un flujo de IA.
 * 1. Extrae el texto de todos los PDFs.
 * 2. Clasifica el contenido para determinar el tipo de documento.
 * 3. Ejecuta los prompts de extracción correspondientes (CCT, Escala o ambos).
 * 4. Normaliza y fusiona los resultados en un único JSON estructurado.
 *
 * @param {object} params Parámetros para el procesamiento.
 * @returns {Promise<object>} Un objeto con el convenio parseado, uso de tokens y el resultado de la clasificación.
 */
async function processAndStructureConvention({ apiKey, model, fallbackModels, cctPdf, scalePdf, scalePdfs = [], draftName, notes }) {
  const allPdfs = [cctPdf, scalePdf, ...scalePdfs].filter(Boolean);
  if (!allPdfs.length) {
    throw new GeminiConventionError("No se proporcionaron archivos PDF para procesar.", { status: 400 });
  }

  // 1. Extracción de texto de todos los documentos
  const allTexts = await Promise.all(allPdfs.map(pdf => extractPdfText(pdf)));
  const combinedText = allTexts.join("\n\n--- NUEVO DOCUMENTO ---\n\n");

  if (!combinedText.trim()) {
     return {
      classification: { clasificacion: "DOCUMENTO_NO_APTO", motivo: "Los PDFs están vacíos o no se pudo extraer texto." },
      parsedConvention: normalizeConvention({ convenio: { denominacion: draftName } }),
      tokenUsage: { totalTokenCount: 0 }
    };
  }

  // 2. Clasificación del documento
  const classification = await classifyDocument({
    apiKey,
    model,
    fallbackModels,
    documentText: combinedText,
  });

  const {
    clasificacion,
    usar_prompt_cct: useCct,
    usar_prompt_escalas: useScale
  } = classification;

  if (!useCct && !useScale) {
    console.log(`[CCT AI] Clasificación: ${clasificacion}. No se requiere procesamiento adicional.`);
    return {
      classification,
      parsedConvention: normalizeConvention({ convenio: { denominacion: draftName, ...classification.datos_detectados } }),
      tokenUsage: { totalTokenCount: 0 } // La clasificación consume tokens, pero lo omitimos aquí por simplicidad.
    };
  }

  // 3. Ejecución de prompts según clasificación
  console.log(`[CCT AI] Clasificación: ${clasificacion}. Usar CCT: ${useCct}, Usar Escalas: ${useScale}`);
  const models = geminiModelList(model, fallbackModels);

  const cctPayload = { apiKey, models, draftName, notes, markdownText: combinedText };
  const scalePayload = { ...cctPayload, baseCategories: [], baseConcepts: [] };

  let conventionResult = { parsed: {}, tokenUsage: { totalTokenCount: 0 } };
  let scaleResult = { parsed: {}, tokenUsage: { totalTokenCount: 0 } };

  if (useCct) {
    conventionResult = await extractConventionFromPdfs(cctPayload);
    // Usamos los resultados del CCT como base para la extracción de la escala
    scalePayload.baseCategories = conventionResult.parsed?.categorias || [];
    scalePayload.baseConcepts = conventionResult.parsed?.conceptos || [];
  }

  if (useScale) {
    scaleResult = await extractConventionFromPdfs({ ...scalePayload, isScaleExtraction: true });
  }

  // 4. Fusión y normalización de resultados
  const merged = normalizeConvention({
    ...conventionResult.parsed,
    // Si solo se procesó la escala, sus categorías y conceptos son los únicos que existen.
    categorias: useCct ? [...(conventionResult.parsed?.categorias || []), ...(scaleResult.parsed?.categorias || [])] : scaleResult.parsed?.categorias,
    conceptos: useCct ? [...(conventionResult.parsed?.conceptos || []), ...(scaleResult.parsed?.conceptos || [])] : scaleResult.parsed?.conceptos,
    escalas: scaleResult.parsed?.escalas?.length ? scaleResult.parsed.escalas : (conventionResult.parsed?.escalas || []),
    adicionales: useCct ? [...(conventionResult.parsed?.adicionales || []), ...(scaleResult.parsed?.adicionales || [])] : scaleResult.parsed?.adicionales,
  }, { fallbackName: draftName });

  return {
    classification,
    parsedConvention: merged,
    tokenUsage: {
      totalTokenCount: (conventionResult.tokenUsage?.totalTokenCount || 0) + (scaleResult.tokenUsage?.totalTokenCount || 0)
    },
  };
}

module.exports = {
  GeminiConventionError,
  processAndStructureConvention,
  normalizeConvention,
  buildConventionPrompt,
  buildScalePrompt,
  buildScaleCompactPrompt,
  sanitizeGenericConventionCategories,
  UNIVERSAL_CONVENTION_TEMPLATE
};
