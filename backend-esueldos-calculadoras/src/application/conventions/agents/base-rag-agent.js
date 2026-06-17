function createBaseRagAgent({ ragService, name, instructions, responseShape }) {
  return {
    async extract(context) {
      const prompt = [
        `Sos ${name}.`,
        instructions,
        "Consultá exclusivamente el RAG provisto. No uses conocimiento externo.",
        "Devolvé SOLO JSON válido. No agregues propiedades fuera del schema pedido.",
        `Schema esperado:\n${JSON.stringify(responseShape, null, 2)}`
      ].join("\n\n");

      return ragService.generateJson({
        prompt,
        metadataFilter: `ingestion_id="${context.ingestionId}"`
      });
    }
  };
}

module.exports = {
  createBaseRagAgent
};
