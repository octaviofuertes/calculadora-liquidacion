const { geminiModelList } = require("./gemini-config");

function compactConvention(convention) {
  return {
    id: convention.id,
    name: convention.name,
    shortName: convention.shortName,
    source: convention.source,
    periods: convention.periods,
    zones: convention.zones,
    categories: convention.categories,
    excelConvention: convention.excelConvention ? {
      schemaVersion: convention.excelConvention.schemaVersion,
      convenio: convention.excelConvention.convenio,
      categorias: (convention.excelConvention.categorias || []).slice(0, 40),
      escalas: (convention.excelConvention.escalas || []).map((scale) => ({
        escala_id: scale.escala_id,
        nombre_escala: scale.nombre_escala,
        periodo_desde: scale.periodo_desde,
        periodo_hasta: scale.periodo_hasta,
        zona: scale.zona,
        valores: (scale.valores || []).slice(0, 40)
      })),
      conceptos: (convention.excelConvention.conceptos || []).slice(0, 40),
      adicionales: (convention.excelConvention.adicionales || []).slice(0, 40)
    } : null,
    additionals: convention.additionals,
    constants: convention.constants,
    scales: convention.scales,
    nonRem: convention.nonRem
  };
}

function buildSystemInstruction({ catalog, selectedConventionId, clientState }) {
  const conventions = Object.values(catalog.conventions || {});
  const selected = catalog.conventions?.[selectedConventionId] || conventions[0];
  const selectedLabel = selected ? `${selected.shortName || selected.name} (${selected.name})` : "sin convenio seleccionado";

  const context = {
    app: {
      name: "eSueldos",
      assistant: "leIA",
      purpose: "sistema de liquidacion de sueldos multiconvenio",
      workflow: [
        "Paso 1: elegir convenio",
        "Paso 2: datos de trabajador, periodo, zona y categoria",
        "Paso 3: conceptos y parametros del convenio",
        "Paso 4: revision final y boton Liquidar"
      ],
      rule: "La liquidacion no se recalcula automaticamente; el usuario debe presionar Liquidar."
    },
    activeConvention: selected ? compactConvention(selected) : null,
    availableConventions: conventions.map((conv) => ({
      id: conv.id,
      name: conv.name,
      shortName: conv.shortName,
      source: conv.source,
      periods: conv.periods?.map((period) => period.label || period.id),
      categories: conv.categories?.map((cat) => cat.label),
      zones: conv.zones?.map((zone) => zone.label),
      excelSchema: conv.excelConvention?.schemaVersion || null
    })),
    legalReferences: catalog.legalReferences || [],
    currentScreenState: clientState || {}
  };

  return [
    "Sos leIA, la asistente y asesora técnica hiper-experta del sistema eSueldos.",
    "Responde siempre en español argentino, siendo clara, directa y muy precisa técnicamente.",
    "Tu rol principal es asistir a liquidadores de sueldos profesionales. Debes demostrar un nivel de especialización máximo en el funcionamiento de eSueldos y en el convenio colectivo activo.",
    `El convenio activo actualmente seleccionado por el usuario es: ${selectedLabel}. ¡Sos la mayor experta nacional en la liquidación de este convenio!`,
    "CONOCIMIENTO DEL SISTEMA ESUELDOS:",
    "- eSueldos es un liquidador multiconvenio estructurado en pasos secuenciales: Selección de Convenio, Datos del Trabajador (incluye inasistencias), Parámetros del Convenio (horas extra, adicionales específicos) y Revisión final (donde se liquida y audita).",
    "- El sistema NO liquida solo mientras se llenan los datos. El usuario SIEMPRE debe presionar el botón 'Liquidar' en el último paso para ver los resultados.",
    "- Los recibos se pueden auditar (botón Auditar con leIA), guardar y gestionar desde la vista principal de Empleados.",
    "- Existe un modulo Convenios IA: el usuario sube PDF del CCT y PDF de escala. leIA genera el JSON nuevo schemaVersion esueldos-cct-estructura-excel-v1 con claves raiz convenio, ambitos, categorias, conceptos, escalas y adicionales.",
    "- En el JSON nuevo, categorias[].categoria_nombre define categorias y escalas[].valores contiene categoria_id, zona, modalidad, unidad_pago, periodicidad y valor. Usa rama/grupo_nombre/zona para explicar escalas por rama o zona.",
    "- Para convenios generados por JSON nuevo, el backend convierte internamente a formato liquidable runtime. Reconoce ambos nombres: categories/categorias, periods/escalas, zones/zona.",
    "CONOCIMIENTO DE CONVENIOS (Ej. CAMIONEROS CCT 40/89, UOCRA, FARMACIA):",
    "- Si el convenio activo es Camioneros, debes saber perfectamente como eSueldos calcula: divisor convencional 24 para jornal, valor hora jornal/8, presentismo 8,33% si no hay injustificadas, antiguedad 1% por año sobre conceptos remunerativos, kilometraje de larga distancia separando Item 4.2.3 remunerativo e Item 4.2.4 viatico no remunerativo, viaticos Art. 4.2.11 fuera de cargas sociales, aportes Camioneros configurables (cuota sindical 2%, contribucion solidaria 3% y seguro de sepelio 1,5%).",
    "- Si el convenio activo es Farmacia Mendoza, debes saber como eSueldos calcula CCT 429/2005: jornada base 45 hs semanales, jornada insalubre de hasta 33 hs pagada como jornada completa, proporcional por horas y porcentaje del mes, antiguedad por escala 5/10/20/25/30/35%, adicionales de cajero/perfumeria/administracion/bici/idiomas/titulo farmaceutico/adscripcion/bloqueo, nocturnidad voluntaria 100%, feriado del empleado de farmacia del 6 de septiembre, horas extra con divisor 200, vacaciones con divisor 25, inasistencias con divisor 30, no remunerativos por periodo Abril/Mayo/Junio 2026, base de obra social con control de jornada reducida, aporte solidario ADEF, contribucion extraordinaria de escala y asistencia social 1% en junio/diciembre.",
    "- Debes explicarle al usuario exactamente cómo interactuar con los campos de la interfaz para lograr la liquidación correcta de estos ítems si te lo pregunta.",
    "REGLAS ESTRICTAS:",
    "1. Usa EXCLUSIVAMENTE el contexto de catálogo, escalas, parámetros y estado de pantalla recibido. No alucines montos ni porcentajes.",
    "2. Si falta una escala, advertílo y explicale cómo subir un PDF de escala para que la IA lo procese.",
    "3. Considera siempre la categoría, periodo, zona, inasistencias y el último resultado enviado por el frontend para dar respuestas contextuales exactas.",
    `Contexto actualizado del sistema (pantalla actual, parámetros, recibo):\n${JSON.stringify(context, null, 2)}`
  ].join("\n\n");
}

function normalizeHistory(history = []) {
  return history
    .filter((item) => item && ["user", "model"].includes(item.role) && typeof item.text === "string")
    .slice(-8)
    .map((item) => ({
      role: item.role,
      parts: [{ text: item.text.slice(0, 1800) }]
    }));
}

function extractGeminiText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts || [];
  return parts.map((part) => part.text || "").join("").trim();
}

class GeminiRequestError extends Error {
  constructor(message, { status, model, code } = {}) {
    super(message);
    this.name = "GeminiRequestError";
    this.status = status;
    this.model = model;
    this.code = code;
  }
}

function isRetryableGeminiError(error) {
  const message = String(error.message || "").toLowerCase();
  return error.status === 429
    || error.status === 404
    || error.status === 503
    || message.includes("high demand")
    || message.includes("overloaded")
    || message.includes("not found")
    || message.includes("not supported")
    || message.includes("generatecontent")
    || message.includes("try again later")
    || message.includes("unavailable");
}

async function askGeminiOnce({ apiKey, model, systemInstruction, message, history, maxOutputTokens = 900, temperature = 0.35 }) {
  const contents = [
    ...normalizeHistory(history),
    {
      role: "user",
      parts: [{ text: String(message || "").slice(0, 4000) }]
    }
  ];

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemInstruction }]
      },
      contents,
      generationConfig: {
        temperature,
        topP: 0.9,
        maxOutputTokens
      }
    })
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const messageText = payload?.error?.message || `Gemini respondio HTTP ${response.status}`;
    throw new GeminiRequestError(messageText, {
      status: response.status,
      model,
      code: payload?.error?.status
    });
  }

  const text = extractGeminiText(payload);
  if (!text) {
    throw new GeminiRequestError("Gemini no devolvio texto.", { status: 502, model });
  }

  return text;
}

async function askGemini({ apiKey, model, fallbackModels, systemInstruction, message, history, maxOutputTokens, temperature }) {
  const models = geminiModelList(model, fallbackModels);
  const errors = [];

  for (const currentModel of models) {
    try {
      const answer = await askGeminiOnce({
        apiKey,
        model: currentModel,
        systemInstruction,
        message,
        history,
        maxOutputTokens,
        temperature
      });
      return { answer, model: currentModel, modelsTried: [...errors.map((item) => item.model), currentModel] };
    } catch (error) {
      errors.push({
        model: currentModel,
        message: error.message,
        status: error.status,
        code: error.code
      });

      if (!isRetryableGeminiError(error)) {
        throw error;
      }
    }
  }

  const lastError = errors[errors.length - 1];
  const saturated = new GeminiRequestError(
    "Gemini esta con alta demanda en este momento. leIA probo modelos alternativos, pero todos respondieron saturados. Proba nuevamente en unos minutos.",
    { status: 503, model: lastError?.model, code: "MODEL_OVERLOADED" }
  );
  saturated.modelsTried = errors.map((item) => item.model);
  throw saturated;
}

module.exports = {
  askGemini,
  buildSystemInstruction
};
