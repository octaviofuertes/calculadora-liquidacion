const { createBaseRagAgent } = require("./base-rag-agent");

function createCategoriesExtractionAgent({ ragService }) {
  return createBaseRagAgent({
    ragService,
    name: "CategoriesExtractionAgent",
    instructions: [
      "Extraé categorias laborales, agrupamientos, ramas, clases/letras, descripcion, basicos y escalas salariales.",
      "La categoria representa unicamente el cargo. Nunca incluyas rama ni zona en el nombre.",
      "Los encabezados de tabla son contexto (grupo/rama/zona), no categorias.",
      "Si solo cambia la rama o la zona, reutilizá la misma categoria y diferenciá en la escala salarial.",
      "Si una categoria no tiene basico detectado, usá sueldo_basico 0.",
      "No extraigas conceptos ni licencias."
    ].join("\n"),
    responseShape: {
      categorias: [
        {
          id: "",
          agrupamiento: "",
          rama: "",
          clase_letra: "",
          descripcion: "",
          sueldo_basico: 0
        }
      ],
      escalas: [
        {
          nombre_escala: "",
          periodo_desde: "",
          periodo_hasta: "",
          valores: [
            {
              categoria_id: "",
              concepto_id: "SUELDO_BASICO",
              valor: 0
            }
          ]
        }
      ]
    }
  });
}

module.exports = {
  createCategoriesExtractionAgent
};
