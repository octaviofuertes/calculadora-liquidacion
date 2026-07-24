(function () {
  function variants(id) {
    const raw = String(id || "").trim();
    if (!raw) return [];
    return [...new Set([
      raw,
      raw.replace(/_/g, "-"),
      raw.replace(/-/g, "_"),
      raw.toLowerCase(),
      raw.toUpperCase()
    ])];
  }

  function resolveConvention(conventions, id) {
    if (!conventions) return null;
    if (conventions[id]) return conventions[id];
    for (const key of variants(id)) {
      if (conventions[key]) return conventions[key];
    }
    return null;
  }

  function backendCatsHaveValues(conv = {}) {
    return (conv.categories || []).some((cat) => {
      return Boolean(
        cat.monthly ||
        cat.day ||
        cat.hourly ||
        Object.keys(cat.monthlyByPeriod || {}).length ||
        Object.keys(cat.dayByPeriod || {}).length ||
        Object.keys(cat.hourlyByPeriod || {}).length
      );
    });
  }

  function mergeConvention(local, backend) {
    if (!local) return backend;
    const backendCatsEmpty = !backendCatsHaveValues(backend);
    const useLocalCats = local.scales || (backendCatsEmpty && local.categories);
    return {
      ...backend,
      scales: local.scales ?? backend.scales,
      nonRem: local.nonRem ?? backend.nonRem,
      additionals: local.additionals ?? backend.additionals,
      rules: local.rules ?? backend.rules,
      deductions: local.deductions ?? backend.deductions,
      categories: useLocalCats ? local.categories : backend.categories,
      zones: local.scales ? (local.zones ?? backend.zones) : backend.zones,
      periods: local.scales ? (local.periods ?? backend.periods) : backend.periods
    };
  }

  function mergeCatalogData(localData, apiData) {
    if (!apiData || !apiData.conventions) return localData;
    const merged = { ...apiData, conventions: { ...apiData.conventions } };
    const localConventions = localData?.conventions || {};

    Object.keys(merged.conventions).forEach((id) => {
      const backendConv = merged.conventions[id];
      const localConv = resolveConvention(localConventions, id);
      if (localConv) {
        merged.conventions[id] = mergeConvention(localConv, backendConv);
      }
    });

    return merged;
  }

  function resolveConventionKind(convention) {
    const explicit = convention?.metadata?.calculatorKey
      || convention?.metadata?.calculatorStrategy
      || convention?.metadata?.scaleRenderer
      || convention?.metadata?.scaleTemplate
      || convention?.summaryRenderer
      || convention?.metadata?.guideRenderer
      || convention?.metadata?.guideTemplate;
    if (explicit) return String(explicit);
    return String(convention?.id || "").toLowerCase();
  }

  window.eSueldosCatalogSync = {
    mergeCatalogData,
    resolveConvention,
    resolveConventionKind,
    variants
  };
})();
