function createUploadGeminiFileUseCase({ geminiStoreService }) {
  return {
    execute(file) {
      return geminiStoreService.upload(file);
    }
  };
}

module.exports = {
  createUploadGeminiFileUseCase
};
