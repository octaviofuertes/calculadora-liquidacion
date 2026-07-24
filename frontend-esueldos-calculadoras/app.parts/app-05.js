      addRow(remRows, "Escalafon por antiguedad", seniorityAmount, `${pctAnt}% de ${fmt(seniorityBase)} (Base Antiguedad)`, `${calcNum(seniorityBase)} x ${calcNum(pctAnt)} / 100`);
    }

    const regularRem = sumRows(remRows);
    const standardDayValue = regularRem / dayDivisor;
    const vacationDayValue = regularRem / vacationDivisor;
    const holidayWorkedDays = Math.max(0, num("farmHolidayWorkedDays", 0));
    const holidayNotWorkedDays = Math.max(0, num("farmHolidayNotWorkedDays", 0));
    const pharmacyDayWorked = Math.max(0, num("farmPharmacyDayWorked", 0));
    const pharmacyDayNotWorked = Math.max(0, num("farmPharmacyDayNotWorked", 0));
    const vacationDays = Math.max(0, num("farmVacationDays", 0));
    const holidayNotWorkedPlus = Math.max(0, vacationDayValue - standardDayValue);
    addRow(remRows, "Feriado trabajado", vacationDayValue * holidayWorkedDays, `Adicional feriado trabajado: /${vacationDivisor}`, `${calcNum(regularRem)} / ${calcNum(vacationDivisor)} x ${calcNum(holidayWorkedDays)}`);
    addRow(remRows, "Feriado no trabajado", holidayNotWorkedPlus * holidayNotWorkedDays, `Diferencia feriado: /${vacationDivisor} - /${dayDivisor}`, `(${calcNum(regularRem)} / ${calcNum(vacationDivisor)} - ${calcNum(regularRem)} / ${calcNum(dayDivisor)}) x ${calcNum(holidayNotWorkedDays)}`);
    addRow(remRows, "Dia empleado farmacia trabajado", vacationDayValue * pharmacyDayWorked, `${rules.pharmacyEmployeeDay || "6 de septiembre"} - adicional /${vacationDivisor}`, `${calcNum(regularRem)} / ${calcNum(vacationDivisor)} x ${calcNum(pharmacyDayWorked)}`);
    addRow(remRows, "Dia empleado farmacia no trabajado", holidayNotWorkedPlus * pharmacyDayNotWorked, `${rules.pharmacyEmployeeDay || "6 de septiembre"} - diferencia /${vacationDivisor} - /${dayDivisor}`, `(${calcNum(regularRem)} / ${calcNum(vacationDivisor)} - ${calcNum(regularRem)} / ${calcNum(dayDivisor)}) x ${calcNum(pharmacyDayNotWorked)}`);
    if (vacationDays > 0) {
      addRow(remRows, "Vacaciones", vacationDayValue * vacationDays, `Remuneracion normal / ${vacationDivisor} x ${vacationDays}`, `${calcNum(regularRem)} / ${calcNum(vacationDivisor)} x ${calcNum(vacationDays)}`);
      if (checked("farmDiscountVacationDays", true)) {
        addRow(remRows, "Descuento dias vacaciones", -standardDayValue * vacationDays, `Remuneracion normal / ${dayDivisor} x ${vacationDays}`, `-${calcNum(regularRem)} / ${calcNum(dayDivisor)} x ${calcNum(vacationDays)}`);
      }
    }

    const hourBase = sumRows(remRows);
    const hourValue = hourBase / hourDivisor;
    addRow(remRows, "Horas extra 50%", hourValue * num("farmExtra50", 0) * 1.5, `${num("farmExtra50", 0)} hs x ${fmt(hourValue)} x 1,5`, `${calcNum(hourBase)} / ${calcNum(hourDivisor)} x ${calcNum(num("farmExtra50", 0))} x 1,5`);
    addRow(remRows, "Horas extra 100%", hourValue * num("farmExtra100", 0) * 2, `${num("farmExtra100", 0)} hs x ${fmt(hourValue)} x 2`, `${calcNum(hourBase)} / ${calcNum(hourDivisor)} x ${calcNum(num("farmExtra100", 0))} x 2`);
    addRow(remRows, "Adicional nocturno voluntario", hourValue * num("farmNightHours", 0) * ((rules.nightPct || 100) / 100), `${num("farmNightHours", 0)} hs x ${fmt(hourValue)} x ${(rules.nightPct || 100) / 100}`, `${calcNum(hourBase)} / ${calcNum(hourDivisor)} x ${calcNum(num("farmNightHours", 0))} x ${calcNum(rules.nightPct || 100)} / 100`);

    if (checked("farmSac", false)) {
      const sacDays = Math.max(0, Math.min(180, num("farmSacDays", 180)));
      const currentForSac = sumRows(remRows);
      const sacBase = Math.max(num("farmSacBestRem", 0), currentForSac);
      addRow(remRows, "SAC proporcional", (sacBase / 2 / 180) * sacDays, `Base ${fmt(sacBase)} / 2 / 180 x ${sacDays}`, `${calcNum(sacBase)} / 2 / 180 x ${calcNum(sacDays)}`);
    }

    if (on("farmFallaCaja")) {
      addRow(noRemRows, "Fondo falla de caja", (base + seniorityAmount) * ((rules.fallaCajaPct || 10) / 100), `${rules.fallaCajaPct || 10}% de ${fmt(base + seniorityAmount)} (Basico + Ant.)`, `${calcNum(base + seniorityAmount)} x ${calcNum(rules.fallaCajaPct || 10)} / 100`);
    }

    if (on("farmNonRem")) {
      const noRemValue = firstFinite(activeCatRow?.nonRemunerative, cat.nonRem[period]) || 0;
      addRow(noRemRows, "Suma no remunerativa escala", noRemValue * noRemProportion, `${periodLbl}; dias no rem. ${noRemDays}/${workingDays}`, `${calcNum(noRemValue)} x ${calcNum(noRemProportion)}`);
      ["tituloFarmaceutico", "adscripcion", "bloqueo"].forEach((key) => {
        if (!on(`farm_${key}`)) return;
        const add = conv.additionals[key];
        const scaleRow = scaleAdditionalRow(conv, key, add);
        addRow(noRemRows, `${add.label} - no remunerativo`, (firstFinite(scaleRow?.nonRemunerative, add.nonRem[period]) || 0) * noRemProportion, periodLbl);
      });
    }

    addCommonManualRows(remRows, noRemRows, deductionRows);

    const absenceBase = sumRows(remRows);
    const absenceDiscount = (absenceBase / dayDivisor) * absentDaysUnjust;
    addRow(remRows, "Inasistencia injustificada", -absenceDiscount, `${absentDaysUnjust} dia${absentDaysUnjust !== 1 ? "s" : ""} x ${fmt(absenceBase / dayDivisor)} (${dayDivisor})`);
    if (absentDaysJust > 0) {
      addRow(details, "Inasistencias justificadas", 0, `${absentDaysJust} dia${absentDaysJust !== 1 ? "s" : ""} - sin descuento`);
    }

    const remTotal = sumRows(remRows);
    const osRelevantNoRem = sumRows(noRemRows.filter((row) => !row.label.includes("Fondo falla de caja")));
    let osBase = remTotal + osRelevantNoRem;
    if (checked("farmOsFullTimeBase", true) && weeklyFactor > 0 && weeklyFactor < 1) {
      osBase = Math.max(osBase, osBase / weeklyFactor);
    }

    applyWorkerDeductions(deductionRows, remTotal, osBase, conv);

    const isSocialMonth = period === "jun26" || period === "dic26" || /(^|-)06$/.test(period) || /(^|-)12$/.test(period);
    if (checked("farmSocialJuneDec", true) && isSocialMonth) {
      addRow(deductionRows, "Aporte asistencia social ADEF 1%", remTotal * 0.01, `1% de ${fmt(remTotal)} (Art. 46 - Jun/Dic)`);
    }

    applyEmployerContribs(employerRows, remTotal, osBase, conv, base);

    addRow(details, "Basico de escala", catMonthly, activeScaleDetail(conv));
    addRow(details, "Proporcion de jornada", proportion * 100, `${paidWeeklyHours}/${fullWeeklyHours} hs liquidadas y ${monthPct}% del mes`);
    if (isInsalubre) addRow(details, "Jornada insalubre", actualWeeklyHours, `${actualWeeklyHours} hs reales; se abona como ${paidWeeklyHours} hs si no supera ${insalubreLimit} hs`);
    addRow(details, "Dias no remunerativos", noRemDays, `Prorrateo ${checked("farmProrateNonRem", true) ? "activo" : "desactivado"}`);
    addRow(details, "Base antiguedad", seniorityBase, includeFixedInSeniority ? "Basico + adicionales fijos/funcion" : "Solo basico");
    addRow(details, "Valor dia sueldo", standardDayValue, `Remuneracion habitual / ${dayDivisor}`);
    addRow(details, "Valor dia vacaciones", vacationDayValue, `Remuneracion habitual / ${vacationDivisor}`);
    applyEmployerContribs(employerRows, remTotal, osBase, conv, base);

    addRow(details, "Sueldo mensual categoria", baseMonthly, activeScaleDetail(conv));
    addRow(details, "Jornal diario", baseDay, activeScaleDetail(conv));
    addRow(details, "Valor hora", hourValue, "Jornal diario / 8");
    addRow(details, "Dias convencionales", periodDays, "Divisor de jornal");
    addRow(details, "Dias pagados", paidDays, "Jornales a liquidar");
    if (absentDaysUnjust > 0) addRow(details, "Inasistencias injustificadas", absenceDiscount, `${absentDaysUnjust} x ${fmt(baseDay)}; descuenta presentismo`);
    addRow(details, "Dias no remunerativos", noRemDays, "Comida y viatico especial");
    if (minViaticoKm > kmNormal) addRow(details, "Minimo viatico por km", minViaticoKm, "350 km x dia de viaje");
    addRow(details, "Coeficiente zona", coef, zone.label);
    addRow(details, "Base chofer 1ra", driverFirstMonthly, "Referencia para adicionales especiales");
    addRow(details, "Base obra social", osBase, "Solo remunerativos (viaticos excluidos Art.4.2.11)");

    return buildResult(conv, remRows, noRemRows, deductionRows, employerRows, details);
  }

  function buildResult(conv, remRows, noRemRows, deductionRows, employerRows, details) {
    const remTotal = sumRows(remRows);
    const noRemTotal = sumRows(noRemRows);
    const gross = remTotal + noRemTotal;
    const deductions = sumRows(deductionRows);
    const employerContribs = sumRows(employerRows);
    const net = gross - deductions;
    return {
      conv,
      employee: {
        entryDate: str("entryDate", "-") || "-",
        years: yearsFromEntry()
      },
      period: getPeriod(conv),
      category: getCategory(conv),
      zone: getZone(conv),
      activeScale: activeScaleFor(conv) ? {
        id: activeScaleFor(conv).id,
        period: activeScaleFor(conv).period,
        periodLabel: activeScaleFor(conv).periodLabel,
        approvedAt: activeScaleFor(conv).approvedAt
      } : null,
      remRows,
      noRemRows,
      deductionRows,
      employerRows,
      details,
      totals: { remTotal, noRemTotal, gross, deductions, employerContribs, net, employerCost: gross + employerContribs }
    };
  }

  function buildBackendCalculationPayload() {
    const conv = getConvention();
    const inputs = {};
    document.querySelectorAll("#payrollForm input, #payrollForm select").forEach((el) => {
      if (!el.id || ["convention", "period", "category", "zone"].includes(el.id)) return;
      if (el.type === "checkbox") inputs[el.id] = el.checked;
      else inputs[el.id] = el.value;
    });
    return {
      conventionId: conv.id,
      period: getPeriod(conv),
      categoryId: getCategory(conv).id,
      zoneId: getZone(conv).id,
      employee: {
        entryDate: str("entryDate", "") || ""
      },
      inputs,
      generatedAt: new Date().toISOString()
    };
  }

  function normalizeBackendResult(payload) {
    const conv = DATA.conventions[payload.conventionId] || payload.conv || getConvention();
    return {
      conv,
      employee: payload.employee,
      period: payload.period,
      category: payload.category || getCategory(conv),
      zone: payload.zone || getZone(conv),
      activeScale: payload.activeScale || null,
      remRows: payload.remunerative || payload.remRows || [],
      noRemRows: payload.nonRemunerative || payload.noRemRows || [],
      deductionRows: payload.deductions || payload.deductionRows || [],
      employerRows: payload.employer || payload.employerRows || [],
      details: payload.details || [],
      totals: payload.totals,
      calculation: payload.calculation || null
    };
  }

  async function calculate() {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(apiUrl("/api/liquidations/calculate"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildBackendCalculationPayload()),
        signal: controller.signal
      });
      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({}));
        throw new Error(errorPayload.error || `HTTP ${response.status}`);
      }
      lastAudit = null;
      lastResult = normalizeBackendResult(await response.json());
      renderAll(lastResult);
      setActionButtonsEnabled(true);
      return;
    } catch (error) {
      console.warn("Calculo backend no disponible; usando motor local.", error);
      calculateLocal();
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function calculateLocal() {
    const conv = getConvention();
    if (!conv) return;
    lastAudit = null;
    const kind = window.eSueldosCatalogSync
      ? window.eSueldosCatalogSync.resolveConventionKind(conv)
      : String(conv.id || "").toLowerCase();
    if (kind === "uocra") lastResult = calcUocra(conv);
    if (kind === "farmacia") lastResult = calcFarmaciaPlus(conv);
    if (kind === "camioneros") lastResult = calcCamioneros(conv);
    if (!lastResult && isGenericConvention(conv)) lastResult = calcGenericConvention(conv);
    if (!lastResult) lastResult = calcGenericConvention(conv);
    renderAll(lastResult);
    setActionButtonsEnabled(true);
  }

  function renderAll(result) {
    $("receipt").className = "";
    $("calculation").className = "";
    $("details").className = "";
    $("scales").className = "";
    renderMetrics(result.totals);
    $("receipt").innerHTML = renderReceipt(result);
    $("calculation").innerHTML = renderCalculation(result);
    $("details").innerHTML = renderDetails(result);
    $("scales").innerHTML = renderScales(result);
    renderConventionSummaryPane(result);
    $("auditResult").className = "";
    renderAutopilotAudit(result);
  }

  function renderReceipt(result) {
    const periodLabel = result.conv.periods.find((item) => item.id === result.period)?.label || result.period;
    return `<div class="receipt">
      <div class="receipt-head">
        <div>
          <div class="receipt-title">Liquidacion</div>
          <div class="receipt-meta">
            <span>Ingreso: ${escapeHtml(result.employee.entryDate)} | Antiguedad: ${result.employee.years} años</span>
          </div>
        </div>
        <div class="receipt-meta">
          <span>${escapeHtml(result.conv.name)}</span>
          <span>${escapeHtml(periodLabel)}</span>
          <span>${escapeHtml(result.category.label)} | ${escapeHtml(result.zone.label)}</span>
        </div>
      </div>
      <div class="receipt-cols">
        <div class="receipt-block">
          <h2 class="block-title">Haberes</h2>
          <div class="receipt-section" data-receipt-section="remunerative">
            ${result.remRows.map((row) => rowHtml(row)).join("") || `<div class="empty">Sin haberes.</div>`}
          </div>
          <div class="receipt-section" data-receipt-section="nonremunerative">
            <h2 class="block-title" style="margin-top:14px">No remunerativo</h2>
            ${result.noRemRows.map((row) => rowHtml(row)).join("") || `<div class="empty">Sin no remunerativos.</div>`}
          </div>
        </div>
        <div class="receipt-block receipt-section" data-receipt-section="deductions">
          <h2 class="block-title">Deducciones</h2>
          ${result.deductionRows.map((row) => rowHtml(row, true)).join("") || `<div class="empty">Sin deducciones.</div>`}
        </div>
      </div>
      <div class="line-total" data-receipt-section="remunerative-total"><span>Total remunerativo</span><span class="amount">${fmt(result.totals.remTotal)}</span></div>
      <div class="line-total" data-receipt-section="nonremunerative-total"><span>Total no remunerativo</span><span class="amount">${fmt(result.totals.noRemTotal)}</span></div>
      <div class="line-total"><span>Total bruto</span><span class="amount">${fmt(result.totals.gross)}</span></div>
      <div class="line-total" data-receipt-section="deductions-total"><span>Total deducciones</span><span class="amount">${fmt(result.totals.deductions)}</span></div>
      <div class="line-total net-total" data-receipt-section="net"><span>Neto a cobrar</span><span class="amount">${fmt(result.totals.net)}</span></div>
      <div class="receipt-actions no-print" style="margin-top: 20px; text-align: left;">
        <button class="primary-action is-inline" onclick="window.print()" type="button" aria-label="Descargar o imprimir recibo" style="padding: 10px 16px; border-radius: 6px; font-weight: 500;">
          <svg viewBox="0 0 24 24" aria-hidden="true" style="width:16px;height:16px;vertical-align:middle;margin-right:8px;fill:currentColor">
            <path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"></path>
          </svg>
          Descargar recibo
        </button>
      </div>
    </div>`;
  }

  function renderDetails(result) {
    const remRows = result.remRows || result.remunerative || [];
    const noRemRows = result.noRemRows || result.nonRemunerative || [];
    const deductionRows = result.deductionRows || result.deductions || [];
    const calcRows = [...remRows, ...noRemRows, ...deductionRows];
    const employerRows = [
      { label: "Bruto trabajador", amount: result.totals.gross, detail: "" },
      ...(result.employerRows || result.employer || []),
      { label: "Costo total estimado", amount: result.totals.employerCost, detail: "Bruto + contribuciones" }
    ];
    return `<div class="detail-grid">
      ${renderDetailCard("Conceptos remunerativos", remRows.length, tableRows(remRows))}
      ${renderDetailCard("Conceptos no remunerativos", noRemRows.length, tableRows(noRemRows))}
      ${renderDetailCard("Deducciones trabajador", deductionRows.length, tableRows(deductionRows))}
      ${renderDetailCard("Como se liquido cada concepto", calcRows.length, calculationRows(calcRows))}
      ${renderDetailCard("Costo empleador", employerRows.length, tableRows(employerRows))}
      ${renderDetailCard("Bases y calculos", (result.details || []).length, tableRows(result.details || []))}
    </div>`;
  }

  function renderDetailCard(title, count, body) {
    return `<details class="summary-section summary-collapsible detail-card">
      <summary><span>${escapeHtml(title)}</span><em>${count} ${count === 1 ? "fila" : "filas"}</em></summary>
      <div class="summary-collapsible-body detail-card-body">${body}</div>
    </details>`;
  }

  function renderScales(result) {
    const source = result.activeScale
      ? `<div class="scale-source-note">Liquidacion basada en escala aprobada vigente: ${escapeHtml(result.activeScale.periodLabel || monthLabel(result.activeScale.period))}.</div>`
      : `<div class="scale-source-note">Liquidacion basada en la escala base cargada en el sistema.</div>`;
    const rendererKey = window.eSueldosCatalogSync
      ? window.eSueldosCatalogSync.resolveConventionKind(result.conv)
      : String(result.conv?.id || "").toLowerCase();
    const scaleRenderers = {
      uocra: renderUocraScale,
      farmacia: renderFarmaciaScale,
      camioneros: renderCamionerosScale
    };
    const content = (scaleRenderers[rendererKey] || renderGenericScale)(result);
    return `<div class="scale-compact-view">${source}${content}</div>`;
  }

  function renderConventionSummaryPane(result = null) {
    const target = $("conventionSummary");
    if (!target) return;
    const conv = result?.conv || getConvention();
    if (!conv) {
      target.className = "empty-state";
      target.innerHTML = "Elegi un convenio para ver el resumen tecnico.";
      return;
    }
    target.className = "";
    target.innerHTML = renderConventionSummary(result);
  }

  function summaryArray(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.filter((item) => item !== null && item !== undefined && String(item).trim() !== "");
    return [value];
  }

  function summaryValue(value, fallback = "-") {
    if (value === true) return "Si";
    if (value === false) return "No";
    if (value === null || value === undefined || value === "") return fallback;
    if (typeof value === "number") return Number.isFinite(value) ? value.toLocaleString("es-AR") : fallback;
    if (Array.isArray(value)) return value.length ? value.join(", ") : fallback;
    if (typeof value === "object") {
      const readable = value.label || value.nombre || value.name || value.titulo || value.title || value.descripcion || value.description || value.detalle || value.detail || value.value || value.id;
      return readable ? summaryValue(readable, fallback) : JSON.stringify(value);
