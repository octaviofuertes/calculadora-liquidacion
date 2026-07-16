const { ObjectId } = require("mongodb");
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
      console.log("INTENTANDO BORRAR CONVENIO:", conventionId);
      const database = db();
      
      const sanitizedForCct = conventionId.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const possibleIds = [
        conventionId,
        conventionId.replace(/\s+/g, '_').toLowerCase(),
        sanitizedForCct,
        `cct_${sanitizedForCct}`
      ];

      const conventionFilter = ObjectId.isValid(conventionId)
        ? { $or: [{ id: { $in: possibleIds } }, { _id: new ObjectId(conventionId) }, { _id: { $in: possibleIds } }] }
        : { $or: [{ id: { $in: possibleIds } }, { _id: { $in: possibleIds } }, { "convenio.denominacion": conventionId }] };
        
      const convention = await database.collection("conventions").findOne(conventionFilter);
      if (!convention) return { status: "not_found" };

      const totalConventions = await database.collection("conventions").countDocuments();
      if (totalConventions <= 1) return { status: "last_convention" };

      const actualId = convention.id || convention._id.toString();
      const conventionResult = await database.collection("conventions").deleteOne({ _id: convention._id });
      const scalesResult = await database.collection("salaryScales").deleteMany({ conventionId: actualId });

      return {
        status: "deleted",
        deletedConventionId: actualId,
        deletedScales: scalesResult.deletedCount || 0,
        deletedCount: conventionResult.deletedCount || 0
      };
    }
  };
}

module.exports = {
  createCatalogRepository
};
