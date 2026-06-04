const express = require("express");
const { createConvenioController } = require("../controllers/convenio.controller");

function createConveniosRouter({ getDb }) {
  const router = express.Router();
  const controller = createConvenioController({ getDb });

  router.post("/api/convenios", controller.create);
  router.get("/api/convenios", controller.list);
  router.get("/api/convenios/:id", controller.get);
  router.put("/api/convenios/:id", controller.update);
  router.delete("/api/convenios/:id", controller.remove);

  router.post("/api/convenios/:id/escalas", controller.saveEscala);
  router.get("/api/convenios/:id/categories", controller.categories);
  router.get("/api/convenios/:id/concepts", controller.concepts);
  router.get("/api/convenios/:id/payroll-bases", controller.payrollBases);
  router.get("/api/convenios/:id/scales", controller.scales);
  router.get("/api/convenios/:id/additionals", controller.additionals);
  router.get("/api/convenios/:id/categorias", controller.categorias);
  router.get("/api/convenios/:id/conceptos", controller.conceptos);
  router.get("/api/convenios/:id/escalas", controller.escalas);
  router.get("/api/convenios/:id/escala-valores", controller.escalaValores);

  return router;
}

module.exports = {
  createConveniosRouter
};
