function modelList(primaryModel, fallbackModels = []) {
  return [primaryModel, ...fallbackModels]
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index);
}

class ScaleAIError extends Error {
  constructor(message, { status, model, code, modelsTried } = {}) {
    super(message);
    this.name = "ScaleAIError";
    this.status = status;
    this.model = model;
    this.code = code;
    this.modelsTried = modelsTried || [];
  }
}

function isRetryable(error) {
  const message = String(error.message || "").toLowerCase();
  return error.status === 429
    || error.status === 503
    || error.status >= 500
    || message.includes("high demand")
    || message.includes("overloaded")
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
    throw new ScaleAIError("Gemini no devolvio un JSON valido para la escala.", {
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
  return (payload?.candidates || [])
    .flatMap((candidate) => candidate?.content?.parts || [])
    .map((part) => part.text || "")
    .join("")
    .trim();
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

function normalizeOptionalBoolean(value) {
  if (typeof value === "boolean") return value;
  if (value === null || value === undefined || value === "") return null;
  const normalized = normalizeText(value);
  if (["true", "si", "yes", "aplica", "activo"].includes(normalized)) return true;
  if (["false", "no", "no aplica", "inactivo"].includes(normalized)) return false;
  return null;
}

function normalizePercent(value) {
  if (value === null || value === undefined || value === "") return null;
  return normalizeMoney(String(value).replace("%", ""));
}

function normalizeNonRemunerativeRules(rawRules) {
  if (!rawRules || typeof rawRules !== "object" || Array.isArray(rawRules)) return {};
  const rules = {};
  const copyBoolean = (target, aliases) => {
    const key = aliases.find((alias) => Object.prototype.hasOwnProperty.call(rawRules, alias));
    if (key) rules[target] = normalizeOptionalBoolean(rawRules[key]);
  };
  const copyPercent = (target, aliases) => {
    const key = aliases.find((alias) => Object.prototype.hasOwnProperty.call(rawRules, alias));
    if (key) rules[target] = normalizePercent(rawRules[key]);
  };

  copyBoolean("enabled", ["enabled", "aplica"]);
  copyBoolean("seniorityEnabled", ["seniorityEnabled", "aplicaAntiguedad", "antiguedadHabilitada"]);
  copyPercent("seniorityPercentPerYear", ["seniorityPercentPerYear", "porcentajeAntiguedadPorAnio", "antiguedadPorAnio"]);
  copyPercent("seniorityCapYears", ["seniorityCapYears", "topeAniosAntiguedad"]);
  copyBoolean("presentismEnabled", ["presentismEnabled", "aplicaPresentismo", "presentismoHabilitado"]);
  copyPercent("presentismPercent", ["presentismPercent", "porcentajePresentismo"]);
  copyBoolean("presentismRequiresNoUnjustifiedAbsence", ["presentismRequiresNoUnjustifiedAbsence", "presentismoExigeSinInasistenciasInjustificadas"]);
  copyBoolean("subjectToHealthInsurance", ["subjectToHealthInsurance", "aportaObraSocial"]);
  copyBoolean("subjectToUnion", ["subjectToUnion", "aportaSindicato"]);
  if (Array.isArray(rawRules.legalReferences || rawRules.referenciasLegales)) {
    rules.legalReferences = (rawRules.legalReferences || rawRules.referenciasLegales).filter(Boolean).map(String);
  }
  if (Array.isArray(rawRules.notes || rawRules.observaciones)) {
    rules.notes = (rawRules.notes || rawRules.observaciones).filter(Boolean).map(String);
  }
  if (rules.enabled == null && (Number.isFinite(rules.seniorityPercentPerYear) || Number.isFinite(rules.presentismPercent))) rules.enabled = true;
  if (rules.seniorityEnabled == null && Number.isFinite(rules.seniorityPercentPerYear)) rules.seniorityEnabled = true;
  if (rules.presentismEnabled == null && Number.isFinite(rules.presentismPercent)) rules.presentismEnabled = true;
  return rules;
}

function normalizeRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => ({
      id: row.id ? String(row.id) : "",
      label: row.label || row.category || row.name || "",
      group: row.group || row.grupo || row.section || row.seccion || "",
      zone: normalizeZoneId(row.zone || row.zona),
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

function isGeneralZone(value) {
  const normalized = normalizeText(value);
  return [
    "general",
    "base",
    "zona general",
    "zona base",
    "base general",
    "general base",
    "sin adicional",
    "sin adicional zonal",
    "sin adicional de zona"
  ].includes(normalized);
}

function normalizeZoneId(value) {
  const normalized = normalizeText(value);
  return isGeneralZone(normalized) ? "general" : normalized;
}

function normalizeScaleZones(rawZones, categories) {
  const byId = new Map();
  (Array.isArray(rawZones) ? rawZones : []).forEach((zone) => {
    const id = normalizeZoneId(zone.id || zone.label || zone.name || zone.zona);
    const general = id === "general" || isGeneralZone(zone.label || zone.name || zone.zona);
    const coefficient = normalizeMoney(zone.coefficient ?? zone.coeficiente ?? zone.coef);
    const normalized = {
      id: general ? "general" : id,
      label: general ? "General" : (zone.label || zone.name || zone.zona || ""),
      coefficient: coefficient ?? (general ? 1 : null)
    };
    if (normalized.id || normalized.label) byId.set(normalized.id || normalizeText(normalized.label), { ...(byId.get(normalized.id) || {}), ...normalized });
  });
  const hasDocumentaryGeneral = categories.some((category) => category.zone === "general")
    || (byId.size > 0 && categories.some((category) => !category.zone));
  if (!byId.has("general") && hasDocumentaryGeneral) {
    byId.set("general", { id: "general", label: "General", coefficient: 1 });
  }
  return Array.from(byId.values());
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

function looksLikeAdditionalRow(row) {
  const label = normalizeText(row?.label || row?.id);
  const group = normalizeText(row?.group);
  return /^[\s$%.,\d-]+$/.test(String(row?.label || "").trim())
    || /(adicional|plus|premio|bonific|viatic|pernoct|comida|kilometr|\bkm\b|hora extra|presentismo|antiguedad|titulo|quebranto|falla de caja|movilidad|refrigerio|seguro|primeros \d+ km|mas de \d+ km|art \d+|cct \d+)/i.test(label)
    || /(adicional|asignacion complementaria|art \d+|ayud chof|chofer|kilometr|\bkm\b|viatic|pernoct|comida|plus|premio|bonific)/i.test(group);
}

function splitScaleRows({ categories, additionals, convention }) {
  const keptCategories = [];
  const mergedAdditionals = [...additionals];
  const seenAdditionals = new Set(additionals.map((row) => normalizeText(row.id || row.label)));
  categories.forEach((row) => {
    if (looksLikeAdditionalRow(row) && !matchesKnownCategory(row, convention)) {
      const key = normalizeText(row.id || row.label);
      if (key && !seenAdditionals.has(key)) {
        seenAdditionals.add(key);
        mergedAdditionals.push(row);
      }
      return;
    }
    keptCategories.push(row);
  });
  return { categories: keptCategories, additionals: mergedAdditionals };
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

  const aiConfidence = Math.max(0, Math.min(100, Number(parsedConfidence) || 0));
  const calibrated = Math.max(aiConfidence, score);
  return Math.max(0, Math.min(severeWarning ? 65 : 96, Math.round(calibrated)));
}

function validateScaleOutput(scales, model) {
  const invalid = !Array.isArray(scales)
    || !scales.length
    || scales.some((scale) => {
      const categories = Array.isArray(scale.categories) ? scale.categories : [];
      const additionals = Array.isArray(scale.additionals) ? scale.additionals : [];
      const nonRemunerative = Array.isArray(scale.nonRemunerative) ? scale.nonRemunerative : [];
      return !categories.length && !additionals.length && !nonRemunerative.length;
    });

  if (invalid) {
    throw new ScaleAIError("Gemini devolvio una escala sin categorias, adicionales ni no remunerativos.", {
      status: 502,
      model,
      code: "EMPTY_SCALE"
    });
  }
}

function normalizeScale(parsed, { convention, period, sourceFileName }) {
  const fallbackYear = fallbackYearFromPeriod(period);
  const detectedPeriod = periodFromText(parsed.period || parsed.periodLabel || parsed.month || parsed.mes || "", fallbackYear) || period;
  const normalizedCategories = normalizeRows(parsed.categories || parsed.items || parsed.rows);
  const normalizedAdditionals = normalizeRows(parsed.additionals || parsed.adicionales);
  const { categories, additionals } = splitScaleRows({
    categories: normalizedCategories,
    additionals: normalizedAdditionals,
    convention
  });
  const zones = normalizeScaleZones(parsed.zones || parsed.zonas, categories);
  const warnings = Array.isArray(parsed.warnings || parsed.alertas)
    ? (parsed.warnings || parsed.alertas).filter(Boolean).map(String)
    : [];
  const sourceSummary = parsed.sourceSummary || parsed.resumen || "";
  const parsedConfidence = Number(parsed.confidence ?? parsed.confidenceScore ?? 0) || 0;
  const normalizedNonRemunerative = Array.isArray(parsed.nonRemunerative || parsed.noRemunerativos)
    ? normalizeRows(parsed.nonRemunerative || parsed.noRemunerativos)
    : [];
  const nonRemunerativeRules = normalizeNonRemunerativeRules(
    parsed.nonRemunerativeRules || parsed.reglasNoRemunerativas || parsed.rules?.nonRemunerativeScale
  );

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
    nonRemunerativeRules,
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
          nonRemunerativeRules: entry.nonRemunerativeRules || entry.reglasNoRemunerativas || parsed.nonRemunerativeRules || parsed.reglasNoRemunerativas,
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
    "Lee el documento o imagen adjunta e interpreta directamente su contenido como agente IA multimodal para extraer importes de escala salarial para revision humana.",
    "La unica fuente factual de importes es el archivo adjunto. El convenio seleccionado y sus categorias conocidas son una ayuda para vincular ids, no una fuente de valores. No copies importes anteriores ni completes filas por analogia.",
    "Si el adjunto es una imagen o contiene tablas representadas visualmente, analiza encabezados, filas, columnas y relaciones espaciales directamente como agente IA multimodal.",
    "Recorre todas las paginas. No devuelvas categories, additionals o scales vacios si el archivo contiene filas e importes legibles. Si una tabla no se puede reconstruir con certeza, conserva lo legible y explica la duda en warnings.",
    "Si el PDF contiene importes para varios meses o periodos, crea una escala separada por cada mes/periodo detectado.",
    "Ejemplo: si una escala de Farmacia trae basico Abril 2026 y columnas no remunerativas Abril/Mayo/Junio 2026, devolve tres escalas: 2026-04, 2026-05 y 2026-06. Repite el basico en cada mes y cambia el no remunerativo segun la columna de ese mes.",
    "No inventes importes. Si un dato no esta claro, usa null y agregalo en warnings.",
    "El campo confidence debe medir la confianza de extraccion de datos: usa 85 a 95 si detectaste la mayoria de categorias conocidas con importes claros; usa menos de 50 solo si faltan importes o hay dudas importantes.",
    "Para planillas extensas, prioriza una fila por categoria conocida y una fila por adicional/concepto salarial conocido. Evita duplicados y manten notes vacio salvo que sea necesario.",
    "Si el documento contiene una tabla separada titulada ADICIONALES, PLUS, VIATICOS u OTROS CONCEPTOS, carga esas filas exclusivamente en additionals. No mezcles adicionales con categories aunque tengan importes monetarios.",
    "Trata como adicionales los importes por kilometro, viaticos, comida, pernoctada, premios, titulos, plus, quebranto de caja, movilidad y conceptos similares. Categories debe contener solamente categorias laborales de la escala basica.",
    "REGLA CRITICA DE MONTOS: Extrae unicamente valores monetarios fijos. Si un adicional o concepto se define como un porcentaje (ej. 10%, 1%, etc.), cargalo como null en los importes y si es necesario indicalo en notes. NUNCA extraigas un porcentaje como si fuera un monto en pesos (ej. NO extraigas 10% como 10).",
    "REGLA CRITICA DE NO REMUNERATIVOS: si la escala indica que la suma no remunerativa genera antiguedad no remunerativa o presentismo no remunerativo, extrae esas reglas separadas en nonRemunerativeRules con seniorityEnabled, seniorityPercentPerYear, seniorityCapYears, presentismEnabled, presentismPercent y presentismRequiresNoUnjustifiedAbsence. Esos porcentajes son reglas, no importes monetarios.",
    "Si el convenio usa zonas con coeficientes ya cargados en el sistema, no repitas la misma categoria por cada zona: carga la categoria base/general una sola vez y registra las zonas en zones con coefficient.",
    "REGLA CRITICA DE ZONA GENERAL: si la tabla muestra una columna General, Base, Zona general, Zona base o Sin adicional zonal, incluila siempre en zones como { id: \"general\", label: \"General\", coefficient: 1 }. No la omitas aunque el coeficiente 1 sea implicito. Marca las filas de esa columna con zone: \"general\".",
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
          nonRemunerativeRules: {
            enabled: null,
            seniorityEnabled: null,
            seniorityPercentPerYear: null,
            seniorityCapYears: null,
            presentismEnabled: null,
            presentismPercent: null,
            presentismRequiresNoUnjustifiedAbsence: null,
            legalReferences: []
          },
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

async function requestScaleExtractionOnce({ apiKey, model, convention, period, periodLabel, markdownText, pdfBuffer, mimeType, sourceFileName }) {
  const base64File = Buffer.from(pdfBuffer).toString("base64");
  const parts = [
    { text: buildScalePrompt({ convention, period, periodLabel }) },
    {
      inlineData: {
        mimeType: mimeType || "application/pdf",
        data: base64File
      }
    }
  ];
  if (markdownText) {
    parts.push({ text: `Texto extraido localmente para referencia:\n\n${markdownText}` });
  }

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 24000,
        responseMimeType: "application/json"
      }
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ScaleAIError(payload?.error?.message || `Gemini respondio HTTP ${response.status}`, {
      status: response.status,
      model,
      code: payload?.error?.status || payload?.error?.code
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
    throw new ScaleAIError("Gemini no devolvio texto para la escala.", { status: 502, model });
  }

  const parsedScales = normalizeScaleBundle(parseGeminiJson(text), { convention, period, sourceFileName });
  validateScaleOutput(parsedScales, model);

  return {
    parsedScales,
    tokenUsage: usage ? {
      model,
      promptTokenCount: usage.promptTokenCount || 0,
      outputTokenCount: usage.candidatesTokenCount || usage.outputTokenCount || 0,
      totalTokenCount: usage.totalTokenCount || 0
    } : null
  };
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

  const models = modelList(model, fallbackModels);
  const errors = [];

  for (const currentModel of models) {
    try {
      const result = await requestScaleExtractionOnce({
        apiKey,
        model: currentModel,
        convention,
        period,
        periodLabel,
        markdownText,
        pdfBuffer,
        mimeType,
        sourceFileName
      });
      return {
        parsedScales: result.parsedScales,
        model: currentModel,
        modelsTried: [...errors.map((item) => item.model), currentModel],
        tokenUsage: result.tokenUsage || null
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
  throw new ScaleAIError("Gemini esta con alta demanda y no pudo leer el archivo de escala en este momento.", {
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
  ScaleAIError,
  extractScaleFromPdf,
  extractScalesFromPdf,
  normalizeScale,
  normalizeScaleBundle,
  normalizeNonRemunerativeRules,
  scoreScaleConfidence,
  buildScalePrompt,
  splitScaleRows
};
