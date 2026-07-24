function createUocraStrategy(helpers) {
  const {
    emptyRows,
    scaleCategoryRow,
    resolveUocraScaleValue,
    firstFinite,
    inputString,
    inputValue,
    inputBool,
    addRow,
    sumRows,
    applyManualRows,
    applyWorkerDeductions,
    applyEmployerContribs,
    buildResult
  } = helpers;

  return function calcUocra(ctx) {
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
  };
}

module.exports = {
  createUocraStrategy
};
