function createLiquidationController({ liquidationUseCases }) {
  return {
    async list(req, res, next) {
      try {
        res.json(await liquidationUseCases.list(req.query));
      } catch (error) {
        next(error);
      }
    },

    async get(req, res, next) {
      try {
        res.json(await liquidationUseCases.getById(req.params.id));
      } catch (error) {
        next(error);
      }
    },

    async calculate(req, res, next) {
      try {
        res.json(await liquidationUseCases.calculate(req.body));
      } catch (error) {
        next(error);
      }
    },

    async save(req, res, next) {
      try {
        res.status(201).json(await liquidationUseCases.save(req.body));
      } catch (error) {
        next(error);
      }
    },

    async remove(req, res, next) {
      try {
        res.json(await liquidationUseCases.remove(req.params.id));
      } catch (error) {
        next(error);
      }
    }
  };
}

module.exports = {
  createLiquidationController
};
