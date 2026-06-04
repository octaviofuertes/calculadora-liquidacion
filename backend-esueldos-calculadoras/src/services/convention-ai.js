const { geminiModelList } = require("../gemini-config");

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
  const source = parsed.convention || parsed.convenio || parsed;
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
    "extraction"
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
  const template = JSON.parse(JSON.stringify(UNIVERSAL_CONVENTION_TEMPLATE));
  return { convention: template };
}

function conventionExtractionContractForPrompt() {
  return {
    convention: {
      identification: {
        id: "string slug estable extraido del documento",
        name: "string nombre legal o actividad extraida",
        shortName: "string",
        source: "string CCT, acta o resolucion detectada",
        type: "monthly | daily | hourly | empty"
      },
      periods: [{
        id: "string YYYY-MM",
        label: "string",
        effectiveFrom: "string fecha o empty",
        effectiveTo: "string fecha o empty",
        sourceFileName: "string"
      }],
      zones: [{
        id: "string",
        label: "string",
        coef: "number | null",
        description: "string"
      }],
      categories: [{
        id: "string",
        label: "string categoria laboral",
        group: "string agrupador o jornada",
        description: "string",
        zone: "string id zona o empty",
        monthly: "number | null",
        day: "number | null",
        hourly: "number | null",
        monthlyByPeriod: { "YYYY-MM": "number" },
        dayByPeriod: { "YYYY-MM": "number" },
        hourlyByPeriod: { "YYYY-MM": "number" },
        nonRem: { "YYYY-MM": "number" },
        normalWeeklyHours: "number | null",
        normalDailyHours: "number | null",
        legalReferences: ["string"],
        notes: ["string"]
      }],
      rules: {
        salaryType: "monthly | daily | hourly | empty",
        monthDivisor: "number | null",
        dayDivisor: "number | null",
        hourDivisor: "number | null",
        weeklyHours: "number | null",
        vacationDivisor: "number | null",
        licenses: ["object con regla extraida y evidencia"],
        legalReferences: ["string"]
      },
      liquidationModel: {
        rules: {
          seniority: {
            enabled: "boolean | null",
            mode: "string",
            percentPerYear: "number | null",
            capYears: "number | null",
            base: "string",
            legalReferences: ["string"]
          },
          presentism: {
            enabled: "boolean | null",
            percent: "number | null",
            base: "string",
            requiresNoUnjustifiedAbsence: "boolean | null",
            legalReferences: ["string"]
          },
          nonRemunerativeScale: {
            enabled: "boolean | null",
            seniorityEnabled: "boolean | null",
            seniorityPercentPerYear: "number | null",
            seniorityCapYears: "number | null",
            presentismEnabled: "boolean | null",
            presentismPercent: "number | null",
            presentismRequiresNoUnjustifiedAbsence: "boolean | null",
            subjectToHealthInsurance: "boolean | null",
            subjectToUnion: "boolean | null",
            legalReferences: ["string"]
          },
          overtime: {
            enabled: "boolean | null",
            divisor: "number | null",
            rate50: "number | null",
            rate100: "number | null",
            legalReferences: ["string"]
          }
        },
        concepts: [{
          id: "string",
          label: "string",
          group: "string",
          inputType: "checkbox | number",
          rowType: "remunerative | nonRemunerative",
          calculation: "fixed | percentOfBase | amountPerUnit",
          percent: "number | null",
          amount: "number | null",
          amountByPeriod: { "YYYY-MM": "number" },
          unitAmount: "number | null",
          unitAmountByPeriod: { "YYYY-MM": "number" },
          base: "string",
          defaultValue: "boolean | number",
          requiresHumanValidation: "boolean",
          legalReferences: ["string"],
          sourceFiles: ["string"],
          detail: "string evidencia",
          notes: ["string"]
        }],
        deductions: [{
          id: "string",
          label: "string descuento del trabajador",
          calculation: "fixed | percentOfBase",
          percent: "number | null",
          amount: "number | null",
          amountByPeriod: { "YYYY-MM": "number" },
          base: "string",
          defaultValue: "boolean",
          appliesWhen: "string",
          requiresHumanValidation: "boolean",
          legalReferences: ["string"],
          sourceFiles: ["string"],
          detail: "string evidencia"
        }],
        retentions: [{
          id: "string",
          label: "string retencion",
          calculation: "fixed | percentOfBase",
          percent: "number | null",
          amount: "number | null",
          amountByPeriod: { "YYYY-MM": "number" },
          base: "string",
          defaultValue: "boolean",
          appliesWhen: "string",
          requiresHumanValidation: "boolean",
          legalReferences: ["string"],
          sourceFiles: ["string"],
          detail: "string evidencia"
        }]
      }
    }
  };
}

function buildConventionPrompt({ draftName, notes }) {
  return [
    "Sos leIA, contadora laboral senior de Argentina e ingeniera de sistemas especialista en liquidacion de sueldos multiconvenio.",
    "Estructura el convenio desde cero. Usa exclusivamente el contenido de los archivos adjuntos como fuente factual. No uses catalogos, convenios precargados, borradores previos, versiones archivadas ni rastros de convenios eliminados.",
    "La plantilla incluida al final es solo un contrato de campos vacios: no contiene valores legales ni contables. No completes campos por analogia con otros convenios. Si un dato no aparece en los adjuntos, dejalo vacio o null y registralo en warnings cuando requiera revision.",
    "Tu tarea es leer por separado el CCT y la escala salarial adjunta para generar un JSON de convenio COMPLETO, auditable y ejecutable por eSueldos. No limites la extraccion de conceptos a la escala: el CCT tambien puede definir haberes remunerativos y no remunerativos.",
    "No escribas explicaciones fuera del JSON. No inventes montos, porcentajes ni articulos. Si un dato numerico no esta claro, usa null, marca requiresHumanValidation=true y agrega una warning. Usa 0 solamente cuando el documento indique expresamente cero.",
    "METODO OBLIGATORIO: primero recorre todas las paginas de cada adjunto. Despues extrae por separado el CCT y la escala. Finalmente concilia ambos resultados en un unico JSON. No devuelvas arrays vacios si existen filas, importes, porcentajes o reglas legibles en cualquiera de los archivos.",
    "DEL CCT O ACTA extrae: identificacion legal, actividad, alcance, vigencia, categorias si aparecen, jornada, divisores, antiguedad, presentismo, horas extra, licencias, adicionales, haberes remunerativos, haberes no remunerativos, descuentos del trabajador, retenciones, contribuciones del empleador, condiciones de aplicacion y referencias de articulo.",
    "DE LA ESCALA SALARIAL extrae: periodos, zonas, jornadas, categorias laborales, basicos mensuales, jornales, valores hora, importes no remunerativos por categoria y periodo, y tablas separadas de adicionales. Lee encabezados combinados y conserva la relacion correcta entre fila, columna, zona y mes.",
    "REGLA CRITICA DE NO REMUNERATIVOS: si el CCT, acta o escala indica que una suma no remunerativa genera antiguedad no remunerativa o presentismo no remunerativo, registra sus reglas separadas en liquidationModel.rules.nonRemunerativeScale: seniorityEnabled, seniorityPercentPerYear, seniorityCapYears, presentismEnabled, presentismPercent y presentismRequiresNoUnjustifiedAbsence. No las mezcles con antiguedad o presentismo remunerativos. Conserva evidencia y referencias legales.",
    "REGLA CRITICA DE ZONA GENERAL: si una tabla salarial muestra General, Base, Zona general, Zona base o Sin adicional zonal, registrala siempre en zones como { id: \"general\", label: \"General\", coef: 1 }. No la omitas aunque el coeficiente 1 sea implicito. Vincula sus filas con zone: \"general\".",
    "CONCILIACION: categories contiene exclusivamente categorias laborales con su escala basica. Los adicionales, pluses, viaticos, kilometrajes, premios, sumas fijas y porcentajes van en liquidationModel.concepts aunque provengan de una tabla separada de la escala. No conviertas adicionales en categorias.",
    "El JSON debe servir para mensual, jornal, hora, zonas, coeficientes, categorias, escalas por periodo, no remunerativos, antiguedad, presentismo, horas extra, feriados, vacaciones, adicionales, aportes del trabajador, contribuciones del empleador y auditoria humana.",
    "Usa schemaVersion esueldos-convenio-universal-v1 y calculationMode generic-v1. Los periodos deben ser YYYY-MM. Los ids deben ser estables, sin espacios ni acentos.",
    "No uses salaryType monthly por defecto. Si el CCT o la escala habla de jornal, dia, changa, valor dia o pago por dia, usa daily y completa day/dayByPeriod. Si habla de hora o valor hora, usa hourly y completa hourly/hourlyByPeriod. Usa monthly solo cuando el basico sea mensual.",
    "Toda categoria debe traer monthly, day u hourly, y si la escala trae varios meses usa monthlyByPeriod/dayByPeriod/hourlyByPeriod y nonRem por periodo.",
    "Contrato de categories: cada fila puede incluir id, label, group, description, monthly, day, hourly, monthlyByPeriod, dayByPeriod, hourlyByPeriod, nonRem, zone, normalWeeklyHours, normalDailyHours, legalReferences y notes. Inclui solo campos respaldados por los adjuntos.",
    "Todo concepto variable detectado en el CCT o en la escala debe ir en liquidationModel.concepts con inputType checkbox/number, rowType remunerative/nonRemunerative/deduction, calculation fixed/percentOfBase/amountPerUnit, base, tratamiento de aportes, condiciones, referencias legales, procedencia documental y detalle.",
    "Contrato de conceptos, deducciones y retenciones: cada fila puede incluir id, label, group, inputType, rowType, calculation, percent, amount, amountByPeriod, unitAmount, unitAmountByPeriod, base, defaultValue, appliesWhen, requiresHumanValidation, conditions, legalReferences, source, sourceFiles, detail y notes. Inclui solo campos respaldados por los adjuntos.",
    "Las deducciones propias del trabajador van en liquidationModel.deductions y se muestran como novedades del mes. Las retenciones propias del convenio, embargos u otras retenciones identificadas van en liquidationModel.retentions: no las mezcles con haberes ni contribuciones del empleador. Usa defaultValue true si normalmente aplican y false si son eventuales. Las contribuciones propias del empleador van en liquidationModel.employerContributions. No agregues Jubilacion/PAMI/Obra Social/Ganancias generales porque eSueldos ya las calcula.",
    "Extrae las reglas de liquidacion con su evidencia: jornada, divisores, antiguedad, presentismo, horas extra, feriados, licencias, vacaciones, bases de calculo, condiciones y reglas de validacion. Guarda reglas generales en rules y reglas ejecutables detalladas en liquidationModel.rules. No inventes una regla a partir de texto ambiguo: conserva el texto en notes o warnings y marca requiresHumanValidation.",
    "Inclui auditChecklist, validation, employeeRequirements y notes para que el liquidador humano pueda auditar el convenio antes de aprobarlo.",
    "Si los adjuntos son imagenes o contienen tablas representadas visualmente, interpretalos directamente como agente IA multimodal: observa encabezados, filas, columnas, notas y relaciones espaciales antes de estructurar. Clasifica los bloques en identificacion y alcance, categorias, escalas salariales, haberes remunerativos, haberes no remunerativos, descuentos, retenciones, jornada laboral, licencias y reglas de validacion.",
    "Cuando la escala traiga una tabla separada de adicionales, no mezcles sus filas con categories. Lleva cada adicional a liquidationModel.concepts indicando rowType, calculation fixed/percentOfBase/amountPerUnit, base, importe o porcentaje, unidad y tratamiento remunerativo.",
    "El backend construira ademas structuredModel como molde auditable del convenio, preservando los campos ejecutables de esta plantilla.",
    "CONTRATO DE TIPOS PARA COMPLETAR. Es una descripcion, no copies literalmente sus textos:",
    JSON.stringify(conventionExtractionContractForPrompt(), null, 2),
    "Devolve JSON valido con esta forma exacta y completa:",
    JSON.stringify(universalConventionTemplateForPrompt(), null, 2),
    draftName ? `Etiqueta informativa escrita por el usuario: ${draftName}. No la uses como evidencia legal ni como reemplazo de la identificacion extraida de los adjuntos.` : "Etiqueta informativa escrita por el usuario: sin etiqueta.",
    notes ? `Notas informativas del usuario: ${notes}. No las uses como reemplazo de evidencia documental.` : "Notas informativas del usuario: sin notas."
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

async function requestConventionOnce({ apiKey, model, cctMarkdown, scaleMarkdown, draftName, notes }) {
  const parts = [{ text: buildConventionPrompt({ draftName, notes }) }];
  if (cctMarkdown) {
    parts.push({ text: `Texto del CCT extraído en formato Markdown:\n\n${cctMarkdown}` });
  }
  if (scaleMarkdown) {
    parts.push({ text: `Texto de la escala salarial extraída en formato Markdown:\n\n${scaleMarkdown}` });
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
  return normalizeConvention(parseGeminiJson(text), { fallbackName: draftName });
}

async function extractConventionFromPdfs({ apiKey, model, fallbackModels, cctPdf, scalePdf, draftName, notes }) {
  const fs = require("fs");
  const path = require("path");

  let cctRaw = "";
  let scaleRaw = "";

  if (cctPdf) {
    try {
      cctRaw = await extractPdfTextLocal(cctPdf);
    } catch (err) {
      console.error("Error al extraer texto local del CCT:", err.message);
    }
  }
  if (scalePdf) {
    try {
      scaleRaw = await extractPdfTextLocal(scalePdf);
    } catch (err) {
      console.error("Error al extraer texto local de la escala de CCT:", err.message);
    }
  }

  const cctMarkdown = convertRawTextToMarkdown(cctRaw);
  const scaleMarkdown = convertRawTextToMarkdown(scaleRaw);

  // Debug logging requested by user
  console.log("\n==================================================");
  console.log(`[DEBUG] CCT PDF convertido a Markdown (${cctPdf?.sourceFileName || "sin CCT"}):`);
  console.log("==================================================");
  console.log(cctMarkdown.slice(0, 1500) + (cctMarkdown.length > 1500 ? "\n... [TRUNCADO PARA CONSOLA]" : ""));
  console.log("==================================================");
  console.log(`[DEBUG] Escala CCT PDF convertida a Markdown (${scalePdf?.sourceFileName || "sin escala"}):`);
  console.log("==================================================");
  console.log(scaleMarkdown);
  console.log("==================================================\n");

  // Save to debug files inside uploads
  try {
    const uploadDir = path.resolve(__dirname, "../uploads");
    fs.mkdirSync(uploadDir, { recursive: true });

    if (cctMarkdown) {
      const cctDebugPath = path.join(uploadDir, "debug-cct.md");
      fs.writeFileSync(cctDebugPath, cctMarkdown, "utf8");
      console.log(`[DEBUG] Markdown de CCT guardado en: ${cctDebugPath}`);
    }
    if (scaleMarkdown) {
      const scaleDebugPath = path.join(uploadDir, "debug-escala-cct.md");
      fs.writeFileSync(scaleDebugPath, scaleMarkdown, "utf8");
      console.log(`[DEBUG] Markdown de escala de CCT guardado en: ${scaleDebugPath}`);
    }
  } catch (err) {
    console.error("Error al guardar archivos debug de convenio:", err.message);
  }

  const models = geminiModelList(model, fallbackModels);
  const errors = [];
  const tryLocalFallback = (aiError) => {
    const context = { draftName, notes, cctPdf, scalePdf, cctText: cctMarkdown, scaleText: scaleMarkdown, aiError };
    if (looksLikeHairdressers730(context)) return buildHairdressersConvention(context);
    if (looksLikeCommerce130(context)) return buildCommerceConvention(context);
    if (looksLikePharmacyMendoza(context)) return buildPharmacyConvention(context);
    return buildGenericConventionFromScale(context);
  };

  for (const currentModel of models) {
    try {
      const result = await requestConventionOnce({
        apiKey,
        model: currentModel,
        cctMarkdown,
        scaleMarkdown,
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
        const localConvention = tryLocalFallback(error.message);
        if (localConvention) {
          return {
            parsedConvention: localConvention,
            tokenUsage: null,
            model: localConvention.extraction?.model || "local-pdf-parse",
            modelsTried: errors.map((item) => item.model)
          };
        }
        error.modelsTried = errors.map((item) => item.model);
        throw error;
      }
    }
  }

  const last = errors[errors.length - 1] || {};
  const localConvention = tryLocalFallback(last.message);
  if (localConvention) {
    return {
      parsedConvention: localConvention,
      tokenUsage: null,
      model: localConvention.extraction?.model || "local-pdf-parse",
      modelsTried: errors.map((item) => item.model)
    };
  }
  throw new GeminiConventionError("Gemini esta con alta demanda y no pudo estructurar el convenio en este momento.", {
    status: 503,
    model: last.model,
    code: "MODEL_OVERLOADED",
    modelsTried: errors.map((item) => item.model)
  });
}

function asciiFold(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

async function extractPdfTextLocal(pdfFile) {
  if (!pdfFile?.buffer) return "";
  const pdfParse = require("pdf-parse");
  const data = await pdfParse(pdfFile.buffer);
  return String(data.text || "");
}

async function extractPdfLayoutTextLocal(pdfFile) {
  if (!pdfFile?.buffer) return "";
  const pdfParse = require("pdf-parse");
  const data = await pdfParse(pdfFile.buffer, {
    pagerender: async (pageData) => {
      const content = await pageData.getTextContent({
        normalizeWhitespace: false,
        disableCombineTextItems: false
      });
      const rows = [];
      content.items.forEach((item) => {
        const y = Math.round(item.transform[5]);
        let row = rows.find((candidate) => Math.abs(candidate.y - y) <= 1);
        if (!row) {
          row = { y, items: [] };
          rows.push(row);
        }
        row.items.push({ x: item.transform[4], text: item.str });
      });
      return rows
        .sort((left, right) => right.y - left.y)
        .map((row) => row.items.sort((left, right) => left.x - right.x).map((item) => item.text).join(""))
        .join("\n");
    }
  });
  return String(data.text || "");
}

function looksLikeCommerce130({ draftName, notes, cctText, scaleText, cctPdf, scalePdf }) {
  const haystack = asciiFold([
    draftName,
    notes,
    cctPdf?.sourceFileName,
    scalePdf?.sourceFileName,
    cctText.slice(0, 8000),
    scaleText.slice(0, 8000)
  ].join(" "));
  return haystack.includes("130/75")
    || haystack.includes("13075")
    || haystack.includes("EMPLEADOS DE COMERCIO")
    || haystack.includes("FAECYS");
}

const COMMERCE_MONTHS = {
  ENERO: "01",
  FEBRERO: "02",
  MARZO: "03",
  ABRIL: "04",
  MAYO: "05",
  JUNIO: "06",
  JULIO: "07",
  AGOSTO: "08",
  SEPTIEMBRE: "09",
  SETIEMBRE: "09",
  OCTUBRE: "10",
  NOVIEMBRE: "11",
  DICIEMBRE: "12"
};

function parseArgMoney(value) {
  const normalized = normalizeMoney(value);
  return normalized === null ? 0 : normalized;
}

function takeCommerceAmount(value) {
  const rest = String(value || "").replace(/\s+/g, "");
  if (!rest) return { value: 0, rest: "" };
  if (rest[0] === "0" && rest[1] !== ".") {
    return { value: 0, rest: rest.slice(1) };
  }
  const match = rest.match(/^\d{1,3}(?:\.\d{3})+(?:,\d{2})?/);
  if (!match) return { value: 0, rest };
  return { value: parseArgMoney(match[0]), rest: rest.slice(match[0].length) };
}

function parseCommerceScaleRow(line) {
  const match = asciiFold(line).match(/^(ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|SETIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)\s*\/\s*(20\d{2})/);
  if (!match) return null;
  const period = `${match[2]}-${COMMERCE_MONTHS[match[1]]}`;
  const rest = String(line || "").replace(/^.*\/\s*20\d{2}/i, "").replace(/\s+/g, "");
  const basic = takeCommerceAmount(rest);
  const nonRemOne = takeCommerceAmount(basic.rest);
  const nonRemTwo = takeCommerceAmount(nonRemOne.rest);
  const total = takeCommerceAmount(nonRemTwo.rest);
  return {
    period,
    basic: basic.value,
    nonRem: nonRemOne.value + nonRemTwo.value,
    total: total.value,
    residue: total.rest
  };
}

function isCommerceHeaderNoise(line) {
  const clean = asciiFold(line).replace(/\s+/g, " ").trim();
  return !clean
    || /^\d+$/.test(clean)
    || clean.startsWith("FAECYS")
    || clean.startsWith("REMUNERACIONES")
    || clean.startsWith("DE ABRIL")
    || clean.startsWith("ACUERDO")
    || clean.startsWith("CON LA")
    || clean.startsWith("PRESENTISMO")
    || clean.startsWith("ANTIGUEDAD")
    || clean.startsWith("NO REMUNERATIVAS")
    || clean.startsWith("SALUDOS");
}

function commerceTitle(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/\bY\b/g, "y");
}

function normalizeCommerceGroup(value) {
  const folded = asciiFold(value).replace(/\s+/g, " ").trim();
  if (folded.includes("JORNADA DE 6 HORAS")) return "Jornada de 6 horas";
  if (folded.includes("MAESTRANZA")) return "Maestranza";
  if (folded.includes("ADMINISTRATIVO")) return "Administrativo";
  if (folded.includes("CAJER")) return "Cajeros";
  if (folded === "AUXILIAR" || folded.includes("PERSONAL AUXILIAR")) return "Auxiliar";
  if (folded.includes("AUXILIAR ESPECIALIZADO")) return "Auxiliar Especializado";
  if (folded.includes("VENDEDOR")) return "Vendedor";
  return commerceTitle(value || "Categoria");
}

function parseCommerceHeader(lines, index) {
  const context = lines.slice(Math.max(0, index - 8), index).filter((line) => !isCommerceHeaderNoise(line));
  const foldedContext = context.map(asciiFold);
  const minor = foldedContext.some((line) => line.includes("MENORES"));
  const ageLineIndex = foldedContext.findIndex((line) => line.includes("ANOS"));
  const ageLine = ageLineIndex >= 0 ? foldedContext[ageLineIndex] : "";
  const age = ageLine.match(/\b(16|17)\s*ANOS\b/)?.[1] || "";
  let letter = context.find((line) => /^[A-F]$/i.test(String(line).trim()))?.trim().toUpperCase() || "";
  letter = ageLine.match(/:\s*([A-F])\b/)?.[1] || letter;

  const groupCandidates = context.filter((line) => {
    const folded = asciiFold(line);
    return !folded.includes("MENORES")
      && !folded.includes("ANOS")
      && !/^[A-F]$/.test(folded.trim());
  });
  let group = normalizeCommerceGroup(groupCandidates[groupCandidates.length - 1] || context[context.length - 2] || "Categoria");
  if (minor && !groupCandidates.length) {
    group = normalizeCommerceGroup(context.find((line) => asciiFold(line).includes("JORNADA DE")) || "Jornada de 6 horas");
  }

  const label = minor
    ? `Menores ${age || ""} años - ${commerceTitle(group)}${letter ? ` ${letter}` : ""}`.replace(/\s+/g, " ").trim()
    : `${commerceTitle(group)}${letter ? ` ${letter}` : ""}`.replace(/\s+/g, " ").trim();
  return label;
}

function parseCommerceCategories(scaleText) {
  const lines = String(scaleText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const compactCategories = parseCompactCommerceCategories(lines);
  if (compactCategories.categories.length) return compactCategories;
  const categories = [];
  const warnings = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].includes("BASICOAUM")) continue;
    const label = parseCommerceHeader(lines, index);
    const rows = [];
    for (let rowIndex = index + 1; rowIndex < Math.min(lines.length, index + 10); rowIndex += 1) {
      const parsed = parseCommerceScaleRow(lines[rowIndex]);
      if (parsed) rows.push(parsed);
    }
    if (rows.length < 2) continue;

    rows.forEach((row) => {
      if (row.total && Math.abs((row.basic + row.nonRem) - row.total) > 2) {
        warnings.push(`Revisar total de ${label} ${row.period}: basico + no remunerativo no coincide con total.`);
      }
    });

    const monthlyByPeriod = {};
    const nonRem = {};
    rows.forEach((row) => {
      monthlyByPeriod[row.period] = row.basic;
      nonRem[row.period] = row.nonRem;
    });
    const orderedPeriods = rows.map((row) => row.period).sort();
    const lastPeriod = orderedPeriods[orderedPeriods.length - 1];
    categories.push({
      id: normalizeText(label),
      label,
      monthly: monthlyByPeriod[lastPeriod] || rows[rows.length - 1]?.basic || 0,
      monthlyByPeriod,
      nonRem,
      notes: ["Basico remunerativo tomado de circular FAECYS acuerdo 04/2026."]
    });
  }

  return { categories, warnings };
}

const COMMERCE_PERIOD_MONTHS = {
  ENE: "01",
  ENERO: "01",
  FEB: "02",
  FEBRERO: "02",
  MAR: "03",
  MARZO: "03",
  ABR: "04",
  ABRIL: "04",
  MAY: "05",
  MAYO: "05",
  JUN: "06",
  JUNIO: "06",
  JUL: "07",
  JULIO: "07",
  AGO: "08",
  AGOSTO: "08",
  SEP: "09",
  SEPTIEMBRE: "09",
  SET: "09",
  SETIEMBRE: "09",
  OCT: "10",
  OCTUBRE: "10",
  NOV: "11",
  NOVIEMBRE: "11",
  DIC: "12",
  DICIEMBRE: "12"
};

function commercePeriodsFromLines(lines) {
  for (const line of lines) {
    const periods = [...asciiFold(line).matchAll(/\b(ENE(?:RO)?|FEB(?:RERO)?|MAR(?:ZO)?|ABR(?:IL)?|MAY(?:O)?|JUN(?:IO)?|JUL(?:IO)?|AGO(?:STO)?|SEP(?:TIEMBRE)?|SET(?:IEMBRE)?|OCT(?:UBRE)?|NOV(?:IEMBRE)?|DIC(?:IEMBRE)?)\s*\/?\s*(20)?(\d{2})\b/g)]
      .map((match) => `${match[2] || "20"}${match[3]}-${COMMERCE_PERIOD_MONTHS[match[1]]}`)
      .filter(Boolean);
    if (periods.length === 3 && new Set(periods).size === 3) return periods;
  }
  const year = String(lines.join(" ").match(/PARITARIAS?\s+(20\d{2})/i)?.[1] || new Date().getFullYear());
  return [`${year}-04`, `${year}-05`, `${year}-06`];
}

function compactCommerceCategoryRow(line, periods) {
  const match = String(line || "").match(/^(.+?)(?=\d{1,3}(?:\.\s*\d{3})+)/);
  if (!match) return null;
  const rawLabel = match[1].replace(/["“”]/g, "").replace(/\s+/g, " ").trim();
  const foldedLabel = asciiFold(rawLabel);
  if (!/(MAESTRANZA|ADMINISTR|CAJER|AUXILIAR|VENDEDOR)/.test(foldedLabel)) return null;
  let rest = String(line).slice(match[1].length);
  const values = [];
  for (let index = 0; index < periods.length * 4; index += 1) {
    const parsed = takeCommerceAmount(rest);
    if (!parsed.value || parsed.rest === rest) return null;
    values.push(parsed.value);
    rest = parsed.rest;
  }
  const label = commerceTitle(rawLabel).replace(/Administratativo/gi, "Administrativo");
  const group = normalizeCommerceGroup(label.replace(/\s+[A-F]$/i, ""));
  const monthlyByPeriod = {};
  const nonRem = {};
  periods.forEach((period, index) => {
    const offset = index * 4;
    monthlyByPeriod[period] = values[offset];
    nonRem[period] = values[offset + 1] + values[offset + 2] + values[offset + 3];
  });
  const lastPeriod = periods[periods.length - 1];
  return {
    id: normalizeText(label),
    label,
    group,
    monthly: monthlyByPeriod[lastPeriod],
    monthlyByPeriod,
    nonRem,
    notes: ["Basico remunerativo y sumas fijas no remunerativas tomados de escala FAECYS."]
  };
}

function parseCompactCommerceCategories(lines) {
  const periods = commercePeriodsFromLines(lines);
  const categories = lines.map((line) => compactCommerceCategoryRow(line, periods)).filter(Boolean);
  const warnings = [];
  if (categories.length && categories.length < 21) {
    warnings.push(`La escala de Comercio se reconstruyo parcialmente: se detectaron ${categories.length} de 21 categorias esperadas.`);
  }
  return { categories, warnings, periods };
}

const COMMERCE_ADDITIONAL_ROWS = [
  { test: /^ART\.?\s*23\s+ARMADO DE VIDRIERA/i, id: "adicional-armado-vidriera", label: "Adicional Armado de Vidriera" },
  { test: /^ART\.?\s*30\s+CAJEROS?\s+["“]?A["”]?\s+Y\s+["“]?C["”]?/i, id: "compensacion-faltantes-caja-cajeros-a-c", label: "Compensacion Faltantes de Caja (Cajeros A y C)" },
  { test: /^ART\.?\s*30\s+CAJEROS?\s+["“]?B["”]?/i, id: "compensacion-faltantes-caja-cajero-b", label: "Compensacion Faltantes de Caja (Cajero B)" },
  { test: /^ART\.?\s*18\s+AC\.?\s*JUN\/11/i, id: "adicional-art-18-ac-jun-11", label: "Adicional Art. 18 Ac. Jun/11" },
  { test: /^ART\.?\s*36\s+AYUD\.?\s*CHOF\.?\s*1/i, id: "adicional-ayudante-chofer-hasta-100-km", label: "Adicional Ayudante Chofer (hasta 100 Km)", amountPerUnit: true },
  { test: /^ART\.?\s*36\s+AYUD\.?\s*CHOF\.?\s*\+/i, id: "adicional-ayudante-chofer-mas-100-km", label: "Adicional Ayudante Chofer (mas de 100 Km)", amountPerUnit: true },
  { test: /^ART\.?\s*36\s+CHOFER\s*1/i, id: "adicional-chofer-hasta-100-km", label: "Adicional Chofer (hasta 100 Km)", amountPerUnit: true },
  { test: /^ART\.?\s*36\s+CHOFER\s*\+/i, id: "adicional-chofer-mas-100-km", label: "Adicional Chofer (mas de 100 Km)", amountPerUnit: true }
];

function parseCommerceScaleAdditionals(scaleText, periods) {
  const lines = String(scaleText || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const concepts = [];
  COMMERCE_ADDITIONAL_ROWS.forEach((definition) => {
    const line = lines.find((candidate) => definition.test.test(asciiFold(candidate)));
    if (!line) return;
    const values = moneyValuesFromText(line).slice(0, periods.length);
    if (values.length !== periods.length) return;
    const amountByPeriod = Object.fromEntries(periods.map((period, index) => [period, values[index]]));
    const amount = amountByPeriod[periods[periods.length - 1]];
    concepts.push({
      id: definition.id,
      label: definition.label,
      group: "Adicionales de escala",
      inputType: definition.amountPerUnit ? "number" : "checkbox",
      rowType: "remunerative",
      calculation: definition.amountPerUnit ? "amountPerUnit" : "fixed",
      amount: definition.amountPerUnit ? null : amount,
      amountByPeriod: definition.amountPerUnit ? {} : amountByPeriod,
      unitAmount: definition.amountPerUnit ? amount : null,
      unitAmountByPeriod: definition.amountPerUnit ? amountByPeriod : {},
      base: "",
      defaultValue: 0,
      detail: "Detectado en tabla separada de adicionales de la escala FAECYS. Validar tratamiento antes de aprobar.",
      subjectToSocialSecurity: true,
      requiresHumanValidation: true
    });
  });
  return concepts;
}

function moneyValuesFromText(value) {
  const normalized = String(value || "").replace(/\.\s+(?=\d{3}(?:\D|$))/g, ".");
  return [...normalized.matchAll(/\d{1,3}(?:\.\d{3})+(?:,\d{2})?|\d{1,3},\d{2}/g)].map((match) => parseArgMoney(match[0]));
}

function looksLikePharmacyMendoza({ draftName, notes, cctText, scaleText, cctPdf, scalePdf }) {
  const haystack = asciiFold([
    draftName,
    notes,
    cctPdf?.sourceFileName,
    scalePdf?.sourceFileName,
    cctText.slice(0, 12000),
    scaleText.slice(0, 5000)
  ].join(" "));
  return haystack.includes("429/2005")
    || haystack.includes("429-2005")
    || haystack.includes("CCT 429")
    || haystack.includes("FARMACIA DE MENDOZA")
    || haystack.includes("ASOCIACION DE EMPLEADOS DE FARMACIA DE MENDOZA")
    || haystack.includes("ADEF");
}

const PHARMACY_CATEGORY_ROWS = [
  { test: /^CAT\.?\s*INICIAL\s*"A"/i, id: "inicialA", label: "Categoria inicial A" },
  { test: /^CAT\.?\s*INICIAL\s*"B"/i, id: "inicialB", label: "Categoria inicial B" },
  { test: /^CAJERO/i, id: "cajeroPerfAdmin", label: "Cajero, perfumeria y administrativo" },
  { test: /^EMPL\.?\s*DE\s*FCIA/i, id: "empleadoFarmacia", label: "Empleado de farmacia" },
  { test: /^EMPL\.?\s*ESP\.?\s*DE\s*FCIA/i, id: "empleadoEspFarmacia", label: "Empleado especializado de farmacia" },
  { test: /^FARMAC/i, id: "farmaceutico", label: "Farmaceutico" }
];

const PHARMACY_ADDITIONAL_ROWS = [
  { test: /^ADIC\.?\s*T[ÍI]TULO/i, id: "tituloFarmaceutico", label: "Adicional titulo farmaceutico" },
  { test: /^ADIC\.?\s*ADSCRIP/i, id: "adscripcion", label: "Adicional adscripcion" },
  { test: /^ADIC\.?\s*BLOQUEO/i, id: "bloqueo", label: "Adicional bloqueo direccion tecnica" }
];

function collectRowValues(lines, startIndex, stopTests) {
  const chunks = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const next = lines[index] || "";
    if (stopTests.some((test) => test.test(next))) break;
    chunks.push(next);
  }
  return moneyValuesFromText(chunks.join(" "));
}

function findPharmacyScaleRow(lines, definition, stopDefinitions) {
  const index = lines.findIndex((line) => definition.test.test(line));
  if (index < 0) return null;
  const values = collectRowValues(lines, index, stopDefinitions.map((item) => item.test));
  return { ...definition, values };
}

function parsePharmacyScale(scaleText) {
  const lines = String(scaleText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const allDefinitions = [...PHARMACY_CATEGORY_ROWS, ...PHARMACY_ADDITIONAL_ROWS];
  const periods = [
    { id: "2026-04", label: "Abril 2026" },
    { id: "2026-05", label: "Mayo 2026" },
    { id: "2026-06", label: "Junio 2026" }
  ];
  const categories = [];
  const warnings = [];

  PHARMACY_CATEGORY_ROWS.forEach((definition) => {
    const row = findPharmacyScaleRow(lines, definition, allDefinitions);
    if (!row || row.values.length < 13) {
      warnings.push(`No se pudo leer completa la fila de escala para ${definition.label}.`);
      return;
    }
    const basicApril = row.values[9];
    const nonRemApril = row.values[10];
    const nonRemMay = row.values[11];
    const nonRemJune = row.values[12];
    categories.push({
      id: row.id,
      label: row.label,
      monthly: basicApril,
      monthlyByPeriod: {
        "2026-04": basicApril,
        "2026-05": basicApril,
        "2026-06": basicApril
      },
      nonRem: {
        "2026-04": nonRemApril,
        "2026-05": nonRemMay,
        "2026-06": nonRemJune
      },
      notes: ["Escala vigente desde 1 de abril de 2026."]
    });
  });

  const additionals = {};
  PHARMACY_ADDITIONAL_ROWS.forEach((definition) => {
    const row = findPharmacyScaleRow(lines, definition, allDefinitions);
    if (!row || row.values.length < 11) {
      warnings.push(`No se pudo leer completo el adicional ${definition.label}.`);
      return;
    }
    additionals[definition.id] = {
      label: definition.label,
      monthly: row.values[7],
      nonRem: {
        "2026-04": row.values[8],
        "2026-05": row.values[9],
        "2026-06": row.values[10]
      }
    };
  });

  const contributionLineIndex = lines.findIndex((line) => /oct-25nov-25dic-25/i.test(line));
  const contributionValues = contributionLineIndex >= 0 ? moneyValuesFromText(lines.slice(contributionLineIndex + 1, contributionLineIndex + 3).join(" ")) : [];
  const extraordinaryContribution = {
    "2026-04": contributionValues[6] || 0,
    "2026-05": contributionValues[7] || 0,
    "2026-06": contributionValues[8] || 0
  };

  return { periods, categories, additionals, extraordinaryContribution, warnings };
}

function buildPharmacyConvention({ draftName, notes, cctPdf, scalePdf, scaleText }) {
  const parsedScale = parsePharmacyScale(scaleText);
  if (parsedScale.categories.length < 6) return null;
  const warnings = parsedScale.warnings.filter(Boolean);
  const sourceNotes = [
    "Estructurado con lector local para Farmacia Mendoza CCT 429/2005.",
    "Se toma Basico Abril 2026 como basico vigente para abril, mayo y junio 2026, y los no remunerativos mensuales indicados en la escala.",
    "Las observaciones del CCT se enviaron a auditoria/checklist; las alertas quedan reservadas para faltantes reales de datos.",
    notes
  ].filter(Boolean);

  return normalizeConvention({
    convention: {
      id: "farmacia",
      name: "Farmacia Mendoza - CCT 429/2005",
      shortName: "Farmacia Mendoza",
      source: "CON-CCT-429-2005-A y Escala Abril 2026",
      type: "monthly",
      periods: parsedScale.periods,
      zones: [{ id: "mendoza", label: "Ambito Mendoza", coef: 1 }],
      categories: parsedScale.categories,
      additionals: parsedScale.additionals,
      extraordinaryContribution: parsedScale.extraordinaryContribution,
      rules: {
        weeklyHours: 45,
        insalubreWeeklyHours: 33,
        insalubrePaidWeeklyHours: 45,
        dayDivisor: 30,
        vacationDivisor: 25,
        hourDivisor: 200,
        nightPct: 100,
        cajeroPct: 10,
        tareasAdministrativasPct: 5,
        adminTenurePctInitial: 5,
        adminTenurePctOver2Years: 10,
        perfumeriaPct: 10,
        bikePct: 10,
        languagePct: 10,
        auxTitlePct: 20,
        fallaCajaPct: 10,
        adefSolidarityPct: 2,
        unionPct: 2,
        cajaCompensadoraPct: 1,
        proEdificioPct: 1,
        pharmacyEmployeeDay: "6 de septiembre"
      },
      liquidationModel: {
        version: "generic-v1",
        rules: {
          salaryType: "monthly",
          monthDivisor: 30,
          hourDivisor: 200,
          weeklyHours: 45,
          seniority: { enabled: true, percentPerYear: 0, capYears: 0, base: "basic" },
          presentism: { enabled: false, percent: 0, requiresNoUnjustifiedAbsence: false },
          nonRemunerativeScale: { enabled: true },
          overtime: { enabled: true, divisor: 200 }
        },
        concepts: [
          { id: "titulo-farmaceutico", label: "Adicional titulo farmaceutico", group: "Adicionales escala", inputType: "checkbox", rowType: "remunerative", calculation: "fixed", amountByPeriod: { "2026-04": parsedScale.additionals.tituloFarmaceutico?.monthly || 0, "2026-05": parsedScale.additionals.tituloFarmaceutico?.monthly || 0, "2026-06": parsedScale.additionals.tituloFarmaceutico?.monthly || 0 }, detail: "Escala abril 2026.", subjectToSocialSecurity: true },
          { id: "adscripcion", label: "Adicional adscripcion", group: "Adicionales escala", inputType: "checkbox", rowType: "remunerative", calculation: "fixed", amountByPeriod: { "2026-04": parsedScale.additionals.adscripcion?.monthly || 0, "2026-05": parsedScale.additionals.adscripcion?.monthly || 0, "2026-06": parsedScale.additionals.adscripcion?.monthly || 0 }, detail: "Escala abril 2026.", subjectToSocialSecurity: true },
          { id: "bloqueo", label: "Adicional bloqueo direccion tecnica", group: "Adicionales escala", inputType: "checkbox", rowType: "remunerative", calculation: "fixed", amountByPeriod: { "2026-04": parsedScale.additionals.bloqueo?.monthly || 0, "2026-05": parsedScale.additionals.bloqueo?.monthly || 0, "2026-06": parsedScale.additionals.bloqueo?.monthly || 0 }, detail: "Escala abril 2026.", subjectToSocialSecurity: true },
          { id: "falla-caja", label: "Fondo falla de caja", group: "Adicionales", inputType: "checkbox", rowType: "nonRemunerative", calculation: "percentOfBase", percent: 10, base: "seniorityBase", detail: "Art. 19 CCT 429/2005.", subjectToSocialSecurity: false },
          { id: "adicional-cajero", label: "Adicional cajero", group: "Adicionales", inputType: "checkbox", rowType: "remunerative", calculation: "percentOfBase", percent: 10, base: "basic", detail: "Art. 18 CCT 429/2005.", subjectToSocialSecurity: true },
          { id: "adicional-perfumeria", label: "Adicional perfumeria", group: "Adicionales", inputType: "checkbox", rowType: "remunerative", calculation: "percentOfBase", percent: 10, base: "basic", detail: "Art. 18 CCT 429/2005.", subjectToSocialSecurity: true },
          { id: "adicional-administrativo", label: "Adicional tareas administrativas", group: "Adicionales", inputType: "checkbox", rowType: "remunerative", calculation: "percentOfBase", percent: 5, base: "basic", detail: "Art. 18 CCT 429/2005.", subjectToSocialSecurity: true }
        ],
        deductions: [],
        employerContributions: []
      },
      auditChecklist: [
        "Controlar que la escala vigente sea Abril 2026 y que el periodo liquidado sea abril, mayo o junio 2026.",
        "Validar categoria del trabajador contra tareas reales y legajo.",
        "Verificar jornada semanal: base 45 horas, insalubre hasta 33 horas pagada como jornada completa cuando corresponda.",
        "Validar escalafon de antiguedad segun fecha de ingreso.",
        "Activar solo los adicionales acreditados: titulo farmaceutico, adscripcion, bloqueo, cajero, perfumeria, administracion, idioma, moto/bici.",
        "Controlar que los no remunerativos correspondan al mes liquidado.",
        "Revisar aporte solidario ADEF, cuota sindical, caja compensadora y contribucion extraordinaria de escala.",
        "Controlar dia del empleado de farmacia el 6 de septiembre y feriados trabajados/no trabajados."
      ],
      confidence: warnings.length ? 92 : 96,
      warnings,
      notes: sourceNotes,
      sourceFiles: [cctPdf?.sourceFileName, scalePdf?.sourceFileName].filter(Boolean)
    }
  }, { fallbackName: draftName || "Farmacia Mendoza - CCT 429/2005" });
}

function detectMainPeriodFromText({ text, fileName, fallback }) {
  const sources = [fileName, text].filter(Boolean);
  for (const source of sources) {
    const period = periodFromText(source, String(new Date().getFullYear()));
    if (period) return period;
  }
  return fallback || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
}

function inferSalaryAmounts(values) {
  const clean = (values || []).map(Number).filter((value) => Number.isFinite(value) && value > 0);
  if (!clean.length) return null;
  for (let index = clean.length - 1; index >= 2; index -= 1) {
    const total = clean[index];
    const nonRem = clean[index - 1];
    const monthly = clean[index - 2];
    if (monthly > 0 && nonRem >= 0 && Math.abs((monthly + nonRem) - total) <= Math.max(2, total * 0.002)) {
      return { monthly, nonRem, total };
    }
  }
  const max = Math.max(...clean);
  return { monthly: max, nonRem: 0, total: max };
}

function labelBeforeFirstAmount(line) {
  return String(line || "")
    .replace(/\s+/g, " ")
    .replace(/\s*\$\s*/g, "$")
    .replace(/\d{1,3}(?:\.\d{3})+(?:,\d{2})?\$?.*$/g, "")
    .trim();
}

function isUsefulScaleHeader(line) {
  const folded = asciiFold(line).replace(/\s+/g, " ").trim();
  if (folded.length < 4 || folded.length > 90) return false;
  if (moneyValuesFromText(line).length) return false;
  if (/%|\$/.test(line)) return false;
  return !/(ESCALA|REMUNERACION|VIGENCIA|CATEGORIA|CLASIFICACION|BASICO|COMISION|TOTAL|SUMA|APORTE|CONTRIBUCION|LOS ADICIONALES|LA SUMA|DEBERA|SINDICAL|OBRA SOCIAL|CONVENIO|ARTICULO)/i.test(folded);
}

function isUsefulCategoryLabel(label) {
  const folded = asciiFold(label).replace(/\s+/g, " ").trim();
  if (folded.length < 3 || folded.length > 95) return false;
  return !/(ESCALA|REMUNERACION|VIGENCIA|CATEGORIA|CLASIFICACION|BASICO|COMISION|TOTAL|SUMA|APORTE|CONTRIBUCION|SINDICAL|OBRA SOCIAL|CONVENIO|ARTICULO|GARANTIZAD|PRODUCTIVIDAD)/i.test(folded);
}

function isNumericOnlyScaleLabel(label) {
  return /^[\s$%.,\d-]+$/.test(String(label || "").trim());
}

function isLikelyAdditionalGroup(group) {
  const folded = asciiFold(group).replace(/\s+/g, " ").trim();
  return /(ADICIONAL|COMPLEMENTARIA|ART\.?\s*\d+|AYUD\.?\s*CHOF|CHOFER|KILOMETR|\bKM\b|VIATIC|PERNOCT|COMIDA|PLUS|PREMIO|BONIFIC|PRESENTISMO|ANTIGUEDAD|TITULO|QUEBRANTO|FALLA DE CAJA|MOVILIDAD|REFRIGERIO)/i.test(folded);
}

function isLikelySalaryCategoryLabel(label, group = "") {
  if (!isUsefulCategoryLabel(label)) return false;
  const folded = asciiFold(label).replace(/\s+/g, " ").trim();
  if (isNumericOnlyScaleLabel(label) || isLikelyAdditionalGroup(group)) return false;
  return !/(POR LOS PRIMEROS|MAS DE\s+\d+\s*KM|KILOMETR|\bKM\b|VIATIC|PERNOCT|COMIDA|SEGURO|CUOTA|HORAS?\s+EXTRA|ADICIONAL|PRESENTISMO|ANTIGUEDAD|ART\.?\s*\d+|CCT\s*\d+|^\w*BLECIDA\b)/i.test(folded);
}

function isAdditionalSectionHeader(line) {
  const folded = asciiFold(line).replace(/\s+/g, " ").trim();
  return /(ADICIONALES?|VIATICOS?|ITEMS?|CONCEPTOS? NO REMUNERATIVOS?|OTROS CONCEPTOS)/i.test(folded)
    && !moneyValuesFromText(line).length;
}

function conceptSectionHeader(line) {
  const folded = asciiFold(line).replace(/\s+/g, " ").trim();
  if (!folded || moneyValuesFromText(line).length || /\d+(?:[.,]\d+)?\s*%/.test(line)) return null;
  if (/^(HABERES?|CONCEPTOS?|ADICIONALES?|SUMAS?)\s+NO\s+REMUNERATIV(?:OS|AS)?\s*:?$/.test(folded)) {
    return { group: line.replace(/\s+/g, " ").trim(), rowType: "nonRemunerative" };
  }
  if (/^(HABERES?|CONCEPTOS?|ADICIONALES?|SUMAS?)\s+REMUNERATIV(?:OS|AS)?\s*:?$/.test(folded)) {
    return { group: line.replace(/\s+/g, " ").trim(), rowType: "remunerative" };
  }
  if (/^(ADICIONALES?|OTROS CONCEPTOS?)\s*:?$/.test(folded)) {
    return { group: line.replace(/\s+/g, " ").trim(), rowType: null };
  }
  return null;
}

function isNonConceptSectionHeader(line) {
  const folded = asciiFold(line).replace(/\s+/g, " ").trim();
  if (!folded || moneyValuesFromText(line).length || /\d+(?:[.,]\d+)?\s*%/.test(line)) return false;
  return /(CATEGORIAS?|ESCALA SALARIAL|BASICOS?|SALARIOS? BASICOS?|DESCUENTOS?|DEDUCCIONES?|RETENCIONES?|APORTES?|CONTRIBUCIONES?|JORNADA|LICENCIAS?|VACACIONES?)/i.test(folded);
}

function isSalarySectionHeader(line) {
  const folded = asciiFold(line).replace(/\s+/g, " ").trim();
  return /(CATEGORIAS?|ESCALA SALARIAL|BASICOS?|SALARIOS? BASICOS?)/i.test(folded)
    && !moneyValuesFromText(line).length;
}

function isLikelyAdditionalLabel(label) {
  const folded = asciiFold(label).replace(/\s+/g, " ").trim();
  return /(ADICIONAL|PLUS|PREMIO|BONIFIC|VIATIC|PERNOCT|COMIDA|KILOMETR|\bKM\b|HORAS?\s+EXTRA|PRESENTISMO|ANTIGUEDAD|TITULO|QUEBRANTO|FALLA DE CAJA|MOVILIDAD|REFRIGERIO|SEGURO|POR LOS PRIMEROS|MAS DE\s+\d+)/i.test(folded);
}

function conceptLabelBeforeValue(line) {
  return labelBeforeFirstAmount(line)
    .replace(/\s*[-:]?\s*\d+(?:[.,]\d+)?\s*%.*$/i, "")
    .replace(/\s*\$$/, "")
    .trim();
}

function scaleAdditionalConcept({ label, rawText = label, values, period, group = "Adicionales de escala", rowType, detail, source, sourceFiles }) {
  const folded = asciiFold(`${label} ${rawText}`);
  const percent = Number(String(rawText).match(/(\d+(?:[.,]\d+)?)\s*%/)?.[1]?.replace(",", ".")) || 0;
  const amount = Math.max(...(values || []).map(Number).filter((value) => Number.isFinite(value) && value > 0), 0);
  const amountPerUnit = /(POR LOS PRIMEROS|MAS DE\s+\d+|KILOMETR|\bKM\b|POR DIA|DIARIO|POR HORA|HORAS?\s+EXTRA|PERNOCT|COMIDA|VIATIC)/i.test(folded);
  const inferredRowType = rowType || (/(VIATIC|PERNOCT|COMIDA|MOVILIDAD|REFRIGERIO|NO REMUNERATIV)/i.test(folded) ? "nonRemunerative" : "remunerative");
  const id = normalizeText(label);
  if (!id || (!percent && !amount)) return null;
  return {
    id,
    label,
    group,
    inputType: amountPerUnit ? "number" : "checkbox",
    rowType: inferredRowType,
    calculation: percent ? "percentOfBase" : amountPerUnit ? "amountPerUnit" : "fixed",
    percent,
    amount: !percent && !amountPerUnit ? amount : null,
    amountByPeriod: !percent && !amountPerUnit ? { [period]: amount } : {},
    unitAmount: !percent && amountPerUnit ? amount : null,
    unitAmountByPeriod: !percent && amountPerUnit ? { [period]: amount } : {},
    base: percent ? "basic" : "",
    defaultValue: 0,
    detail: detail || "Detectado en tabla separada de adicionales de la escala. Validar tratamiento y base antes de aprobar.",
    source: source || "",
    sourceFiles: sourceFiles || [],
    subjectToSocialSecurity: inferredRowType !== "nonRemunerative",
    requiresHumanValidation: true
  };
}

function parseGenericDocumentConcepts(documentText, period, { sourceType = "documento", sourceFileName = "" } = {}) {
  const lines = String(documentText || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const concepts = [];
  const seen = new Set();
  let inConceptSection = false;
  let currentGroup = sourceType === "cct" ? "Conceptos del CCT" : "Adicionales de escala";
  let sectionRowType = null;
  let skipImplicitConcepts = false;
  for (const line of lines) {
    if (isSalarySectionHeader(line)) {
      inConceptSection = false;
      sectionRowType = null;
      skipImplicitConcepts = false;
      continue;
    }
    const section = conceptSectionHeader(line);
    if (section) {
      inConceptSection = true;
      currentGroup = section.group;
      sectionRowType = section.rowType;
      skipImplicitConcepts = false;
      continue;
    }
    if (isNonConceptSectionHeader(line)) {
      inConceptSection = false;
      sectionRowType = null;
      skipImplicitConcepts = true;
      continue;
    }
    const values = moneyValuesFromText(line);
    if (!values.length && !/\d+(?:[.,]\d+)?\s*%/.test(line)) continue;
    const label = conceptLabelBeforeValue(line);
    if (!label || label.length < 3 || label.length > 95) continue;
    if (!inConceptSection && (sourceType === "cct" || skipImplicitConcepts || !isLikelyAdditionalLabel(label))) continue;
    const origin = sourceType === "cct" ? "CCT" : sourceType === "salaryScale" ? "escala salarial" : sourceType;
    const concept = scaleAdditionalConcept({
      label,
      rawText: line,
      values,
      period,
      group: currentGroup,
      rowType: sectionRowType,
      detail: `Detectado en ${origin}${sourceFileName ? ` (${sourceFileName})` : ""}. Validar tratamiento y base antes de aprobar.`,
      source: origin,
      sourceFiles: sourceFileName ? [sourceFileName] : []
    });
    if (!concept || seen.has(concept.id)) continue;
    seen.add(concept.id);
    concepts.push(concept);
  }
  return concepts;
}

function financialDocumentSectionHeader(line) {
  const folded = asciiFold(line).replace(/\s+/g, " ").replace(/:$/, "").trim();
  if (/^(?:DESCUENTOS?|DEDUCCIONES?)(?: DEL TRABAJADOR| CONVENCIONALES?)?$/.test(folded)) return "deduction";
  if (/^APORTES?(?: DEL TRABAJADOR| CONVENCIONALES?)?$/.test(folded)) return "deduction";
  if (/^RETENCIONES?(?: DEL TRABAJADOR| CONVENCIONALES?)?$/.test(folded)) return "retention";
  if (/^(?:APORTES? Y RETENCIONES?|EMBARGOS?(?: JUDICIALES?)?)$/.test(folded)) return "retention";
  return null;
}

function isGeneralStatutoryDeduction(label) {
  const folded = asciiFold(label).replace(/\s+/g, " ").trim();
  return /(JUBILACION|SIPA|PAMI|LEY\s*19\.?032|OBRA SOCIAL|GANANCIAS)/.test(folded);
}

function documentFinancialItem({ label, rawText, values, period, kind, sourceFileName }) {
  if (isGeneralStatutoryDeduction(label)) return null;
  const percent = Number(String(rawText).match(/(\d+(?:[.,]\d+)?)\s*%/)?.[1]?.replace(",", ".")) || 0;
  const amount = percent ? null : Math.max(...(values || []).map(Number).filter((value) => Number.isFinite(value) && value > 0), 0);
  if (!percent && !amount) return null;
  const folded = asciiFold(rawText);
  const base = /NO\s+REMUNERATIV/.test(folded)
    ? "nonRemunerative"
    : /BRUTO|TOTAL\s+HABERES/.test(folded)
      ? "gross"
      : /BASIC/.test(folded) ? "basic" : "remunerative";
  return {
    id: normalizeText(label),
    label,
    percent,
    amount,
    amountByPeriod: amount ? { [period]: amount } : {},
    base,
    defaultValue: kind === "retention" ? false : true,
    appliesWhen: kind === "retention" ? "Segun legajo y documentacion respaldatoria" : "Segun alcance del convenio",
    detail: `Detectado en CCT${sourceFileName ? ` (${sourceFileName})` : ""}. Validar alcance, base y vigencia antes de aprobar.`,
    source: "CCT",
    sourceFiles: sourceFileName ? [sourceFileName] : [],
    requiresHumanValidation: true
  };
}

function parseGenericDocumentDeductions(documentText, period, { sourceFileName = "" } = {}) {
  const lines = String(documentText || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const deductions = [];
  const retentions = [];
  const seen = { deduction: new Set(), retention: new Set() };
  let section = null;
  for (const line of lines) {
    const nextSection = financialDocumentSectionHeader(line);
    if (nextSection) {
      section = nextSection;
      continue;
    }
    if (conceptSectionHeader(line) || isSalarySectionHeader(line) || isNonConceptSectionHeader(line)) {
      section = null;
      continue;
    }
    if (/^(REGLAS?|CONDICIONES?|VALIDACIONES?)(?:\s+DE\s+LIQUIDACION)?\s*:?$/i.test(line)) {
      section = null;
      continue;
    }
    if (!section) continue;
    const values = moneyValuesFromText(line);
    if (!values.length && !/\d+(?:[.,]\d+)?\s*%/.test(line)) continue;
    const label = conceptLabelBeforeValue(line);
    if (!label || label.length < 3 || label.length > 95) continue;
    const item = documentFinancialItem({ label, rawText: line, values, period, kind: section, sourceFileName });
    if (!item || seen[section].has(item.id)) continue;
    seen[section].add(item.id);
    (section === "retention" ? retentions : deductions).push(item);
  }
  return { deductions, retentions };
}

function decimalRuleValue(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function findDocumentRule(lines, pattern) {
  for (const line of lines) {
    const match = asciiFold(line).replace(/\s+/g, " ").match(pattern);
    const value = decimalRuleValue(match?.[1]);
    if (value !== null) return { value, evidence: line.replace(/\s+/g, " ").trim() };
  }
  return null;
}

function findJoinedDocumentRule(lines, pattern) {
  const text = asciiFold(lines.join(" ")).replace(/\s+/g, " ");
  const match = text.match(pattern);
  const value = decimalRuleValue(match?.[1]);
  if (value === null) return null;
  let evidence = match[0].trim();
  const assignmentIndex = evidence.lastIndexOf("ASIGNACION COMPLEMENTARIA");
  if (assignmentIndex > 0 && evidence.includes("PRESENTISMO")) {
    evidence = `PRESENTISMO: ${evidence.slice(assignmentIndex)}`;
  }
  if (evidence.includes("(") && !evidence.includes(")")) evidence += ")";
  return { value, evidence: evidence.slice(0, 260).trim() };
}

function parseGenericDocumentRules(documentText, { sourceFileName = "", sourceType = "CCT" } = {}) {
  const lines = String(documentText || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const rules = {};
  const liquidationRules = {};
  const evidence = [];
  const register = (id, label, parsed, apply) => {
    if (!parsed) return;
    apply(parsed.value);
    evidence.push({
      id,
      label,
      value: parsed.value,
      evidence: parsed.evidence,
      source: sourceType,
      sourceFileName,
      requiresHumanValidation: true
    });
  };

  register("jornada-semanal", "Jornada semanal", findDocumentRule(lines, /\bJORNADA\b[^.\n]{0,120}?(\d{1,2}(?:[.,]\d+)?)\s*(?:HS|HORAS?)\s+SEMANALES?\b/), (value) => {
    rules.weeklyHours = value;
    liquidationRules.weeklyHours = value;
  });
  register("divisor-mensual", "Divisor mensual", findDocumentRule(lines, /\bDIVISOR\s+(?:MENSUAL|DE\s+INASISTENCIAS?|SUELDO)[^\d\n]{0,30}(\d{2,3})\b/), (value) => {
    rules.monthDivisor = value;
    rules.dayDivisor = value;
    liquidationRules.monthDivisor = value;
  });
  register("divisor-vacaciones", "Divisor vacaciones", findDocumentRule(lines, /\bDIVISOR\s+(?:DE\s+)?VACACIONES?[^\d\n]{0,30}(\d{2,3})\b/), (value) => {
    rules.vacationDivisor = value;
  });
  register("divisor-horas-extra", "Divisor horas extra", findDocumentRule(lines, /\bDIVISOR\s+(?:DE\s+)?HORAS?(?:\s+EXTRAS?)?[^\d\n]{0,30}(\d{2,3})\b/), (value) => {
    rules.hourDivisor = value;
    liquidationRules.hourDivisor = value;
    liquidationRules.overtime = { ...(liquidationRules.overtime || {}), divisor: value };
  });
  register("antiguedad", "Antiguedad", findDocumentRule(lines, /\bANTIGUEDAD\b[^.\n]{0,160}?(\d+(?:[.,]\d+)?)\s*%\s*(?:POR|X)\s+(?:CADA\s+)?ANO\b/), (value) => {
    liquidationRules.seniority = { enabled: true, percentPerYear: value };
  });
  register("presentismo", "Presentismo", findDocumentRule(lines, /\bPRESENTISMO\b[^.\n]{0,160}?(\d+(?:[.,]\d+)?)\s*%/)
    || findJoinedDocumentRule(lines, /\bPRESENTISMO\b.{0,500}?(\d+(?:[.,]\d+)?)\s*%/), (value) => {
    liquidationRules.presentism = { enabled: true, percent: value };
  });

  const joinedText = asciiFold(lines.join(" ")).replace(/\s+/g, " ");
  const sharedNonRemApplication = /\bANTIGUEDAD\b.{0,180}\bPRESENTISMO\b.{0,220}\b(?:SUMAS?\s+)?NO\s+REMUNERATIVAS?\b/.test(joinedText)
    || /\b(?:SUMAS?\s+)?NO\s+REMUNERATIVAS?\b.{0,220}\bANTIGUEDAD\b.{0,180}\bPRESENTISMO\b/.test(joinedText);
  const noRemSeniority = findJoinedDocumentRule(lines, /\bANTIGUEDAD(?:\s+NO\s+REMUNERATIVA|.{0,160}\b(?:SUMAS?\s+)?NO\s+REMUNERATIVAS?)\b.{0,100}?(\d+(?:[.,]\d+)?)\s*%/);
  const noRemPresentism = findJoinedDocumentRule(lines, /\bPRESENTISMO(?:\s+NO\s+REMUNERATIVO|.{0,160}\b(?:SUMAS?\s+)?NO\s+REMUNERATIVAS?)\b.{0,100}?(\d+(?:[.,]\d+)?)\s*%/);
  const nonRemunerativeScale = {};
  const nonRemSeniorityValue = noRemSeniority?.value ?? (sharedNonRemApplication ? liquidationRules.seniority?.percentPerYear : null);
  const nonRemPresentismValue = noRemPresentism?.value ?? (sharedNonRemApplication ? liquidationRules.presentism?.percent : null);
  if (nonRemSeniorityValue != null) {
    nonRemunerativeScale.enabled = true;
    nonRemunerativeScale.seniorityEnabled = true;
    nonRemunerativeScale.seniorityPercentPerYear = nonRemSeniorityValue;
    evidence.push({
      id: "antiguedad-no-remunerativa",
      label: "Antiguedad no remunerativa",
      value: nonRemSeniorityValue,
      evidence: noRemSeniority?.evidence || "El documento indica que la antiguedad aplica tambien sobre sumas no remunerativas.",
      source: sourceType,
      sourceFileName,
      requiresHumanValidation: true
    });
  }
  if (nonRemPresentismValue != null) {
    nonRemunerativeScale.enabled = true;
    nonRemunerativeScale.presentismEnabled = true;
    nonRemunerativeScale.presentismPercent = nonRemPresentismValue;
    evidence.push({
      id: "presentismo-no-remunerativo",
      label: "Presentismo no remunerativo",
      value: nonRemPresentismValue,
      evidence: noRemPresentism?.evidence || "El documento indica que el presentismo aplica tambien sobre sumas no remunerativas.",
      source: sourceType,
      sourceFileName,
      requiresHumanValidation: true
    });
  }
  if (Object.keys(nonRemunerativeScale).length) liquidationRules.nonRemunerativeScale = nonRemunerativeScale;

  return { rules, liquidationRules, evidence };
}

function mergeFinancialItems(...groups) {
  const items = new Map();
  groups.flat().filter(Boolean).forEach((item) => {
    const id = normalizeText(item.id || item.label);
    if (!id) return;
    const existing = items.get(id);
    items.set(id, existing ? {
      ...existing,
      ...item,
      id,
      amountByPeriod: { ...(existing.amountByPeriod || {}), ...(item.amountByPeriod || {}) },
      sourceFiles: Array.from(new Set([...(existing.sourceFiles || []), ...(item.sourceFiles || [])].filter(Boolean)))
    } : { ...item, id });
  });
  return Array.from(items.values());
}

function mergeRuleObjects(base, extra) {
  const merged = { ...(base || {}) };
  Object.entries(extra || {}).forEach(([key, value]) => {
    merged[key] = value && typeof value === "object" && !Array.isArray(value)
      ? mergeRuleObjects(merged[key], value)
      : value;
  });
  return merged;
}

function parseGenericScaleAdditionals(scaleText, period) {
  const lines = String(scaleText || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const concepts = [];
  const seen = new Set();
  let inAdditionalSection = false;
  let currentGroup = "Adicionales de escala";
  for (const line of lines) {
    if (isSalarySectionHeader(line)) {
      inAdditionalSection = false;
      continue;
    }
    if (isAdditionalSectionHeader(line)) {
      inAdditionalSection = true;
      currentGroup = line.replace(/\s+/g, " ").trim();
      continue;
    }
    const values = moneyValuesFromText(line);
    if (!values.length && !/\d+(?:[.,]\d+)?\s*%/.test(line)) continue;
    const label = labelBeforeFirstAmount(line);
    if (!label || label.length < 3 || label.length > 95) continue;
    if (!inAdditionalSection && !isLikelyAdditionalLabel(label)) continue;
    const concept = scaleAdditionalConcept({ label, values, period, group: currentGroup });
    if (!concept || seen.has(concept.id)) continue;
    seen.add(concept.id);
    concepts.push(concept);
  }
  return concepts;
}

function mergeGenericConcepts(...groups) {
  const concepts = new Map();
  groups.flat().filter(Boolean).forEach((concept) => {
    const id = normalizeText(concept.id || concept.label);
    if (!id) return;
    const existing = concepts.get(id);
    if (!existing) {
      concepts.set(id, { ...concept, id });
      return;
    }
    const details = Array.from(new Set([existing.detail, concept.detail].filter(Boolean)));
    const sourceFiles = Array.from(new Set([...(existing.sourceFiles || []), ...(concept.sourceFiles || [])].filter(Boolean)));
    concepts.set(id, {
      ...existing,
      ...concept,
      id,
      amountByPeriod: { ...(existing.amountByPeriod || {}), ...(concept.amountByPeriod || {}) },
      unitAmountByPeriod: { ...(existing.unitAmountByPeriod || {}), ...(concept.unitAmountByPeriod || {}) },
      detail: details.join(" "),
      source: Array.from(new Set([existing.source, concept.source].filter(Boolean))).join(" + "),
      sourceFiles
    });
  });
  return Array.from(concepts.values());
}

function enrichConventionWithDocumentConcepts(convention, { cctText = "", cctPdf, scaleText = "", scalePdf } = {}) {
  if (!convention) return convention;
  const period = convention.periods?.[0]?.id || detectMainPeriodFromText({
    text: cctText,
    fileName: cctPdf?.sourceFileName
  });
  const cctConcepts = parseGenericDocumentConcepts(cctText, period, {
    sourceType: "cct",
    sourceFileName: cctPdf?.sourceFileName || ""
  });
  const cctFinancialItems = parseGenericDocumentDeductions(cctText, period, {
    sourceFileName: cctPdf?.sourceFileName || ""
  });
  const cctRules = parseGenericDocumentRules(cctText, {
    sourceFileName: cctPdf?.sourceFileName || ""
  });
  const scaleRules = parseGenericDocumentRules(scaleText, {
    sourceFileName: scalePdf?.sourceFileName || "",
    sourceType: "escala salarial"
  });
  const extractedRules = {
    rules: mergeRuleObjects(cctRules.rules, scaleRules.rules),
    liquidationRules: mergeRuleObjects(cctRules.liquidationRules, scaleRules.liquidationRules),
    evidence: mergeFinancialItems(cctRules.evidence, scaleRules.evidence)
  };
  if (!cctConcepts.length && !cctFinancialItems.deductions.length && !cctFinancialItems.retentions.length && !extractedRules.evidence.length) return convention;
  return {
    ...convention,
    rules: mergeRuleObjects(convention.rules, extractedRules.rules),
    extractedRules: mergeFinancialItems(convention.extractedRules || [], extractedRules.evidence),
    liquidationModel: {
      ...(convention.liquidationModel || {}),
      rules: mergeRuleObjects(convention.liquidationModel?.rules, extractedRules.liquidationRules),
      concepts: mergeGenericConcepts(convention.liquidationModel?.concepts || [], cctConcepts),
      deductions: mergeFinancialItems(convention.liquidationModel?.deductions || [], cctFinancialItems.deductions),
      retentions: mergeFinancialItems(convention.liquidationModel?.retentions || [], cctFinancialItems.retentions)
    }
  };
}

function parseGenericScaleCategories(scaleText, period, { stopAtTotals = false } = {}) {
  const lines = String(scaleText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const categories = [];
  const seen = new Set();
  let currentGroup = "Escala";
  let inAdditionalSection = false;

  for (const line of lines) {
    const folded = asciiFold(line);
    if (stopAtTotals && /(TOTAL A ABONAR|LA SUMA FIJA|LOS ADICIONALES EXTRAORDINARIOS)/i.test(folded)) break;
    if (isSalarySectionHeader(line)) {
      inAdditionalSection = false;
      currentGroup = line.replace(/\s+/g, " ").trim();
      continue;
    }
    if (isAdditionalSectionHeader(line)) {
      inAdditionalSection = true;
      continue;
    }
    if (inAdditionalSection) continue;
    if (isUsefulScaleHeader(line)) {
      currentGroup = line.replace(/\s+/g, " ").trim();
      continue;
    }
    const values = moneyValuesFromText(line);
    if (!values.length) continue;
    const label = labelBeforeFirstAmount(line);
    if (!isLikelySalaryCategoryLabel(label, currentGroup)) continue;
    const amounts = inferSalaryAmounts(values);
    if (!amounts?.monthly) continue;
    const id = normalizeText(label);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    categories.push({
      id,
      label,
      group: currentGroup,
      monthly: amounts.monthly,
      monthlyByPeriod: { [period]: amounts.monthly },
      day: null,
      hourly: null,
      nonRem: { [period]: amounts.nonRem || 0 },
      notes: amounts.total && amounts.nonRem ? [`Total de escala detectado: ${amounts.total}.`] : []
    });
  }
  return categories;
}

function sanitizeGenericConventionCategories(convention) {
  const shouldSanitize = convention?.extraction?.model === "local-pdf-parse/generic-scale-parser"
    || (convention?.generatedByLeia === true && convention?.calculationMode === "generic-v1");
  if (!shouldSanitize) return convention;
  const originalCategories = convention.categories || [];
  const categories = originalCategories.filter((category) => isLikelySalaryCategoryLabel(category.label || category.id, category.group));
  const period = convention.periods?.[0]?.id || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  const promotedConcepts = originalCategories
    .filter((category) => !isLikelySalaryCategoryLabel(category.label || category.id, category.group))
    .map((category) => {
      const label = String(category.label || category.id || "").trim();
      const group = String(category.group || "").trim();
      const recoverableGroup = isLikelyAdditionalGroup(group);
      const recoveredLabel = recoverableGroup
        ? (/^[a-z]/.test(label) && /[a-z]$/i.test(group) ? `${group}${label}` : `${group} - ${label}`)
        : label;
      if (!recoverableGroup && !isLikelyAdditionalLabel(label)) return null;
      return scaleAdditionalConcept({
      label: recoveredLabel,
      values: [category.monthly, category.day, category.hourly],
      period,
      group: category.group || "Adicionales recuperados de escala"
      });
    })
    .filter(Boolean);
  const categoryIds = new Set(categories.map((category) => category.id));
  const concepts = [...(convention.liquidationModel?.concepts || [])];
  promotedConcepts.forEach((concept) => {
    if (!concepts.some((item) => item.id === concept.id)) concepts.push(concept);
  });
  const structuredConcepts = convention.structuredModel?.conceptos;
  const promotedStructuredConcepts = promotedConcepts.map((concept) => ({
    codigo: concept.id,
    nombre: concept.label,
    tipo_calculo: concept.calculation,
    valor: concept.percent || concept.amount || concept.unitAmount || 0,
    base_calculo: concept.base || "",
    condiciones: [],
    fuente: "Tabla separada de adicionales de escala"
  }));
  const structuredRemunerative = [...(structuredConcepts?.haberes_remunerativos || [])];
  const structuredNonRemunerative = [...(structuredConcepts?.haberes_no_remunerativos || [])];
  promotedConcepts.forEach((concept, index) => {
    const target = concept.rowType === "nonRemunerative" ? structuredNonRemunerative : structuredRemunerative;
    if (!target.some((item) => item.codigo === concept.id)) target.push(promotedStructuredConcepts[index]);
  });
  return {
    ...convention,
    categories,
    warnings: originalCategories.length === categories.length ? convention.warnings : Array.from(new Set([
      ...(convention.warnings || []),
      "Se reclasificaron filas fragmentadas de tablas complementarias para evitar tratarlas como categorias salariales."
    ])),
    liquidationModel: { ...(convention.liquidationModel || {}), concepts },
    structuredModel: convention.structuredModel ? {
      ...convention.structuredModel,
      categorias: (convention.structuredModel.categorias || []).filter((category) => categoryIds.has(category.codigo)),
      escalas_salariales: (convention.structuredModel.escalas_salariales || []).filter((scale) => categoryIds.has(scale.categoria)),
      conceptos: structuredConcepts ? {
        ...structuredConcepts,
        haberes_remunerativos: structuredRemunerative,
        haberes_no_remunerativos: structuredNonRemunerative
      } : structuredConcepts
    } : convention.structuredModel
  };
}

function looksLikeHairdressers730({ draftName, notes, cctText, scaleText, cctPdf, scalePdf }) {
  const haystack = asciiFold([
    draftName,
    notes,
    cctPdf?.sourceFileName,
    scalePdf?.sourceFileName,
    cctText.slice(0, 12000),
    scaleText.slice(0, 5000)
  ].join(" "));
  const hasCct = haystack.includes("730/15")
    || haystack.includes("730-15")
    || haystack.includes("CCT 730");
  const specificSignals = [
    "FENTPEA",
    "TRABAJADORES DE PELUQUERIA",
    "FEDERACION NACIONAL DE TRABAJADORES DE PELUQUERIA",
    "PELUQUERIAS, ESTETICA Y ACTIVIDADES AFINES"
  ].filter((signal) => haystack.includes(signal));
  return hasCct || specificSignals.length >= 2;
}

function parseHairdressersScale(scaleText, scalePdf) {
  const period = detectMainPeriodFromText({
    text: scaleText,
    fileName: scalePdf?.sourceFileName,
    fallback: "2026-04"
  });
  const categories = parseGenericScaleCategories(scaleText, period, { stopAtTotals: true });
  const enriched = categories.map((category) => {
    const line = String(scaleText || "").split(/\r?\n/).find((item) => normalizeText(labelBeforeFirstAmount(item)) === category.id) || "";
    const commission = Number((line.match(/(\d+(?:,\d+)?)\s*%/)?.[1] || "").replace(",", ".")) || null;
    return {
      ...category,
      commissionPercent: commission,
      notes: [
        ...(category.notes || []),
        commission ? `Comision de produccion detectada en escala: ${commission}%.` : ""
      ].filter(Boolean)
    };
  });
  return {
    period,
    categories: enriched,
    nonRemValue: enriched.find((item) => Object.values(item.nonRem || {})[0]) ? Object.values(enriched.find((item) => Object.values(item.nonRem || {})[0]).nonRem)[0] : 0
  };
}

function buildHairdressersConvention({ draftName, notes, cctPdf, scalePdf, cctText, scaleText }) {
  const parsedScale = parseHairdressersScale(scaleText, scalePdf);
  if (parsedScale.categories.length < 5) return null;
  const period = parsedScale.period;
  return normalizeConvention({
    convention: {
      schemaVersion: "esueldos-convenio-universal-v1",
      id: "peluqueros-cct-730-15",
      name: "Peluqueros - CCT 730/15",
      shortName: "Peluqueros",
      source: "CCT 730/15 y escala salarial",
      type: "monthly",
      calculationMode: "generic-v1",
      metadata: {
        country: "AR",
        jurisdiction: "Nacional / Provincia de Buenos Aires segun actividad",
        activity: "Peluquerias, estetica y actividades afines",
        union: "Federacion Nacional de Trabajadores de Peluqueria, Estetica y Afines",
        cct: "730/15",
        status: "draft",
        createdBy: "leIA"
      },
      legalFramework: {
        primarySources: [
          { type: "cct", title: "CCT 730/15", fileName: cctPdf?.sourceFileName || "" },
          { type: "salaryScale", title: "Escala salarial", fileName: scalePdf?.sourceFileName || "", effectiveFrom: period }
        ],
        defaultLaws: ["LCT", "SIPA", "Ley de Obras Sociales", "ART"],
        articleMap: {
          jornada: "Art. 8",
          antiguedad: "Art. 41 inc. a",
          puntualidad: "Art. 41 inc. b",
          presentismo: "Art. 41 inc. c",
          plusFuncion: "Art. 42"
        }
      },
      scope: {
        workersIncluded: ["Personal tecnico especializado", "Personal administrativo y de servicios"],
        workersExcluded: [],
        territory: ["Territorio nacional segun CCT y actividades alcanzadas"],
        notes: []
      },
      periods: [{ id: period, label: monthLabel(period) }],
      zones: [{ id: "general", label: "General", coef: 1 }],
      categories: parsedScale.categories,
      rules: {
        salaryType: "monthly",
        monthDivisor: 30,
        dayDivisor: 30,
        hourDivisor: 200,
        weeklyHours: 48,
        fixedPayWeeklyHours: 44,
        productionPayWeeklyHours: 48,
        partTimeUsesFullOsBase: true
      },
      liquidationModel: {
        version: "generic-v1",
        rules: {
          salaryType: "monthly",
          monthDivisor: 30,
          hourDivisor: 200,
          weeklyHours: 48,
          seniority: { enabled: true, percentPerYear: 2, capYears: 0, base: "basic", legalReferences: ["Art. 41 inc. a CCT 730/15"] },
          presentism: { enabled: true, percent: 1, base: "basic", requiresNoUnjustifiedAbsence: true, legalReferences: ["Art. 41 inc. c CCT 730/15"] },
          nonRemunerativeScale: { enabled: true, subjectToHealthInsurance: true, subjectToUnion: true, legalReferences: ["Escala salarial"] },
          overtime: { enabled: true, divisor: 200 }
        },
        concepts: [
          { id: "puntualidad", label: "Puntualidad", group: "Asistencia", inputType: "checkbox", rowType: "remunerative", calculation: "percentOfBase", percent: 1, base: "basic", defaultValue: true, detail: "Art. 41 inc. b CCT 730/15", subjectToSocialSecurity: true, conditions: [{ field: "perfectPunctuality", operator: "=", value: true }] },
          { id: "comision-produccion-manual", label: "Comision produccion informada", group: "Produccion", inputType: "number", rowType: "remunerative", calculation: "fixed", amount: 1, base: "basic", defaultValue: 0, detail: "Cargar importe de comision liquidada segun produccion y porcentaje de categoria.", subjectToSocialSecurity: true, requiresHumanValidation: true },
          { id: "plus-director", label: "Plus Director/a", group: "Plus por funcion", inputType: "checkbox", rowType: "remunerative", calculation: "percentOfBase", percent: 15, base: "basic", detail: "Art. 42 inc. 1 CCT 730/15", subjectToSocialSecurity: true },
          { id: "plus-encargado-administrativo", label: "Plus encargado/a administrativo/a", group: "Plus por funcion", inputType: "checkbox", rowType: "remunerative", calculation: "percentOfBase", percent: 15, base: "basic", detail: "Art. 42 inc. 2 CCT 730/15", subjectToSocialSecurity: true },
          { id: "plus-cajero", label: "Plus cajero/a", group: "Plus por funcion", inputType: "checkbox", rowType: "remunerative", calculation: "percentOfBase", percent: 10, base: "basic", detail: "Art. 42 inc. 3 CCT 730/15", subjectToSocialSecurity: true }
        ],
        deductions: [],
        employerContributions: []
      },
      employeeRequirements: {
        requiredFields: ["name", "cuil", "entryDate", "category", "period"],
        optionalFields: ["weeklyHours", "productionAmount", "affiliate", "perfectPunctuality"],
        legajoFlags: ["perfectPunctuality", "perfectAttendance", "productionCommission"]
      },
      validation: {
        blocking: ["Debe existir categoria con sueldo minimo garantizado.", "Controlar escala vigente del periodo."],
        warnings: ["La comision por produccion debe cargarse con respaldo de produccion bruta mensual.", "La suma fija no remunerativa integra bases indicadas por la escala."],
        autoChecks: ["sumRowsEqualsTotals", "activeScaleForPeriod", "requiredEmployeeData"]
      },
      auditChecklist: [
        "Validar categoria del trabajador contra tarea real.",
        "Controlar si la modalidad es con produccion o retribucion fija para jornada 48/44 hs.",
        "Validar antiguedad 2% por año sobre salario minimo garantizado.",
        "Validar puntualidad 1% y presentismo 1% solo con cumplimiento perfecto.",
        "Controlar comision de produccion contra ventas/produccion bruta mensual.",
        "Controlar plus de funcion para Director, Encargado administrativo y Cajero.",
        "Controlar suma fija no remunerativa de escala y sus bases especiales."
      ],
      automationHints: {
        preferredEngine: "generic-v1",
        humanReviewRequiredWhen: ["comision-produccion-manual > 0", "weeklyHours < conventionalHours"]
      },
      confidence: 94,
      warnings: [],
      notes: [
        "Estructurado con lector local para CCT 730/15 cuando Gemini no devolvio JSON valido.",
        "La escala indica suma fija no remunerativa incluida en base de SAC, cuota sindical, aportes solidarios, contribucion patronal Fe.N.T.P.E.A. y obra social.",
        notes
      ].filter(Boolean),
      extraction: {
        confidence: 94,
        model: "local-pdf-parse/peluqueros-cct-730-15",
        readStrategy: "pdf-text+local-scale-parser",
        sourceFiles: [cctPdf?.sourceFileName, scalePdf?.sourceFileName].filter(Boolean)
      }
    }
  }, { fallbackName: draftName || "Peluqueros - CCT 730/15" });
}

function buildGenericConventionFromScale({ draftName, notes, cctPdf, scalePdf, cctText, scaleText, aiError }) {
  const period = detectMainPeriodFromText({
    text: scaleText,
    fileName: scalePdf?.sourceFileName
  });
  const categories = parseGenericScaleCategories(scaleText, period);
  const documentConcepts = mergeGenericConcepts(
    parseGenericDocumentConcepts(cctText, period, { sourceType: "cct", sourceFileName: cctPdf?.sourceFileName || "" }),
    parseGenericScaleAdditionals(scaleText, period, { sourceFileName: scalePdf?.sourceFileName || "" })
  );
  if (categories.length < 2) return null;
  const safeName = draftName || "Convenio estructurado por leIA";
  return normalizeConvention({
    convention: {
      schemaVersion: "esueldos-convenio-universal-v1",
      id: normalizeText(safeName),
      name: safeName,
      shortName: safeName.slice(0, 42),
      source: [cctPdf?.sourceFileName, scalePdf?.sourceFileName].filter(Boolean).join(" + "),
      type: "monthly",
      calculationMode: "generic-v1",
      metadata: {
        country: "AR",
        activity: safeName,
        status: "draft",
        createdBy: "leIA"
      },
      legalFramework: {
        primarySources: [
          { type: "cct", title: "CCT adjunto", fileName: cctPdf?.sourceFileName || "" },
          { type: "salaryScale", title: "Escala adjunta", fileName: scalePdf?.sourceFileName || "", effectiveFrom: period }
        ],
        defaultLaws: ["LCT", "SIPA", "Ley de Obras Sociales", "ART"],
        articleMap: {}
      },
      periods: [{ id: period, label: monthLabel(period) }],
      zones: [{ id: "general", label: "General", coef: 1 }],
      categories,
      rules: { salaryType: "monthly", monthDivisor: 30, dayDivisor: 30, hourDivisor: 200, weeklyHours: 48 },
      liquidationModel: {
        version: "generic-v1",
        rules: {
          salaryType: "monthly",
          monthDivisor: 30,
          hourDivisor: 200,
          weeklyHours: 48,
          seniority: { enabled: true, percentPerYear: 1, capYears: 0, base: "basic", requiresHumanValidation: true },
          presentism: { enabled: false, percent: 0, requiresNoUnjustifiedAbsence: true },
          nonRemunerativeScale: { enabled: true },
          overtime: { enabled: true, divisor: 200 }
        },
        concepts: [
          ...documentConcepts,
          { id: "adicional-remunerativo-manual", label: "Adicional remunerativo manual", group: "Ajustes auditables", inputType: "number", rowType: "remunerative", calculation: "fixed", amount: 1, base: "basic", defaultValue: 0, detail: "Usar solo con respaldo del CCT/acta o auditoria humana.", subjectToSocialSecurity: true, requiresHumanValidation: true },
          { id: "adicional-no-remunerativo-manual", label: "Adicional no remunerativo manual", group: "Ajustes auditables", inputType: "number", rowType: "nonRemunerative", calculation: "fixed", amount: 1, base: "basic", defaultValue: 0, detail: "Usar solo con respaldo del CCT/acta o auditoria humana.", subjectToSocialSecurity: false, requiresHumanValidation: true },
          { id: "descuento-convencional-manual", label: "Descuento convencional manual", group: "Ajustes auditables", inputType: "number", rowType: "deduction", calculation: "fixed", amount: 1, base: "basic", defaultValue: 0, detail: "Usar solo con respaldo del CCT/acta o auditoria humana.", requiresHumanValidation: true }
        ],
        deductions: [],
        employerContributions: []
      },
      validation: {
        blocking: ["Controlar CCT: parser generico detecto escala pero no reglas especificas completas."],
        warnings: ["Completar conceptos especificos si el CCT contiene adicionales no detectados automaticamente."],
        autoChecks: ["sumRowsEqualsTotals", "activeScaleForPeriod", "requiredEmployeeData"]
      },
      auditChecklist: [
        "Controlar que las categorias e importes coincidan con la escala PDF.",
        "Completar o validar antiguedad, presentismo, adicionales, aportes y contribuciones del CCT.",
        "Validar tratamiento de no remunerativos y bases de obra social/sindicato.",
        "Aprobar solo luego de revision humana."
      ],
      confidence: 82,
      warnings: ["Estructura generica: se detectaron categorias e importes, pero requiere completar reglas finas del CCT antes de aprobar."],
      notes: [
        aiError ? `Error IA original: ${aiError}` : "",
        notes
      ].filter(Boolean),
      extraction: {
        confidence: 82,
        model: "local-pdf-parse/generic-scale-parser",
        readStrategy: "pdf-text+generic-scale-parser",
        sourceFiles: [cctPdf?.sourceFileName, scalePdf?.sourceFileName].filter(Boolean)
      }
    }
  }, { fallbackName: safeName });
}

function buildCommerceConvention({ draftName, notes, cctPdf, scalePdf, cctText, scaleText, aiError }) {
  const parsedScale = parseCommerceCategories(scaleText);
  if (!parsedScale.categories.length) return null;
  const periodIds = Array.from(new Set(parsedScale.categories.flatMap((category) => Object.keys(category.monthlyByPeriod || {})))).sort();
  const periods = periodIds.map((period) => ({ id: period, label: monthLabel(period) }));
  const commerceAdditionals = parseCommerceScaleAdditionals(scaleText, periodIds);
  const warnings = [...parsedScale.warnings];
  if (commerceAdditionals.length && commerceAdditionals.length < COMMERCE_ADDITIONAL_ROWS.length) {
    warnings.push(`La tabla separada de adicionales de Comercio se reconstruyo parcialmente: se detectaron ${commerceAdditionals.length} de ${COMMERCE_ADDITIONAL_ROWS.length} filas esperadas.`);
  }
  const notesList = [
    "Estructurado con lector local de PDF para CCT 130/75 cuando Gemini no entrego JSON valido.",
    "La circular FAECYS 04/2026 informa basico remunerativo y sumas no remunerativas para abril, mayo y junio 2026.",
    "La antiguedad y el presentismo se aplican tambien sobre sumas no remunerativas segun la propia circular.",
    notes
  ].filter(Boolean);
  if (aiError) notesList.push(`Error IA original conservado como antecedente: ${aiError}`);

  return normalizeConvention({
    convention: {
      id: "comercio-cct-130-75",
      name: "Empleados de Comercio - CCT 130/75",
      shortName: "Comercio",
      source: "CCT 130/75 - FAECYS acuerdo abril 2026",
      type: "monthly",
      calculationMode: "generic-v1",
      periods,
      zones: [{ id: "general", label: "Todo el pais", coef: 1 }],
      categories: parsedScale.categories,
      rules: { monthDivisor: 30, hourDivisor: 200, weeklyHours: 48 },
      liquidationModel: {
        version: "generic-v1",
        rules: {
          salaryType: "monthly",
          monthDivisor: 30,
          hourDivisor: 200,
          weeklyHours: 48,
          seniority: { enabled: true, percentPerYear: 1, capYears: 0, base: "basic" },
          presentism: { enabled: true, percent: 8.333333, requiresNoUnjustifiedAbsence: true },
          nonRemunerativeScale: {
            enabled: true,
            seniorityPercentPerYear: 1,
            presentismPercent: 8.333333,
            presentismRequiresNoUnjustifiedAbsence: true
          },
          overtime: { enabled: true, divisor: 200 }
        },
        concepts: [
          {
            id: "feriados-trabajados",
            label: "Feriados trabajados",
            group: "Jornada y feriados",
            inputType: "number",
            rowType: "remunerative",
            calculation: "percentOfBase",
            percent: 3.333333,
            base: "seniorityBase",
            detail: "Valor diario estimado sobre basico + antiguedad. Controlar caso particular antes de emitir.",
            subjectToSocialSecurity: true
          },
          {
            id: "horas-nocturnas-adicional",
            label: "Horas nocturnas adicional",
            group: "Jornada y feriados",
            inputType: "number",
            rowType: "remunerative",
            calculation: "percentOfBase",
            percent: 13.333333,
            base: "categoryHourly",
            detail: "Adicional horario configurable para control humano segun jornada declarada.",
            subjectToSocialSecurity: true
          },
          {
            id: "ajuste-no-remunerativo-controlado",
            label: "Ajuste no remunerativo controlado",
            group: "Ajustes auditables",
            inputType: "number",
            rowType: "nonRemunerative",
            calculation: "fixed",
            amount: 1,
            base: "basic",
            detail: "Usar solo para diferencias aprobadas por auditoria humana.",
            subjectToSocialSecurity: false
          },
          ...commerceAdditionals
        ],
        deductions: [],
        employerContributions: []
      },
      auditChecklist: [
        "Verificar que la escala vigente corresponda al periodo liquidado.",
        "Controlar que la categoria del legajo coincida con las tareas reales del CCT 130/75.",
        "Validar antiguedad 1% por año sobre remunerativo y no remunerativo.",
        "Validar presentismo Art. 40 sobre remunerativo y no remunerativo, salvo inasistencias injustificadas.",
        "Controlar que los no remunerativos abril-junio se incorporen correctamente y que julio no los duplique.",
        "Revisar aportes y contribuciones generales aplicados por el motor eSueldos."
      ],
      confidence: warnings.length ? 90 : 94,
      warnings,
      notes: notesList,
      sourceFiles: [cctPdf?.sourceFileName, scalePdf?.sourceFileName].filter(Boolean)
    }
  }, { fallbackName: draftName || "Empleados de Comercio - CCT 130/75" });
}

module.exports = {
  GeminiConventionError,
  extractConventionFromPdfs,
  normalizeConvention,
  buildConventionPrompt,
  conventionAttachmentParts,
  looksLikeHairdressers730,
  isLikelySalaryCategoryLabel,
  parseGenericDocumentConcepts,
  parseGenericDocumentDeductions,
  parseGenericDocumentRules,
  parseGenericScaleAdditionals,
  parseGenericScaleCategories,
  parseCommerceCategories,
  parseCommerceScaleAdditionals,
  enrichConventionWithDocumentConcepts,
  sanitizeGenericConventionCategories,
  UNIVERSAL_CONVENTION_TEMPLATE
};
