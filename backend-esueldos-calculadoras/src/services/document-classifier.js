const { askGemini } = require("../leia");
const { buildClassifierPrompt } = require("./convention-prompts");

/**
 * Intenta parsear una respuesta JSON de Gemini, manejando casos donde no es un JSON válido.
 * @param {string} text - El texto de respuesta de Gemini.
 * @returns {object | null} - El objeto JSON parseado o null si falla.
 */
function safeJsonParse(text) {
  try {
    // Busca el bloque de código JSON si Gemini lo envuelve en markdown
    const match = text.match(/```json\n([\s\S]*?)\n```/);
    const jsonString = match ? match[1] : text;
    return JSON.parse(jsonString);
  } catch (error) {
    console.error("Error parsing Gemini JSON response for classification:", error);
    return null;
  }
}

/**
 * Clasifica un documento laboral utilizando Gemini.
 * @param {object} params
 * @param {string} params.apiKey - La API key de Gemini.
 * @param {string} params.model - El modelo de Gemini a utilizar.
 * @param {string[]} params.fallbackModels - Modelos de fallback.
 * @param {string} params.documentText - El texto extraído del documento a clasificar.
 * @returns {Promise<object>} - El resultado de la clasificación.
 */
async function classifyDocument({ apiKey, model, fallbackModels, documentText }) {
  const systemInstruction = buildClassifierPrompt();
  
  // Acortamos el texto para no exceder los límites del clasificador
  const textSnippet = documentText.slice(0, 4000);

  const { answer } = await askGemini({
    apiKey,
    model,
    fallbackModels,
    systemInstruction,
    message: `Por favor, clasifica el siguiente documento:\n\n---INICIO DEL DOCUMENTO---\n${textSnippet}\n---FIN DEL DOCUMENTO---`,
    maxOutputTokens: 1024,
    temperature: 0.1,
  });

  const classificationResult = safeJsonParse(answer);

  return classificationResult || { classification: "DOCUMENTO_NO_APTO", motivo: "La respuesta del clasificador no fue un JSON válido." };
}

module.exports = { classifyDocument };