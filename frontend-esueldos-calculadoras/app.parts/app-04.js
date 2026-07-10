      || activeScaleFor(conv)?.parsedScale?.reglasNoRemunerativas
      || {};
    rules.nonRemunerativeScale = { ...(rules.nonRemunerativeScale || {}), ...activeScaleRules };
    const salaryType = genericSalaryTypeForCategory(conv, cat);
    const zoneCoef = Number(zone?.coef || 1) || 1;
    const scaleCoef = scaleRowMatchesZone(activeCatRow, zone) ? 1 : zoneCoef;
    const monthPct = Math.max(0, Math.min(100, num("genMonthPct", 100))) / 100;
    const monthDivisor = Number(rules.monthDivisor || 30) || 30;
    const hourDivisor = Number(rules.overtime?.divisor || rules.hourDivisor || 200) || 200;
    const workUnits = Math.max(0, num("genWorkUnits", salaryType === "hourly" ? hourDivisor : monthDivisor));
    const absentDays = Math.max(0, num("genAbsentDays", 0));
    const years = yearsFromEntry();
    const remRows = [];
    const noRemRows = [];
    const deductionRows = [];
    const employerRows = [];
    const details = [];

    const isMonthlyUnit = !activeCatRow?.unidad_pago || activeCatRow?.unidad_pago === "mes" || activeCatRow?.unidad_pago === "mensual";
    const categoryMonthlyRaw = firstFinite(
      activeCatRow?.monthly,
      isMonthlyUnit ? activeCatRow?.valor : null,
      periodAmountValue(activeCatRow, period, ["monthlyByPeriod", "monthlyByPeriodo", "basicoPorPeriodo"]),
      periodAmountValue(cat, period, ["monthlyByPeriod", "monthlyByPeriodo", "basicoPorPeriodo"]),
      cat.monthly
    );
    const isDailyUnit = activeCatRow?.unidad_pago === "dia" || activeCatRow?.unidad_pago === "jornal";
    const categoryDayRaw = firstFinite(
      activeCatRow?.day,
      isDailyUnit ? activeCatRow?.valor : null,
      periodAmountValue(activeCatRow, period, ["dayByPeriod", "jornalPorPeriodo", "valorDiaPorPeriodo"]),
      periodAmountValue(cat, period, ["dayByPeriod", "jornalPorPeriodo", "valorDiaPorPeriodo"]),
      cat.day
    );
    const isHourlyUnit = activeCatRow?.unidad_pago === "hora";
    const categoryHourlyRaw = firstFinite(
      activeCatRow?.hourly,
      isHourlyUnit ? activeCatRow?.valor : null,
      periodAmountValue(activeCatRow, period, ["hourlyByPeriod", "horaPorPeriodo", "valorHoraPorPeriodo"]),
      periodAmountValue(cat, period, ["hourlyByPeriod", "horaPorPeriodo", "valorHoraPorPeriodo"]),
      cat.hourly
    );
    const categoryMonthly = (categoryMonthlyRaw || 0) * scaleCoef;
    const categoryDay = (firstFinite(categoryDayRaw, categoryMonthly ? categoryMonthly / monthDivisor : null) || 0) * (activeCatRow?.day || cat.day ? scaleCoef : 1);
    const categoryHourly = (firstFinite(categoryHourlyRaw, categoryDay ? categoryDay / 8 : null, categoryMonthly ? categoryMonthly / hourDivisor : null) || 0) * (activeCatRow?.hourly || cat.hourly ? scaleCoef : 1);
    let basic = 0;
    if (salaryType === "daily") basic = categoryDay * workUnits;
    else if (salaryType === "hourly") basic = categoryHourly * workUnits;
    else basic = categoryMonthly * monthPct;

    const basicFormula = salaryType === "monthly"
      ? `${calcNum(categoryMonthly)} x ${calcNum(monthPct * 100)} / 100`
      : `${calcNum(salaryType === "hourly" ? categoryHourly : categoryDay)} x ${workUnits}`;
    addRow(remRows, "Basico", basic, salaryType === "monthly" ? `${monthPct * 100}% del mes` : `${workUnits} ${salaryType === "hourly" ? "horas" : "jornales"}`, basicFormula);

    const presentismRule = rules.presentism || {};
    const hasPresentism = checked("genPresentism", presentismRule.enabled && Number(presentismRule.percent || 0) > 0);
    const presentismPct = hasPresentism ? (Number(presentismRule.percent || 0) / 100) : 0;

    const absenceDiscount = salaryType === "monthly" ? (basic / monthDivisor) * absentDays : categoryDay * absentDays;
    addRow(remRows, "Inasistencia injustificada", -absenceDiscount, `${absentDays} dia${absentDays !== 1 ? "s" : ""} / divisor ${monthDivisor}`, salaryType === "monthly" ? `${calcNum(basic)} / ${monthDivisor} x ${absentDays}` : `${calcNum(categoryDay)} x ${absentDays}`);
    const seniorityRule = rules.seniority || {};
    let seniority = 0;
    if (checked("genSeniority", seniorityRule.enabled !== false)) {
      const yearsForCalc = seniorityRule.capYears ? Math.min(years, Number(seniorityRule.capYears)) : years;
      seniority = basic * ((Number(seniorityRule.percentPerYear || 0) * yearsForCalc) / 100);
      addRow(remRows, "Antiguedad", seniority, `${Number(seniorityRule.percentPerYear || 0)}% x ${yearsForCalc} años`, `${calcNum(basic)} x ${Number(seniorityRule.percentPerYear || 0)} x ${yearsForCalc} / 100`);
    }

    if (hasPresentism) {
      const allowed = !presentismRule.requiresNoUnjustifiedAbsence || absentDays === 0;
      if (allowed) addRow(remRows, "Presentismo", (basic + seniority) * ((Number(presentismRule.percent || 0) || 0) / 100), `${presentismRule.percent}%`, `${calcNum(basic + seniority)} x ${presentismRule.percent} / 100`);
      else addRow(details, "Presentismo", 0, "No corresponde por inasistencias injustificadas");
    }

    const hourValue = (sumRows(remRows) || basic) / hourDivisor;
    addRow(remRows, "Horas extra 50%", hourValue * num("genExtra50", 0) * 1.5, `Base habitual / ${hourDivisor} x 1,5`, `${calcNum(hourValue)} x ${calcNum(num("genExtra50", 0))} x 1,5`);
    addRow(remRows, "Horas extra 100%", hourValue * num("genExtra100", 0) * 2, `Base habitual / ${hourDivisor} x 2`, `${calcNum(hourValue)} x ${calcNum(num("genExtra100", 0))} x 2`);

    const noRemScaleRaw = firstFinite(periodNonRemValue(activeCatRow, period), activeCatRow?.nonRemunerative, periodNonRemValue(cat, period)) || 0;
    const noRemScaleBase = noRemScaleRaw * monthPct * scaleCoef;

    const conceptRows = Array.isArray(model.concepts) ? userFacingConcepts(model.concepts) : [];
    conceptRows.forEach((concept) => {
      const inputValue = genericConceptInputValue(concept);
      if (!inputValue) return;
      const baseValue = genericBaseAmount({
        concept,
        basic,
        remTotal: sumRows(remRows),
        categoryMonthly,
        categoryDay,
        categoryHourly,
        seniorityBase: basic + seniority,
        noRemScale: noRemScaleBase
      });
      const amountValue = calcGenericConceptAmount(concept, inputValue, baseValue, period, activeCatRow, cat);
      const rowType = normalizedConceptRowType(concept);
      const target = rowType === "nonRemunerative" ? noRemRows : rowType === "deduction" ? deductionRows : remRows;
      const unitAmount = conceptUsesQuantity(concept)
        ? (genericConceptUnitAmount(concept, period) || Math.max(0, conceptInputNumber(concept, "_unit", 0)))
        : 0;
      const formula = conceptUsesQuantity(concept)
        ? `${calcNum(unitAmount)} x ${calcNum(inputValue)}`
        : concept.calculation === "fixed"
        ? `${calcNum(conceptPeriodAmount(concept, period, ["amountByPeriod", "amountPorPeriodo"], concept.amount))} x ${inputValue}`
        : concept.calculation === "scaleValue"
          ? `${calcNum(baseValue)} x ${inputValue}`
        : concept.calculation === "amountPerUnit"
          ? `${calcNum(conceptPeriodAmount(concept, period, ["unitAmountByPeriod", "valorUnidadPorPeriodo"], concept.unitAmount || concept.amount))} x ${inputValue}`
          : `${calcNum(baseValue)} x ${Number(concept.percent || 0) || 0} / 100${inputValue !== 1 ? ` x ${inputValue}` : ""}`;
      addRow(target, concept.label, amountValue, concept.detail || concept.group || "Concepto del convenio", formula);
    });

    if (checked("genNonRemScale", rules.nonRemunerativeScale?.enabled !== false)) {
      addRow(noRemRows, "Suma no remunerativa escala", noRemScaleBase, activeScaleDetail(conv), `${calcNum(noRemScaleRaw)} x ${calcNum(monthPct * 100)} / 100 x ${calcNum(scaleCoef)}`);
      const noRemRule = rules.nonRemunerativeScale || {};
      const noRemSeniorityPct = Number(noRemRule.seniorityPercentPerYear || 0) || 0;
      const noRemPresentismPct = Number(noRemRule.presentismPercent || 0) || 0;
      const noRemYears = noRemRule.seniorityCapYears ? Math.min(years, Number(noRemRule.seniorityCapYears)) : years;
      const applyNoRemSeniority = noRemRule.seniorityEnabled !== false
        && checked("genSeniority", seniorityRule.enabled !== false || noRemSeniorityPct > 0);
      const noRemSeniority = applyNoRemSeniority ? noRemScaleBase * ((noRemSeniorityPct * noRemYears) / 100) : 0;
      if (noRemSeniority) addRow(noRemRows, "Antiguedad no remunerativa", noRemSeniority, `${noRemSeniorityPct}% x ${noRemYears} años`, `${calcNum(noRemScaleBase)} x ${calcNum(noRemSeniorityPct)} x ${calcNum(noRemYears)} / 100`);
      const allowNoRemPresentism = !noRemRule.presentismRequiresNoUnjustifiedAbsence || absentDays === 0;
      const applyNoRemPresentism = noRemRule.presentismEnabled !== false
        && checked("genPresentism", presentismRule.enabled === true || noRemPresentismPct > 0);
      if (applyNoRemPresentism && allowNoRemPresentism) {
        addRow(noRemRows, "Presentismo no remunerativo", (noRemScaleBase + noRemSeniority) * (noRemPresentismPct / 100), `${noRemPresentismPct}%`, `${calcNum(noRemScaleBase + noRemSeniority)} x ${calcNum(noRemPresentismPct)} / 100`);
      }
    }

    addCommonManualRows(remRows, noRemRows, deductionRows);
    const remTotal = sumRows(remRows);
    const noRemTotal = sumRows(noRemRows);
    const osBase = remTotal + noRemTotal;
    applyWorkerDeductions(deductionRows, remTotal, osBase, conv);
    applyGenericDeductions(deductionRows, employerRows, remTotal, noRemTotal, basic, period, conv);
    applyEmployerContribs(employerRows, remTotal, osBase, conv, basic);

    addRow(details, "Basico de escala", categoryMonthly || categoryDay || categoryHourly, activeScaleDetail(conv));
    addRow(details, "Tipo de liquidacion", 0, salaryType);
    addRow(details, "Divisor horas extra", hourDivisor, "Regla del convenio aprobado");
    addRow(details, "Base obra social", osBase, "Remunerativo + no remunerativo sujeto a OS");
    return buildResult(conv, remRows, noRemRows, deductionRows, employerRows, details);
  }

  function calcUocra(conv) {
    const period = getPeriod(conv);
    const zone = getZone(conv);
    const cat = getCategory(conv);
    const activeRow = scaleCategoryRow(conv, cat, zone);
    const staticScale = conv.scales[period][zone.id][cat.id] || 0;
    const scale = firstFinite(
      cat.monthly ? activeRow?.monthly : activeRow?.day,
      cat.monthly ? activeRow?.day ? activeRow.day * 24 : null : activeRow?.hourly ? activeRow.hourly * 8 : null,
      activeRow?.monthly,
      staticScale
    ) || 0;
    const snrMonthly = firstFinite(activeRow?.nonRemunerative, conv.nonRem[period][zone.id][cat.id]) || 0;
    const years = yearsFromEntry();
    const remRows = [];
    const noRemRows = [];
    const deductionRows = [];
    const employerRows = [];
    const details = [];
    const isMonthly = cat.monthly;
    const hourValue = isMonthly ? 0 : scale / 8;
    const quin = str("uocraPeriodMode", "1");
    const defaultHours = quin === "mensual" ? 176 : 88;
    const normalHours = num("uocraHours", defaultHours);
    const baseGross = isMonthly ? (quin === "mensual" ? scale : scale / 2) : hourValue * normalHours;
    const unjustifiedHours = isMonthly ? 0 : num("uocraAbsence", 0);
    const absenceDiscount = hourValue * unjustifiedHours;
    const base = Math.max(0, baseGross - absenceDiscount);

    addRow(remRows, "Basico", base, isMonthly ? "Sereno mensual proporcional" : `${normalHours} hs x ${fmt(hourValue)}`);
    if (absenceDiscount > 0) addRow(details, "Descuento inasistencias", absenceDiscount, `${unjustifiedHours} hs injustificadas`);

    const seniority = on("uocraSeniority") ? base * (years / 100) : 0;
    addRow(remRows, "Antiguedad", seniority, `${years}% de ${fmt(base)} (Basico)`);
    const presentismBase = base + seniority;
    if (on("uocraPresentism") && unjustifiedHours === 0) {
      addRow(remRows, "Presentismo", presentismBase * 0.20, `20% de ${fmt(presentismBase)} (Basico + Antiguedad)`);
    }

    const altitudePct = num("uocraAltitude", 0);
    addRow(remRows, "Trabajo en altura", base * (altitudePct / 100), `${altitudePct}% de ${fmt(base)}`);
    if (on("uocraSpecialTask")) addRow(remRows, "Tareas especiales", base * 0.20, `20% de ${fmt(base)}`);
    if (on("uocraSubmuracion")) addRow(remRows, "Submuracion", base * 0.10, `10% de ${fmt(base)}`);
    if (on("uocraHormigon")) addRow(remRows, "Hormigon armado", base * 0.15, `15% de ${fmt(base)}`);
    if (on("uocraEncargado")) addRow(remRows, "Encargado", base * 0.10, `10% de ${fmt(base)}`);
    if (!isMonthly) {
      addRow(remRows, "Franco trabajado", hourValue * num("uocraFrancoTrab", 0) * 2, `${num("uocraFrancoTrab", 0)} hs x ${fmt(hourValue)} x 2`);
      addRow(remRows, "Feriado no trabajado", hourValue * num("uocraFeriadoNoTrab", 0), `${num("uocraFeriadoNoTrab", 0)} hs x ${fmt(hourValue)}`);
      addRow(remRows, "Horas extra 50%", hourValue * num("uocraExtra50", 0) * 1.5, `${num("uocraExtra50", 0)} hs x ${fmt(hourValue)} x 1,5`);
      addRow(remRows, "Horas extra 100%", hourValue * num("uocraExtra100", 0) * 2, `${num("uocraExtra100", 0)} hs x ${fmt(hourValue)} x 2`);
    }

    if (on("uocraSNR")) {
      let snr = snrMonthly;
      // Marzo 2026: SNR se paga completa en la 2da quincena, nada en la 1ra
      // Abril/Mayo 2026: 50% en cada quincena
      if (quin === "1") snr = period === "mar26" ? 0 : snrMonthly * 0.5;
      if (quin === "2") snr = period === "mar26" ? snrMonthly : snrMonthly * 0.5;
      if (quin === "mensual") snr = snrMonthly;
      const snrDetail = quin === "mensual" ? `${period.toUpperCase()} mensual` : `${period.toUpperCase()} ${quin === "1" ? "1ra" : "2da"} quincena`;
      addRow(noRemRows, "SNR paritaria", snr, snrDetail);
    }

    if (on("uocraVestimenta")) {
      const officialDay = conv.scales[period][zone.id].oficial || 0;
      addRow(noRemRows, "Asignacion vestimenta", (officialDay / 8) * 8 * 2, "Art. 35, 2 jornales oficial");
    }

    addCommonManualRows(remRows, noRemRows, deductionRows);

    const remTotal = sumRows(remRows);
    const noRemTotal = sumRows(noRemRows);
    const osBase = remTotal + sumRows(noRemRows.filter((row) => row.label.includes("SNR")));
    applyWorkerDeductions(deductionRows, remTotal, osBase, conv);
    applyEmployerContribs(employerRows, remTotal, osBase, conv, base);

    addRow(details, "Valor de escala", scale, activeScaleDetail(conv));
    if (!isMonthly) addRow(details, "Valor hora", hourValue, "Jornal diario / 8");
    addRow(details, "Base obra social", osBase, "Remunerativo + SNR cuando corresponde");

    return buildResult(conv, remRows, noRemRows, deductionRows, employerRows, details);
  }

  function farmaciaAntiquityPct(years) {
    if (years >= 20) return 35;
    if (years >= 15) return 30;
    if (years >= 10) return 25;
    if (years >= 5) return 20;
    if (years >= 2) return 10;
    if (years >= 1) return 5;
    return 0;
  }

  function calcFarmacia(conv) {
    const period = getPeriod(conv);
    const cat = getCategory(conv);
    const zone = getZone(conv);
    const activeCatRow = scaleCategoryRow(conv, cat, zone);
    const years = yearsFromEntry();
    const pctAnt = farmaciaAntiquityPct(years);
    const weeklyHours = Math.min(45, Math.max(0, num("farmWeeklyHours", 45)));
    const proportion = (weeklyHours / 45) * (num("farmMonthPct", 100) / 100);
    // Inasistencias: dias habiles del mes y dias ausentes
    const workingDays = Math.max(1, num("farmWorkingDays", 25));
    const absentDaysUnjust = Math.max(0, num("farmAbsentDays", 0));
    const absentDaysJust = Math.max(0, num("farmAbsentDaysJust", 0));
    const remRows = [];
    const noRemRows = [];
    const deductionRows = [];
    const employerRows = [];
    const details = [];
    const catMonthly = firstFinite(activeCatRow?.monthly, cat.monthly) || 0;
    const base = catMonthly * proportion;
    const initialA = conv.categories.find((item) => item.id === "inicialA");
    const empleadoFarmacia = conv.categories.find((item) => item.id === "empleadoFarmacia");
    const initialARow = scaleCategoryRow(conv, initialA, zone);
    const empleadoFarmaciaRow = scaleCategoryRow(conv, empleadoFarmacia, zone);
    const initialAMonthly = firstFinite(initialARow?.monthly, initialA?.monthly) || 0;
    const empleadoFarmaciaMonthly = firstFinite(empleadoFarmaciaRow?.monthly, empleadoFarmacia?.monthly) || 0;

    addRow(remRows, "Basico", base, `${weeklyHours} hs semanales`);
    const antiquity = on("farmSeniority") ? base * (pctAnt / 100) : 0;
    addRow(remRows, "Escalafon por antiguedad", antiquity, `${pctAnt}% de ${fmt(base)} (Art. 13)`);
    const basicPlusAntiquity = base + antiquity;

    if (on("farmCajero")) addRow(remRows, "Adicional cajero", basicPlusAntiquity * 0.10, `10% de ${fmt(basicPlusAntiquity)} (Basico + Ant.)`);
    if (on("farmAdminTitle")) addRow(remRows, "Adicional tareas administrativas", basicPlusAntiquity * 0.05, `5% de ${fmt(basicPlusAntiquity)} (Basico + Ant.)`);
    if (on("farmAdminTenure")) addRow(remRows, "Adicional administrativo por antiguedad", basicPlusAntiquity * 0.05, `5% de ${fmt(basicPlusAntiquity)} (Basico + Ant.)`);
    if (on("farmPerfumeria")) addRow(remRows, "Adicional perfumeria", basicPlusAntiquity * 0.10, `10% de ${fmt(basicPlusAntiquity)} (Basico + Ant.)`);
    if (on("farmBike")) addRow(remRows, "Adicional bici/ciclomotor/moto", basicPlusAntiquity * 0.10, `10% de ${fmt(basicPlusAntiquity)} (Basico + Ant.)`);

    const initialABaseWithAnt = (initialAMonthly * proportion) * (1 + pctAnt / 100);
    addRow(remRows, "Adicional idioma", initialABaseWithAnt * 0.10 * num("farmLanguages", 0), `10% de ${fmt(initialABaseWithAnt)} x ${num("farmLanguages", 0)}`);

    const employeeFirstWithAnt = (empleadoFarmaciaMonthly * proportion) * (1 + pctAnt / 100);
    if (on("farmAuxTitle")) {
      addRow(remRows, "Titulo auxiliar de farmacia", employeeFirstWithAnt * 0.20, `20% de ${fmt(employeeFirstWithAnt)}`);
    }

    if (on("farmFallaCaja")) {
      addRow(noRemRows, "Fondo falla de caja", basicPlusAntiquity * 0.10, `10% de ${fmt(basicPlusAntiquity)} (Art. 19)`);
    }

    ["tituloFarmaceutico", "adscripcion", "bloqueo"].forEach((key) => {
      if (!on(`farm_${key}`)) return;
      const add = conv.additionals[key];
      const addRowScale = scaleAdditionalRow(conv, key, add);
      const periodLbl = conv.periods.find(p => p.id === period)?.label || period.toUpperCase();
      addRow(remRows, add.label, (firstFinite(addRowScale?.monthly, add.monthly) || 0) * proportion, `Escala ${periodLbl}`);
      if (on("farmNonRem")) {
        addRow(noRemRows, `${add.label} - no remunerativo`, (firstFinite(addRowScale?.nonRemunerative, add.nonRem[period]) || 0) * proportion, periodLbl);
      }
    });

    const hourDivisor = 45 * 52 / 12;
    const hourValue = basicPlusAntiquity / hourDivisor;
    addRow(remRows, "Horas extra 50%", hourValue * num("farmExtra50", 0) * 1.5, `${num("farmExtra50", 0)} hs x ${fmt(hourValue)} x 1,5`);
    addRow(remRows, "Horas extra 100%", hourValue * num("farmExtra100", 0) * 2, `${num("farmExtra100", 0)} hs x ${fmt(hourValue)} x 2`);

    if (on("farmNonRem")) {
      addRow(noRemRows, "Suma no remunerativa escala", (firstFinite(activeCatRow?.nonRemunerative, cat.nonRem[period]) || 0) * proportion, period.toUpperCase());
    }

    // Art. 46 CCT 429/2005: aporte asistencia social adicional 1% en junio y diciembre
    const today = new Date();
    const currentMonth = today.getMonth() + 1; // 1-indexed
    const isSocialMonth = (period === "jun26" || currentMonth === 6 || currentMonth === 12);

    addCommonManualRows(remRows, noRemRows, deductionRows);

    const remTotal = sumRows(remRows);
    const noRemTotal = sumRows(noRemRows);
    const osRelevantNoRem = sumRows(noRemRows.filter((row) => !row.label.includes("Fondo falla de caja")));
    const osBase = remTotal + osRelevantNoRem;

    // Descuento por inasistencias injustificadas: valor dia x dias ausentes (LCT art. 54 / CCT)
    const dailyValue = remTotal / workingDays;
    if (absentDaysUnjust > 0) {
      addRow(deductionRows, "Desc. inasistencias injustificadas", dailyValue * absentDaysUnjust,
        `${absentDaysUnjust} dia${absentDaysUnjust !== 1 ? 's' : ''} x ${fmt(dailyValue)}/dia (${workingDays} hab.)`);
    }
    // Dias justificados: no generan descuento pero se muestran en detalles
    if (absentDaysJust > 0) {
      addRow(details, "Inasistencias justificadas", 0, `${absentDaysJust} dia${absentDaysJust !== 1 ? 's' : ''} — sin descuento`);
    }

    applyWorkerDeductions(deductionRows, remTotal, osBase, conv);

    if (isSocialMonth) {
      addRow(deductionRows, "Aporte asistencia social ADEF 1%", remTotal * 0.01, `1% de ${fmt(remTotal)} (Art. 46 - Jun/Dic)`);
    }

    applyEmployerContribs(employerRows, remTotal, osBase, conv, base);

    addRow(details, "Dias habiles del mes", workingDays, "Base calculo de inasistencias");
    addRow(details, "Valor dia", dailyValue, "Remunerativo total / dias habiles");
    addRow(details, "Basico de escala", catMonthly, activeScaleDetail(conv));
    addRow(details, "Proporcion de jornada", proportion * 100, `${weeklyHours}/45 hs y ${num("farmMonthPct", 100)}% del mes`);
    addRow(details, "Valor hora estimado", hourValue, "Basico + antiguedad / 195");
    addRow(details, "Base obra social", osBase, "Remunerativo + no remunerativo");

    return buildResult(conv, remRows, noRemRows, deductionRows, employerRows, details);
  }

  function calcFarmaciaPlus(conv) {
    const period = getPeriod(conv);
    const cat = getCategory(conv);
    const zone = getZone(conv);
    const activeCatRow = scaleCategoryRow(conv, cat, zone);
    const rules = conv.rules || {};
    const years = yearsFromEntry();
    const pctAnt = farmaciaAntiquityPct(years);
    const fullWeeklyHours = Number(rules.weeklyHours || 45);
    const actualWeeklyHours = Math.min(fullWeeklyHours, Math.max(0, num("farmWeeklyHours", fullWeeklyHours)));
    const insalubreLimit = Number(rules.insalubreWeeklyHours || 33);
    const insalubrePaidHours = Number(rules.insalubrePaidWeeklyHours || fullWeeklyHours);
    const isInsalubre = checked("farmInsalubre", false);
    const paidWeeklyHours = isInsalubre && actualWeeklyHours > 0 && actualWeeklyHours <= insalubreLimit
      ? Math.min(fullWeeklyHours, insalubrePaidHours)
      : actualWeeklyHours;
    const weeklyFactor = fullWeeklyHours > 0 ? paidWeeklyHours / fullWeeklyHours : 1;
    const monthPct = Math.max(0, Math.min(100, num("farmMonthPct", 100)));
    const monthFactor = monthPct / 100;
    const proportion = weeklyFactor * monthFactor;
    const workingDays = Math.max(1, num("farmWorkingDays", 30));
    const absentDaysUnjust = Math.max(0, num("farmAbsentDays", 0));
    const absentDaysJust = Math.max(0, num("farmAbsentDaysJust", 0));
    const noRemInput = str("farmNoRemDays").trim();
    const parsedNoRemDays = noRemInput ? Number(noRemInput.replace(",", ".")) : Math.max(0, workingDays - absentDaysUnjust);
    const noRemDays = Math.max(0, Math.min(workingDays, Number.isFinite(parsedNoRemDays) ? parsedNoRemDays : workingDays));
    const noRemProportion = proportion * (checked("farmProrateNonRem", true) ? noRemDays / workingDays : 1);
    const remRows = [];
    const noRemRows = [];
    const deductionRows = [];
    const employerRows = [];
    const details = [];
    const catMonthly = firstFinite(
      activeCatRow?.monthly,
      periodAmountValue(activeCatRow, period, ["monthlyByPeriod", "monthlyByPeriodo", "basicoPorPeriodo"]),
      periodAmountValue(cat, period, ["monthlyByPeriod", "monthlyByPeriodo", "basicoPorPeriodo"]),
      cat.monthly
    ) || 0;
    const base = catMonthly * proportion;
    const findFarmCategory = (legacyId, labelNeedle) => {
      const needle = normalizeMatchText(labelNeedle);
      return conv.categories.find((item) => item.id === legacyId)
        || conv.categories.find((item) => normalizeMatchText(item.id) === normalizeMatchText(legacyId))
        || conv.categories.find((item) => normalizeMatchText(item.label).includes(needle));
    };
    const initialA = findFarmCategory("inicialA", "categoria inicial a");
    const empleadoFarmacia = findFarmCategory("empleadoFarmacia", "empleado de farmacia");
    const initialARow = scaleCategoryRow(conv, initialA, zone);
    const empleadoFarmaciaRow = scaleCategoryRow(conv, empleadoFarmacia, zone);
    const initialAMonthly = firstFinite(
      initialARow?.monthly,
      periodAmountValue(initialARow, period, ["monthlyByPeriod", "monthlyByPeriodo", "basicoPorPeriodo"]),
      periodAmountValue(initialA, period, ["monthlyByPeriod", "monthlyByPeriodo", "basicoPorPeriodo"]),
      initialA?.monthly
    ) || 0;
    const empleadoFarmaciaMonthly = firstFinite(
      empleadoFarmaciaRow?.monthly,
      periodAmountValue(empleadoFarmaciaRow, period, ["monthlyByPeriod", "monthlyByPeriodo", "basicoPorPeriodo"]),
      periodAmountValue(empleadoFarmacia, period, ["monthlyByPeriod", "monthlyByPeriodo", "basicoPorPeriodo"]),
      empleadoFarmacia?.monthly
    ) || 0;
    const periodLbl = conv.periods.find((item) => item.id === period)?.label || period.toUpperCase();
    const dayDivisor = Number(rules.dayDivisor || 30);
    const vacationDivisor = Number(rules.vacationDivisor || 25);
    const hourDivisor = Number(rules.hourDivisor || 200);

    const baseDetail = isInsalubre
      ? `${actualWeeklyHours} hs insalubres pagadas como ${paidWeeklyHours}/${fullWeeklyHours}; ${monthPct}% del mes`
      : `${actualWeeklyHours}/${fullWeeklyHours} hs semanales; ${monthPct}% del mes`;
    const baseFormula = `${calcNum(catMonthly)} x ${calcNum(paidWeeklyHours)} / ${calcNum(fullWeeklyHours)} x ${calcNum(monthPct)} / 100`;
    addRow(remRows, "Basico", base, baseDetail, baseFormula);

    let seniorityBase = base;
    const includeFixedInSeniority = checked("farmSeniorityOnFixedAdditions", true);
    const addRegularRem = (label, amount, detail, includeForSeniority = true, formula = "") => {
      addRow(remRows, label, amount, detail, formula);
      if (includeForSeniority && includeFixedInSeniority) seniorityBase += amount;
    };

    ["tituloFarmaceutico", "adscripcion", "bloqueo"].forEach((key) => {
      if (!on(`farm_${key}`)) return;
      const add = conv.additionals[key];
      const scaleRow = scaleAdditionalRow(conv, key, add);
      const value = firstFinite(scaleRow?.monthly, add.monthly) || 0;
      addRegularRem(add.label, value * proportion, `Escala ${periodLbl}`, true, `${calcNum(value)} x ${calcNum(proportion)}`);
    });

    if (on("farmCajero")) addRegularRem("Adicional cajero", base * ((rules.cajeroPct || 10) / 100), `${rules.cajeroPct || 10}% de ${fmt(base)} (Basico)`, true, `${calcNum(base)} x ${calcNum(rules.cajeroPct || 10)} / 100`);
    if (on("farmAdminTitle")) addRegularRem("Adicional tareas administrativas", base * ((rules.tareasAdministrativasPct || 5) / 100), `${rules.tareasAdministrativasPct || 5}% de ${fmt(base)} (Basico)`, true, `${calcNum(base)} x ${calcNum(rules.tareasAdministrativasPct || 5)} / 100`);
    if (on("farmAdminTenure")) {
      const pct = years > 2 ? (rules.adminTenurePctOver2Years || 10) : (rules.adminTenurePctInitial || 5);
      addRegularRem("Adicional administrativo por antiguedad", base * (pct / 100), `${pct}% de ${fmt(base)} (Basico)`, true, `${calcNum(base)} x ${calcNum(pct)} / 100`);
    }
    if (on("farmPerfumeria")) addRegularRem("Adicional perfumeria", base * ((rules.perfumeriaPct || 10) / 100), `${rules.perfumeriaPct || 10}% de ${fmt(base)} (Basico)`, true, `${calcNum(base)} x ${calcNum(rules.perfumeriaPct || 10)} / 100`);
    if (on("farmBike")) addRegularRem("Adicional bici/ciclomotor/moto", base * ((rules.bikePct || 10) / 100), `${rules.bikePct || 10}% de ${fmt(base)} (Basico)`, true, `${calcNum(base)} x ${calcNum(rules.bikePct || 10)} / 100`);

    const initialABase = initialAMonthly * proportion;
    addRegularRem("Adicional idioma", initialABase * ((rules.languagePct || 10) / 100) * num("farmLanguages", 0), `${rules.languagePct || 10}% de ${fmt(initialABase)} x ${num("farmLanguages", 0)}`, true, `${calcNum(initialABase)} x ${calcNum(rules.languagePct || 10)} / 100 x ${calcNum(num("farmLanguages", 0))}`);

    const employeeFirstBase = empleadoFarmaciaMonthly * proportion;
    if (on("farmAuxTitle")) {
      addRegularRem("Titulo auxiliar de farmacia", employeeFirstBase * ((rules.auxTitlePct || 20) / 100), `${rules.auxTitlePct || 20}% de ${fmt(employeeFirstBase)}`, true, `${calcNum(employeeFirstBase)} x ${calcNum(rules.auxTitlePct || 20)} / 100`);
    }

    let seniorityAmount = 0;
    if (on("farmSeniority")) {
      seniorityAmount = seniorityBase * (pctAnt / 100);
