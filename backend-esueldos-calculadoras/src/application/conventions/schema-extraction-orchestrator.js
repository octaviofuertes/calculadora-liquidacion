function createSchemaExtractionOrchestrator({ agents, conventionBuilder }) {
  return {
    async execute(context) {
      const metadata = await agents.metadata.extract(context);
      const categories = await agents.categories.extract(context);
      const concepts = await agents.concepts.extract(context);
      const licenses = await agents.licenses.extract(context);

      return {
        parts: { metadata, categories, concepts, licenses },
        convenio: conventionBuilder.build({ metadata, categories, concepts, licenses })
      };
    }
  };
}

module.exports = {
  createSchemaExtractionOrchestrator
};
