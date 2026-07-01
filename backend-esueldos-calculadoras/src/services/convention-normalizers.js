const EXCEL_SCHEMA_VERSION = "esueldos-cct-estructura-excel-v1";

function array(value) {
  return Array.isArray(value) ? value : (value ? [value] : []);
}

function text(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.filter(Boolean).map(text).filter(Boolean).join(", ");
  if (typeof value === "object") return text(value.nombre || value.name || value.label || value.id || value.codigo);
  return String(value);
}

function pickValue(...values) {
  return values.find((value) => value !== null && value !== undefined && value !== "") ?? null;
}

function slug(value) {
  return text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function pickConceptFromCategory(category = {}, field = "") {
  const raw = `${field} ${text(category.categoria_nombre)} ${text(category.grupo_nombre)} ${text(category.modalidad_aplicable)}`.toLowerCase();
  if (raw.includes("hora")) return "VALOR_HORA";
  if (raw.includes("jornal") || raw.includes("dia")) return "VALOR_JORNAL";
  if (raw.includes("no rem") || raw.includes("no remuner")) return "NO_REMUNERATIVO";
  if (raw.includes("total remuner")) return "TOTAL_REMUNERATIVO";
  return "SUELDO_BASICO";
}

function expandCategoryValues(category = {}, scaleId = "escala-1") {
  const categoryId = text(category.categoria_id || category.id);
  const base = {
    escala_id: scaleId,
    categoria_id: categoryId,
    categoria_nombre: text(category.categoria_nombre || category.label || category.name),
    grupo_nombre: text(category.grupo_nombre || category.group || category.rama),
    rama: text(category.rama || category.group || category.grupo_nombre),
    zona: text(category.zona || category.zone),
    fuente_documento: text(category.fuente_documento || category.source),
    evidencia: text(category.evidencia || category.detail),
    pagina: text(category.pagina || category.page),
    confianza: category.confianza ?? category.confidence ?? null
  };
  const values = [];
  const pushValue = (concepto_id, valor, periodicidad = "", unidad_pago = "") => {
    if (valor === null || valor === undefined || valor === "") return;
    values.push({
      valor_id: `${scaleId}-${categoryId}-${concepto_id}-${values.length + 1}`,
      ...base,
      concepto_id,
      periodicidad,
      unidad_pago,
      valor
    });
  };
  pushValue("SUELDO_BASICO", pickValue(category.monthly, category.mensual, category.valor, category.importe, category.monto, category.basico, category.sueldo_basico), "monthly", "monthly");
  pushValue("VALOR_JORNAL", pickValue(category.day, category.dia, category.valor_dia, category.valor_jornal), "daily", "daily");
  pushValue("VALOR_HORA", pickValue(category.hourly, category.hora, category.valor_hora), "hourly", "hourly");
  Object.entries(category.monthlyByPeriod || {}).forEach(([period, amount]) => pushValue("SUELDO_BASICO", amount, period, "monthly"));
  Object.entries(category.dayByPeriod || {}).forEach(([period, amount]) => pushValue("VALOR_JORNAL", amount, period, "daily"));
  Object.entries(category.hourlyByPeriod || {}).forEach(([period, amount]) => pushValue("VALOR_HORA", amount, period, "hourly"));
  Object.entries(category.nonRem || {}).forEach(([period, amount]) => pushValue("NO_REMUNERATIVO", amount, period, "monthly"));
  if (category.totalRemunerativo !== undefined || category.total_remunerativo !== undefined) pushValue("TOTAL_REMUNERATIVO", pickValue(category.totalRemunerativo, category.total_remunerativo), "monthly", "monthly");
  return values;
}

function normalizeConvention(parsed = {}, { fallbackName = "Convenio generado por leIA" } = {}) {
  const source = parsed?.convenio || parsed?.convention || parsed || {};
  const categorias = array(parsed.categorias || parsed.categories || source.categorias || source.categories).map((item, index) => ({
    categoria_id: text(item.categoria_id || item.id || item.codigo || item.code || `categoria-${index + 1}`),
    convenio_id: text(item.convenio_id || source.convenio_id || source.id || ""),
    grupo_nombre: text(item.grupo_nombre || item.group || item.rama || item.branch || item.agrupamiento || item.sector || item.seccion),
    rama: text(item.rama || item.group || item.branch || item.agrupamiento || item.sector || item.seccion),
    convenio_rama: text(item.convenio_rama || source.rama),
    categoria_nombre: text(item.categoria_nombre || item.label || item.name || item.nombre),
    descripcion: text(item.descripcion || item.description),
    tareas_incluidas: text(item.tareas_incluidas || item.tareas),
    modalidad_aplicable: text(item.modalidad_aplicable || item.modalidad || item.mode),
    nivel_jerarquico: text(item.nivel_jerarquico || item.level),
    mensual: pickValue(item.mensual, item.monthly, item.valor, item.importe, item.monto, item.basico, item.sueldo_basico),
    monthly: pickValue(item.monthly, item.mensual, item.valor, item.importe, item.monto, item.basico, item.sueldo_basico),
    dia: pickValue(item.dia, item.day, item.valor_dia, item.valor_jornal),
    day: pickValue(item.day, item.dia, item.valor_dia, item.valor_jornal),
    hora: pickValue(item.hora, item.hourly, item.valor_hora),
    hourly: pickValue(item.hourly, item.hora, item.valor_hora),
    monthlyByPeriod: item.monthlyByPeriod || item.monthly_by_period || item.monthlyPorPeriodo || item.monthly_by_period || {},
    dayByPeriod: item.dayByPeriod || item.day_by_period || item.dayPorPeriodo || item.day_by_period || {},
    hourlyByPeriod: item.hourlyByPeriod || item.hourly_by_period || item.hourlyPorPeriodo || item.hourly_by_period || {},
    nonRem: item.nonRem || item.nonRemunerativeByPeriod || item.noRemPorPeriodo || item.noRemunerativeByPeriod || {},
    zona: text(item.zona || item.zone),
    fuente_documento: text(item.fuente_documento || item.source),
    documento_tipo: text(item.documento_tipo),
    documento_rol: text(item.documento_rol),
    evidencia: text(item.evidencia || item.detail),
    pagina: text(item.pagina || item.page),
    confianza: item.confianza ?? item.confidence ?? null
  }));
  const rawScales = array(parsed.escalas || parsed.scales || source.escalas || source.scales).map((item, index) => ({
    escala_id: text(item.escala_id || item.id || `escala-${index + 1}`),
    convenio_id: text(item.convenio_id || source.convenio_id || source.id || ""),
    nombre_escala: text(item.nombre_escala || item.nombre || item.name || item.periodo || item.period),
    periodo_desde: text(item.periodo_desde || item.vigencia_desde || item.desde || item.periodFrom || item.period),
    periodo_hasta: text(item.periodo_hasta || item.vigencia_hasta || item.hasta || item.periodTo),
    moneda: text(item.moneda || item.currency),
    alcance: text(item.alcance || item.scope),
    zona: text(item.zona || item.zone),
    grupo_nombre: text(item.grupo_nombre || item.group || item.rama || item.branch),
    rama: text(item.rama || item.group || item.branch),
    fuente_documento: text(item.fuente_documento || item.source),
    valores: array(item.valores || item.values || item.importes || item.rows || item.filas || item.items).map((value, valueIndex) => ({
      valor_id: text(value.valor_id || value.id || `valor-${valueIndex + 1}`),
      escala_id: text(value.escala_id || item.id || `escala-${index + 1}`),
      convenio_id: text(value.convenio_id || source.convenio_id || source.id || ""),
      categoria_id: text(value.categoria_id || value.categoryId || value.categoria || ""),
      categoria_nombre: text(value.categoria_nombre || value.categoryName || value.categoria),
      grupo_nombre: text(value.grupo_nombre || value.rama || value.group || value.branch),
      concepto_id: text(value.concepto_id || value.id_concepto || value.concepto || ""),
      modalidad: text(value.modalidad || value.modality),
      unidad_pago: text(value.unidad_pago || value.paymentUnit),
      periodicidad: text(value.periodicidad || value.period || value.mes),
      valor: pickValue(value.valor, value.value, value.importe, value.monto, value.amount, value.basico, value.sueldo_basico),
      moneda: text(value.moneda || value.currency),
      zona: text(value.zona || value.zone),
      vigencia_desde: text(value.vigencia_desde || value.desde || value.periodo_desde),
      vigencia_hasta: text(value.vigencia_hasta || value.hasta || value.periodo_hasta),
      fuente_documento: text(value.fuente_documento || value.source),
      evidencia: text(value.evidencia || value.detail),
      pagina: text(value.pagina || value.page),
      confianza: value.confianza ?? value.confidence ?? null
    }))
  }));
  rawScales.forEach((scale, scaleIndex) => {
    if ((scale.valores || []).length) return;
    const inferredValue = pickValue(scale.valor, scale.value, scale.importe, scale.monto, scale.amount, scale.basico, scale.sueldo_basico, scale.monthly, scale.mensual, scale.day, scale.dia, scale.hourly, scale.hora);
    if (inferredValue === null) return;
    scale.valores = [{
      valor_id: `valor-${scaleIndex + 1}`,
      escala_id: scale.escala_id || `escala-${scaleIndex + 1}`,
      convenio_id: scale.convenio_id || text(source.convenio_id || source.id || ""),
      categoria_id: text(scale.categoria_id || ""),
      categoria_nombre: text(scale.categoria_nombre || scale.nombre_escala || ""),
      grupo_nombre: text(scale.grupo_nombre || scale.rama || ""),
      concepto_id: text(scale.concepto_id || pickConceptFromCategory(scale, "escala")),
      modalidad: text(scale.modalidad || ""),
      unidad_pago: text(scale.unidad_pago || scale.paymentUnit || (scale.hourly !== null || scale.hora !== null ? "hourly" : scale.day !== null || scale.dia !== null ? "daily" : "monthly")),
      periodicidad: text(scale.periodicidad || scale.period || scale.mes || scale.periodo_desde || scale.nombre_escala),
      valor: inferredValue,
      moneda: text(scale.moneda || scale.currency),
      zona: text(scale.zona || scale.zone),
      vigencia_desde: text(scale.periodo_desde || scale.vigencia_desde),
      vigencia_hasta: text(scale.periodo_hasta || scale.vigencia_hasta),
      fuente_documento: text(scale.fuente_documento || scale.source),
      evidencia: text(scale.evidencia || scale.detail),
      pagina: text(scale.pagina || scale.page),
      confianza: scale.confianza ?? scale.confidence ?? null
    }];
  });
  const categoryVariantMap = new Map();
  const expandedCategories = [];
  categorias.forEach((category, index) => {
    const baseKey = slug(category.categoria_id || category.categoria_nombre || category.id || index + 1);
    const modalities = new Map();
    rawScales.forEach((scale) => {
      (scale.valores || []).forEach((value) => {
        const valueBaseKey = slug(value.categoria_id || value.categoria_nombre || value.categoria || "");
        const variantLabel = text(value.modalidad || scale.modalidad || value.grupo_nombre || scale.grupo_nombre || value.rama || scale.rama || "");
        if (!variantLabel || !valueBaseKey || valueBaseKey !== baseKey) return;
        modalities.set(slug(variantLabel), variantLabel);
      });
    });
    if (modalities.size > 1) {
      modalities.forEach((modality) => {
        const variantId = `${category.categoria_id || baseKey}_${slug(modality)}`;
        categoryVariantMap.set(`${baseKey}::${slug(modality)}`, variantId);
        expandedCategories.push({
          ...category,
          categoria_id: variantId,
          categoria_nombre: `${text(category.categoria_nombre || category.label || category.name)} ${modality}`.trim(),
          modalidad_aplicable: modality
        });
      });
      return;
    }
    expandedCategories.push(category);
  });
    rawScales.forEach((scale) => {
      (scale.valores || []).forEach((value) => {
        const baseKey = slug(value.categoria_id || value.categoria_nombre || value.categoria || "");
      const variantLabel = text(value.modalidad || scale.modalidad || value.grupo_nombre || scale.grupo_nombre || value.rama || scale.rama || "");
      const variantId = variantLabel ? categoryVariantMap.get(`${baseKey}::${slug(variantLabel)}`) : null;
      if (variantId) value.categoria_id = variantId;
      });
    });
  if (!rawScales.length && categorias.some((category) => category.mensual !== null || category.monthly !== null || category.dia !== null || category.day !== null || category.hora !== null || category.hourly !== null || Object.keys(category.monthlyByPeriod || {}).length || Object.keys(category.dayByPeriod || {}).length || Object.keys(category.hourlyByPeriod || {}).length || Object.keys(category.nonRem || {}).length)) {
    rawScales.push({
      escala_id: "escala-1",
      convenio_id: text(source.convenio_id || source.id || ""),
      nombre_escala: text(source.nombre_escala || source.name || fallbackName),
      periodo_desde: text(source.vigencia_desde || source.periodo_desde),
      periodo_hasta: text(source.vigencia_hasta || source.periodo_hasta),
      moneda: text(source.moneda || source.currency),
      alcance: "",
      zona: "",
      grupo_nombre: text(source.rama || source.grupo_nombre),
      rama: text(source.rama || source.grupo_nombre),
      fuente_documento: text(source.fuente_documento || source.source),
      valores: categorias.flatMap((category) => expandCategoryValues(category, "escala-1"))
    });
  }
  return {
    schemaVersion: parsed.schemaVersion || source.schemaVersion || EXCEL_SCHEMA_VERSION,
    convenio: {
      convenio_id: text(source.convenio_id || source.id || source.numero || source.number || fallbackName),
      tipo_norma: text(source.tipo_norma || source.type),
      numero: text(source.numero || source.number),
      año: text(source.año || source.anio || source.year),
      denominacion: text(source.denominacion || source.nombre || source.name || fallbackName),
      actividad: text(source.actividad),
      rama: text(source.rama || source.grupo_nombre || source.group || source.branch),
      jurisdiccion: text(source.jurisdiccion),
      organismo: text(source.organismo),
      partes_sindicales: text(source.partes_sindicales),
      partes_empleadoras: text(source.partes_empleadoras),
      fecha_homologacion: text(source.fecha_homologacion),
      vigencia_desde: text(source.vigencia_desde),
      vigencia_hasta: text(source.vigencia_hasta),
      ambito_territorial: text(source.ambito_territorial),
      personal_comprendido: text(source.personal_comprendido),
      personal_excluido: text(source.personal_excluido),
      fuente_documento: text(source.fuente_documento)
    },
    ambitos: array(parsed.ambitos || source.ambitos).map((item, index) => ({
      ambito_id: text(item.ambito_id || item.id || `ambito-${index + 1}`),
      convenio_id: text(item.convenio_id || source.convenio_id || source.id || ""),
      tipo_ambito: text(item.tipo_ambito || item.tipo || item.type),
      descripcion: text(item.descripcion || item.nombre || item.description),
      incluido: text(item.incluido),
      excluido: text(item.excluido),
      fuente_documento: text(item.fuente_documento || item.source),
      pagina: text(item.pagina || item.page),
      evidencia: text(item.evidencia || item.evidence),
      confianza: item.confianza ?? item.confidence ?? null
    })),
    categorias: expandedCategories,
    conceptos: array(parsed.conceptos || parsed.concepts || source.conceptos || source.concepts).map((item, index) => ({
      concepto_id: text(item.concepto_id || item.id || item.codigo || item.code || `concepto-${index + 1}`),
      convenio_id: text(item.convenio_id || source.convenio_id || source.id || ""),
      nombre: text(item.nombre || item.label || item.name),
      tipo_concepto: text(item.tipo_concepto || item.type || item.rowType),
      naturaleza: text(item.naturaleza || item.nature),
      unidad_calculo: text(item.unidad_calculo || item.calculation || item.inputType),
      formula_base: text(item.formula_base || item.formula || item.calculation),
      base_calculo: text(item.base_calculo || item.base),
      porcentaje: item.porcentaje ?? item.percentage ?? item.percent ?? null,
      importe_fijo: item.importe_fijo ?? item.fixedAmount ?? item.importe ?? item.amount ?? null,
      calculation: text(item.calculation),
      inputType: text(item.inputType),
      defaultValue: item.defaultValue,
      unitAmount: item.unitAmount ?? item.valor_unitario ?? null,
      amountByPeriod: item.amountByPeriod || item.amountPorPeriodo || {},
      unitAmountByPeriod: item.unitAmountByPeriod || item.valorUnidadPorPeriodo || {},
      condicion: text(item.condicion || item.condition),
      es_liquidable: item.es_liquidable !== false,
      fuente_documento: text(item.fuente_documento || item.source),
      documento_tipo: text(item.documento_tipo),
      documento_rol: text(item.documento_rol),
      evidencia: text(item.evidencia || item.detail),
      pagina: text(item.pagina || item.page),
      confianza: item.confianza ?? item.confidence ?? null
    })),
    escalas: rawScales,
    adicionales: array(parsed.adicionales || parsed.additionals || source.adicionales || source.additionals).map((item, index) => ({
      adicional_id: text(item.adicional_id || item.id || `adicional-${index + 1}`),
      convenio_id: text(item.convenio_id || source.convenio_id || source.id || ""),
      concepto_id: text(item.concepto_id || item.conceptId || item.id_concepto || ""),
      nombre: text(item.nombre || item.label || item.name),
      tipo: text(item.tipo || item.type),
      porcentaje: item.porcentaje ?? item.percentage ?? null,
      importe: item.importe ?? item.amount ?? null,
      base_calculo: text(item.base_calculo || item.base),
      condicion: text(item.condicion || item.condition),
      zonas_aplica: text(item.zonas_aplica || item.zones),
      vigencia_desde: text(item.vigencia_desde || item.validFrom),
      vigencia_hasta: text(item.vigencia_hasta || item.validTo),
      fuente_documento: text(item.fuente_documento || item.source),
      documento_tipo: text(item.documento_tipo),
      documento_rol: text(item.documento_rol),
      evidencia: text(item.evidencia || item.detail),
      pagina: text(item.pagina || item.page),
      confianza: item.confianza ?? item.confidence ?? null
    }))
  };
}

module.exports = { normalizeConvention };
