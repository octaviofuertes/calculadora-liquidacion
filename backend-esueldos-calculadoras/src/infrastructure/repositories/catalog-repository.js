const legacyCatalogRepository = require("../../repositories/catalog-repository");

function createCatalogRepository({ getDb }) {
  function db() {
    return getDb();
  }

  return {
    getCatalog: () => legacyCatalogRepository.getCatalogPayload(db()),
    listConventions: () => legacyCatalogRepository.listConventions(db()),
    getConventionById: (id) => legacyCatalogRepository.getConventionById(db(), id),

    async deleteConventionWithScales(conventionId) {
      const database = db();
      const convention = await database.collection("conventions").findOne({ id: conventionId });
      if (!convention) return { status: "not_found" };

      const totalConventions = await database.collection("conventions").countDocuments();
      if (totalConventions <= 1) return { status: "last_convention" };

      const conventionResult = await database.collection("conventions").deleteOne({ id: conventionId });
      const scalesResult = await database.collection("salaryScales").deleteMany({ conventionId });

      return {
        status: "deleted",
        deletedConventionId: conventionId,
        deletedScales: scalesResult.deletedCount || 0,
        deletedCount: conventionResult.deletedCount || 0
      };
    }
  };
}

module.exports = {
  createCatalogRepository
};
