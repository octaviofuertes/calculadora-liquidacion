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

const UNIVERSAL_CONVENTION_TEMPLATE = require("../convenio-universal-template.json");

function modelList(primaryModel, fallbackModels = []) {
  return [primaryModel, ...fallbackModels]
    .filter(Boolean)
    .map((item) => String(item).trim())
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index);
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

function normalizeMoneyMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.entries(value).reduce((acc, [key, amount]) => {
    const period = periodFromText(key) || key;
    const normalized = normalizeMoney(amount);
    if (period && normalized !== null) acc[period] = normalized;
    return acc;
  }, {});
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
          nonRem[period] = normalizeMoney(value) || 0;
        });
      }
      if (!Object.keys(nonRem).length && row.nonRemunerative !== undefined) {
        periodIds.forEach((period) => {
          nonRem[period] = normalizeMoney(row.nonRemunerative) || 0;
        });
      }
      return {
        id,
        label: String(label),
        group: row.group || row.grupo || "",
        description: row.description || row.descripcion || "",
        monthly: normalizeMoney(row.monthly ?? row.sueldoMensual ?? row.basicoMensual),
        day: normalizeMoney(row.day ?? row.jornal ?? row.valorDia),
        hourly: normalizeMoney(row.hourly ?? row.hora ?? row.valorHora),
        monthlyByPeriod,
        dayByPeriod,
        hourlyByPeriod,
        nonRem,
        commissionPercent: Number(row.commissionPercent ?? row.comisionPorcentaje ?? 0) || null,
        normalWeeklyHours: Number(row.normalWeeklyHours ?? row.horasSemanales ?? 0) || null,
        legalReferences: Array.isArray(row.legalReferences || row.referenciasLegales) ? (row.legalReferences || row.referenciasLegales).filter(Boolean).map(String) : [],
        notes: Array.isArray(row.notes) ? row.notes.filter(Boolean).map(String) : []
      };
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

function normalizeConcepts(concepts) {
  if (!Array.isArray(concepts)) return [];
  return concepts
    .map((concept, index) => {
      const label = concept.label || concept.name || `Concepto ${index + 1}`;
      const inputType = ["checkbox", "number"].includes(concept.inputType) ? concept.inputType : (concept.type === "number" ? "number" : "checkbox");
      const rowType = ["remunerative", "nonRemunerative", "deduction"].includes(concept.rowType) ? concept.rowType : "remunerative";
      const calculation = ["fixed", "percentOfBase", "amountPerUnit"].includes(concept.calculation) ? concept.calculation : "percentOfBase";
      const normalized = {
        id: normalizeText(concept.id || label || `concepto-${index + 1}`),
        label: String(label),
        group: concept.group || "Adicionales",
        inputType,
        rowType,
        calculation,
        defaultValue: concept.defaultValue ?? (inputType === "checkbox" ? false : 0),
        amount: normalizeMoney(concept.amount),
        amountByPeriod: normalizeMoneyMap(concept.amountByPeriod || concept.amountPorPeriodo),
        unitAmount: normalizeMoney(concept.unitAmount),
        unitAmountByPeriod: normalizeMoneyMap(concept.unitAmountByPeriod || concept.valorUnidadPorPeriodo),
        percent: Number(concept.percent ?? concept.pct ?? 0) || 0,
        base: concept.base || "basic",
        detail: concept.detail || concept.legalReference || "",
        subjectToSocialSecurity: concept.subjectToSocialSecurity !== false,
        subjectToHealthInsurance: concept.subjectToHealthInsurance !== false,
        subjectToART: concept.subjectToART !== false,
        taxableIncome: concept.taxableIncome === true,
        requiresHumanValidation: concept.requiresHumanValidation === true,
        notes: Array.isArray(concept.notes) ? concept.notes.filter(Boolean).map(String) : []
      };
      ["conditions", "proration", "rounding", "legalReferences", "audit", "ui", "tags"].forEach((key) => {
        if (concept[key] !== undefined) normalized[key] = concept[key];
      });
      return normalized;
    })
    .filter((concept) => concept.id && concept.label);
}

function normalizeDeductions(deductions) {
  if (!Array.isArray(deductions)) return [];
  return deductions
    .map((item, index) => {
      const normalized = {
        id: normalizeText(item.id || item.label || `deduccion-${index + 1}`),
        label: item.label || item.name || `Deduccion ${index + 1}`,
        percent: Number(item.percent ?? item.pct ?? 0) || 0,
        amount: normalizeMoney(item.amount),
        amountByPeriod: normalizeMoneyMap(item.amountByPeriod || item.amountPorPeriodo),
        base: item.base || "remunerative",
        appliesWhen: item.appliesWhen || "",
        detail: item.detail || item.legalReference || "",
        requiresHumanValidation: item.requiresHumanValidation === true
      };
      ["conditions", "legalReferences", "audit", "ui", "tags"].forEach((key) => {
        if (item[key] !== undefined) normalized[key] = item[key];
      });
      return normalized;
    })
    .filter((item) => item.id && item.label && (item.percent || item.amount || Object.values(item.amountByPeriod || {}).some(Boolean)));
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

function normalizeConvention(parsed, { fallbackName = "Convenio generado por leIA" } = {}) {
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
  if (!periods.length) {
    const current = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
    periods.push({ id: current, label: monthLabel(current) });
  }
  const periodIds = periods.map((period) => period.id);
  const zones = Array.isArray(source.zones || source.zonas)
    ? (source.zones || source.zonas).map((zone, index) => ({
      id: normalizeText(zone.id || zone.label || zone.name || `zona-${index + 1}`),
      label: zone.label || zone.name || zone.zona || `Zona ${index + 1}`,
      coef: Number(zone.coef ?? zone.coefficient ?? zone.coeficiente ?? 1) || 1
    })).filter((zone) => zone.id && zone.label)
    : [];
  if (!zones.length) zones.push({ id: "general", label: "General", coef: 1 });

  const categories = normalizeRows(source.categories || source.categorias || source.rows, periodIds);
  const concepts = normalizeConcepts(source.liquidationModel?.concepts || source.concepts || source.conceptos);
  const deductions = normalizeDeductions(source.liquidationModel?.deductions || source.deductions || source.aportesTrabajador);
  const employerContributions = normalizeDeductions(source.liquidationModel?.employerContributions || source.employerContributions || source.contribucionesEmpleador);
  const warnings = Array.isArray(source.warnings || source.alertas)
    ? (source.warnings || source.alertas).filter(Boolean).map(String)
    : [];

  if (!categories.length) warnings.push("No se detectaron categorias con importes. Completar antes de aprobar.");

  const salaryType = source.type || source.liquidationModel?.rules?.salaryType || (categories.some((cat) => cat.day) ? "daily" : "monthly");
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
    rules: {
      ...(source.rules && typeof source.rules === "object" ? source.rules : {}),
      monthDivisor: Number(source.rules?.monthDivisor ?? source.liquidationModel?.rules?.monthDivisor ?? 30) || 30,
      hourDivisor: Number(source.rules?.hourDivisor ?? source.liquidationModel?.rules?.hourDivisor ?? 200) || 200,
      weeklyHours: Number(source.rules?.weeklyHours ?? source.liquidationModel?.rules?.weeklyHours ?? 48) || 48
    },
    liquidationModel: {
      version: "generic-v1",
      rules: {
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
          ...(source.liquidationModel?.rules?.nonRemunerativeScale && typeof source.liquidationModel.rules.nonRemunerativeScale === "object" ? source.liquidationModel.rules.nonRemunerativeScale : {}),
          enabled: source.liquidationModel?.rules?.nonRemunerativeScale?.enabled !== false
        },
        overtime: {
          ...(source.liquidationModel?.rules?.overtime && typeof source.liquidationModel.rules.overtime === "object" ? source.liquidationModel.rules.overtime : {}),
          enabled: source.liquidationModel?.rules?.overtime?.enabled !== false,
          divisor: Number(source.liquidationModel?.rules?.overtime?.divisor ?? source.rules?.hourDivisor ?? 200) || 200
        }
      },
      concepts,
      deductions,
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

function universalConventionTemplateForPrompt(draftName) {
  const template = JSON.parse(JSON.stringify(UNIVERSAL_CONVENTION_TEMPLATE));
  template.id = "slug-corto-sin-acentos";
  template.name = draftName || "Nombre del convenio - CCT";
  template.shortName = "Nombre corto";
  template.metadata.status = "draft";
  template.extraction.extractedAt = new Date().toISOString();
  return { convention: template };
}

function buildConventionPrompt({ draftName, notes }) {
  return [
    "Sos leIA, contadora laboral senior de Argentina e ingeniera de sistemas especialista en liquidacion de sueldos multiconvenio.",
    "Tu tarea es leer el CCT y la escala salarial adjunta para generar un JSON de convenio COMPLETO, auditable y ejecutable por eSueldos.",
    "No escribas explicaciones fuera del JSON. No inventes montos, porcentajes ni articulos. Si un dato no esta claro, usa null/0, marca requiresHumanValidation=true y deja una warning bloqueante solo si impide aprobar.",
    "El JSON debe servir para mensual, jornal, hora, zonas, coeficientes, categorias, escalas por periodo, no remunerativos, antiguedad, presentismo, horas extra, feriados, vacaciones, adicionales, aportes del trabajador, contribuciones del empleador y auditoria humana.",
    "Usa schemaVersion esueldos-convenio-universal-v1 y calculationMode generic-v1. Los periodos deben ser YYYY-MM. Los ids deben ser estables, sin espacios ni acentos.",
    "Toda categoria debe traer monthly, day u hourly, y si la escala trae varios meses usa monthlyByPeriod/dayByPeriod/hourlyByPeriod y nonRem por periodo.",
    "Todo concepto variable debe ir en liquidationModel.concepts con inputType checkbox/number, rowType remunerative/nonRemunerative/deduction, calculation fixed/percentOfBase/amountPerUnit, base, tratamiento de aportes, condiciones, referencias legales y detalle.",
    "Las deducciones propias del trabajador van en liquidationModel.deductions. Las contribuciones propias del empleador van en liquidationModel.employerContributions. No agregues Jubilacion/PAMI/Obra Social/Ganancias generales porque eSueldos ya las calcula.",
    "Inclui auditChecklist, validation, employeeRequirements y notes para que el liquidador humano pueda auditar el convenio antes de aprobarlo.",
    "Devolve JSON valido con esta forma exacta y completa:",
    JSON.stringify(universalConventionTemplateForPrompt(draftName), null, 2),
    notes ? `Notas del usuario: ${notes}` : "Notas del usuario: sin notas."
  ].join("\n");
}

async function requestConventionOnce({ apiKey, model, cctPdf, scalePdf, draftName, notes }) {
  const parts = [{ text: buildConventionPrompt({ draftName, notes }) }];
  if (cctPdf?.buffer) {
    parts.push({
      inlineData: {
        mimeType: cctPdf.mimeType || "application/pdf",
        data: cctPdf.buffer.toString("base64")
      }
    });
  }
  if (scalePdf?.buffer) {
    parts.push({
      inlineData: {
        mimeType: scalePdf.mimeType || "application/pdf",
        data: scalePdf.buffer.toString("base64")
      }
    });
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
  const text = extractGeminiText(payload);
  if (!text) {
    throw new GeminiConventionError("Gemini no devolvio texto para el convenio.", { status: 502, model });
  }
  return normalizeConvention(parseGeminiJson(text), { fallbackName: draftName });
}

async function extractConventionFromPdfs({ apiKey, model, fallbackModels, cctPdf, scalePdf, draftName, notes }) {
  const models = modelList(model, fallbackModels);
  const errors = [];
  for (const currentModel of models) {
    try {
      const parsedConvention = await requestConventionOnce({
        apiKey,
        model: currentModel,
        cctPdf,
        scalePdf,
        draftName,
        notes
      });
      return {
        parsedConvention,
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

function moneyValuesFromText(value) {
  return [...String(value || "").matchAll(/\d{1,3}(?:\.\d{3})+(?:,\d{2})?|\d{1,3},\d{2}/g)].map((match) => parseArgMoney(match[0]));
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

function parseGenericScaleCategories(scaleText, period, { stopAtTotals = false } = {}) {
  const lines = String(scaleText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const categories = [];
  const seen = new Set();
  let currentGroup = "Escala";

  for (const line of lines) {
    const folded = asciiFold(line);
    if (stopAtTotals && /(TOTAL A ABONAR|LA SUMA FIJA|LOS ADICIONALES EXTRAORDINARIOS)/i.test(folded)) break;
    if (isUsefulScaleHeader(line)) {
      currentGroup = line.replace(/\s+/g, " ").trim();
      continue;
    }
    const values = moneyValuesFromText(line);
    if (!values.length) continue;
    const label = labelBeforeFirstAmount(line);
    if (!isUsefulCategoryLabel(label)) continue;
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

function looksLikeHairdressers730({ draftName, notes, cctText, scaleText, cctPdf, scalePdf }) {
  const haystack = asciiFold([
    draftName,
    notes,
    cctPdf?.sourceFileName,
    scalePdf?.sourceFileName,
    cctText.slice(0, 12000),
    scaleText.slice(0, 5000)
  ].join(" "));
  return haystack.includes("730/15")
    || haystack.includes("730-15")
    || haystack.includes("PELUQUER")
    || haystack.includes("FENTPEA")
    || haystack.includes("TRABAJADORES DE PELUQUERIA");
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

function buildGenericConventionFromScale({ draftName, notes, cctPdf, scalePdf, scaleText, aiError }) {
  const period = detectMainPeriodFromText({
    text: scaleText,
    fileName: scalePdf?.sourceFileName
  });
  const categories = parseGenericScaleCategories(scaleText, period);
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
  const warnings = parsedScale.warnings;
  const notesList = [
    "Estructurado con lector local de PDF para CCT 130/75 cuando Gemini no entrego JSON valido.",
    "La circular FAECYS 04/2026 informa basico remunerativo y sumas no remunerativas para abril, mayo, junio y julio 2026.",
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
          }
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

async function tryBuildLocalConventionFallback({ cctPdf, scalePdf, draftName, notes, aiError, allowGeneric = false }) {
  const [cctText, scaleText] = await Promise.all([
    extractPdfTextLocal(cctPdf).catch(() => ""),
    extractPdfTextLocal(scalePdf).catch(() => "")
  ]);

  if (looksLikePharmacyMendoza({ draftName, notes, cctText, scaleText, cctPdf, scalePdf })) {
    const pharmacyConvention = buildPharmacyConvention({
      draftName,
      notes,
      cctPdf,
      scalePdf,
      scaleText
    });
    if (pharmacyConvention?.categories?.length) {
      return {
        parsedConvention: pharmacyConvention,
        model: "local-pdf-parse/farmacia-mendoza-cct-429-05",
        modelsTried: ["local-pdf-parse/farmacia-mendoza-cct-429-05"]
      };
    }
  }

  if (looksLikeCommerce130({ draftName, notes, cctText, scaleText, cctPdf, scalePdf })) {
    const parsedConvention = buildCommerceConvention({
      draftName,
      notes,
      cctPdf,
      scalePdf,
      cctText,
      scaleText,
      aiError
    });
    if (parsedConvention?.categories?.length) {
      return {
        parsedConvention,
        model: "local-pdf-parse/comercio-cct-130-75",
        modelsTried: ["local-pdf-parse/comercio-cct-130-75"]
      };
    }
  }

  if (looksLikeHairdressers730({ draftName, notes, cctText, scaleText, cctPdf, scalePdf })) {
    const hairConvention = buildHairdressersConvention({
      draftName,
      notes,
      cctPdf,
      scalePdf,
      cctText,
      scaleText
    });
    if (hairConvention?.categories?.length) {
      return {
        parsedConvention: hairConvention,
        model: "local-pdf-parse/peluqueros-cct-730-15",
        modelsTried: ["local-pdf-parse/peluqueros-cct-730-15"]
      };
    }
  }

  if (allowGeneric) {
    const genericConvention = buildGenericConventionFromScale({
      draftName,
      notes,
      cctPdf,
      scalePdf,
      scaleText,
      aiError
    });
    if (genericConvention?.categories?.length) {
      return {
        parsedConvention: genericConvention,
        model: "local-pdf-parse/generic-scale-parser",
        modelsTried: ["local-pdf-parse/generic-scale-parser"]
      };
    }
  }

  return null;
}

module.exports = {
  GeminiConventionError,
  extractConventionFromPdfs,
  tryBuildLocalConventionFallback,
  normalizeConvention,
  buildConventionPrompt,
  UNIVERSAL_CONVENTION_TEMPLATE
};
