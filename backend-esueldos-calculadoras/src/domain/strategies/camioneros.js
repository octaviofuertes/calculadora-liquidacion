function createCamionerosStrategy(helpers) {
  const {
    emptyRows,
    scaleCategoryRow,
    scaleRowMatchesZone,
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

  return function calcCamioneros(ctx) {
    const rows = emptyRows();
    const coef = Number(ctx.zone.coef || 1) || 1;
    const activeRow = scaleCategoryRow(ctx.activeScale, ctx.category, ctx.zone, ctx.modality);
    const hasSpecificZone = scaleRowMatchesZone(activeRow, ctx.zone);
    const periodDays = Math.max(1, inputValue(ctx.inputs, "camPeriodDays", 24));
    const paidDays = Math.min(Math.max(0, inputValue(ctx.inputs, "camWorkingDays", periodDays)), periodDays);
    const absentDays = Math.max(0, inputValue(ctx.inputs, "camAbsentDays", 0));
    const noRemDaysRaw = inputString(ctx.inputs, "camNoRemDays", "");
    const noRemDays = noRemDaysRaw ? Number(noRemDaysRaw.replace(",", ".")) || 0 : Math.max(0, paidDays - absentDays);
    const activeMonthly = firstFinite(activeRow?.monthly);
    const baseMonthly = activeMonthly ? activeMonthly * (hasSpecificZone ? 1 : coef) : Number(ctx.category.monthly || 0) * coef;
    const baseDay = firstFinite(activeRow?.day ? activeRow.day * (hasSpecificZone ? 1 : coef) : null, baseMonthly / periodDays, Number(ctx.category.day || 0) * coef) || 0;
    const base = Math.max(0, baseDay * paidDays - baseDay * absentDays);
    const items = ctx.convention.items || {};
    addRow(rows.remRows, "Basico proporcional", base, `${paidDays} jornales`);
    if (inputBool(ctx.inputs, "camComida", true)) addRow(rows.noRemRows, "Comida", Number(items.comida || 0) * coef * noRemDays, `${noRemDays} dias`);
    if (inputBool(ctx.inputs, "camViaticoEspecial", true)) addRow(rows.noRemRows, "Viatico especial", Number(items.viaticoEspecial || 0) * coef * noRemDays, `${noRemDays} dias`);
    addRow(rows.noRemRows, "Pernoctada", Number(items.pernoctada || 0) * coef * inputValue(ctx.inputs, "camPernoctadaDays", 0), "CCT 40/89");
    addRow(rows.noRemRows, "Permanencia fuera de residencia", Number(items.permanencia || 0) * coef * inputValue(ctx.inputs, "camPermanencia", 0), "CCT 40/89");
    addRow(rows.noRemRows, "Simple presencia", Number(items.simplePresencia || 0) * coef * inputValue(ctx.inputs, "camSimplePresence", 0), "CCT 40/89");
    addRow(rows.noRemRows, "Cruce de frontera", Number(items.cruceFrontera || 0) * coef * inputValue(ctx.inputs, "camCruces", 0), "CCT 40/89");
    addRow(rows.noRemRows, "Ingreso/egreso Tierra del Fuego", Number(items.ingresoIsla || 0) * coef * inputValue(ctx.inputs, "camIsla", 0), "CCT 40/89");
    const kmNormal = Math.max(0, inputValue(ctx.inputs, "camKmExtra", 0));
    const kmWeekend = Math.max(0, inputValue(ctx.inputs, "camKmWeekend", 0));
    const kmTravelDays = Math.max(0, inputValue(ctx.inputs, "camKmTravelDays", 0));
    const minViaticoKm = inputBool(ctx.inputs, "camApplyKmMin", false) ? kmTravelDays * 350 : 0;
    addRow(rows.remRows, "Horas extraordinarias por km", Number(items.kmExtra || 0) * coef * kmNormal, "Item 4.2.3");
    addRow(rows.remRows, "Km sab/dom/feriado 100%", Number(items.kmExtra || 0) * coef * kmWeekend * 2, "Item 4.2.3");
    addRow(rows.noRemRows, "Viatico por km", Number(items.kmViatico || 0) * coef * Math.max(kmNormal, minViaticoKm), "Item 4.2.4");
    addRow(rows.noRemRows, "Viatico por km manual", Number(items.kmViatico || 0) * coef * inputValue(ctx.inputs, "camKmViatico", 0), "Manual");
    addRow(rows.remRows, "Adicional bitrenes", Number(items.bitrenes || 0) * coef * inputValue(ctx.inputs, "camBitrenes", 0), "Planilla");
    addRow(rows.remRows, "Plus vacacional", Number(items.plusVacacionalDia || 0) * coef * inputValue(ctx.inputs, "camVacationPlusDays", 0), "Planilla");
    if (inputBool(ctx.inputs, "camPresentism", true) && absentDays === 0) addRow(rows.remRows, "Presentismo", base * ((items.presentismoPct || 8.33) / 100), "Basico");
    const branchAdds = [
      ["camLongDistanceDriver", "Adicional chofer larga distancia", items.choferLargaDistanciaPct || 10],
      ["camLactea", "Transporte materia prima lactea", items.lacteaPct || 15],
      ["camAuxilio", "Conductor de auxilio", items.auxilioPct || 10],
      ["camBlindado", "Unidades blindadas", items.blindadoPct || 20],
      ["camPeligrosas", "Sustancias peligrosas", items.peligrosasPct || 20],
      ["camPozos", "Pozos petroliferos", items.pozosPetroliferosPct || 40],
      ["camLogistica", "Logistica/almacenamiento", items.logisticaPct || 18],
      ["camCamaraFrio", "Camara de frio", items.camaraFrioPct || 20]
    ];
    branchAdds.forEach(([key, label, pct]) => {
      if (inputBool(ctx.inputs, key, false)) addRow(rows.remRows, label, base * (pct / 100), `${pct}%`);
    });
    addRow(rows.remRows, "Adicional de rama manual", base * (inputValue(ctx.inputs, "camAdditionalPct", 0) / 100), "Manual");
    addRow(rows.remRows, "Otros adicionales Camioneros", inputValue(ctx.inputs, "camOtherRem", 0), "Manual");
    if (inputBool(ctx.inputs, "camSeniority", true)) addRow(rows.remRows, "Antiguedad", sumRows(rows.remRows) * (ctx.employee.years / 100), `${ctx.employee.years}%`);
    const hourValue = baseDay / 8;
    addRow(rows.remRows, "Horas extra 50%", hourValue * inputValue(ctx.inputs, "camExtra50", 0) * 1.5, "x1,5");
    addRow(rows.remRows, "Horas extra 100%", hourValue * inputValue(ctx.inputs, "camExtra100", 0) * 2, "x2");
    addRow(rows.remRows, "Horas nocturnas 100%", hourValue * inputValue(ctx.inputs, "camNightHours", 0) * 2, "x2");
    applyManualRows(ctx, rows);
    const remTotal = sumRows(rows.remRows);
    applyWorkerDeductions(ctx, rows, remTotal, remTotal);
    applyEmployerContribs(ctx, rows, remTotal, remTotal, base);
    addRow(rows.details, "Sueldo mensual categoria", baseMonthly, ctx.activeScale ? "Escala aprobada" : "Escala base");
    addRow(rows.details, "Jornal diario", baseDay, ctx.activeScale ? "Escala aprobada" : "Escala base");
    addRow(rows.details, "Base obra social", remTotal, "Solo remunerativos");
    return buildResult(ctx, rows);
  };
}

module.exports = {
  createCamionerosStrategy
};
