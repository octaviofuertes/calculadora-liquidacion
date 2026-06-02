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
const { extractConventionFromPdfs, normalizeConvention, sanitizeGenericConventionCategories, GeminiConventionError } = require("./convention-ai");
const {
  isSupportedConventionDocument,
  analyzeConventionDocuments,
  applyConventionArchitecture
} = require("./domain/convention-pipeline");
const { calculatePayroll } = require("./domain/payroll-engine");
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
const { parseOrThrow, calculationInputSchema, liquidationResultSchema, savedLiquidationSchema } = require("./domain/schemas");

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
    if (isSupportedConventionDocument(file)) {
      cb(null, true);
      return;
    }
    cb(new Error("Solo se aceptan PDF o imagenes JPG, PNG y WEBP de escala salarial."));
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
    if (isSupportedConventionDocument(file)) {
      cb(null, true);
      return;
    }
    cb(new Error("Solo se aceptan PDF o imagenes JPG, PNG y WEBP para estructurar convenios."));
  }
});

configureSecurity(app);
app.use(express.json({ limit: "2mb" }));
app.use("/uploads", express.static(uploadRoot));

let db;

function getDbInstance() {
  return db;
}

function requireAuth(req, res, next) {
  if (!req.user) {
    res.status(401).json({ error: "No autorizado" });
    return;
  }
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) {
      res.status(401).json({ error: "No autorizado" });
      return;
    }
    if (req.user.role !== role) {
      res.status(403).json({ error: "Acceso denegado" });
      return;
    }
    next();
  };
}

function requireAuthWhenEnabled(req, res, next) {
  if (process.env.AUTH_REQUIRED !== "true") {
    return next();
  }
  return requireAuth(req, res, next);
}

function geminiFallbackModels() {
  return String(process.env.GEMINI_FALLBACK_MODELS || "gemini-2.5-flash-lite,gemini-2.0-flash")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function toCatalogPayload(constantsDoc, conventionDocs, legalReferenceDocs) {
  const { _id, updatedAt, ...constants } = constantsDoc || {};
  const conventions = {};

  conventionDocs.forEach((doc) => {
    const { _id: mongoId, order, updatedAt: conventionUpdatedAt, ...convention } = doc;
    conventions[convention.id] = sanitizeGenericConventionCategories(convention);
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
  await db.collection("conventionVersions").createIndex({ conventionId: 1, version: -1 });
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

function conventionZoneId(value) {
  const normalized = String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return [
    "general",
    "base",
    "zona-general",
    "zona-base",
    "base-general",
    "general-base",
    "sin-adicional",
    "sin-adicional-zonal",
    "sin-adicional-de-zona"
  ].includes(normalized) ? "general" : normalized;
}

function normalizeConventionZone(zone = {}) {
  const { coefficient, coeficiente, name, zona, ...payload } = zone;
  const id = conventionZoneId(zone.id || zone.label || zone.name || zone.zona);
  const rawCoef = zone.coef ?? zone.coefficient ?? zone.coeficiente;
  const numericCoef = rawCoef === null || rawCoef === undefined || rawCoef === "" ? null : Number(rawCoef);
  return {
    ...payload,
    id,
    label: id === "general" ? "General" : (zone.label || zone.name || zone.zona || id),
    coef: Number.isFinite(numericCoef) ? numericCoef : (id === "general" ? 1 : null)
  };
}

function mergeConventionZones(conventionZones = [], scaleZones = []) {
  const byId = new Map();
  [...conventionZones, ...scaleZones].forEach((zone) => {
    const normalized = normalizeConventionZone(zone);
    if (!normalized.id) return;
    byId.set(normalized.id, { ...(byId.get(normalized.id) || {}), ...normalized });
  });
  return Array.from(byId.values());
}

function mergeConventionNonRemunerativeRules(conventionRules = {}, scaleRules = {}) {
  const merged = { ...conventionRules };
  [
    "enabled",
    "seniorityEnabled",
    "seniorityPercentPerYear",
    "seniorityCapYears",
    "presentismEnabled",
    "presentismPercent",
    "presentismRequiresNoUnjustifiedAbsence",
    "subjectToHealthInsurance",
    "subjectToUnion"
  ].forEach((key) => {
    if (scaleRules[key] !== undefined && scaleRules[key] !== null) merged[key] = scaleRules[key];
  });
  ["legalReferences", "notes"].forEach((key) => {
    if (!Array.isArray(scaleRules[key]) || !scaleRules[key].length) return;
    merged[key] = Array.from(new Set([...(Array.isArray(merged[key]) ? merged[key] : []), ...scaleRules[key]]));
  });
  return merged;
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

function updatedDocument(result) {
  if (!result) return null;
  return Object.prototype.hasOwnProperty.call(result, "value") ? result.value : result;
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

app.get("/api/health", async (req, res) => {
  try {
    await db.command({ ping: 1 });
    res.json({ ok: true, mongo: true, db: db.databaseName });
  } catch (error) {
    res.status(503).json({ ok: false, mongo: false, error: error.message });
  }
});

app.post("/api/auth/bootstrap-admin", async (req, res, next) => {
  try {
    const count = await db.collection("users").countDocuments();
    if (count > 0) {
      res.status(409).json({ error: "Ya existen usuarios. Crea nuevos usuarios con un admin autenticado." });
      return;
    }
    const payload = parseOrThrow(userCreateSchema.extend({ role: userCreateSchema.shape.role.default("admin") }), {
      ...req.body,
      role: "admin"
    }, "Usuario admin invalido");
    const user = await createUser(db, payload);
    const login = await authenticateUser(db, { email: payload.email, password: payload.password });
    res.status(201).json({ user: login.user || { id: user._id.toString(), email: user.email, name: user.name, role: user.role }, token: login.token });
  } catch (error) {
    next(error);
  }
});

app.get("/api/auth/status", async (req, res, next) => {
  try {
    const usersCount = await db.collection("users").countDocuments();
    res.json({
      hasUsers: usersCount > 0,
      authRequired: process.env.AUTH_REQUIRED === "true"
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const payload = parseOrThrow(loginSchema, req.body, "Credenciales invalidas");
    res.json(await authenticateUser(db, payload));
  } catch (error) {
    next(error);
  }
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  res.json({ user: req.user });
});

app.get("/api/users", requireRole("admin"), async (req, res, next) => {
  try {
    const docs = await db.collection("users").find({}, {
      projection: { passwordHash: 0 }
    }).sort({ createdAt: -1 }).limit(200).toArray();
    res.json(docs.map(({ _id, ...doc }) => ({ id: _id.toString(), ...doc })));
  } catch (error) {
    next(error);
  }
});

app.post("/api/users", requireRole("admin"), async (req, res, next) => {
  try {
    const payload = parseOrThrow(userCreateSchema, req.body, "Usuario invalido");
    const user = await createUser(db, payload);
    res.status(201).json({ id: user._id.toString(), email: user.email, name: user.name, role: user.role, active: user.active });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/users/:id", requireRole("admin"), async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      res.status(400).json({ error: "ID invalido" });
      return;
    }
    const payload = parseOrThrow(userUpdateSchema, req.body, "Usuario invalido");
    const result = await db.collection("users").findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $set: { ...payload, updatedAt: new Date() } },
      { returnDocument: "after", projection: { passwordHash: 0 } }
    );
    if (!result) {
      res.status(404).json({ error: "Usuario no encontrado" });
      return;
    }
    const { _id, ...doc } = result;
    res.json({ id: _id.toString(), ...doc });
  } catch (error) {
    next(error);
  }
});

app.use("/api", (req, res, next) => {
  if (req.method === "GET" || req.path.startsWith("/auth/")) return next();
  return requireAuthWhenEnabled(req, res, next);
});

app.get("/api/catalog", async (req, res, next) => {
  try {
    res.json(await getCatalogPayload());
  } catch (error) {
    next(error);
  }
});

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
      res.status(400).json({ error: "Subi al menos el documento o imagen del CCT o una escala salarial." });
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
        name: "",
        shortName: "",
        source: cctFile?.originalname || scaleFile?.originalname || "",
        periods: [],
        zones: [],
        categories: [],
        liquidationModel: {
          rules: {},
          concepts: [],
          deductions: [],
          retentions: [],
          employerContributions: []
        },
        warnings: ["Carga pendiente de lectura por IA."]
      }
    }, {
      fallbackName: "Convenio pendiente de identificacion documental",
      useFallbackDefaults: false
    });

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
    const processingPipeline = analyzeConventionDocuments([
      cctPdf && { ...cctPdf, field: "cctPdf" },
      scalePdf && { ...scalePdf, field: "scalePdf" }
    ]);

    if (apiKey) {
      try {
        const result = await extractConventionFromPdfs({
          apiKey,
          model: process.env.GEMINI_CONVENTION_MODEL || process.env.GEMINI_SCALE_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash",
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

    parsedConvention = sanitizeGenericConventionCategories(applyConventionArchitecture(parsedConvention, processingPipeline));

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
      processingPipeline,
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
      update.parsedConvention = normalizeConvention({ convention: req.body.parsedConvention }, {
        fallbackName: req.body.parsedConvention?.name || "Convenio pendiente de identificacion documental",
        useFallbackDefaults: false
      });
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
    const updatedDraft = updatedDocument(result);
    if (!updatedDraft) {
      res.status(404).json({ error: "Borrador no encontrado" });
      return;
    }
    res.json(serializeConventionDraft(updatedDraft));
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
    }, {
      fallbackName: "Convenio pendiente de identificacion documental",
      useFallbackDefaults: false
    });
    if (!convention.categories.length) {
      res.status(400).json({ error: "El JSON no tiene categorias con importes. Revisalo antes de aprobar." });
      return;
    }

    const existing = await db.collection("conventions").findOne({ id: convention.id });
    const maxOrderDoc = await db.collection("conventions").find({}).sort({ order: -1 }).limit(1).next();
    const order = existing?.order || ((maxOrderDoc?.order || 0) + 1);
    await db.collection("conventions").replaceOne(
      { id: convention.id },
      {
        _id: existing?._id || convention.id,
        order,
        ...convention,
        sourceDraftId: draft._id.toString(),
        approvedAt: now,
        updatedAt: now
      },
      { upsert: true }
    );
    const updatedDraft = await db.collection("conventionDrafts").findOneAndUpdate(
      { _id: draft._id },
      {
        $set: {
          status: "APROBADO",
          parsedConvention: convention,
          approvedConventionId: convention.id,
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
      convention
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
    const updatedDraft = updatedDocument(result);
    if (!updatedDraft) {
      res.status(404).json({ error: "Borrador no encontrado" });
      return;
    }
    res.json(serializeConventionDraft(updatedDraft));
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

app.get("/api/scales", async (req, res, next) => {
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
    const docs = await db.collection("salaryScales").find(filter).sort({ createdAt: -1 }).limit(limit).toArray();
    res.json(docs.map(serializeScale));
  } catch (error) {
    next(error);
  }
});

app.get("/api/scales/months", async (req, res, next) => {
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

app.get("/api/scales/active", async (req, res, next) => {
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

app.get("/api/scales/:id", async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      res.status(400).json({ error: "ID invalido" });
      return;
    }
    const doc = await db.collection("salaryScales").findOne({ _id: new ObjectId(req.params.id) });
    if (!doc) {
      res.status(404).json({ error: "Escala no encontrada" });
      return;
    }
    res.json(serializeScale(doc));
  } catch (error) {
    next(error);
  }
});

app.post("/api/scales/upload", scaleUpload.single("pdf"), async (req, res, next) => {
  try {
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
          model: process.env.GEMINI_SCALE_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash",
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

app.patch("/api/scales/:id", async (req, res, next) => {
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

    const result = await db.collection("salaryScales").findOneAndUpdate(
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

app.post("/api/scales/:id/approve", async (req, res, next) => {
  try {
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
    res.json(serializeScale(result));
  } catch (error) {
    next(error);
  }
});

app.post("/api/scales/:id/reject", async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      res.status(400).json({ error: "ID invalido" });
      return;
    }

    const now = new Date();
    const result = await db.collection("salaryScales").findOneAndUpdate(
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
      model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
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
          model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
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

app.get("/api/conventions", async (req, res, next) => {
  try {
    const conventions = await db.collection("conventions").find({}).sort({ order: 1, name: 1 }).toArray();
    res.json(conventions.map(({ _id, order, updatedAt, ...convention }) => convention));
  } catch (error) {
    next(error);
  }
});

app.get("/api/conventions/:id", async (req, res, next) => {
  try {
    const convention = await db.collection("conventions").findOne({ id: req.params.id });
    if (!convention) {
      res.status(404).json({ error: "Convenio no encontrado" });
      return;
    }
    const { _id, order, updatedAt, ...payload } = convention;
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/conventions/:id", async (req, res, next) => {
  try {
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

app.get("/api/liquidations", async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit || 50), 200);
    const docs = await db.collection("liquidations").find({}).sort({ createdAt: -1 }).limit(limit).toArray();
    res.json(docs.map(({ _id, ...doc }) => ({ id: _id.toString(), ...doc })));
  } catch (error) {
    next(error);
  }
});

app.get("/api/liquidations/:id", async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      res.status(400).json({ error: "ID invalido" });
      return;
    }
    const doc = await db.collection("liquidations").findOne({ _id: new ObjectId(req.params.id) });
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

app.post("/api/liquidations/calculate", async (req, res, next) => {
  try {
    const payload = parseOrThrow(calculationInputSchema, req.body, "Datos de liquidacion invalidos");
    const catalog = await getCatalogPayload();
    const activeDoc = await findActiveScale(payload.conventionId, payload.period);
    const result = calculatePayroll({
      catalog,
      payload,
      activeScale: serializeScale(activeDoc)
    });
    const checkedResult = parseOrThrow(liquidationResultSchema, result, "Resultado de liquidacion invalido");
    res.json(checkedResult);
  } catch (error) {
    next(error);
  }
});

app.post("/api/liquidations", async (req, res, next) => {
  try {
    const payload = parseOrThrow(savedLiquidationSchema, req.body, "Liquidacion invalida");

    const now = new Date();
    const doc = {
      ...payload,
      createdAt: now,
      updatedAt: now
    };

    const result = await db.collection("liquidations").insertOne(doc);
    res.status(201).json({ id: result.insertedId.toString(), ...doc });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/liquidations/:id", async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      res.status(400).json({ error: "ID invalido" });
      return;
    }
    const result = await db.collection("liquidations").deleteOne({ _id: new ObjectId(req.params.id) });
    if (result.deletedCount === 0) {
      res.status(404).json({ error: "Liquidacion no encontrada" });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/employees/next-legajo", async (req, res, next) => {
  try {
    const docs = await db.collection("employees").find({}, { projection: { legajo: 1 } }).toArray();
    const max = docs.reduce((current, emp) => {
      const num = parseInt(emp.legajo, 10);
      return !Number.isNaN(num) && num > current ? num : current;
    }, 0);
    const nextLegajo = String(max + 1).padStart(3, "0");
    res.json({ nextLegajo });
  } catch (error) {
    next(error);
  }
});

app.get("/api/employees/search", async (req, res, next) => {
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

    const docs = await db.collection("employees").find(filter).limit(10).toArray();
    res.json(docs.map(({ _id, ...doc }) => ({ id: _id.toString(), ...doc })));
  } catch (error) {
    next(error);
  }
});

app.get("/api/employees", async (req, res, next) => {
  try {
    const docs = await db.collection("employees").find({}).sort({ legajo: 1 }).toArray();
    res.json(docs.map(({ _id, ...doc }) => ({ id: _id.toString(), ...doc })));
  } catch (error) {
    next(error);
  }
});

app.get("/api/employees/:legajo", async (req, res, next) => {
  try {
    const doc = await db.collection("employees").findOne({ legajo: req.params.legajo });
    if (!doc) {
      res.status(404).json({ error: "Empleado no encontrado" });
      return;
    }
    const { _id, ...payload } = doc;
    res.json({ id: _id.toString(), ...payload });
  } catch (error) {
    next(error);
  }
});

app.post("/api/employees", async (req, res, next) => {
  try {
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

app.put("/api/employees/:id", async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      res.status(400).json({ error: "ID invalido" });
      return;
    }
    const payload = parseOrThrow(employeeWriteSchema.partial().passthrough(), req.body, "Empleado invalido");
    const { id, _id, ...updateData } = payload;

    const result = await db.collection("employees").findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $set: { ...updateData, updatedAt: new Date() } },
      { returnDocument: "after" }
    );

    if (!result) {
      res.status(404).json({ error: "Empleado no encontrado" });
      return;
    }
    const { _id: mongoId, ...updatedDoc } = result;
    res.json({ id: mongoId.toString(), ...updatedDoc });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/employees/:id", async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      res.status(400).json({ error: "ID invalido" });
      return;
    }
    const result = await db.collection("employees").deleteOne({ _id: new ObjectId(req.params.id) });
    if (result.deletedCount === 0) {
      res.status(404).json({ error: "Empleado no encontrado" });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/seed", async (req, res, next) => {
  try {
    const catalog = await seedCatalog(db);
    res.json({ ok: true, conventions: catalog.conventions.length });
  } catch (error) {
    next(error);
  }
});

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
  mergeConventionNonRemunerativeRules,
  mergeConventionZones,
  setDbForTest,
  start
};
