const express = require("express");

function createLiquidationsRouter({ controller }) {
  const router = express.Router();

  router.get("/api/liquidations", controller.list);
  router.get("/api/liquidations/:id", controller.get);
  router.post("/api/liquidations/calculate", controller.calculate);
  router.post("/api/liquidations", controller.save);
  router.delete("/api/liquidations/:id", controller.remove);

  return router;
}

module.exports = {
  createLiquidationsRouter
};
