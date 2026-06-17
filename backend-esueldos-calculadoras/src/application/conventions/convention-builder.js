const { emptyConvenioColectivo } = require("../../domain/conventions/convenio-colectivo.schema");

function pickAllowed(source, keys) {
  return keys.reduce((acc, key) => {
    if (Object.prototype.hasOwnProperty.call(source || {}, key)) acc[key] = source[key];
    return acc;
  }, {});
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizeCategoria(item = {}, index) {
  return {
    id: String(item.id || `CAT_${index + 1}`).trim(),
    agrupamiento: String(item.agrupamiento || "").trim(),
    rama: String(item.rama || "").trim(),
    clase_letra: String(item.clase_letra || "").trim(),
    descripcion: String(item.descripcion || "").trim(),
    sueldo_basico: toNumber(item.sueldo_basico)
  };
}

function normalizeConcepto(item = {}, index) {
  const allowedTipos = new Set(["REMUNERATIVO", "NO_REMUNERATIVO", "RETENCION"]);
  const allowedMetodos = new Set(["PORCENTAJE_SOBRE_BASES", "DIVISION_REGLA_FIJA", "SUMA_FIJA_CATEGORIA", "FORMULA_CUSTOM", "NO_DETECTADO"]);
  return {
    codigo_interno: String(item.codigo_interno || `CONCEPTO_${index + 1}`).trim(),
    nombre: String(item.nombre || "").trim(),
    tipo: allowedTipos.has(item.tipo) ? item.tipo : "REMUNERATIVO",
    metodo_calculo: allowedMetodos.has(item.metodo_calculo) ? item.metodo_calculo : "NO_DETECTADO",
    parametros: item.parametros && typeof item.parametros === "object" && !Array.isArray(item.parametros) ? item.parametros : {},
    condicion_aplicacion: String(item.condicion_aplicacion || "").trim(),
    aporta_a: Array.isArray(item.aporta_a) ? item.aporta_a.map(String) : [],
    impacta_en: Array.isArray(item.impacta_en) ? item.impacta_en.map(String) : [],
    contexto: String(item.contexto || "").trim()
  };
}

function createConventionBuilder() {
  return {
    build(parts) {
      const base = emptyConvenioColectivo();
      const metadata = pickAllowed(parts.metadata || {}, ["cct_id", "nombre_convenio", "version_acuerdo", "vigencia", "organizaciones", "contexto"]);
      const licenses = parts.licenses?.regimen_licencias || parts.licenses || {};

      return {
        ...base,
        ...metadata,
        vigencia: {
          desde: String(metadata.vigencia?.desde || "").trim(),
          hasta: String(metadata.vigencia?.hasta || "").trim()
        },
        organizaciones: {
          sindical: String(metadata.organizaciones?.sindical || "").trim(),
          patronal: Array.isArray(metadata.organizaciones?.patronal) ? metadata.organizaciones.patronal.map(String) : []
        },
        categorias: Array.isArray(parts.categories?.categorias)
          ? parts.categories.categorias.map(normalizeCategoria)
          : [],
        conceptos: Array.isArray(parts.concepts?.conceptos)
          ? parts.concepts.conceptos.map(normalizeConcepto)
          : [],
        regimen_licencias: {
          vacaciones: {
            metodo_calculo: String(licenses.vacaciones?.metodo_calculo || "").trim(),
            escalas: Array.isArray(licenses.vacaciones?.escalas) ? licenses.vacaciones.escalas : []
          },
          especiales: Array.isArray(licenses.especiales) ? licenses.especiales : []
        },
        contexto: String(metadata.contexto || parts.contexto || "").trim()
      };
    }
  };
}

module.exports = {
  createConventionBuilder
};
