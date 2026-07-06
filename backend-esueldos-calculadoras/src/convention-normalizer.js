/**
 * Post-LLM validation and normalization for structured collective agreements.
 * Corrects category hierarchy mistakes (zone/branch embedded in names, duplicate categories, fake headers).
 */

const DEFAULT_CONFIG = {
  zoneTokens: [
    "zona norte", "zona sur", "zona este", "zona oeste",
    "zona a", "zona b", "zona c", "zona d", "zona e",
    "capital", "interior", "patagonia", "amba"
  ],
  branchTokens: [
    "administrativa", "administracion", "administrativo",
    "tecnica", "tecnico", "produccion", "comercial", "ventas",
    "mantenimiento", "logistica", "deposito", "obreros", "empleados"
  ],
  fakeCategoryBlacklist: [
    "escala salarial", "personal", "remuneraciones", "basicos", "valores", "vigencia",
    "escala", "salarial", "categorias", "categoria", "cargo", "cargos"
  ],
  emptyLabels: ["", "-", "...", "categoria", "cargo"],
  orphanLetterPattern: /^[a-d]$/i,
  maxLabelWords: 6,
  headerPrefixes: [
    { prefix: "rama ", field: "rama" },
    { prefix: "zona ", field: "zona" },
    { prefix: "agrupamiento ", field: "grupo_nombre" },
    { prefix: "grupo ", field: "grupo_nombre" },
    { prefix: "clase ", field: "clase_letra" }
  ]
};

function text(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeAscii(value) {
  return text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function cloneConvention(convention = {}) {
  return structuredClone(convention);
}

function getCategories(convention) {
  return Array.isArray(convention.categorias) ? convention.categorias : [];
}

function setCategories(convention, categorias) {
  convention.categorias = categorias;
}

function getScales(convention) {
  return Array.isArray(convention.escalas) ? convention.escalas : [];
}

function getLabel(category = {}) {
  return text(category.categoria_nombre || category.label || category.nombre || category.descripcion);
}

function setLabel(category, label) {
  if ("categoria_nombre" in category || !category.label) category.categoria_nombre = label;
  else category.label = label;
}

function getGroup(category = {}) {
  return text(category.grupo_nombre || category.group || category.agrupamiento);
}

function setGroup(category, group) {
  category.grupo_nombre = group;
  if ("group" in category) category.group = group;
  if ("agrupamiento" in category) category.agrupamiento = group;
}

function getBranch(category = {}) {
  return text(category.rama || category.branch);
}

function setBranch(category, branch) {
  category.rama = branch;
  if ("branch" in category) category.branch = branch;
}

function getZone(category = {}) {
  return text(category.zona || category.zone);
}

function setZone(category, zone) {
  category.zona = zone;
  if ("zone" in category) category.zone = zone;
}

function getClass(category = {}) {
  return text(category.clase_letra || category.class);
}

function setClass(category, classValue) {
  category.clase_letra = classValue;
  if ("class" in category) category.class = classValue;
}

function getCategoryId(category = {}) {
  return text(category.categoria_id || category.id);
}

function categoryIdentityKey(category = {}) {
  return [
    normalizeAscii(getLabel(category)),
    normalizeAscii(getGroup(category)),
    normalizeAscii(getBranch(category)),
    normalizeAscii(getClass(category)),
    normalizeAscii(getZone(category))
  ].join("|");
}

function categoryCoreKey(category = {}, ignore = {}) {
  return [
    normalizeAscii(getLabel(category)),
    ignore.group ? "" : normalizeAscii(getGroup(category)),
    ignore.branch ? "" : normalizeAscii(getBranch(category)),
    ignore.class ? "" : normalizeAscii(getClass(category)),
    ignore.zone ? "" : normalizeAscii(getZone(category))
  ].join("|");
}

function remapCategoryId(convention, fromId, toId) {
  if (!fromId || fromId === toId) return;
  getScales(convention).forEach((scale) => {
    (scale.valores || []).forEach((value) => {
      if (text(value.categoria_id) === fromId) value.categoria_id = toId;
    });
  });
}

function mergeCategoryRecords(primary, secondary) {
  const merged = { ...primary };
  ["mensual", "monthly", "dia", "day", "hora", "hourly", "sueldo_basico"].forEach((field) => {
    if ((merged[field] === null || merged[field] === undefined || merged[field] === "") && secondary[field] != null && secondary[field] !== "") {
      merged[field] = secondary[field];
    }
  });
  ["monthlyByPeriod", "dayByPeriod", "hourlyByPeriod", "nonRem"].forEach((field) => {
    merged[field] = { ...(merged[field] || {}), ...(secondary[field] || {}) };
  });
  if (!getZone(merged) && getZone(secondary)) setZone(merged, getZone(secondary));
  if (!getBranch(merged) && getBranch(secondary)) setBranch(merged, getBranch(secondary));
  if (!getGroup(merged) && getGroup(secondary)) setGroup(merged, getGroup(secondary));
  if (!getClass(merged) && getClass(secondary)) setClass(merged, getClass(secondary));
  return merged;
}

function hasBasicSalary(category = {}) {
  const direct = [category.mensual, category.monthly, category.sueldo_basico, category.dia, category.day, category.hora, category.hourly];
  if (direct.some((value) => Number(value) > 0)) return true;
  const periodMaps = [category.monthlyByPeriod, category.dayByPeriod, category.hourlyByPeriod];
  return periodMaps.some((map) => map && Object.values(map).some((value) => Number(value) > 0));
}

function categoryHasScaleValue(convention, categoryId) {
  if (!categoryId) return false;
  return getScales(convention).some((scale) =>
    (scale.valores || []).some((value) => text(value.categoria_id) === categoryId && Number(value.valor) >= 0)
  );
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildTokenRegex(tokens = []) {
  const parts = tokens
    .slice()
    .sort((a, b) => b.length - a.length)
    .map((token) => escapeRegex(normalizeAscii(token)).replace(/\s+/g, "\\s+"));
  return new RegExp(`(?:\\b(?:${parts.join("|")})\\b)$`, "i");
}

function stripSuffixToken(label, regex) {
  const match = text(label).match(regex);
  if (!match) return { label: text(label), extracted: "" };
  const extracted = text(match[0]);
  const cleaned = text(label.slice(0, match.index)).replace(/[-–—]\s*$/g, "").trim();
  return { label: cleaned || text(label), extracted };
}

function capitalizeToken(value) {
  return text(value)
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function isFakeCategoryLabel(label, config) {
  const normalized = normalizeAscii(label);
  return config.fakeCategoryBlacklist.some((item) => normalized === item || normalized.startsWith(`${item} `));
}

function isEmptyCategoryLabel(label, config) {
  return config.emptyLabels.includes(normalizeAscii(label));
}

function isPropagableHeader(label) {
  const raw = text(label);
  if (!raw) return false;
  const normalized = normalizeAscii(raw);
  if (DEFAULT_CONFIG.headerPrefixes.some(({ prefix }) => normalized.startsWith(prefix))) return true;
  return raw === raw.toUpperCase() && raw.length >= 4 && raw.length <= 40 && !/\d/.test(raw);
}

function parseHeaderField(label, config) {
  const normalized = normalizeAscii(label);
  for (const entry of config.headerPrefixes) {
    if (normalized.startsWith(entry.prefix)) {
      return {
        field: entry.field,
        value: capitalizeToken(label.slice(entry.prefix.length))
      };
    }
  }
  if (label === label.toUpperCase()) {
    return { field: "grupo_nombre", value: capitalizeToken(label) };
  }
  return null;
}

/** Regla 1: extraer zona del nombre de categoría. */
function normalizeZones(categories, fixes, config) {
  const regex = buildTokenRegex(config.zoneTokens);
  return categories.map((category) => {
    const currentZone = getZone(category);
    const { label, extracted } = stripSuffixToken(getLabel(category), regex);
    if (!extracted || (currentZone && normalizeAscii(currentZone) === normalizeAscii(extracted))) {
      if (extracted && !currentZone) setZone(category, capitalizeToken(extracted.replace(/^zona\s+/i, "")));
      return category;
    }
    const original = getLabel(category);
    setLabel(category, label);
    setZone(category, capitalizeToken(extracted.replace(/^zona\s+/i, "")));
    fixes.push({
      type: "zone_extracted",
      original,
      result: label,
      zone: getZone(category)
    });
    return category;
  });
}

/** Regla 2 y 10: extraer rama del nombre de categoría. */
function normalizeBranches(categories, fixes, config) {
  const regex = buildTokenRegex(config.branchTokens);
  return categories.map((category) => {
    const currentBranch = getBranch(category);
    const { label, extracted } = stripSuffixToken(getLabel(category), regex);
    if (!extracted) return category;
    if (currentBranch && normalizeAscii(currentBranch) !== normalizeAscii(extracted)) return category;
    setLabel(category, label);
    setBranch(category, capitalizeToken(extracted));
    fixes.push({
      type: "branch_extracted",
      original: `${label} ${extracted}`.trim(),
      result: label,
      branch: getBranch(category)
    });
    return category;
  });
}

/** Regla 4: eliminar encabezados interpretados como categorías. */
function removeFakeCategories(categories, fixes, warnings, config) {
  return categories.filter((category) => {
    const label = getLabel(category);
    if (!isFakeCategoryLabel(label, config)) return true;
    fixes.push({ type: "fake_category_removed", original: label, result: null });
    return false;
  });
}

/** Regla 5: eliminar categorías vacías o placeholder. */
function removeEmptyCategories(categories, fixes) {
  return categories.filter((category) => {
    const label = getLabel(category);
    if (label && !DEFAULT_CONFIG.emptyLabels.includes(normalizeAscii(label))) return true;
    fixes.push({ type: "empty_category_removed", original: label || "(vacío)", result: null });
    return false;
  });
}

/** Regla 11: completar letras huérfanas con el encabezado anterior. */
function resolveOrphanLetters(categories, fixes, config) {
  const output = [];
  let pendingGroup = "";
  categories.forEach((category, index) => {
    const label = getLabel(category);
    const nextLabel = index + 1 < categories.length ? getLabel(categories[index + 1]) : "";
    const nextIsOrphan = config.orphanLetterPattern.test(nextLabel);
    if (nextIsOrphan && !config.orphanLetterPattern.test(label)) {
      pendingGroup = capitalizeToken(label);
      fixes.push({
        type: "group_header_detected",
        original: label,
        result: null,
        group: pendingGroup
      });
      return;
    }
    if (config.orphanLetterPattern.test(label) && pendingGroup) {
      setGroup(category, pendingGroup);
      fixes.push({
        type: "orphan_letter_resolved",
        original: label,
        result: label,
        group: pendingGroup
      });
    }
    output.push(category);
  });
  return output;
}

/** Regla 12: propagar encabezados de tabla como contexto de rama/zona/grupo/clase. */
function propagateHeaders(categories, fixes, config) {
  const context = { rama: "", zona: "", grupo_nombre: "", clase_letra: "" };
  const output = [];
  categories.forEach((category) => {
    const label = getLabel(category);
    const header = parseHeaderField(label, config);
    if (header && isPropagableHeader(label)) {
      context[header.field] = header.value;
      fixes.push({
        type: "header_propagated",
        original: label,
        result: null,
        field: header.field,
        value: header.value
      });
      return;
    }
    if (isFakeCategoryLabel(label, config)) return;
    const next = { ...category };
    if (!getBranch(next) && context.rama) setBranch(next, context.rama);
    if (!getZone(next) && context.zona) setZone(next, context.zona);
    if (!getGroup(next) && context.grupo_nombre) setGroup(next, context.grupo_nombre);
    if (!getClass(next) && context.clase_letra) setClass(next, context.clase_letra);
    output.push(next);
  });
  return output;
}

/** Regla 6: detectar labels demasiado largos e intentar separar categoría/rama/zona. */
function normalizeLongLabels(categories, fixes, warnings, config) {
  const zoneRegex = buildTokenRegex(config.zoneTokens);
  const branchRegex = buildTokenRegex(config.branchTokens);
  return categories.map((category) => {
    const originalLabel = getLabel(category);
    const words = originalLabel.split(/\s+/).filter(Boolean);
    if (words.length <= config.maxLabelWords) return category;
    let label = originalLabel;
    let changed = false;
    const zoneMatch = stripSuffixToken(label, zoneRegex);
    if (zoneMatch.extracted && !getZone(category)) {
      setZone(category, capitalizeToken(zoneMatch.extracted.replace(/^zona\s+/i, "")));
      label = zoneMatch.label;
      changed = true;
    }
    const branchMatch = stripSuffixToken(label, branchRegex);
    if (branchMatch.extracted && !getBranch(category)) {
      setBranch(category, capitalizeToken(branchMatch.extracted));
      label = branchMatch.label;
      changed = true;
    }
    if (changed) {
      setLabel(category, label);
      fixes.push({
        type: "long_label_split",
        original: originalLabel,
        result: label,
        branch: getBranch(category),
        zone: getZone(category)
      });
      return category;
    }
    warnings.push({
      type: "long_label_unresolved",
      message: `Label demasiado largo sin poder separar automáticamente: "${originalLabel}".`
    });
    return category;
  });
}

/** Regla 9: fusionar categorías que solo difieren por zona en el nombre o campo. */
function mergeCategoriesByZoneOnly(convention, categories, fixes, warnings) {
  const groups = new Map();
  categories.forEach((category) => {
    const key = categoryCoreKey(category, { zone: true });
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(category);
  });
  const merged = [];
  groups.forEach((items) => {
    if (items.length === 1) {
      merged.push(items[0]);
      return;
    }
    warnings.push({
      type: "duplicate_category_by_zone",
      message: `Se encontraron categorías repetidas únicamente por zona: ${items.map(getLabel).join(", ")}.`
    });
    const primary = { ...items[0] };
    setZone(primary, "");
    items.slice(1).forEach((item) => {
      remapCategoryId(convention, getCategoryId(item), getCategoryId(primary));
      Object.assign(primary, mergeCategoryRecords(primary, item));
      setZone(primary, "");
    });
    fixes.push({
      type: "zone_only_categories_merged",
      original: items.map(getLabel).join(" | "),
      result: getLabel(primary)
    });
    merged.push(primary);
  });
  return merged;
}

/** Regla 10 (refuerzo): fusionar categorías que solo difieren por rama. */
function mergeCategoriesByBranchOnly(convention, categories, fixes, warnings) {
  const groups = new Map();
  categories.forEach((category) => {
    const key = categoryCoreKey(category, { branch: true });
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(category);
  });
  const merged = [];
  groups.forEach((items) => {
    if (items.length === 1) {
      merged.push(items[0]);
      return;
    }
    warnings.push({
      type: "duplicate_category_by_branch",
      message: `Se encontraron categorías repetidas únicamente por rama: ${items.map(getLabel).join(", ")}.`
    });
    const primary = { ...items[0] };
    setBranch(primary, "");
    items.slice(1).forEach((item) => {
      remapCategoryId(convention, getCategoryId(item), getCategoryId(primary));
      Object.assign(primary, mergeCategoryRecords(primary, item));
      setBranch(primary, "");
    });
    fixes.push({
      type: "branch_only_categories_merged",
      original: items.map(getLabel).join(" | "),
      result: getLabel(primary)
    });
    merged.push(primary);
  });
  return merged;
}

/** Reglas 3 y 13: fusionar duplicados exactos por identidad completa. */
function mergeDuplicates(convention, categories, fixes, warnings) {
  const groups = new Map();
  categories.forEach((category) => {
    const key = categoryIdentityKey(category);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(category);
  });
  const merged = [];
  groups.forEach((items) => {
    if (items.length === 1) {
      merged.push(items[0]);
      return;
    }
    warnings.push({
      type: "duplicate_category",
      message: "Se encontraron categorías duplicadas."
    });
    const primary = { ...items[0] };
    items.slice(1).forEach((item) => {
      remapCategoryId(convention, getCategoryId(item), getCategoryId(primary));
      Object.assign(primary, mergeCategoryRecords(primary, item));
    });
    fixes.push({
      type: "duplicate_categories_merged",
      original: items.map((item) => getLabel(item)).join(" | "),
      result: getLabel(primary)
    });
    merged.push(primary);
  });
  return merged;
}

/** Regla 7: validar que todo salario pertenezca a una categoría. */
function validateSalaries(convention, warnings) {
  getScales(convention).forEach((scale, scaleIndex) => {
    (scale.valores || []).forEach((value, valueIndex) => {
      const categoryId = text(value.categoria_id);
      const categoryName = text(value.categoria_nombre);
      if (categoryId || categoryName) return;
      if (value.valor === null || value.valor === undefined || value.valor === "") return;
      warnings.push({
        type: "salary_without_category",
        message: `Salario sin categoría asociada en escala ${scale.escala_id || scaleIndex + 1}, valor ${valueIndex + 1}.`
      });
    });
  });
}

/** Regla 8: advertir categorías sin básico detectado. */
function validateCategories(convention, categories, warnings) {
  categories.forEach((category) => {
    const categoryId = getCategoryId(category);
    const hasSalary = hasBasicSalary(category) || categoryHasScaleValue(convention, categoryId);
    if (hasSalary) return;
    warnings.push({
      type: "category_without_basic",
      message: "Categoría sin básico detectado.",
      category: getLabel(category),
      categoryId
    });
  });
}

class ConventionNormalizer {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Normaliza el JSON estructurado del convenio y devuelve correcciones trazables.
   * @param {object} convention JSON completo generado por el estructurador
   * @returns {{ convention: object, warnings: object[], fixes: object[] }}
   */
  normalize(convention = {}) {
    const output = cloneConvention(convention);
    const fixes = [];
    const warnings = [];
    const config = this.config;

    let categories = getCategories(output);
    categories = removeEmptyCategories(categories, fixes);
    categories = resolveOrphanLetters(categories, fixes, config);
    categories = propagateHeaders(categories, fixes, config);
    categories = removeFakeCategories(categories, fixes, warnings, config);
    categories = normalizeZones(categories, fixes, config);
    categories = normalizeBranches(categories, fixes, config);
    categories = normalizeLongLabels(categories, fixes, warnings, config);
    categories = mergeCategoriesByZoneOnly(output, categories, fixes, warnings);
    categories = mergeCategoriesByBranchOnly(output, categories, fixes, warnings);
    categories = mergeDuplicates(output, categories, fixes, warnings);
    setCategories(output, categories);

    validateSalaries(output, warnings);
    validateCategories(output, categories, warnings);

    return { convention: output, warnings, fixes };
  }
}

function normalizeConventionStructure(convention, config) {
  return new ConventionNormalizer(config).normalize(convention);
}

module.exports = {
  ConventionNormalizer,
  normalizeConventionStructure,
  DEFAULT_CONFIG,
  normalizeZones,
  normalizeBranches,
  removeFakeCategories,
  removeEmptyCategories,
  resolveOrphanLetters,
  propagateHeaders,
  normalizeLongLabels,
  mergeCategoriesByZoneOnly,
  mergeCategoriesByBranchOnly,
  mergeDuplicates,
  validateSalaries,
  validateCategories
};
