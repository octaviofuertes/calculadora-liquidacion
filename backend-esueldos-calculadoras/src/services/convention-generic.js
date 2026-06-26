function asciiFold(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x00-\x7F]/g, "");
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isLikelySalaryCategoryLabel(label, group) {
  const text = asciiFold([label, group].filter(Boolean).join(" "));
  return /(categoria|nivel|operario|administrativo|ayudante|maestranza|oficial|cajero|encargado|peon|vendedor|personal|empleado)/i.test(text);
}

function isLikelyAdditionalLabel(label) {
  return /(antiguedad|presentismo|titulo|zona|viatico|bono|plus|adicional|premio|horas? extras?|no remunerativo|suma fija)/i.test(asciiFold(label));
}

function isLikelyAdditionalGroup(group) {
  return /(adicional|concepto|bono|plus|premio|viatico|reintegro)/i.test(asciiFold(group));
}

function scaleAdditionalConcept({ label, values, period, group }) {
  const amount = values.find((value) => Number(value)) || 0;
  return {
    id: normalizeText(label),
    label,
    group: group || "Adicionales",
    inputType: "number",
    rowType: /no remunerativo/i.test(asciiFold(label)) ? "nonRemunerative" : "remunerative",
    calculation: "fixed",
    amount: amount || null,
    amountByPeriod: amount ? { [period]: amount } : {},
    defaultValue: 0,
    requiresHumanValidation: false,
    detail: "Recuperado desde la escala",
    notes: []
  };
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
  const concepts = [...(convention.liquidationModel?.concepts || [])];
  promotedConcepts.forEach((concept) => {
    if (!concepts.some((item) => item.id === concept.id)) concepts.push(concept);
  });
  return {
    ...convention,
    categories,
    warnings: originalCategories.length === categories.length ? convention.warnings : Array.from(new Set([
      ...(convention.warnings || []),
      "Se reclasificaron filas fragmentadas de tablas complementarias para evitar tratarlas como categorias salariales."
    ])),
    liquidationModel: { ...(convention.liquidationModel || {}), concepts }
  };
}

module.exports = { sanitizeGenericConventionCategories };
