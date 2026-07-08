const convenioColectivoJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    cct_id: { type: "string" },
    nombre_convenio: { type: "string" },
    version_acuerdo: { type: "string" },
    vigencia: {
      type: "object",
      additionalProperties: false,
      properties: {
        desde: { type: "string" },
        hasta: { type: "string" }
      },
      required: ["desde", "hasta"]
    },
    organizaciones: {
      type: "object",
      additionalProperties: false,
      properties: {
        sindical: { type: "string" },
        patronal: { type: "array", items: { type: "string" } }
      },
      required: ["sindical", "patronal"]
    },
    categorias: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          agrupamiento: { type: "string" },
          rama: { type: "string" },
          clase_letra: { type: "string" },
          descripcion: { type: "string" },
          sueldo_basico: { type: "number" }
        },
        required: ["id", "agrupamiento", "rama", "clase_letra", "descripcion", "sueldo_basico"]
      }
    },
    conceptos: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          codigo_interno: { type: "string" },
          nombre: { type: "string" },
          tipo: { enum: ["REMUNERATIVO", "NO_REMUNERATIVO", "RETENCION"] },
          metodo_calculo: { enum: ["PORCENTAJE_SOBRE_BASES", "DIVISION_REGLA_FIJA", "SUMA_FIJA_CATEGORIA", "FORMULA_CUSTOM", "NO_DETECTADO"] },
          parametros: { type: "object" },
          condicion_aplicacion: { type: "string" },
          aporta_a: { type: "array", items: { type: "string" } },
          impacta_en: { type: "array", items: { type: "string" } },
          contexto: { type: "string" }
        },
        required: ["codigo_interno", "nombre", "tipo", "metodo_calculo", "parametros", "condicion_aplicacion", "aporta_a", "impacta_en", "contexto"]
      }
    },
    regimen_licencias: {
      type: "object",
      additionalProperties: false,
      properties: {
        vacaciones: {
          type: "object",
          additionalProperties: false,
          properties: {
            metodo_calculo: { type: "string" },
            escalas: { type: "array", items: { type: "object" } }
          },
          required: ["metodo_calculo", "escalas"]
        },
        especiales: { type: "array", items: { type: "object" } }
      },
      required: ["vacaciones", "especiales"]
    },
    escalas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          nombre_escala: { type: "string" },
          periodo_desde: { type: "string" },
          periodo_hasta: { type: "string" },
          valores: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                categoria_id: { type: "string" },
                concepto_id: { type: "string" },
                valor: { type: "number" }
              },
              required: ["categoria_id", "valor"]
            }
          }
        },
        required: ["nombre_escala", "valores"]
      }
    },
    contexto: { type: "string" }
  },
  required: [
    "cct_id",
    "nombre_convenio",
    "version_acuerdo",
    "vigencia",
    "organizaciones",
    "categorias",
    "conceptos",
    "regimen_licencias",
    "contexto"
  ]
};

function emptyConvenioColectivo() {
  return {
    cct_id: "",
    nombre_convenio: "",
    version_acuerdo: "",
    vigencia: { desde: "", hasta: "" },
    organizaciones: { sindical: "", patronal: [] },
    categorias: [],
    conceptos: [],
    regimen_licencias: {
      vacaciones: { metodo_calculo: "", escalas: [] },
      especiales: []
    },
    escalas: [],
    contexto: ""
  };
}

module.exports = {
  convenioColectivoJsonSchema,
  emptyConvenioColectivo
};
