const convenioService = require("../services/convenio-service");

function createConvenioController({ getDb }) {
  const db = () => getDb();

  return {
    async create(req, res, next) {
      try {
        res.status(201).json(await convenioService.createConvenio(db(), req.body));
      } catch (error) {
        next(error);
      }
    },

    async list(req, res, next) {
      try {
        res.json(await convenioService.listConvenios(db(), { limit: req.query.limit }));
      } catch (error) {
        next(error);
      }
    },

    async get(req, res, next) {
      try {
        res.json(await convenioService.getConvenio(db(), req.params.id));
      } catch (error) {
        next(error);
      }
    },

    async update(req, res, next) {
      try {
        res.json(await convenioService.updateConvenio(db(), req.params.id, req.body));
      } catch (error) {
        next(error);
      }
    },

    async remove(req, res, next) {
      try {
        res.json(await convenioService.deleteConvenio(db(), req.params.id));
      } catch (error) {
        next(error);
      }
    },

    async saveEscala(req, res, next) {
      try {
        res.json(await convenioService.saveEscala(db(), req.params.id, req.body));
      } catch (error) {
        next(error);
      }
    },

    async categorias(req, res, next) {
      try {
        res.json(await convenioService.getCategories(db(), req.params.id));
      } catch (error) {
        next(error);
      }
    },

    async categories(req, res, next) {
      try {
        res.json(await convenioService.getCategories(db(), req.params.id));
      } catch (error) {
        next(error);
      }
    },

    async conceptos(req, res, next) {
      try {
        res.json(await convenioService.getConcepts(db(), req.params.id));
      } catch (error) {
        next(error);
      }
    },

    async concepts(req, res, next) {
      try {
        res.json(await convenioService.getConcepts(db(), req.params.id));
      } catch (error) {
        next(error);
      }
    },

    async payrollBases(req, res, next) {
      try {
        res.json(await convenioService.getPayrollBases(db(), req.params.id));
      } catch (error) {
        next(error);
      }
    },

    async escalas(req, res, next) {
      try {
        res.json(await convenioService.getScales(db(), req.params.id));
      } catch (error) {
        next(error);
      }
    },

    async scales(req, res, next) {
      try {
        res.json(await convenioService.getScales(db(), req.params.id));
      } catch (error) {
        next(error);
      }
    },

    async additionals(req, res, next) {
      try {
        res.json(await convenioService.getAdditionals(db(), req.params.id));
      } catch (error) {
        next(error);
      }
    },

    async escalaValores(req, res, next) {
      try {
        res.json(await convenioService.getScaleValues(db(), req.params.id, req.query));
      } catch (error) {
        next(error);
      }
    }
  };
}

module.exports = {
  createConvenioController
};
