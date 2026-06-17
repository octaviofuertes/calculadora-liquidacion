function createGeminiFileService({ client }) {
  return {
    uploadFile({ filePath, mimeType, displayName }) {
      return client.files.upload({
        file: filePath,
        config: {
          mimeType,
          name: displayName
        }
      });
    },

    getFile(name) {
      return client.files.get({ name });
    },

    deleteFile(name) {
      return client.files.delete({ name });
    }
  };
}

module.exports = {
  createGeminiFileService
};
