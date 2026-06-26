const { GeminiConventionError, parseGeminiJson, extractPdfText, callGeminiJson } = require("./convention-gemini");
const { buildConventionPrompt, buildConventionCorePrompt, buildScalePrompt, buildScaleCompactPrompt } = require("./convention-prompts");
const { normalizeConvention } = require("./convention-normalizers");
const { geminiModelList, geminiAuditorApiKey, geminiAuditorModels } = require("../gemini-config");

function chunkText(text, chunkSize = 1500, overlap = 300) {
  if (!text) return [];
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + chunkSize));
    i += chunkSize - overlap;
  }
  return chunks;
}

async function generateEmbeddings(texts, apiKey) {
  const { GoogleGenAI } = require("@google/genai");
  const ai = new GoogleGenAI({ apiKey });
  const embeddings = [];
  for (const text of texts) {
    try {
      const response = await ai.models.embedContent({ model: "gemini-embedding-001", contents: text });
      embeddings.push(response.embeddings[0].values);
    } catch {
      embeddings.push(new Array(768).fill(0));
    }
  }
  return embeddings;
}

function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i += 1) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  return !normA || !normB ? 0 : dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function retrieveContext(query, chunks, embeddings, apiKey, topK = 15) {
  if (!chunks.length) return "";
  const { GoogleGenAI } = require("@google/genai");
  const ai = new GoogleGenAI({ apiKey });
  let queryEmbedding;
  try {
    const response = await ai.models.embedContent({ model: "gemini-embedding-001", contents: query });
    queryEmbedding = response.embeddings[0].values;
  } catch {
    return chunks.slice(0, topK).join("\n\n---\n\n");
  }
  const queryTokens = new Set(String(query || "").toLowerCase().match(/[a-z0-9]+/g) || []);
  const scored = chunks.map((chunk, i) => {
    const text = String(chunk || "").toLowerCase();
    const textTokens = text.match(/[a-z0-9]+/g) || [];
    const overlap = textTokens.reduce((acc, token) => acc + (queryTokens.has(token) ? 1 : 0), 0);
    const numericHits = (String(query || "").match(/\b\d+(?:[.,]\d+)?\b/g) || []).reduce((acc, number) => acc + (text.includes(number) ? 1 : 0), 0);
    const semantic = cosineSimilarity(queryEmbedding, embeddings[i]);
    return { chunk, score: (semantic * 0.65) + Math.min(0.25, overlap / 120) + Math.min(0.1, numericHits / 20) };
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, topK).map((s) => s.chunk).join("\n\n---\n\n");
}

async function requestConventionOnce({ apiKey, model, cctMarkdown, draftName, notes }) {
  const result = await callGeminiJson({
    apiKey,
    model,
    label: "convenio-rag",
    parts: [{ text: buildConventionPrompt({ draftName, notes }) }, { text: `Texto del CCT:\n\n${cctMarkdown || ""}` }]
  });
  console.log(`[CCT parse] categorias=${result.parsed?.categorias?.length || 0} conceptos=${result.parsed?.conceptos?.length || 0} escalas=${result.parsed?.escalas?.length || 0} adicionales=${result.parsed?.adicionales?.length || 0}`);
  return { ...result, parsed: normalizeConvention(result.parsed, { fallbackName: draftName }) };
}

function hasScaleValues(parsed = {}) {
  return Array.isArray(parsed.escalas) && parsed.escalas.some((scale) => Array.isArray(scale?.valores) && scale.valores.some((value) => value && (value.valor !== null && value.valor !== undefined && value.valor !== "")));
}

async function requestScaleOnce({ apiKey, model, scaleMarkdown, draftName, notes, baseCategories = [], baseConcepts = [] }) {
  let result = await callGeminiJson({
    apiKey,
    model,
    label: "escala-rag",
    parts: [{ text: buildScalePrompt({ draftName, notes, baseCategories, baseConcepts }) }, { text: `Texto de la escala:\n\n${scaleMarkdown || ""}` }]
  });
  console.log(`[CCT scale parse] categorias=${result.parsed?.categorias?.length || 0} conceptos=${result.parsed?.conceptos?.length || 0} escalas=${result.parsed?.escalas?.length || 0} adicionales=${result.parsed?.adicionales?.length || 0}`);
  if (!hasScaleValues(result.parsed)) {
    const compactResult = await callGeminiJson({
      apiKey,
      model,
      label: "escala-rag-compact",
      parts: [{ text: buildScaleCompactPrompt({ draftName, notes, baseCategories, baseConcepts }) }, { text: `Texto de la escala:\n\n${scaleMarkdown || ""}` }]
    });
    console.log(`[CCT scale compact parse] categorias=${compactResult.parsed?.categorias?.length || 0} conceptos=${compactResult.parsed?.conceptos?.length || 0} escalas=${compactResult.parsed?.escalas?.length || 0} adicionales=${compactResult.parsed?.adicionales?.length || 0}`);
    if (hasScaleValues(compactResult.parsed)) result = compactResult;
    else if ((compactResult.parsed?.escalas || []).length > (result.parsed?.escalas || []).length) result = compactResult;
  }
  return { ...result, parsed: normalizeConvention(result.parsed, { fallbackName: draftName }) };
}

async function extractConventionFromPdfs({ apiKey, model, fallbackModels, cctPdf, scalePdf, scalePdfs = [], draftName, notes, globalLaborLawPdf, globalLaborLawText = "" }) {
  const allScalePdfs = scalePdfs.length ? scalePdfs : (scalePdf ? [scalePdf] : []);
  const cctText = await extractPdfText(cctPdf);
  const laborLawText = String(globalLaborLawText || "").trim() || (globalLaborLawPdf ? await extractPdfText(globalLaborLawPdf) : "");
  const scaleText = (await Promise.all(allScalePdfs.map(extractPdfText))).filter(Boolean).join("\n\n");
  const cctContext = cctText ? await retrieveContext(`CCT ${draftName || ""} ${notes || ""}`, chunkText(cctText, 2000, 400), await generateEmbeddings(chunkText(cctText, 2000, 400), apiKey), apiKey, 22) : "";
  const laborLawContext = laborLawText ? await retrieveContext("Ley laboral general supletoria", chunkText(laborLawText, 2200, 350), await generateEmbeddings(chunkText(laborLawText, 2200, 350), apiKey), apiKey, 12) : "";
  const scaleContext = scaleText ? await retrieveContext("Escala salarial, importes y categorias", chunkText(scaleText, 2000, 300), await generateEmbeddings(chunkText(scaleText, 2000, 300), apiKey), apiKey, 22) : "";
  const cctSource = cctContext && cctContext.trim().length >= 800 ? cctContext : cctText;
  const scaleSource = scaleContext && scaleContext.trim().length >= 800
    ? `${scaleContext}\n\n---\n\nTEXTO COMPLETO DE ESCALA:\n${scaleText}`
    : scaleText;
  const laborLawSource = laborLawContext && laborLawContext.trim().length >= 800 ? laborLawContext : laborLawText;
  const models = geminiModelList(model, fallbackModels);
  let conventionResult;
  let lastError;
  for (const currentModel of models) {
    try {
      conventionResult = await requestConventionOnce({
        apiKey,
        model: currentModel,
        draftName,
        notes,
        cctMarkdown: `FUENTE PRIORITARIA - CCT/ACTAS:\n${cctSource}\n\nFUENTE SUPLETORIA - LEY DE TRABAJO:\n${laborLawSource}`
      });
      break;
    } catch (error) {
      lastError = error;
      if (!/high demand|unavailable|overloaded|try again later|503/i.test(String(error.message || ""))) throw error;
    }
  }
  if (!conventionResult) throw lastError || new GeminiConventionError("No se pudo estructurar el convenio.");

  let scaleResult;
  lastError = null;
  for (const currentModel of models) {
    try {
      scaleResult = await requestScaleOnce({
        apiKey,
        model: currentModel,
        draftName,
        notes,
        scaleMarkdown: `FUENTE PRIORITARIA - ESCALA SALARIAL:\n${scaleSource}`,
        baseCategories: conventionResult.parsed?.categorias || [],
        baseConcepts: conventionResult.parsed?.conceptos || []
      });
      break;
    } catch (error) {
      lastError = error;
      if (!/high demand|unavailable|overloaded|try again later|503/i.test(String(error.message || ""))) throw error;
    }
  }
  if (!scaleResult) throw lastError || new GeminiConventionError("No se pudo estructurar la escala.");
  const merged = normalizeConvention({
    ...conventionResult.parsed,
    categorias: [...(conventionResult.parsed?.categorias || []), ...(scaleResult.parsed?.categorias || [])],
    conceptos: [...(conventionResult.parsed?.conceptos || []), ...(scaleResult.parsed?.conceptos || [])],
    escalas: scaleResult.parsed?.escalas?.length ? scaleResult.parsed.escalas : (conventionResult.parsed?.escalas || []),
    adicionales: [...(conventionResult.parsed?.adicionales || []), ...(scaleResult.parsed?.adicionales || [])]
  }, { fallbackName: draftName });
  return {
    parsedConvention: merged,
    tokenUsage: {
      promptTokenCount: (conventionResult.tokenUsage?.promptTokenCount || 0) + (scaleResult.tokenUsage?.promptTokenCount || 0),
      candidatesTokenCount: (conventionResult.tokenUsage?.candidatesTokenCount || 0) + (scaleResult.tokenUsage?.candidatesTokenCount || 0),
      totalTokenCount: (conventionResult.tokenUsage?.totalTokenCount || 0) + (scaleResult.tokenUsage?.totalTokenCount || 0)
    },
    model: conventionResult.model || models[0],
    modelsTried: models
  };
}

module.exports = { GeminiConventionError, extractConventionFromPdfs };
