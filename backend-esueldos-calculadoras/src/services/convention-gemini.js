const pdfParse = require("pdf-parse");

const useGeminiFilesApi = String(process.env.GEMINI_USE_FILES_API || "true").toLowerCase() !== "false";
class GeminiConventionError extends Error {
  constructor(message, { status, model, code, modelsTried } = {}) {
    super(message);
    this.name = "GeminiConventionError";
    this.status = status;
    this.model = model;
    this.code = code;
    this.modelsTried = modelsTried || [];
  }
}

function stripJsonFences(text) {
  const raw = String(text || "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  return extractBalancedJson(raw) || raw;
}

function extractBalancedJson(raw) {
  const start = String(raw || "").indexOf("{");
  if (start < 0) return "";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return raw.slice(start, index + 1);
  }
  return "";
}

function cleanJsonText(value) {
  return String(value || "")
    .replace(/^\uFEFF/, "")
    .replace(/,\s*([}\]])/g, "$1")
    .trim();
}

function closeTruncatedJson(value) {
  const raw = String(value || "");
  const start = raw.indexOf("{");
  if (start < 0) return "";
  const stack = [];
  let inString = false;
  let escaped = false;
  let out = raw.slice(start);
  for (let index = 0; index < out.length; index += 1) {
    const char = out[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") stack.push("}");
    else if (char === "[") stack.push("]");
    else if ((char === "}" || char === "]") && stack[stack.length - 1] === char) stack.pop();
  }
  if (inString) out += "\"";
  out = out
    .replace(/,\s*"[^"]*"\s*:\s*$/, "")
    .replace(/"[^"]*"\s*:\s*$/, "")
    .replace(/,\s*"[^"]*"\s*$/, "")
    .replace(/,\s*$/, "")
    .replace(/,\s*([}\]])/g, "$1");
  while (stack.length) out += stack.pop();
  return cleanJsonText(out);
}

function parseGeminiJson(text) {
  const jsonText = cleanJsonText(stripJsonFences(text));
  try {
    return JSON.parse(jsonText);
  } catch (error) {
    const repaired = closeTruncatedJson(jsonText);
    if (repaired && repaired !== jsonText) {
      try {
        console.warn("[Gemini JSON] Respuesta truncada reparada parcialmente.");
        return JSON.parse(repaired);
      } catch (_) {
        // fall through to the detailed invalid JSON error
      }
    }
    console.error("[Gemini JSON invalido] inicio:", String(text || "").slice(0, 800));
    console.error("[Gemini JSON invalido] fin:", String(text || "").slice(-800));
    throw new GeminiConventionError("Gemini no devolvio un JSON valido para el convenio.", {
      status: 502,
      code: "INVALID_JSON"
    });
  }
}

function extractGeminiText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts || [];
  return parts.map((part) => part.text || "").join("").trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pdfInlinePart(file) {
  return {
    inlineData: {
      mimeType: file.mimeType || "application/pdf",
      data: Buffer.isBuffer(file.buffer) ? file.buffer.toString("base64") : Buffer.from(file.buffer || "").toString("base64")
    }
  };
}

function pdfFilePart(file, uploadedFile) {
  return {
    fileData: {
      mimeType: uploadedFile.mimeType || uploadedFile.mime_type || file.mimeType || "application/pdf",
      fileUri: uploadedFile.uri
    }
  };
}

function normalizeGeminiModelName(model) {
  const raw = String(model || "").trim();
  if (!raw) return "gemini-2.5-flash";
  if (/^models\//.test(raw)) return raw.replace(/^models\//, "");
  if (/^(tunedModels\/|projects\/|publishers\/)/.test(raw)) return raw;
  return raw;
}

async function extractPdfText(file) {
  if (!file?.buffer || !String(file.mimeType || "").includes("pdf")) return "";
  try {
    const result = await pdfParse(file.buffer);
    return String(result?.text || "").trim();
  } catch (error) {
    console.warn(`[PDF texto] No se pudo leer ${file.sourceFileName || "archivo.pdf"}: ${error.message}`);
    return "";
  }
}

async function extractDocumentText(file) {
  if (!file?.buffer) return "";
  const fileName = String(file.sourceFileName || "").toLowerCase();
  const mimeType = String(file.mimeType || "").toLowerCase();
  if (mimeType.includes("pdf") || fileName.endsWith(".pdf")) return extractPdfText(file);
  if (mimeType.includes("wordprocessingml") || fileName.endsWith(".docx")) {
    try {
      const mammoth = require("mammoth");
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      return String(result?.value || "").trim();
    } catch (error) {
      console.warn(`[DOCX texto] No se pudo leer ${file.sourceFileName || "archivo.docx"}: ${error.message}`);
    }
  }
  return "";
}

function supportsGeminiDocumentPart(file = {}) {
  const mimeType = String(file.mimeType || "").toLowerCase();
  const fileName = String(file.sourceFileName || "").toLowerCase();
  return mimeType.includes("pdf") || mimeType.startsWith("image/") || /\.(pdf|jpe?g|png|webp)$/.test(fileName);
}

async function getGeminiFile({ apiKey, name }) {
  const { GoogleGenAI } = require("@google/genai");
  const ai = new GoogleGenAI({ apiKey });
  return ai.files.get({ name });
}

async function waitGeminiFileActive({ apiKey, file }) {
  const { GoogleGenAI } = require("@google/genai");
  const ai = new GoogleGenAI({ apiKey });
  let current = file;
  const maxPolls = Number(process.env.GEMINI_FILE_MAX_POLLS || 24);
  const pollMs = Number(process.env.GEMINI_FILE_POLL_MS || 5000);
  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    if (!current?.state || current.state === "ACTIVE") return current;
    if (current.state === "FAILED") {
      throw new GeminiConventionError(`Gemini no pudo procesar el archivo ${current.displayName || current.name}.`, {
        status: 502,
        code: "FILE_PROCESSING_FAILED"
      });
    }
    console.log(`[Gemini Files] current file status: ${current.state}`);
    console.log('File is still processing, retrying in 5 seconds');
    await sleep(pollMs);
    current = await getGeminiFile({ apiKey, name: current.name });
  }
  throw new GeminiConventionError(`Gemini tardo demasiado en procesar el archivo ${file.displayName || file.name}.`, {
    status: 504,
    code: "FILE_PROCESSING_TIMEOUT"
  });
}

async function uploadGeminiFile({ apiKey, file, displayName }) {
  const { GoogleGenAI } = require("@google/genai");
  const ai = new GoogleGenAI({ apiKey });
  const mimeType = file.mimeType || "application/pdf";
  const buffer = Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(file.buffer || "");
  const fileBlob = new Blob([buffer], { type: mimeType });
  const uploadedFile = await ai.files.upload({
    file: fileBlob,
    config: {
      displayName: displayName || file.sourceFileName || "documento.pdf"
    }
  });
  return waitGeminiFileActive({ apiKey, file: uploadedFile });
}

async function buildPdfPartsForGemini({ apiKey, files, role }) {
  const parts = [];
  let uploaded = 0;
  let inlined = 0;
  for (const file of (files || []).filter((item) => item?.buffer && supportsGeminiDocumentPart(item))) {
    parts.push({ text: `${role}. Nombre: ${file.sourceFileName || "archivo.pdf"}` });
    if (useGeminiFilesApi) {
      try {
        const uploadedFile = await uploadGeminiFile({
          apiKey,
          file,
          displayName: `${role} - ${file.sourceFileName || "archivo.pdf"}`
        });
        parts.push(pdfFilePart(file, uploadedFile));
        uploaded += 1;
        continue;
      } catch (error) {
        console.warn(`[Gemini Files] No se pudo subir ${file.sourceFileName || "archivo.pdf"}: ${error.message}. Se usa inline_data.`);
      }
    }
    parts.push(pdfInlinePart(file));
    inlined += 1;
  }
  return { parts, uploaded, inlined };
}

async function callGeminiJson({ apiKey, model, parts, label }) {
  const { GoogleGenAI } = require("@google/genai");
  const ai = new GoogleGenAI({ apiKey });
  const modelName = normalizeGeminiModelName(model);
  const inlineCount = parts.filter((part) => part.inline_data || part.inlineData).length;
  const fileCount = parts.filter((part) => part.file_data || part.fileData).length;
  console.log(`[Gemini ${label}] model=${modelName} files=${fileCount} inline=${inlineCount} partes=${parts.length}`);
  const generationConfig = {
    temperature: 0.08,
    topP: 0.72,
    maxOutputTokens: /clasificador/i.test(label) ? 2000 : (/escala/i.test(label) ? 24000 : 16000),
    responseMimeType: "application/json"
  };
  if (/gemini-2\.5/i.test(modelName)) {
    generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }
  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: parts,
      config: generationConfig
    });

    const text = response.text || "";
    if (!text) {
      throw new GeminiConventionError(`Gemini no devolvio texto para ${label}.`, { status: 502, model: modelName });
    }
    const usage = response.usageMetadata || null;
    return {
      parsed: parseGeminiJson(text),
      tokenUsage: usage ? {
        promptTokenCount: usage.promptTokenCount || 0,
        candidatesTokenCount: usage.candidatesTokenCount || 0,
        totalTokenCount: usage.totalTokenCount || 0
      } : null
    };
  } catch (error) {
    if (error instanceof GeminiConventionError) {
      throw error;
    }
    throw new GeminiConventionError(error.message, {
      status: error.status || 502,
      model: modelName,
      code: error.status
    });
  }
}


module.exports = {
  GeminiConventionError,
  parseGeminiJson,
  extractGeminiText,
  extractPdfText,
  extractDocumentText,
  pdfInlinePart,
  buildPdfPartsForGemini,
  callGeminiJson
};
