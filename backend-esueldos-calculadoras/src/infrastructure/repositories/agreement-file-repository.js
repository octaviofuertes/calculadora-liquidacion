const fs = require("fs");
const path = require("path");

function safeSegment(value) {
  return String(value || "sin-cct")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "sin-cct";
}

async function writeJson(filePath, payload) {
  await fs.promises.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function createAgreementFileRepository({ rootDir }) {
  return {
    async save({ convenio, metadata, extractionLog }) {
      const cctId = safeSegment(convenio.cct_id || metadata.cct || metadata.cct_id);
      const dir = path.join(rootDir, cctId);
      await fs.promises.mkdir(dir, { recursive: true });

      await writeJson(path.join(dir, "convenio.json"), convenio);
      await writeJson(path.join(dir, "metadata.json"), metadata);
      await writeJson(path.join(dir, "extraction_log.json"), extractionLog);

      return {
        cctId,
        dir,
        convenioPath: path.join(dir, "convenio.json"),
        metadataPath: path.join(dir, "metadata.json"),
        extractionLogPath: path.join(dir, "extraction_log.json")
      };
    }
  };
}

module.exports = {
  createAgreementFileRepository,
  safeSegment
};
