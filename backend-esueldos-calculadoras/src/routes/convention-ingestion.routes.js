const path = require("path");
const express = require("express");
const fs = require("fs");
const multer = require("multer");
const { createGeminiClient } = require("../infrastructure/gemini/gemini-client");
const { createGeminiFileService } = require("../infrastructure/gemini/gemini-file-service");
const { createGeminiStoreService } = require("../infrastructure/gemini/gemini-store-service");
const { createGeminiRagService } = require("../infrastructure/gemini/gemini-rag-service");
const { createAgreementFileRepository } = require("../infrastructure/repositories/agreement-file-repository");
const { createConventionBuilder } = require("../application/conventions/convention-builder");
const { createConventionValidator } = require("../application/conventions/convention-validator");
const { createSchemaExtractionOrchestrator } = require("../application/conventions/schema-extraction-orchestrator");
const { createConventionIngestionWorkflow } = require("../application/conventions/convention-ingestion-workflow");
const { createMetadataExtractionAgent } = require("../application/conventions/agents/metadata-extraction-agent");
const { createCategoriesExtractionAgent } = require("../application/conventions/agents/categories-extraction-agent");
const { createConceptsExtractionAgent } = require("../application/conventions/agents/concepts-extraction-agent");
const { createLicensesExtractionAgent } = require("../application/conventions/agents/licenses-extraction-agent");
const { geminiConventionModel } = require("../gemini-config");
const logger = require("../shared/logger");

const allowedExtensions = new Set([".pdf", ".docx", ".md", ".markdown"]);
const allowedMimeTypes = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/markdown",
  "text/plain"
]);

function safeFileName(name) {
  return String(name || "documento")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 140) || "documento";
}

function parseMetadata(body = {}) {
  if (body.metadata) {
    try {
      return JSON.parse(body.metadata);
    } catch (error) {
      return {};
    }
  }
  return {
    tipo: body.tipo,
    actividad: body.actividad,
    cct: body.cct,
    version: body.version,
    fuente: body.fuente
  };
}

function createConventionIngestionRouter({
  backendRoot,
  apiKey = process.env.GEMINI_CONVENTION_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "",
  model = process.env.GEMINI_RAG_MODEL || geminiConventionModel(),
  fileSearchStoreName = process.env.GEMINI_FILE_SEARCH_STORE || "",
  fileSearchStoreDisplayName = process.env.GEMINI_FILE_SEARCH_STORE_DISPLAY_NAME || "esueldos-convenios",
  embeddingModel = process.env.GEMINI_FILE_SEARCH_EMBEDDING_MODEL || "models/gemini-embedding-2"
}) {
  const router = express.Router();
  const uploadDir = path.join(backendRoot, "uploads", "agreement-ingestion");
  const agreementsRoot = path.join(backendRoot, "agreements");
  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        fs.mkdirSync(uploadDir, { recursive: true });
        cb(null, uploadDir);
      },
      filename: (req, file, cb) => cb(null, `${Date.now()}-${safeFileName(file.originalname)}`)
    }),
    limits: { fileSize: Number(process.env.UPLOAD_CONVENTION_MAX_MB || 25) * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase();
      if (allowedExtensions.has(ext) || allowedMimeTypes.has(file.mimetype)) {
        cb(null, true);
        return;
      }
      cb(new Error("Solo se aceptan documentos PDF, DOCX o Markdown."));
    }
  });

  router.post("/api/conventions/ingest", upload.single("document"), async (req, res, next) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "Falta documento para estructurar." });
        return;
      }
      if (!apiKey) {
        res.status(500).json({ error: "Falta GEMINI_API_KEY o GEMINI_CONVENTION_API_KEY." });
        return;
      }

      const client = createGeminiClient({ apiKey });
      const geminiFileService = createGeminiFileService({ client });
      const geminiStoreService = createGeminiStoreService({ client, logger });
      const agreementRepository = createAgreementFileRepository({ rootDir: agreementsRoot });
      const conventionBuilder = createConventionBuilder();
      const validator = createConventionValidator();

      const createOrchestrator = ({ fileSearchStoreName: storeName }) => {
        const ragService = createGeminiRagService({ client, model, fileSearchStoreName: storeName });
        const agents = {
          metadata: createMetadataExtractionAgent({ ragService }),
          categories: createCategoriesExtractionAgent({ ragService }),
          concepts: createConceptsExtractionAgent({ ragService }),
          licenses: createLicensesExtractionAgent({ ragService })
        };
        return createSchemaExtractionOrchestrator({ agents, conventionBuilder });
      };

      const workflow = createConventionIngestionWorkflow({
        geminiFileService,
        geminiStoreService,
        createOrchestrator,
        validator,
        agreementRepository,
        fileSearchStoreName,
        fileSearchStoreDisplayName,
        embeddingModel,
        logger
      });

      const result = await workflow.execute({
        file: req.file,
        metadata: parseMetadata(req.body)
      });

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = {
  createConventionIngestionRouter
};
