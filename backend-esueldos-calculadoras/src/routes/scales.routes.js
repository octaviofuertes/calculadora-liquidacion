const express = require("express");
const fs = require("fs");
const { ObjectId } = require("mongodb");
const { saveScaleVersion } = require("../repositories/version-repository");

function createScalesRouter({
  getDb,
  scaleUpload,
  extractScalesFromPdf,
  geminiFallbackModels,
  getConventionOr404,
  monthTimeline,
  findActiveScale,
  normalizePeriod,
  currentPeriod,
  monthLabel,
  serializeScale,
  safeFileName
}) {
  const router = express.Router();

  router.get("/api/scales", async (req, res, next) => {
    try {
      const filter = {};
      if (req.query.conventionId) filter.conventionId = String(req.query.conventionId);
      if (req.query.status) filter.status = String(req.query.status);
      if (req.query.period) {
        const period = normalizePeriod(req.query.period);
        if (!period) {
          res.status(400).json({ error: "Periodo invalido. Usa formato YYYY-MM." });
          return;
        }
        filter.period = period;
      }

      const limit = Math.min(Number(req.query.limit || 80), 200);
      const docs = await getDb().collection("salaryScales").find(filter).sort({ createdAt: -1 }).limit(limit).toArray();
      res.json(docs.map(serializeScale));
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/scales/months", async (req, res, next) => {
    try {
      const conventionId = String(req.query.conventionId || "");
      if (!conventionId) {
        res.status(400).json({ error: "Falta conventionId" });
        return;
      }
      res.json(await monthTimeline(conventionId));
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/scales/active", async (req, res, next) => {
    try {
      const conventionId = String(req.query.conventionId || "");
      const period = normalizePeriod(req.query.period) || currentPeriod();
      if (!conventionId) {
        res.status(400).json({ error: "Falta conventionId" });
        return;
      }

      const activeScale = await findActiveScale(conventionId, period);
      if (!activeScale) {
        res.status(404).json({ error: "No hay escala aprobada vigente para ese mes." });
        return;
      }
      res.json(serializeScale(activeScale));
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/scales/:id", async (req, res, next) => {
    try {
      if (!ObjectId.isValid(req.params.id)) {
        res.status(400).json({ error: "ID invalido" });
        return;
      }
      const doc = await getDb().collection("salaryScales").findOne({ _id: new ObjectId(req.params.id) });
      if (!doc) {
        res.status(404).json({ error: "Escala no encontrada" });
        return;
      }
      res.json(serializeScale(doc));
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/scales/upload", scaleUpload.single("pdf"), async (req, res, next) => {
    try {
      const db = getDb();
      if (!req.file) {
        res.status(400).json({ error: "Selecciona un PDF de escala salarial." });
        return;
      }

      const conventionId = String(req.body.conventionId || "");
      const convention = await getConventionOr404(conventionId);
      const period = normalizePeriod(req.body.period) || currentPeriod();
      const periodLabel = req.body.periodLabel || monthLabel(period);
      const now = new Date();
      const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
      let aiStatus = "SIN_API_KEY";
      let aiError = null;
      let aiModel = null;
      let aiModelsTried = [];
      let parsedScales = [{
        period,
        periodLabel,
        conventionId: convention.id,
        conventionName: convention.name,
        cct: convention.source || "",
        sourceFileName: req.file.originalname,
        sourceSummary: "",
        confidence: 0,
        categories: [],
        additionals: [],
        zones: [],
        nonRemunerative: [],
        notes: [],
        warnings: ["Carga pendiente de lectura por IA."]
      }];

      if (apiKey) {
        try {
          const pdfBuffer = await fs.promises.readFile(req.file.path);
          const result = await extractScalesFromPdf({
            apiKey,
            model: process.env.GEMINI_SCALE_MODEL || process.env.GEMINI_MODEL,
            fallbackModels: geminiFallbackModels(),
            convention,
            period,
            periodLabel,
            pdfBuffer,
            mimeType: req.file.mimetype,
            sourceFileName: req.file.originalname
          });
          parsedScales = result.parsedScales?.length ? result.parsedScales : parsedScales;
          aiStatus = "DETECTADA_POR_IA";
          aiModel = result.model;
          aiModelsTried = result.modelsTried;
        } catch (error) {
          aiStatus = "ERROR_IA";
          aiError = error.message || "No se pudo leer el PDF con leIA.";
          aiModel = error.model || null;
          aiModelsTried = error.modelsTried || [];
          parsedScales[0].warnings = [aiError];
        }
      }

      const docs = parsedScales.map((parsedScale) => ({
        conventionId: convention.id,
        conventionName: convention.name,
        shortName: convention.shortName || convention.name,
        cct: convention.source || "",
        period: normalizePeriod(parsedScale.period) || period,
        periodLabel: parsedScale.periodLabel || monthLabel(normalizePeriod(parsedScale.period) || period),
        status: "PENDIENTE_REVISION",
        aiStatus,
        aiError,
        aiModel,
        aiModelsTried,
        sourceFileName: req.file.originalname,
        storedFileName: req.file.filename,
        filePath: req.file.path,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
        parsedScale: {
          ...parsedScale,
          period: normalizePeriod(parsedScale.period) || period,
          periodLabel: parsedScale.periodLabel || monthLabel(normalizePeriod(parsedScale.period) || period)
        },
        auditNote: req.body.auditNote || "",
        uploadedBatchId: `${now.getTime()}-${safeFileName(req.file.originalname)}`,
        createdAt: now,
        updatedAt: now
      }));

      const insertResult = await db.collection("salaryScales").insertMany(docs);
      const created = docs.map((doc, index) => serializeScale({ _id: insertResult.insertedIds[index], ...doc }));
      res.status(201).json({
        ...created[0],
        created,
        count: created.length,
        detectedPeriods: created.map((doc) => ({ id: doc.id, period: doc.period, periodLabel: doc.periodLabel }))
      });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/api/scales/:id", async (req, res, next) => {
    try {
      if (!ObjectId.isValid(req.params.id)) {
        res.status(400).json({ error: "ID invalido" });
        return;
      }

      const update = { updatedAt: new Date() };
      if (req.body && Object.prototype.hasOwnProperty.call(req.body, "parsedScale")) {
        update.parsedScale = req.body.parsedScale;
        update.humanEdited = true;
        update.humanEditedAt = new Date();
      }
      if (req.body && Object.prototype.hasOwnProperty.call(req.body, "auditNote")) {
        update.auditNote = String(req.body.auditNote || "");
      }

      const result = await getDb().collection("salaryScales").findOneAndUpdate(
        { _id: new ObjectId(req.params.id) },
        { $set: update },
        { returnDocument: "after" }
      );

      if (!result) {
        res.status(404).json({ error: "Escala no encontrada" });
        return;
      }
      res.json(serializeScale(result));
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/scales/:id/approve", async (req, res, next) => {
    try {
      const db = getDb();
      if (!ObjectId.isValid(req.params.id)) {
        res.status(400).json({ error: "ID invalido" });
        return;
      }

      const now = new Date();
      const update = {
        status: "APROBADA",
        approvedAt: now,
        reviewedAt: now,
        reviewedBy: req.body?.reviewedBy || "Auditoria humana",
        reviewNote: req.body?.note || "",
        updatedAt: now
      };
      if (req.body && Object.prototype.hasOwnProperty.call(req.body, "parsedScale")) {
        update.parsedScale = req.body.parsedScale;
        update.humanEdited = true;
        update.humanEditedAt = now;
      }

      const result = await db.collection("salaryScales").findOneAndUpdate(
        { _id: new ObjectId(req.params.id) },
        { $set: update },
        { returnDocument: "after" }
      );

      if (!result) {
        res.status(404).json({ error: "Escala no encontrada" });
        return;
      }
      await saveScaleVersion(db, result, {
        approvedAt: now,
        approvedBy: update.reviewedBy,
        source: result.sourceFileName || result.originalName || result.fileName || ""
      });
      res.json(serializeScale(result));
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/scales/:id/reject", async (req, res, next) => {
    try {
      if (!ObjectId.isValid(req.params.id)) {
        res.status(400).json({ error: "ID invalido" });
        return;
      }

      const now = new Date();
      const result = await getDb().collection("salaryScales").findOneAndUpdate(
        { _id: new ObjectId(req.params.id) },
        {
          $set: {
            status: "RECHAZADA",
            rejectedAt: now,
            reviewedAt: now,
            reviewedBy: req.body?.reviewedBy || "Auditoria humana",
            reviewNote: req.body?.note || "",
            updatedAt: now
          }
        },
        { returnDocument: "after" }
      );

      if (!result) {
        res.status(404).json({ error: "Escala no encontrada" });
        return;
      }
      res.json(serializeScale(result));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = {
  createScalesRouter
};
