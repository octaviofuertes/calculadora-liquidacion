function extractJson(text) {
  const raw = String(text || "").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (error) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw error;
    return JSON.parse(match[0]);
  }
}

function createGeminiRagService({ client, model, fileSearchStoreName }) {
  return {
    async generateJson({ prompt, metadataFilter }) {
      const response = await client.models.generateContent({
        model,
        contents: prompt,
        config: {
          tools: [
            {
              fileSearch: {
                fileSearchStoreNames: [fileSearchStoreName],
                ...(metadataFilter ? { metadataFilter } : {})
              }
            }
          ]
        }
      });

      return extractJson(response.text);
    }
  };
}

module.exports = {
  createGeminiRagService,
  extractJson
};
