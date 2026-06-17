const express = require("express");

function createCatalogRouter({ controller }) {
  const router = express.Router();

  router.get("/api/catalog", controller.getCatalog);
  router.get("/api/conventions", controller.listConventions);
  router.get("/api/conventions/:id", controller.getConvention);
  router.delete("/api/conventions/:id", controller.deleteConvention);

  return router;
}

module.exports = {
  createCatalogRouter
};
