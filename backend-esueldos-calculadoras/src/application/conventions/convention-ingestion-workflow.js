const crypto = require("crypto");

function normalizeMetadata(metadata = {}) {
  return {
    tipo: String(metadata.tipo || "CONVENIO"),
    actividad: String(metadata.actividad || ""),
    cct: String(metadata.cct || metadata.cct_id || ""),
    version: String(metadata.version || metadata.version_acuerdo || ""),
    fuente: String(metadata.fuente || ""),
    ingestion_id: String(metadata.ingestion_id || crypto.randomUUID())
  };
}

function createConventionIngestionWorkflow({
  geminiFileService,
  geminiStoreService,
  createOrchestrator,
  validator,
  agreementRepository,
  fileSearchStoreName,
  fileSearchStoreDisplayName,
  embeddingModel,
  logger
}) {
  return {
    async execute({ file, metadata }) {
      const documentMetadata = normalizeMetadata(metadata);
      const store = await geminiStoreService.getOrCreateStore({
        storeName: fileSearchStoreName,
        displayName: fileSearchStoreDisplayName,
        embeddingModel
      });

      const uploadedFile = await geminiFileService.uploadFile({
        filePath: file.path,
        mimeType: file.mimetype,
        displayName: file.originalname
      });

      await geminiStoreService.importUploadedFile({
        fileSearchStoreName: store.name,
        fileName: uploadedFile.name,
        metadata: documentMetadata
      });

      logger.info("[ConventionIngestionWorkflow] documento indexado en Gemini File Search Store");

      const orchestrator = createOrchestrator({ fileSearchStoreName: store.name });
      const extraction = await orchestrator.execute({
        ingestionId: documentMetadata.ingestion_id,
        metadata: documentMetadata,
        fileSearchStoreName: store.name
      });
      const validation = validator.validate(extraction.convenio);
      const persisted = await agreementRepository.save({
        convenio: extraction.convenio,
        metadata: {
          ...documentMetadata,
          file_search_store: store.name,
          gemini_file: uploadedFile.name,
          original_file_name: file.originalname,
          mime_type: file.mimetype
        },
        extractionLog: {
          createdAt: new Date().toISOString(),
          agents: Object.keys(extraction.parts),
          validation,
          parts: extraction.parts
        }
      });

      return {
        convenio: extraction.convenio,
        validation,
        metadata: documentMetadata,
        fileSearchStore: store.name,
        persisted
      };
    }
  };
}

module.exports = {
  createConventionIngestionWorkflow,
  normalizeMetadata
};
