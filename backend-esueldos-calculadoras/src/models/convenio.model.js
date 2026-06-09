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

function traceFields(item = {}) {
  return {
    documento_tipo: text(item.documento_tipo || item.tipo_documento || item.documentType),
    documento_rol: text(item.documento_rol || item.rol_documental || item.documentRole),
    evidencia: text(item.evidencia || item.evidence || item.sourceText || item.detalle_fuente),
    pagina: text(item.pagina || item.page || item.pageNumber),
    confianza: amount(item.confianza ?? item.confidence)
  };
}

function numericAmount(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = String(value).trim().replace(/\s/g, "").replace(/\$/g, "");
  const lastComma = raw.lastIndexOf(",");
  const lastDot = raw.lastIndexOf(".");
  let cleaned = raw;
  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSep = lastComma > lastDot ? "," : ".";
    const thousandsSep = decimalSep === "," ? "." : ",";
    cleaned = raw.replace(new RegExp(`\\${thousandsSep}`, "g"), "").replace(decimalSep, ".");
  } else if (lastComma >= 0) {
    cleaned = /^\d{1,3}(,\d{3})+$/.test(raw) ? raw.replace(/,/g, "") : raw.replace(",", ".");
  } else if (lastDot >= 0) {
    cleaned = /^\d{1,3}(\.\d{3})+$/.test(raw) ? raw.replace(/\./g, "") : raw;
  }
  cleaned = cleaned.replace(/[^0-9.-]/g, "");
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

function semanticCategoryKey(...values) {
  const aliases = {
    CAT: "CATEGORIA",
    CATEG: "CATEGORIA",
    CATEGORIA: "CATEGORIA",
    INI: "INICIAL",
    EMP: "EMPLEADO",
    EMPL: "EMPLEADO",
    ESP: "ESPECIALIZADO",
    FCIA: "FARMACIA",
    FARM: "FARMACEUTICO",
    PERF: "PERFUMERIA",
    ADMI: "ADMINISTRATIVO",
    ADM: "ADMINISTRATIVO",
    ADMIN: "ADMINISTRATIVO"
  };
  const stopwords = new Set(["DE", "DEL", "LA", "EL", "Y", "CATEGORIA"]);
  const raw = values.map(text).filter(Boolean).join(" ");
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((token) => aliases[token] || token)
    .filter((token) => token && !stopwords.has(token))
    .join("_");
}

function scaleValueVariantText(value = {}) {
  const parts = [value.modalidad, value.alcance]
    .map(text)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !/^(general|todos|todas|sin especificar|no aplica)$/i.test(item));
  return parts.join(" - ");
}

function scaleValueVariantId(value = {}) {
  const raw = scaleValueVariantText(value);
  if (!raw) return "";
  const id = slugId(raw);
  if (/^(GENERAL|TODOS|TODAS|SIN_ESPECIFICAR|NO_APLICA)$/.test(id)) return "";
  return id;
}

function variantCategoryId(baseCategoryId = "", variantId = "") {
  return [baseCategoryId, variantId].filter(Boolean).join("_");
}

function categoryVariantLabelFromId(categoryId = "") {
  const id = slugId(categoryId);
  if (/_SIN_RETIRO$/.test(id)) return "Sin retiro";
  if (/_CON_RETIRO$/.test(id)) return "Con retiro";
  return "";
}

function categoryRuntimeLabel(category = {}) {
  const base = text(category.categoria_nombre || category.categoria_id);
  const variant = text(category.modalidad_aplicable) || categoryVariantLabelFromId(category.categoria_id);
  if (!variant || new RegExp(variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(base)) return base;
  return `${base} - ${variant}`;
}

function categoryIdentityKey(category = {}) {
  return semanticCategoryKey(
    category.categoria_nombre || category.categoria_id,
    category.modalidad_aplicable || categoryVariantLabelFromId(category.categoria_id)
  );
}

function mergeCategoryData(existing, incoming, convenioId) {
  const merged = { ...incoming, ...existing };
  Object.entries(incoming || {}).forEach(([key, value]) => {
    if (!text(merged[key]).trim() && text(value).trim()) merged[key] = value;
  });
  return { ...merged, convenio_id: convenioId, categoria_id: existing.categoria_id };
}

function isAdditionalCategoryLabel(category = {}) {
  const raw = slugId(`${category.categoria_id || ""} ${category.categoria_nombre || ""} ${category.grupo_nombre || ""}`);
  return /(ADIC|ADICIONAL|PLUS|PREMIO|BONO|VIATIC|ASIGNACION|GRATIFIC|PRESENTISMO|PUNTUALIDAD|ANTIGUEDAD|TITULO|QUEBRANTO|FALLA.*CAJA|MOVILIDAD|REFRIGERIO|COMIDA|PERNOCT|NO.*REM|APORTE|CUOTA|FONDO|CONTRIBUCION|HORAS?_EXTRA)/.test(raw);
}

function isModalityOnlyCategoryLabel(category = {}) {
  const pattern = /^(PERSONAL_)?(SIN_RETIRO|CON_RETIRO|CON_RETIRO_MISMO_EMPLEADOR|CON_RETIRO_DISTINTOS_EMPLEADORES|JORNADA_COMPLETA|JORNADA_PARCIAL|MEDIA_JORNADA|TIEMPO_COMPLETO|TIEMPO_PARCIAL|MENSUALIZADO|JORNALIZADO)$/;
  const label = slugId(category.categoria_nombre || "");
  const id = slugId(category.categoria_id || "");
  return pattern.test(label) || (!label && pattern.test(id));
}

function isGeneralGroupingCategory(category = {}) {
  const id = slugId(category.categoria_id || "");
  const label = slugId(category.categoria_nombre || "");
  const modality = text(category.modalidad_aplicable);
  return /^(CATEGORIA_GENERAL|GENERAL|PERSONAL_GENERAL|TODAS_LAS_CATEGORIAS)$/.test(id)
    || (/PERSONAL/.test(label) && /SIN_RETIRO|CON_RETIRO|JORNADA|MODALIDAD/.test(slugId(modality)));
}

function isNonLiquidableLicenseConcept(concept = {}) {
  const raw = slugId(`${concept.concepto_id || ""} ${concept.nombre || ""} ${concept.condicion || ""} ${concept.formula_base || ""}`);
  if (/(ADICIONAL|PLUS|BONIFICACION|BONO|PREMIO).*(VACACION|VACACIONAL|LICENCIA)/.test(raw)) return false;
  return /(LICENCIA|VACACION|VACACIONAL|MATERNIDAD|NACIMIENTO|MATRIMONIO|FALLECIMIENTO|EXAMEN|ENFERMEDAD|ACCIDENTE|DONACION|MUDANZA|EMBARAZO|PRENATAL|PROTECCION_SOCIAL)/.test(raw);
}

function normalizeRetiroDuplicateValues(normalized = {}) {
  const nameById = new Map(array(normalized.categorias).map((category) => [category.categoria_id, category.categoria_nombre]));
  array(normalized.escalas).forEach((scale) => {
    const groups = new Map();
    array(scale.valores).forEach((value, index) => {
      const categoryId = slugId(value.categoria_id || "");
      const conceptId = canonConceptId(value.concepto_id || "");
      if (!/_CON_RETIRO$/.test(categoryId) || text(value.modalidad).trim()) return;
      if (!/^(SUELDO_BASICO|VALOR_HORA|VALOR_DIA|VALOR_JORNAL)$/.test(conceptId)) return;
      const numericValue = numericAmount(value.valor);
      if (numericValue === null) return;
      const key = [
        scale.escala_id,
        categoryId.replace(/_CON_RETIRO$/, ""),
        conceptId,
        text(value.periodicidad || scale.periodo_desde || scale.nombre_escala),
        text(value.unidad_pago),
        text(value.zona || scale.zona)
      ].join("|");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ value, index, amount: numericValue, categoryId });
    });
    groups.forEach((items) => {
      const distinct = new Set(items.map((item) => item.amount));
      if (items.length < 2 || distinct.size < 2) return;
      const sorted = [...items].sort((a, b) => a.amount - b.amount || a.index - b.index);
      sorted.forEach((item, position) => {
        const isSinRetiro = position === sorted.length - 1;
        const nextId = isSinRetiro ? item.categoryId.replace(/_CON_RETIRO$/, "_SIN_RETIRO") : item.categoryId;
        item.value.categoria_id = nextId;
        item.value.categoria_nombre = text(item.value.categoria_nombre || nameById.get(item.categoryId));
        item.value.modalidad = isSinRetiro ? "Sin retiro" : "Con retiro";
      });
    });
  });
}

function canonConceptId(value, name = "") {
  if (!text(value).trim() && !text(name).trim()) return "";
  const raw = slugId(`${value || ""} ${name || ""}`);
  if (/SUELDO.*ANUAL.*COMPLEMENTARIO|SAC|AGUINALDO/.test(raw)) return "SAC";
  if (/SUELDO|BASICO|BASICA|SALARIO/.test(raw)) return "SUELDO_BASICO";
  if (/ASISTENCIA|PERFECTA/.test(raw)) return "PRESENTISMO_ASISTENCIA";
  if (/PRESENTISMO|PUNTUALIDAD/.test(raw)) return "PRESENTISMO_PUNTUALIDAD";
  if (/ANTIG/.test(raw)) return "ANTIGUEDAD";
  if (/PROLONGACION|JORNADA/.test(raw) && /PROLONGACION/.test(raw)) return "PROLONGACION_JORNADA";
  if (/KILO.*PAN|PAN.*DIARIO/.test(raw)) return "KILO_PAN";
  if (/CUOTA.*SINDICAL|SINDICAL/.test(raw)) return "CUOTA_SINDICAL";
  if (/FONDO.*SOLIDARIO.*TRABAJADOR/.test(raw)) return "FONDO_SOLIDARIO_TRABAJADOR";
  if (/DIA.*PANADERO/.test(raw)) return "DIA_PANADERO";
  if (/NO.*REM|NO.*REMUNER|SUMA.*NO.*REMUNER|ASIGNACION.*NO.*REMUNER|BONO.*NO.*REMUNER/.test(raw)) return "NO_REMUNERATIVO";
  if (/TOTAL.*REMUNERATIVO/.test(raw)) return "TOTAL_REMUNERATIVO";
  if (/VIATIC/.test(raw)) return "VIATICO";
  if (/TOTAL.*7|7H|7_H/.test(raw)) return "TOTAL_7H";
  if (/TOTAL.*8|8H|8_H/.test(raw)) return "TOTAL_8H";
  if (/CHANGA/.test(raw)) return "VALOR_CHANGA";
  return slugId(value || name, "");
}

function isReferenceConcept(id = "", name = "") {
  return /^(TOTAL_7H|TOTAL_8H|VALOR_CHANGA|TOTAL_REMUNERATIVO|TOTAL_HABERES|TOTAL_A_ABONAR)$/.test(canonConceptId(id, name));
}

function isNonRemunerativeConcept(concept = {}) {
  const id = canonConceptId(concept.concepto_id, concept.nombre);
  const raw = slugId(`${concept.concepto_id || ""} ${concept.nombre || ""} ${concept.tipo_concepto || ""} ${concept.naturaleza || ""}`);
  return id === "NO_REMUNERATIVO" || /NO.*REM|NO.*REMUNER/.test(raw);
}

function normalizeConceptType(concept = {}, { id, reference } = {}) {
  if (reference) return "referencia";
  const raw = slugId(`${concept.concepto_id || ""} ${concept.nombre || ""} ${concept.tipo_concepto || ""} ${concept.naturaleza || ""}`);
  if (/APORTE.*PATRONAL|CONTRIBUCION.*PATRONAL|EMPLEADOR|PATRONAL/.test(raw)) return "aporte_patronal";
  if (/(DESCUENTO|RETENCION|DEDUCCION|CUOTA|APORTE|OBRA_SOCIAL|JUBILACION|LEY_19032|SINDICAL)/.test(raw)
    && !/(ADICIONAL|HABER|BONO|ASIGNACION|VIATIC|PREMIO|SUELDO|SALARIO)/.test(raw)) return "descuento";
  if (/(HABER|REMUNER|NO_REM|SUELDO|SALARIO|BASICO|ADICIONAL|BONO|ASIGNACION|PREMIO|VIATIC|PRESENTISMO|PUNTUALIDAD|ANTIGUEDAD|HORAS?_EXTRA|FERIADO|COMISION)/.test(raw)) return "haber";
  if (/^(SUELDO_BASICO|SAC|NO_REMUNERATIVO|PRESENTISMO_ASISTENCIA|PRESENTISMO_PUNTUALIDAD|ANTIGUEDAD|PROLONGACION_JORNADA|KILO_PAN|VIATICO|DIA_PANADERO)$/.test(id)) return "haber";
  return text(concept.tipo_concepto || "haber");
}

function normalizeConceptNature(concept = {}, { id, reference, nonRemunerative } = {}) {
  if (reference) return "referencial";
  const raw = slugId(`${concept.concepto_id || ""} ${concept.nombre || ""} ${concept.tipo_concepto || ""} ${concept.naturaleza || ""}`);
  if (nonRemunerative) return "no_remunerativo";
  if (/(RETENCION|DEDUCCION|DESCUENTO|CUOTA|OBRA_SOCIAL|JUBILACION|LEY_19032|APORTE_TRABAJADOR|SINDICAL)/.test(raw)
    && !/(HABER|BONO|ASIGNACION|ADICIONAL|PREMIO|SUELDO|SALARIO)/.test(raw)) return "retencion";
  if (/(APORTE.*PATRONAL|CONTRIBUCION.*PATRONAL|EMPLEADOR|PATRONAL)/.test(raw)) return "contribucion_patronal";
  if (/(REMUNERATIVO|BASICO|BASICA|SUELDO|SALARIO)/.test(raw)) return "remunerativo";
  if (/^(SUELDO_BASICO|SAC|PRESENTISMO_ASISTENCIA|PRESENTISMO_PUNTUALIDAD|ANTIGUEDAD|PROLONGACION_JORNADA|DIA_PANADERO)$/.test(id)) return "remunerativo";
  return text(concept.naturaleza || "requiere_revision_manual");
}

function normalizeBaseCalculo(value, concept = {}, { id, reference, nonRemunerative } = {}) {
  const raw = slugId(value || concept.base || concept.base_calculo || "");
  if (raw) {
    if (/SUELDO.*BASICO|BASICO/.test(raw)) return "sueldo_basico";
    if (/TOTAL.*REMUNERATIVO/.test(raw)) return "total_remunerativo";
    if (/HABERES?.*REMUNERATIVOS?|REMUNERACION.*REMUNERATIVA/.test(raw)) return "haberes_remunerativos";
    if (/REMUNERACION.*SUJETA.*APORTE|BASE.*APORTE|BASE.*IMPONIBLE/.test(raw)) return "remuneracion_sujeta_a_aporte";
    if (/VALOR.*HORA|HORA/.test(raw)) return "valor_hora";
    if (/VALOR.*DIA|JORNAL|DIA/.test(raw)) return "valor_dia";
    if (/ESCALA|VALOR.*ESCALA/.test(raw)) return "escala_salarial";
    if (/MONTO.*FIJO|IMPORTE.*FIJO|SUMA.*FIJA/.test(raw)) return "monto_fijo";
    return text(value || concept.base || concept.base_calculo);
  }
  const inferred = {
    PRESENTISMO_ASISTENCIA: "sueldo_basico",
    PRESENTISMO_PUNTUALIDAD: "sueldo_basico",
    ANTIGUEDAD: "sueldo_basico",
    PROLONGACION_JORNADA: "valor_hora",
    KILO_PAN: "valor_kilo_pan",
    CUOTA_SINDICAL: "remuneracion_sujeta_a_aporte",
    FONDO_SOLIDARIO_TRABAJADOR: "remuneracion_sujeta_a_aporte"
  }[id];
  if (inferred) return inferred;
  if (reference || id === "SUELDO_BASICO" || nonRemunerative) return "escala_salarial";
  if (concept.importe_fijo !== undefined && concept.importe_fijo !== null && concept.importe_fijo !== "") return "monto_fijo";
  if (concept.porcentaje !== undefined && concept.porcentaje !== null && concept.porcentaje !== "") return "requiere_revision_manual";
  return "requiere_revision_manual";
}

function conceptDefaults(concept = {}) {
  const id = canonConceptId(concept.concepto_id, concept.nombre);
  const reference = isReferenceConcept(id, concept.nombre);
  const nonRemunerative = isNonRemunerativeConcept({ ...concept, concepto_id: id });
  const names = {
    SUELDO_BASICO: "Sueldo Basico",
    SAC: "Sueldo Anual Complementario",
    NO_REMUNERATIVO: "Haber no remunerativo",
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
    tipo_concepto: normalizeConceptType(concept, { id, reference }),
    naturaleza: normalizeConceptNature(concept, { id, reference, nonRemunerative }),
    unidad_calculo: concept.unidad_calculo || (id === "PROLONGACION_JORNADA" ? "hora" : id === "KILO_PAN" ? "diaria" : "mensual"),
    formula_base: reference ? "valor_referencia_escala" : (concept.formula_base || ({
      PRESENTISMO_ASISTENCIA: "segun_regla_convenio",
      PRESENTISMO_PUNTUALIDAD: "segun_regla_convenio",
      SAC: "porcentaje_sobre_base",
      NO_REMUNERATIVO: "valor_escala_categoria",
      ANTIGUEDAD: "porcentaje_sobre_base",
      PROLONGACION_JORNADA: "porcentaje_sobre_valor_hora",
      KILO_PAN: "beneficio_en_especie_o_equivalente",
      CUOTA_SINDICAL: "porcentaje_sobre_base",
      FONDO_SOLIDARIO_TRABAJADOR: "porcentaje_sobre_base"
    }[id] || "valor_escala_categoria")),
    base_calculo: normalizeBaseCalculo(concept.base_calculo || concept.base, concept, { id, reference, nonRemunerative }) || (reference ? "escala_salarial" : ({
      PRESENTISMO_ASISTENCIA: "sueldo_basico",
      PRESENTISMO_PUNTUALIDAD: "sueldo_basico",
      SAC: "total_remunerativo",
      NO_REMUNERATIVO: "escala_salarial",
      ANTIGUEDAD: "sueldo_basico",
      PROLONGACION_JORNADA: "valor_hora",
      KILO_PAN: "valor_kilo_pan",
      CUOTA_SINDICAL: "remuneracion_sujeta_a_aporte",
      FONDO_SOLIDARIO_TRABAJADOR: "remuneracion_sujeta_a_aporte"
    }[id] || "escala_salarial")),
    condicion: reference ? "Valor informativo de escala; no se liquida automaticamente" : (concept.condicion || ({
      PRESENTISMO_ASISTENCIA: "Aplica segun asistencia perfecta",
      PRESENTISMO_PUNTUALIDAD: "Aplica segun puntualidad",
      SAC: "Aplica segun semestre o regla legal/convencional",
      NO_REMUNERATIVO: "Aplica segun categoria, periodo y vigencia de escala",
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
    fuente_documento: text(source.fuente_documento || source.source),
    ...traceFields(source)
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
    fuente_documento: text(item.fuente_documento || item.source),
    ...traceFields(item)
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
    fuente_documento: text(item.fuente_documento || item.source),
    ...traceFields(item)
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
    es_liquidable: item.es_liquidable === undefined ? defaults.es_liquidable : Boolean(item.es_liquidable),
    ...traceFields(item)
  };
}

function normalizeValor(item = {}, convenioId = "", escalaId = "", index = 0) {
  const rawConceptId = item.concepto_id || item.conceptId || item.concepto || item.nombre_concepto;
  const rawCategoryId = item.categoria_id || item.categoryId || item.categoria || item.categoria_nombre || item.nombre_categoria;
  const normalizedCategoryId = rawCategoryId || item.categoria_nombre || item.categoryName || item.categoria
    ? canonCategoryId(rawCategoryId, item.categoria_nombre || item.categoryName || item.categoria, item.grupo_nombre || item.rama || item.groupName || item.group)
    : "";
  return {
    valor_id: text(item.valor_id || item.id || `valor-${index + 1}`),
    escala_id: text(item.escala_id || item.scaleId || escalaId),
    convenio_id: canonConvenioId(item.convenio_id || convenioId),
    categoria_id: normalizedCategoryId,
    categoria_nombre: text(item.categoria_nombre || item.categoryName || item.categoria),
    grupo_nombre: text(item.grupo_nombre || item.rama || item.groupName || item.group),
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
    fuente_documento: text(item.fuente_documento || item.source),
    ...traceFields(item)
  };
}

function expandScaleValue(item = {}, convenioId = "", escalaId = "", index = 0) {
  const base = normalizeValor(item, convenioId, escalaId, index);
  const values = base.concepto_id && base.valor !== null && base.valor !== undefined && base.valor !== "" ? [base] : [];
  const columns = [
    [["sueldo_basico", "basico", "salario_basico"], "SUELDO_BASICO", "mensual"],
    [["no_remunerativo", "no_rem", "suma_no_remunerativa", "asignacion_no_remunerativa", "bono_no_remunerativo"], "NO_REMUNERATIVO", "mensual"],
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
    valores,
    ...traceFields(item)
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
    estado_revision: text(item.estado_revision || item.status),
    ...traceFields(item)
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
  normalizeRetiroDuplicateValues(normalized);
  const categoryByName = new Map();
  const categoryIdMap = new Map();
  const categoryByCanonicalName = new Map();
  const additionalCategoryById = new Map();
  const promotedAdditionalConcepts = [];
  const promotedAdicionales = [];
  for (const category of dedupeById(normalized.categorias, "categoria_id", "categorias")) {
    const canonicalId = canonCategoryId(category.categoria_id, category.categoria_nombre, category.grupo_nombre);
    if (canonicalId && canonicalId !== category.categoria_id) {
      console.warn(`[CCT normalize] categoria_id normalizado: ${category.categoria_id} -> ${canonicalId}`);
    }
    if (isModalityOnlyCategoryLabel(category)) {
      console.warn(`[CCT normalize] Categoria descartada por ser modalidad pura: ${category.categoria_nombre || category.categoria_id}`);
      categoryIdMap.set(category.categoria_id, "");
      categoryIdMap.set(canonicalId, "");
      continue;
    }
    if (isAdditionalCategoryLabel(category)) {
      const concepto_id = canonConceptId(category.categoria_id, category.categoria_nombre);
      console.warn(`[CCT normalize] Categoria reclasificada como adicional/concepto: ${category.categoria_nombre || category.categoria_id} -> ${concepto_id}`);
      const promoted = {
        concepto_id,
        nombre: text(category.categoria_nombre || category.categoria_id),
        fuente_documento: text(category.fuente_documento)
      };
      additionalCategoryById.set(category.categoria_id, promoted);
      additionalCategoryById.set(canonicalId, promoted);
      categoryIdMap.set(category.categoria_id, "");
      categoryIdMap.set(canonicalId, "");
      promotedAdditionalConcepts.push(promoted);
      promotedAdicionales.push({ adicional_id: concepto_id, concepto_id, nombre: promoted.nombre, fuente_documento: promoted.fuente_documento });
      continue;
    }
    const nameKey = categoryIdentityKey(category);
    if (categoryByCanonicalName.has(nameKey)) {
      const existing = categoryByCanonicalName.get(nameKey);
      console.warn(`[CCT normalize] Categoria duplicada por nombre: ${category.categoria_nombre}. ${category.categoria_id} -> ${existing.categoria_id}`);
      categoryIdMap.set(category.categoria_id, existing.categoria_id);
      categoryIdMap.set(canonicalId, existing.categoria_id);
      categoryByCanonicalName.set(nameKey, mergeCategoryData(existing, { ...category, categoria_id: canonicalId }, convenioId));
      continue;
    }
    const finalCategory = { ...category, convenio_id: convenioId, categoria_id: canonicalId };
    categoryIdMap.set(category.categoria_id, canonicalId);
    categoryIdMap.set(canonicalId, canonicalId);
    categoryByCanonicalName.set(nameKey, finalCategory);
    categoryByName.set(slugId(finalCategory.categoria_nombre), finalCategory.categoria_id);
    categoryByName.set(semanticCategoryKey(finalCategory.categoria_nombre), finalCategory.categoria_id);
    categoryByName.set(semanticCategoryKey(finalCategory.categoria_id), finalCategory.categoria_id);
  }
  let categorias = Array.from(categoryByCanonicalName.values());
  let categoryIds = new Set(categorias.map((category) => category.categoria_id));

  const resolveCategoryIdForValue = (value = {}, scale = {}) => {
    const hasValueCategory = text(value.categoria_id).trim() || text(value.categoria_nombre).trim() || text(value.grupo_nombre).trim();
    const normalizedCategoryId = hasValueCategory ? canonCategoryId(value.categoria_id, value.categoria_nombre, value.grupo_nombre || scale.zona) : "";
    return categoryIds.has(normalizedCategoryId)
      ? normalizedCategoryId
      : (categoryIdMap.get(value.categoria_id)
        || categoryIdMap.get(normalizedCategoryId)
        || categoryByName.get(semanticCategoryKey(value.categoria_nombre, value.categoria_id))
        || categoryByName.get(slugId(value.categoria_id))
        || normalizedCategoryId);
  };

  const variantPlans = new Map();
  normalized.escalas.forEach((scale) => {
    (scale.valores || []).forEach((value) => {
      const baseCategoryId = resolveCategoryIdForValue(value, scale);
      if (!baseCategoryId) return;
      const conceptId = canonConceptId(value.concepto_id || "SUELDO_BASICO");
      if (!/^(SUELDO_BASICO|NO_REMUNERATIVO|VALOR_HORA|VALOR_DIA|VALOR_JORNAL)$/.test(conceptId)) return;
      const plan = variantPlans.get(baseCategoryId) || { total: 0, variantless: 0, variants: new Map() };
      plan.total += 1;
      const variantId = scaleValueVariantId(value);
      if (variantId) plan.variants.set(variantId, scaleValueVariantText(value));
      else plan.variantless += 1;
      variantPlans.set(baseCategoryId, plan);
    });
  });

  const splitBaseCategoryIds = new Set();
  const variantCategoryByKey = new Map();
  variantPlans.forEach((plan, baseCategoryId) => {
    if (plan.variants.size <= 1 || plan.variantless > 0) return;
    const baseCategory = categorias.find((category) => category.categoria_id === baseCategoryId);
    if (!baseCategory) return;
    splitBaseCategoryIds.add(baseCategoryId);
    plan.variants.forEach((variantLabel, variantId) => {
      const finalId = variantCategoryId(baseCategoryId, variantId);
      variantCategoryByKey.set(`${baseCategoryId}|${variantId}`, finalId);
      if (!categoryIds.has(finalId)) {
        categorias.push({
          ...baseCategory,
          categoria_id: finalId,
          categoria_nombre: `${baseCategory.categoria_nombre} - ${variantLabel}`,
          modalidad_aplicable: variantLabel
        });
      }
    });
  });
  if (splitBaseCategoryIds.size) {
    categorias = categorias.filter((category) => !splitBaseCategoryIds.has(category.categoria_id));
    categoryIds = new Set(categorias.map((category) => category.categoria_id));
  }

  const conceptosInput = [...normalized.conceptos, ...promotedAdditionalConcepts].filter((concept) => {
    if (!isNonLiquidableLicenseConcept(concept)) return true;
    console.warn(`[CCT normalize] Concepto descartado por ser licencia/regimen no liquidable: ${concept.nombre || concept.concepto_id}`);
    return false;
  }).map((concept) => {
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
      const valueCategoryIsModality = isModalityOnlyCategoryLabel(value);
      const normalizedValue = valueCategoryIsModality
        ? { ...value, modalidad: text(value.modalidad || value.categoria_nombre || value.categoria_id), categoria_id: "", categoria_nombre: "", grupo_nombre: "" }
        : value;
      const hasValueCategory = text(normalizedValue.categoria_id).trim() || text(normalizedValue.categoria_nombre).trim() || text(normalizedValue.grupo_nombre).trim();
      const normalizedCategoryId = hasValueCategory ? canonCategoryId(normalizedValue.categoria_id, normalizedValue.categoria_nombre, normalizedValue.grupo_nombre || scale.zona) : "";
      const promotedAdditional = additionalCategoryById.get(normalizedValue.categoria_id) || additionalCategoryById.get(normalizedCategoryId);
      const categoryId = promotedAdditional ? "" : categoryIds.has(normalizedCategoryId)
        ? normalizedCategoryId
        : (categoryIdMap.get(normalizedValue.categoria_id)
          || categoryIdMap.get(normalizedCategoryId)
          || categoryByName.get(semanticCategoryKey(normalizedValue.categoria_nombre, normalizedValue.categoria_id))
          || categoryByName.get(slugId(normalizedValue.categoria_id)));
      const conceptId = promotedAdditional ? canonConceptId(promotedAdditional.concepto_id, promotedAdditional.nombre) : canonConceptId(normalizedValue.concepto_id || "SUELDO_BASICO");
      const baseCategoryId = categoryId || normalizedCategoryId || normalizedValue.categoria_id;
      const variantId = scaleValueVariantId(normalizedValue);
      const finalCategoryId = !promotedAdditional && splitBaseCategoryIds.has(baseCategoryId) && variantId
        ? (variantCategoryByKey.get(`${baseCategoryId}|${variantId}`) || baseCategoryId)
        : baseCategoryId;
      if (!promotedAdditional && finalCategoryId && !categoryIds.has(finalCategoryId)) {
        console.warn(`[CCT normalize] Se creo categoria minima desde escala ${scale.escala_id}: ${finalCategoryId}`);
        categorias.push({
          categoria_id: finalCategoryId,
          convenio_id: convenioId,
          grupo_nombre: text(normalizedValue.grupo_nombre || scale.zona),
          categoria_nombre: text(normalizedValue.categoria_nombre) || finalCategoryId.replace(/_/g, " "),
          descripcion: "",
          tareas_incluidas: "",
          modalidad_aplicable: text(normalizedValue.modalidad) || categoryVariantLabelFromId(finalCategoryId),
          nivel_jerarquico: "",
          fuente_documento: text(normalizedValue.fuente_documento || scale.fuente_documento)
        });
        categoryIds.add(finalCategoryId);
      }
      if (!conceptIds.has(conceptId)) {
        console.warn(`[CCT normalize] Escala ${scale.escala_id} apunta a concepto inexistente: ${conceptId}. Se creo concepto minimo.`);
        conceptos.push(normalizeConcepto({ concepto_id: conceptId, nombre: conceptId.replace(/_/g, " ") }, normalized.convenio.convenio_id));
        conceptIds.add(conceptId);
      }
      return {
        ...normalizedValue,
        convenio_id: convenioId,
        categoria_id: promotedAdditional ? "" : finalCategoryId,
        categoria_nombre: promotedAdditional ? "" : normalizedValue.categoria_nombre,
        grupo_nombre: promotedAdditional ? "" : normalizedValue.grupo_nombre,
        concepto_id: conceptId
      };
    })
  }));

  const adicionales = dedupeById([...normalized.adicionales, ...promotedAdicionales].filter((item) => {
    if (!isNonLiquidableLicenseConcept({ ...item, concepto_id: item.concepto_id || item.adicional_id })) return true;
    console.warn(`[CCT normalize] Adicional descartado por ser licencia/regimen no liquidable: ${item.nombre || item.adicional_id}`);
    return false;
  }).map((item) => {
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
  const valuedCategoryIds = new Set(escalas.flatMap((scale) => (scale.valores || [])
    .filter((value) => numericAmount(value.valor) !== null)
    .map((value) => value.categoria_id)
    .filter(Boolean)));
  categorias = categorias.filter((category) => valuedCategoryIds.has(category.categoria_id) || !isGeneralGroupingCategory(category));

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

const PERIOD_MONTHS = {
  enero: 1,
  ene: 1,
  january: 1,
  jan: 1,
  febrero: 2,
  feb: 2,
  february: 2,
  marzo: 3,
  mar: 3,
  march: 3,
  abril: 4,
  abr: 4,
  april: 4,
  apr: 4,
  mayo: 5,
  may: 5,
  junio: 6,
  jun: 6,
  june: 6,
  julio: 7,
  jul: 7,
  july: 7,
  agosto: 8,
  ago: 8,
  august: 8,
  aug: 8,
  septiembre: 9,
  setiembre: 9,
  sep: 9,
  set: 9,
  september: 9,
  octubre: 10,
  oct: 10,
  october: 10,
  noviembre: 11,
  nov: 11,
  november: 11,
  diciembre: 12,
  dic: 12,
  december: 12,
  dec: 12
};

function formatPeriod(year, month) {
  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || !Number.isInteger(m) || y < 2000 || m < 1 || m > 12) return "";
  return `${y}-${String(m).padStart(2, "0")}`;
}

function normalizedPeriodText(value) {
  return text(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function periodIds(...values) {
  const raw = values.map(text).filter(Boolean).join(" ");
  const normalized = normalizedPeriodText(raw);
  const periods = [];
  const add = (year, month) => {
    const period = formatPeriod(year, month);
    if (period && !periods.includes(period)) periods.push(period);
  };
  const addRange = (year, fromMonth, toMonth) => {
    const from = Number(fromMonth);
    const to = Number(toMonth);
    const y = Number(year);
    if (!Number.isInteger(y) || !Number.isInteger(from) || !Number.isInteger(to)) return;
    if (from < 1 || from > 12 || to < 1 || to > 12 || to < from) return;
    for (let month = from; month <= to; month += 1) add(y, month);
  };

  raw.replace(/\b(20\d{2})[-/.](0?[1-9]|1[0-2])(?:[-/.]\d{1,2})?\b/g, (_, year, month) => add(year, month));
  raw.replace(/\b(0?[1-9]|[12]\d|3[01])[-/.](0?[1-9]|1[0-2])[-/.](20\d{2})\b/g, (_, _day, month, year) => add(year, month));
  raw.replace(/\b(0?[1-9]|1[0-2])[-/.](20\d{2})\b/g, (_, month, year) => add(year, month));
  const monthPattern = Object.keys(PERIOD_MONTHS).sort((a, b) => b.length - a.length).join("|");
  const rangePattern = new RegExp(`\\b(${monthPattern})\\b\\s*(?:a|al|hasta|to|through|-|/)\\s*\\b(${monthPattern})\\b\\s*(?:de\\s*)?(20\\d{2})\\b`, "g");
  normalized.replace(rangePattern, (_, fromMonth, toMonth, year) => addRange(year, PERIOD_MONTHS[fromMonth], PERIOD_MONTHS[toMonth]));

  const tokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  let pendingMonths = [];
  let currentYear = "";
  tokens.forEach((token) => {
    if (PERIOD_MONTHS[token]) {
      pendingMonths.push(PERIOD_MONTHS[token]);
      if (currentYear) add(currentYear, PERIOD_MONTHS[token]);
      return;
    }
    if (/^20\d{2}$/.test(token)) {
      currentYear = token;
      pendingMonths.forEach((month) => add(token, month));
      pendingMonths = [];
      return;
    }
    if (!["a", "al", "de", "del", "hasta", "y", "e", "to", "from", "through"].includes(token)) {
      pendingMonths = [];
    }
  });

  return periods;
}

function periodId(value) {
  return periodIds(value)[0] || "";
}

function periodRangeIds(fromValue, toValue) {
  const from = periodId(fromValue);
  const to = periodId(toValue);
  if (!from || !to) return [];
  const [fromYear, fromMonth] = from.split("-").map(Number);
  const [toYear, toMonth] = to.split("-").map(Number);
  const fromIndex = fromYear * 12 + fromMonth;
  const toIndex = toYear * 12 + toMonth;
  if (toIndex < fromIndex || toIndex - fromIndex > 36) return [from];
  const periods = [];
  for (let index = fromIndex; index <= toIndex; index += 1) {
    const year = Math.floor((index - 1) / 12);
    const month = ((index - 1) % 12) + 1;
    periods.push(formatPeriod(year, month));
  }
  return periods.filter(Boolean);
}

function scalePeriodIds(scale = {}) {
  const range = periodRangeIds(scale.periodo_desde, scale.periodo_hasta);
  return Array.from(new Set([
    ...range,
    ...periodIds(scale.periodo_desde, scale.periodo_hasta, scale.nombre_escala, scale.escala_id),
    ...array(scale.valores).flatMap((value) => periodIds(value.periodicidad, value.periodo, value.mes, value.fecha, value.vigencia_desde, value.vigencia_hasta))
  ].filter(Boolean)));
}

function runtimeSalaryField(value = {}) {
  const raw = text(`${value.modalidad} ${value.unidad_pago} ${value.periodicidad}`).toLowerCase();
  if (raw.includes("hora")) return "hourly";
  if (raw.includes("jornal") || raw.includes("dia") || raw.includes("día")) return "day";
  return "monthly";
}

function runtimeConceptRowType(concept = {}) {
  const raw = slugId(`${concept.concepto_id || ""} ${concept.nombre || ""} ${concept.tipo_concepto || ""} ${concept.naturaleza || ""}`);
  if (/REFERENCIA|REFERENCIAL|TOTAL_/.test(raw)) return "reference";
  if (/APORTE_PATRONAL|CONTRIBUCION_PATRONAL|PATRONAL|EMPLEADOR/.test(raw)) return "employerContribution";
  if (/DESCUENTO|RETENCION|DEDUCCION|CUOTA|APORTE|OBRA_SOCIAL|JUBILACION|LEY_19032|SINDICAL/.test(raw)
    && !/HABER|ADICIONAL|BONO|ASIGNACION|PREMIO|SUELDO|SALARIO|NO_REM/.test(raw)) return "deduction";
  if (/NO_REMUNERATIVO|NO_REM/.test(raw)) return "nonRemunerative";
  return "remunerative";
}

function runtimeConceptCalculation(concept = {}) {
  const formula = slugId(`${concept.formula_base || ""} ${concept.unidad_calculo || ""}`);
  if (numericAmount(concept.importe_fijo) !== null || /MONTO_FIJO|IMPORTE_FIJO|SUMA_FIJA|FIJO/.test(formula)) return "fixed";
  if (numericAmount(concept.porcentaje) !== null || /PORCENTAJE|PERCENT|SOBRE_BASE|SOBRE_VALOR/.test(formula)) return "percentOfBase";
  if (/VALOR_ESCALA|ESCALA_SALARIAL|ESCALA_CATEGORIA/.test(formula)) return "scaleValue";
  if (/VALOR_HORA|HORA/.test(formula)) return "amountPerUnit";
  if (/REFERENCIA/.test(formula)) return "reference";
  return text(concept.formula_base || "requiresReview");
}

function toRuntimeConvention(input = {}) {
  const excel = normalizeConvenio(input);
  const id = excel.convenio.convenio_id || text(input.id);
  const periods = Array.from(new Set(excel.escalas.flatMap(scalePeriodIds).filter(Boolean)))
    .sort()
    .map((period) => ({ id: period, label: period }));
  const zones = Array.from(new Set(excel.escalas.flatMap((scale) => [
    scale.zona,
    ...(scale.valores || []).map((value) => value.zona)
  ]).map(text).map((zone) => zone.trim()).filter(Boolean)));
  const fallbackPeriod = periods[0]?.id || "";
  const categories = excel.categorias.map((category) => {
    const row = {
      id: category.categoria_id,
      label: categoryRuntimeLabel(category),
      group: category.grupo_nombre || excel.convenio.rama,
      description: category.descripcion,
      monthlyByPeriod: {},
      dayByPeriod: {},
      hourlyByPeriod: {},
      nonRem: {}
    };
    excel.escalas.forEach((scale) => {
      const scalePeriods = scalePeriodIds(scale);
      scale.valores
        .filter((value) => value.categoria_id === category.categoria_id)
        .forEach((value) => {
          const amountValue = numericAmount(value.valor);
          if (amountValue === null) return;
          if (value.zona && !row.zone) row.zone = text(value.zona);
          const conceptId = canonConceptId(value.concepto_id);
          const targetPeriods = periodIds(value.periodicidad, value.periodo, value.mes, value.fecha);
          const valuePeriods = targetPeriods.length ? targetPeriods : (scalePeriods.length ? scalePeriods : [fallbackPeriod].filter(Boolean));
          valuePeriods.forEach((scalePeriod) => {
            if (conceptId === "NO_REMUNERATIVO") {
              row.nonRem[scalePeriod] = amountValue;
              return;
            }
            const field = runtimeSalaryField(value);
            if (field === "day") row.dayByPeriod[scalePeriod] = amountValue;
            else if (field === "hourly") row.hourlyByPeriod[scalePeriod] = amountValue;
            else if (!conceptId || conceptId === "SUELDO_BASICO") row.monthlyByPeriod[scalePeriod] = amountValue;
          });
        });
    });
    const latestMonthly = Object.values(row.monthlyByPeriod).at(-1);
    const latestDay = Object.values(row.dayByPeriod).at(-1);
    const latestHourly = Object.values(row.hourlyByPeriod).at(-1);
    if (latestMonthly !== undefined) row.monthly = latestMonthly;
    if (latestDay !== undefined) row.day = latestDay;
    if (latestHourly !== undefined) row.hourly = latestHourly;
    row.salaryType = row.monthly || Object.keys(row.monthlyByPeriod).length
      ? "monthly"
      : row.day || Object.keys(row.dayByPeriod).length
        ? "daily"
        : row.hourly || Object.keys(row.hourlyByPeriod).length
          ? "hourly"
          : "";
    return row;
  });
  const payableCategories = categories.filter((category) => (
    category.monthly || category.day || category.hourly
    || Object.keys(category.monthlyByPeriod).length
    || Object.keys(category.dayByPeriod).length
    || Object.keys(category.hourlyByPeriod).length
  ));
  const runtimeCategories = payableCategories.length ? payableCategories : categories;
  const hasMonthlySalary = runtimeCategories.some((category) => category.monthly || Object.keys(category.monthlyByPeriod).length);
  const hasDailySalary = runtimeCategories.some((category) => category.day || Object.keys(category.dayByPeriod).length);
  const hasHourlySalary = runtimeCategories.some((category) => category.hourly || Object.keys(category.hourlyByPeriod).length);
  const salaryType = hasMonthlySalary
    ? "monthly"
    : hasDailySalary
      ? "daily"
      : hasHourlySalary
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
    categories: runtimeCategories,
    rules,
    liquidationModel: {
      version: "generic-v1",
      rules,
      concepts: excel.conceptos.map((concept) => ({
        id: concept.concepto_id,
        label: concept.nombre,
        group: concept.naturaleza || concept.tipo_concepto,
        rowType: runtimeConceptRowType(concept),
        calculation: runtimeConceptCalculation(concept),
        amount: numericAmount(concept.importe_fijo),
        percent: numericAmount(concept.porcentaje) || 0,
        base: concept.base_calculo || "requiere_revision_manual",
        detail: concept.condicion || concept.formula_base || concept.fuente_documento
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
    if (escala.valores.length && !scalePeriodIds(escala).length) {
      details.push({ path: `escalas.${escala.escala_id}`, message: "Escala con importes pero sin periodo detectable" });
    }
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
  const salaryConceptIds = new Set(["SUELDO_BASICO", "VALOR_HORA", "VALOR_DIA", "VALOR_JORNAL"]);
  const hasSalaryValue = convenio.escalas.some((escala) => escala.valores.some((value) => salaryConceptIds.has(value.concepto_id)));
  if (convenio.escalas.some((escala) => escala.valores.length) && convenio.categorias.length && !hasSalaryValue) {
    details.push({ path: "escalas.valores", message: "No se detectaron valores salariales base (SUELDO_BASICO, VALOR_HORA, VALOR_DIA o VALOR_JORNAL)" });
  }
  convenio.conceptos.forEach((concept) => {
    const reference = isReferenceConcept(concept.concepto_id, concept.nombre);
    ["nombre", "tipo_concepto", "naturaleza"].forEach((field) => {
      if (!text(concept[field]).trim()) details.push({ path: `conceptos.${concept.concepto_id}.${field}`, message: `${field} vacio` });
    });
    if (reference && concept.es_liquidable !== false) details.push({ path: `conceptos.${concept.concepto_id}.es_liquidable`, message: "Concepto de referencia debe ser no liquidable" });
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
