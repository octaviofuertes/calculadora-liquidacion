const ENGINE_VERSION = "backend-payroll-engine-v3";

function amount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function round2(value) {
  return Math.round((amount(value) + Number.EPSILON) * 100) / 100;
}

function addRow(list, label, value, detail = "") {
  if (!Number.isFinite(Number(value)) || Math.abs(Number(value)) < 0.005) return;
  list.push({ label, amount: round2(Number(value)), detail });
}

function sumRows(rows = []) {
  return rows.reduce((total, row) => total + amount(row.amount), 0);
}

function inputValue(inputs, key, fallback = 0) {
  const value = inputs?.[key];
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value ? 1 : 0;
  const normalized = Number(String(value).replace(",", "."));
  return Number.isFinite(normalized) ? normalized : fallback;
}

function inputString(inputs, key, fallback = "") {
  const value = inputs?.[key];
  return value === undefined || value === null ? fallback : String(value);
}

function inputBool(inputs, key, fallback = false) {
  const value = inputs?.[key];
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["true", "1", "on", "si", "yes"].includes(String(value).toLowerCase());
}

function yearsFromEntry(entryDate, now = new Date()) {
  if (!entryDate) return 0;
  const start = new Date(`${entryDate}T00:00:00`);
  if (Number.isNaN(start.getTime())) return 0;
  let years = now.getFullYear() - start.getFullYear();
  const month = now.getMonth() - start.getMonth();
  if (month < 0 || (month === 0 && now.getDate() < start.getDate())) years -= 1;
  return Math.max(0, years);
}

function firstFinite(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

function normalizeMatchText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeZoneMatchText(value) {
  const normalized = normalizeMatchText(value);
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
  ].includes(normalized) ? "general" : normalized;
}

function scaleRowMatchesZone(row, zone) {
  const rowZone = normalizeZoneMatchText(row?.zone);
  const zoneId = normalizeZoneMatchText(zone?.id);
  const zoneLabel = normalizeZoneMatchText(zone?.label);
  return Boolean(rowZone && ((zoneId && rowZone === zoneId) || (zoneLabel && rowZone === zoneLabel)));
}

function scaleRowMatchesModality(row, modality) {
  const selected = normalizeMatchText(modality);
  if (!selected) return true;
  const rowModality = normalizeMatchText(row?.modality || row?.modalidad || row?.modalidad_aplicable || row?.jornada || row?.alcance);
  return Boolean(rowModality && rowModality === selected);
}

function findScaleRow(rows, item, zone, modality = "") {
  if (!Array.isArray(rows) || !item) return null;
  const itemId = normalizeMatchText(item.id);
  const itemLabel = normalizeMatchText(item.label);
  const zoneId = normalizeZoneMatchText(zone?.id);
  const zoneLabel = normalizeZoneMatchText(zone?.label);
  const exactIdCandidates = rows.filter((row) => itemId && normalizeMatchText(row.id) === itemId);
  const exactLabelCandidates = rows.filter((row) => itemLabel && normalizeMatchText(row.label) === itemLabel);
  const candidates = exactIdCandidates.length ? exactIdCandidates : exactLabelCandidates;
  if (!candidates.length) return null;
  const scoped = modality ? candidates.filter((row) => scaleRowMatchesModality(row, modality)) : candidates;
  if (!scoped.length) return null;
  const exactZone = scoped.find((row) => {
    const rowZone = normalizeZoneMatchText(row.zone);
    return rowZone && ((zoneId && rowZone === zoneId) || (zoneLabel && rowZone === zoneLabel));
  });
  if (exactZone) return exactZone;
  const general = scoped.find((row) => ["", "general"].includes(normalizeZoneMatchText(row.zone)));
  if (general) return general;
  if (!zoneId && !zoneLabel && scoped.length === 1) return scoped[0];
  return null;
}

function scaleCategoryRow(activeScale, category, zone, modality = "") {
  return activeScale ? findScaleRow(activeScale.parsedScale?.categories, category, zone, modality) : null;
}

function scaleModalities(activeScale, category) {
  if (!activeScale || !category) return [];
  const categoryId = normalizeMatchText(category.id);
  const categoryLabel = normalizeMatchText(category.label);
  return Array.from(new Set((activeScale.parsedScale?.categories || [])
    .filter((row) => (categoryId && normalizeMatchText(row.id) === categoryId) || (categoryLabel && normalizeMatchText(row.label) === categoryLabel))
    .map((row) => normalizeMatchText(row.modality || row.modalidad || row.modalidad_aplicable || row.jornada || row.alcance))
    .filter(Boolean)));
}

function scaleAdditionalRow(activeScale, key, additional) {
  return activeScale ? findScaleRow(activeScale.parsedScale?.additionals, { id: key, label: additional?.label }, null) : null;
}

function periodAmountValue(source, period, names) {
  if (!source) return null;
  for (const name of names) {
    const map = source[name];
    if (map && typeof map === "object" && !Array.isArray(map) && Object.prototype.hasOwnProperty.call(map, period)) {
      const value = Number(map[period]);
      if (Number.isFinite(value)) return value;
    }
  }
  return null;
}

function periodNonRemValue(source, period) {
  if (!source) return 0;
  if (source.nonRem && typeof source.nonRem === "object") return Number(source.nonRem[period] || 0) || 0;
  if (source.nonRemunerativeByPeriod && typeof source.nonRemunerativeByPeriod === "object") return Number(source.nonRemunerativeByPeriod[period] || 0) || 0;
  return Number(source.nonRemunerative || 0) || 0;
}

function variantKeys(value, extra = []) {
  const raw = String(value || "").trim();
  return [...new Set([raw, raw.replace(/_/g, "-"), raw.replace(/-/g, "_"), raw.toLowerCase(), raw.toUpperCase(), ...extra].filter(Boolean))];
}

function resolveUocraScaleValue(source, period, zoneId, categoryId, categoryLabel = "") {
  const periodVariants = variantKeys(period);
  const zoneVariants = variantKeys(zoneId, [String(zoneId || "").replace(/^zona\s+/i, "")]);
  const categoryVariants = variantKeys(categoryId, [categoryLabel]);
  for (const p of periodVariants) {
    const periodScale = source?.[p];
    if (!periodScale) continue;
    for (const z of zoneVariants) {
      const zoneScale = periodScale[z];
      if (!zoneScale) continue;
      for (const c of categoryVariants) {
        const value = zoneScale[c];
        if (Number.isFinite(Number(value)) && Number(value) > 0) return Number(value);
      }
    }
  }
  const firstPeriod = Object.values(source || {})[0];
  const firstZone = firstPeriod && Object.values(firstPeriod)[0];
  const firstValue = firstZone && Object.values(firstZone)[0];
  return Number.isFinite(Number(firstValue)) ? Number(firstValue) : 0;
}

function calculateGanancias(constants, inputs, remunerative, civilStatus) {
  if (!inputBool(inputs, "estimateGanancias", false)) return 0;
  const annual = remunerative * 13;
  const deductions = amount(constants.gananciasDedEspecialAnual) + amount(constants.gananciasMniAnual) + (civilStatus !== "soltero" ? amount(constants.conyugeDedAnual) : 0);
  const taxable = annual - deductions;
  if (taxable <= 0) return 0;
  let tax = 0;
  (constants.gananciasScale || []).forEach((step) => {
    if (taxable > step.from) tax = amount(step.fixed) + (Math.min(taxable, step.to) - step.from) * amount(step.pct);
  });
  return Math.max(0, tax / 13);
}

function commonContext({ catalog, convention, payload, activeScale }) {
  const categoryIdNorm = normalizeMatchText(payload.categoryId);
  const category = (convention.categories || []).find((item) => normalizeMatchText(item.id) === categoryIdNorm || normalizeMatchText(item.label) === normalizeMatchText(payload.categoryLabel || ''));
  if (!category) {
    const error = new Error(`Categoria invalida para el convenio: ${payload.categoryId}`);
    error.status = 422;
    throw error;
  }
  const zoneIdNorm = normalizeMatchText(payload.zoneId);
  const zone = (convention.zones || []).find((item) => normalizeMatchText(item.id) === zoneIdNorm || normalizeMatchText(item.label) === normalizeMatchText(payload.zoneLabel || ''));
  if (!zone) {
    const error = new Error(`Zona invalida para el convenio: ${payload.zoneId}`);
    error.status = 422;
    throw error;
  }
  const employee = {
    legajo: payload.employee?.legajo || "",
    name: payload.employee?.name || "Sin nombre",
    cuil: payload.employee?.cuil || "-",
    entryDate: payload.employee?.entryDate || "-",
    civilStatus: payload.employee?.civilStatus || "soltero",
    years: yearsFromEntry(payload.employee?.entryDate)
  };
  return { constants: catalog.constants || {}, convention, category, zone, employee, inputs: payload.inputs || {}, activeScale, modality: payload.inputs?.modality || "" };
}

function applyManualRows(ctx, rows) {
  addRow(rows.remRows, "Otros remunerativos", inputValue(ctx.inputs, "otherRem", 0), "Carga manual");
  addRow(rows.noRemRows, "Otros no remunerativos", inputValue(ctx.inputs, "otherNoRem", 0), "Carga manual");
  addRow(rows.deductionRows, "Descuentos varios", inputValue(ctx.inputs, "otherDeductions", 0), "Carga manual");
}

function applyWorkerDeductions(ctx, rows, remTotal, osBase) {
  const c = ctx.constants;
  const worker = c.worker || {};
  const configured = [
    ...(ctx.convention.liquidationModel?.deductions || []),
    ...(ctx.convention.liquidationModel?.retentions || [])
  ].map(genericConceptSignature).join(" ");
  if (!ctx.convention.structuredFromConvention || !/(jubilacion|sipa)/.test(configured)) {
    addRow(rows.deductionRows, "Jubilacion SIPA 11%", remTotal * amount(worker.jubilacion), `${remTotal} x ${amount(worker.jubilacion)}`);
  }
  if (!ctx.convention.structuredFromConvention || !/(19[ .]?032|pami)/.test(configured)) {
    addRow(rows.deductionRows, "Ley 19.032 (PAMI) 3%", remTotal * amount(worker.pami), `${remTotal} x ${amount(worker.pami)}`);
  }
  if (!ctx.convention.structuredFromConvention || !/obra social/.test(configured)) {
    addRow(rows.deductionRows, "Obra social 3%", osBase * amount(worker.obraSocial), `${osBase} x ${amount(worker.obraSocial)}`);
  }

  if (ctx.convention.id === "uocra") {
    if (inputBool(ctx.inputs, "uocraAfiliado", false)) addRow(rows.deductionRows, "Cuota sindical UOCRA 2,5%", remTotal * 0.025, "Afiliado");
    else if (["abr26", "may26"].includes(ctx.payloadPeriod)) addRow(rows.deductionRows, "Aporte solidario UOCRA 2%", remTotal * 0.02, "No afiliado");
    addRow(rows.deductionRows, "Aporte UOCRA 1,8%", remTotal * 0.018, "CCT 76/75");
    addRow(rows.deductionRows, "ISTIC 0,5%", remTotal * 0.005, "CCT 76/75");
  }

  if (ctx.convention.id === "farmacia") {
    const rules = ctx.convention.rules || {};
    if (inputBool(ctx.inputs, "farmAdefSolidarity", true)) addRow(rows.deductionRows, `Aporte solidario ADEF ${rules.adefSolidarityPct || 2}%`, remTotal * ((rules.adefSolidarityPct || 2) / 100), "Art. 46");
    if (inputBool(ctx.inputs, "farmUnionContribution", false)) addRow(rows.deductionRows, `Cuota sindical ADEF ${rules.unionPct || 2}%`, remTotal * ((rules.unionPct || 2) / 100), "Afiliado");
    if (inputBool(ctx.inputs, "farmCajaCompensadora", false)) addRow(rows.deductionRows, `Caja compensadora ${rules.cajaCompensadoraPct || 1}%`, remTotal * ((rules.cajaCompensadoraPct || 1) / 100), "CCT 429/05");
    if (inputBool(ctx.inputs, "farmProEdificio", false)) addRow(rows.deductionRows, `Pro edificio ${rules.proEdificioPct || 1}%`, remTotal * ((rules.proEdificioPct || 1) / 100), "CCT 429/05");
    if (inputBool(ctx.inputs, "farmContribution", true)) addRow(rows.deductionRows, "Contribucion extraordinaria escala", amount(ctx.convention.extraordinaryContribution?.[ctx.payloadPeriod]), "Valor de escala");
  }

  if (ctx.convention.id === "camioneros") {
    if (inputBool(ctx.inputs, "camUnionFee", true)) addRow(rows.deductionRows, "Cuota sindical Camioneros 2%", remTotal * 0.02, "Afiliado");
    if (inputBool(ctx.inputs, "camSolidarityContribution", true)) addRow(rows.deductionRows, "Contribucion solidaria Camioneros 3%", remTotal * 0.03, "Item 8.1.1");
    if (inputBool(ctx.inputs, "camFuneralInsurance", true)) addRow(rows.deductionRows, "Seguro de Sepelio 1,5%", remTotal * 0.015, "Item 8.1.6");
  }

  addRow(rows.deductionRows, "Ganancias 4ta categoria", calculateGanancias(c, ctx.inputs, remTotal, ctx.employee.civilStatus), "Estimacion anualizada");
}

function genericConventionItemBase(item, remTotal, noRemTotal, basic) {
  const base = normalizeMatchText(item?.base || "remunerative");
  if (["gross", "bruto", "total haberes"].includes(base)) return remTotal + noRemTotal;
  if (["nonremunerative", "non remunerative", "no remunerativo"].includes(base)) return noRemTotal;
  if (["basic", "basico"].includes(base)) return basic;
  if (["obra social", "base obra social", "remuneracion sujeta a obra social"].includes(base)) return remTotal + noRemTotal;
  return remTotal;
}

function genericConceptSignature(concept) {
  return normalizeMatchText([
    concept?.id,
    concept?.label,
    concept?.group,
    concept?.calculation,
    concept?.unidad_calculo,
    concept?.formula_base,
    concept?.base,
    concept?.detail,
    concept?.naturaleza
  ].filter(Boolean).join(" "));
}

function genericConceptUsesQuantity(concept) {
  const signature = genericConceptSignature(concept);
  return concept?.calculation === "amountPerUnit"
    || /\b(cantidad|valor unitario|por dia|diario|valor dia|por hora|valor hora|kilometr|km|viaje|traslado|viatic|pernoct|comida)\b/.test(signature);
}

function genericConceptUsesNumberInput(concept) {
  return concept?.inputType === "number" || genericConceptUsesQuantity(concept);
}

function genericConceptUnitAmount(ctx, concept, period) {
  const configured = periodAmountValue(concept, period, ["unitAmountByPeriod", "valorUnidadPorPeriodo"]) ?? amount(concept?.unitAmount || concept?.amount);
  return configured || inputValue(ctx.inputs, `gen_${concept.id}_unit`, 0);
}

function genericConceptRowType(concept) {
  const signature = genericConceptSignature(concept);
  if (/(no remunerativo|non remunerative|nonremunerative)/.test(signature)) return "nonRemunerative";
  if (/(deduction|deduccion|descuento|retencion|retention)/.test(signature)) return "deduction";
  return concept?.rowType || "remunerative";
}

function applyGenericConventionDeductions(ctx, rows, remTotal, noRemTotal, basic) {
  const model = ctx.convention.liquidationModel || {};
  const applyItems = (items, targetRows, fallbackDetail, userSelectable = false, inputPrefix = "gen_deduction") => {
    (items || []).forEach((item) => {
      if (userSelectable && !inputBool(ctx.inputs, `${inputPrefix}_${item.id}`, item.defaultValue !== false)) return;
      const base = genericConventionItemBase(item, remTotal, noRemTotal, basic);
      const fixedAmount = periodAmountValue(item, ctx.payloadPeriod, ["amountByPeriod", "amountPorPeriodo"]) ?? amount(item.amount);
      const value = fixedAmount || base * ((Number(item.percent || 0) || 0) / 100);
      const detail = fixedAmount ? `${fixedAmount}` : `${base} x ${Number(item.percent || 0) || 0} / 100`;
      addRow(targetRows, item.label, value, item.detail ? `${detail} - ${item.detail}` : `${detail} - ${fallbackDetail}`);
    });
  };
  applyItems(model.deductions, rows.deductionRows, "Aporte propio del convenio", true);
  applyItems(model.retentions, rows.deductionRows, "Retencion propia del convenio", true, "gen_retention");
  applyItems(model.employerContributions, rows.employerRows, "Contribucion propia del convenio");
}

function applyEmployerContribs(ctx, rows, remTotal, osBase, baseSalary = remTotal) {
  const c = ctx.constants;
  const er = c.employerBase || {};
  if (!ctx.convention.structuredFromConvention) {
    const baseSS = Math.max(0, remTotal - amount(c.detss));
    addRow(rows.employerRows, "Jubilacion empleador 10,77%", baseSS * amount(er.jubilacion), "Base SS");
    addRow(rows.employerRows, "PAMI empleador 1,58%", baseSS * amount(er.pami), "Base SS");
    addRow(rows.employerRows, "Obra social empleador 6%", osBase * amount(er.obraSocial), "Base OS");
    addRow(rows.employerRows, "Asignaciones familiares 4,70%", baseSS * amount(er.asignaciones), "Base SS");
    addRow(rows.employerRows, "Fondo nacional de empleo 0,95%", baseSS * amount(er.fondoEmpleo), "Base SS");
    addRow(rows.employerRows, `ART variable ${c.artVariablePct || 0}%`, remTotal * (amount(c.artVariablePct) / 100), "Configurable");
    addRow(rows.employerRows, "ART cuota fija", amount(c.artFixed), "Configurable");
    addRow(rows.employerRows, "SCVO", amount(c.scvo), "Configurable");
  }
  if (ctx.convention.id === "uocra") {
    addRow(rows.employerRows, "Contribucion UOCRA 2,30%", remTotal * 0.023, "CCT 76/75");
    addRow(rows.employerRows, "ISTIC empleador 0,50%", remTotal * 0.005, "CCT 76/75");
    if (["abr26", "may26"].includes(ctx.payloadPeriod)) addRow(rows.employerRows, "Contribucion empresarial UOCRA", 6000, "Escala 2026");
  }
  if (ctx.convention.id === "camioneros") {
    addRow(rows.employerRows, "Aporte empresario sindical 2%", baseSalary * 0.02, "Item 8.1.2");
    addRow(rows.employerRows, "Aporte capacitacion Federacion 0,5%", baseSalary * 0.005, "Item 8.1.4");
    addRow(rows.employerRows, "Aporte profesionalizacion 2%", baseSalary * 0.02, "Item 8.1.5");
  }
}

function emptyRows() {
  return { remRows: [], noRemRows: [], deductionRows: [], employerRows: [], details: [] };
}

function buildResult(ctx, rows, warnings = []) {
  const remRows = rows.remRows || [];
  const noRemRows = rows.noRemRows || rows.nonRemRows || [];
  const deductionRows = rows.deductionRows || [];
  const employerRows = rows.employerRows || [];
  const details = rows.details || [];

  const remTotal = round2(sumRows(remRows));
  const noRemTotal = round2(sumRows(noRemRows));
  const gross = round2(remTotal + noRemTotal);
  const deductions = round2(sumRows(deductionRows));
  const employerContribs = round2(sumRows(employerRows));
  const net = round2(gross - deductions);
  return {
    conventionId: ctx.convention.id,
    conventionName: ctx.convention.name,
    conv: ctx.convention,
    period: ctx.payloadPeriod,
    employee: ctx.employee,
    category: ctx.category,
    zone: ctx.zone,
    activeScales: ctx.activeScale?.availableScales || [],
    activeScale: ctx.activeScale ? {
      id: ctx.activeScale.id,
      period: ctx.activeScale.period,
      periodLabel: ctx.activeScale.periodLabel,
      approvedAt: ctx.activeScale.approvedAt,
      availableScales: ctx.activeScale.availableScales || []
    } : null,
    remunerative: remRows,
    nonRemunerative: noRemRows,
    deductions: deductionRows,
    employer: employerRows,
    details: details,
    remRows: remRows,
    noRemRows: noRemRows,
    deductionRows: deductionRows,
    employerRows: employerRows,
    totals: { remTotal, noRemTotal, gross, deductions, employerContribs, net, employerCost: round2(gross + employerContribs) },
    calculation: {
      engine: ctx.convention.calculationMode || ctx.convention.id || "generic-v1",
      version: ENGINE_VERSION,
      calculatedAt: new Date().toISOString(),
      warnings
    }
  };
}

function calcGeneric(ctx) {
  const rows = emptyRows();
  const warnings = [];
  const period = ctx.payloadPeriod;
  const availableModalities = scaleModalities(ctx.activeScale, ctx.category);
  if (availableModalities.length > 1 && !ctx.modality) {
    const error = new Error("Selecciona la modalidad laboral para esta categoria");
    error.status = 422;
    throw error;
  }
  const activeCatRow = scaleCategoryRow(ctx.activeScale, ctx.category, ctx.zone, ctx.modality);
  if (ctx.activeScale && !activeCatRow) {
    const error = new Error("La escala vigente no contiene un valor para la categoria, modalidad y zona seleccionadas");
    error.status = 422;
    throw error;
  }
  const model = ctx.convention.liquidationModel || {};
  const rules = { ...(ctx.convention.rules || {}), ...(model.rules || {}) };
  rules.nonRemunerativeScale = {
    ...(rules.nonRemunerativeScale || {}),
    ...(ctx.activeScale?.parsedScale?.nonRemunerativeRules || ctx.activeScale?.parsedScale?.reglasNoRemunerativas || {})
  };
  const zoneCoef = Number(ctx.zone?.coef || 1) || 1;
  const scaleCoef = scaleRowMatchesZone(activeCatRow, ctx.zone) ? 1 : zoneCoef;
  const monthPct = Math.max(0, Math.min(100, inputValue(ctx.inputs, "genMonthPct", 100))) / 100;
  const monthDivisor = Number(rules.monthDivisor || 30) || 30;
  const hourDivisor = Number(rules.overtime?.divisor || rules.hourDivisor || 200) || 200;
  const absentDays = Math.max(0, inputValue(ctx.inputs, "genAbsentDays", 0));
  const categoryMonthlyRaw = firstFinite(activeCatRow?.monthly, periodAmountValue(activeCatRow, period, ["monthlyByPeriod", "monthlyByPeriodo", "basicoPorPeriodo"]), periodAmountValue(ctx.category, period, ["monthlyByPeriod", "monthlyByPeriodo", "basicoPorPeriodo"]), ctx.category.monthly);
  const categoryDayRaw = firstFinite(activeCatRow?.day, periodAmountValue(activeCatRow, period, ["dayByPeriod", "jornalPorPeriodo", "valorDiaPorPeriodo"]), periodAmountValue(ctx.category, period, ["dayByPeriod", "jornalPorPeriodo", "valorDiaPorPeriodo"]), ctx.category.day);
  const categoryHourlyRaw = firstFinite(activeCatRow?.hourly, periodAmountValue(activeCatRow, period, ["hourlyByPeriod", "horaPorPeriodo", "valorHoraPorPeriodo"]), periodAmountValue(ctx.category, period, ["hourlyByPeriod", "horaPorPeriodo", "valorHoraPorPeriodo"]), ctx.category.hourly);
  const categoryMonthly = (categoryMonthlyRaw || 0) * scaleCoef;
  const categoryDay = (firstFinite(categoryDayRaw, categoryMonthly ? categoryMonthly / monthDivisor : null) || 0) * (activeCatRow?.day || ctx.category.day ? scaleCoef : 1);
  const categoryHourly = (firstFinite(categoryHourlyRaw, categoryDay ? categoryDay / 8 : null, categoryMonthly ? categoryMonthly / hourDivisor : null) || 0) * (activeCatRow?.hourly || ctx.category.hourly ? scaleCoef : 1);
  const explicitSalaryType = inputString(ctx.inputs, "genSalaryType", "");
  const availableSalaryTypes = [categoryMonthlyRaw > 0 && "monthly", categoryDayRaw > 0 && "daily", categoryHourlyRaw > 0 && "hourly"].filter(Boolean);
  const salaryType = explicitSalaryType || (availableSalaryTypes.length === 1 ? availableSalaryTypes[0] : rules.salaryType || ctx.category.salaryType || ctx.convention.type || "monthly");
  if (!availableSalaryTypes.includes(salaryType)) {
    const error = new Error(`La escala no contiene un importe ${salaryType === "hourly" ? "por hora" : salaryType === "daily" ? "por jornal" : "mensual"} para la seleccion actual`);
    error.status = 422;
    throw error;
  }
  const workUnits = Math.max(0, inputValue(ctx.inputs, "genWorkUnits", salaryType === "hourly" ? hourDivisor : monthDivisor));
  if (salaryType !== "monthly" && workUnits <= 0) {
    const error = new Error(`Ingresa la cantidad de ${salaryType === "hourly" ? "horas" : "jornales"} trabajados`);
    error.status = 422;
    throw error;
  }
  let basic = salaryType === "daily" ? categoryDay * workUnits : salaryType === "hourly" ? categoryHourly * workUnits : categoryMonthly * monthPct;
  addRow(rows.remRows, "Basico", basic, salaryType === "monthly" ? `${categoryMonthly} x ${monthPct * 100} / 100` : `${salaryType === "hourly" ? categoryHourly : categoryDay} x ${workUnits}`);
  const presentismRule = rules.presentism || {};
  const hasPresentism = inputBool(ctx.inputs, "genPresentism", presentismRule.enabled && Number(presentismRule.percent || 0) > 0);
  const presentismPct = hasPresentism ? (Number(presentismRule.percent || 0) / 100) : 0;

  const absenceDiscount = salaryType === "monthly" ? (basic / monthDivisor) * absentDays : categoryDay * absentDays;
  addRow(rows.remRows, "Inasistencia injustificada", -absenceDiscount, salaryType === "monthly" ? `${basic} / ${monthDivisor} x ${absentDays}` : `${categoryDay} x ${absentDays}`);
  const seniorityRule = rules.seniority || {};
  let seniority = 0;
  if (inputBool(ctx.inputs, "genSeniority", seniorityRule.enabled !== false)) {
    const yearsForCalc = seniorityRule.capYears ? Math.min(ctx.employee.years, Number(seniorityRule.capYears)) : ctx.employee.years;
    seniority = basic * ((Number(seniorityRule.percentPerYear || 0) * yearsForCalc) / 100);
    addRow(rows.remRows, "Antiguedad", seniority, `${basic} x ${seniorityRule.percentPerYear || 0} x ${yearsForCalc} / 100`);
  }
  if (hasPresentism && (!presentismRule.requiresNoUnjustifiedAbsence || absentDays === 0)) {
    addRow(rows.remRows, "Presentismo", (basic + seniority) * ((Number(presentismRule.percent || 0) || 0) / 100), `${basic + seniority} x ${presentismRule.percent || 0} / 100`);
  }
  const hourValue = (sumRows(rows.remRows) || basic) / hourDivisor;
  const extra50 = inputValue(ctx.inputs, "genExtra50", 0);
  const extra100 = inputValue(ctx.inputs, "genExtra100", 0);
  addRow(rows.remRows, "Horas extra 50%", hourValue * extra50 * 1.5, `${hourValue} x ${extra50} x 1.5`);
  addRow(rows.remRows, "Horas extra 100%", hourValue * extra100 * 2, `${hourValue} x ${extra100} x 2`);
  const noRemScaleBase = (firstFinite(activeCatRow?.nonRemunerative, periodNonRemValue(ctx.category, period)) || 0) * monthPct * scaleCoef;
  (model.concepts || []).forEach((concept) => {
    const key = `gen_${concept.id}`;
    const enabled = genericConceptUsesNumberInput(concept) ? inputValue(ctx.inputs, key, 0) : (inputBool(ctx.inputs, key, !!concept.defaultValue) ? 1 : 0);
    if (!enabled || genericConceptRowType(concept) === "reference") return;
    const baseKey = normalizeMatchText(concept.base || "basic");
    const base = ["remunerative", "total remunerativo", "haberes remunerativos"].includes(baseKey) ? sumRows(rows.remRows)
      : ["nonremunerativescale", "no remunerativo"].includes(baseKey) ? noRemScaleBase
        : ["senioritybase", "basico con antiguedad"].includes(baseKey) ? basic + seniority
          : ["categoryhourly", "valor hora"].includes(baseKey) ? categoryHourly
            : ["categoryday", "valor dia", "jornal"].includes(baseKey) ? categoryDay : basic;
    const usesQuantity = genericConceptUsesQuantity(concept);
    const unitAmount = genericConceptUnitAmount(ctx, concept, period);
    const isNumberInput = concept.inputType === "number" || usesQuantity;
    const pct = Number(concept.percent) > 0 ? Number(concept.percent) : (isNumberInput ? enabled : 0);
    const multiplier = Number(concept.percent) > 0 ? enabled : 1;

    let value = usesQuantity
      ? unitAmount * enabled
      : concept.calculation === "fixed"
        ? (periodAmountValue(concept, period, ["amountByPeriod", "amountPorPeriodo"]) ?? amount(concept.amount)) * enabled
        : concept.calculation === "amountPerUnit"
          ? unitAmount * enabled
          : base * (pct / 100) * multiplier;
    if (!value) {
      const scaleVal = activeCatRow?.conceptValues?.[concept.id] ?? periodAmountValue(ctx.category, period, [`concept_${concept.id}`]);
      if (scaleVal) value = scaleVal * monthPct * enabled;
    }
    const rowType = genericConceptRowType(concept);
    const detail = usesQuantity ? `${unitAmount} x ${enabled}`
      : concept.calculation === "fixed" ? `${value} x 1`
        : `${base} x ${pct} / 100 x ${multiplier}`;
    addRow(rowType === "nonRemunerative" ? rows.noRemRows : rowType === "deduction" ? rows.deductionRows : rows.remRows, concept.label, value, detail);
  });
  if (inputBool(ctx.inputs, "genNonRemScale", rules.nonRemunerativeScale?.enabled !== false)) {
    addRow(rows.noRemRows, "Suma no remunerativa escala", noRemScaleBase, ctx.activeScale ? "Escala aprobada" : "Escala base");
    const noRemRule = rules.nonRemunerativeScale || {};
    const noRemSeniorityPct = Number(noRemRule.seniorityPercentPerYear || 0) || 0;
    const noRemPresentismPct = Number(noRemRule.presentismPercent || 0) || 0;
    const noRemYears = noRemRule.seniorityCapYears ? Math.min(ctx.employee.years, Number(noRemRule.seniorityCapYears)) : ctx.employee.years;
    const applyNoRemSeniority = noRemRule.seniorityEnabled !== false
      && inputBool(ctx.inputs, "genSeniority", seniorityRule.enabled !== false || noRemSeniorityPct > 0);
    const noRemSeniority = applyNoRemSeniority ? noRemScaleBase * ((noRemSeniorityPct * noRemYears) / 100) : 0;
    addRow(rows.noRemRows, "Antiguedad no remunerativa", noRemSeniority, `${noRemSeniorityPct}% x ${noRemYears} aÃƒÂ±os`);
    const allowNoRemPresentism = !noRemRule.presentismRequiresNoUnjustifiedAbsence || absentDays === 0;
    const applyNoRemPresentism = noRemRule.presentismEnabled !== false
      && inputBool(ctx.inputs, "genPresentism", presentismRule.enabled === true || noRemPresentismPct > 0);
    if (applyNoRemPresentism && allowNoRemPresentism) {
      addRow(rows.noRemRows, "Presentismo no remunerativo", (noRemScaleBase + noRemSeniority) * (noRemPresentismPct / 100), `${noRemPresentismPct}%`);
    }
  }
  applyManualRows(ctx, rows);
  const remTotal = sumRows(rows.remRows);
  const noRemTotal = sumRows(rows.noRemRows);
  applyWorkerDeductions(ctx, rows, remTotal, remTotal + noRemTotal);
  applyGenericConventionDeductions(ctx, rows, remTotal, noRemTotal, basic);
  applyEmployerContribs(ctx, rows, remTotal, remTotal + noRemTotal, basic);
  addRow(rows.details, "Basico de escala", categoryMonthly || categoryDay || categoryHourly, ctx.activeScale ? "Escala aprobada" : "Escala base");
  addRow(rows.details, "Base obra social", remTotal + noRemTotal, "Remunerativo + no remunerativo sujeto a OS");
  if (ctx.convention.structuredFromConvention && !(model.employerContributions || []).length) warnings.push("El convenio no contiene contribuciones patronales estructuradas; revisar costo empleador.");
  return buildResult(ctx, rows, warnings);
}

function farmaciaAntiquityPct(years, brackets) {
  // If dynamic brackets provided (from rules.seniority.brackets), use them
  if (Array.isArray(brackets) && brackets.length > 0) {
    for (let i = brackets.length - 1; i >= 0; i--) {
      if (years >= brackets[i].fromYears) return Number(brackets[i].percent) || 0;
    }
    return 0;
  }
  // Fallback: CCT 429/2005 hardcoded brackets (Art. 13)
  if (years >= 20) return 35;
  if (years >= 15) return 30;
  if (years >= 10) return 25;
  if (years >= 5)  return 20;
  if (years >= 2)  return 10;
  if (years >= 1)  return 5;
  return 0;
}

function calcUocra(ctx) {
  const rows = emptyRows();
  const period = ctx.payloadPeriod;
  const activeRow = scaleCategoryRow(ctx.activeScale, ctx.category, ctx.zone, ctx.modality);
  const staticScale = resolveUocraScaleValue(ctx.convention.scales, period, ctx.zone?.id, ctx.category?.id, ctx.category?.label);
  const scale = firstFinite(ctx.category.monthly ? activeRow?.monthly : activeRow?.day, activeRow?.monthly, staticScale) || 0;
  const snrMonthly = firstFinite(activeRow?.nonRemunerative, resolveUocraScaleValue(ctx.convention.nonRem, period, ctx.zone?.id, ctx.category?.id, ctx.category?.label)) || 0;
  const isMonthly = !!ctx.category.monthly;
  const hourValue = isMonthly ? 0 : scale / 8;
  const quin = inputString(ctx.inputs, "uocraPeriodMode", "1");
  const normalHours = inputValue(ctx.inputs, "uocraHours", quin === "mensual" ? 176 : 88);
  const baseGross = isMonthly ? (quin === "mensual" ? scale : scale / 2) : hourValue * normalHours;
  const absenceDiscount = hourValue * inputValue(ctx.inputs, "uocraAbsence", 0);
  const base = Math.max(0, baseGross - absenceDiscount);
  addRow(rows.remRows, "Basico", base, isMonthly ? "Sereno mensual proporcional" : `${normalHours} hs`);
  const seniority = inputBool(ctx.inputs, "uocraSeniority", true) ? base * (ctx.employee.years / 100) : 0;
  addRow(rows.remRows, "Antiguedad", seniority, `${ctx.employee.years}%`);
  if (inputBool(ctx.inputs, "uocraPresentism", true) && absenceDiscount === 0) addRow(rows.remRows, "Presentismo", (base + seniority) * 0.20, "20%");
  addRow(rows.remRows, "Trabajo en altura", base * (inputValue(ctx.inputs, "uocraAltitude", 0) / 100), "Adicional");
  if (inputBool(ctx.inputs, "uocraSpecialTask", false)) addRow(rows.remRows, "Tareas especiales", base * 0.20, "20%");
  if (inputBool(ctx.inputs, "uocraSubmuracion", false)) addRow(rows.remRows, "Submuracion", base * 0.10, "10%");
  if (inputBool(ctx.inputs, "uocraHormigon", false)) addRow(rows.remRows, "Hormigon armado", base * 0.15, "15%");
  if (inputBool(ctx.inputs, "uocraEncargado", false)) addRow(rows.remRows, "Encargado", base * 0.10, "10%");
  if (!isMonthly) {
    addRow(rows.remRows, "Franco trabajado", hourValue * inputValue(ctx.inputs, "uocraFrancoTrab", 0) * 2, "x2");
    addRow(rows.remRows, "Feriado no trabajado", hourValue * inputValue(ctx.inputs, "uocraFeriadoNoTrab", 0), "Jornal");
    addRow(rows.remRows, "Horas extra 50%", hourValue * inputValue(ctx.inputs, "uocraExtra50", 0) * 1.5, "x1,5");
    addRow(rows.remRows, "Horas extra 100%", hourValue * inputValue(ctx.inputs, "uocraExtra100", 0) * 2, "x2");
  }
  if (inputBool(ctx.inputs, "uocraSNR", true)) {
    let snr = snrMonthly;
    if (quin === "1") snr = period === "mar26" ? 0 : snrMonthly * 0.5;
    if (quin === "2") snr = period === "mar26" ? snrMonthly : snrMonthly * 0.5;
    addRow(rows.noRemRows, "SNR paritaria", snr, quin === "mensual" ? "Mensual" : "Quincenal");
  }
  if (inputBool(ctx.inputs, "uocraVestimenta", false)) addRow(rows.noRemRows, "Asignacion vestimenta", resolveUocraScaleValue(ctx.convention.scales, period, ctx.zone?.id, "oficial", "Oficial") * 2, "Art. 35");
  applyManualRows(ctx, rows);
  const remTotal = sumRows(rows.remRows);
  const noRemTotal = sumRows(rows.noRemRows);
  applyWorkerDeductions(ctx, rows, remTotal, remTotal + sumRows(rows.noRemRows.filter((row) => row.label.includes("SNR"))));
  applyEmployerContribs(ctx, rows, remTotal, remTotal + noRemTotal, base);
  addRow(rows.details, "Valor de escala", scale, ctx.activeScale ? "Escala aprobada" : "Escala base");
  if (!isMonthly) addRow(rows.details, "Valor hora", hourValue, "Jornal / 8");
  return buildResult(ctx, rows);
}

function calcFarmacia(ctx) {
  const rows = emptyRows();
  const period = ctx.payloadPeriod;
  const activeRow = scaleCategoryRow(ctx.activeScale, ctx.category, ctx.zone, ctx.modality);
  const rules = ctx.convention.rules || {};
  const years = ctx.employee.years || 0;
  const fullWeeklyHours = Number(rules.weeklyHours || 45);
  const actualWeeklyHours = Math.min(fullWeeklyHours, Math.max(0, inputValue(ctx.inputs, "farmWeeklyHours", fullWeeklyHours)));
  const insalubreLimit = Number(rules.insalubreWeeklyHours || 33);
  const insalubrePaidHours = Number(rules.insalubrePaidWeeklyHours || fullWeeklyHours);
  const isInsalubre = inputBool(ctx.inputs, "farmInsalubre", false);
  const paidWeeklyHours = isInsalubre && actualWeeklyHours > 0 && actualWeeklyHours <= insalubreLimit
    ? Math.min(fullWeeklyHours, insalubrePaidHours)
    : actualWeeklyHours;
  const weeklyFactor = fullWeeklyHours > 0 ? paidWeeklyHours / fullWeeklyHours : 1;
  const monthPct = Math.max(0, Math.min(100, inputValue(ctx.inputs, "farmMonthPct", 100)));
  const proportion = weeklyFactor * (monthPct / 100);
  const workingDays = Math.max(1, inputValue(ctx.inputs, "farmWorkingDays", 30));
  const absentDaysUnjust = Math.max(0, inputValue(ctx.inputs, "farmAbsentDays", 0));
  const noRemInput = inputString(ctx.inputs, "farmNoRemDays", "").trim();
  const parsedNoRemDays = noRemInput ? amount(noRemInput.replace(",", ".")) : Math.max(0, workingDays - absentDaysUnjust);
  const noRemDays = Math.max(0, Math.min(workingDays, Number.isFinite(parsedNoRemDays) ? parsedNoRemDays : workingDays));
  const noRemProportion = proportion * (inputBool(ctx.inputs, "farmProrateNonRem", true) ? noRemDays / workingDays : 1);
  const dayDivisor = Number(rules.dayDivisor || 30);
  const vacationDivisor = Number(rules.vacationDivisor || 25);
  const hourDivisor = Number(rules.hourDivisor || 200);

  const catMonthly = firstFinite(activeRow?.monthly, ctx.category.monthly) || 0;
  const base = catMonthly * proportion;

  // Reference categories for additionals
  const findCat = (id) => (ctx.convention.categories || []).find(c => c.id === id) || null;
  const initialA = findCat("inicialA");
  const empleadoFarm = findCat("empleadoFarmacia");
  const initialARow = initialA ? scaleCategoryRow(ctx.activeScale, initialA, ctx.zone, ctx.modality) : null;
  const empleadoFarmRow = empleadoFarm ? scaleCategoryRow(ctx.activeScale, empleadoFarm, ctx.zone, ctx.modality) : null;
  const initialAMonthly = (firstFinite(initialARow?.monthly, initialA?.monthly) || 0) * proportion;
  const empleadoFarmMonthly = (firstFinite(empleadoFarmRow?.monthly, empleadoFarm?.monthly) || 0) * proportion;

  addRow(rows.remRows, "Basico", base, `${paidWeeklyHours}/${fullWeeklyHours} hs; ${monthPct}% del mes`);

  // Track seniority base (can include fixed additionals)
  let seniorityBase = base;
  const includeFixedInSeniority = inputBool(ctx.inputs, "farmSeniorityOnFixedAdditions", true);
  const addRem = (label, val, detail) => {
    addRow(rows.remRows, label, val, detail);
    if (includeFixedInSeniority) seniorityBase += val;
  };

  // Additionals from scale (titulo, adscripcion, bloqueo)
  ["tituloFarmaceutico", "adscripcion", "bloqueo"].forEach((key) => {
    if (!inputBool(ctx.inputs, `farm_${key}`, false)) return;
    const additional = ctx.convention.additionals?.[key];
    const scaleRow = scaleAdditionalRow(ctx.activeScale, key, additional);
    const val = (firstFinite(scaleRow?.monthly, additional?.monthly) || 0) * proportion;
    addRem(additional?.label || key, val, "Escala");
    if (inputBool(ctx.inputs, "farmNonRem", true)) {
      addRow(rows.noRemRows, `${additional?.label || key} - no remunerativo`, (firstFinite(scaleRow?.nonRemunerative, additional?.nonRem?.[period]) || 0) * noRemProportion, "Escala");
    }
  });

  // Percent additionals on base
  if (inputBool(ctx.inputs, "farmCajero", false))     addRem("Adicional cajero",                   base * ((rules.cajeroPct || 10) / 100),                `${rules.cajeroPct || 10}%`);
  if (inputBool(ctx.inputs, "farmAdminTitle", false))  addRem("Adicional tareas administrativas",    base * ((rules.tareasAdministrativasPct || 5) / 100),  `${rules.tareasAdministrativasPct || 5}%`);
  if (inputBool(ctx.inputs, "farmAdminTenure", false)) {
    const pct = years >= 2 ? (rules.adminTenurePctOver2Years || 10) : (rules.adminTenurePctInitial || 5);
    addRem("Adicional administrativo por antiguedad", base * (pct / 100), `${pct}%`);
  }
  if (inputBool(ctx.inputs, "farmPerfumeria", false))  addRem("Adicional perfumeria",               base * ((rules.perfumeriaPct || 10) / 100),             `${rules.perfumeriaPct || 10}%`);
  if (inputBool(ctx.inputs, "farmBike", false))        addRem("Adicional bici/ciclomotor/moto",      base * ((rules.bikePct || 10) / 100),                  `${rules.bikePct || 10}%`);

  // Idioma (base Cat. Inicial A)
  const farmLanguages = inputValue(ctx.inputs, "farmLanguages", 0);
  if (farmLanguages > 0) addRem("Adicional idioma", initialAMonthly * ((rules.languagePct || 10) / 100) * farmLanguages, `${rules.languagePct || 10}% x ${farmLanguages} idioma(s)`);

  // Titulo auxiliar (base Empleado de Farmacia)
  if (inputBool(ctx.inputs, "farmAuxTitle", false)) addRem("Titulo auxiliar de farmacia", empleadoFarmMonthly * ((rules.auxTitlePct || 20) / 100), `${rules.auxTitlePct || 20}%`);

  // Antiguedad sobre seniorityBase
  const pctAnt = farmaciaAntiquityPct(years, rules.seniority?.brackets);
  const seniorityAmount = inputBool(ctx.inputs, "farmSeniority", true) ? seniorityBase * (pctAnt / 100) : 0;
  addRow(rows.remRows, "Escalafon por antiguedad", seniorityAmount, `${pctAnt}% de base`);
  const basePlus = base + seniorityAmount;

  // Hour value after all base remunerativos
  const regularRem = sumRows(rows.remRows);
  const standardDayValue = regularRem / dayDivisor;
  const vacationDayValue = regularRem / vacationDivisor;
  const hourValue = regularRem / hourDivisor;

  // Extras y nocturnos
  const nightPct = Number(rules.nightPct || 100);
  addRow(rows.remRows, "Horas extra 50%",            hourValue * inputValue(ctx.inputs, "farmExtra50", 0) * 1.5,            `x1,5`);
  addRow(rows.remRows, "Horas extra 100%",           hourValue * inputValue(ctx.inputs, "farmExtra100", 0) * 2,             `x2`);
  addRow(rows.remRows, "Adicional nocturno voluntario", hourValue * inputValue(ctx.inputs, "farmNightHours", 0) * (nightPct / 100), `${nightPct}%`);

  // Feriados y día de la farmacia
  const holidayNotWorkedPlus = Math.max(0, vacationDayValue - standardDayValue);
  addRow(rows.remRows, "Feriado trabajado",           vacationDayValue * inputValue(ctx.inputs, "farmHolidayWorkedDays", 0),    `÷${vacationDivisor}`);
  addRow(rows.remRows, "Feriado no trabajado",        holidayNotWorkedPlus * inputValue(ctx.inputs, "farmHolidayNotWorkedDays", 0), `÷${vacationDivisor} - ÷${dayDivisor}`);
  addRow(rows.remRows, "Dia empleado farmacia trab.", vacationDayValue * inputValue(ctx.inputs, "farmPharmacyDayWorked", 0),    `${rules.pharmacyEmployeeDay || "6 sep"}`);
  addRow(rows.remRows, "Dia empleado farmacia no trab.", holidayNotWorkedPlus * inputValue(ctx.inputs, "farmPharmacyDayNotWorked", 0), `${rules.pharmacyEmployeeDay || "6 sep"}`);

  // Vacaciones
  const vacationDays = Math.max(0, inputValue(ctx.inputs, "farmVacationDays", 0));
  if (vacationDays > 0) {
    addRow(rows.remRows, "Vacaciones", vacationDayValue * vacationDays, `÷${vacationDivisor} x ${vacationDays} dias`);
    if (inputBool(ctx.inputs, "farmDiscountVacationDays", true)) {
      addRow(rows.remRows, "Descuento dias vacaciones", -standardDayValue * vacationDays, `-÷${dayDivisor} x ${vacationDays} dias`);
    }
  }

  // SAC proporcional
  if (inputBool(ctx.inputs, "farmSac", false)) {
    const sacDays = Math.max(0, Math.min(180, inputValue(ctx.inputs, "farmSacDays", 180)));
    const currentForSac = sumRows(rows.remRows);
    const sacBase = Math.max(inputValue(ctx.inputs, "farmSacBestRem", 0), currentForSac);
    addRow(rows.remRows, "SAC proporcional", (sacBase / 2 / 180) * sacDays, `Base ${sacBase} / 2 / 180 x ${sacDays}`);
  }

  // Fondo falla de caja (No Rem)
  if (inputBool(ctx.inputs, "farmFallaCaja", false)) {
    addRow(rows.noRemRows, "Fondo falla de caja", basePlus * ((rules.fallaCajaPct || 10) / 100), `${rules.fallaCajaPct || 10}% - Art. 19`);
  }

  // Suma no remunerativa escala
  if (inputBool(ctx.inputs, "farmNonRem", true)) {
    addRow(rows.noRemRows, "Suma no remunerativa escala", (firstFinite(activeRow?.nonRemunerative, ctx.category.nonRem?.[period]) || 0) * noRemProportion, "Escala");
  }

  applyManualRows(ctx, rows);

  // Inasistencias injustificadas
  const remBeforeAbsence = sumRows(rows.remRows);
  addRow(rows.remRows, "Inasistencia injustificada", -(remBeforeAbsence / dayDivisor) * absentDaysUnjust, `${absentDaysUnjust} dias`);

  const remTotal = sumRows(rows.remRows);
  const osRelevantNoRem = sumRows(rows.noRemRows.filter((row) => !row.label.includes("Fondo falla de caja")));
  let osBase = remTotal + osRelevantNoRem;
  // OS base mínima jornada completa si jornada reducida
  if (inputBool(ctx.inputs, "farmOsFullTimeBase", true) && weeklyFactor > 0 && weeklyFactor < 1) {
    osBase = Math.max(osBase, osBase / weeklyFactor);
  }

  applyWorkerDeductions(ctx, rows, remTotal, osBase);
  if (inputBool(ctx.inputs, "farmSocialJuneDec", true) && (period === "jun26" || period === "dic26" || /(^|-)06$/.test(period) || /(^|-)12$/.test(period))) {
    const adefSocialPct = rules.cajaCompensadoraPct != null ? Number(rules.cajaCompensadoraPct) : 1;
    addRow(rows.deductionRows, `Aporte asistencia social ADEF ${adefSocialPct}%`, remTotal * (adefSocialPct / 100), "Art. 46 - Jun/Dic");
  }
  applyEmployerContribs(ctx, rows, remTotal, osBase, base);
  addRow(rows.details, "Basico de escala", catMonthly, ctx.activeScale ? "Escala aprobada" : "Escala base");
  addRow(rows.details, "Proporcion de jornada", proportion * 100, `${paidWeeklyHours}/${fullWeeklyHours} hs; ${monthPct}% del mes`);
  addRow(rows.details, "Valor dia", standardDayValue, `Remunerativo / ${dayDivisor}`);
  addRow(rows.details, "Valor hora", hourValue, `Remunerativo / ${hourDivisor}`);
  addRow(rows.details, "Dias no remunerativos", noRemDays, `Prorrateo ${inputBool(ctx.inputs, "farmProrateNonRem", true) ? "activo" : "desactivado"}`);
  addRow(rows.details, "Base antiguedad", seniorityBase, includeFixedInSeniority ? "Basico + adicionales fijos" : "Solo basico");
  addRow(rows.details, "Base obra social", osBase, "Remunerativo + no remunerativo sujeto a OS");
  return buildResult(ctx, rows);
}


function calcCamioneros(ctx) {
  const rows = emptyRows();
  const coef = Number(ctx.zone.coef || 1) || 1;
  const activeRow = scaleCategoryRow(ctx.activeScale, ctx.category, ctx.zone, ctx.modality);
  const hasSpecificZone = scaleRowMatchesZone(activeRow, ctx.zone);
  const periodDays = Math.max(1, inputValue(ctx.inputs, "camPeriodDays", 24));
  const paidDays = Math.min(Math.max(0, inputValue(ctx.inputs, "camWorkingDays", periodDays)), periodDays);
  const absentDays = Math.max(0, inputValue(ctx.inputs, "camAbsentDays", 0));
  const noRemDaysRaw = inputString(ctx.inputs, "camNoRemDays", "");
  const noRemDays = noRemDaysRaw ? amount(noRemDaysRaw.replace(",", ".")) : Math.max(0, paidDays - absentDays);
  const activeMonthly = firstFinite(activeRow?.monthly);
  const baseMonthly = activeMonthly ? activeMonthly * (hasSpecificZone ? 1 : coef) : amount(ctx.category.monthly) * coef;
  const baseDay = firstFinite(activeRow?.day ? activeRow.day * (hasSpecificZone ? 1 : coef) : null, baseMonthly / periodDays, amount(ctx.category.day) * coef) || 0;
  const base = Math.max(0, baseDay * paidDays - baseDay * absentDays);
  const items = ctx.convention.items || {};
  addRow(rows.remRows, "Basico proporcional", base, `${paidDays} jornales`);
  if (inputBool(ctx.inputs, "camComida", true)) addRow(rows.noRemRows, "Comida", amount(items.comida) * coef * noRemDays, `${noRemDays} dias`);
  if (inputBool(ctx.inputs, "camViaticoEspecial", true)) addRow(rows.noRemRows, "Viatico especial", amount(items.viaticoEspecial) * coef * noRemDays, `${noRemDays} dias`);
  addRow(rows.noRemRows, "Pernoctada", amount(items.pernoctada) * coef * inputValue(ctx.inputs, "camPernoctadaDays", 0), "CCT 40/89");
  addRow(rows.noRemRows, "Permanencia fuera de residencia", amount(items.permanencia) * coef * inputValue(ctx.inputs, "camPermanencia", 0), "CCT 40/89");
  addRow(rows.noRemRows, "Simple presencia", amount(items.simplePresencia) * coef * inputValue(ctx.inputs, "camSimplePresence", 0), "CCT 40/89");
  addRow(rows.noRemRows, "Cruce de frontera", amount(items.cruceFrontera) * coef * inputValue(ctx.inputs, "camCruces", 0), "CCT 40/89");
  addRow(rows.noRemRows, "Ingreso/egreso Tierra del Fuego", amount(items.ingresoIsla) * coef * inputValue(ctx.inputs, "camIsla", 0), "CCT 40/89");
  const kmNormal = Math.max(0, inputValue(ctx.inputs, "camKmExtra", 0));
  const kmWeekend = Math.max(0, inputValue(ctx.inputs, "camKmWeekend", 0));
  const kmTravelDays = Math.max(0, inputValue(ctx.inputs, "camKmTravelDays", 0));
  const minViaticoKm = inputBool(ctx.inputs, "camApplyKmMin", false) ? kmTravelDays * 350 : 0;
  addRow(rows.remRows, "Horas extraordinarias por km", amount(items.kmExtra) * coef * kmNormal, "Item 4.2.3");
  addRow(rows.remRows, "Km sab/dom/feriado 100%", amount(items.kmExtra) * coef * kmWeekend * 2, "Item 4.2.3");
  addRow(rows.noRemRows, "Viatico por km", amount(items.kmViatico) * coef * Math.max(kmNormal, minViaticoKm), "Item 4.2.4");
  addRow(rows.noRemRows, "Viatico por km manual", amount(items.kmViatico) * coef * inputValue(ctx.inputs, "camKmViatico", 0), "Manual");
  addRow(rows.remRows, "Adicional bitrenes", amount(items.bitrenes) * coef * inputValue(ctx.inputs, "camBitrenes", 0), "Planilla");
  addRow(rows.remRows, "Plus vacacional", amount(items.plusVacacionalDia) * coef * inputValue(ctx.inputs, "camVacationPlusDays", 0), "Planilla");
  if (inputBool(ctx.inputs, "camPresentism", true) && absentDays === 0) addRow(rows.remRows, "Presentismo", base * ((items.presentismoPct || 8.33) / 100), "Basico");
  const branchAdds = [
    ["camLongDistanceDriver", "Adicional chofer larga distancia", items.choferLargaDistanciaPct || 10],
    ["camLactea", "Transporte materia prima lactea", items.lacteaPct || 15],
    ["camAuxilio", "Conductor de auxilio", items.auxilioPct || 10],
    ["camBlindado", "Unidades blindadas", items.blindadoPct || 20],
    ["camPeligrosas", "Sustancias peligrosas", items.peligrosasPct || 20],
    ["camPozos", "Pozos petroliferos", items.pozosPetroliferosPct || 40],
    ["camLogistica", "Logistica/almacenamiento", items.logisticaPct || 18],
    ["camCamaraFrio", "Camara de frio", items.camaraFrioPct || 20]
  ];
  branchAdds.forEach(([key, label, pct]) => {
    if (inputBool(ctx.inputs, key, false)) addRow(rows.remRows, label, base * (pct / 100), `${pct}%`);
  });
  addRow(rows.remRows, "Adicional de rama manual", base * (inputValue(ctx.inputs, "camAdditionalPct", 0) / 100), "Manual");
  addRow(rows.remRows, "Otros adicionales Camioneros", inputValue(ctx.inputs, "camOtherRem", 0), "Manual");
  if (inputBool(ctx.inputs, "camSeniority", true)) addRow(rows.remRows, "Antiguedad", sumRows(rows.remRows) * (ctx.employee.years / 100), `${ctx.employee.years}%`);
  const hourValue = baseDay / 8;
  addRow(rows.remRows, "Horas extra 50%", hourValue * inputValue(ctx.inputs, "camExtra50", 0) * 1.5, "x1,5");
  addRow(rows.remRows, "Horas extra 100%", hourValue * inputValue(ctx.inputs, "camExtra100", 0) * 2, "x2");
  addRow(rows.remRows, "Horas nocturnas 100%", hourValue * inputValue(ctx.inputs, "camNightHours", 0) * 2, "x2");
  applyManualRows(ctx, rows);
  const remTotal = sumRows(rows.remRows);
  applyWorkerDeductions(ctx, rows, remTotal, remTotal);
  applyEmployerContribs(ctx, rows, remTotal, remTotal, base);
  addRow(rows.details, "Sueldo mensual categoria", baseMonthly, ctx.activeScale ? "Escala aprobada" : "Escala base");
  addRow(rows.details, "Jornal diario", baseDay, ctx.activeScale ? "Escala aprobada" : "Escala base");
  addRow(rows.details, "Base obra social", remTotal, "Solo remunerativos");
  return buildResult(ctx, rows);
}

const { createUocraStrategy } = require("./strategies/uocra");
const { createFarmaciaStrategy } = require("./strategies/farmacia");
const { createCamionerosStrategy } = require("./strategies/camioneros");

const conventionStrategyHelpers = {
  emptyRows,
  scaleCategoryRow,
  scaleAdditionalRow,
  scaleRowMatchesZone,
  firstFinite,
  inputString,
  inputValue,
  inputBool,
  addRow,
  sumRows,
  applyManualRows,
  applyWorkerDeductions,
  applyEmployerContribs,
  buildResult,
  periodAmountValue,
  resolveUocraScaleValue
};

const payrollCalculationStrategies = {
  uocra: createUocraStrategy(conventionStrategyHelpers),
  farmacia: createFarmaciaStrategy(conventionStrategyHelpers),
  camioneros: createCamionerosStrategy(conventionStrategyHelpers)
};

function calcKnown(ctx) {
  const { dispatchPayrollCalculation } = require("./payroll-dispatcher");
  const rowsOrResult = dispatchPayrollCalculation(ctx, {
    strategies: payrollCalculationStrategies,
    genericCalculator: calcGeneric,
    helpers: {
      scaleCategoryRow,
      periodAmountValue
    }
  });

  if (Array.isArray(rowsOrResult)) {
    return buildResult(ctx, rowsOrResult, []);
  }

  return rowsOrResult;
}

function calculatePayroll({ catalog, payload, activeScale = null }) {
  const convention = catalog.conventions?.[payload.conventionId];
  if (!convention) {
    const error = new Error("Convenio no encontrado");
    error.status = 404;
    throw error;
  }
  const ctx = commonContext({ catalog, convention, payload, activeScale });
  ctx.payloadPeriod = payload.period;
  const result = calcKnown(ctx);
  return result;
}

module.exports = {
  ENGINE_VERSION,
  calculatePayroll,
  yearsFromEntry,
  sumRows,
  amount
};
