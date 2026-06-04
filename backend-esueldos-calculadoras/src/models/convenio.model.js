const { z } = require("zod");

const EXCEL_SCHEMA_VERSION = "esueldos-cct-estructura-excel-v1";
const emptyText = z.union([z.string(), z.null()]).optional().default("");
const requiredText = z.string().min(1);
const amountValue = z.union([z.number().finite(), z.string(), z.null()]).optional().default(null);

function text(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.filter(Boolean).map((item) => text(item)).filter(Boolean).join(", ");
  if (typeof value === "object") {
    const useful = value.nombre || value.name || value.label || value.descripcion || value.description || value.id || value.codigo || value.code;
    console.warn("[CCT normalize] Se reemplazo [object Object] por campo util o vacio.");
    return useful === undefined || useful === null ? "" : String(useful);
  }
  return String(value);
}

function array(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function amount(value) {
  if (value === undefined || value === "") return null;
  return value;
}

function numericAmount(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = String(value).replace(/\s/g, "").replace(/\$/g, "").replace(/\./g, "").replace(",", ".");
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function slugId(value, fallback = "") {
  const raw = text(value || fallback).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return raw.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function canonConvenioId(value = "") {
  const raw = text(value).trim();
  const cct = raw.match(/(?:CCT[-_\s]*)?(\d{2,5})[-_/](\d{2,4})/i);
  if (cct) return `${cct[1]}/${String(cct[2]).length === 4 ? cct[2] : String(cct[2]).padStart(2, "0")}`;
  return raw;
}

function canonCategoryId(value = "", name = "", group = "") {
  return slugId(value || [group, name].filter(Boolean).join("_") || name, "CATEGORIA");
}

function canonConceptId(value, name = "") {
  if (!text(value).trim() && !text(name).trim()) return "";
  const raw = slugId(`${value || ""} ${name || ""}`);
  if (/SUELDO|BASICO|BASICA|SALARIO/.test(raw)) return "SUELDO_BASICO";
  if (/ASISTENCIA|PERFECTA/.test(raw)) return "PRESENTISMO_ASISTENCIA";
  if (/PRESENTISMO|PUNTUALIDAD/.test(raw)) return "PRESENTISMO_PUNTUALIDAD";
  if (/ANTIG/.test(raw)) return "ANTIGUEDAD";
  if (/PROLONGACION|JORNADA/.test(raw) && /PROLONGACION/.test(raw)) return "PROLONGACION_JORNADA";
  if (/KILO.*PAN|PAN.*DIARIO/.test(raw)) return "KILO_PAN";
  if (/CUOTA.*SINDICAL|SINDICAL/.test(raw)) return "CUOTA_SINDICAL";
  if (/FONDO.*SOLIDARIO.*TRABAJADOR/.test(raw)) return "FONDO_SOLIDARIO_TRABAJADOR";
  if (/DIA.*PANADERO/.test(raw)) return "DIA_PANADERO";
  if (/TOTAL.*REMUNERATIVO/.test(raw)) return "TOTAL_REMUNERATIVO";
  if (/VIATIC/.test(raw)) return "VIATICO";
  if (/TOTAL.*7|7H|7_H/.test(raw)) return "TOTAL_7H";
  if (/TOTAL.*8|8H|8_H/.test(raw)) return "TOTAL_8H";
  if (/CHANGA/.test(raw)) return "VALOR_CHANGA";
  return slugId(value || name, "");
}

function isReferenceConcept(id = "", name = "") {
  return /^(TOTAL_7H|TOTAL_8H|VALOR_CHANGA|TOTAL_REMUNERATIVO)$/.test(canonConceptId(id, name));
}

function conceptDefaults(concept = {}) {
  const id = canonConceptId(concept.concepto_id, concept.nombre);
  const reference = isReferenceConcept(id, concept.nombre);
  const names = {
    SUELDO_BASICO: "Sueldo Basico",
    PRESENTISMO_ASISTENCIA: "Adicional por Presentismo - Asistencia Perfecta",
    PRESENTISMO_PUNTUALIDAD: "Adicional por Presentismo - Puntualidad",
    ANTIGUEDAD: "Antiguedad",
    PROLONGACION_JORNADA: "Prolongacion de jornada",
    KILO_PAN: "Kilo de Pan Diario",
    CUOTA_SINDICAL: "Cuota sindical",
    FONDO_SOLIDARIO_TRABAJADOR: "Fondo solidario trabajador",
    TOTAL_7H: "Total jornada 7 horas",
    TOTAL_8H: "Total jornada 8 horas",
    VALOR_CHANGA: "Valor changa",
    VIATICO: "Viatico",
    DIA_PANADERO: "Dia Panadero",
    TOTAL_REMUNERATIVO: "Total remunerativo"
  };
  return {
    nombre: concept.nombre || names[id] || id.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase()),
    tipo_concepto: reference ? "referencia" : (concept.tipo_concepto || (/CUOTA|FONDO/.test(id) ? "descuento" : "haber")),
    naturaleza: reference ? "referencial" : (concept.naturaleza || (id === "KILO_PAN" ? "no_remunerativo" : /CUOTA|FONDO/.test(id) ? "retencion" : "remunerativo")),
    unidad_calculo: concept.unidad_calculo || (id === "PROLONGACION_JORNADA" ? "hora" : id === "KILO_PAN" ? "diaria" : "mensual"),
    formula_base: reference ? "valor_referencia_escala" : (concept.formula_base || ({
      PRESENTISMO_ASISTENCIA: "segun_regla_convenio",
      PRESENTISMO_PUNTUALIDAD: "segun_regla_convenio",
      ANTIGUEDAD: "porcentaje_sobre_base",
      PROLONGACION_JORNADA: "porcentaje_sobre_valor_hora",
      KILO_PAN: "beneficio_en_especie_o_equivalente",
      CUOTA_SINDICAL: "porcentaje_sobre_base",
      FONDO_SOLIDARIO_TRABAJADOR: "porcentaje_sobre_base"
    }[id] || "valor_escala_categoria")),
    base_calculo: reference ? "escala_salarial" : (concept.base_calculo || ({
      PRESENTISMO_ASISTENCIA: "sueldo_basico",
      PRESENTISMO_PUNTUALIDAD: "sueldo_basico",
      ANTIGUEDAD: "sueldo_basico",
      PROLONGACION_JORNADA: "valor_hora",
      KILO_PAN: "valor_kilo_pan",
      CUOTA_SINDICAL: "remuneracion_sujeta_a_aporte",
      FONDO_SOLIDARIO_TRABAJADOR: "remuneracion_sujeta_a_aporte"
    }[id] || "escala_salarial")),
    condicion: reference ? "Valor informativo de escala; no se liquida automaticamente" : (concept.condicion || ({
      PRESENTISMO_ASISTENCIA: "Aplica segun asistencia perfecta",
      PRESENTISMO_PUNTUALIDAD: "Aplica segun puntualidad",
      ANTIGUEDAD: "Aplica segun anos de antiguedad",
      PROLONGACION_JORNADA: "Aplica cuando existe prolongacion de jornada",
      KILO_PAN: "Aplica por dia trabajado segun convenio",
      CUOTA_SINDICAL: "Aplica segun afiliacion o regla sindical correspondiente",
      FONDO_SOLIDARIO_TRABAJADOR: "Aplica segun convenio"
    }[id] || "Aplica segun categoria, periodo y jornada")),
    es_liquidable: reference ? false : concept.es_liquidable !== false
  };
}

function yearFrom(source = {}) {
  return text(source["a\u00f1o"] ?? source["aÃ±o"] ?? source.anio ?? source.year);
}

function convenioIdFrom(payload = {}) {
  return text(payload.convenio_id || payload.numero_convenio || payload.numeroConvenio || payload.cct || payload.id || payload.conventionId || payload.convenio?.convenio_id || payload.convenio?.numero_convenio);
}

function normalizeConvenioRoot(source = {}) {
  const convenio_id = canonConvenioId(convenioIdFrom(source));
  return {
    convenio_id,
    tipo_norma: text(source.tipo_norma || source.type),
    numero: text(source.numero || source.numero_convenio || source.cct),
    "a\u00f1o": yearFrom(source),
    denominacion: text(source.denominacion || source.nombre || source.name || source.shortName || source.titulo || (convenio_id ? `CCT ${convenio_id}` : "Convenio pendiente de identificacion documental")),
    actividad: text(source.actividad || source.metadata?.activity),
    rama: text(source.rama),
    jurisdiccion: text(source.jurisdiccion || source.ambito_geografico || source.metadata?.jurisdiction),
    organismo: text(source.organismo || source.organismo_homologante || source.metadata?.homologation?.authority),
    partes_sindicales: text(source.partes_sindicales || source.partes_firmantes_trabajadores || source.metadata?.union),
    partes_empleadoras: text(source.partes_empleadoras || source.partes_firmantes_empleadores || source.metadata?.employerChamber),
    fecha_homologacion: text(source.fecha_homologacion || source.metadata?.homologation?.date),
    vigencia_desde: text(source.vigencia_desde || source.normative?.validFrom),
    vigencia_hasta: text(source.vigencia_hasta || source.normative?.validTo),
    ambito_territorial: text(source.ambito_territorial || source.scope?.territory),
    personal_comprendido: text(source.personal_comprendido || source.scope?.workersIncluded),
    personal_excluido: text(source.personal_excluido || source.scope?.workersExcluded),
    fuente_documento: text(source.fuente_documento || source.source)
  };
}

function normalizeAmbito(item = {}, convenioId = "", index = 0) {
  return {
    ambito_id: text(item.ambito_id || item.id || `ambito-${index + 1}`),
    convenio_id: canonConvenioId(item.convenio_id || convenioId),
    tipo_ambito: text(item.tipo_ambito || item.tipo || item.type),
    descripcion: text(item.descripcion || item.nombre || item.description || item),
    incluido: text(item.incluido),
    excluido: text(item.excluido),
    fuente_documento: text(item.fuente_documento || item.source)
  };
}

function normalizeCategoria(item = {}, convenioId = "", index = 0) {
  const name = text(item.categoria_nombre || item.categoria || item.nombre || item.name || item.label);
  const group = text(item.grupo_nombre || item.rama || item.groupName || item.group);
  const id = canonCategoryId(item.categoria_id || item.id || name, name, group || convenioId);
  return {
    categoria_id: id,
    convenio_id: canonConvenioId(item.convenio_id || convenioId),
    grupo_nombre: group,
    categoria_nombre: name,
    descripcion: text(item.descripcion || item.description || item.detalle),
    tareas_incluidas: text(item.tareas_incluidas || item.tareas || item.includedTasks),
    modalidad_aplicable: text(item.modalidad_aplicable || item.modalidad || item.applicableMode),
    nivel_jerarquico: text(item.nivel_jerarquico || item.hierarchyLevel),
    fuente_documento: text(item.fuente_documento || item.source)
  };
}

function normalizeConcepto(item = {}, convenioId = "", index = 0, forcedType = "") {
  const nombre = text(item.nombre || item.name || item.label);
  const concepto_id = canonConceptId(item.concepto_id || item.id || `concepto-${index + 1}`, nombre);
  const defaults = conceptDefaults({ ...item, concepto_id, nombre });
  return {
    concepto_id,
    convenio_id: canonConvenioId(item.convenio_id || convenioId),
    codigo: text(item.codigo || item.code),
    nombre: nombre || defaults.nombre,
    tipo_concepto: text(item.tipo_concepto || item.type || forcedType || defaults.tipo_concepto),
    naturaleza: text(item.naturaleza || item.nature || item.rowType || defaults.naturaleza),
    unidad_calculo: text(item.unidad_calculo || item.unit || item.inputType || defaults.unidad_calculo),
    formula_base: text(item.formula_base || item.formula || item.calculation || defaults.formula_base),
    base_calculo: text(item.base_calculo || item.base || defaults.base_calculo),
    porcentaje: text(item.porcentaje ?? item.percentage ?? item.percent),
    importe_fijo: amount(item.importe_fijo ?? item.fixedAmount ?? item.amount),
    aplica_a: text(item.aplica_a || item.appliesTo),
    condicion: text(item.condicion || item.condition || item.detail || defaults.condicion),
    fuente_documento: text(item.fuente_documento || item.source),
    es_liquidable: item.es_liquidable === undefined ? defaults.es_liquidable : Boolean(item.es_liquidable)
  };
}

function normalizeValor(item = {}, convenioId = "", escalaId = "", index = 0) {
  const rawConceptId = item.concepto_id || item.conceptId || item.concepto || item.nombre_concepto;
  const rawCategoryId = item.categoria_id || item.categoryId || item.categoria || item.categoria_nombre || item.nombre_categoria;
  return {
    valor_id: text(item.valor_id || item.id || `valor-${index + 1}`),
    escala_id: text(item.escala_id || item.scaleId || escalaId),
    convenio_id: canonConvenioId(item.convenio_id || convenioId),
    categoria_id: canonCategoryId(rawCategoryId, item.categoria_nombre || item.categoryName || item.categoria, item.grupo_nombre || item.rama || item.groupName || item.group),
    concepto_id: rawConceptId ? canonConceptId(rawConceptId) : "",
    modalidad: text(item.modalidad || item.modality),
    unidad_pago: text(item.unidad_pago || item.paymentUnit),
    periodicidad: text(item.periodicidad || item.periodicity),
    valor: amount(item.valor ?? item.value ?? item.importe ?? item.monto ?? item.amount),
    valor_minimo: amount(item.valor_minimo ?? item.minValue),
    valor_maximo: amount(item.valor_maximo ?? item.maxValue),
    moneda: text(item.moneda || item.currency),
    alcance: text(item.alcance || item.scope),
    zona: text(item.zona || item.zone),
    vigencia_desde: text(item.vigencia_desde || item.fecha_desde || item.desde || item.validFrom),
    vigencia_hasta: text(item.vigencia_hasta || item.fecha_hasta || item.hasta || item.validTo),
    fuente_documento: text(item.fuente_documento || item.source)
  };
}

function expandScaleValue(item = {}, convenioId = "", escalaId = "", index = 0) {
  const base = normalizeValor(item, convenioId, escalaId, index);
  const values = base.concepto_id && base.valor !== null && base.valor !== undefined && base.valor !== "" ? [base] : [];
  const columns = [
    [["sueldo_basico", "basico", "salario_basico"], "SUELDO_BASICO", "mensual"],
    [["valor_hora", "hora"], "VALOR_HORA", "hora"],
    [["valor_dia", "valor_jornal", "jornal"], "VALOR_JORNAL", "jornal"],
    [["valor_changa", "changa"], "VALOR_CHANGA", "changa"],
    [["total_remunerativo"], "TOTAL_REMUNERATIVO", "mensual"],
    [["total_7h", "total_7_h"], "TOTAL_7H", "mensual"],
    [["total_8h", "total_8_h"], "TOTAL_8H", "mensual"],
    [["viatico", "viaticos"], "VIATICO", "mensual"]
  ];
  for (const [fields, concepto_id, unidad_pago] of columns) {
    const field = fields.find((key) => item[key] !== undefined && item[key] !== null && item[key] !== "");
    if (!field) continue;
    values.push(normalizeValor({
      ...item,
      valor_id: `${base.valor_id}-${concepto_id}`,
      concepto_id,
      unidad_pago,
      valor: item[field]
    }, convenioId, escalaId, values.length));
  }
  return values;
}

function normalizeEscala(item = {}, convenioId = "", index = 0) {
  const escalaId = text(item.escala_id || item.id || `escala-${index + 1}`);
  const valores = array(item.valores || item.values)
    .flatMap((value, valueIndex) => expandScaleValue(value, convenioId, escalaId, valueIndex))
    .filter((value) => value.valor !== null && value.valor !== undefined && value.valor !== "");
  return {
    escala_id: escalaId,
    convenio_id: canonConvenioId(item.convenio_id || convenioId),
    nombre_escala: text(item.nombre_escala || item.nombre || item.name || item.periodo || item.period),
    tipo_escala: text(item.tipo_escala || item.tipo || item.type),
    periodo_desde: text(item.periodo_desde || item.fecha_desde || item.vigencia_desde || item.desde || item.periodFrom || item.period),
    periodo_hasta: text(item.periodo_hasta || item.fecha_hasta || item.vigencia_hasta || item.hasta || item.periodTo),
    moneda: text(item.moneda || item.currency),
    alcance: text(item.alcance || item.scope),
    zona: text(item.zona || item.zone),
    fuente_documento: text(item.fuente_documento || item.source),
    valores
  };
}

function escalaHasData(escala = {}) {
  return Boolean(
    text(escala.nombre_escala).trim()
    || text(escala.periodo_desde).trim()
    || text(escala.periodo_hasta).trim()
    || array(escala.valores).some((value) => value?.valor !== null && value?.valor !== undefined && value?.valor !== "")
  );
}

function normalizeAdicional(item = {}, convenioId = "", index = 0) {
  const nombre = text(item.nombre || item.name);
  const conceptoId = canonConceptId(item.concepto_id || item.conceptId || item.adicional_id || item.id, nombre);
  return {
    adicional_id: conceptoId || slugId(item.adicional_id || item.id || nombre, `ADICIONAL_${index + 1}`),
    convenio_id: canonConvenioId(item.convenio_id || convenioId),
    concepto_id: conceptoId,
    nombre,
    tipo: text(item.tipo || item.type),
    porcentaje: amount(item.porcentaje ?? item.percentage),
    importe: amount(item.importe ?? item.amount),
    base_calculo: text(item.base_calculo || item.base),
    condicion: text(item.condicion || item.condition),
    zonas_aplica: text(item.zonas_aplica || item.zones),
    vigencia_desde: text(item.vigencia_desde || item.validFrom),
    vigencia_hasta: text(item.vigencia_hasta || item.validTo),
    fuente_documento: text(item.fuente_documento || item.source),
    articulo_anexo: text(item.articulo_anexo),
    estado_revision: text(item.estado_revision || item.status)
  };
}

function dedupeById(items, idField, label) {
  const map = new Map();
  for (const item of items || []) {
    const id = item[idField];
    if (!id) continue;
    if (map.has(id)) {
      console.warn(`[CCT normalize] Duplicado en ${label}: ${id}. Se fusiono.`);
      map.set(id, { ...item, ...map.get(id), ...Object.fromEntries(Object.entries(item).filter(([, value]) => value !== "" && value !== null && value !== undefined)) });
    } else {
      map.set(id, item);
    }
  }
  return Array.from(map.values());
}

function finalizeConvenio(normalized) {
  const convenioId = canonConvenioId(normalized.convenio?.convenio_id);
  normalized.convenio = { ...normalized.convenio, convenio_id: convenioId };
  const categoryByName = new Map();
  const categoryIdMap = new Map();
  const categoryByCanonicalName = new Map();
  for (const category of dedupeById(normalized.categorias, "categoria_id", "categorias")) {
    const canonicalId = canonCategoryId(category.categoria_id, category.categoria_nombre, category.grupo_nombre);
    if (canonicalId && canonicalId !== category.categoria_id) {
      console.warn(`[CCT normalize] categoria_id normalizado: ${category.categoria_id} -> ${canonicalId}`);
    }
    const nameKey = slugId(category.categoria_nombre);
    if (categoryByCanonicalName.has(nameKey)) {
      const existing = categoryByCanonicalName.get(nameKey);
      console.warn(`[CCT normalize] Categoria duplicada por nombre: ${category.categoria_nombre}. ${category.categoria_id} -> ${existing.categoria_id}`);
      categoryIdMap.set(category.categoria_id, existing.categoria_id);
      continue;
    }
    const finalCategory = { ...category, convenio_id: convenioId, categoria_id: canonicalId };
    categoryIdMap.set(category.categoria_id, canonicalId);
    categoryByCanonicalName.set(nameKey, finalCategory);
    categoryByName.set(slugId(finalCategory.categoria_nombre), finalCategory.categoria_id);
  }
  const categorias = Array.from(categoryByCanonicalName.values());
  const categoryIds = new Set(categorias.map((category) => category.categoria_id));

  const conceptosInput = normalized.conceptos.map((concept) => {
    const id = canonConceptId(concept.concepto_id, concept.nombre);
    if (id !== concept.concepto_id) console.warn(`[CCT normalize] concepto_id normalizado: ${concept.concepto_id} -> ${id}`);
    const defaults = conceptDefaults({ ...concept, concepto_id: id });
    return { ...concept, convenio_id: convenioId, concepto_id: id, ...defaults };
  });
  const conceptos = dedupeById(conceptosInput, "concepto_id", "conceptos");
  const conceptIds = new Set(conceptos.map((concept) => concept.concepto_id));

  const escalas = normalized.escalas.map((scale) => ({
    ...scale,
    convenio_id: convenioId,
    valores: scale.valores.map((value) => {
      const normalizedCategoryId = canonCategoryId(value.categoria_id, value.categoria_nombre, value.grupo_nombre || scale.zona);
      const categoryId = categoryIds.has(normalizedCategoryId) ? normalizedCategoryId : (categoryIdMap.get(value.categoria_id) || categoryByName.get(slugId(value.categoria_id)));
      const conceptId = canonConceptId(value.concepto_id || "SUELDO_BASICO");
      if (!categoryId && normalizedCategoryId) {
        console.warn(`[CCT normalize] Se creo categoria minima desde escala ${scale.escala_id}: ${normalizedCategoryId}`);
        categorias.push({
          categoria_id: normalizedCategoryId,
          convenio_id: convenioId,
          grupo_nombre: text(value.grupo_nombre || scale.zona),
          categoria_nombre: normalizedCategoryId.replace(/_/g, " "),
          descripcion: "",
          tareas_incluidas: "",
          modalidad_aplicable: "",
          nivel_jerarquico: "",
          fuente_documento: text(value.fuente_documento || scale.fuente_documento)
        });
        categoryIds.add(normalizedCategoryId);
      }
      if (!conceptIds.has(conceptId)) {
        console.warn(`[CCT normalize] Escala ${scale.escala_id} apunta a concepto inexistente: ${conceptId}. Se creo concepto minimo.`);
        conceptos.push(normalizeConcepto({ concepto_id: conceptId, nombre: conceptId.replace(/_/g, " ") }, normalized.convenio.convenio_id));
        conceptIds.add(conceptId);
      }
      return {
        ...value,
        convenio_id: convenioId,
        categoria_id: categoryId || normalizedCategoryId || value.categoria_id,
        concepto_id: conceptId
      };
    })
  }));

  const adicionales = dedupeById(normalized.adicionales.map((item) => {
    if (!text(item.nombre).trim() && !text(item.concepto_id).trim() && /^ADICIONAL_\d+$/.test(text(item.adicional_id))) return null;
    const concepto_id = canonConceptId(item.concepto_id || item.adicional_id, item.nombre);
    if (!concepto_id) return null;
    if (!conceptIds.has(concepto_id)) {
      console.warn(`[CCT normalize] Adicional ${item.adicional_id} apunta a concepto inexistente: ${concepto_id}. Se creo concepto minimo.`);
      conceptos.push(normalizeConcepto({ concepto_id, nombre: item.nombre }, convenioId));
      conceptIds.add(concepto_id);
    }
    return {
    ...item,
    convenio_id: convenioId,
    adicional_id: canonConceptId(item.adicional_id, item.nombre),
    concepto_id
  };
  }).filter(Boolean), "adicional_id", "adicionales");

  const ambitos = (normalized.ambitos || []).map((item) => ({ ...item, convenio_id: convenioId }));

  return { ...normalized, ambitos, categorias, conceptos, escalas, adicionales };
}

function universalConcepts(source = {}) {
  const model = source.liquidationModel || {};
  return [
    ...array(model.concepts).map((item) => ({ ...item, __forcedType: item.type || "HABER" })),
    ...array(model.deductions).map((item) => ({ ...item, __forcedType: item.type || "DESCUENTO" })),
    ...array(model.retentions).map((item) => ({ ...item, __forcedType: item.type || "RETENCION" })),
    ...array(model.employerContributions).map((item) => ({ ...item, __forcedType: item.type || "APORTE_PATRONAL" }))
  ];
}

function normalizeConvenio(input = {}) {
  if (input?.data && (input.ok === true || input.data.schemaVersion || input.data.convenio)) input = input.data;
  if (input?.json_parcial) input = input.json_parcial;
  const wrapped = input?.parsedConvention || input?.structuredConvention || input?.resultado || input?.result;
  if (wrapped && typeof wrapped === "object" && (wrapped.schemaVersion || wrapped.convenio || wrapped.categorias || wrapped.categories)) input = wrapped;
  const source = input.schemaVersion === EXCEL_SCHEMA_VERSION || input.convenio
    ? input
    : { convenio: input, ambitos: input.ambitos, categorias: input.categorias, conceptos: input.conceptos, escalas: input.escalas, adicionales: input.adicionales };
  const universal = input.id && input.categories ? input : null;
  const convenio = normalizeConvenioRoot(source.convenio || universal || input);
  const convenioId = convenio.convenio_id;
  const conceptos = source.conceptos || (universal ? universalConcepts(universal) : []);
  const adicionales = source.adicionales || (universal?.additionals ? Object.values(universal.additionals) : []);
  return finalizeConvenio({
    schemaVersion: EXCEL_SCHEMA_VERSION,
    convenio,
    ambitos: array(source.ambitos).map((item, index) => normalizeAmbito(item, convenioId, index)),
    categorias: array(source.categorias || universal?.categories)
      .map((item, index) => normalizeCategoria(item, convenioId, index))
      .filter((category) => text(category.categoria_nombre).trim()),
    conceptos: array(conceptos).map((item, index) => normalizeConcepto(item, convenioId, index, item.__forcedType)),
    escalas: array(source.escalas || universal?.payrollBases?.scales)
      .map((item, index) => normalizeEscala(item, convenioId, index))
      .filter(escalaHasData),
    adicionales: array(adicionales).map((item, index) => normalizeAdicional(item, convenioId, index))
  });
}

function periodId(value) {
  const raw = text(value);
  const match = raw.match(/\b(20\d{2})[-/](0?[1-9]|1[0-2])\b/);
  return match ? `${match[1]}-${String(Number(match[2])).padStart(2, "0")}` : "";
}

function runtimeSalaryField(value = {}) {
  const raw = text(`${value.modalidad} ${value.unidad_pago} ${value.periodicidad}`).toLowerCase();
  if (raw.includes("hora")) return "hourly";
  if (raw.includes("jornal") || raw.includes("dia") || raw.includes("día")) return "day";
  return "monthly";
}

function toRuntimeConvention(input = {}) {
  const excel = normalizeConvenio(input);
  const id = excel.convenio.convenio_id || text(input.id);
  const periods = Array.from(new Set(excel.escalas.flatMap((scale) => [
    periodId(scale.periodo_desde),
    periodId(scale.periodo_hasta)
  ]).filter(Boolean))).map((period) => ({ id: period, label: period }));
  const zones = Array.from(new Set(excel.escalas.flatMap((scale) => [
    scale.zona,
    ...(scale.valores || []).map((value) => value.zona)
  ]).map(text).map((zone) => zone.trim()).filter(Boolean)));
  const fallbackPeriod = periods[0]?.id || "";
  const categories = excel.categorias.map((category) => {
    const row = {
      id: category.categoria_id,
      label: category.categoria_nombre,
      group: category.grupo_nombre || excel.convenio.rama,
      description: category.descripcion,
      monthlyByPeriod: {},
      dayByPeriod: {},
      hourlyByPeriod: {},
      nonRem: {}
    };
    excel.escalas.forEach((scale) => {
      const scalePeriod = periodId(scale.periodo_desde) || fallbackPeriod;
      scale.valores
        .filter((value) => value.categoria_id === category.categoria_id)
        .forEach((value) => {
          const amountValue = numericAmount(value.valor);
          if (amountValue === null) return;
          if (value.zona && !row.zone) row.zone = text(value.zona);
          const field = runtimeSalaryField(value);
          if (field === "day") row.dayByPeriod[scalePeriod] = amountValue;
          else if (field === "hourly") row.hourlyByPeriod[scalePeriod] = amountValue;
          else row.monthlyByPeriod[scalePeriod] = amountValue;
        });
    });
    const latestMonthly = Object.values(row.monthlyByPeriod).at(-1);
    const latestDay = Object.values(row.dayByPeriod).at(-1);
    const latestHourly = Object.values(row.hourlyByPeriod).at(-1);
    if (latestMonthly !== undefined) row.monthly = latestMonthly;
    if (latestDay !== undefined) row.day = latestDay;
    if (latestHourly !== undefined) row.hourly = latestHourly;
    return row;
  });
  const salaryType = categories.some((category) => category.day || Object.keys(category.dayByPeriod).length)
    ? "daily"
    : categories.some((category) => category.hourly || Object.keys(category.hourlyByPeriod).length)
      ? "hourly"
      : "monthly";
  const rules = { salaryType, monthDivisor: 30, hourDivisor: 200, weeklyHours: 48 };
  return {
    id,
    name: excel.convenio.denominacion || id,
    shortName: excel.convenio.denominacion || id,
    source: excel.convenio.fuente_documento,
    type: salaryType,
    calculationMode: "generic-v1",
    periods,
    zones: zones.length ? zones.map((zone) => ({ id: zone, label: zone, coef: 1 })) : [{ id: "general", label: "General", coef: 1 }],
    categories,
    rules,
    liquidationModel: {
      version: "generic-v1",
      rules,
      concepts: excel.conceptos.map((concept) => ({
        id: concept.concepto_id,
        label: concept.nombre,
        rowType: /NO\s*REM/i.test(concept.naturaleza) ? "nonRemunerative" : "remunerative",
        calculation: concept.importe_fijo ? "fixed" : "percentOfBase",
        amount: numericAmount(concept.importe_fijo),
        percent: numericAmount(concept.porcentaje) || 0,
        base: concept.base_calculo || "basic",
        detail: concept.condicion || concept.fuente_documento
      })).filter((concept) => concept.id && concept.label)
    },
    excelConvention: excel
  };
}

const convenioRootSchema = z.object({
  convenio_id: requiredText,
  tipo_norma: emptyText,
  numero: emptyText,
  "a\u00f1o": emptyText,
  denominacion: requiredText,
  actividad: emptyText,
  rama: emptyText,
  jurisdiccion: emptyText,
  organismo: emptyText,
  partes_sindicales: emptyText,
  partes_empleadoras: emptyText,
  fecha_homologacion: emptyText,
  vigencia_desde: emptyText,
  vigencia_hasta: emptyText,
  ambito_territorial: emptyText,
  personal_comprendido: emptyText,
  personal_excluido: emptyText,
  fuente_documento: emptyText
}).passthrough();

const ambitoSchema = z.object({
  ambito_id: requiredText,
  convenio_id: emptyText,
  tipo_ambito: emptyText,
  descripcion: emptyText,
  incluido: emptyText,
  excluido: emptyText,
  fuente_documento: emptyText
}).passthrough();

const categoriaSchema = z.object({
  categoria_id: requiredText,
  convenio_id: emptyText,
  grupo_nombre: emptyText,
  categoria_nombre: emptyText,
  descripcion: emptyText,
  tareas_incluidas: emptyText,
  modalidad_aplicable: emptyText,
  nivel_jerarquico: emptyText,
  fuente_documento: emptyText
}).passthrough();

const conceptoSchema = z.object({
  concepto_id: requiredText,
  convenio_id: emptyText,
  codigo: emptyText,
  nombre: emptyText,
  tipo_concepto: emptyText,
  naturaleza: emptyText,
  unidad_calculo: emptyText,
  formula_base: emptyText,
  base_calculo: emptyText,
  porcentaje: emptyText,
  importe_fijo: amountValue,
  aplica_a: emptyText,
  condicion: emptyText,
  fuente_documento: emptyText,
  es_liquidable: z.boolean().optional().default(true)
}).passthrough();

const escalaValorSchema = z.object({
  valor_id: requiredText,
  escala_id: requiredText,
  convenio_id: emptyText,
  categoria_id: emptyText,
  concepto_id: emptyText,
  modalidad: emptyText,
  unidad_pago: emptyText,
  periodicidad: emptyText,
  valor: amountValue,
  valor_minimo: amountValue,
  valor_maximo: amountValue,
  moneda: emptyText,
  alcance: emptyText,
  zona: emptyText,
  vigencia_desde: emptyText,
  vigencia_hasta: emptyText,
  fuente_documento: emptyText
}).passthrough();

const escalaSchema = z.object({
  escala_id: requiredText,
  convenio_id: emptyText,
  nombre_escala: emptyText,
  tipo_escala: emptyText,
  periodo_desde: emptyText,
  periodo_hasta: emptyText,
  moneda: emptyText,
  alcance: emptyText,
  zona: emptyText,
  fuente_documento: emptyText,
  valores: z.array(escalaValorSchema).optional().default([])
}).passthrough();

const adicionalSchema = z.object({
  adicional_id: requiredText,
  convenio_id: emptyText,
  concepto_id: emptyText,
  nombre: emptyText,
  tipo: emptyText,
  porcentaje: amountValue,
  importe: amountValue,
  base_calculo: emptyText,
  condicion: emptyText,
  zonas_aplica: emptyText,
  vigencia_desde: emptyText,
  vigencia_hasta: emptyText,
  fuente_documento: emptyText,
  articulo_anexo: emptyText,
  estado_revision: emptyText
}).passthrough();

const convenioSchema = z.preprocess(normalizeConvenio, z.object({
  schemaVersion: z.literal(EXCEL_SCHEMA_VERSION),
  convenio: convenioRootSchema,
  ambitos: z.array(ambitoSchema).optional().default([]),
  categorias: z.array(categoriaSchema).optional().default([]),
  conceptos: z.array(conceptoSchema).optional().default([]),
  escalas: z.array(escalaSchema).optional().default([]),
  adicionales: z.array(adicionalSchema).optional().default([])
}).strict());

function validationError(message, details = []) {
  const error = new Error(message);
  error.status = 400;
  error.details = details;
  return error;
}

function duplicateIds(items = [], key) {
  const seen = new Set();
  const duplicates = new Set();
  items.forEach((item) => {
    const value = text(item?.[key]).trim();
    if (!value) return;
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  });
  return Array.from(duplicates);
}

function assertNoDuplicates(items, key, label) {
  const duplicates = duplicateIds(items, key);
  if (duplicates.length) {
    throw validationError(`${label} duplicados`, duplicates.map((id) => ({ path: `${label}.${key}`, message: `${key} duplicado: ${id}` })));
  }
}

function containsObjectObject(value) {
  if (value === "[object Object]") return true;
  if (Array.isArray(value)) return value.some(containsObjectObject);
  if (value && typeof value === "object") return Object.values(value).some(containsObjectObject);
  return false;
}

function validateConvenioBusinessRules(convenio) {
  assertNoDuplicates(convenio.categorias, "categoria_id", "categorias");
  assertNoDuplicates(convenio.conceptos, "concepto_id", "conceptos");
  assertNoDuplicates(convenio.adicionales, "adicional_id", "adicionales");
  assertNoDuplicates(convenio.escalas, "escala_id", "escalas");
  if (containsObjectObject(convenio)) {
    throw validationError("Convenio contiene [object Object]", [{ path: "convenio", message: "Hay campos serializados como [object Object]" }]);
  }
  const categoryIds = new Set(convenio.categorias.map((item) => item.categoria_id));
  const conceptIds = new Set(convenio.conceptos.map((item) => item.concepto_id));
  const convenioIds = new Set([
    convenio.convenio.convenio_id,
    ...convenio.ambitos.map((item) => item.convenio_id),
    ...convenio.categorias.map((item) => item.convenio_id),
    ...convenio.conceptos.map((item) => item.convenio_id),
    ...convenio.escalas.map((item) => item.convenio_id),
    ...convenio.escalas.flatMap((escala) => escala.valores.map((value) => value.convenio_id)),
    ...convenio.adicionales.map((item) => item.convenio_id)
  ].filter(Boolean));
  const details = [];
  if (convenioIds.size > 1) {
    details.push({ path: "convenio_id", message: `Hay mas de un convenio_id: ${Array.from(convenioIds).join(", ")}` });
  }
  convenio.escalas.forEach((escala) => {
    assertNoDuplicates(escala.valores, "valor_id", `valores de escala ${escala.escala_id}`);
    escala.valores.forEach((value) => {
      if (value.categoria_id && !categoryIds.has(value.categoria_id)) {
        console.warn(`[CCT normalize] Escala ${escala.escala_id} apunta a categoria inexistente: ${value.categoria_id}`);
        details.push({ path: `escalas.${escala.escala_id}.valores.categoria_id`, message: `Categoria inexistente: ${value.categoria_id}` });
      }
      if (value.concepto_id && !conceptIds.has(value.concepto_id)) {
        console.warn(`[CCT normalize] Escala ${escala.escala_id} apunta a concepto inexistente: ${value.concepto_id}`);
        details.push({ path: `escalas.${escala.escala_id}.valores.concepto_id`, message: `Concepto inexistente: ${value.concepto_id}` });
      }
    });
  });
  convenio.conceptos.forEach((concept) => {
    const reference = isReferenceConcept(concept.concepto_id, concept.nombre);
    ["nombre", "tipo_concepto", "naturaleza"].forEach((field) => {
      if (!text(concept[field]).trim()) details.push({ path: `conceptos.${concept.concepto_id}.${field}`, message: `${field} vacio` });
    });
    if (reference && concept.es_liquidable !== false) details.push({ path: `conceptos.${concept.concepto_id}.es_liquidable`, message: "Concepto de referencia debe ser no liquidable" });
    if (!reference && concept.es_liquidable !== true) details.push({ path: `conceptos.${concept.concepto_id}.es_liquidable`, message: "Concepto liquidable debe ser liquidable" });
  });
  convenio.adicionales.forEach((adicional) => {
    if (!text(adicional.concepto_id).trim()) details.push({ path: `adicionales.${adicional.adicional_id}.concepto_id`, message: "concepto_id vacio" });
  });
  if (details.length) throw validationError("Convenio Excel con relaciones invalidas", details);
}

function parseConvenio(input) {
  const result = convenioSchema.safeParse(input);
  if (!result.success) {
    throw validationError("Convenio Excel invalido", result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })));
  }
  validateConvenioBusinessRules(result.data);
  return result.data;
}

function forceConvenioId(data, convenioId = "") {
  const finalConvenioId = canonConvenioId(convenioId || data.convenio.convenio_id || slugId(data.convenio.denominacion, "CONVENIO"));
  data.convenio.convenio_id = finalConvenioId;
  if (!text(data.convenio.denominacion).trim()) data.convenio.denominacion = `CCT ${finalConvenioId}`;
  ["ambitos", "categorias", "conceptos", "escalas", "adicionales"].forEach((key) => {
    (data[key] || []).forEach((item) => {
      item.convenio_id = finalConvenioId;
      (item.valores || []).forEach((value) => {
        value.convenio_id = finalConvenioId;
      });
    });
  });
  return data;
}

function normalizeAndValidateCCTJson(input) {
  const json_parcial = forceConvenioId(normalizeConvenio(input));
  try {
    const data = parseConvenio(json_parcial);
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      errores: error.details || [{ message: error.message }],
      data: null
    };
  }
}

const validateConvenioResult = normalizeAndValidateCCTJson;

function parseEscala(input, convenioId = "") {
  const result = escalaSchema.safeParse(normalizeEscala(input.escala || input, convenioId));
  if (!result.success) {
    throw validationError("Escala invalida", result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })));
  }
  assertNoDuplicates(result.data.valores, "valor_id", `valores de escala ${result.data.escala_id}`);
  return result.data;
}

module.exports = {
  EXCEL_SCHEMA_VERSION,
  adicionalSchema,
  ambitoSchema,
  categoriaSchema,
  conceptoSchema,
  convenioSchema,
  escalaSchema,
  escalaValorSchema,
  normalizeConvenio,
  normalizeAndValidateCCTJson,
  validateConvenioResult,
  toRuntimeConvention,
  parseConvenio,
  parseEscala
};
