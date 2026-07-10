    });
  }

  async function init() {
    const urlParams = new URLSearchParams(window.location.search);
    const isWidget = urlParams.get("widget") === "true";
    const requestedConvId = urlParams.get("conventionId");

    if (isWidget) {
      document.body.classList.add("widget-mode");
    }

    bindNavigation();
    await loadCatalog();

    const conventionSelect = $("convention");
    conventionSelect.innerHTML = Object.values(DATA.conventions)
      .map((conv) => `<option value="${conv.id}">${escapeHtml(conv.name)}</option>`)
      .join("");
      
    if (requestedConvId && DATA.conventions[requestedConvId]) {
      conventionSelect.value = requestedConvId;
      if (isWidget) {
        conventionSelect.disabled = true;
        setTimeout(() => {
          goToStep(2);
        }, 50);
      }
    } else {
      conventionSelect.value = firstConventionId();
      if (isWidget) {
        setTimeout(() => {
          goToStep(2);
        }, 50);
      }
    }

    $("payrollForm").addEventListener("input", () => {
      markDirty();
    });
    $("payrollForm").addEventListener("change", (event) => {
      if (event.target.id === "convention") updateConvention();
      else {
        if (event.target.id === "category") {
          refreshPayrollModalityOptions();
          renderDynamicFields(getConvention());
        }
        if (event.target.id === "period") {
          const period = $("scalePeriod");
          if (period) period.value = selectedPeriodMonth();
          refreshActiveScaleContext();
        }
        if (event.target.id === "zone") refreshPayrollModalityOptions();
        markDirty();
      }
    });

    document.querySelectorAll(".wizard-step-btn").forEach((button) => {
      button.addEventListener("click", () => {
        const target = Number(button.dataset.step);
        // Allow clicking only on current, past, or next step
        if (target <= maxReachedStep || target === currentStep + 1) {
          goToStep(target);
        }
      });
    });

    $("prevStepBtn").addEventListener("click", () => goToStep(currentStep - 1));
    $("nextStepBtn").addEventListener("click", () => goToStep(currentStep + 1));

    // Actualizar boton Siguiente dinamicamente al escribir en campos del paso 2
    ["entryDate"].forEach((id) => {
      const el = $(id);
      if (el) {
        el.addEventListener("input", () => { if (currentStep === 2) renderWizard(); });
        el.addEventListener("change", () => { if (currentStep === 2) renderWizard(); });
      }
    });
    $("liquidateBtn").addEventListener("click", () => {
      const btn = $("liquidateBtn");
      const originalText = btn.textContent;
      btn.textContent = "Calculando...";
      btn.disabled = true;
      setTimeout(async () => {
        await refreshActiveScaleContext();
        await calculate();
        btn.textContent = originalText;
        btn.disabled = false;
        goToStep(4);
        // Scroll hacia resultados
        document.querySelector(".results")?.scrollIntoView({ behavior: "smooth", block: "start" });
        // Activar pestaña Recibo
        activateTab("receipt");
      }, 50);
    });

    document.querySelectorAll(".tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        activateTab(tab.dataset.tab);
      });
    });

    document.querySelectorAll("[data-receipt-highlight]").forEach((metric) => {
      const run = () => highlightReceiptSection(metric.dataset.receiptHighlight);
      metric.addEventListener("click", run);
      metric.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          run();
        }
      });
    });

    const printBtn = $("printBtn");
    const exportBtn = $("exportBtn");
    const saveBtn = $("saveBtn");
    const auditBtn = $("auditBtn");
    if (printBtn) printBtn.addEventListener("click", () => window.print());
    if (exportBtn) exportBtn.addEventListener("click", exportJson);
    if (saveBtn) saveBtn.addEventListener("click", saveLiquidation);
    if (auditBtn) auditBtn.addEventListener("click", runLiquidationAudit);
    setupScaleDashboard();
    setupConventionBuilder();
    setupLeia();
    setActionButtonsEnabled(false);
    updateConvention();
    goToStep(1);
    activateTab(isWidget ? "receipt" : "audit");
  }

  function exportJson() {
    if (!lastResult) return;
    const payload = {
      generatedAt: new Date().toISOString(),
      convention: lastResult.conv.name,
      period: lastResult.period,
      employee: lastResult.employee,
      category: lastResult.category.label,
      zone: lastResult.zone.label,
      totals: lastResult.totals,
      remunerative: lastResult.remRows,
      nonRemunerative: lastResult.noRemRows,
      deductions: lastResult.deductionRows,
      employer: lastResult.employerRows,
      audit: lastAudit
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `liquidacion-${lastResult.conv.id}-${lastResult.period}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function saveLiquidation() {
    if (!lastResult) return;

    const button = $("saveBtn");
    if (!button) return;
    const originalText = button.textContent;
    button.textContent = "Guardando";
    button.disabled = true;

    const payload = {
      convention: lastResult.conv.id,
      conventionName: lastResult.conv.name,
      period: lastResult.period,
      employee: lastResult.employee,
      category: lastResult.category.label,
      zone: lastResult.zone.label,
      totals: lastResult.totals,
      remunerative: lastResult.remRows,
      nonRemunerative: lastResult.noRemRows,
      deductions: lastResult.deductionRows,
      employer: lastResult.employerRows,
      details: lastResult.details,
      audit: lastAudit
    };

    try {
      const response = await fetch(apiUrl("/api/liquidations"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const saved = await response.json();
      button.textContent = `Guardado ${saved.id.slice(-6)}`;
      setTimeout(() => {
        button.textContent = originalText;
      }, 2500);
    } catch (error) {
      alert("No se pudo guardar en MongoDB. Verifica que el backend este iniciado en http://localhost:4100.");
      button.textContent = originalText;
    } finally {
      button.disabled = false;
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
