const { createBaseRagAgent } = require("./base-rag-agent");

function createCategoriesExtractionAgent({ ragService }) {
  return createBaseRagAgent({
    ragService,
    name: "CategoriesExtractionAgent",
    instructions: [
      "Extraé categorias laborales, agrupamientos, ramas, clases/letras, descripcion, basicos y escalas salariales.",
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
      ]
    }
  });
}

module.exports = {
  createCategoriesExtractionAgent
};
