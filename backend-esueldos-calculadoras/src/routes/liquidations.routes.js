const express = require("express");
const { ObjectId } = require("mongodb");
const { savedLiquidationSchema, parseOrThrow } = require("../domain/schemas");
const { calculateLiquidation } = require("../services/liquidation-service");

function createLiquidationsRouter({ getDb, serializeScale }) {
  const router = express.Router();

  router.get("/api/liquidations", async (req, res, next) => {
    try {
      const limit = Math.min(Number(req.query.limit || 50), 200);
      const docs = await getDb().collection("liquidations").find({}).sort({ createdAt: -1 }).limit(limit).toArray();
      res.json(docs.map(({ _id, ...doc }) => ({ id: _id.toString(), ...doc })));
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/liquidations/:id", async (req, res, next) => {
    try {
      if (!ObjectId.isValid(req.params.id)) {
        res.status(400).json({ error: "ID invalido" });
        return;
      }
      const doc = await getDb().collection("liquidations").findOne({ _id: new ObjectId(req.params.id) });
      if (!doc) {
        res.status(404).json({ error: "Liquidacion no encontrada" });
        return;
      }
      const { _id, ...payload } = doc;
      res.json({ id: _id.toString(), ...payload });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/liquidations/calculate", async (req, res, next) => {
    try {
      res.json(await calculateLiquidation(getDb(), req.body, serializeScale));
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/liquidations", async (req, res, next) => {
    try {
      const payload = parseOrThrow(savedLiquidationSchema, req.body, "Liquidacion invalida");

      const now = new Date();
      const doc = {
        ...payload,
        createdAt: now,
        updatedAt: now
      };

      const result = await getDb().collection("liquidations").insertOne(doc);
      res.status(201).json({ id: result.insertedId.toString(), ...doc });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/api/liquidations/:id", async (req, res, next) => {
    try {
      if (!ObjectId.isValid(req.params.id)) {
        res.status(400).json({ error: "ID invalido" });
        return;
      }
      const result = await getDb().collection("liquidations").deleteOne({ _id: new ObjectId(req.params.id) });
      if (result.deletedCount === 0) {
        res.status(404).json({ error: "Liquidacion no encontrada" });
        return;
      }
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = {
  createLiquidationsRouter
};
