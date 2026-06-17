const express = require("express");

function createEmployeesRouter({ controller }) {
  const router = express.Router();

  router.get("/api/employees/next-legajo", controller.nextLegajo);
  router.get("/api/employees/search", controller.search);
  router.get("/api/employees", controller.list);
  router.get("/api/employees/:legajo", controller.get);
  router.post("/api/employees", controller.create);
  router.put("/api/employees/:id", controller.update);
  router.delete("/api/employees/:id", controller.remove);

  return router;
}

module.exports = {
  createEmployeesRouter
};
