    );
    container.innerHTML = visibleConventions
      .map((conv) => {
        const meta = conventionCardMeta(conv);
        const active = conv.id === activeId ? " active" : "";
        const accent = conventionAccent(conv.id);
        const periodCount = conv.periods?.length || 0;
        const categoryCount = conv.categories?.length || 0;
        return `<article class="convention-card${active}" role="button" tabindex="0" data-convention-id="${escapeHtml(conv.id)}" aria-pressed="${conv.id === activeId}" style="--card-accent:${accent.strong};--card-accent-soft:${accent.soft};--card-ink:${accent.ink};">
          <div class="convention-ghost" aria-hidden="true">${conventionIcon(conv.id, "convention-ghost-icon")}</div>
          <div class="convention-content">
            <div class="convention-visual">
              <span class="convention-mark" aria-hidden="true">${conventionIcon(conv.id, "convention-icon")}</span>
              <span class="selection-check" aria-hidden="true"></span>
              <button class="convention-edit-btn" type="button" data-edit-convention-id="${escapeHtml(conv.id)}" aria-label="Editar convenio ${escapeHtml(meta.title)}">✎</button>
              <button class="convention-delete-btn" type="button" data-delete-convention-id="${escapeHtml(conv.id)}" aria-label="Eliminar convenio ${escapeHtml(meta.title)}" style="position: absolute; right: 54px; top: 7px; width: 20px; height: 20px; min-width: 20px; min-height: 20px; box-sizing: border-box; overflow: hidden; display: inline-flex; align-items: center; justify-content: center; border: 1px solid rgba(239, 68, 68, 0.35); border-radius: 50%; background: #fff; color: #ef4444; font-size: 11px; line-height: 1; padding: 0; margin: 0; cursor: pointer; z-index: 3;" title="Eliminar convenio">🗑</button>
            </div>
            <h3 class="convention-title">${escapeHtml(meta.title)}</h3>
            <div class="convention-code">${escapeHtml(meta.code)}</div>
            <div class="convention-meta">
              <span>${escapeHtml(plural(periodCount, "periodo", "periodos"))}</span>
              <span>${escapeHtml(plural(categoryCount, "categoria", "categorias"))}</span>
            </div>
          </div>
        </article>`;
      })
      .join("");

    let pager = $("conventionPager");
    if (!pager) {
      pager = document.createElement("div");
      pager.id = "conventionPager";
      pager.className = "convention-pager";
      container.insertAdjacentElement("afterend", pager);
    }
    pager.innerHTML = totalPages > 1 ? `
      <button type="button" data-convention-page="prev" ${conventionPage === 0 ? "disabled" : ""}>Anterior</button>
      <span>${conventionPage + 1} / ${totalPages}</span>
      <button type="button" data-convention-page="next" ${conventionPage === totalPages - 1 ? "disabled" : ""}>Siguiente</button>
    ` : "";
    pager.onclick = (e) => {
      const button = e.target.closest("[data-convention-page]");
      if (!button) return;
      conventionPage += button.dataset.conventionPage === "next" ? 1 : -1;
      renderConventionCards();
    };

    // Usar delegación de eventos para evitar re-registro en cada updateConvention()
    container.onclick = (e) => {
      const deleteButton = e.target.closest("[data-delete-convention-id]");
      if (deleteButton) {
        e.preventDefault();
        e.stopPropagation();
        deleteConvention(deleteButton.dataset.deleteConventionId);
        return;
      }
      const editButton = e.target.closest("[data-edit-convention-id]");
      if (editButton) {
        e.preventDefault();
        e.stopPropagation();
        openConventionEditorFromCard(editButton.dataset.editConventionId);
        return;
      }
      const card = e.target.closest(".convention-card");
      if (card) {
        e.preventDefault();
        chooseConvention(card.dataset.conventionId);
      }
    };
    container.onkeydown = (e) => {
      if (e.target.closest("[data-delete-convention-id]")) return;
      if (e.key === "Enter" || e.key === " ") {
        const card = e.target.closest(".convention-card");
        if (card) {
          e.preventDefault();
          chooseConvention(card.dataset.conventionId);
        }
      }
    };
  }

  async function deleteConvention(id) {
    const conv = DATA.conventions[id];
    if (!conv) return;
    const name = conv.shortName || conv.name || id;
    const confirmed = window.confirm(`¿Seguro que queres borrar el convenio "${name}"?\n\nSe eliminara del listado y tambien se borraran sus escalas cargadas. Esta accion no borra empleados ni liquidaciones historicas.`);
    if (!confirmed) return;
    const finalConfirmed = window.confirm(`Confirmacion final:\n\n¿Borrar definitivamente "${name}" y sus escalas asociadas?`);
    if (!finalConfirmed) return;

    try {
      await fetchJson(`/api/conventions/${encodeURIComponent(id)}`, { method: "DELETE" });
      await loadCatalog();
      const currentId = str("convention");
      const fallbackId = firstConventionId();
      updateConventionSelectsAfterCatalogReload(currentId === id ? fallbackId : currentId);
      renderConventionCards();
      syncScaleConvention();
      await refreshActiveScaleContext();
      if ($("scaleConvention")) await loadScaleDashboard();
    } catch (error) {
      window.alert(`No se pudo borrar el convenio: ${error.message}`);
    }
  }

  function chooseConvention(id) {
    const conventionSelect = $("convention");
    if (conventionSelect) {
      conventionSelect.value = id;
      updateConvention();
      // Allow moving to step 2 when choosing convention
      maxReachedStep = Math.max(maxReachedStep, 2);
      goToStep(2);
    }
  }

  function periodLabel(conv) {
    return conv.periods.find((item) => item.id === getPeriod(conv))?.label || getPeriod(conv);
  }

  function renderWizard() {
    const form = $("payrollForm");
    if (form) form.dataset.currentStep = String(currentStep);
    const steps = document.querySelectorAll(".form-step");
    steps.forEach((step) => {
      const stepNum = Number(step.dataset.step);
      if (stepNum === currentStep) {
        step.classList.add("active");
        step.style.display = "block";
      } else {
        step.classList.remove("active");
        step.style.display = "none";
      }
    });

    document.querySelectorAll(".wizard-step-btn").forEach((button) => {
      const step = Number(button.dataset.step);
      button.classList.toggle("active", step === currentStep);
      button.classList.toggle("done", step < currentStep);
      // Steps beyond maxReached+1 are visually disabled
      button.classList.toggle("unreachable", step > maxReachedStep && step > currentStep + 1);
    });

    const isWidget = document.body.classList.contains("widget-mode");
    $("prevStepBtn").disabled = currentStep === 1 || (isWidget && currentStep === 2);
    const nextBtn = $("nextStepBtn");
    nextBtn.style.display = currentStep === TOTAL_STEPS ? "none" : "inline-flex";
    // Disable Next based on step:
    // - Step 1: require a convention to be selected
    // - Step 2: require worker data to be filled
    if (currentStep === 1) {
      nextBtn.disabled = !isStep1Valid();
    } else if (currentStep === 2) {
      nextBtn.disabled = !isStep2Valid();
    } else {
      nextBtn.disabled = false;
    }
    $("stepStatus").textContent = `Paso ${currentStep} de ${TOTAL_STEPS}`;
    renderReview();
    syncLeiaContext();
  }

  // Track the highest step the user has legitimately reached
  let maxReachedStep = 1;

  function isStep1Valid() {
    return str("convention", "").trim().length > 0;
  }

  function isStep2Valid() {
    const entry = str("entryDate", "").trim();
    return entry.length > 0;
  }

  function showStep2Error() {
    const errorEl = document.getElementById("step2ValidationError");
    if (errorEl) errorEl.classList.add("visible");
    ["entryDate"].forEach((id) => {
      const el = $(id);
      if (el && !el.value.trim()) {
        el.classList.add("field-error");
        el.addEventListener("input", function onInput() {
          if (id !== "entryDate" || readDateInput("entryDate")) el.classList.remove("field-error");
          if (isStep2Valid()) {
            const err = document.getElementById("step2ValidationError");
            if (err) err.classList.remove("visible");
          }
          el.removeEventListener("input", onInput);
        });
      }
    });
  }

  function clearStep2ErrorIfValid() {
    if (!isStep2Valid()) return;
    const err = document.getElementById("step2ValidationError");
    if (err) err.classList.remove("visible");
    ["employeeName", "employeeCuil", "entryDate"].forEach((id) => $(id)?.classList.remove("field-error"));
  }

  function goToStep(step) {
    const target = Math.min(TOTAL_STEPS, Math.max(1, step));
    // Validar paso 1 antes de avanzar al paso 2 o posterior
    if (target >= 2 && currentStep === 1 && !isStep1Valid()) {
      return;
    }
    // Validar paso 2 antes de avanzar al paso 3 o posterior
    if (target >= 3 && currentStep === 2 && !isStep2Valid()) {
      showStep2Error();
      return;
    }
    // Only allow going to steps already visited (backward) or one step forward
    if (target <= maxReachedStep || target === currentStep + 1) {
      currentStep = target;
      maxReachedStep = Math.max(maxReachedStep, currentStep);
      renderWizard();
    }
  }

  function setActionButtonsEnabled(enabled) {
    ["saveBtn", "exportBtn", "printBtn", "auditBtn"].forEach((id) => {
      const button = $(id);
      if (button) button.disabled = !enabled;
    });
  }

  function renderMetrics(totals = {}) {
    $("metricRem").textContent = fmt(totals.remTotal || 0);
    $("metricNoRem").textContent = fmt(totals.noRemTotal || 0);
    $("metricDed").textContent = fmt(totals.deductions || 0);
    $("metricNet").textContent = fmt(totals.net || 0);
  }

  function clearReceiptHighlights() {
    document.querySelectorAll(".receipt-highlight-active, .metric-highlight-active").forEach((item) => {
      item.classList.remove("receipt-highlight-active", "metric-highlight-active");
    });
  }

  function highlightReceiptSection(section) {
    if (!lastResult) return;
    const target = document.querySelector(`[data-receipt-section="${section}"]`);
    if (!target) return;
    clearReceiptHighlights();
    document.querySelector(`[data-receipt-highlight="${section}"]`)?.classList.add("metric-highlight-active");
    activateTab("receipt");
    target.classList.add("receipt-highlight-active");
    target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    window.setTimeout(() => {
      target.classList.remove("receipt-highlight-active");
      document.querySelector(`[data-receipt-highlight="${section}"]`)?.classList.remove("metric-highlight-active");
    }, 2600);
  }

  function resetMetrics() {
    renderMetrics();
  }

  function auditEmptyHtml(isReady = false) {
    return `<div class="audit-empty">
      <div class="audit-empty-visual" aria-hidden="true">⌕</div>
      <h3>${isReady ? "Auditor&iacute;a pendiente." : "No se pudo auditar la liquidaci&oacute;n."}</h3>
      <p>${isReady ? "Ejecut&aacute; la auditor&iacute;a con leIA para controlar totales, escala vigente, datos faltantes y riesgos del convenio." : "Ejecut&aacute; la auditor&iacute;a con leIA para detectar inconsistencias y validar el c&aacute;lculo autom&aacute;ticamente."}</p>
      <button class="primary-action audit-inline-action" type="button" data-run-audit ${lastResult ? "" : "disabled"}>Auditar con leIA &#10024;</button>
    </div>`;
  }

  function renderPendingState() {
    lastResult = null;
    lastAudit = null;
    resetMetrics();
    setActionButtonsEnabled(false);
    $("receipt").className = "empty-state";
    $("calculation").className = "empty-state";
    $("details").className = "empty-state";
    $("scales").className = "empty-state";
    $("auditResult").className = "";
    $("receipt").innerHTML = "Completa los pasos y presiona Liquidar para generar el recibo.";
    $("calculation").innerHTML = "El calculo aparecera despues de liquidar.";
    $("details").innerHTML = "El detalle aparecera despues de liquidar.";
    $("scales").innerHTML = "Las escalas se muestran con la liquidacion emitida.";
    renderConventionSummaryPane();
    $("auditResult").innerHTML = auditEmptyHtml(false);
  }

  function markDirty() {
    renderPendingState();
    renderReview();
  }

  function renderReview() {
    const box = $("reviewBox");
    if (!box) return;
    const conv = getConvention();
    const category = getCategory(conv);
    const zone = getZone(conv);
    const entryDate = str("entryDate", "-") || "-";
    const years = yearsFromEntry();
    const period = periodLabel(conv);

    box.innerHTML = `<div class="review-grid">
      <div><span>Convenio</span><strong>${escapeHtml(conv.name)}</strong></div>
      <div><span>Periodo</span><strong>${escapeHtml(period)}</strong></div>
      <div><span>Categoria</span><strong>${escapeHtml(category.label)}</strong></div>
      <div><span>Zona</span><strong>${escapeHtml(zone.label)}</strong></div>
      <div><span>Fecha de ingreso</span><strong>${escapeHtml(entryDate)}</strong></div>
      <div><span>Antiguedad</span><strong>${years === 0 ? "Menos de 1 año" : years + (years === 1 ? " año" : " años")}</strong></div>
    </div>
    <div class="review-note">Revisá los datos antes de liquidar. El recibo se genera al presionar el botón.</div>`;
  }

  function rowHtml(row, negative = false) {
    const isNegativeRow = row.amount < 0;
    const isNegativeStyles = negative || isNegativeRow;
    const displayAmount = (negative ? "" : (isNegativeRow ? "- " : "")) + fmt(Math.abs(row.amount));
    return `<div class="line ${isNegativeStyles ? "negative" : ""}">
      <div>${escapeHtml(row.label)}${row.detail ? `<small>${escapeHtml(row.detail)}</small>` : ""}</div>
      <div class="amount">${displayAmount}</div>
    </div>`;
  }

  function tableRows(rows) {
    if (!rows.length) return `<div class="empty">Sin conceptos para mostrar.</div>`;
    return `<table><colgroup><col style="width:38%"><col style="width:37%"><col style="width:25%"></colgroup><thead><tr><th>Concepto</th><th>Detalle</th><th class="num">Monto</th></tr></thead><tbody>
      ${rows.map((row) => `<tr><td>${escapeHtml(row.label)}</td><td><small>${escapeHtml(row.detail || "")}</small></td><td class="num">${fmt(row.amount)}</td></tr>`).join("")}
    </tbody></table>`;
  }

  function calculationRows(rows) {
    if (!rows.length) return `<div class="empty">Sin calculos para mostrar.</div>`;
    return `<table><colgroup><col style="width:34%"><col style="width:41%"><col style="width:25%"></colgroup><thead><tr><th>Concepto</th><th>Cuenta</th><th class="num">Resultado</th></tr></thead><tbody>
      ${rows.map((row) => `<tr><td>${escapeHtml(row.label)}</td><td><small>${escapeHtml(row.formula || row.detail || "Importe informado")}</small></td><td class="num">${fmt(row.amount)}</td></tr>`).join("")}
    </tbody></table>`;
  }

  function renderCalculation(result) {
    const rows = [
      ...(result.remRows || []),
      ...(result.noRemRows || []),
      ...(result.deductionRows || [])
    ];
    if (!rows.length) return `<div class="empty-state">Sin calculos para mostrar.</div>`;
    return `<div class="calculation-view">
      <div class="summary-table-wrap">
        <table class="summary-table calculation-table">
          <thead><tr><th>Haber</th><th>Calculo interno</th><th class="num">Resultado</th></tr></thead>
          <tbody>
            ${rows.map((row) => `<tr>
              <td>${escapeHtml(row.label)}</td>
              <td>${escapeHtml(calculationExplanation(row, result))}</td>
              <td class="num">${fmt(row.amount)}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>`;
  }

  function calculationExplanation(row = {}, result = {}) {
    const formula = String(row.formula || "").trim();
    const detail = String(row.detail || "").trim();
    if (isMathExpression(formula)) return formula;
    return mathExpressionFromText(formula || detail) || inferInternalFormula(row, result) || `${calcNum(row.amount)} x 1`;
  }

  function isMathExpression(value = "") {
    const text = String(value).trim();
    return /\d/.test(text) && /^[\d\s.,()+\-*/xX]+$/.test(text);
  }

  function normalizeCalcToken(value = "") {
    return String(value).replace(/\$/g, "").replace(/\./g, "").trim();
  }

  function parseCalcNumber(value = "") {
    if (typeof value === "number") return value;
    const strVal = String(value || "").trim();
    if (!strVal) return 0;
    
    const hasComma = strVal.includes(",");
    const hasDot = strVal.includes(".");
    
    let normalized = strVal;
    if (hasComma && hasDot) {
      if (strVal.lastIndexOf(",") > strVal.lastIndexOf(".")) {
        // 1.234,56 -> 1234.56
        normalized = strVal.replace(/\./g, "").replace(",", ".");
      } else {
        // 1,234.56 -> 1234.56
        normalized = strVal.replace(/,/g, "");
      }
    } else if (hasComma) {
      // 1234,56 -> 1234.56
      normalized = strVal.replace(",", ".");
    }
    
    const parsed = Number(normalized);
    return isNaN(parsed) ? 0 : parsed;
  }

  function mathExpressionFromText(value = "") {
    const text = String(value || "");
    let match = text.match(/([\d.,]+)\s*%\s*de\s*\$?\s*([\d.,]+)/i);
    if (match) return `${normalizeCalcToken(match[2])} x ${normalizeCalcToken(match[1])} / 100`;
    match = text.match(/\$?\s*([\d.,]+)\s*\/\s*(?:dia|d[ií]a|hora|hs|jornal|km)\s*x\s*([\d.,]+)/i);
    if (match) return `${normalizeCalcToken(match[1])} x ${normalizeCalcToken(match[2])}`;
    match = text.match(/([\d.,]+)\s*(?:dias|d[ií]as|jornales|horas|hs|km)\s*x\s*\$?\s*([\d.,]+)(?:\s*x\s*([\d.,]+))?/i);
    if (match) return [match[2], match[1], match[3]].filter(Boolean).map(normalizeCalcToken).join(" x ");
    return "";
  }

  function inferInternalFormula(row = {}, result = {}) {
    const label = summaryKey(row.label || "");
    const text = `${row.label || ""} ${row.detail || ""}`;
    const amount = Math.abs(Number(row.amount || 0));
    const pctMatch = text.match(/([\d.,]+)\s*%/);
    const pct = pctMatch ? parseCalcNumber(pctMatch[1]) : null;
    if (pct && pct > 0) return `${calcNum(amount * 100 / pct)} x ${calcNum(pct)} / 100`;

    const hour50 = firstFinite(num("genExtra50", 0), num("farmExtra50", 0), num("camExtra50", 0), num("uocraExtra50", 0)) || 0;
    const hour100 = firstFinite(num("genExtra100", 0), num("farmExtra100", 0), num("camExtra100", 0), num("uocraExtra100", 0)) || 0;
    if (label.includes("horas_extra_50") && hour50 > 0) return `${calcNum(amount / hour50 / 1.5)} x ${calcNum(hour50)} x 1,5`;
    if (label.includes("horas_extra_100") && hour100 > 0) return `${calcNum(amount / hour100 / 2)} x ${calcNum(hour100)} x 2`;

    const unitMatch = text.match(/([\d.,]+)\s*(?:jornales|dias|d[ií]as|horas|hs|km)\b/i);
    const units = unitMatch ? parseCalcNumber(unitMatch[1]) : null;
    if (units && units > 0) return `${calcNum(amount / units)} x ${calcNum(units)}`;

    if (label.includes("basico")) {
      const workingDays = firstFinite(num("camWorkingDays", 0), num("genWorkUnits", 0), num("farmWorkingDays", 0)) || 1;
      return `${calcNum(amount / workingDays)} x ${calcNum(workingDays)}`;
    }
    if (label.includes("comida") || label.includes("viatico")) {
      const days = firstFinite(num("camNoRemDays", 0), num("camWorkingDays", 0), num("farmNoRemDays", 0)) || 1;
      return `${calcNum(amount / days)} x ${calcNum(days)}`;
    }
    if (label.includes("antiguedad")) {
      const years = Math.max(1, yearsFromEntry());
      return `${calcNum(amount * 100 / years)} x ${calcNum(years)} / 100`;
    }
    if (label.includes("jubilacion") || label.includes("pami") || label.includes("obra_social")) {
      const percent = label.includes("jubilacion") ? 11 : 3;
      return `${calcNum(amount * 100 / percent)} x ${percent} / 100`;
    }
    return "";
  }

  function calculateGanancias(remunerative) {
    if (!on("estimateGanancias")) return 0;
    const c = DATA.constants;
    const annual = remunerative * 13;
    const deductions = c.gananciasDedEspecialAnual + c.gananciasMniAnual;
    const taxable = annual - deductions;
    if (taxable <= 0) return 0;
    let tax = 0;
    c.gananciasScale.forEach((step) => {
      if (taxable > step.from) {
        tax = step.fixed + (Math.min(taxable, step.to) - step.from) * step.pct;
      }
    });
    return Math.max(0, tax / 13);
  }

  function addCommonManualRows(remRows, noRemRows, deductionRows) {
    addRow(remRows, "Otros remunerativos", num("otherRem", 0), "Carga manual", calcNum(num("otherRem", 0)));
    addRow(noRemRows, "Otros no remunerativos", num("otherNoRem", 0), "Carga manual", calcNum(num("otherNoRem", 0)));
    addRow(deductionRows, "Descuentos varios", num("otherDeductions", 0), "Carga manual", calcNum(num("otherDeductions", 0)));
  }

  function isExtraHoursConcept(concept = {}) {
    const key = summaryKey(`${concept.id || ""} ${concept.label || ""} ${concept.name || ""} ${concept.nombre || ""}`);
    const isHours = key.includes("horas_extra") || key.includes("hs_extra") || key.includes("hora_extra");
    return isHours && /(^|_)(50|100)(_|$)/.test(key);
  }

  function isSystemPayrollConcept(item = {}) {
