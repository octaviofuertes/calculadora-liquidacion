const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
require("dotenv").config();

const express = require("express");
const fs = require("fs");
const multer = require("multer");
const { ObjectId } = require("mongodb");
const { getDb, closeDb } = require("./db");
const { seedCatalog } = require("./seed");
const { askGemini, buildSystemInstruction } = require("./leia");
const { createGeminiClient } = require("./infrastructure/gemini/gemini-client");
const { createGeminiFileService } = require("./infrastructure/gemini/gemini-file-service");
const { createGeminiStoreService } = require("./infrastructure/gemini/gemini-store-service");
const { extractScalesFromPdf, GeminiScaleError } = require("./services/scale-ai");
const { extractConventionFromPdfs, GeminiConventionError } = require("./services/convention-rag-classified");
const { normalizeConvention } = require("./services/convention-normalizers");
const { sanitizeGenericConventionCategories } = require("./services/convention-ai");
const { extractPdfText } = require("./services/convention-gemini");
const { geminiPrimaryModel, geminiScaleModel, geminiConventionModel, geminiConventionApiKey, geminiScaleApiKey, geminiFallbackModels } = require("./gemini-config");
const { EXCEL_SCHEMA_VERSION, toRuntimeConvention, normalizeAndValidateCCTJson } = require("./models/convenio.model");
const {
  isSupportedConventionDocument,
  analyzeConventionDocuments,
  applyConventionArchitecture
} = require("./domain/convention-pipeline");
const { calculatePayroll } = require("./domain/payroll-engine");
const { configureSecurity } = require("./middleware/security");
const catalogService = require("./services/catalog-service");
const convenioService = require("./services/convenio-service");
const { calculateLiquidation } = require("./services/liquidation-service");
const tokenMetrics = require("./services/token-metrics");
const {
  deterministicLiquidationAudit,
  buildLiquidationAuditPrompt,
  fallbackAuditFromPrecheck,
  parseJsonObject
} = require("./services/liquidation-audit-service");
const scaleRepository = require("./repositories/scale-repository");
const { ensureVersionIndexes, saveConventionVersion } = require("./repositories/version-repository");
const { createAdminRouter } = require("./routes/admin.routes");
const { createAiRouter } = require("./routes/ai.routes");
const { createCatalogRouter } = require("./routes/catalog.routes");
const { createHealthRouter } = require("./routes/health.routes");
const { createConveniosRouter } = require("./routes/convenios.routes");
const { createConventionIngestionRouter } = require("./routes/convention-ingestion.routes");
const { createEmployeesRouter } = require("./routes/employees.routes");
const { createLiquidationsRouter } = require("./routes/liquidations.routes");
const { createScalesRouter } = require("./routes/scales.routes");
const createCalculatorRoutes = require("./routes/calculator.routes");
const logger = require("./shared/logger");
const { buildCalculator } = require("./services/calculator-builder");
const { parseOrThrow, calculationInputSchema, employeeWriteSchema, liquidationResultSchema, savedLiquidationSchema } = require("./domain/schemas");

const app = express();
const port = Number(process.env.PORT || 4100);
const backendRoot = path.resolve(__dirname, "..");
const frontendDir = path.resolve(backendRoot, process.env.FRONTEND_DIR || "../frontend-esueldos-calculadoras");

let _laborLawTextCache = null;
let _laborLawPathMtime = null;
async function getGlobalLaborLawText() {
  const filePath = path.join(conventionUploadDir, "global_labor_law.pdf");
  if (!fs.existsSync(filePath)) { _laborLawTextCache = null; return null; }
  try {
    const stat = fs.statSync(filePath);
    if (_laborLawTextCache && _laborLawPathMtime === stat.mtimeMs) return _laborLawTextCache;
    const buffer = await fs.promises.readFile(filePath);
    const text = await extractPdfText({ buffer, mimeType: "application/pdf", sourceFileName: "Ley de Trabajo" });
    _laborLawTextCache = text || null;
    _laborLawPathMtime = stat.mtimeMs;
    return _laborLawTextCache;
  } catch { return null; }
}
const uploadRoot = path.join(backendRoot, "uploads");
const scaleUploadDir = path.join(uploadRoot, "scales");
const conventionUploadDir = path.join(uploadRoot, "conventions");
const scaleUploadMaxBytes = Number(process.env.UPLOAD_SCALE_MAX_MB || 20) * 1024 * 1024;
const conventionUploadMaxBytes = Number(process.env.UPLOAD_CONVENTION_MAX_MB || 25) * 1024 * 1024;
const laborLawStoreName = process.env.GEMINI_FILE_SEARCH_STORE || "";
const laborLawStoreDisplayName = process.env.GEMINI_FILE_SEARCH_STORE_DISPLAY_NAME || "esueldos-convenios";
const laborLawEmbeddingModel = process.env.GEMINI_FILE_SEARCH_EMBEDDING_MODEL || "models/gemini-embedding-2";

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
    cb(new Error("Solo se aceptan PDF, DOCX o imagenes JPG, PNG y WEBP de escala salarial."));
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
  limits: { fileSize: conventionUploadMaxBytes, files: 6 },
  fileFilter: (req, file, cb) => {
    if (isSupportedConventionDocument(file)) {
      cb(null, true);
      return;
    }
    cb(new Error("Solo se aceptan PDF, DOCX o imagenes JPG, PNG y WEBP para estructurar convenios."));
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
    const runtimeConvention = convention.schemaVersion === EXCEL_SCHEMA_VERSION ? toRuntimeConvention(convention) : convention;
    conventions[runtimeConvention.id] = sanitizeGenericConventionCategories(runtimeConvention);
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
  await db.collection("liquidations").createIndex({ convention: 1, period: 1, createdAt: -1 });
  await convenioService.ensureConvenioIndexes(db);
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

async function updateApprovedConventionFromDraft(draft, convention, now = new Date()) {
  const conventionId = draft.approvedConventionId || convention.convenio?.convenio_id || convention.convenio?.denominacion || draft._id.toString();
  convention.convenio.convenio_id = conventionId;
  const existing = await db.collection("conventions").findOne({ id: conventionId });
  if (!existing) return;
  await db.collection("conventions").replaceOne(
    { id: conventionId },
    {
      _id: existing._id,
      order: existing.order,
      id: conventionId,
      ...convention,
      sourceDraftId: draft._id.toString(),
      approvedAt: existing.approvedAt || draft.reviewedAt || now,
      updatedAt: now
    }
  );
  try {
    await buildCalculator({ id: conventionId, ...convention });
  } catch (err) {
    logger.error(`Error al actualizar la calculadora para ${conventionId}:`, err);
  }
}

function conventionToEditableDraft(convention) {
  if (convention.schemaVersion === EXCEL_SCHEMA_VERSION) return convention;
  const periods = Array.isArray(convention.periods) && convention.periods.length ? convention.periods : [{ id: "", label: "" }];
  return normalizeConvention({
    schemaVersion: EXCEL_SCHEMA_VERSION,
    convenio: {
      convenio_id: convention.id,
      denominacion: convention.name || convention.shortName || convention.id,
      fuente_documento: convention.source || ""
    },
    ambitos: (convention.zones || []).map((zone, index) => ({
      ambito_id: zone.id || `ambito-${index + 1}`,
      tipo_ambito: "zona",
      descripcion: zone.label || zone.id || ""
    })),
    categorias: (convention.categories || []).map((category) => ({
      categoria_id: category.id,
      categoria_nombre: category.label || category.name || category.id,
      grupo_nombre: category.group || "",
      descripcion: category.description || "",
      modalidad_aplicable: category.salaryType || convention.type || ""
    })),
    conceptos: ((convention.liquidationModel || {}).concepts || []).map((concept) => ({
      concepto_id: concept.id,
      nombre: concept.label || concept.id,
      tipo_concepto: "haber",
      naturaleza: concept.rowType === "nonRemunerative" ? "no_remunerativo" : concept.rowType === "deduction" ? "retencion" : "remunerativo",
      unidad_calculo: concept.inputType || "",
      formula_base: concept.detail || concept.calculation || "",
      base_calculo: concept.base || "",
      porcentaje: concept.percent || "",
      importe_fijo: concept.amount || concept.unitAmount || "",
      condicion: concept.detail || ""
    })),
    escalas: periods.map((period, index) => ({
      escala_id: `escala-${index + 1}`,
      nombre_escala: period.label || period.id || `Periodo ${index + 1}`,
      periodo_desde: period.id || "",
      moneda: "ARS",
      valores: (convention.categories || []).flatMap((category) => {
        const periodId = period.id || "";
        const monthly = category.monthlyByPeriod?.[periodId] ?? category.monthly;
        const day = category.dayByPeriod?.[periodId] ?? category.day;
        const hourly = category.hourlyByPeriod?.[periodId] ?? category.hourly;
        const values = [];
        if (monthly !== undefined && monthly !== null && monthly !== "") values.push({ concepto_id: "SUELDO_BASICO", categoria_id: category.id, unidad_pago: "mensual", periodicidad: periodId, valor: monthly });
        if (day !== undefined && day !== null && day !== "") values.push({ concepto_id: "VALOR_JORNAL", categoria_id: category.id, unidad_pago: "jornal", periodicidad: periodId, valor: day });
        if (hourly !== undefined && hourly !== null && hourly !== "") values.push({ concepto_id: "VALOR_HORA", categoria_id: category.id, unidad_pago: "hora", periodicidad: periodId, valor: hourly });
        return values;
      }).map((value, valueIndex) => ({ valor_id: `valor-${index + 1}-${valueIndex + 1}`, escala_id: `escala-${index + 1}`, ...value }))
    })),
    adicionales: []
  }, { fallbackName: convention.name || convention.id, useFallbackDefaults: false });
}

async function getConventionOr404(conventionId) {
  return catalogService.getConventionOrThrow(db, conventionId);
}

async function findActiveScale(conventionId, period) {
  return scaleRepository.findActiveScale(db, conventionId, period);
}

async function findActiveScales(conventionId, period) {
  return scaleRepository.findActiveScales(db, conventionId, period);
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
      const activeScales = await findActiveScales(conventionId, period);
      const activeScale = activeScales[0] || null;
      return {
        period,
        label: monthLabel(period),
        activeScale: serializeScale(activeScale),
        activeScales: activeScales.map(serializeScale),
        submissions
      };
    }));
  }

app.use(createHealthRouter({ getDb: getDbInstance }));
app.use(createCatalogRouter({ getDb: getDbInstance }));
app.use(createConveniosRouter({ getDb: getDbInstance }));
app.use(createConventionIngestionRouter({ backendRoot }));
app.use(createEmployeesRouter({ getDb: getDbInstance }));
app.use(createScalesRouter({
  getDb: getDbInstance,
  scaleUpload,
  extractScalesFromPdf,
  geminiScaleApiKey,
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
app.use(createLiquidationsRouter({
  getDb: getDbInstance,
  calculateLiquidation,
  serializeScale
}));
app.use(createAiRouter({ getDb: getDbInstance }));
app.use('/api/calculators', createCalculatorRoutes({ getDb: getDbInstance }));

app.get("/api/settings", async (req, res, next) => {
  try {
    const filePath = path.join(conventionUploadDir, "global_labor_law.pdf");
    const editedPath = path.join(conventionUploadDir, "global_labor_law_edited.txt");
    const hasGlobalLaborLaw = fs.existsSync(filePath);
    res.json({ hasGlobalLaborLaw, hasEditedLaborLaw: hasGlobalLaborLaw && fs.existsSync(editedPath) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/settings/labor-law/preview", async (req, res, next) => {
  try {
    const filePath = path.join(conventionUploadDir, "global_labor_law.pdf");
    const editedPath = path.join(conventionUploadDir, "global_labor_law_edited.txt");
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: "No hay ley de trabajo cargada." });
      return;
    }
    const isEdited = fs.existsSync(editedPath);
    const buffer = isEdited ? null : await fs.promises.readFile(filePath);
    const text = isEdited
      ? await fs.promises.readFile(editedPath, "utf8")
      : await extractPdfText({ buffer, mimeType: "application/pdf", sourceFileName: "Ley de Trabajo Aplicable" });
    if (!text) {
      res.status(422).json({ error: "No se pudo leer texto util del PDF." });
      return;
    }
    const blocks = String(text)
      .split(/\n\s*\n+/)
      .map((block) => block.trim())
      .filter(Boolean);
    const rows = blocks.map((block, index) => {
      const lines = block.split(/\n+/).map((line) => line.trim()).filter(Boolean);
      const first = lines[0] || "";
      const rest = lines.slice(1).join(" ");
      return {
        concepto: first.slice(0, 120) || `Bloque ${index + 1}`,
        regla: rest || first,
        origin: "LEY_DE_TRABAJO_APLICABLE",
        pagina: ""
      };
    });
    res.json({
      sourceFileName: "Ley de Trabajo Aplicable",
      isEdited,
      rows,
      fullText: text
    });
  } catch (error) {
    next(error);
  }
});

app.put("/api/settings/labor-law/text", async (req, res, next) => {
  try {
    const pdfPath = path.join(conventionUploadDir, "global_labor_law.pdf");
    if (!fs.existsSync(pdfPath)) {
      res.status(404).json({ error: "No hay ley de trabajo cargada." });
      return;
    }
    const text = String(req.body?.text || "").replace(/\r\n/g, "\n").trim();
    if (text.length < 100) {
      res.status(400).json({ error: "El contenido legal es demasiado corto." });
      return;
    }
    if (text.length > 1800000) {
      res.status(413).json({ error: "El contenido legal supera el limite permitido." });
      return;
    }
    const editedPath = path.join(conventionUploadDir, "global_labor_law_edited.txt");
    const tempPath = `${editedPath}.${Date.now()}.tmp`;
    await fs.promises.writeFile(tempPath, text, "utf8");
    await fs.promises.rename(tempPath, editedPath);
    res.json({ ok: true, isEdited: true, characters: text.length });
  } catch (error) {
    next(error);
  }
});

app.post("/api/settings/labor-law", conventionUpload.single("laborLawPdf"), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "Falta documento PDF." });
      return;
    }
    const targetPath = path.join(conventionUploadDir, "global_labor_law.pdf");
    const editedPath = path.join(conventionUploadDir, "global_labor_law_edited.txt");
    await fs.promises.copyFile(req.file.path, targetPath);
    await fs.promises.unlink(req.file.path).catch(() => {});
    await fs.promises.unlink(editedPath).catch(() => {});
    const apiKey = geminiConventionApiKey() || geminiScaleApiKey();
    if (apiKey && laborLawStoreName) {
      const client = createGeminiClient({ apiKey });
      const geminiFileService = createGeminiFileService({ client });
      const geminiStoreService = createGeminiStoreService({ client, logger });
      const store = await geminiStoreService.getOrCreateStore({
        storeName: laborLawStoreName,
        displayName: laborLawStoreDisplayName,
        embeddingModel: laborLawEmbeddingModel
      });
      const buffer = await fs.promises.readFile(targetPath);
      const text = await extractPdfText({ buffer, mimeType: "application/pdf", sourceFileName: "Ley de Trabajo Aplicable" });
      const tempMdPath = path.join(conventionUploadDir, `global_labor_law-${Date.now()}.md`);
      await fs.promises.writeFile(tempMdPath, text || "", "utf8");
      try {
        const uploadedFile = await geminiFileService.uploadFile({
          filePath: tempMdPath,
          mimeType: "text/markdown",
          displayName: "Ley de Trabajo Aplicable"
        });
        await geminiStoreService.importUploadedFile({
          fileSearchStoreName: store.name,
          fileName: uploadedFile.name,
          metadata: {
            tipo: "LEY_TRABAJO_APLICABLE",
            fuente: "ley_laboral_global",
            cct: "global",
            version: "1"
          }
        });
      } finally {
        await fs.promises.unlink(tempMdPath).catch(() => {});
      }
    }
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/settings/labor-law", async (req, res, next) => {
  try {
    const targetPath = path.join(conventionUploadDir, "global_labor_law.pdf");
    const editedPath = path.join(conventionUploadDir, "global_labor_law_edited.txt");
    if (fs.existsSync(targetPath)) {
      await fs.promises.unlink(targetPath);
    }
    await fs.promises.unlink(editedPath).catch(() => {});
    res.json({ ok: true });
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
  { name: "scalePdf", maxCount: 5 }
]), async (req, res, next) => {
  try {
    const cctFile = req.files?.cctPdf?.[0] || null;
    const scaleFiles = req.files?.scalePdf || [];
    if (!cctFile && !scaleFiles.length) {
      res.status(400).json({ error: "Subi al menos el documento o imagen del CCT o una escala salarial." });
      return;
    }

    const draftName = String(req.body.name || "").trim() || "Convenio generado por leIA";
    const userNotes = String(req.body.notes || "").trim();
    const laborLaw = String(req.body.laborLaw || "").trim();
    const notes = [userNotes, laborLaw ? `Ley de trabajo aplicable (Contexto): ${laborLaw}` : ""].filter(Boolean).join("\n\n");
    const now = new Date();
    const apiKey = geminiConventionApiKey();
    let aiStatus = "SIN_API_KEY";
    let aiError = null;
    let aiModel = null;
    let aiModelsTried = [];
    let tokenUsage = null;
    let documentClassification = null;
    let parsedConvention = normalizeConvention({
      convention: {
        name: "",
        shortName: "",
        source: cctFile?.originalname || scaleFiles.map((file) => file.originalname).filter(Boolean).join(" + ") || "",
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

    const scalePdfs = await Promise.all(scaleFiles.map(async (file) => ({
      buffer: await fs.promises.readFile(file.path),
      mimeType: file.mimetype,
      sourceFileName: file.originalname
    })));
    const scalePdf = scalePdfs[0] || null;
    const cctPdf = cctFile ? {
      buffer: await fs.promises.readFile(cctFile.path),
      mimeType: cctFile.mimetype,
      sourceFileName: cctFile.originalname
    } : null;
    const processingPipeline = analyzeConventionDocuments([
      cctPdf && { ...cctPdf, field: "cctPdf" },
      ...scalePdfs.map((file) => ({ ...file, field: "scalePdf" }))
    ]);

    let globalLaborLawPdf = null;
    let globalLaborLawText = "";
    let laborLawStatus = {
      available: false,
      sourceFileName: "",
      mode: "none",
      used: false,
      readable: false,
      message: "No hay Sintesis/Ley de Trabajo Aplicable cargada. Los faltantes generales quedaran para revision manual."
    };
    const laborLawPath = path.join(conventionUploadDir, "global_labor_law.pdf");
    const laborLawEditedPath = path.join(conventionUploadDir, "global_labor_law_edited.txt");
    if (fs.existsSync(laborLawPath)) {
      globalLaborLawPdf = {
        buffer: await fs.promises.readFile(laborLawPath),
        mimeType: "application/pdf",
        sourceFileName: "Ley de Trabajo Aplicable"
      };
      if (fs.existsSync(laborLawEditedPath)) {
        globalLaborLawText = await fs.promises.readFile(laborLawEditedPath, "utf8");
      }
      laborLawStatus = {
        available: true,
        sourceFileName: "Ley de Trabajo Aplicable",
        mode: globalLaborLawText ? "edited_text" : "local_pdf",
        used: false,
        readable: false,
        message: globalLaborLawText
          ? "Version corregida de la Ley de Trabajo Aplicable cargada y activa."
          : "Sintesis/Ley de Trabajo Aplicable cargada localmente."
      };
    }

    if (!globalLaborLawPdf) {
      res.status(412).json({
        ok: false,
        errores: [{ path: "laborLaw", message: "Debes cargar la Ley de Trabajo Aplicable antes de estructurar un CCT." }],
        data: null
      });
      return;
    }

    if (!apiKey) {
      res.status(503).json({
        ok: false,
        errores: [{ path: "gemini.apiKey", message: "Falta configurar GEMINI_CONVENTION_API_KEY o GEMINI_API_KEY en el backend." }],
        data: null
      });
      return;
    }

    if (apiKey) {
      try {
        const result = await extractConventionFromPdfs({
          apiKey,
          model: geminiConventionModel(),
          fallbackModels: geminiFallbackModels(),
          cctPdf,
          scalePdf,
          scalePdfs,
          draftName,
          notes,
          globalLaborLawPdf,
          globalLaborLawText
        });
        parsedConvention = result.parsedConvention;
        const inputName = String(req.body.name || "").trim();
        if (inputName) {
          if (!parsedConvention.convenio) parsedConvention.convenio = {};
          parsedConvention.convenio.denominacion = inputName;
          parsedConvention.name = inputName;
        }
        documentClassification = result.documentClassification || parsedConvention.clasificacionDocumental || null;
        laborLawStatus = result.laborLawStatus || laborLawStatus;
        tokenUsage = result.tokenUsage || null;
        aiStatus = "ESTRUCTURADO_POR_LEIA";
        aiModel = result.model;
        aiModelsTried = result.modelsTried;
        if (tokenUsage) {
          await tokenMetrics.logUsage(getDbInstance(), {
            provider: "gemini",
            model: aiModel,
            promptTokens: tokenUsage.promptTokenCount || tokenUsage.promptTokens || 0,
            completionTokens: tokenUsage.outputTokenCount || tokenUsage.completionTokens || 0,
            totalTokens: tokenUsage.totalTokenCount || tokenUsage.totalTokens || 0,
            operation: "convention-extraction"
          });
        }
      } catch (error) {
        aiStatus = "ERROR_IA";
        aiError = error.message || "No se pudo estructurar el convenio con leIA.";
        aiModel = error.model || null;
        aiModelsTried = error.modelsTried || [];
        console.error("[CCT] Error estructurando con Gemini:", aiError);
        parsedConvention.warnings = Array.from(new Set([...(parsedConvention.warnings || []), aiError]));
        if (/alta demanda|overloaded|unavailable|try again later|503/i.test(aiError)) {
          aiStatus = "PENDIENTE_IA";
        }
      }
    }

    if (aiStatus === "ERROR_IA") {
      res.status(502).json({
        ok: false,
        errores: [{ path: "gemini", message: aiError }],
        data: null
      });
      return;
    }

    const aiAudit = parsedConvention.auditoriaIA || null;
    const internalConvention = parsedConvention.categories
      ? sanitizeGenericConventionCategories(applyConventionArchitecture(parsedConvention, processingPipeline))
      : parsedConvention;
    parsedConvention = normalizeConvention(internalConvention, {
      fallbackName: draftName,
      useFallbackDefaults: false
    });
    const validation = normalizeAndValidateCCTJson(parsedConvention);
    if (!validation.ok) {
      const onlyMissingScalePeriods = validation.errores?.length
        && validation.errores.every((item) => item.message === "Escala con importes pero sin periodo detectable");
      if (!onlyMissingScalePeriods) {
        res.status(422).json(validation);
        return;
      }
      parsedConvention = validation.data;
      aiStatus = "ESTRUCTURADO_CON_ADVERTENCIAS";
      aiError = "Las escalas fueron extraidas, pero falta confirmar su periodo de vigencia antes de aprobar.";
    } else {
      parsedConvention = validation.data;
    }
    if (aiAudit) parsedConvention.auditoriaIA = aiAudit;
    if (!validation.ok && aiAudit) {
      const blockers = Array.isArray(parsedConvention.auditoriaIA.bloqueantes) ? parsedConvention.auditoriaIA.bloqueantes : [];
      if (!blockers.some((item) => item.codigo === "ESCALA_PERIODO_FALTANTE")) {
        blockers.push({
          codigo: "ESCALA_PERIODO_FALTANTE",
          mensaje: "Hay escalas con importes pero sin periodo de vigencia detectable.",
          seccion: "escalas",
          rowId: "",
          campo: "mes",
          recomendacion: "Completar el mes o periodo de cada escala antes de aprobar.",
          fuente: "CCT / Escala"
        });
      }
      parsedConvention.auditoriaIA.bloqueantes = blockers;
      parsedConvention.auditoriaIA.nivelRiesgo = "ALTO";
    }
    if ((!laborLawStatus.available || !laborLawStatus.readable) && laborLawStatus.message) {
      parsedConvention.warnings = Array.from(new Set([...(parsedConvention.warnings || []), laborLawStatus.message]));
    }
    console.log(`[CCT final] categorias=${parsedConvention.categorias.length} conceptos=${parsedConvention.conceptos.length} escalas=${parsedConvention.escalas.length} adicionales=${parsedConvention.adicionales.length} ambitos=${parsedConvention.ambitos.length}`);
    const hasExtractedStructure = parsedConvention.categorias.length
      || parsedConvention.escalas.some((scale) => (scale.valores || []).length)
      || parsedConvention.conceptos.length
      || parsedConvention.adicionales.length
      || parsedConvention.ambitos.length;
    if (!hasExtractedStructure) {
      if (aiStatus === "PENDIENTE_IA") {
        parsedConvention.convenio.fuente_documento = parsedConvention.convenio.fuente_documento || "Pendiente de lectura por Gemini.";
      } else {
        res.status(422).json({
          ok: false,
          errores: [{ path: "estructura", message: "Gemini no extrajo datos estructurables del convenio actual. Revisar PDF/modelo." }],
          data: null
        });
        return;
      }
    }

    const files = [cctFile, ...scaleFiles].filter(Boolean).map((file) => ({
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
      laborLawStatus,
      documentClassification,
      parsedConvention,
      processingPipeline,
      tokenUsage: typeof tokenUsage !== "undefined" ? tokenUsage : null,
      auditNote: notes,
      files,
      createdAt: now,
      updatedAt: now
    };
    const insertResult = await db.collection("conventionDrafts").insertOne(doc);
    res.status(201).json({ ok: true, data: parsedConvention, ...serializeConventionDraft({ _id: insertResult.insertedId, ...doc }) });
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
      const aiAudit = req.body.parsedConvention?.auditoriaIA || null;
      update.parsedConvention = normalizeConvention(req.body.parsedConvention, {
        fallbackName: req.body.parsedConvention?.name || "Convenio pendiente de identificacion documental",
        useFallbackDefaults: false
      });
      const validation = normalizeAndValidateCCTJson(update.parsedConvention);
      if (!validation.ok) {
        res.status(422).json(validation);
        return;
      }
      update.parsedConvention = validation.data;
      if (aiAudit) update.parsedConvention.auditoriaIA = aiAudit;
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
    let updatedDraft = updatedDocument(result);
    if (updatedDraft && update.parsedConvention) updatedDraft = { ...updatedDraft, parsedConvention: update.parsedConvention };
    if (!updatedDraft) {
      res.status(404).json({ error: "Borrador no encontrado" });
      return;
    }
    if (updatedDraft.status === "APROBADO" && update.parsedConvention) {
      await updateApprovedConventionFromDraft(updatedDraft, update.parsedConvention, update.updatedAt);
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
    const convention = normalizeConvention(req.body?.parsedConvention || draft.parsedConvention, {
      fallbackName: "Convenio pendiente de identificacion documental",
      useFallbackDefaults: false
    });
    const validation = normalizeAndValidateCCTJson(convention);
    if (!validation.ok) {
      res.status(422).json(validation);
      return;
    }
    Object.assign(convention, validation.data);
    if (!convention.categorias.length) {
      res.status(400).json({ error: "El JSON no tiene categorias con importes. Revisalo antes de aprobar." });
      return;
    }
    const getScaleAmount = (value = {}) => (
      value.valor ?? value.sueldo_base ?? value.sueldoBase ?? value.importe ?? value.monto ?? value.amount ?? value.value
    );
    const hasScaleValues = convention.escalas.some((scale) => (scale.valores || []).some((value) => {
      const amount = getScaleAmount(value);
      return amount !== null && amount !== undefined && amount !== "";
    }));
    if (!hasScaleValues) {
      res.status(400).json({ error: "El JSON no tiene valores salariales en escalas[].valores. Reestructuralo antes de aprobar." });
      return;
    }

    let conventionId = convention.convenio?.convenio_id || draft._id.toString();
    const denominacion = String(convention.convenio?.denominacion || "");
    const nameMatch = denominacion.match(/(\d+)\s*[/.-]\s*(\d+)/);
    if (nameMatch) {
      conventionId = `cct_${nameMatch[1]}_${nameMatch[2]}`;
    } else if (!convention.convenio?.convenio_id && denominacion) {
      conventionId = denominacion;
    }
    convention.convenio.convenio_id = conventionId;
    const existing = await db.collection("conventions").findOne({ id: conventionId });
    const maxOrderDoc = await db.collection("conventions").find({}).sort({ order: -1 }).limit(1).next();
    const order = existing?.order || ((maxOrderDoc?.order || 0) + 1);
    await db.collection("conventions").replaceOne(
      { id: conventionId },
      {
        _id: existing?._id || conventionId,
        order,
        id: conventionId,
        ...convention,
        sourceDraftId: draft._id.toString(),
        approvedAt: now,
        updatedAt: now
      },
      { upsert: true }
    );
    try {
      await buildCalculator({ id: conventionId, ...convention });
    } catch (err) {
      logger.error(`Error al construir la calculadora para ${conventionId}:`, err);
    }
    const result = await db.collection("conventionDrafts").findOneAndUpdate(
      { _id: draft._id },
      {
        $set: {
          status: "APROBADO",
          parsedConvention: convention,
          approvedConventionId: conventionId,
          reviewedAt: now,
          reviewedBy: req.body?.reviewedBy || "Auditoria humana",
          reviewNote: req.body?.note || "",
          updatedAt: now
        }
      },
      { returnDocument: "after" }
    );
    const updatedDraft = updatedDocument(result);
    res.json({
      draft: serializeConventionDraft(updatedDraft),
      convention,
      conventionId
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
    const result = await db.collection("conventionDrafts").findOneAndDelete({ _id: id });
    const draft = updatedDocument(result);
    if (!draft) {
      res.status(404).json({ error: "Borrador no encontrado" });
      return;
    }
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

app.post("/api/scales/upload", scaleUpload.array("pdf", 20), async (req, res, next) => {
  try {
    const files = req.files || [];
    if (!files.length) {
      res.status(400).json({ error: "Selecciona al menos un PDF de escala salarial." });
      return;
    }

    const conventionId = String(req.body.conventionId || "");
    const convention = await getConventionOr404(conventionId);
    const period = normalizePeriod(req.body.period) || currentPeriod();
    const periodLabel = req.body.periodLabel || monthLabel(period);
    const now = new Date();
    const apiKey = geminiScaleApiKey();
    const batchId = `${now.getTime()}-${safeFileName(files[0].originalname)}`;
    const docs = [];

    for (const file of files) {
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
        sourceFileName: file.originalname,
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
          const pdfBuffer = await fs.promises.readFile(file.path);
          const result = await extractScalesFromPdf({
            apiKey,
            model: process.env.GEMINI_SCALE_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash",
            fallbackModels: geminiFallbackModels(),
            convention,
            period,
            periodLabel,
            pdfBuffer,
            mimeType: file.mimetype,
            sourceFileName: file.originalname
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

      docs.push(...parsedScales.map((parsedScale) => ({
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
        sourceFileName: file.originalname,
        storedFileName: file.filename,
        filePath: file.path,
        fileSize: file.size,
        mimeType: file.mimetype,
        parsedScale: {
          ...parsedScale,
          period: normalizePeriod(parsedScale.period) || period,
          periodLabel: parsedScale.periodLabel || monthLabel(normalizePeriod(parsedScale.period) || period)
        },
        auditNote: req.body.auditNote || "",
        uploadedBatchId: batchId,
        createdAt: now,
        updatedAt: now
      })));
    }

    const insertResult = await db.collection("salaryScales").insertMany(docs);
    const created = docs.map((doc, index) => serializeScale({ _id: insertResult.insertedIds[index], ...doc }));
    res.status(201).json({
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
    const apiKey = geminiConventionApiKey();
    if (!apiKey) {
      res.status(503).json({ error: "Falta configurar GEMINI_CONVENTION_API_KEY en el backend." });
      return;
    }

    const { message, history, state } = req.body || {};
    if (!message || typeof message !== "string") {
      res.status(400).json({ error: "Falta el mensaje para leIA." });
      return;
    }

    const catalog = await getCatalogPayload();
    const laborLawContext = await getGlobalLaborLawText();
    const systemInstruction = buildSystemInstruction({
      catalog,
      selectedConventionId: state?.convention?.id,
      clientState: state,
      laborLawContext
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
    const apiKey = geminiConventionApiKey();
    let audit = fallbackAuditFromPrecheck(precheck);
    let aiStatus = "SIN_API_KEY";
    let aiError = null;
    let aiModel = null;
    let aiModelsTried = [];

    if (apiKey) {
      try {
        const laborLawContext = await getGlobalLaborLawText();
        const baseSystemInstruction = "Sos leIA, auditora de liquidaciones de eSueldos. RespondÃ©s solamente JSON vÃ¡lido.";
        const systemInstruction = laborLawContext
          ? `${baseSystemInstruction}\n\nBASE DE CONOCIMIENTO LEGAL (LEY DE TRABAJO APLICABLE):\nEl administrador del sistema cargÃ³ el siguiente documento legal como base de conocimiento. Usalo como referencia autoritativa para responder consultas y justificar hallazgos de auditorÃ­a relacionados con derechos laborales, jornadas, vacaciones, indemnizaciones, licencias, y cualquier aspecto regulado por esta ley. CitÃ¡ artÃ­culos especÃ­ficos cuando sea pertinente.\n---\n${laborLawContext.slice(0, 15000)}\n---`
          : baseSystemInstruction;

        const result = await askGemini({
          apiKey,
          model: geminiPrimaryModel(),
          fallbackModels: geminiFallbackModels(),
          systemInstruction,
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
    res.json(conventions.map(({ _id, order, updatedAt, ...convention }) => (
      convention.schemaVersion === EXCEL_SCHEMA_VERSION ? toRuntimeConvention(convention) : convention
    )));
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
    res.json(payload.schemaVersion === EXCEL_SCHEMA_VERSION ? toRuntimeConvention(payload) : payload);
  } catch (error) {
    next(error);
  }
});

app.post("/api/conventions/:id/edit-draft", async (req, res, next) => {
  try {
    const convention = await db.collection("conventions").findOne({ id: req.params.id });
    if (!convention) {
      res.status(404).json({ error: "Convenio no encontrado" });
      return;
    }
    const existingDraft = await db.collection("conventionDrafts").findOne({
      status: "APROBADO",
      approvedConventionId: convention.id
    });
    if (existingDraft) {
      res.json(serializeConventionDraft(existingDraft));
      return;
    }
    const { _id, order, updatedAt, approvedAt, sourceDraftId, ...rawConvention } = convention;
    const parsedConvention = conventionToEditableDraft(rawConvention);
    const now = new Date();
    const doc = {
      name: parsedConvention.convenio?.denominacion || parsedConvention.name || convention.id,
      status: "APROBADO",
      aiStatus: "EDITABLE_DESDE_CONVENIO",
      aiError: null,
      aiModel: null,
      aiModelsTried: [],
      parsedConvention,
      approvedConventionId: convention.id,
      processingPipeline: null,
      tokenUsage: null,
      auditNote: "",
      files: [],
      reviewedAt: approvedAt || now,
      reviewedBy: "Convenio cargado",
      reviewNote: "Borrador editable creado desde convenio activo.",
      createdAt: now,
      updatedAt: now
    };
    const insertResult = await db.collection("conventionDrafts").insertOne(doc);
    res.status(201).json(serializeConventionDraft({ _id: insertResult.insertedId, ...doc }));
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
    res.json(await calculateLiquidation(db, req.body, serializeScale));
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
  logger.error(error);
  if (typeof multer !== "undefined" && multer && typeof multer.MulterError === "function" && error instanceof multer.MulterError) {
    const message = error.code === "LIMIT_FILE_COUNT"
      ? "PodÃ©s subir 1 archivo CCT y hasta 5 archivos de escala salarial."
      : error.message || "No se pudo subir el archivo.";
    res.status(400).json({ error: message });
    return;
  }
  if (typeof GeminiScaleError === "function" && error instanceof GeminiScaleError) {
    res.status(error.status || 502).json({
      error: error.message,
      code: error.code,
      model: error.model,
      modelsTried: error.modelsTried
    });
    return;
  }
  if (typeof GeminiConventionError === "function" && error instanceof GeminiConventionError) {
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
    logger.info(`eSueldos API listo en http://localhost:${port}`);
    logger.info(`MongoDB: ${db.databaseName}`);
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
