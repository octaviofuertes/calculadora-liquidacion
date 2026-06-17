function metadataToCustomMetadata(metadata = {}) {
  return Object.entries(metadata)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => {
      const numericValue = Number(value);
      if (Number.isFinite(numericValue) && String(value).trim() !== "") {
        return { key, numericValue };
      }
      return { key, stringValue: String(value) };
    });
}

function createGeminiStoreService({ client, logger }) {
  async function waitOperation(operation) {
    let current = operation;
    while (!current.done) {
      logger?.info?.("[Gemini File Search] indexando documento...");
      await new Promise((resolve) => setTimeout(resolve, 5000));
      current = await client.operations.get({ operation: current });
    }
    return current;
  }

  return {
    async getOrCreateStore({ storeName, displayName, embeddingModel }) {
      if (storeName) {
        return client.fileSearchStores.get({ name: storeName });
      }

      return client.fileSearchStores.create({
        config: {
          displayName,
          embeddingModel
        }
      });
    },

    async importUploadedFile({ fileSearchStoreName, fileName, metadata }) {
      const operation = await client.fileSearchStores.importFile({
        fileSearchStoreName,
        fileName,
        config: {
          customMetadata: metadataToCustomMetadata(metadata)
        }
      });

      return waitOperation(operation);
    },

    async listDocuments({ storeName }) {
      return client.fileSearchStores.documents.list({ parent: storeName });
    }
  };
}

module.exports = {
  createGeminiStoreService,
  metadataToCustomMetadata
};
