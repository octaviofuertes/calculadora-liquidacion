const { createBaseRagAgent } = require("./base-rag-agent");

function createMetadataExtractionAgent({ ragService }) {
  return createBaseRagAgent({
    ragService,
    name: "MetadataExtractionAgent",
    instructions: [
      "Extraé únicamente identidad del convenio laboral argentino.",
      "Campos: cct_id, nombre_convenio, version_acuerdo, vigencia, organizaciones y contexto.",
      "No extraigas categorias, conceptos ni licencias."
    ].join("\n"),
    responseShape: {
      cct_id: "",
      nombre_convenio: "",
      version_acuerdo: "",
      vigencia: { desde: "", hasta: "" },
      organizaciones: { sindical: "", patronal: [] },
      contexto: ""
    }
  });
}

module.exports = {
  createMetadataExtractionAgent
};
