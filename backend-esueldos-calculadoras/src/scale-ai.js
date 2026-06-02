const { geminiModelList } = require("./gemini-config");

class GeminiScaleError extends Error {
  constructor(message, { status, model, code, modelsTried } = {}) {
    super(message);
    this.name = "GeminiScaleError";
    this.status = status;
    this.model = model;
    this.code = code;
    this.modelsTried = modelsTried || [];
  }
}

function isRetryable(error) {
  const message = String(error.message || "").toLowerCase();
  return error.status === 429
    || error.status === 404
    || error.status === 503
    || message.includes("high demand")
    || message.includes("overloaded")
    || message.includes("not found")
    || message.includes("not supported")
    || message.includes("generatecontent")
    || message.includes("unavailable")
    || message.includes("try again later");
}

function stripJsonFences(text) {
  const raw = String(text || "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first >= 0 && last > first) return raw.slice(first, last + 1);
  return raw;
}

function parseGeminiJson(text) {
  const jsonText = stripJsonFences(text);
  try {
    return JSON.parse(jsonText);
  } catch (error) {
    throw new GeminiScaleError("Gemini no devolvio un JSON valido para la escala.", {
      status: 502,
      code: "INVALID_JSON"
    });
  }
}

function periodFromText(value, fallbackYear) {
  const raw = normalizeText(value);
  const yearMatch = raw.match(/\b(20\d{2})\b/);
  const year = yearMatch?.[1] || fallbackYear;
  const monthMap = {
    enero: "01",
    ene: "01",
    febrero: "02",
    feb: "02",
    marzo: "03",
    mar: "03",
    abril: "04",
    abr: "04",
    mayo: "05",
    may: "05",
    junio: "06",
    jun: "06",
    julio: "07",
    jul: "07",
    agosto: "08",
    ago: "08",
    septiembre: "09",
    setiembre: "09",
    sep: "09",
    set: "09",
    octubre: "10",
    oct: "10",
    noviembre: "11",
    nov: "11",
    diciembre: "12",
    dic: "12"
  };
  const monthKey = Object.keys(monthMap).find((key) => raw.includes(key));
  if (monthKey && year) return `${year}-${monthMap[monthKey]}`;
  const iso = String(value || "").match(/\b(20\d{2})-(0[1-9]|1[0-2])\b/);
  return iso ? iso[0] : null;
}

function monthLabelFromPeriod(period) {
  const match = String(period || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return period || "";
  const names = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  return `${names[Number(match[2]) - 1] || match[2]} ${match[1]}`;
}

function fallbackYearFromPeriod(period) {
  const match = String(period || "").match(/^(20\d{2})-/);
  return match?.[1] || String(new Date().getFullYear());
}

function extractGeminiText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts || [];
  return parts.map((part) => part.text || "").join("").trim();
}

function normalizeMoney(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = String(value)
    .replace(/\s/g, "")
    .replace(/\$/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function normalizeRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => ({
      id: row.id ? String(row.id) : "",
      label: row.label || row.category || row.name || "",
      zone: row.zone || row.zona || "",
      monthly: normalizeMoney(row.monthly ?? row.sueldoMensual ?? row.basicoMensual ?? row.baseSalary),
      day: normalizeMoney(row.day ?? row.jornal ?? row.valorDia),
      hourly: normalizeMoney(row.hourly ?? row.hora ?? row.valorHora),
      nonRemunerative: normalizeMoney(row.nonRemunerative ?? row.noRemunerativo ?? row.snr),
      notes: Array.isArray(row.notes) ? row.notes.filter(Boolean).map(String) : []
    }))
    .filter((row) => row.label || row.monthly || row.day || row.hourly || row.nonRemunerative);
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function rowHasAnyAmount(row) {
  return [row.monthly, row.day, row.hourly, row.nonRemunerative, row.coefficient]
    .some((value) => Number.isFinite(Number(value)) && Number(value) > 0);
}

function rowHasSalaryAmount(row) {
  return [row.monthly, row.day, row.hourly]
    .some((value) => Number.isFinite(Number(value)) && Number(value) > 0);
}

function rowHasNonRemAmount(row) {
  return Number.isFinite(Number(row.nonRemunerative)) && Number(row.nonRemunerative) > 0;
}

function matchesKnownCategory(row, convention) {
  const rowId = normalizeText(row.id);
  const rowLabel = normalizeText(row.label);
  return (convention.categories || []).some((category) => {
    const catId = normalizeText(category.id);
    const catLabel = normalizeText(category.label);
    return (rowId && catId && rowId === catId)
      || (rowLabel && catLabel && (rowLabel === catLabel || rowLabel.includes(catLabel) || catLabel.includes(rowLabel)));
  });
}

function hasSevereWarning(warnings) {
  const text = warnings.join(" ").toLowerCase();
  return text.includes("no se encontraron importes")
    || text.includes("no encontro importes")
    || text.includes("sin importes")
    || text.includes("no detecto filas")
    || text.includes("no pudo detectar");
}

function scoreScaleConfidence({ parsedConfidence, categories, additionals, nonRemunerative, zones, warnings, sourceSummary, convention }) {
  const allRows = [...categories, ...additionals, ...nonRemunerative];
  const amountRows = allRows.filter(rowHasAnyAmount).length;
  const salaryRows = allRows.filter(rowHasSalaryAmount).length;
  const nonRemRows = allRows.filter(rowHasNonRemAmount).length;
  const knownCategoryCount = Math.max(1, (convention.categories || []).length);
  const matchedCategories = categories.filter((row) => matchesKnownCategory(row, convention)).length;
  const severeWarning = hasSevereWarning(warnings);

  if (!amountRows) {
    return Math.max(0, Math.min(severeWarning ? 20 : 35, parsedConfidence || 0));
  }

  let score = 42;
  score += Math.min(24, salaryRows * 4);
  score += Math.min(12, nonRemRows * 2);
  score += Math.min(18, Math.round((matchedCategories / knownCategoryCount) * 18));
  score += categories.length >= Math.ceil(knownCategoryCount * 0.7) ? 10 : Math.min(8, categories.length * 2);
  score += zones.length ? 3 : 0;
  score += sourceSummary ? 4 : 0;
  score += warnings.length ? -Math.min(12, warnings.length * 3) : 5;
  if (severeWarning) score -= 28;

  const geminiConfidence = Math.max(0, Math.min(100, Number(parsedConfidence) || 0));
  const calibrated = Math.max(geminiConfidence, score);
  return Math.max(0, Math.min(severeWarning ? 65 : 96, Math.round(calibrated)));
}

function normalizeScale(parsed, { convention, period, sourceFileName }) {
  const fallbackYear = fallbackYearFromPeriod(period);
  const detectedPeriod = periodFromText(parsed.period || parsed.periodLabel || parsed.month || parsed.mes || "", fallbackYear) || period;
  const categories = normalizeRows(parsed.categories || parsed.items || parsed.rows);
  const additionals = normalizeRows(parsed.additionals || parsed.adicionales);
  const zones = Array.isArray(parsed.zones || parsed.zonas)
    ? (parsed.zones || parsed.zonas).map((zone) => ({
      id: zone.id ? String(zone.id) : "",
      label: zone.label || zone.name || zone.zona || "",
      coefficient: normalizeMoney(zone.coefficient ?? zone.coeficiente ?? zone.coef)
    })).filter((zone) => zone.label || zone.coefficient)
    : [];
  const warnings = Array.isArray(parsed.warnings || parsed.alertas)
    ? (parsed.warnings || parsed.alertas).filter(Boolean).map(String)
    : [];
  const sourceSummary = parsed.sourceSummary || parsed.resumen || "";
  const parsedConfidence = Number(parsed.confidence ?? parsed.confidenceScore ?? 0) || 0;
  const normalizedNonRemunerative = Array.isArray(parsed.nonRemunerative || parsed.noRemunerativos)
    ? normalizeRows(parsed.nonRemunerative || parsed.noRemunerativos)
    : [];

  return {
    period: detectedPeriod,
    periodLabel: parsed.periodLabel || parsed.label || monthLabelFromPeriod(detectedPeriod),
    conventionId: convention.id,
    conventionName: convention.name,
    cct: convention.source || parsed.cct || "",
    sourceFileName,
    sourceSummary,
    confidence: scoreScaleConfidence({
      parsedConfidence,
      categories,
      additionals,
      nonRemunerative: normalizedNonRemunerative,
      zones,
      warnings,
      sourceSummary,
      convention
    }),
    categories,
    additionals,
    zones,
    nonRemunerative: normalizedNonRemunerative,
    notes: Array.isArray(parsed.notes || parsed.observaciones)
      ? (parsed.notes || parsed.observaciones).filter(Boolean).map(String)
      : [],
    warnings
  };
}

function normalizeScaleBundle(parsed, { convention, period, sourceFileName }) {
  const fallbackYear = fallbackYearFromPeriod(period);
  const entries = Array.isArray(parsed.scales || parsed.periods || parsed.months)
    ? (parsed.scales || parsed.periods || parsed.months)
    : [parsed];

  const normalized = entries
    .map((entry) => {
      const entryPeriod = periodFromText(entry.period || entry.periodLabel || entry.month || entry.mes || "", fallbackYear) || period;
      return normalizeScale(
        {
          ...parsed,
          ...entry,
          categories: entry.categories || entry.items || entry.rows || parsed.categories || parsed.items || parsed.rows,
          additionals: entry.additionals || entry.adicionales || parsed.additionals || parsed.adicionales,
          zones: entry.zones || entry.zonas || parsed.zones || parsed.zonas,
          nonRemunerative: entry.nonRemunerative || entry.noRemunerativos || parsed.nonRemunerative || parsed.noRemunerativos,
          notes: entry.notes || entry.observaciones || parsed.notes || parsed.observaciones,
          warnings: entry.warnings || entry.alertas || parsed.warnings || parsed.alertas,
          sourceSummary: entry.sourceSummary || entry.resumen || parsed.sourceSummary || parsed.resumen,
          confidence: entry.confidence ?? entry.confidenceScore ?? parsed.confidence ?? parsed.confidenceScore,
          period: entryPeriod,
          periodLabel: entry.periodLabel || entry.label || monthLabelFromPeriod(entryPeriod)
        },
        { convention, period: entryPeriod, sourceFileName }
      );
    });

  const byPeriod = new Map();
  normalized.forEach((scale) => {
    if (!byPeriod.has(scale.period)) byPeriod.set(scale.period, scale);
  });
  return Array.from(byPeriod.values()).sort((a, b) => a.period.localeCompare(b.period));
}

function buildScalePrompt({ convention, period, periodLabel }) {
  const categories = (convention.categories || []).map((cat) => `${cat.id}: ${cat.label}`).join("; ");
  const zones = (convention.zones || []).map((zone) => `${zone.id}: ${zone.label}${zone.coef ? ` coef ${zone.coef}` : ""}`).join("; ");
  const periods = (convention.periods || []).map((item) => item.label || item.id).join(", ");
  const itemKeys = convention.items ? Object.keys(convention.items).join(", ") : "";
  const hasAutomaticZoneCoef = (convention.zones || []).some((zone) => Number(zone.coef) && Number(zone.coef) !== 1);
  const automaticZoneLines = hasAutomaticZoneCoef
    ? [
      "REGLA CRITICA DE ZONAS: este sistema aplica coeficientes zonales automaticamente.",
      "Extrae SOLO importes de la zona base/general/sin adicional zonal en categories.",
      "No repitas categorias por Sur, Rio Colorado, Santa Cruz ni otras zonas derivadas.",
      "Carga las zonas derivadas solo en el array zones con su coefficient."
    ]
    : [];
  const camionerosLines = convention.id === "camioneros"
    ? [
      "REGLA CAMIONEROS: la planilla suele traer tres columnas por zona. Usa solo la columna Base/General para categories.",
      "Los valores de comida, viatico, pernoctada, kilometraje, permanencia, simple presencia, cruce de frontera, ingreso a isla, plus vacacional y bitrenes van en additionals, una sola fila por concepto.",
      "No generes mas de 60 filas entre categories y additionals."
    ]
    : [];

  return [
    "Sos leIA, asistente de auditoria de escalas salariales de eSueldos.",
    "Lee el PDF adjunto y extrae importes de escala salarial para revision humana.",
    "Si el PDF contiene importes para varios meses o periodos, crea una escala separada por cada mes/periodo detectado.",
    "Ejemplo: si una escala de Farmacia trae basico Abril 2026 y columnas no remunerativas Abril/Mayo/Junio 2026, devolve tres escalas: 2026-04, 2026-05 y 2026-06. Repite el basico en cada mes y cambia el no remunerativo segun la columna de ese mes.",
    "No inventes importes. Si un dato no esta claro, usa null y agregalo en warnings.",
    "El campo confidence debe medir la confianza de extraccion de datos: usa 85 a 95 si detectaste la mayoria de categorias conocidas con importes claros; usa menos de 50 solo si faltan importes o hay dudas importantes.",
    "Para planillas extensas, prioriza una fila por categoria conocida y una fila por adicional/concepto salarial conocido. Evita duplicados y manten notes vacio salvo que sea necesario.",
    "REGLA CRITICA DE MONTOS: Extrae unicamente valores monetarios fijos. Si un adicional o concepto se define como un porcentaje (ej. 10%, 1%, etc.), cargalo como null en los importes y si es necesario indicalo en notes. NUNCA extraigas un porcentaje como si fuera un monto en pesos (ej. NO extraigas 10% como 10).",
    "Si el convenio usa zonas con coeficientes ya cargados en el sistema, no repitas la misma categoria por cada zona: carga la categoria base/general una sola vez y registra las zonas en zones con coefficient.",
    "No devuelvas mas filas de categorias que las categorias conocidas del sistema, salvo que el PDF tenga una categoria nueva realmente distinta.",
    ...automaticZoneLines,
    ...camionerosLines,
    "Devolve solamente un JSON valido, sin markdown.",
    "",
    `Convenio esperado: ${convention.name} (${convention.shortName || convention.id}).`,
    `Fuente/CCT: ${convention.source || "sin fuente cargada"}.`,
    `Periodo objetivo: ${periodLabel || period}.`,
    `Categorias conocidas del sistema: ${categories || "sin categorias cargadas"}.`,
    `Zonas conocidas del sistema: ${zones || "sin zonas cargadas"}.`,
    `Conceptos/adicionales conocidos del sistema: ${itemKeys || "sin conceptos cargados"}.`,
    `Periodos ya cargados en el sistema: ${periods || "sin periodos cargados"}.`,
    "",
    "Formato exacto esperado. El objeto raiz debe tener scales, aunque detectes un solo mes:",
    JSON.stringify({
      scales: [
        {
          period,
          periodLabel: periodLabel || "Mes AAAA",
          sourceSummary: "resumen breve de la escala detectada para ese mes",
          confidence: 0,
          categories: [
            {
              id: "si coincide con una categoria del sistema",
              label: "nombre de categoria",
              zone: "zona si aplica",
              monthly: 0,
              day: 0,
              hourly: 0,
              nonRemunerative: 0,
              notes: []
            }
          ],
          additionals: [
            {
              id: "si aplica",
              label: "nombre del adicional",
              monthly: 0,
              day: 0,
              hourly: 0,
              nonRemunerative: 0,
              notes: []
            }
          ],
          zones: [
            {
              id: "si coincide",
              label: "nombre de zona",
              coefficient: 1
            }
          ],
          nonRemunerative: [],
          notes: []
        }
      ],
      warnings: []
    }, null, 2)
  ].join("\n");
}

function convertRawTextToMarkdown(text) {
  if (!text) return "";
  const lines = text.split(/\r?\n/);
  const result = [];
  let inTable = false;
  
  for (let line of lines) {
    line = line.trim();
    if (!line) {
      if (inTable) {
        result.push("");
        inTable = false;
      }
      continue;
    }
    
    const isHeading = line.length < 85 && (
      /^[A-Z0-9\s.,()\-#\/º°"':;]+$/.test(line) 
      || /^(ARTICULO|ART\.|CONVENIO|CCT|ESCALA|VIGENCIA|VIGENTE|ACUERDO|ANEXO|CIRCULAR)/i.test(line)
    );
    
    if (isHeading) {
      if (inTable) {
        result.push("");
        inTable = false;
      }
      result.push(`### ${line}`);
      continue;
    }
    
    const columns = line.split(/\s{2,}|\t+/).map(c => c.trim()).filter(Boolean);
    if (columns.length >= 2 && columns.some(col => /^\$?\s*\d+(?:\.\d{3})*(?:,\d{2})?%?$/.test(col) || /^\d+$/.test(col))) {
      if (!inTable) {
        inTable = true;
        const separators = columns.map(() => "---");
        result.push(`| ${columns.join(" | ")} |`);
        result.push(`| ${separators.join(" | ")} |`);
      } else {
        result.push(`| ${columns.join(" | ")} |`);
      }
    } else {
      if (inTable) {
        inTable = false;
        result.push("");
      }
      result.push(line);
    }
  }
  return result.join("\n");
}

async function requestScaleExtractionOnce({ apiKey, model, convention, period, periodLabel, markdownText, sourceFileName }) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            { text: buildScalePrompt({ convention, period, periodLabel }) },
            { text: `Escala salarial en formato Markdown:\n\n${markdownText}` }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.1,
        topP: 0.75,
        maxOutputTokens: 24000,
        responseMimeType: "application/json"
      }
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new GeminiScaleError(payload?.error?.message || `Gemini respondio HTTP ${response.status}`, {
      status: response.status,
      model,
      code: payload?.error?.status
    });
  }

  // Print token usage metrics
  const usage = payload?.usageMetadata || null;
  if (usage) {
    const promptTokens = usage.promptTokenCount || 0;
    const candidateTokens = usage.candidatesTokenCount || usage.outputTokenCount || 0;
    const totalTokens = usage.totalTokenCount || 0;
    console.log("\n┌────────────────────────────────────────────────────────┐");
    console.log(`│ METRICAS DE CONSUMO DE TOKENS - Escala Salarial        │`);
    console.log("├────────────────────────────────────────────────────────┤");
    console.log(`│ Modelo: ${model.padEnd(46)} │`);
    console.log(`│ Tokens de Entrada (Prompt): ${String(promptTokens).padStart(26)} │`);
    console.log(`│ Tokens de Salida (Respuesta): ${String(candidateTokens).padStart(23)} │`);
    console.log(`│ Tokens Totales: ${String(totalTokens).padStart(35)} │`);
    console.log("└────────────────────────────────────────────────────────┘\n");
  }

  const text = extractGeminiText(payload);
  if (!text) {
    throw new GeminiScaleError("Gemini no devolvio texto para la escala.", { status: 502, model });
  }

  return normalizeScaleBundle(parseGeminiJson(text), { convention, period, sourceFileName });
}

async function extractScalesFromPdf({ apiKey, model, fallbackModels, convention, period, periodLabel, pdfBuffer, mimeType, sourceFileName }) {
  const fs = require("fs");
  const path = require("path");

  let rawText = "";
  try {
    const pdfParse = require("pdf-parse");
    const data = await pdfParse(pdfBuffer);
    rawText = String(data.text || "");
  } catch (err) {
    console.error("Error al extraer texto del PDF:", err.message);
  }

  const markdownText = convertRawTextToMarkdown(rawText);
  const attachPdf = !hasUsefulPdfText(rawText);

  // Debug output requested by user
  console.log("\n==================================================");
  console.log(`[DEBUG] Escala PDF convertida a Markdown (${sourceFileName}):`);
  console.log("==================================================");
  console.log(markdownText);
  console.log("==================================================\n");

  // Save to debug file inside uploads
  try {
    const uploadDir = path.resolve(__dirname, "../uploads");
    fs.mkdirSync(uploadDir, { recursive: true });
    const debugFilePath = path.join(uploadDir, "debug-escala.md");
    fs.writeFileSync(debugFilePath, markdownText, "utf8");
    console.log(`[DEBUG] Markdown de la escala guardado en: ${debugFilePath}`);
  } catch (err) {
    console.error("Error al guardar archivo debug de escala:", err.message);
  }

  const models = geminiModelList(model, fallbackModels);
  const errors = [];

  for (const currentModel of models) {
    try {
      const parsedScales = await requestScaleExtractionOnce({
        apiKey,
        model: currentModel,
        convention,
        period,
        periodLabel,
        markdownText,
        pdfBuffer,
        mimeType,
        attachPdf,
        sourceFileName
      });
      return {
        parsedScales,
        model: currentModel,
        modelsTried: [...errors.map((item) => item.model), currentModel]
      };
    } catch (error) {
      errors.push({
        model: currentModel,
        message: error.message,
        status: error.status,
        code: error.code
      });
      if (!isRetryable(error)) {
        error.modelsTried = errors.map((item) => item.model);
        throw error;
      }
    }
  }

  const last = errors[errors.length - 1] || {};
  throw new GeminiScaleError("Gemini esta con alta demanda y no pudo leer el PDF de escala en este momento.", {
    status: 503,
    model: last.model,
    code: "MODEL_OVERLOADED",
    modelsTried: errors.map((item) => item.model)
  });
}

async function extractScaleFromPdf(input) {
  const result = await extractScalesFromPdf(input);
  return {
    ...result,
    parsedScale: result.parsedScales[0]
  };
}

module.exports = {
  GeminiScaleError,
  extractScaleFromPdf,
  extractScalesFromPdf,
  normalizeScale,
  normalizeScaleBundle,
  scoreScaleConfidence,
  buildScalePrompt
};
