function createCatalogController({ catalogUseCases }) {
  return {
    async getCatalog(req, res, next) {
      try {
        res.json(await catalogUseCases.getCatalog());
      } catch (error) {
        next(error);
      }
    },

    async listConventions(req, res, next) {
      try {
        res.json(await catalogUseCases.listConventions());
      } catch (error) {
        next(error);
      }
    },

    async getConvention(req, res, next) {
      try {
        res.json(await catalogUseCases.getConvention(req.params.id));
      } catch (error) {
        next(error);
      }
    },

    async deleteConvention(req, res, next) {
      try {
        res.json(await catalogUseCases.deleteConvention(req.params.id));
      } catch (error) {
        next(error);
      }
    }
  };
}

module.exports = {
  createCatalogController
};
