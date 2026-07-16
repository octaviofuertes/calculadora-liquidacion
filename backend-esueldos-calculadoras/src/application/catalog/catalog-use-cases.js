function createCatalogUseCases({ catalogRepository }) {
  return {
    getCatalog() {
      return catalogRepository.getCatalog();
    },

    listConventions() {
      return catalogRepository.listConventions();
    },

    async getConvention(id) {
      const convention = await catalogRepository.getConventionById(id);
      if (!convention) {
        const error = new Error("Convenio no encontrado");
        error.status = 404;
        throw error;
      }
      return convention;
    },

    async deleteConvention(id) {
      const conventionId = String(id || "").trim();
      if (!conventionId) {
        const error = new Error("Falta id de convenio");
        error.status = 400;
        throw error;
      }

      const result = await catalogRepository.deleteConventionWithScales(conventionId);
      if (result.status === "not_found") {
        const error = new Error("Convenio no encontrado: " + conventionId);
        error.status = 404;
        throw error;
      }
      if (result.status === "last_convention") {
        const error = new Error("No se puede borrar el ultimo convenio disponible.");
        error.status = 409;
        throw error;
      }
      return {
        ok: true,
        deletedConventionId: result.deletedConventionId,
        deletedScales: result.deletedScales,
        deletedCount: result.deletedCount
      };
    }
  };
}

module.exports = {
  createCatalogUseCases
};
