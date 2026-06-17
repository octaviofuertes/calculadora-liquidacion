const { createBaseRagAgent } = require("./base-rag-agent");

function createConceptsExtractionAgent({ ragService }) {
  return createBaseRagAgent({
    ragService,
    name: "ConceptsExtractionAgent",
    instructions: [
      "Extraé conceptos remunerativos, no remunerativos y retenciones.",
      "Mapeá tipo obligatoriamente a REMUNERATIVO, NO_REMUNERATIVO o RETENCION.",
      "Detectá metodo_calculo automáticamente:",
      "1% por año => PORCENTAJE_SOBRE_BASES.",
      "Básico / 200 => DIVISION_REGLA_FIJA.",
      "Importe fijo por categoría => SUMA_FIJA_CATEGORIA.",
      "Formula compleja => FORMULA_CUSTOM.",
      "Incluí básico, antigüedad, presentismo, adicionales, zona, productividad, acuerdos, bonos, asignaciones, sumas extraordinarias, jubilación, obra social, sindicato y seguros cuando existan."
    ].join("\n"),
    responseShape: {
      conceptos: [
        {
          codigo_interno: "",
          nombre: "",
          tipo: "REMUNERATIVO",
          metodo_calculo: "NO_DETECTADO",
          parametros: {},
          condicion_aplicacion: "",
          aporta_a: [],
          impacta_en: [],
          contexto: ""
        }
      ]
    }
  });
}

module.exports = {
  createConceptsExtractionAgent
};
