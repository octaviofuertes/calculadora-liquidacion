const express = require("express");
const catalogService = require("../services/catalog-service");

function createCatalogRouter({ getDb }) {
  const router = express.Router();

  router.get("/api/catalog", async (req, res, next) => {
    try {
      res.json(await catalogService.getCatalog(getDb()));
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/conventions", async (req, res, next) => {
    try {
      res.json(await catalogService.listConventions(getDb()));
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/conventions/:id", async (req, res, next) => {
    try {
      res.json(await catalogService.getConventionOrThrow(getDb(), req.params.id));
    } catch (error) {
      next(error);
    }
  });

  router.delete("/api/conventions/:id", async (req, res, next) => {
    try {
      const db = getDb();
      const conventionId = String(req.params.id || "").trim();
      if (!conventionId) {
        res.status(400).json({ error: "Falta id de convenio" });
        return;
      }

      const convention = await db.collection("conventions").findOne({ id: conventionId });
      if (!convention) {
        res.status(404).json({ error: "Convenio no encontrado" });
        return;
      }

      const totalConventions = await db.collection("conventions").countDocuments();
      if (totalConventions <= 1) {
        res.status(409).json({ error: "No se puede borrar el ultimo convenio disponible." });
        return;
      }

      const conventionResult = await db.collection("conventions").deleteOne({ id: conventionId });
      const scalesResult = await db.collection("salaryScales").deleteMany({ conventionId });

      res.json({
        ok: true,
        deletedConventionId: conventionId,
        deletedScales: scalesResult.deletedCount || 0,
        deletedCount: conventionResult.deletedCount || 0
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = {
  createCatalogRouter
};
