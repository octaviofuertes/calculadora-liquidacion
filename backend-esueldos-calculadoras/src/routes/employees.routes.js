const express = require("express");
const { ObjectId } = require("mongodb");
const { escapeRegex } = require("../middleware/validate");
const { employeeWriteSchema, parseOrThrow } = require("../domain/schemas");

function serializeEmployee(doc) {
  const { _id, ...payload } = doc;
  return { id: _id.toString(), ...payload };
}

function createEmployeesRouter({ getDb }) {
  const router = express.Router();

  router.get("/api/employees/next-legajo", async (req, res, next) => {
    try {
      const docs = await getDb().collection("employees").find({}, { projection: { legajo: 1 } }).toArray();
      const max = docs.reduce((current, emp) => {
        const num = parseInt(emp.legajo, 10);
        return !Number.isNaN(num) && num > current ? num : current;
      }, 0);
      res.json({ nextLegajo: String(max + 1).padStart(3, "0") });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/employees/search", async (req, res, next) => {
    try {
      const { q, conventionId } = req.query;
      if (!q) {
        res.json([]);
        return;
      }

      const safeQuery = escapeRegex(String(q).slice(0, 80));
      const filter = { name: { $regex: safeQuery, $options: "i" } };
      if (conventionId && conventionId !== "null" && conventionId !== "undefined") {
        filter.conventionId = conventionId;
      }

      const docs = await getDb().collection("employees").find(filter).limit(10).toArray();
      res.json(docs.map(serializeEmployee));
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/employees", async (req, res, next) => {
    try {
      const docs = await getDb().collection("employees").find({}).sort({ legajo: 1 }).toArray();
      res.json(docs.map(serializeEmployee));
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/employees/:legajo", async (req, res, next) => {
    try {
      const doc = await getDb().collection("employees").findOne({ legajo: req.params.legajo });
      if (!doc) {
        res.status(404).json({ error: "Empleado no encontrado" });
        return;
      }
      res.json(serializeEmployee(doc));
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/employees", async (req, res, next) => {
    try {
      const db = getDb();
      const payload = parseOrThrow(employeeWriteSchema, req.body, "Empleado invalido");
      const existing = await db.collection("employees").findOne({ legajo: payload.legajo });
      if (existing) {
        res.status(400).json({ error: "El legajo ya existe" });
        return;
      }

      const now = new Date();
      const doc = {
        ...payload,
        createdAt: now,
        updatedAt: now
      };
      const result = await db.collection("employees").insertOne(doc);
      res.status(201).json({ id: result.insertedId.toString(), ...doc });
    } catch (error) {
      next(error);
    }
  });

  router.put("/api/employees/:id", async (req, res, next) => {
    try {
      if (!ObjectId.isValid(req.params.id)) {
        res.status(400).json({ error: "ID invalido" });
        return;
      }
      const payload = parseOrThrow(employeeWriteSchema.partial().passthrough(), req.body, "Empleado invalido");
      const { id, _id, ...updateData } = payload;

      const result = await getDb().collection("employees").findOneAndUpdate(
        { _id: new ObjectId(req.params.id) },
        { $set: { ...updateData, updatedAt: new Date() } },
        { returnDocument: "after" }
      );

      if (!result) {
        res.status(404).json({ error: "Empleado no encontrado" });
        return;
      }
      res.json(serializeEmployee(result));
    } catch (error) {
      next(error);
    }
  });

  router.delete("/api/employees/:id", async (req, res, next) => {
    try {
      if (!ObjectId.isValid(req.params.id)) {
        res.status(400).json({ error: "ID invalido" });
        return;
      }
      const result = await getDb().collection("employees").deleteOne({ _id: new ObjectId(req.params.id) });
      if (result.deletedCount === 0) {
        res.status(404).json({ error: "Empleado no encontrado" });
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
  createEmployeesRouter
};
