require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { ObjectId } = require("mongodb");
const { getDb, closeDb } = require("./db");
const { seedCatalog } = require("./seed");
const { askGemini, buildSystemInstruction } = require("./leia");
const { extractScalesFromPdf, GeminiScaleError } = require("./scale-ai");
const { extractConventionFromPdfs, tryBuildLocalConventionFallback, normalizeConvention, GeminiConventionError } = require("./convention-ai");
const { configureSecurity } = require("./middleware/security");
const catalogService = require("./services/catalog-service");
const scaleRepository = require("./repositories/scale-repository");
const { ensureVersionIndexes, saveConventionVersion } = require("./repositories/version-repository");
const { createAdminRouter } = require("./routes/admin.routes");
const { createCatalogRouter } = require("./routes/catalog.routes");
const { createEmployeesRouter } = require("./routes/employees.routes");
const { createHealthRouter } = require("./routes/health.routes");
const { createLiquidationsRouter } = require("./routes/liquidations.routes");
const { createScalesRouter } = require("./routes/scales.routes");
const { parseOrThrow } = require("./domain/schemas");
const {
  geminiPrimaryModel,
  geminiScaleModel,
  geminiConventionModel,
  geminiFallbackModels
} = require("./gemini-config");

const app = express();
const port = Number(process.env.PORT || 4100);
const backendRoot = path.resolve(__dirname, "..");
const frontendDir = path.resolve(backendRoot, process.env.FRONTEND_DIR || "../frontend-esueldos-calculadoras");
const uploadRoot = path.join(backendRoot, "uploads");
const scaleUploadDir = path.join(uploadRoot, "scales");
const conventionUploadDir = path.join(uploadRoot, "conventions");
const scaleUploadMaxBytes = Number(process.env.UPLOAD_SCALE_MAX_MB || 20) * 1024 * 1024;
const conventionUploadMaxBytes = Number(process.env.UPLOAD_CONVENTION_MAX_MB || 25) * 1024 * 1024;

function safeFileName(name) {
  return String(name || "escala.pdf")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 140) || "escala.pdf";
}

const scaleUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      fs.mkdirSync(scaleUploadDir, { recursive: true });
      cb(null, scaleUploadDir);
    },
    filename: (req, file, cb) => {
      cb(null, `${Date.now()}-${safeFileName(file.originalname)}`);
    }
  }),
  limits: { fileSize: scaleUploadMaxBytes },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf" || /\.pdf$/i.test(file.originalname)) {
      cb(null, true);
      return;
    }
    cb(new Error("Solo se aceptan archivos PDF de escala salarial."));
  }
});

const conventionUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      fs.mkdirSync(conventionUploadDir, { recursive: true });
      cb(null, conventionUploadDir);
    },
    filename: (req, file, cb) => {
      cb(null, `${Date.now()}-${safeFileName(file.originalname)}`);
    }
  }),
  limits: { fileSize: conventionUploadMaxBytes, files: 2 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf" || /\.pdf$/i.test(file.originalname)) {
      cb(null, true);
      return;
    }
    cb(new Error("Solo se aceptan archivos PDF para estructurar convenios."));
  }
});

configureSecurity(app);
app.use(express.json({ limit: "2mb" }));
app.use("/uploads", express.static(uploadRoot));

let db;

function getDbInstance() {
  return db;
}

function toCatalogPayload(constantsDoc, conventionDocs, legalReferenceDocs) {
  const { _id, updatedAt, ...constants } = constantsDoc || {};
  const conventions = {};

  conventionDocs.forEach((doc) => {
    const { _id: mongoId, order, updatedAt: conventionUpdatedAt, ...convention } = doc;
    conventions[convention.id] = convention;
  });

  return {
    constants,
    conventions,
    legalReferences: legalReferenceDocs.map(({ _id: refId, order, updatedAt: refUpdatedAt, ...reference }) => reference)
  };
}

async function ensureCatalogSeeded() {
  const count = await db.collection("conventions").countDocuments();
  if (count === 0) {
    await seedCatalog(db);
  }
}

async function getCatalogPayload() {
  return catalogService.getCatalog(db);
}

async function ensureScaleIndexes() {
  await db.collection("salaryScales").createIndex({ conventionId: 1, period: 1, status: 1 });
  await db.collection("salaryScales").createIndex({ conventionId: 1, status: 1, period: -1, approvedAt: -1 });
  await db.collection("salaryScales").createIndex({ createdAt: -1 });
  await db.collection("conventionDrafts").createIndex({ status: 1, createdAt: -1 });
  await db.collection("conventionDrafts").createIndex({ "parsedConvention.id": 1 });
  await db.collection("liquidationAudits").createIndex({ createdAt: -1 });
  await db.collection("liquidationAudits").createIndex({ conventionId: 1, period: 1, createdAt: -1 });
  await db.collection("employees").createIndex({ legajo: 1 }, { unique: true });
  await db.collection("employees").createIndex({ name: "text" });
  await db.collection("employees").createIndex({ conventionId: 1, name: 1 });
  await db.collection("liquidations").createIndex({ convention: 1, period: 1, createdAt: -1 });
  await ensureVersionIndexes(db);
}

function periodIdToMonth(periodId) {
  const match = String(periodId || "").toLowerCase().match(/^(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)(\d{2})$/);
  if (!match) return null;
  const months = { ene: "01", feb: "02", mar: "03", abr: "04", may: "05", jun: "06", jul: "07", ago: "08", sep: "09", oct: "10", nov: "11", dic: "12" };
  return `20${match[2]}-${months[match[1]]}`;
}

function monthLabel(period) {
  const match = String(period || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return period || "";
  const names = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  return `${names[Number(match[2]) - 1] || match[2]} ${match[1]}`;
}

function normalizePeriod(value) {
  const raw = String(value || "").trim();
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) return raw;
  const converted = periodIdToMonth(raw);
  if (converted) return converted;
  return null;
}

function currentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function serializeScale(doc) {
  if (!doc) return null;
  const { _id, filePath, ...payload } = doc;
  const fileName = filePath ? path.basename(filePath) : null;
  return {
    id: _id.toString(),
    ...payload,
    sourceFileUrl: fileName ? `/uploads/scales/${fileName}` : null
  };
}

function serializeConventionDraft(doc) {
  if (!doc) return null;
  const { _id, filePaths, ...payload } = doc;
  return {
    id: _id.toString(),
    ...payload,
    files: (doc.files || []).map((file) => ({
      field: file.field,
      originalName: file.originalName,
      storedFileName: file.storedFileName,
      fileSize: file.fileSize,
      mimeType: file.mimeType,
      url: file.storedFileName ? `/uploads/conventions/${file.storedFileName}` : null
    }))
  };
}

async function getConventionOr404(conventionId) {
  return catalogService.getConventionOrThrow(db, conventionId);
}

async function findActiveScale(conventionId, period) {
  return scaleRepository.findActiveScale(db, conventionId, period);
}

async function monthTimeline(conventionId) {
  const convention = await getConventionOr404(conventionId);
  const docs = await db.collection("salaryScales").find({ conventionId }).sort({ period: -1, createdAt: -1 }).toArray();
  const monthSet = new Set();

  (convention.periods || []).forEach((period) => {
    const normalized = normalizePeriod(period.id);
    if (normalized) monthSet.add(normalized);
  });
  docs.forEach((doc) => {
    if (doc.period) monthSet.add(doc.period);
  });
  monthSet.add(currentPeriod());

  const months = Array.from(monthSet).sort().reverse();
  return Promise.all(months.map(async (period) => {
    const submissions = docs
      .filter((doc) => doc.period === period)
      .map(serializeScale);
    const activeScale = await findActiveScale(conventionId, period);
    return {
      period,
      label: monthLabel(period),
      activeScale: serializeScale(activeScale),
      submissions
    };
  }));
}

function amount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function sumAmounts(rows = []) {
  return rows.reduce((total, row) => total + amount(row?.amount), 0);
}

function moneyDiff(left, right) {
  return Math.abs(amount(left) - amount(right));
}

function auditFinding(severity, title, detail, action, code) {
  return { severity, title, detail, action, code };
}

function parseJsonObject(text) {
  const raw = String(text || "").trim();
  const unfenced = raw
    .replace(/^`{3,}\s*(?:json)?\s*/i, "")
    .replace(/\s*`{3,}\s*$/i, "")
    .trim();
  const fenced = unfenced.match(/`{3,}\s*(?:json)?\s*([\s\S]*?)`{3,}/i);
  const source = fenced ? fenced[1].trim() : unfenced;
  const first = source.indexOf("{");
  const last = source.lastIndexOf("}");
  const candidate = first >= 0 && last > first ? source.slice(first, last + 1) : source;
  return JSON.parse(candidate);
}

function deterministicLiquidationAudit({ liquidation, activeScale }) {
  const findings = [];
  const checklist = [];
  const totals = liquidation?.totals || {};
  const remRows = liquidation?.remunerative || liquidation?.remRows || [];
  const noRemRows = liquidation?.nonRemunerative || liquidation?.noRemRows || [];
  const deductionRows = liquidation?.deductions || liquidation?.deductionRows || [];
  const employerRows = liquidation?.employer || liquidation?.employerRows || [];
  const details = liquidation?.details || [];
  const employee = liquidation?.employee || {};
  const conventionId = liquidation?.conventionId || liquidation?.convention || "";
  const tolerance = 1.5;

  const remTotal = sumAmounts(remRows);
  const noRemTotal = sumAmounts(noRemRows);
  const deductions = sumAmounts(deductionRows);
  const employerContribs = sumAmounts(employerRows);
  const gross = remTotal + noRemTotal;
  const net = gross - deductions;
  const employerCost = gross + employerContribs;

  const checks = [
    ["Total remunerativo", remTotal, totals.remTotal],
    ["Total no remunerativo", noRemTotal, totals.noRemTotal],
    ["Bruto", gross, totals.gross],
    ["Deducciones", deductions, totals.deductions],
    ["Neto", net, totals.net],
    ["Costo empleador", employerCost, totals.employerCost]
  ];

  checks.forEach(([label, calculated, declared]) => {
    const ok = moneyDiff(calculated, declared) <= tolerance;
    checklist.push({
      item: label,
      status: ok ? "ok" : "revisar",
      note: ok ? "Coincide con la suma de conceptos." : `Calculado ${calculated.toFixed(2)} vs informado ${amount(declared).toFixed(2)}.`
    });
    if (!ok) {
      findings.push(auditFinding(
        "alta",
        `${label} no coincide`,
        `La suma interna da ${calculated.toFixed(2)} y el recibo informa ${amount(declared).toFixed(2)}.`,
        "Revisar conceptos manuales, redondeos o una modificacion posterior al calculo.",
        "TOTAL_MISMATCH"
      ));
    }
  });

  if (!employee.name || employee.name === "Sin nombre") {
    findings.push(auditFinding("media", "Falta nombre del trabajador", "El recibo quedo sin identificacion completa.", "Completar trabajador antes de emitir o guardar.", "MISSING_EMPLOYEE_NAME"));
  }
  if (!employee.cuil || employee.cuil === "-") {
    findings.push(auditFinding("media", "Falta CUIL", "El CUIL es necesario para una liquidacion trazable.", "Completar CUIL del trabajador.", "MISSING_CUIL"));
  }
  if (!employee.entryDate || employee.entryDate === "-") {
    findings.push(auditFinding("media", "Falta fecha de ingreso", "La antiguedad puede quedar mal calculada si no hay fecha de ingreso.", "Completar fecha de ingreso y recalcular.", "MISSING_ENTRY_DATE"));
  }

  if (activeScale) {
    checklist.push({
      item: "Escala vigente aprobada",
      status: "ok",
      note: `${activeScale.periodLabel || activeScale.period} aprobada${activeScale.approvedAt ? ` el ${new Date(activeScale.approvedAt).toLocaleDateString("es-AR")}` : ""}.`
    });
  } else {
    checklist.push({
      item: "Escala vigente aprobada",
      status: "revisar",
      note: "No se encontro una escala aprobada para ese mes/convenio."
    });
    findings.push(auditFinding(
      "alta",
      "Sin escala aprobada vigente",
      "La liquidacion uso la escala base del sistema o datos estaticos porque no hay una escala aprobada para ese mes.",
      "Subir y aprobar la escala del mes antes de cerrar la liquidacion.",
      "NO_APPROVED_SCALE"
    ));
  }

  if (amount(totals.net) < 0) {
    findings.push(auditFinding("alta", "Neto negativo", "Las deducciones superan el bruto.", "Revisar descuentos varios y bases imponibles.", "NEGATIVE_NET"));
  }
  if (amount(totals.deductions) > amount(totals.gross)) {
    findings.push(auditFinding("alta", "Deducciones mayores al bruto", "El recibo queda inconsistente para pago normal.", "Revisar descuentos y embargos/correcciones manuales.", "DEDUCTIONS_GT_GROSS"));
  }

  const hasRem = remRows.length && amount(totals.remTotal) > 0;
  const deductionText = deductionRows.map((row) => String(row.label || "").toLowerCase()).join(" | ");
  if (hasRem && (!deductionText.includes("jubil") || !deductionText.includes("pami") || !deductionText.includes("obra social"))) {
    findings.push(auditFinding(
      "alta",
      "Faltan aportes obligatorios",
      "Hay remunerativos, pero no aparecen todos los aportes basicos de trabajador.",
      "Verificar SIPA, PAMI y obra social antes de emitir.",
      "MISSING_STATUTORY_DEDUCTIONS"
    ));
  }

  const noRemLabels = ["comida", "viatico", "viático", "pernoctada", "kilometraje"];
  const misplacedCamioneros = conventionId === "camioneros" && remRows.some((row) => noRemLabels.some((label) => String(row.label || "").toLowerCase().includes(label)));
  if (misplacedCamioneros) {
    findings.push(auditFinding(
      "alta",
      "Conceptos de Camioneros ubicados como remunerativos",
      "Comida, viaticos, pernoctada o kilometraje deberian revisarse como no remunerativos segun el CCT cargado.",
      "Mover el concepto o revisar la regla aplicada.",
      "CAMIONEROS_NONREM_MISPLACED"
    ));
  }

  const hasAbsenceDiscount = details.some((row) => String(row.label || "").toLowerCase().includes("inasistencia"));
  const hasPresentism = remRows.some((row) => String(row.label || "").toLowerCase().includes("presentismo"));
  if (conventionId === "uocra" && hasAbsenceDiscount && hasPresentism) {
    findings.push(auditFinding(
      "media",
      "Presentismo con inasistencias",
      "La liquidacion tiene descuento por inasistencias y tambien presentismo.",
      "Confirmar si corresponde conservar presentismo o recalcular sin ese adicional.",
      "UOCRA_PRESENTISM_ABSENCE"
    ));
  }

  const manualRows = [...remRows, ...noRemRows, ...deductionRows].filter((row) => String(row.label || "").toLowerCase().includes("manual") || String(row.label || "").toLowerCase().includes("varios"));
  if (manualRows.length) {
    findings.push(auditFinding(
      "baja",
      "Hay conceptos manuales",
      `Se detectaron ${manualRows.length} concepto(s) manual(es) o varios.`,
      "Documentar el motivo y controlar si integran bases de aportes correctamente.",
      "MANUAL_CONCEPTS"
    ));
  }

  const severityRank = { alta: 3, media: 2, baja: 1 };
  const maxSeverity = findings.reduce((max, finding) => Math.max(max, severityRank[finding.severity] || 0), 0);
  const verdict = maxSeverity >= 3 ? "REVISAR" : maxSeverity === 2 ? "OBSERVAR" : "OK";
  const score = Math.max(0, 100 - findings.reduce((total, finding) => total + ({ alta: 22, media: 12, baja: 5 }[finding.severity] || 8), 0));

  return {
    verdict,
    score,
    findings,
    checklist,
    recalculation: {
      remTotal,
      noRemTotal,
      gross,
      deductions,
      employerContribs,
      net,
      employerCost
    }
  };
}

function buildLiquidationAuditPrompt({ liquidation, precheck, activeScale, catalog }) {
  const convention = catalog.conventions?.[liquidation.conventionId || liquidation.convention] || null;
  const compact = {
    liquidation,
    activeScale: activeScale ? {
      id: activeScale.id,
      period: activeScale.period,
      periodLabel: activeScale.periodLabel,
      approvedAt: activeScale.approvedAt,
      confidence: activeScale.parsedScale?.confidence,
      sourceSummary: activeScale.parsedScale?.sourceSummary,
      categories: (activeScale.parsedScale?.categories || []).slice(0, 12),
      additionals: (activeScale.parsedScale?.additionals || []).slice(0, 8),
      warnings: activeScale.parsedScale?.warnings || []
    } : null,
    precheck,
    convention: convention ? {
      id: convention.id,
      name: convention.name,
      source: convention.source,
      type: convention.type,
      periods: convention.periods,
      categories: convention.categories?.map((item) => ({ id: item.id, label: item.label })),
      zones: convention.zones
    } : null,
      legalReferences: catalog.legalReferences || []
  };

  return [
    "Sos leIA auditora senior de liquidaciones de sueldos argentinas.",
    "Revisa la liquidacion con criterio practico y accionable. No digas que esta todo bien si hay datos faltantes, escala no aprobada, bases raras o conceptos mal ubicados.",
    "Usa los prechequeos deterministico como fuente fuerte: si marcan error de suma, escala faltante o dato faltante, incluilo.",
    "No inventes normas ni importes. Si algo no esta en contexto, marcá 'requiere validacion humana'.",
    "Se conciso: maximo 5 hallazgos, maximo 8 items de checklist y maximo 5 acciones.",
    "Devolve SOLO JSON valido con esta forma:",
    JSON.stringify({
      verdict: "OK | OBSERVAR | REVISAR",
      score: 0,
      summary: "resumen de 1 o 2 frases",
      findings: [
        { severity: "alta | media | baja", title: "hallazgo", detail: "por que importa", action: "que hacer" }
      ],
      checklist: [
        { item: "item controlado", status: "ok | revisar", note: "nota corta" }
      ],
      nextSteps: ["accion concreta"]
    }, null, 2),
    `Contexto:\n${JSON.stringify(compact, null, 2)}`
  ].join("\n\n");
}

function fallbackAuditFromPrecheck(precheck, aiError = null) {
  return {
    verdict: precheck.verdict,
    score: precheck.score,
    summary: aiError
      ? `Auditoria automatica disponible, pero leIA no pudo completar la revision narrativa: ${aiError}`
      : precheck.findings.length
        ? "La auditoria automatica encontro puntos para revisar antes de cerrar la liquidacion."
        : "La auditoria automatica no encontro inconsistencias aritmeticas ni bloqueos evidentes.",
    findings: precheck.findings,
    checklist: precheck.checklist,
    nextSteps: precheck.findings.length
      ? precheck.findings.slice(0, 4).map((finding) => finding.action)
      : ["Guardar respaldo de la liquidacion y conservar la escala aprobada utilizada."]
  };
}

app.use(createHealthRouter({ getDb: getDbInstance }));
app.use(createCatalogRouter({ getDb: getDbInstance }));
app.use(createScalesRouter({
  getDb: getDbInstance,
  scaleUpload,
  extractScalesFromPdf,
  geminiFallbackModels,
  geminiScaleModel,
  getConventionOr404,
  monthTimeline,
  findActiveScale,
  normalizePeriod,
  currentPeriod,
  monthLabel,
  serializeScale,
  safeFileName
}));

app.get("/api/convention-drafts", async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit || 80), 200);
    const docs = await db.collection("conventionDrafts").find({}).sort({ createdAt: -1 }).limit(limit).toArray();
    res.json(docs.map(serializeConventionDraft));
  } catch (error) {
    next(error);
  }
});

app.get("/api/convention-drafts/:id", async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      res.status(400).json({ error: "ID invalido" });
      return;
    }
    const doc = await db.collection("conventionDrafts").findOne({ _id: new ObjectId(req.params.id) });
    if (!doc) {
      res.status(404).json({ error: "Borrador no encontrado" });
      return;
    }
    res.json(serializeConventionDraft(doc));
  } catch (error) {
    next(error);
  }
});

app.post("/api/convention-drafts/upload", conventionUpload.fields([
  { name: "cctPdf", maxCount: 1 },
  { name: "scalePdf", maxCount: 1 }
]), async (req, res, next) => {
  try {
    const cctFile = req.files?.cctPdf?.[0] || null;
    const scaleFile = req.files?.scalePdf?.[0] || null;
    if (!cctFile && !scaleFile) {
      res.status(400).json({ error: "Subi al menos el PDF del CCT o una escala salarial." });
      return;
    }

    const draftName = String(req.body.name || "").trim() || "Convenio generado por leIA";
    const notes = String(req.body.notes || "").trim();
    const now = new Date();
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    let aiStatus = "SIN_API_KEY";
    let aiError = null;
    let aiModel = null;
    let aiModelsTried = [];
    let tokenUsage = null;
    let parsedConvention = normalizeConvention({
      convention: {
        name: draftName,
        shortName: draftName.slice(0, 42),
        source: cctFile?.originalname || scaleFile?.originalname || "",
        periods: [],
        zones: [{ id: "general", label: "General", coef: 1 }],
        categories: [],
        liquidationModel: {
          rules: {
            salaryType: "monthly",
            monthDivisor: 30,
            hourDivisor: 200,
            weeklyHours: 48,
            seniority: { enabled: true, percentPerYear: 1, capYears: 0, base: "basic" },
            presentism: { enabled: true, percent: 0, requiresNoUnjustifiedAbsence: true },
            nonRemunerativeScale: { enabled: true },
            overtime: { enabled: true, divisor: 200 }
          },
          concepts: [],
          deductions: [],
          employerContributions: []
        },
        warnings: ["Carga pendiente de lectura por IA."]
      }
    }, { fallbackName: draftName });

    const cctPdf = cctFile ? {
      buffer: await fs.promises.readFile(cctFile.path),
      mimeType: cctFile.mimetype,
      sourceFileName: cctFile.originalname
    } : null;
    const scalePdf = scaleFile ? {
      buffer: await fs.promises.readFile(scaleFile.path),
      mimeType: scaleFile.mimetype,
      sourceFileName: scaleFile.originalname
    } : null;

    const localFirst = await tryBuildLocalConventionFallback({
      cctPdf,
      scalePdf,
      draftName,
      notes,
      aiError: null,
      allowGeneric: false
    });
    if (localFirst?.parsedConvention?.categories?.length) {
      parsedConvention = localFirst.parsedConvention;
      aiStatus = "ESTRUCTURADO_POR_LECTURA_LOCAL";
      aiError = null;
      aiModel = localFirst.model;
      aiModelsTried = localFirst.modelsTried || [];
    } else if (apiKey) {
      try {
        const result = await extractConventionFromPdfs({
          apiKey,
          model: geminiConventionModel(),
          fallbackModels: geminiFallbackModels(),
          cctPdf,
          scalePdf,
          draftName,
          notes
        });
        parsedConvention = result.parsedConvention;
        tokenUsage = result.tokenUsage || null;
        aiStatus = "ESTRUCTURADO_POR_LEIA";
        aiModel = result.model;
        aiModelsTried = result.modelsTried;
      } catch (error) {
        aiStatus = "ERROR_IA";
        aiError = error.message || "No se pudo estructurar el convenio con leIA.";
        aiModel = error.model || null;
        aiModelsTried = error.modelsTried || [];
        parsedConvention.warnings = Array.from(new Set([...(parsedConvention.warnings || []), aiError]));
      }
    }

    if (!parsedConvention.categories?.length || aiStatus === "ERROR_IA" || aiStatus === "SIN_API_KEY") {
      const fallback = await tryBuildLocalConventionFallback({
        cctPdf,
        scalePdf,
        draftName,
        notes,
        aiError,
        allowGeneric: true
      });
      if (fallback?.parsedConvention?.categories?.length) {
        parsedConvention = fallback.parsedConvention;
        aiStatus = "ESTRUCTURADO_POR_LECTURA_LOCAL";
        aiError = null;
        aiModel = fallback.model;
        aiModelsTried = Array.from(new Set([...(aiModelsTried || []), ...(fallback.modelsTried || [])]));
      }
    }

    const files = [cctFile, scaleFile].filter(Boolean).map((file) => ({
      field: file.fieldname,
      originalName: file.originalname,
      storedFileName: file.filename,
      filePath: file.path,
      fileSize: file.size,
      mimeType: file.mimetype
    }));

    const doc = {
      name: draftName,
      status: "PENDIENTE_REVISION",
      aiStatus,
      aiError,
      aiModel,
      aiModelsTried,
      parsedConvention,
      tokenUsage: typeof tokenUsage !== "undefined" ? tokenUsage : null,
      auditNote: notes,
      files,
      createdAt: now,
      updatedAt: now
    };
    const insertResult = await db.collection("conventionDrafts").insertOne(doc);
    res.status(201).json(serializeConventionDraft({ _id: insertResult.insertedId, ...doc }));
  } catch (error) {
    next(error);
  }
});

app.patch("/api/convention-drafts/:id", async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      res.status(400).json({ error: "ID invalido" });
      return;
    }
    const update = { updatedAt: new Date() };
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, "parsedConvention")) {
      update.parsedConvention = normalizeConvention({ convention: req.body.parsedConvention }, { fallbackName: req.body.parsedConvention?.name });
      update.humanEdited = true;
      update.humanEditedAt = new Date();
    }
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, "auditNote")) {
      update.auditNote = String(req.body.auditNote || "");
    }
    const result = await db.collection("conventionDrafts").findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $set: update },
      { returnDocument: "after" }
    );
    if (!result) {
      res.status(404).json({ error: "Borrador no encontrado" });
      return;
    }
    res.json(serializeConventionDraft(result));
  } catch (error) {
    next(error);
  }
});

app.post("/api/convention-drafts/:id/approve", async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      res.status(400).json({ error: "ID invalido" });
      return;
    }
    const draft = await db.collection("conventionDrafts").findOne({ _id: new ObjectId(req.params.id) });
    if (!draft) {
      res.status(404).json({ error: "Borrador no encontrado" });
      return;
    }

    const now = new Date();
    const convention = normalizeConvention({
      convention: req.body?.parsedConvention || draft.parsedConvention
    }, { fallbackName: draft.name });
    if (!convention.categories.length) {
      res.status(400).json({ error: "El JSON no tiene categorias con importes. Revisalo antes de aprobar." });
      return;
    }
    const validatedConvention = catalogService.validateConvention(convention);

    const savedConvention = await catalogService.replaceValidatedConvention(db, validatedConvention, {
      sourceDraftId: draft._id.toString(),
      approvedAt: now,
      updatedAt: now
    });
    await saveConventionVersion(db, savedConvention, {
      approvedAt: now,
      approvedBy: req.body?.reviewedBy || "Auditoria humana",
      sourceDraftId: draft._id.toString(),
      source: savedConvention.source || draft.name
    });
    const updatedDraft = await db.collection("conventionDrafts").findOneAndUpdate(
      { _id: draft._id },
      {
        $set: {
          status: "APROBADO",
          parsedConvention: savedConvention,
          approvedConventionId: savedConvention.id,
          reviewedAt: now,
          reviewedBy: req.body?.reviewedBy || "Auditoria humana",
          reviewNote: req.body?.note || "",
          updatedAt: now
        }
      },
      { returnDocument: "after" }
    );
    res.json({
      draft: serializeConventionDraft(updatedDraft),
      convention: savedConvention
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/convention-drafts/:id/reject", async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      res.status(400).json({ error: "ID invalido" });
      return;
    }
    const now = new Date();
    const result = await db.collection("conventionDrafts").findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      {
        $set: {
          status: "RECHAZADO",
          reviewedAt: now,
          reviewedBy: req.body?.reviewedBy || "Auditoria humana",
          reviewNote: req.body?.note || "",
          updatedAt: now
        }
      },
      { returnDocument: "after" }
    );
    if (!result) {
      res.status(404).json({ error: "Borrador no encontrado" });
      return;
    }
    res.json(serializeConventionDraft(result));
  } catch (error) {
    next(error);
  }
});

app.delete("/api/convention-drafts/:id", async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      res.status(400).json({ error: "ID invalido" });
      return;
    }
    const id = new ObjectId(req.params.id);
    const draft = await db.collection("conventionDrafts").findOne({ _id: id });
    if (!draft) {
      res.status(404).json({ error: "Borrador no encontrado" });
      return;
    }
    if (!["APROBADO", "RECHAZADO"].includes(draft.status)) {
      res.status(409).json({ error: "Solo se pueden eliminar borradores aprobados o rechazados." });
      return;
    }
    await db.collection("conventionDrafts").deleteOne({ _id: id });
    res.json({ ok: true, id: req.params.id, status: draft.status });
  } catch (error) {
    next(error);
  }
});

app.post("/api/leia/chat", async (req, res, next) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      res.status(503).json({ error: "Falta configurar GEMINI_API_KEY en el backend." });
      return;
    }

    const { message, history, state } = req.body || {};
    if (!message || typeof message !== "string") {
      res.status(400).json({ error: "Falta el mensaje para leIA." });
      return;
    }

    const catalog = await getCatalogPayload();
    const systemInstruction = buildSystemInstruction({
      catalog,
      selectedConventionId: state?.convention?.id,
      clientState: state
    });

    const result = await askGemini({
      apiKey,
      model: geminiPrimaryModel(),
      fallbackModels: geminiFallbackModels(),
      systemInstruction,
      message,
      history
    });

    res.json({
      answer: result.answer,
      convention: state?.convention?.id || null,
      model: result.model,
      modelsTried: result.modelsTried
    });
  } catch (error) {
    if (error.name === "GeminiRequestError") {
      const rawMessage = String(error.message || "");
      const isUnavailableModel = /not found|not supported|generateContent|ListModels/i.test(rawMessage);
      res.status(error.status || 502).json({
        error: isUnavailableModel
          ? "leIA detecto un modelo de Gemini viejo o no disponible. Reinicia el backend para tomar la configuracion actualizada y volve a intentar."
          : error.message,
        code: error.code,
        model: error.model,
        modelsTried: error.modelsTried
      });
      return;
    }
    next(error);
  }
});

app.post("/api/leia/audit-liquidation", async (req, res, next) => {
  try {
    const payload = req.body || {};
    const liquidation = payload.liquidation || {};
    const conventionId = liquidation.conventionId || liquidation.convention;
    const period = liquidation.period;

    if (!conventionId || !period || !liquidation.totals) {
      res.status(400).json({ error: "Faltan conventionId/convention, period o totals para auditar." });
      return;
    }

    const activeDoc = await findActiveScale(conventionId, period);
    const activeScale = serializeScale(activeDoc);
    const precheck = deterministicLiquidationAudit({ liquidation, activeScale });
    const catalog = await getCatalogPayload();
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    let audit = fallbackAuditFromPrecheck(precheck);
    let aiStatus = "SIN_API_KEY";
    let aiError = null;
    let aiModel = null;
    let aiModelsTried = [];

    if (apiKey) {
      try {
        const result = await askGemini({
          apiKey,
          model: geminiPrimaryModel(),
          fallbackModels: geminiFallbackModels(),
          systemInstruction: "Sos leIA, auditora de liquidaciones de eSueldos. Respondés solamente JSON válido.",
          message: buildLiquidationAuditPrompt({ liquidation, precheck, activeScale, catalog }),
          history: [],
          maxOutputTokens: 5000,
          temperature: 0.12
        });
        const parsed = parseJsonObject(result.answer);
        audit = {
          verdict: parsed.verdict || precheck.verdict,
          score: Number.isFinite(Number(parsed.score)) ? Math.max(0, Math.min(100, Number(parsed.score))) : precheck.score,
          summary: parsed.summary || fallbackAuditFromPrecheck(precheck).summary,
          findings: Array.isArray(parsed.findings) ? parsed.findings : precheck.findings,
          checklist: Array.isArray(parsed.checklist) ? parsed.checklist : precheck.checklist,
          nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps : fallbackAuditFromPrecheck(precheck).nextSteps
        };
        aiStatus = "OK";
        aiModel = result.model;
        aiModelsTried = result.modelsTried;
      } catch (error) {
        aiStatus = "ERROR_IA";
        aiError = error.message || "No se pudo auditar con leIA.";
        aiModel = error.model || null;
        aiModelsTried = error.modelsTried || [];
        audit = fallbackAuditFromPrecheck(precheck, aiError);
      }
    }

    const doc = {
      conventionId,
      period,
      employee: liquidation.employee || null,
      category: liquidation.category || null,
      zone: liquidation.zone || null,
      totals: liquidation.totals,
      activeScale: activeScale ? { id: activeScale.id, period: activeScale.period, periodLabel: activeScale.periodLabel, approvedAt: activeScale.approvedAt } : null,
      precheck,
      audit,
      aiStatus,
      aiError,
      aiModel,
      aiModelsTried,
      createdAt: new Date()
    };
    const inserted = await db.collection("liquidationAudits").insertOne(doc);

    res.json({
      id: inserted.insertedId.toString(),
      audit,
      precheck,
      activeScale,
      aiStatus,
      aiError,
      aiModel,
      aiModelsTried,
      createdAt: doc.createdAt
    });
  } catch (error) {
    next(error);
  }
});

app.use(createLiquidationsRouter({ getDb: getDbInstance, serializeScale }));

app.use(createEmployeesRouter({ getDb: getDbInstance }));
app.use(createAdminRouter({ getDb: getDbInstance, seedCatalog }));

app.use(express.static(frontendDir));

app.get("*", (req, res) => {
  res.sendFile(path.join(frontendDir, "index.html"));
});

app.use((error, req, res, next) => {
  console.error(error);
  if (error instanceof multer.MulterError) {
    res.status(400).json({ error: error.message || "No se pudo subir el archivo." });
    return;
  }
  if (error instanceof GeminiScaleError) {
    res.status(error.status || 502).json({
      error: error.message,
      code: error.code,
      model: error.model,
      modelsTried: error.modelsTried
    });
    return;
  }
  if (error instanceof GeminiConventionError) {
    res.status(error.status || 502).json({
      error: error.message,
      code: error.code,
      model: error.model,
      modelsTried: error.modelsTried
    });
    return;
  }
  res.status(error.status || 500).json({
    error: error.message || "Error interno",
    ...(error.details ? { details: error.details } : {})
  });
});

async function start() {
  db = await getDb();
  await ensureCatalogSeeded();
  await ensureScaleIndexes();

  app.listen(port, () => {
    console.log(`eSueldos API listo en http://localhost:${port}`);
    console.log(`MongoDB: ${db.databaseName}`);
  });
}

process.on("SIGINT", async () => {
  await closeDb();
  process.exit(0);
});

function setDbForTest(testDb) {
  db = testDb;
}

if (require.main === module) {
  start().catch(async (error) => {
    console.error("No se pudo iniciar el backend:", error.message);
    await closeDb();
    process.exit(1);
  });
}

module.exports = {
  app,
  setDbForTest,
  start
};
