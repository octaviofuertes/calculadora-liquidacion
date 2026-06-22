    const labelKey = summaryKey(item.label || item.name || item.nombre || item.concepto || "");
    const idKey = summaryKey(item.id || item.concepto_id || "");
    const key = summaryKey([
      item.id,
      item.label,
      item.name,
      item.nombre,
      item.concepto_id,
      item.concepto,
      item.detail,
      item.detalle
    ].filter(Boolean).join(" "));
    const has = (...parts) => parts.every((part) => key.includes(part));
    if (isExtraHoursConcept(item)) return true;
    if (has("sueldo", "basico") || has("valor", "hora") || has("valor", "dia")) return true;
    if (labelKey === "no_remunerativo" || idKey === "no_remunerativo" || key.includes("no_remunerativo_de_escala")) return true;
    if (has("zona", "desfavorable")) return true;
    if (key.includes("agravamiento_indemnizatorio")) return true;
    if (key.includes("total_remunerativo") || key.includes("total_no_remunerativo") || key.includes("total_72_horas") || key.includes("total_horas")) return true;
    // Solo filtramos conceptos de despido/indemnizacion (no son haberes corrientes)
    // licencia y vacacion pueden ser haberes del CCT (ej: prima vacacional, adicional por licencia)
    if (key.includes("despido") || key.includes("indemnizacion_por_despido")) return true;
    if (key.includes("multa") || key.includes("incumplimiento") || key.includes("compensacion_por_interrupcion")) return true;
    if (key === "sac" || key.includes("aguinaldo") || has("sueldo", "anual", "complementario")) return true;
    if (has("aporte", "jubilatorio") || key.includes("sipa") || key.includes("pami") || key.includes("ley_19_032")) return true;
    if (has("aporte", "obra", "social") || has("seguridad", "social") || has("riesgos", "trabajo") || key === "art" || has("art", "variable")) return true;
    return false;
  }

  function userFacingConcepts(items = []) {
    return (items || []).filter((item) => !isSystemPayrollConcept(item));
  }

  function userFacingGroupName(group = "") {
    const key = summaryKey(group);
    if (key === "requiere_revision_manual") return "Adicionales sujetos a revision";
    if (key === "remunerativo") return "Remunerativos variables";
    if (key === "no_remunerativo") return "No remunerativos variables";
    return group || "Adicionales";
  }

  function conceptQuantityUnit(concept = {}) {
    const raw = summaryKey([
      concept.id,
      concept.label,
      concept.group,
      concept.detail,
      concept.base,
      concept.calculation,
      concept.unidad_calculo,
      concept.formula_base
    ].filter(Boolean).join(" "));
    if (raw.includes("km") || raw.includes("kilometr")) return "km";
    if (raw.includes("hora")) return "horas";
    if (raw.includes("viaje") || raw.includes("traslado")) return "viajes/dias";
    if (raw.includes("dia") || raw.includes("diari") || raw.includes("viatic") || raw.includes("comida") || raw.includes("pernoct")) return "dias";
    return "cantidad";
  }

  function conceptUsesQuantity(concept = {}) {
    if (concept.calculation === "amountPerUnit") return true;
    const raw = summaryKey([
      concept.id,
      concept.label,
      concept.group,
      concept.detail,
      concept.base,
      concept.calculation,
      concept.unidad_calculo,
      concept.formula_base
    ].filter(Boolean).join(" "));
    return /(cantidad|valor_unitario|por_unidad|por_dia|diario|valor_dia|por_hora|valor_hora|kilometr|_km|viaje|traslado|viatic|pernoct|comida)/.test(raw);
  }

  function conceptUsesNumberInput(concept = {}) {
    return concept.inputType === "number" || conceptUsesQuantity(concept);
  }

  function conceptInputNumber(concept, suffix = "", fallback = 0) {
    const direct = $(`gen_${concept.id}${suffix}`);
    const field = direct || Array.from(document.querySelectorAll("[data-concept-id]"))
      .find((item) => item.dataset.conceptId === String(concept.id) && item.dataset.conceptSuffix === suffix);
    if (!field) return fallback;
    const value = Number(String(field.value).replace(",", "."));
    return Number.isFinite(value) ? value : fallback;
  }

  function normalizedConceptRowType(concept = {}) {
    const raw = summaryKey([concept.rowType, concept.naturaleza, concept.group, concept.label, concept.id].filter(Boolean).join(" "));
    if (raw.includes("no_remunerativo") || raw.includes("non_remunerative") || raw.includes("nonremunerative")) return "nonRemunerative";
    if (raw.includes("deduction") || raw.includes("deduccion") || raw.includes("descuento") || raw.includes("retencion")) return "deduction";
    return concept.rowType || "remunerative";
  }

  function genericConceptInputValue(concept) {
    const inputId = `gen_${concept.id}`;
    return conceptUsesNumberInput(concept)
      ? Math.max(0, conceptInputNumber(concept, "", 0))
      : (checked(inputId, !!concept.defaultValue) ? 1 : 0);
  }

  function genericConceptUnitAmount(concept, period) {
    return conceptPeriodAmount(concept, period, ["unitAmountByPeriod", "valorUnidadPorPeriodo"], concept.unitAmount || concept.amount);
  }

  function applyWorkerDeductions(deductionRows, remTotal, osBase, conv) {
    const c = DATA.constants;
    // Aportes del trabajador se calculan sobre el total remunerativo bruto (sin detracción)
    const baseSS = remTotal;
    addRow(deductionRows, "Jubilacion SIPA 11%", baseSS * c.worker.jubilacion, `11% de ${fmt(baseSS)} (Base SS)`, `${calcNum(baseSS)} x 11 / 100`);
    addRow(deductionRows, "Ley 19.032 (PAMI) 3%", baseSS * c.worker.pami, `3% de ${fmt(baseSS)} (Base SS)`, `${calcNum(baseSS)} x 3 / 100`);
    addRow(deductionRows, "Obra social 3%", osBase * c.worker.obraSocial, `3% de ${fmt(osBase)} (Base OS)`, `${calcNum(osBase)} x 3 / 100`);

    if (conv.id === "uocra") {
      const afiliado = on("uocraAfiliado");
      const period = getPeriod(conv);
      if (afiliado) {
        // Afiliado: cuota sindical 2,5% absorbe el aporte solidario (no se cobra doble)
        addRow(deductionRows, "Cuota sindical UOCRA 2,5%", remTotal * 0.025, `2,5% de ${fmt(remTotal)} (Afiliado)`);
      } else {
        // No afiliado: paga aporte solidario (CCT 76/75)
        if (period === "abr26" || period === "may26") {
          addRow(deductionRows, "Aporte solidario UOCRA 2%", remTotal * 0.02, `2% de ${fmt(remTotal)} (No afiliado)`);
        }
      }
      addRow(deductionRows, "Aporte UOCRA 1,8%", remTotal * 0.018, `1,8% de ${fmt(remTotal)}`);
      addRow(deductionRows, "ISTIC 0,5%", remTotal * 0.005, `0,5% de ${fmt(remTotal)}`);
    }

    if (conv.id === "farmacia") {
      const rules = conv.rules || {};
      if (checked("farmAdefSolidarity", true)) {
        const pct = Number(rules.adefSolidarityPct || 2);
        addRow(deductionRows, `Aporte solidario ADEF ${pct}%`, remTotal * (pct / 100), `${pct}% de ${fmt(remTotal)} (Art. 46)`);
      }
      if (checked("farmUnionContribution", false)) {
        const pct = Number(rules.unionPct || 2);
        addRow(deductionRows, `Cuota sindical ADEF ${pct}%`, remTotal * (pct / 100), `${pct}% de ${fmt(remTotal)} (Afiliado)`);
      }
      if (checked("farmCajaCompensadora", false)) {
        const pct = Number(rules.cajaCompensadoraPct || 1);
        addRow(deductionRows, `Caja compensadora ${pct}%`, remTotal * (pct / 100), `${pct}% de ${fmt(remTotal)}`);
      }
      if (checked("farmProEdificio", false)) {
        const pct = Number(rules.proEdificioPct || 1);
        addRow(deductionRows, `Pro edificio ${pct}%`, remTotal * (pct / 100), `${pct}% de ${fmt(remTotal)}`);
      }
      if (checked("farmContribution", true)) {
        const amount = conv.extraordinaryContribution[getPeriod(conv)] || 0;
        addRow(deductionRows, "Contribucion extraordinaria escala", amount, "Valor informado en escala 2026");
      }
    }

    if (conv.id === "camioneros") {
      if (checked("camUnionFee", true)) {
        addRow(deductionRows, "Cuota sindical Camioneros 2%", remTotal * 0.02, `2% de ${fmt(remTotal)} (Afiliado)`, `${calcNum(remTotal)} x 2 / 100`);
      }
      if (checked("camSolidarityContribution", true)) {
        addRow(deductionRows, "Contribucion solidaria Camioneros 3%", remTotal * 0.03, `3% de ${fmt(remTotal)} (Item 8.1.1)`, `${calcNum(remTotal)} x 3 / 100`);
      }
      if (checked("camFuneralInsurance", true)) {
        addRow(deductionRows, "Seguro de Sepelio 1,5%", remTotal * 0.015, `1,5% de ${fmt(remTotal)} (Item 8.1.6)`, `${calcNum(remTotal)} x 1,5 / 100`);
      }
    }

    addRow(deductionRows, "Ganancias 4ta categoria", calculateGanancias(remTotal), "Estimacion anualizada");
  }

  function applyEmployerContribs(employerRows, remTotal, osBase, conv, baseSalary = remTotal) {
    const c = DATA.constants;
    const baseSS = Math.max(0, remTotal - c.detss);
    const er = c.employerBase;

    addRow(employerRows, "Jubilacion empleador 10,77%", baseSS * er.jubilacion, `10,77% de ${fmt(baseSS)} (Base SS)`);
    addRow(employerRows, "PAMI empleador 1,58%", baseSS * er.pami, `1,58% de ${fmt(baseSS)}`);
    addRow(employerRows, "Obra social empleador 6%", osBase * er.obraSocial, `6% de ${fmt(osBase)} (Base OS)`);
    addRow(employerRows, "Asignaciones familiares 4,70%", baseSS * er.asignaciones, `4,70% de ${fmt(baseSS)}`);
    addRow(employerRows, "Fondo nacional de empleo 0,95%", baseSS * er.fondoEmpleo, `0,95% de ${fmt(baseSS)}`);
    addRow(employerRows, `ART variable ${DATA.constants.artVariablePct}%`, remTotal * (DATA.constants.artVariablePct / 100), `${DATA.constants.artVariablePct}% de ${fmt(remTotal)}`);
    addRow(employerRows, "ART cuota fija", DATA.constants.artFixed);
    addRow(employerRows, "SCVO", DATA.constants.scvo);

    if (conv.id === "uocra") {
      addRow(employerRows, "Contribucion UOCRA 2,30%", remTotal * 0.023, `2,30% de ${fmt(remTotal)}`);
      addRow(employerRows, "ISTIC empleador 0,50%", remTotal * 0.005, `0,50% de ${fmt(remTotal)}`);
      const period = getPeriod(conv);
      if (period === "abr26" || period === "may26") {
        addRow(employerRows, "Contribucion empresarial UOCRA", 6000);
      }
    }

    if (conv.id === "camioneros") {
      addRow(employerRows, "Aporte empresario sindical 2%", baseSalary * 0.02, `2% de ${fmt(baseSalary)} (Item 8.1.2)`);
      addRow(employerRows, "Aporte capacitacion Federacion 0,5%", baseSalary * 0.005, `0,5% de ${fmt(baseSalary)} (Item 8.1.4)`);
      addRow(employerRows, "Aporte profesionalizacion 2%", baseSalary * 0.02, `2% de ${fmt(baseSalary)} (Item 8.1.5)`);
    }
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

  function activeScaleFor(conv) {
    const scale = scaleState.activeForPayroll;
    if (!scale || scale.status !== "APROBADA" || scale.conventionId !== conv.id) return null;
    return scale;
  }

  function firstFinite(...values) {
    for (const value of values) {
      const number = Number(value);
      if (Number.isFinite(number) && number > 0) return number;
    }
    return null;
  }

  function findScaleRow(rows, item, zone) {
    if (!Array.isArray(rows) || !item) return null;
    const itemId = normalizeMatchText(item.id);
    const itemLabel = normalizeMatchText(item.label);
    const zoneId = normalizeZoneMatchText(zone?.id);
    const zoneLabel = normalizeZoneMatchText(zone?.label);
    const candidates = rows.filter((row) => {
      const rowId = normalizeMatchText(row.id);
      const rowLabel = normalizeMatchText(row.label);
      return (itemId && rowId === itemId)
        || (itemLabel && rowLabel === itemLabel)
        || (itemLabel && rowLabel.includes(itemLabel))
        || (itemLabel && itemLabel.includes(rowLabel));
    });
    if (!candidates.length) return null;
    const zoneMatch = candidates.find((row) => {
      const rowZone = normalizeZoneMatchText(row.zone);
      return rowZone && ((zoneId && rowZone.includes(zoneId)) || (zoneLabel && rowZone.includes(zoneLabel)));
    });
    return zoneMatch || candidates.find((row) => !row.zone) || candidates[0];
  }

  function scaleCategoryRow(conv, category, zone) {
    const scale = activeScaleFor(conv);
    if (!scale) return null;
    const parsed = scale.parsedScale || {};
    const categoryRow = findScaleRow(parsed.categories, category, zone);
    const nonRemRow = findScaleRow(parsed.nonRemunerative, category, zone);
    if (!nonRemRow) return categoryRow;
    return {
      ...(categoryRow || {}),
      nonRemRow,
      nonRemunerative: firstFinite(
        categoryRow?.nonRemunerative,
        periodNonRemValue(nonRemRow, getPeriod(conv)),
        nonRemRow.nonRemunerative,
        nonRemRow.noRemunerativo,
        nonRemRow.amount,
        nonRemRow.value,
        nonRemRow.valor,
        nonRemRow.importe,
        nonRemRow.monto,
        nonRemRow.monthly
      ) || 0
    };
  }

  function scaleAdditionalRow(conv, key, additional) {
    const scale = activeScaleFor(conv);
    if (!scale) return null;
    return findScaleRow(scale.parsedScale?.additionals, { id: key, label: additional.label }, null);
  }

  function activeScaleDetail(conv) {
    const scale = activeScaleFor(conv);
    return scale ? `Escala vigente aprobada ${scale.periodLabel || monthLabel(scale.period)}` : "Escala base cargada";
  }

  function isGenericConvention(conv) {
    return conv?.calculationMode === "generic-v1" || conv?.liquidationModel?.version === "generic-v1";
  }

  function periodNonRemValue(source, period) {
    if (!source) return 0;
    const nested = source.nonRemRow ? periodNonRemValue(source.nonRemRow, period) : 0;
    if (nested) return nested;
    const periodKeys = [
      "nonRem",
      "nonRemunerativeByPeriod",
      "noRemunerativoPorPeriodo",
      "no_remunerativo_por_periodo",
      "sumaNoRemunerativaPorPeriodo"
    ];
    for (const key of periodKeys) {
      if (source[key] && typeof source[key] === "object") {
        const value = firstFinite(source[key][period], source[key][String(period || "").toUpperCase()], source[key][String(period || "").toLowerCase()]);
        if (value) return value;
      }
    }
    return firstFinite(
      source.nonRemunerative,
      source.noRemunerativo,
      source.no_remunerativo,
      source.sumaNoRemunerativa,
      source.suma_no_remunerativa,
      source.nonRemunerativeAmount,
      source.noRemAmount
    ) || 0;
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

  function genericBaseAmount({ concept, basic, remTotal, categoryMonthly, categoryDay, categoryHourly, seniorityBase, noRemScale }) {
    const rawBase = summaryKey(String(concept.base || "basic"));
    // nonRemunerative scaleValue always uses noRemScale
    if (concept.rowType === "nonRemunerative" && concept.calculation === "scaleValue") return noRemScale;
    // Base remunerativa total
    if (["remunerative", "total_remunerativo", "haberes_remunerativos", "remuneracion_sujeta_a_aporte", "total_haberes", "bruto", "gross"].includes(rawBase)) return remTotal;
    // No remunerativo
    if (["nonremunerativescale", "noremscale", "no_remunerativo"].includes(rawBase)) return noRemScale;
    // Escala salarial (basico de categoria)
    if (["escala_salarial", "sueldo_basico", "basico_de_categoria", "categorymonthly", "basic", "basico", "monto_fijo"].includes(rawBase)) return categoryMonthly || basic;
    if (rawBase === "categoryday" || rawBase === "valor_dia" || rawBase === "jornal") return categoryDay;
    if (rawBase === "categoryhourly" || rawBase === "valor_hora") return categoryHourly;
    if (rawBase === "senioritybase" || rawBase === "basico_con_antiguedad") return seniorityBase;
    return basic;
  }

  function genericSalaryTypeForCategory(conv, category) {
    if (category?.salaryType) return category.salaryType;
    if (category?.monthly || Object.keys(category?.monthlyByPeriod || {}).length) return "monthly";
    if (category?.day || Object.keys(category?.dayByPeriod || {}).length) return "daily";
    if (category?.hourly || Object.keys(category?.hourlyByPeriod || {}).length) return "hourly";
    return conv?.rules?.salaryType || conv?.type || "monthly";
  }

  function conceptPeriodAmount(concept, period, keys, fallback) {
    for (const key of keys) {
      const map = concept[key];
      if (map && typeof map === "object" && !Array.isArray(map) && Object.prototype.hasOwnProperty.call(map, period)) {
        const value = Number(map[period]);
        if (Number.isFinite(value)) return value;
      }
    }
    return Number(fallback || 0) || 0;
  }

  function calcGenericConceptAmount(concept, inputValue, baseValue, period, activeCatRow, cat) {
    const scaleKey = `concept_${concept.id}`;
    const scaleAmount = firstFinite(
      periodAmountValue(activeCatRow, period, [scaleKey]),
      periodAmountValue(cat, period, [scaleKey]),
      activeCatRow?.[scaleKey],
      cat?.[scaleKey]
    );

    if (Number.isFinite(scaleAmount)) {
      if (conceptUsesQuantity(concept) || concept.calculation === "amountPerUnit") {
        return scaleAmount * inputValue;
      }
      return scaleAmount * inputValue;
    }

    if (conceptUsesQuantity(concept)) {
      const unitAmount = genericConceptUnitAmount(concept, period) || Math.max(0, conceptInputNumber(concept, "_unit", 0));
      return unitAmount * inputValue;
    }
    if (concept.calculation === "scaleValue") {
      return baseValue * inputValue;
    }
    if (concept.calculation === "fixed") {
      return conceptPeriodAmount(concept, period, ["amountByPeriod", "amountPorPeriodo"], concept.amount) * inputValue;
    }
    if (concept.calculation === "amountPerUnit") {
      return conceptPeriodAmount(concept, period, ["unitAmountByPeriod", "valorUnidadPorPeriodo"], concept.unitAmount || concept.amount) * inputValue;
    }
    return baseValue * ((Number(concept.percent || 0) || 0) / 100) * inputValue;
  }

  function applyGenericDeductions(deductionRows, employerRows, remTotal, noRemTotal, basic, period, conv) {
    const model = conv.liquidationModel || {};
    const applyItems = (items, targetRows, fallbackDetail, userSelectable = false, inputPrefix = "gen_deduction") => {
      (items || []).forEach((item) => {
        if (userSelectable && !checked(`${inputPrefix}_${item.id}`, item.defaultValue !== false)) return;
        const baseName = String(item.base || "remunerative")
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]+/g, " ")
          .trim();
        const base = ["gross", "bruto", "total haberes"].includes(baseName)
          ? remTotal + noRemTotal
          : ["nonremunerative", "non remunerative", "no remunerativo"].includes(baseName)
            ? noRemTotal
            : ["basic", "basico"].includes(baseName) ? basic : remTotal;
        const fixedAmount = conceptPeriodAmount(item, period, ["amountByPeriod", "amountPorPeriodo"], item.amount);
        const percent = Number(item.percent || 0) || 0;
        const amountValue = fixedAmount || base * (percent / 100);
        const formula = fixedAmount
          ? `${calcNum(fixedAmount)}`
          : `${calcNum(base)} x ${percent} / 100`;
        addRow(targetRows, item.label, amountValue, item.detail || fallbackDetail, formula);
      });
    };
    applyItems(userFacingConcepts(model.deductions), deductionRows, "Aporte propio del convenio", true);
    applyItems(userFacingConcepts(model.retentions), deductionRows, "Retencion propia del convenio", true, "gen_retention");
    applyItems(userFacingConcepts(model.employerContributions), employerRows, "Contribucion propia del convenio");
  }

  function calcGenericConvention(conv) {
    const period = getPeriod(conv);
    const cat = getCategory(conv);
    const zone = getZone(conv);
    const activeCatRow = scaleCategoryRow(conv, cat, zone);
    const model = conv.liquidationModel || {};
    const rules = { ...(conv.rules || {}), ...(model.rules || {}) };
    const activeScaleRules = activeScaleFor(conv)?.parsedScale?.nonRemunerativeRules
