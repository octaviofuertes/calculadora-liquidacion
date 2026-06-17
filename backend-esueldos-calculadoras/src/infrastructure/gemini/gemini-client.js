const { GoogleGenAI } = require("@google/genai");

function createGeminiClient({ apiKey }) {
  if (!apiKey) {
    const error = new Error("Falta API key de Gemini");
    error.status = 500;
    throw error;
  }

  return new GoogleGenAI({ apiKey });
}

module.exports = {
  createGeminiClient
};
