function createEmployeeController({ employeeUseCases }) {
  return {
    async nextLegajo(req, res, next) {
      try {
        res.json(await employeeUseCases.getNextLegajo());
      } catch (error) {
        next(error);
      }
    },

    async search(req, res, next) {
      try {
        res.json(await employeeUseCases.search(req.query));
      } catch (error) {
        next(error);
      }
    },

    async list(req, res, next) {
      try {
        res.json(await employeeUseCases.list());
      } catch (error) {
        next(error);
      }
    },

    async get(req, res, next) {
      try {
        res.json(await employeeUseCases.getByLegajo(req.params.legajo));
      } catch (error) {
        next(error);
      }
    },

    async create(req, res, next) {
      try {
        res.status(201).json(await employeeUseCases.create(req.body));
      } catch (error) {
        next(error);
      }
    },

    async update(req, res, next) {
      try {
        res.json(await employeeUseCases.update(req.params.id, req.body));
      } catch (error) {
        next(error);
      }
    },

    async remove(req, res, next) {
      try {
        res.json(await employeeUseCases.remove(req.params.id));
      } catch (error) {
        next(error);
      }
    }
  };
}

module.exports = {
  createEmployeeController
};
