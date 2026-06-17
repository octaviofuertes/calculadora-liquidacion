function createConventionValidator() {
  return {
    validate(convenio) {
      const warnings = [];

      if (!String(convenio.cct_id || "").trim()) warnings.push("cct_id obligatorio");
      if (!String(convenio.nombre_convenio || "").trim()) warnings.push("nombre_convenio obligatorio");
      if (!Array.isArray(convenio.categorias) || convenio.categorias.length === 0) warnings.push("categorias obligatorias");
      if (!Array.isArray(convenio.conceptos) || convenio.conceptos.length === 0) warnings.push("conceptos obligatorios");

      return {
        review_required: warnings.length > 0,
        warnings
      };
    }
  };
}

module.exports = {
  createConventionValidator
};
