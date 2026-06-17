const { createBaseRagAgent } = require("./base-rag-agent");

function createLicensesExtractionAgent({ ragService }) {
  return createBaseRagAgent({
    ragService,
    name: "LicensesExtractionAgent",
    instructions: [
      "Extraé únicamente régimen de licencias.",
      "Para vacaciones detectá escalas por antigüedad, días corridos y método de cálculo.",
      "Para licencias especiales detectá matrimonio, nacimiento, fallecimiento, examen, mudanza y cualquier otra licencia especial."
    ].join("\n"),
    responseShape: {
      regimen_licencias: {
        vacaciones: {
          metodo_calculo: "",
          escalas: []
        },
        especiales: []
      }
    }
  });
}

module.exports = {
  createLicensesExtractionAgent
};
