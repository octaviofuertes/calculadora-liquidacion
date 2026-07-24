function createFarmaciaStrategy(helpers) {
  const {
    emptyRows,
    scaleCategoryRow,
    scaleAdditionalRow,
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
    periodAmountValue
  } = helpers;

  function farmaciaAntiquityPct(years, brackets) {
    if (Array.isArray(brackets) && brackets.length > 0) {
      for (let i = brackets.length - 1; i >= 0; i--) {
        if (years >= brackets[i].fromYears) return Number(brackets[i].percent) || 0;
      }
      return 0;
    }
    if (years >= 20) return 35;
    if (years >= 15) return 30;
    if (years >= 10) return 25;
    if (years >= 5) return 20;
    if (years >= 2) return 10;
    if (years >= 1) return 5;
    return 0;
  }

  return function calcFarmacia(ctx) {
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
    const parsedNoRemDays = noRemInput ? Number(noRemInput.replace(",", ".")) : Math.max(0, workingDays - absentDaysUnjust);
    const noRemDays = Math.max(0, Math.min(workingDays, Number.isFinite(parsedNoRemDays) ? parsedNoRemDays : workingDays));
    const noRemProportion = proportion * (inputBool(ctx.inputs, "farmProrateNonRem", true) ? noRemDays / workingDays : 1);
    const dayDivisor = Number(rules.dayDivisor || 30);
    const vacationDivisor = Number(rules.vacationDivisor || 25);
    const hourDivisor = Number(rules.hourDivisor || 200);

    const catMonthly = firstFinite(activeRow?.monthly, ctx.category.monthly) || 0;
    const base = catMonthly * proportion;
    const findCat = (id) => (ctx.convention.categories || []).find((c) => c.id === id) || null;
    const initialA = findCat("inicialA");
    const empleadoFarm = findCat("empleadoFarmacia");
    const initialARow = initialA ? scaleCategoryRow(ctx.activeScale, initialA, ctx.zone, ctx.modality) : null;
    const empleadoFarmRow = empleadoFarm ? scaleCategoryRow(ctx.activeScale, empleadoFarm, ctx.zone, ctx.modality) : null;
    const initialAMonthly = (firstFinite(initialARow?.monthly, initialA?.monthly) || 0) * proportion;
    const empleadoFarmMonthly = (firstFinite(empleadoFarmRow?.monthly, empleadoFarm?.monthly) || 0) * proportion;

    addRow(rows.remRows, "Basico", base, `${paidWeeklyHours}/${fullWeeklyHours} hs; ${monthPct}% del mes`);

    let seniorityBase = base;
    const includeFixedInSeniority = inputBool(ctx.inputs, "farmSeniorityOnFixedAdditions", true);
    const addRem = (label, val, detail) => {
      addRow(rows.remRows, label, val, detail);
      if (includeFixedInSeniority) seniorityBase += val;
    };

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

    if (inputBool(ctx.inputs, "farmCajero", false)) addRem("Adicional cajero", base * ((rules.cajeroPct || 10) / 100), `${rules.cajeroPct || 10}%`);
    if (inputBool(ctx.inputs, "farmAdminTitle", false)) addRem("Adicional tareas administrativas", base * ((rules.tareasAdministrativasPct || 5) / 100), `${rules.tareasAdministrativasPct || 5}%`);
    if (inputBool(ctx.inputs, "farmAdminTenure", false)) {
      const pct = years >= 2 ? (rules.adminTenurePctOver2Years || 10) : (rules.adminTenurePctInitial || 5);
      addRem("Adicional administrativo por antiguedad", base * (pct / 100), `${pct}%`);
    }
    if (inputBool(ctx.inputs, "farmPerfumeria", false)) addRem("Adicional perfumeria", base * ((rules.perfumeriaPct || 10) / 100), `${rules.perfumeriaPct || 10}%`);
    if (inputBool(ctx.inputs, "farmBike", false)) addRem("Adicional bici/ciclomotor/moto", base * ((rules.bikePct || 10) / 100), `${rules.bikePct || 10}%`);

    const farmLanguages = inputValue(ctx.inputs, "farmLanguages", 0);
    if (farmLanguages > 0) addRem("Adicional idioma", initialAMonthly * ((rules.languagePct || 10) / 100) * farmLanguages, `${rules.languagePct || 10}% x ${farmLanguages} idioma(s)`);
    if (inputBool(ctx.inputs, "farmAuxTitle", false)) addRem("Titulo auxiliar de farmacia", empleadoFarmMonthly * ((rules.auxTitlePct || 20) / 100), `${rules.auxTitlePct || 20}%`);

    const pctAnt = farmaciaAntiquityPct(years, rules.seniority?.brackets);
    const seniorityAmount = inputBool(ctx.inputs, "farmSeniority", true) ? seniorityBase * (pctAnt / 100) : 0;
    addRow(rows.remRows, "Escalafon por antiguedad", seniorityAmount, `${pctAnt}% de base`);
    const basePlus = base + seniorityAmount;

    const regularRem = sumRows(rows.remRows);
    const standardDayValue = regularRem / dayDivisor;
    const vacationDayValue = regularRem / vacationDivisor;
    const hourValue = regularRem / hourDivisor;
    const nightPct = Number(rules.nightPct || 100);
    addRow(rows.remRows, "Horas extra 50%", hourValue * inputValue(ctx.inputs, "farmExtra50", 0) * 1.5, "x1,5");
    addRow(rows.remRows, "Horas extra 100%", hourValue * inputValue(ctx.inputs, "farmExtra100", 0) * 2, "x2");
    addRow(rows.remRows, "Adicional nocturno voluntario", hourValue * inputValue(ctx.inputs, "farmNightHours", 0) * (nightPct / 100), `${nightPct}%`);

    const holidayNotWorkedPlus = Math.max(0, vacationDayValue - standardDayValue);
    addRow(rows.remRows, "Feriado trabajado", vacationDayValue * inputValue(ctx.inputs, "farmHolidayWorkedDays", 0), `÷${vacationDivisor}`);
    addRow(rows.remRows, "Feriado no trabajado", holidayNotWorkedPlus * inputValue(ctx.inputs, "farmHolidayNotWorkedDays", 0), `÷${vacationDivisor} - ÷${dayDivisor}`);
    addRow(rows.remRows, "Dia empleado farmacia trab.", vacationDayValue * inputValue(ctx.inputs, "farmPharmacyDayWorked", 0), `${rules.pharmacyEmployeeDay || "6 sep"}`);
    addRow(rows.remRows, "Dia empleado farmacia no trab.", holidayNotWorkedPlus * inputValue(ctx.inputs, "farmPharmacyDayNotWorked", 0), `${rules.pharmacyEmployeeDay || "6 sep"}`);

    const vacationDays = Math.max(0, inputValue(ctx.inputs, "farmVacationDays", 0));
    if (vacationDays > 0) {
      addRow(rows.remRows, "Vacaciones", vacationDayValue * vacationDays, `÷${vacationDivisor} x ${vacationDays} dias`);
      if (inputBool(ctx.inputs, "farmDiscountVacationDays", true)) {
        addRow(rows.remRows, "Descuento dias vacaciones", -standardDayValue * vacationDays, `-÷${dayDivisor} x ${vacationDays} dias`);
      }
    }

    if (inputBool(ctx.inputs, "farmSac", false)) {
      const sacDays = Math.max(0, Math.min(180, inputValue(ctx.inputs, "farmSacDays", 180)));
      const currentForSac = sumRows(rows.remRows);
      const sacBase = Math.max(inputValue(ctx.inputs, "farmSacBestRem", 0), currentForSac);
      addRow(rows.remRows, "SAC proporcional", (sacBase / 2 / 180) * sacDays, `Base ${sacBase} / 2 / 180 x ${sacDays}`);
    }

    if (inputBool(ctx.inputs, "farmFallaCaja", false)) {
      addRow(rows.noRemRows, "Fondo falla de caja", basePlus * ((rules.fallaCajaPct || 10) / 100), `${rules.fallaCajaPct || 10}% - Art. 19`);
    }

    if (inputBool(ctx.inputs, "farmNonRem", true)) {
      addRow(rows.noRemRows, "Suma no remunerativa escala", (firstFinite(activeRow?.nonRemunerative, ctx.category.nonRem?.[period]) || 0) * noRemProportion, "Escala");
    }

    applyManualRows(ctx, rows);
    const remBeforeAbsence = sumRows(rows.remRows);
    addRow(rows.remRows, "Inasistencia injustificada", -(remBeforeAbsence / dayDivisor) * absentDaysUnjust, `${absentDaysUnjust} dias`);

    const remTotal = sumRows(rows.remRows);
    const osRelevantNoRem = sumRows(rows.noRemRows.filter((row) => !row.label.includes("Fondo falla de caja")));
    let osBase = remTotal + osRelevantNoRem;
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
  };
}

module.exports = {
  createFarmaciaStrategy
};
