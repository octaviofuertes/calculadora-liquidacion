const { geminiModelList } = require("../gemini-config");
const { EXCEL_SCHEMA_VERSION, normalizeConvenio: normalizeUniversalConvenio } = require("../models/convenio.model");
const pdfParse = require("pdf-parse");
const UNIVERSAL_SCHEMA_VERSION = EXCEL_SCHEMA_VERSION;
const useGeminiFilesApi = String(process.env.GEMINI_USE_FILES_API || "true").toLowerCase() !== "false";
const GEMINI_API_BASE_URL = process.env.GEMINI_API_BASE_URL || "https://generativelanguage.googleapis.com";

class GeminiConventionError extends Error {
  constructor(message, { status, model, code, modelsTried } = {}) {
    super(message);
    this.name = "GeminiConventionError";
    this.status = status;
    this.model = model;
    this.code = code;
    this.modelsTried = modelsTried || [];
  }
}

const UNIVERSAL_CONVENTION_TEMPLATE = require("../../convenio-universal-template.json");

function isRetryable(error) {
  const message = String(error.message || "").toLowerCase();
  return error.code === "EMPTY_STRUCTURE"
    || error.code === "INVALID_JSON"
    || error.status === 429
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
  return extractBalancedJson(raw) || raw;
}

function extractBalancedJson(raw) {
  const start = String(raw || "").indexOf("{");
  if (start < 0) return "";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return raw.slice(start, index + 1);
  }
  return "";
}

function cleanJsonText(value) {
  return String(value || "")
    .replace(/^\uFEFF/, "")
    .replace(/,\s*([}\]])/g, "$1")
    .trim();
}

function closeTruncatedJson(value) {
  const raw = String(value || "");
  const start = raw.indexOf("{");
  if (start < 0) return "";
  const stack = [];
  let inString = false;
  let escaped = false;
  let out = raw.slice(start);
  for (let index = 0; index < out.length; index += 1) {
    const char = out[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") stack.push("}");
    else if (char === "[") stack.push("]");
    else if ((char === "}" || char === "]") && stack[stack.length - 1] === char) stack.pop();
  }
  if (inString) out += "\"";
  out = out
    .replace(/,\s*"[^"]*"\s*:\s*$/, "")
    .replace(/"[^"]*"\s*:\s*$/, "")
    .replace(/,\s*"[^"]*"\s*$/, "")
    .replace(/,\s*$/, "")
    .replace(/,\s*([}\]])/g, "$1");
  while (stack.length) out += stack.pop();
  return cleanJsonText(out);
}

function parseGeminiJson(text) {
  const jsonText = cleanJsonText(stripJsonFences(text));
  try {
    return JSON.parse(jsonText);
  } catch (error) {
    const repaired = closeTruncatedJson(jsonText);
    if (repaired && repaired !== jsonText) {
      try {
        console.warn("[Gemini JSON] Respuesta truncada reparada parcialmente.");
        return JSON.parse(repaired);
      } catch (_) {
        // fall through to the detailed invalid JSON error
      }
    }
    console.error("[Gemini JSON invalido] inicio:", String(text || "").slice(0, 800));
    console.error("[Gemini JSON invalido] fin:", String(text || "").slice(-800));
    throw new GeminiConventionError("Gemini no devolvio un JSON valido para el convenio.", {
      status: 502,
      code: "INVALID_JSON"
    });
  }
}

function extractGeminiText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts || [];
  return parts.map((part) => part.text || "").join("").trim();
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
}

function isGeneralZone(value) {
  const normalized = normalizeText(value);
  return [
    "general",
    "base",
    "zona-general",
    "zona-base",
    "base-general",
    "general-base",
    "sin-adicional",
    "sin-adicional-zonal",
    "sin-adicional-de-zona"
  ].includes(normalized);
}

function normalizeZoneId(value) {
  const normalized = normalizeText(value);
  return isGeneralZone(normalized) ? "general" : normalized;
}

function normalizeConventionZones(rawZones, categories, { useFallbackDefaults = true } = {}) {
  const byId = new Map();
  (Array.isArray(rawZones) ? rawZones : []).forEach((zone, index) => {
    const rawId = zone.id || zone.label || zone.name || zone.zona || `zona-${index + 1}`;
    const id = normalizeZoneId(rawId);
    const general = id === "general" || isGeneralZone(zone.label || zone.name || zone.zona);
    const normalized = {
      id: general ? "general" : id,
      label: general ? "General" : (zone.label || zone.name || zone.zona || `Zona ${index + 1}`),
      coef: zone.coef ?? zone.coefficient ?? zone.coeficiente ?? (general || useFallbackDefaults ? 1 : null)
    };
    if (normalized.id && normalized.label) byId.set(normalized.id, { ...(byId.get(normalized.id) || {}), ...normalized });
  });
  const hasDocumentaryGeneral = categories.some((category) => category.zone === "general")
    || (byId.size > 0 && categories.some((category) => !category.zone));
  if (!byId.has("general") && hasDocumentaryGeneral) {
    byId.set("general", { id: "general", label: "General", coef: 1 });
  }
  if (!byId.size && useFallbackDefaults) {
    byId.set("general", { id: "general", label: "General", coef: 1 });
  }
  return Array.from(byId.values());
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

function normalizeCurrencyAmount(value) {
  const number = normalizeMoney(value);
  if (number === null) return null;
  if (typeof value === "number" && number > 0 && number < 10000 && String(value).includes(".")) {
    const decimals = String(value).split(".")[1] || "";
    if (decimals.length === 3) return Math.round(number * 1000);
  }
  return number;
}

function normalizeMoneyMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.entries(value).reduce((acc, [key, amount]) => {
    const period = periodFromText(key) || key;
    const normalized = normalizeCurrencyAmount(amount);
    if (period && normalized !== null) acc[period] = normalized;
    return acc;
  }, {});
}

function normalizeSalaryType(value) {
  const normalized = normalizeText(value);
  if (["monthly", "mensual", "mensualizado", "sueldo mensual"].includes(normalized)) return "monthly";
  if (["daily", "jornal", "jornalizado", "diario", "por dia"].includes(normalized)) return "daily";
  if (["hourly", "hora", "horario", "por hora"].includes(normalized)) return "hourly";
  return "";
}

function dropNullishKeys(object, keys) {
  keys.forEach((key) => {
    if (object[key] === null || object[key] === undefined) delete object[key];
  });
  return object;
}

function periodFromText(value, fallbackYear) {
  const raw = String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const iso = raw.match(/\b(20\d{2})-(0[1-9]|1[0-2])\b/);
  if (iso) return iso[0];
  const year = raw.match(/\b(20\d{2})\b/)?.[1] || fallbackYear || String(new Date().getFullYear());
  const monthMap = {
    enero: "01", ene: "01",
    febrero: "02", feb: "02",
    marzo: "03", mar: "03",
    abril: "04", abr: "04",
    mayo: "05", may: "05",
    junio: "06", jun: "06",
    julio: "07", jul: "07",
    agosto: "08", ago: "08",
    septiembre: "09", setiembre: "09", sep: "09", set: "09",
    octubre: "10", oct: "10",
    noviembre: "11", nov: "11",
    diciembre: "12", dic: "12"
  };
  const monthKey = Object.keys(monthMap).find((key) => raw.includes(key));
  return monthKey ? `${year}-${monthMap[monthKey]}` : null;
}

function monthLabel(period) {
  const match = String(period || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return period || "";
  const names = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  return `${names[Number(match[2]) - 1] || match[2]} ${match[1]}`;
}

function normalizeRows(rows, periodIds = []) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row, index) => {
      const label = row.label || row.name || row.category || `Categoria ${index + 1}`;
      const id = normalizeText(row.id || label || `categoria-${index + 1}`);
      const nonRem = {};
      const monthlyByPeriod = normalizeMoneyMap(row.monthlyByPeriod || row.monthlyByPeriodo || row.basicoPorPeriodo || row.sueldoMensualPorPeriodo);
      const dayByPeriod = normalizeMoneyMap(row.dayByPeriod || row.jornalPorPeriodo || row.valorDiaPorPeriodo);
      const hourlyByPeriod = normalizeMoneyMap(row.hourlyByPeriod || row.horaPorPeriodo || row.valorHoraPorPeriodo);
      const rawNonRem = row.nonRem || row.nonRemunerativeByPeriod || row.noRemPorPeriodo;
      if (rawNonRem && typeof rawNonRem === "object" && !Array.isArray(rawNonRem)) {
        Object.entries(rawNonRem).forEach(([key, value]) => {
          const period = periodFromText(key) || key;
          nonRem[period] = normalizeCurrencyAmount(value) || 0;
        });
      }
      if (!Object.keys(nonRem).length && row.nonRemunerative !== undefined) {
        periodIds.forEach((period) => {
          nonRem[period] = normalizeCurrencyAmount(row.nonRemunerative) || 0;
        });
      }
      const normalized = {
        id,
        label: String(label),
        group: row.group || row.grupo || "",
        description: row.description || row.descripcion || "",
        zone: normalizeZoneId(row.zone || row.zona),
        monthly: normalizeCurrencyAmount(row.monthly ?? row.sueldoMensual ?? row.basicoMensual),
        day: normalizeCurrencyAmount(row.day ?? row.jornal ?? row.valorDia),
        hourly: normalizeCurrencyAmount(row.hourly ?? row.hora ?? row.valorHora),
        monthlyByPeriod,
        dayByPeriod,
        hourlyByPeriod,
        nonRem,
        commissionPercent: Number(row.commissionPercent ?? row.comisionPorcentaje ?? 0) || null,
        normalWeeklyHours: Number(row.normalWeeklyHours ?? row.horasSemanales ?? 0) || null,
        legalReferences: Array.isArray(row.legalReferences || row.referenciasLegales) ? (row.legalReferences || row.referenciasLegales).filter(Boolean).map(String) : [],
        notes: Array.isArray(row.notes) ? row.notes.filter(Boolean).map(String) : []
      };
      return dropNullishKeys(normalized, ["monthly", "day", "hourly"]);
    })
    .filter((row) => row.label && (
      row.monthly
      || row.day
      || row.hourly
      || Object.values(row.monthlyByPeriod).some(Boolean)
      || Object.values(row.dayByPeriod).some(Boolean)
      || Object.values(row.hourlyByPeriod).some(Boolean)
      || Object.values(row.nonRem).some(Boolean)
    ));
}

function normalizeConcepts(concepts, { useFallbackDefaults = true } = {}) {
  if (!Array.isArray(concepts)) return [];
  return concepts
    .map((concept, index) => {
      const label = concept.label || concept.name || `Concepto ${index + 1}`;
      const inputType = ["checkbox", "number"].includes(concept.inputType) ? concept.inputType : (concept.type === "number" ? "number" : (useFallbackDefaults ? "checkbox" : ""));
      const rowType = ["remunerative", "nonRemunerative", "deduction"].includes(concept.rowType) ? concept.rowType : (useFallbackDefaults ? "remunerative" : "");
      const calculation = ["fixed", "percentOfBase", "amountPerUnit"].includes(concept.calculation) ? concept.calculation : (useFallbackDefaults ? "percentOfBase" : "");
      const normalized = {
        id: normalizeText(concept.id || label || `concepto-${index + 1}`),
        label: String(label),
        group: concept.group || "Adicionales",
        inputType,
        rowType,
        calculation,
        defaultValue: concept.defaultValue ?? (useFallbackDefaults ? (inputType === "checkbox" ? false : 0) : null),
        amount: normalizeCurrencyAmount(concept.amount),
        amountByPeriod: normalizeMoneyMap(concept.amountByPeriod || concept.amountPorPeriodo),
        unitAmount: normalizeCurrencyAmount(concept.unitAmount),
        unitAmountByPeriod: normalizeMoneyMap(concept.unitAmountByPeriod || concept.valorUnidadPorPeriodo),
        percent: Number(concept.percent ?? concept.pct ?? 0) || 0,
        base: concept.base || (useFallbackDefaults ? "basic" : ""),
        detail: concept.detail || concept.legalReference || "",
        subjectToSocialSecurity: concept.subjectToSocialSecurity === undefined ? (useFallbackDefaults ? true : null) : concept.subjectToSocialSecurity !== false,
        subjectToHealthInsurance: concept.subjectToHealthInsurance === undefined ? (useFallbackDefaults ? true : null) : concept.subjectToHealthInsurance !== false,
        subjectToART: concept.subjectToART === undefined ? (useFallbackDefaults ? true : null) : concept.subjectToART !== false,
        taxableIncome: concept.taxableIncome === undefined ? (useFallbackDefaults ? false : null) : concept.taxableIncome === true,
        requiresHumanValidation: concept.requiresHumanValidation === true,
        notes: Array.isArray(concept.notes) ? concept.notes.filter(Boolean).map(String) : []
      };
      ["conditions", "proration", "rounding", "legalReferences", "audit", "ui", "tags", "source", "sourceFiles"].forEach((key) => {
        if (concept[key] !== undefined) normalized[key] = concept[key];
      });
      return dropNullishKeys(normalized, ["amount", "unitAmount"]);
    })
    .filter((concept) => concept.id && concept.label);
}

function normalizeDeductions(deductions, { idPrefix = "deduccion", labelPrefix = "Deduccion", defaultValue = true, useFallbackDefaults = true } = {}) {
  if (!Array.isArray(deductions)) return [];
  return deductions
    .map((item, index) => {
      const normalized = {
        id: normalizeText(item.id || item.label || `${idPrefix}-${index + 1}`),
        label: item.label || item.name || `${labelPrefix} ${index + 1}`,
        calculation: item.calculation || ((item.amount !== undefined && item.amount !== null) ? "fixed" : (useFallbackDefaults ? "percentOfBase" : "")),
        percent: Number(item.percent ?? item.pct ?? 0) || 0,
        amount: normalizeCurrencyAmount(item.amount),
        amountByPeriod: normalizeMoneyMap(item.amountByPeriod || item.amountPorPeriodo),
        base: item.base || (useFallbackDefaults ? "remunerative" : ""),
        defaultValue: item.defaultValue === undefined ? (useFallbackDefaults ? defaultValue : false) : item.defaultValue !== false,
        appliesWhen: item.appliesWhen || "",
        detail: item.detail || item.legalReference || "",
        requiresHumanValidation: item.requiresHumanValidation === true
      };
      ["conditions", "legalReferences", "audit", "ui", "tags", "source", "sourceFiles"].forEach((key) => {
        if (item[key] !== undefined) normalized[key] = item[key];
      });
      return normalized;
    })
    .filter((item) => item.id && item.label && (
      item.percent
      || item.amount
      || Object.values(item.amountByPeriod || {}).some(Boolean)
      || item.requiresHumanValidation
      || item.detail
      || item.appliesWhen
    ));
}

function scoreConvention(parsed) {
  let score = 30;
  if (parsed.id) score += 5;
  if (parsed.name) score += 8;
  if ((parsed.periods || []).length) score += 10;
  if ((parsed.categories || []).length >= 3) score += 18;
  else score += (parsed.categories || []).length * 4;
  if ((parsed.zones || []).length) score += 6;
  if (parsed.liquidationModel?.rules) score += 10;
  if ((parsed.liquidationModel?.concepts || []).length) score += 8;
  if ((parsed.liquidationModel?.deductions || []).length) score += 5;
  if ((parsed.liquidationModel?.retentions || []).length) score += 4;
  if ((parsed.auditChecklist || []).length) score += 6;
  score -= Math.min(18, (parsed.warnings || []).length * 4);
  const aiScore = Number(parsed.confidence || 0) || 0;
  return Math.max(0, Math.min(96, Math.max(score, aiScore)));
}

function polishConventionWarnings(parsed) {
  if (!parsed?.categories?.length || !Array.isArray(parsed.warnings) || !parsed.warnings.length) return parsed;
  const criticalPattern = /no se detect|sin import|falt|no pudo|inconsisten|revisar total|json inval|json valido|error|pendiente de lectura/i;
  const critical = [];
  const notes = Array.isArray(parsed.notes) ? [...parsed.notes] : [];
  parsed.warnings.forEach((warning) => {
    const text = String(warning || "").trim();
    if (!text) return;
    if (criticalPattern.test(text)) critical.push(text);
    else notes.push(text);
  });
  parsed.warnings = Array.from(new Set(critical));
  parsed.notes = Array.from(new Set(notes));
  return parsed;
}

function normalizeConvention(parsed, { fallbackName = "Convenio generado por leIA", useFallbackDefaults = true } = {}) {
  if (parsed?.data && (parsed.ok === true || parsed.data.schemaVersion || parsed.data.convenio)) {
    parsed = parsed.data;
  }
  if (parsed?.json_parcial) {
    parsed = parsed.json_parcial;
  }
  const wrapped = parsed?.parsedConvention || parsed?.structuredConvention || parsed?.resultado || parsed?.result;
  if (wrapped && typeof wrapped === "object" && (wrapped.schemaVersion || wrapped.convenio || wrapped.convention || wrapped.categorias || wrapped.categories)) {
    parsed = wrapped;
  }
  if (parsed?.schemaVersion === UNIVERSAL_SCHEMA_VERSION || parsed?.convenio) {
    return normalizeUniversalConvenio(parsed);
  }
  const source = parsed.convention || parsed.convenio || parsed;
  if (source.schemaVersion || source.categories || source.payrollBases?.scales) {
    return normalizeUniversalConvenio(source);
  }
  const name = source.name || source.nombre || fallbackName;
  const id = normalizeText(source.id || source.shortName || name);
  const fallbackYear = String(new Date().getFullYear());
  const periodSource = Array.isArray(source.periods || source.periodos) ? (source.periods || source.periodos) : [];
  const periods = periodSource
    .map((period) => {
      const value = typeof period === "string" ? period : (period.id || period.period || period.label);
      const normalized = periodFromText(value, fallbackYear) || normalizeText(value);
      return normalized ? { id: normalized, label: (typeof period === "object" && period.label) || monthLabel(normalized) || String(value) } : null;
    })
    .filter(Boolean);
  if (!periods.length && useFallbackDefaults) {
    const current = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
    periods.push({ id: current, label: monthLabel(current) });
  }
  const periodIds = periods.map((period) => period.id);
  const categories = normalizeRows(source.categories || source.categorias || source.rows, periodIds);
  const zones = normalizeConventionZones(source.zones || source.zonas, categories, { useFallbackDefaults });
  const concepts = normalizeConcepts(source.liquidationModel?.concepts || source.concepts || source.conceptos, { useFallbackDefaults });
  const deductions = normalizeDeductions(source.liquidationModel?.deductions || source.deductions || source.aportesTrabajador, { useFallbackDefaults });
  const retentions = normalizeDeductions(source.liquidationModel?.retentions || source.retentions || source.retenciones, {
    idPrefix: "retencion",
    labelPrefix: "Retencion",
    defaultValue: false,
    useFallbackDefaults
  });
  const employerContributions = normalizeDeductions(source.liquidationModel?.employerContributions || source.employerContributions || source.contribucionesEmpleador, { useFallbackDefaults });
  const warnings = Array.isArray(source.warnings || source.alertas)
    ? (source.warnings || source.alertas).filter(Boolean).map(String)
    : [];

  if (!categories.length) warnings.push("No se detectaron categorias con importes. Completar antes de aprobar.");
  if (!periods.length) warnings.push("No se detectaron periodos vigentes. Completar antes de aprobar.");

  const inferredSalaryType = categories.some((cat) => cat.day || Object.keys(cat.dayByPeriod || {}).length)
    ? "daily"
    : (categories.some((cat) => cat.hourly || Object.keys(cat.hourlyByPeriod || {}).length)
      ? "hourly"
      : (categories.some((cat) => cat.monthly || Object.keys(cat.monthlyByPeriod || {}).length) ? "monthly" : ""));
  const declaredSalaryType = normalizeSalaryType(source.type || source.liquidationModel?.rules?.salaryType);
  const salaryType = inferredSalaryType || declaredSalaryType || (useFallbackDefaults ? "monthly" : "");
  if (declaredSalaryType && inferredSalaryType && declaredSalaryType !== inferredSalaryType) {
    warnings.push(`Tipo de liquidacion corregido por importes detectados: IA=${declaredSalaryType}, detectado=${inferredSalaryType}.`);
  }
  const rawNonRemunerativeScaleRules = source.liquidationModel?.rules?.nonRemunerativeScale
    || source.nonRemunerativeRules
    || source.reglasNoRemunerativas
    || source.rules?.nonRemunerativeScale
    || {};
  const normalizedNonRemunerativeScaleRules = {
    ...(rawNonRemunerativeScaleRules && typeof rawNonRemunerativeScaleRules === "object" ? rawNonRemunerativeScaleRules : {})
  };
  if (normalizedNonRemunerativeScaleRules.seniorityPercentPerYear == null && normalizedNonRemunerativeScaleRules.porcentajeAntiguedadPorAnio != null) {
    normalizedNonRemunerativeScaleRules.seniorityPercentPerYear = normalizeMoney(String(normalizedNonRemunerativeScaleRules.porcentajeAntiguedadPorAnio).replace("%", ""));
  }
  if (normalizedNonRemunerativeScaleRules.presentismPercent == null && normalizedNonRemunerativeScaleRules.porcentajePresentismo != null) {
    normalizedNonRemunerativeScaleRules.presentismPercent = normalizeMoney(String(normalizedNonRemunerativeScaleRules.porcentajePresentismo).replace("%", ""));
  }
  if (normalizedNonRemunerativeScaleRules.seniorityPercentPerYear != null && normalizedNonRemunerativeScaleRules.seniorityEnabled == null) {
    normalizedNonRemunerativeScaleRules.seniorityEnabled = true;
  }
  if (normalizedNonRemunerativeScaleRules.presentismPercent != null && normalizedNonRemunerativeScaleRules.presentismEnabled == null) {
    normalizedNonRemunerativeScaleRules.presentismEnabled = true;
  }
  const rules = useFallbackDefaults ? {
    ...(source.rules && typeof source.rules === "object" ? source.rules : {}),
    monthDivisor: Number(source.rules?.monthDivisor ?? source.liquidationModel?.rules?.monthDivisor ?? 30) || 30,
    hourDivisor: Number(source.rules?.hourDivisor ?? source.liquidationModel?.rules?.hourDivisor ?? 200) || 200,
    weeklyHours: Number(source.rules?.weeklyHours ?? source.liquidationModel?.rules?.weeklyHours ?? 48) || 48
  } : {
    ...(source.rules && typeof source.rules === "object" ? source.rules : {})
  };
  const liquidationRules = useFallbackDefaults ? {
    ...(source.liquidationModel?.rules && typeof source.liquidationModel.rules === "object" ? source.liquidationModel.rules : {}),
    salaryType,
    monthDivisor: Number(source.liquidationModel?.rules?.monthDivisor ?? source.rules?.monthDivisor ?? 30) || 30,
    hourDivisor: Number(source.liquidationModel?.rules?.hourDivisor ?? source.rules?.hourDivisor ?? 200) || 200,
    weeklyHours: Number(source.liquidationModel?.rules?.weeklyHours ?? source.rules?.weeklyHours ?? 48) || 48,
    seniority: {
      ...(source.liquidationModel?.rules?.seniority && typeof source.liquidationModel.rules.seniority === "object" ? source.liquidationModel.rules.seniority : {}),
      enabled: source.liquidationModel?.rules?.seniority?.enabled !== false,
      percentPerYear: Number(source.liquidationModel?.rules?.seniority?.percentPerYear ?? 1) || 0,
      capYears: Number(source.liquidationModel?.rules?.seniority?.capYears ?? 0) || 0,
      base: source.liquidationModel?.rules?.seniority?.base || "basic"
    },
    presentism: {
      ...(source.liquidationModel?.rules?.presentism && typeof source.liquidationModel.rules.presentism === "object" ? source.liquidationModel.rules.presentism : {}),
      enabled: source.liquidationModel?.rules?.presentism?.enabled !== false,
      percent: Number(source.liquidationModel?.rules?.presentism?.percent ?? 0) || 0,
      requiresNoUnjustifiedAbsence: source.liquidationModel?.rules?.presentism?.requiresNoUnjustifiedAbsence !== false
    },
    nonRemunerativeScale: {
      ...normalizedNonRemunerativeScaleRules,
      enabled: normalizedNonRemunerativeScaleRules.enabled !== false
    },
    overtime: {
      ...(source.liquidationModel?.rules?.overtime && typeof source.liquidationModel.rules.overtime === "object" ? source.liquidationModel.rules.overtime : {}),
      enabled: source.liquidationModel?.rules?.overtime?.enabled !== false,
      divisor: Number(source.liquidationModel?.rules?.overtime?.divisor ?? source.rules?.hourDivisor ?? 200) || 200
    }
  } : {
    ...(source.liquidationModel?.rules && typeof source.liquidationModel.rules === "object" ? source.liquidationModel.rules : {}),
    ...(Object.keys(normalizedNonRemunerativeScaleRules).length ? { nonRemunerativeScale: normalizedNonRemunerativeScaleRules } : {}),
    ...(salaryType ? { salaryType } : {})
  };
  const normalized = {
    schemaVersion: source.schemaVersion || "esueldos-convenio-universal-v1",
    id,
    name: String(name),
    shortName: source.shortName || source.nombreCorto || String(name).replace(/\s*CCT.*$/i, "").slice(0, 42),
    source: source.source || source.cct || source.legalSource || "",
    type: salaryType,
    calculationMode: "generic-v1",
    generatedByLeia: true,
    periods,
    zones,
    categories,
    additionals: source.additionals && typeof source.additionals === "object" ? source.additionals : {},
    rules,
    liquidationModel: {
      version: "generic-v1",
      rules: liquidationRules,
      concepts,
      deductions,
      retentions,
      employerContributions
    },
    auditChecklist: Array.isArray(source.auditChecklist) ? source.auditChecklist.filter(Boolean).map(String) : [],
    confidence: 0,
    warnings,
    notes: Array.isArray(source.notes || source.observaciones) ? (source.notes || source.observaciones).filter(Boolean).map(String) : []
  };
  [
    "metadata",
    "legalFramework",
    "scope",
    "documents",
    "variables",
    "payrollBases",
    "calendar",
    "employeeRequirements",
    "employerObligations",
    "validation",
    "extractedRules",
    "automationHints",
    "ui",
    "extraction",
    "convenio",
    "ambitos",
    "escalas",
    "categorias",
    "conceptos",
    "adicionales"
  ].forEach((key) => {
    if (source[key] !== undefined) normalized[key] = source[key];
  });
  if (source.extraordinaryContribution && typeof source.extraordinaryContribution === "object" && !Array.isArray(source.extraordinaryContribution)) {
    normalized.extraordinaryContribution = normalizeMoneyMap(source.extraordinaryContribution);
  }
  if (source.sourceFiles && Array.isArray(source.sourceFiles)) {
    normalized.sourceFiles = source.sourceFiles.filter(Boolean).map(String);
  }
  polishConventionWarnings(normalized);
  normalized.confidence = scoreConvention(normalized);
  return normalized;
}

function universalConventionTemplateForPrompt() {
  return {
    schemaVersion: EXCEL_SCHEMA_VERSION,
    convenio: {
      convenio_id: "",
      tipo_norma: "",
      numero: "",
      "a\u00f1o": "",
      denominacion: "",
      actividad: "",
      rama: "",
      jurisdiccion: "",
      organismo: "",
      partes_sindicales: "",
      partes_empleadoras: "",
      fecha_homologacion: "",
      vigencia_desde: "",
      vigencia_hasta: "",
      ambito_territorial: "",
      personal_comprendido: "",
      personal_excluido: "",
      fuente_documento: ""
    },
    ambitos: [],
    categorias: [],
    conceptos: [],
    escalas: [],
    adicionales: []
  };
}

function conventionExtractionContractForPrompt() {
  return {
    "convention": {
      "identification": {
        "id": "string (slug estable extraído del documento)",
        "name": "string (nombre legal o actividad extraída)",
        "shortName": "string",
        "source": "string (CCT, acta o resolución detectada)",
        "type": "monthly | daily | hourly | empty"
      },
      "periods": [
        {
          "id": "string (format YYYY-MM)",
          "label": "string",
          "effectiveFrom": "string (YYYY-MM-DD o empty)",
          "effectiveTo": "string (YYYY-MM-DD o empty)",
          "sourceFileName": "string"
        }
      ],
      "zones": [
        {
          "id": "string",
          "label": "string",
          "coef": "number | null",
          "description": "string"
        }
      ],
      "categories": [
        {
          "id": "string",
          "label": "string (categoría laboral)",
          "group": "string (agrupador o jornada)",
          "description": "string",
          "zone": "string (id de zona o empty)",
          "monthly": "number | null",
          "day": "number | null",
          "hourly": "number | null",
          "monthlyByPeriod": {
            "YYYY-MM": "number"
          },
          "dayByPeriod": {
            "YYYY-MM": "number"
          },
          "hourlyByPeriod": {
            "YYYY-MM": "number"
          },
          "nonRem": {
            "YYYY-MM": "number"
          },
          "normalWeeklyHours": "number | null",
          "normalDailyHours": "number | null",
          "legalReferences": [
            "string"
          ],
          "notes": [
            "string"
          ]
        }
      ],
      "rules": {
        "salaryType": "monthly | daily | hourly | empty",
        "monthDivisor": "number | null",
        "dayDivisor": "number | null",
        "hourDivisor": "number | null",
        "weeklyHours": "number | null",
        "vacationDivisor": "number | null",
        "licenses": [
          {
            "name": "string",
            "rule": "string (regla extraída)",
            "evidence": "string"
          }
        ],
        "legalReferences": [
          "string"
        ]
      },
      "liquidationModel": {
        "rules": {
          "seniority": {
            "enabled": "boolean | null",
            "mode": "string",
            "percentPerYear": "number | null",
            "capYears": "number | null",
            "base": "string",
            "legalReferences": [
              "string"
            ]
          },
          "presentism": {
            "enabled": "boolean | null",
            "percent": "number | null",
            "base": "string",
            "requiresNoUnjustifiedAbsence": "boolean | null",
            "legalReferences": [
              "string"
            ]
          },
          "nonRemunerativeScale": {
            "enabled": "boolean | null",
            "seniorityEnabled": "boolean | null",
            "seniorityPercentPerYear": "number | null",
            "seniorityCapYears": "number | null",
            "presentismEnabled": "boolean | null",
            "presentismPercent": "number | null",
            "presentismRequiresNoUnjustifiedAbsence": "boolean | null",
            "subjectToHealthInsurance": "boolean | null",
            "subjectToUnion": "boolean | null",
            "legalReferences": [
              "string"
            ]
          },
          "overtime": {
            "enabled": "boolean | null",
            "divisor": "number | null",
            "rate50": "number | null",
            "rate100": "number | null",
            "legalReferences": [
              "string"
            ]
          }
        },
        "concepts": [
          {
            "id": "string",
            "label": "string",
            "group": "string",
            "inputType": "checkbox | number",
            "rowType": "remunerative | nonRemunerative",
            "calculation": "fixed | percentOfBase | amountPerUnit",
            "percent": "number | null",
            "amount": "number | null",
            "amountByPeriod": {
              "YYYY-MM": "number"
            },
            "unitAmount": "number | null",
            "unitAmountByPeriod": {
              "YYYY-MM": "number"
            },
            "base": "string",
            "defaultValue": "boolean | number",
            "requiresHumanValidation": "boolean",
            "legalReferences": [
              "string"
            ],
            "sourceFiles": [
              "string"
            ],
            "detail": "string (evidencia)",
            "notes": [
              "string"
            ]
          }
        ],
        "deductions": [
          {
            "id": "string",
            "label": "string (descuento del trabajador)",
            "calculation": "fixed | percentOfBase",
            "percent": "number | null",
            "amount": "number | null",
            "amountByPeriod": {
              "YYYY-MM": "number"
            },
            "base": "string",
            "defaultValue": "boolean",
            "appliesWhen": "string",
            "requiresHumanValidation": "boolean",
            "legalReferences": [
              "string"
            ],
            "sourceFiles": [
              "string"
            ],
            "detail": "string (evidencia)"
          }
        ],
        "retentions": [
          {
            "id": "string",
            "label": "string (retención)",
            "calculation": "fixed | percentOfBase",
            "percent": "number | null",
            "amount": "number | null",
            "amountByPeriod": {
              "YYYY-MM": "number"
            },
            "base": "string",
            "defaultValue": "boolean",
            "appliesWhen": "string",
            "requiresHumanValidation": "boolean",
            "legalReferences": [
              "string"
            ],
            "sourceFiles": [
              "string"
            ],
            "detail": "string (evidencia)"
          }
        ]
      }
    }
  };      
} 

function buildConventionPrompt({ draftName, notes }) {
  return [
    "INSTRUCCION PARA EL AGENTE ESTRUCTURADOR DE CONVENIOS COLECTIVOS",
    "Actúa como un experto liquidador de sueldos en Argentina. Tu tarea es extraer todos los datos necesarios para una liquidación de sueldos.",
    "Debes extraer los haberes remunerativos, no remunerativos, retenciones y licencias (y las escalas salariales si corresponde).",
    "DEBE ESTAR SÍ O SÍ el cálculo para cada concepto; si es extraído de una tabla, indícalo explícitamente.",
    "ATENCIÓN: No metas leyes ni nada jurídico. Extrae SOLAMENTE lo estrictamente necesario para liquidar sueldos y poder calcular cada haber.",
    "Debes analizar la totalidad de la documentacion enviada en esta solicitud: texto principal, actas complementarias, acuerdos salariales, escalas salariales, anexos, tablas, imagenes, cuadros, notas al pie, adendas y resoluciones homologatorias.",
    "Primero clasifica cada adjunto o bloque de texto como uno de estos tipos: CCT_BASE, ACTA_ACUERDO, HOMOLOGACION, ESCALA_SALARIAL, ANEXO_ESCALA, ANEXO_REGLAS, RESOLUCION, OTRO. No lo agregues como campo raiz; conserva la clasificacion en documento_tipo/documento_rol/fuente_documento de los objetos extraidos.",
    "Cada dato importante debe tener trazabilidad compacta cuando sea posible: fuente_documento, documento_tipo, pagina, evidencia y confianza. evidencia debe ser una frase o fragmento corto, no un parrafo largo.",
    "AISLAMIENTO ABSOLUTO: cada estructuracion empieza desde cero. Ignora por completo convenios anteriores, ejemplos de otros CCT, catalogos internos, memoria de conversaciones, borradores previos, datos aprobados, nombres de archivos anteriores y cualquier convenio precargado. VALORES ACTUALES: Extrae únicamente las reglas, importes, adicionales y escalas vigentes y actuales. Si la documentación contiene múltiples periodos o el historial de acuerdos anteriores, descártalos y quédate solo con los valores actuales del periodo más reciente.",
    "Nunca completes datos usando otro CCT aunque parezca parecido. Si el documento actual no contiene el dato, escribir: Informacion no encontrada en la documentacion analizada.",
    "Todo dato que afecte el calculo del sueldo debe ser identificado y clasificado. No omitir conceptos. No resumir articulos. No inventar informacion.",
    "Si una regla no puede determinarse con certeza, escribir: requiere revision manual.",
    "EXTRAER OBLIGATORIAMENTE informacion general: numero de convenio, anio, denominacion, actividad, rama, jurisdiccion, ambito territorial, ambito personal, partes firmantes, fecha de homologacion, vigencia y organismo homologante.",
    "EXTRAER OBLIGATORIAMENTE todas las categorias laborales: nombre, codigo si existe, descripcion, tareas, nivel jerarquico, rama y modalidad.",
    "Distinguir categoria laboral de concepto/adicional: Adicional, Plus, Premio, Bono, Viatico, Asignacion, Presentismo, Antiguedad, Titulo, Falla/Quebranto de caja, Movilidad, Refrigerio, No Remunerativo, Aporte, Cuota, Fondo, Seguro y Contribucion no son categorias laborales salvo que el documento diga explicitamente que son puestos/categorias.",
    "Si una misma categoria tiene variantes liquidatorias con valores distintos por modalidad, jornada, alcance, rama o condicion de trabajo, NO las compactes. Deben quedar como categorias separadas con categoria_id diferenciado y modalidad_aplicable clara. Ejemplos genericos: CATEGORIA_X_CON_RETIRO y CATEGORIA_X_SIN_RETIRO; CATEGORIA_X_JORNADA_8H y CATEGORIA_X_JORNADA_6H.",
    "NO extraigas tablas salariales completas en esta llamada. Las escalas salariales se extraen en una segunda llamada separada. En esta llamada deja escalas: [] salvo que el texto principal contenga una regla salarial sin tabla separada.",
    "EXTRAER OBLIGATORIAMENTE haberes remunerativos: sueldo basico, antiguedad, presentismo, puntualidad, titulo, funcion, caja, zona, altura, riesgo, horas extras, nocturnidad, feriados, francos trabajados, guardias, disponibilidad, productividad, comisiones y premios.",
    "SUELDO_BASICO es solo salario basico de escala. Sueldo Anual Complementario, SAC o Aguinaldo debe ir como concepto SAC, nunca como SUELDO_BASICO.",
    "Para cada concepto extraer datos compactos: nombre, articulo, formula corta, base de calculo, porcentaje, importe fijo, condicion breve, tope y frecuencia. No copies parrafos completos.",
    "ATENCION: Toma TODOS los valores salariales y periodos correspondientes al año actual. No omitas ningun mes del año en curso.",
    "EXTRAER OBLIGATORIAMENTE haberes no remunerativos: sumas no remunerativas, no remunerativos de escala, asignaciones, bonos, gratificaciones extraordinarias, viaticos, beneficios en especie y ticket alimentacion. Extraer formula corta, condiciones breves, base, tope y vigencia.",
    "Si un concepto legal o de liquidación estándar (como aguinaldo, presentismo, vacaciones, antigüedad) NO está explícitamente mencionado en el documento del Convenio Colectivo, pero SÍ aparece en la LEY DE TRABAJO APLICABLE provista en el contexto, debés extraerlo obligatoriamente y sumarlo a la lista de 'conceptos'.",
    "Para todos los conceptos, si proviene de un artículo específico del CCT o de la Ley de Trabajo, indícalo en el nuevo campo 'origen_articulo' dentro de conceptos. Ejemplo: 'Art. 4 CCT' o 'Art. 122 LCT'. Si proviene de la ley laboral, dejalo claro.",
    "Todo haber no remunerativo debe ir en conceptos con tipo_concepto haber y estrictamente naturaleza no_remunerativo, unidad_calculo, formula_base, base_calculo, condicion y es_liquidable true salvo que el documento lo declare solo informativo.",
    "Clasificacion obligatoria de conceptos: tipo_concepto debe ser haber, descuento, retencion, aporte_patronal o referencia. No uses remunerativo/no_remunerativo como tipo_concepto; eso va en naturaleza.",
    "Naturaleza obligatoria: remunerativo, no_remunerativo, retencion, contribucion_patronal, referencial o requiere_revision_manual si el documento no permite determinarlo. No dejar naturaleza vacia.",
    "Dividir conceptos en tres grupos liquidatorios principales: haberes remunerativos = tipo_concepto haber + naturaleza remunerativo; haberes no remunerativos = tipo_concepto haber + naturaleza no_remunerativo; deducciones = tipo_concepto descuento o retencion + naturaleza retencion. No clasifiques deducciones, aportes del trabajador, cuota sindical, obra social ni fondos como haberes remunerativos.",
    "ATENCION CRITICA: Revisa minuciosamente los haberes que sean 'no remunerativos'. Asegurate de separarlos correctamente asignandoles SIEMPRE naturaleza 'no_remunerativo'. BAJO NINGUN CONCEPTO los agrupes o clasifiques como 'remunerativo'.",
    "Base de calculo obligatoria y computable: sueldo_basico, total_remunerativo, haberes_remunerativos, remuneracion_sujeta_a_aporte, escala_salarial, valor_hora, valor_dia, monto_fijo o requiere_revision_manual. Si el documento da otra base, conservarla como texto breve en base_calculo.",
    "Formula de calculo obligatoria en formula_base: valor_escala_categoria, monto_fijo, porcentaje_sobre_base, porcentaje_sobre_valor_hora, cantidad_por_valor_unitario, valor_referencia_escala o requiere_revision_manual. Si el documento muestra una formula concreta, resumirla sin inventar.",
    "Para los conceptos genéricos VALOR_HORA o VALOR_DIA, su 'formula_base' NO debe decir 'valor_escala_categoria' ni hacer referencia a la escala directamente. Usa la sintaxis matemática correspondiente a su cálculo real en el convenio, por ejemplo: (sueldo_basico / divisor_horas) o (sueldo_basico / divisor_dias), reemplazando divisor_horas o divisor_dias por el número real de horas/días que diga el convenio (ej. (sueldo_basico / 200) o (sueldo_basico / 30)). Si el convenio no especifica divisor horario, usa (sueldo_basico / 200).",
    "EXTRAER OBLIGATORIAMENTE descuentos y retenciones legales y convencionales: jubilacion, Ley 19032, obra social, seguro, cuota sindical, fondo solidario, aportes especiales y contribuciones extraordinarias. Extraer base imponible, porcentaje, tope y condiciones.",
    "EXTRAER OBLIGATORIAMENTE aportes y contribuciones patronales: fondo solidario empleador, contribuciones sindicales, aportes a camaras empresarias, seguros obligatorios y cualquier obligacion patronal creada por el convenio.",
    "NO pongas licencias, vacaciones, maternidad, nacimiento, matrimonio, fallecimiento, examenes, enfermedad o accidentes dentro de conceptos liquidables salvo que exista un adicional salarial periodico con formula/importe. Esos derechos no son haberes mensuales.",
    "EXTRAER OBLIGATORIAMENTE jornada laboral: horario normal, jornada maxima, jornada reducida, jornada nocturna, jornada insalubre, descansos y francos.",
    "EXTRAER OBLIGATORIAMENTE horas extras: horas al 50%, horas al 100%, feriados, nocturnas, bases de calculo y formulas.",
    "EXTRAER OBLIGATORIAMENTE antiguedad completa: escalas, tramos, formula, topes y base de calculo.",
    "EXTRAER OBLIGATORIAMENTE presentismo y puntualidad: como se calcula, cuando se pierde, cuando se reduce y base utilizada.",
    "EXTRAER OBLIGATORIAMENTE reglas de liquidacion: divisor mensual, divisor diario, divisor horario, redondeos, minimos garantizados, garantias salariales, compensaciones, absorciones y topes.",
    "Cuando el documento contiene tablas, pensar en matriz: categoria x periodo x concepto x zona x modalidad x unidad_pago. Cada celda monetaria debe convertirse en escalas[].valores[] si es valor salarial, no en texto libre.",
    "Soportar tablas con categorias en filas y periodos en columnas, periodos en filas y categorias en paginas separadas, grupos/ramas como encabezados intermedios, zonas/regiones como subtitulos, y columnas de basico/no remunerativo/total.",
    "categorias debe contener solo puestos/cargos/clases/grupos laborales reales. No crear categorias con modalidades puras como con retiro, sin retiro, mismo empleador, distintos empleadores, jornada completa, media jornada, mensualizado o jornalizado; esas van en modalidad_aplicable o escalas[].valores[].modalidad.",
    "No uses salaryType monthly por defecto. Si el CCT o la escala habla de jornal, dia, changa, valor dia o pago por dia, usa daily y completa day/dayByPeriod. Si habla de hora o valor hora, usa hourly y completa hourly/hourlyByPeriod. Usa monthly solo cuando el basico sea mensual.",
    "Toda formula encontrada debe quedar estructurada en sintaxis matematica clara para que la calculadora pueda leerla, por ejemplo: (sueldo_basico * 0.02) o (valor_hora * 1.5 * horas). No uses 'por ciento' ni 'x', usa '*', '/', '+' y '-'.",
    "Antes de finalizar verificar categorias, escalas salariales, haberes remunerativos, haberes no remunerativos, retenciones, aportes patronales, licencias, jornada laboral, horas extras, formulas de calculo y reglas de liquidacion. Si falta alguno, indicar: Informacion no encontrada en la documentacion analizada.",
    "REGLA CRITICA: devolve un JSON plano con EXACTAMENTE estas claves raiz: schemaVersion, convenio, ambitos, categorias, conceptos, escalas, adicionales. No agregues ningun otro campo raiz.",
    "Campos raiz prohibidos: architectureVersion, processingPipeline, structuredModel, structureValidation, metadata, auditoria, flujo_liquidacion, reglas_validacion, novedades_requeridas.",
    "No crear escalas vacias. Solo crear una escala si hay nombre_escala, periodo_desde, periodo_hasta o al menos un valor salarial dentro de valores.",
    "No crear categorias sin categoria_nombre si el nombre esta disponible en el texto. Si no se identifica el nombre real, no inventar.",
    "Estructura el convenio desde cero usando exclusivamente la documentacion enviada en esta solicitud. No uses catalogos, convenios precargados, memoria, borradores previos ni rastros de convenios eliminados.",
    "La IA solo estructura datos. No calcules sueldos ni inventes importes, porcentajes, articulos o reglas. Si falta texto usa \"\"; si falta numero usa null; si falta lista usa [].",
    "Devuelve exclusivamente JSON valido, sin explicaciones ni bloques de formato.",
    "La respuesta debe ser compacta y completa. Prioriza JSON valido. No dejes cadenas sin cerrar. No agregues texto fuera del JSON.",
    "Usa schemaVersion esueldos-cct-estructura-excel-v1 y la estructura Excel: convenio, ambitos, categorias, conceptos, escalas con valores y adicionales.",
    "Diferencia haberes remunerativos, haberes no remunerativos, descuentos, retenciones y aportes patronales en conceptos.tipo_concepto y conceptos.naturaleza.",
    "Para haberes: tipo_concepto siempre debe ser haber; naturaleza indica si es remunerativo o no_remunerativo.",
    "ES IMPRESCINDIBLE diferenciar los haberes NO REMUNERATIVOS. Verifica que su naturaleza sea exactamente 'no_remunerativo'.",
    "Las tablas separadas de adicionales deben ir en adicionales o conceptos, no como categorias.",
    "No inventes zona desfavorable, plus zona ni porcentajes regionales. Solo extraelos si aparecen explicitamente en la documentacion analizada.",
    "La zona General/Base/Sin adicional debe conservarse en zona como General o general cuando aparezca.",
    "Devolve JSON valido con esta forma exacta: {\"schemaVersion\":\"esueldos-cct-estructura-excel-v1\",\"convenio\":{},\"ambitos\":[],\"categorias\":[],\"conceptos\":[],\"escalas\":[],\"adicionales\":[]}.",
    "Campos internos importantes: categorias[].categoria_id/categoria_nombre; conceptos[].concepto_id/nombre/tipo_concepto/naturaleza/unidad_calculo/formula_base/base_calculo/condicion/es_liquidable; escalas[].valores[].categoria_id/concepto_id/modalidad/unidad_pago/periodicidad/valor/moneda/zona. Trazabilidad opcional por objeto: documento_tipo, documento_rol, evidencia, pagina, confianza.",
    draftName ? `Etiqueta informativa escrita por el usuario: ${draftName}. No la uses como evidencia legal ni como reemplazo de la identificacion extraida de los adjuntos.` : "Etiqueta informativa escrita por el usuario: sin etiqueta.",
    notes ? `Notas informativas del usuario: ${notes}. No las uses como reemplazo de evidencia documental.` : "Notas informativas del usuario: sin notas."
  ].join("\n");
}

function buildConventionCorePrompt({ draftName, notes }) {
  return [
    "Actúa como un experto liquidador de sueldos en Argentina. Extrae todos los datos necesarios para una liquidación de sueldos (haberes remunerativos, no remunerativos, retenciones y licencias).",
    "Debe estar sí o sí el cálculo para cada concepto. Si es de una tabla, indícalo. NO metas leyes ni texto jurídico, solo lo estrictamente necesario para liquidar sueldos.",
    "Tu objetivo en esta llamada es extraer SOLO los datos nucleares y el esqueleto legal del CCT. NO extraigas escalas salariales completas: deja escalas: []. La escala se procesa en otra llamada.",
    "[AISLAMIENTO ABSOLUTO] Cada ejecución comienza desde cero. Ignora convenios anteriores o conocimientos preexistentes. Si un dato no está en el documento, escribe null o [].",
    "Devuelve EXCLUSIVAMENTE un objeto JSON válido, compacto, sin texto explicativo ni bloques de formato. Claves raíz exactas: schemaVersion, convenio, ambitos, categorias, conceptos, escalas, adicionales, rules.",
    "schemaVersion debe ser 'esueldos-cct-estructura-excel-v1'.",
    
    // 1. CONVENIO Y TRAZABILIDAD
    "CONVENIO: Extrae numero, anio, denominacion, actividad, rama, jurisdiccion, ambito_territorial, partes_firmantes, fecha_homologacion y vigencia.",
    "Clasifica el origen del bloque/documento dentro de 'documento_tipo' como: CCT_BASE, ACTA_ACUERDO, HOMOLOGACION, RESOLUCION u OTRO.",
    
    // 2. CATEGORÍAS (Estructura de Puestos)
    "CATEGORÍAS: Identifica los puestos reales. Si el CCT divide por Ramas, Sectores o Agrupamientos y los nombres se repiten, genera un 'categoria_id' único y compuesto (ej: 'RAMA_TALLER_OPERARIO_A').",
    "Variantes de jornada o modalidad (ej: Con Retiro/Sin Retiro, Completa/Media) NO deben duplicar la categoría base salvo que sean puestos jerárquicos distintos. Se diferenciarán luego en las escalas.",
    
    // 3. CONCEPTOS LIQUIDABLES (Reglas y Motores de Cálculo)
    "CONCEPTOS: Identifica todos los conceptos remunerativos, no remunerativos y retenciones mencionados en el texto legal.",
    "Si un concepto estándar (como SAC, presentismo, vacaciones) falta en el CCT pero figura en la LEY DE TRABAJO APLICABLE provista, DEBES extraerlo y basarlo en la ley.",
    "Para cada concepto, completa el campo 'origen_articulo' indicando si proviene del CCT (ej. 'Art. 4 CCT') o de la Ley de Trabajo (ej. 'Art. 122 LCT').",
    "Prohibido crear conceptos dinámicos por mes o año (ej: NO crees BASICO_OCT_25). Usa ID genéricos: SUELDO_BASICO, VALOR_HORA, VALOR_DIARIO, NO_REMUNERATIVO, ADICIONAL_CONVENIO.",
    "El Sueldo Anual Complementario debe mapearse como concepto_id: 'SAC', nunca como SUELDO_BASICO.",
    "Diferencia estrictamente la NATURALEZA de los conceptos: Remunerativos (haber / remunerativo), No Remunerativos (haber / no_remunerativo), Deducciones (retencion o descuento / retencion). Es CRÍTICO que los adicionales calificados como 'no rem' tengan estrictamente esa naturaleza.",
    "Cada concepto debe parametrizarse con: unidad_calculo (monthly, hourly, daily, percentage, fixed), formula_base, base_calculo (sueldo_basico, total_remunerativo, etc.), origen_articulo, condicion y detail (la evidencia).",
    "Viaticos, traslados, comida, pernocte, kilometraje u otros conceptos por dia, viaje, km u hora deben quedar como cantidad_por_valor_unitario o amountPerUnit, con unidad_calculo clara y valor unitario si existe. No los modeles como checkbox mensual salvo que el documento diga suma fija mensual.",
    
    // 4. LICENCIAS Y REGLAS
    "LICENCIAS: Dentro de la clave raíz 'rules', extrae un arreglo 'licenses' donde cada objeto tenga { name: 'string', rule: 'regla extraída', evidence: 'texto de evidencia' }. Incluye aquí licencias, vacaciones, maternidad, etc.",
    
    // 5 y 6. ADICIONALES FIJOS Y REGLAS DE LIQUIDACIÓN
    "Antigüedad: Determina la base de cálculo y la regla y estructurala en 'formula_base' con sintaxis matematica clara (ej: sueldo_basico * 0.01 * anios).",
    "Presentismo: Identifica si es un porcentaje (ej: 8.33% o doceava parte) o suma fija, y las causales de pérdida. Escribir formulas matematicas claras (ej: sueldo_basico * 0.0833).",
    "Si el CCT define divisores explícitos (ej: divisor vacacional 25, divisor hora 200), regístralo en las condiciones del concepto. Si no figura, coloca 'requiere_revision_manual'.",
    "Asegurate de que TODAS las formulas esten en formato matematico (ej: sueldo_basico * 0.020) para que la calculadora pueda interpretarlas directamente.",
    
    draftName ? `Etiqueta usuario: ${draftName}.` : "Etiqueta usuario: sin etiqueta.",
    notes ? `Notas usuario: ${notes}.` : "Notas usuario: sin notas."
  ].join("\n");
}

function buildScalePrompt({ draftName, notes, baseCategories = [], baseConcepts = [] }) {
  const baseCategoriesText = baseCategories.length 
    ? `\nCATEGORÍAS PRE-EXTRAÍDAS DEL CCT:\n${JSON.stringify(baseCategories.map(c => ({categoria_id: c.categoria_id, categoria_nombre: c.categoria_nombre})))}\nREGLA PARA EVITAR DUPLICADOS: Si la fila de la tabla salarial corresponde a una categoría de esta lista, usa EXACTAMENTE su 'categoria_id'. Si la fila contiene una categoría NUEVA que no está en la lista, extráela normalmente y créale un ID nuevo.` 
    : "";
  const baseConceptsText = baseConcepts.length
    ? `\nCONCEPTOS PRE-EXTRAÍDOS DEL CCT:\n${JSON.stringify(baseConcepts.map(c => ({concepto_id: c.concepto_id, nombre: c.nombre})))}\nREGLA PARA HABERES EN TABLAS: Si el archivo de escala cuenta con haberes o adicionales (en cuadros separados o junto a la escala), relaciónalos con los 'concepto_id' de esta lista. Si hay un valor nuevo, extráelo en escalas[].valores[] usando el concepto_id. NO extraigas estos haberes o adicionales como categorías laborales, y NO los dupliques en el array raíz de conceptos.`
    : "";
  return [
    "Actúa como un experto liquidador de sueldos en Argentina. Extrae todos los datos necesarios para una liquidación de sueldos, específicamente las escalas salariales.",
    "Debe estar sí o sí el cálculo para cada concepto. Si es extraído de una tabla, indícalo explícitamente. NO metas leyes ni texto jurídico, solo lo estrictamente necesario para liquidar sueldos.",
    "Tu objetivo principal es extraer de forma exhaustiva las categorías vigentes y las tablas de valores salariales publicados en el documento adjunto." + baseCategoriesText + baseConceptsText,
    "[AISLAMIENTO ABSOLUTO] No uses memoria ni otros CCT. Solo el texto y las tablas de esta escala. Si falta un dato usa null o []. No inventes valores.",
    "Devuelve EXCLUSIVAMENTE un objeto JSON válido, compacto, sin texto explicativo ni bloques de formato. Claves raíz exactas: schemaVersion, convenio, ambitos, categorias, conceptos, escalas, adicionales.",
    
    // 4. MATRIZ DE ESCALAS SALARIALES (El núcleo de esta función)
    "Piensa en una matriz multidimensional: Categoría x Periodo (Vigencia) x Concepto x Zona x Modalidad.",
    "Cada celda con valor monetario de la tabla salarial debe generar un elemento puro en el array 'escalas[].valores[]'.",
    "Para el año actual, extrae de forma exhaustiva TODOS los periodos de vigencia concatenados o segmentados que aparezcan. No omitas ningún mes del año en curso.",
    "Identifica correctamente el divisor y la unidad de pago: si la escala expresa valores por hora, setea 'unidad_pago' en 'hourly'; si es jornal, 'daily'; si es sueldo mensual, 'monthly'. No uses 'monthly' por defecto.",
    "Mapear columnas por posición cuando los encabezados estén separados de las filas (ej: si el encabezado dice 'Básico Abril 2026', el importe de esa columna es SUELDO_BASICO para ese periodo).",
    "Si la tabla aparece fragmentada por la lectura del PDF, reconstruye cada fila completa uniendo la línea de categoría con las líneas siguientes de importes hasta la próxima categoría.",
    
    // Mapeo de Conceptos desde las Columnas de la Tabla
    "No crees conceptos por mes ni por categoría. Usa ID canónicos reutilizables en escalas[].valores[].concepto_id: SUELDO_BASICO, NO_REMUNERATIVO, TOTAL_REMUNERATIVO, VALOR_HORA, VALOR_DIARIO, VIATICO.",
    "Columnas llamadas No Rem, Suma No Remunerativa o Incremento Solidario son haberes no remunerativos: asignales concepto_id 'NO_REMUNERATIVO' y en la sección conceptos dales naturaleza 'no_remunerativo' de forma estricta.",
    "Los totales publicados (ej: Total Remunerativo, Neto) deben guardarse con tipo_concepto 'referencia', naturaleza 'referencial' y es_liquidable false.",
    "Si un adicional (ej: Presentismo, Plus Asistencia) aparece con un importe fijo dentro de la tabla salarial, crealo en conceptos/adicionales y mandá sus montos a escalas[].valores[] con el categoria_id vacío si es general.",
    "Si una columna de viatico, traslado, comida, pernocte, kilometraje o valor por dia/viaje/km/hora representa valor unitario, modelala para pedir cantidad en liquidacion: calculation amountPerUnit o formula_base cantidad_por_valor_unitario.",
    
    // Control de Errores Numéricos
    "CRÍTICO: En Argentina, el punto (.) separa miles y la coma (,) separa decimales en documentos legales. Procesa los números bajo este criterio estricto (ej: 860.281 es ochocientos sesenta mil doscientos ochenta y uno).",
    "Asegúrate de que toda categoría que tenga una fila salarial en la tabla tenga su correspondiente 'categoria_id' idéntico en el listado de categorías raíz para evitar desvinculaciones.",

    draftName ? `Etiqueta informativa: ${draftName}.` : "Etiqueta informativa: sin etiqueta.",
    notes ? `Notas informativas: ${notes}.` : "Notas informativas: sin notas."
  ].join("\n");
}

function buildScaleCompactPrompt({ draftName, notes, baseCategories = [], baseConcepts = [] }) {
  const baseCategoriesText = baseCategories.length 
    ? `\nCATEGORÍAS PRE-EXTRAÍDAS: ${JSON.stringify(baseCategories.map(c => ({categoria_id: c.categoria_id, categoria_nombre: c.categoria_nombre})))}\nREGLA: Usa los 'categoria_id' de esta lista para mapear equivalencias. Si hay categorías nuevas en la tabla, extráelas también y crea nuevos IDs.` 
    : "";
  const baseConceptsText = baseConcepts.length
    ? `\nCONCEPTOS PRE-EXTRAÍDOS: ${JSON.stringify(baseConcepts.map(c => ({concepto_id: c.concepto_id, nombre: c.nombre})))}\nREGLA: Relaciona los adicionales o haberes de la tabla con estos 'concepto_id'. NO extraigas los adicionales como categorías y NO dupliques conceptos.`
    : "";
  return [
    "Extrae SOLO la escala salarial en JSON válido. Sé lo más compacto posible para evitar límites de tokens de salida." + baseCategoriesText + baseConceptsText,
    "Devuelve exclusivamente el contrato JSON sin notas ni explicaciones: {\"schemaVersion\":\"esueldos-cct-estructura-excel-v1\",\"convenio\":{},\"ambitos\":[],\"categorias\":[],\"conceptos\":[],\"escalas\":[],\"adicionales\":[]}.",
    "[AISLAMIENTO ABSOLUTO] Usa únicamente el texto de esta escala salarial. Si falta información usa null o [].",
    
    // Directivas de Ultra-Compactación (Exclusivas de esta función)
    "Aplica estrictamente una matriz conceptual compacta: categoría x periodo x concepto x zona x modalidad. Cada importe va en escalas[].valores[].",
    "Cada ítem de 'valores' debe ser mínimo: categoria_id, concepto_id, periodicidad, valor. Agrega modalidad, unidad_pago, moneda o zona SOLO si cambia o es estrictamente indispensable para diferenciar la celda.",
    "Usa 'categoria_nombre' únicamente en el array raíz de categorías; NO repitas el nombre de la categoría dentro de cada objeto del vector de valores.",
    "Conceptos permitidos en esta llamada (Máximo 12 ID canónicos): SUELDO_BASICO, NO_REMUNERATIVO, TOTAL_REMUNERATIVO, VALOR_HORA, VALOR_DIARIO, VALOR_JORNAL, VIATICO. No crees conceptos por mes (Prohibido BASICO_OCT_25).",
    
    // Clasificación y Tratamiento Rápido
    "SUELDO_BASICO: tipo_concepto haber, naturaleza remunerativo, base escala_salarial. NO_REMUNERATIVO: tipo_concepto haber, naturaleza no_remunerativo, base escala_salarial.",
    "El Sueldo Anual Complementario (SAC) no es SUELDO_BASICO. Si aparece en la tabla, crear concepto 'SAC' por separado.",
    "Si una categoría tiene importes separados por modalidad (ej: Con Retiro / Sin Retiro), crea categorías con IDs diferenciados en el listado raíz y apunta cada valor a su respectivo ID variante.",
    "Reconstruye filas partidas del PDF: una categoría seguida por varias líneas de importes numéricos corresponden a la misma fila de la matriz.",
    "Formato numérico argentino obligatorio: el punto (.) son miles y la coma (,) son decimales.",

    draftName ? `Etiqueta usuario: ${draftName}.` : "Etiqueta usuario: sin etiqueta.",
    notes ? `Notas usuario: ${notes}.` : "Notas usuario: sin notas."
  ].join("\n");
}

function conventionAttachmentParts({ cctPdf, scalePdf } = {}) {
  const parts = [];

  if (cctPdf) {
    parts.push({
      text: `ARCHIVO 1 - CCT, ACTA O DOCUMENTO PRINCIPAL. Nombre: ${cctPdf.sourceFileName || "archivo"}`
    });
    parts.push({
      inlineData: {
        type: "attachment",
        mimeType: cctPdf.mimeType || "application/octet-stream",
        fileName: cctPdf.sourceFileName || "cct",
        data: Buffer.isBuffer(cctPdf.buffer) ? cctPdf.buffer.toString("base64") : Buffer.from(cctPdf.buffer || "").toString("base64")
      }
    });
  }

  if (scalePdf) {
    parts.push({
      text: `ARCHIVO 2 - ESCALA SALARIAL. Nombre: ${scalePdf.sourceFileName || "archivo"}`
    });
    parts.push({
      inlineData: {
        type: "attachment",
        mimeType: scalePdf.mimeType || "application/octet-stream",
        fileName: scalePdf.sourceFileName || "scale",
        data: Buffer.isBuffer(scalePdf.buffer) ? scalePdf.buffer.toString("base64") : Buffer.from(scalePdf.buffer || "").toString("base64")
      }
    });
  }

  return parts;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pdfInlinePart(file) {
  return {
    inlineData: {
      mimeType: file.mimeType || "application/pdf",
      data: Buffer.isBuffer(file.buffer) ? file.buffer.toString("base64") : Buffer.from(file.buffer || "").toString("base64")
    }
  };
}

function pdfFilePart(file, uploadedFile) {
  return {
    fileData: {
      mimeType: uploadedFile.mimeType || uploadedFile.mime_type || file.mimeType || "application/pdf",
      fileUri: uploadedFile.uri
    }
  };
}

async function extractPdfText(file) {
  if (!file?.buffer || !String(file.mimeType || "").includes("pdf")) return "";
  try {
    const result = await pdfParse(file.buffer);
    return String(result?.text || "").trim();
  } catch (error) {
    console.warn(`[PDF texto] No se pudo leer ${file.sourceFileName || "archivo.pdf"}: ${error.message}`);
    return "";
  }
}

async function getGeminiFile({ apiKey, name }) {
  const { GoogleGenAI } = require("@google/genai");
  const ai = new GoogleGenAI({ apiKey });
  return ai.files.get({ name });
}

async function waitGeminiFileActive({ apiKey, file }) {
  const { GoogleGenAI } = require("@google/genai");
  const ai = new GoogleGenAI({ apiKey });
  let current = file;
  const maxPolls = Number(process.env.GEMINI_FILE_MAX_POLLS || 24);
  const pollMs = Number(process.env.GEMINI_FILE_POLL_MS || 5000);
  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    if (!current?.state || current.state === "ACTIVE") return current;
    if (current.state === "FAILED") {
      throw new GeminiConventionError(`Gemini no pudo procesar el archivo ${current.displayName || current.name}.`, {
        status: 502,
        code: "FILE_PROCESSING_FAILED"
      });
    }
    console.log(`[Gemini Files] current file status: ${current.state}`);
    console.log('File is still processing, retrying in 5 seconds');
    await sleep(pollMs);
    current = await ai.files.get({ name: current.name });
  }
  throw new GeminiConventionError(`Gemini tardo demasiado en procesar el archivo ${file.displayName || file.name}.`, {
    status: 504,
    code: "FILE_PROCESSING_TIMEOUT"
  });
}

async function uploadGeminiFile({ apiKey, file, displayName }) {
  const { GoogleGenAI } = require("@google/genai");
  const ai = new GoogleGenAI({ apiKey });
  const mimeType = file.mimeType || "application/pdf";
  const buffer = Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(file.buffer || "");
  const fileBlob = new Blob([buffer], { type: mimeType });
  const uploadedFile = await ai.files.upload({
    file: fileBlob,
    config: {
      displayName: displayName || file.sourceFileName || "documento.pdf"
    }
  });
  return waitGeminiFileActive({ apiKey, file: uploadedFile });
}

async function buildPdfPartsForGemini({ apiKey, files, role }) {
  const parts = [];
  let uploaded = 0;
  let inlined = 0;
  for (const file of (files || []).filter((item) => item?.buffer)) {
    parts.push({ text: `${role}. Nombre: ${file.sourceFileName || "archivo.pdf"}` });
    if (useGeminiFilesApi) {
      try {
        const uploadedFile = await uploadGeminiFile({
          apiKey,
          file,
          displayName: `${role} - ${file.sourceFileName || "archivo.pdf"}`
        });
        parts.push(pdfFilePart(file, uploadedFile));
        uploaded += 1;
        continue;
      } catch (error) {
        console.warn(`[Gemini Files] No se pudo subir ${file.sourceFileName || "archivo.pdf"}: ${error.message}. Se usa inline_data.`);
      }
    }
    parts.push(pdfInlinePart(file));
    inlined += 1;
  }
  return { parts, uploaded, inlined };
}

async function callGeminiJson({ apiKey, model, parts, label }) {
  const { GoogleGenAI } = require("@google/genai");
  const ai = new GoogleGenAI({ apiKey });
  const inlineCount = parts.filter((part) => part.inline_data || part.inlineData).length;
  const fileCount = parts.filter((part) => part.file_data || part.fileData).length;
  console.log(`[Gemini ${label}] files=${fileCount} inline=${inlineCount} partes=${parts.length}`);
  const generationConfig = {
    temperature: 0.08,
    topP: 0.72,
    maxOutputTokens: /escala/i.test(label) ? 24000 : 16000,
    responseMimeType: "application/json"
  };
  if (/gemini-2\.5/i.test(model)) {
    generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }
  try {
    const response = await ai.models.generateContent({
      model,
      contents: parts,
      config: generationConfig
    });

    const text = response.text || "";
    if (!text) {
      throw new GeminiConventionError(`Gemini no devolvio texto para ${label}.`, { status: 502, model });
    }
    const usage = response.usageMetadata || null;
    return {
      parsed: parseGeminiJson(text),
      tokenUsage: usage ? {
        promptTokenCount: usage.promptTokenCount || 0,
        candidatesTokenCount: usage.candidatesTokenCount || 0,
        totalTokenCount: usage.totalTokenCount || 0
      } : null
    };
  } catch (error) {
    if (error instanceof GeminiConventionError) {
      throw error;
    }
    throw new GeminiConventionError(error.message, {
      status: error.status || 502,
      model,
      code: error.status
    });
  }
}

async function requestConventionOnceLegacy({ apiKey, model, cctPdf, scalePdf, draftName, notes }) {
  const parts = [{ text: buildConventionPrompt({ draftName, notes }) }];
  if (cctPdf?.buffer) {
    parts.push({ text: `Archivo CCT original: ${cctPdf.sourceFileName || "cct"}` });
    parts.push({ inline_data: { mime_type: cctPdf.mimeType || "application/pdf", data: cctPdf.buffer.toString("base64") } });
  }
  if (scalePdf?.buffer) {
    parts.push({ text: `Archivo escala salarial original: ${scalePdf.sourceFileName || "escala"}` });
    parts.push({ inline_data: { mime_type: scalePdf.mimeType || "application/pdf", data: scalePdf.buffer.toString("base64") } });
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
        temperature: 0.08,
        topP: 0.72,
        maxOutputTokens: 30000,
        responseMimeType: "application/json"
      }
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new GeminiConventionError(payload?.error?.message || `Gemini respondio HTTP ${response.status}`, {
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
    console.log(`│ METRICAS DE CONSUMO DE TOKENS - Borrador de Convenio   │`);
    console.log("├────────────────────────────────────────────────────────┤");
    console.log(`│ Modelo: ${model.padEnd(46)} │`);
    console.log(`│ Tokens de Entrada (Prompt): ${String(promptTokens).padStart(26)} │`);
    console.log(`│ Tokens de Salida (Respuesta): ${String(candidateTokens).padStart(23)} │`);
    console.log(`│ Tokens Totales: ${String(totalTokens).padStart(35)} │`);
    console.log("└────────────────────────────────────────────────────────┘\n");
  }

  const text = extractGeminiText(payload);
  if (!text) {
    throw new GeminiConventionError("Gemini no devolvio texto para el convenio.", { status: 502, model });
  }
  const parsed = normalizeConvention(parseGeminiJson(text), { fallbackName: draftName });
  return parsed;
}

async function requestConventionStructureOnce({ apiKey, model, cctMarkdown, cctPdf, draftName, notes }) {
  const parts = [{ text: buildConventionPrompt({ draftName, notes }) }];
  if (cctPdf?.sourceFileName) {
    parts.push({ text: `Archivo CCT original: ${cctPdf.sourceFileName || "cct"}` });
  }
  if (cctPdf?.buffer) {
    parts.push(pdfInlinePart(cctPdf));
  }
  if (cctMarkdown) {
    parts.push({ text: `Texto del CCT extraido en formato Markdown:\n\n${cctMarkdown}` });
  }
  let result;
  try {
    result = await callGeminiJson({ apiKey, model, parts, label: "convenio" });
  } catch (error) {
    if (error.code !== "INVALID_JSON") throw error;
    console.warn("[Gemini convenio] JSON invalido. Reintentando extraccion compacta de convenio.");
    const retryParts = [{ text: buildConventionCorePrompt({ draftName, notes }) }];
    if (cctPdf?.sourceFileName) retryParts.push({ text: `Archivo CCT original: ${cctPdf.sourceFileName || "cct"}` });
    if (cctPdf?.buffer) retryParts.push(pdfInlinePart(cctPdf));
    if (cctMarkdown) retryParts.push({ text: `Texto del CCT extraido en formato Markdown:\n\n${cctMarkdown}` });
    result = await callGeminiJson({ apiKey, model, parts: retryParts, label: "convenio-core" });
  }
  return { ...result, parsed: normalizeConvention(result.parsed, { fallbackName: draftName }) };
}

async function requestScaleStructureOnce({ apiKey, model, scaleMarkdown, scalePdf, draftName, notes, baseCategories = [], baseConcepts = [] }) {
  if (!scaleMarkdown && !scalePdf) {
    return { parsed: normalizeConvention({}, { fallbackName: draftName }), tokenUsage: null };
  }
  const parts = [{ text: buildScalePrompt({ draftName, notes, baseCategories, baseConcepts }) }];
  if (scalePdf?.sourceFileName) {
    parts.push({ text: `Archivo escala salarial original: ${scalePdf.sourceFileName || "escala"}` });
  }
  if (scalePdf?.buffer) {
    parts.push(pdfInlinePart(scalePdf));
  }
  if (scaleMarkdown) {
    parts.push({ text: `Texto de la escala salarial extraida en formato Markdown:\n\n${scaleMarkdown}` });
  }
  let result;
  try {
    result = await callGeminiJson({ apiKey, model, parts, label: "escala" });
  } catch (error) {
    if (error.code !== "INVALID_JSON") throw error;
    console.warn("[Gemini escala] JSON invalido. Reintentando extraccion compacta de escala.");
    const retryParts = [{ text: buildScaleCompactPrompt({ draftName, notes, baseCategories, baseConcepts }) }];
    if (scalePdf?.sourceFileName) retryParts.push({ text: `Archivo escala salarial original: ${scalePdf.sourceFileName || "escala"}` });
    if (scalePdf?.buffer) retryParts.push(pdfInlinePart(scalePdf));
    if (scaleMarkdown) retryParts.push({ text: `Texto de la escala salarial extraida en formato Markdown:\n\n${scaleMarkdown}` });
    result = await callGeminiJson({ apiKey, model, parts: retryParts, label: "escala-core" });
  }
  return { ...result, parsed: normalizeConvention(result.parsed, { fallbackName: draftName }) };
}

function mergeExcelConventionParts(conventionPart = {}, scalePart = {}, { draftName } = {}) {
  const base = normalizeConvention(conventionPart, { fallbackName: draftName });
  const scale = normalizeConvention(scalePart, { fallbackName: draftName });
  const keyFor = (item, fields) => fields.map((field) => normalizeText(item?.[field])).find(Boolean) || "";
  const mergeUnique = (left, right, fields) => {
    const seen = new Set();
    return [...(left || []), ...(right || [])].filter((item) => {
      const key = keyFor(item, fields) || JSON.stringify(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  return normalizeConvention({
    schemaVersion: EXCEL_SCHEMA_VERSION,
    convenio: { ...(scale.convenio || {}), ...(base.convenio || {}) },
    ambitos: mergeUnique(base.ambitos, scale.ambitos, ["ambito_id", "ambito_nombre", "zona"]),
    categorias: mergeUnique(base.categorias, scale.categorias, ["categoria_id", "categoria_nombre"]),
    conceptos: mergeUnique(base.conceptos, scale.conceptos, ["concepto_id", "nombre"]),
    escalas: (scale.escalas || []).length ? scale.escalas : base.escalas,
    adicionales: mergeUnique(base.adicionales, scale.adicionales, ["adicional_id", "adicional_nombre"])
  }, { fallbackName: draftName });
}

function mergeTokenUsage(...usages) {
  return usages.filter(Boolean).reduce((acc, usage) => ({
    promptTokenCount: (acc.promptTokenCount || 0) + (usage.promptTokenCount || 0),
    candidatesTokenCount: (acc.candidatesTokenCount || 0) + (usage.candidatesTokenCount || usage.outputTokenCount || 0),
    totalTokenCount: (acc.totalTokenCount || 0) + (usage.totalTokenCount || 0)
  }), {});
}

async function requestConventionOnce({ apiKey, model, cctMarkdown, scaleMarkdown, cctPdf, scalePdf, draftName, notes }) {
  const conventionResult = await requestConventionStructureOnce({ apiKey, model, cctMarkdown, cctPdf, draftName, notes });
  const baseCategories = conventionResult.parsed?.categorias || [];
  const baseConcepts = conventionResult.parsed?.conceptos || [];
  const scaleResult = await requestScaleStructureOnce({ apiKey, model, scaleMarkdown, scalePdf, draftName, notes, baseCategories, baseConcepts });
  const merged = mergeExcelConventionParts(conventionResult.parsed, scaleResult.parsed, { draftName });
  console.log(`[CCT merge] convenio: categorias=${conventionResult.parsed.categorias?.length || 0} conceptos=${conventionResult.parsed.conceptos?.length || 0} escalas=${conventionResult.parsed.escalas?.length || 0}`);
  console.log(`[CCT merge] escala: categorias=${scaleResult.parsed.categorias?.length || 0} conceptos=${scaleResult.parsed.conceptos?.length || 0} escalas=${scaleResult.parsed.escalas?.length || 0}`);
  console.log(`[CCT merge] final: categorias=${merged.categorias?.length || 0} conceptos=${merged.conceptos?.length || 0} escalas=${merged.escalas?.length || 0}`);
  const parsedConvention = merged;
  if (!hasExtractedConventionStructure(parsedConvention)) {
    throw new GeminiConventionError("Gemini no extrajo datos estructurables del convenio actual.", {
      status: 422,
      model,
      code: "EMPTY_STRUCTURE"
    });
  }
  return {
    parsedConvention,
    tokenUsage: mergeTokenUsage(conventionResult.tokenUsage, scaleResult.tokenUsage)
  };
}

function hasExcelSalaryValues(convention = {}) {
  return (convention.escalas || []).some((scale) => (
    (scale.valores || []).some((value) => value.valor !== null && value.valor !== undefined && value.valor !== "")
  ));
}

function hasExtractedConventionStructure(convention = {}) {
  return Boolean(
    (convention.categorias || []).length
    || (convention.conceptos || []).length
    || (convention.adicionales || []).length
    || (convention.ambitos || []).length
    || (convention.escalas || []).some((scale) => (scale.valores || []).length)
  );
}

const { GoogleGenAI } = require("@google/genai");

function chunkText(text, chunkSize = 1500, overlap = 300) {
  if (!text) return [];
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + chunkSize));
    i += chunkSize - overlap;
  }
  return chunks;
}

async function generateEmbeddings(texts, apiKey) {
  const ai = new GoogleGenAI({ apiKey });
  const embeddings = [];
  for (const text of texts) {
    try {
      const response = await ai.models.embedContent({
        model: "gemini-embedding-001",
        contents: text
      });
      embeddings.push(response.embeddings[0].values);
    } catch (e) {
      console.warn("Error embedding text chunk", e.message);
      embeddings.push(new Array(768).fill(0));
    }
  }
  return embeddings;
}

function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function retrieveContext(query, chunks, embeddings, apiKey, topK = 15) {
  if (!chunks.length) return "";
  const ai = new GoogleGenAI({ apiKey });
  let queryEmbedding;
  try {
    const response = await ai.models.embedContent({
      model: "gemini-embedding-001",
      contents: query
    });
    queryEmbedding = response.embeddings[0].values;
  } catch (e) {
    console.warn("Error embedding query", e.message);
    return chunks.slice(0, topK).join("\n\n---\n\n");
  }

  const scored = chunks.map((chunk, i) => ({
    chunk,
    score: cosineSimilarity(queryEmbedding, embeddings[i])
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map(s => s.chunk).join("\n\n---\n\n");
}

async function extractConventionFromPdfs({ apiKey, model, fallbackModels, cctPdf, scalePdf, scalePdfs = [], draftName, notes, globalLaborLawPdf }) {
  const allScalePdfs = scalePdfs.length ? scalePdfs : (scalePdf ? [scalePdf] : []);

  console.log(`[CCT RAG] Iniciando extraccion RAG. CCT: ${cctPdf ? "Si" : "No"}, Escalas: ${allScalePdfs.length}`);

  let cctText = await extractPdfText(cctPdf);
  if (globalLaborLawPdf) {
    const laborLawText = await extractPdfText(globalLaborLawPdf);
    if (laborLawText) {
      cctText = [cctText, laborLawText].filter(Boolean).join("\n\n---\n\nLEY DE TRABAJO APLICABLE (CONTEXTO BASE):\n\n");
    }
  }

  const scaleText = (await Promise.all(allScalePdfs.map(extractPdfText))).filter(Boolean).join("\n\n");

  let cctContext = "";
  if (cctText) {
    const cctChunks = chunkText(cctText, 2000, 400);
    console.log(`[CCT RAG] CCT dividido en ${cctChunks.length} chunks. Generando embeddings...`);
    const cctEmbeddings = await generateEmbeddings(cctChunks, apiKey);
    const cctQuery = "Extraer categorias salariales, adicionales, jornada laboral, sumas no remunerativas y reglas de antiguedad o presentismo. Estructurar para " + (draftName || "convenio") + " " + (notes || "");
    cctContext = await retrieveContext(cctQuery, cctChunks, cctEmbeddings, apiKey, 15);
  }

  // Para las escalas salariales evitamos RAG porque las tablas numéricas pierden semántica y RAG podría omitir números vitales.
  // Enviamos el texto plano de la escala completo.
  const scaleContext = scaleText || "";

  const models = geminiModelList(model, fallbackModels);
  const errors = [];

  for (const currentModel of models) {
    try {
      console.log(`[CCT RAG] Consultando a Gemini (${currentModel}) con contextos RAG reducidos...`);
      const result = await requestConventionOnce({
        apiKey,
        model: currentModel,
        cctMarkdown: `Contexto recuperado CCT (RAG):\n${cctContext}`,
        scaleMarkdown: `Contexto recuperado Escala (RAG):\n${scaleContext}`, 
        cctPdf: null, 
        scalePdf: null,
        draftName,
        notes
      });

      return {
        parsedConvention: result.parsedConvention || result,
        tokenUsage: result.tokenUsage,
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
  if (last.code === "EMPTY_STRUCTURE") {
    throw new GeminiConventionError("Gemini no extrajo datos estructurables del convenio usando RAG.", {
      status: 422,
      model: last.model,
      code: "EMPTY_STRUCTURE",
      modelsTried: errors.map((item) => item.model)
    });
  }
  if (last.code === "INVALID_JSON") {
    throw new GeminiConventionError("Gemini devolvio JSON invalido.", {
      status: 502,
      model: last.model,
      code: "INVALID_JSON",
      modelsTried: errors.map((item) => item.model)
    });
  }
  throw new GeminiConventionError("Gemini esta con alta demanda.", {
    status: 503,
    model: last.model,
    code: "MODEL_OVERLOADED",
    modelsTried: errors.map((item) => item.model)
  });
}

module.exports = {
  GeminiConventionError,
  extractConventionFromPdfs,
  normalizeConvention,
  buildConventionPrompt,
  conventionAttachmentParts,
  UNIVERSAL_CONVENTION_TEMPLATE
};
