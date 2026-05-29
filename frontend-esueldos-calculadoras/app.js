(function () {
  let DATA = window.PAYROLL_DATA;
  let dataOrigin = "local";
  const API_BASE = getApiBase();
  const $ = (id) => document.getElementById(id);
  const money = new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  let lastResult = null;
  let lastAudit = null;
  let currentStep = 1;
  const TOTAL_STEPS = 4;
  const leiaHistory = [];
  const leiaGuidedTopics = [
    {
      id: "scales",
      label: "Escalas salariales",
      detail: "Basicos, jornales, no remunerativos y escala aprobada vigente."
    },
    {
      id: "categories",
      label: "Categorias",
      detail: "Listado de categorias del convenio con sus valores de referencia."
    },
    {
      id: "additionals",
      label: "Adicionales",
      detail: "Conceptos, pluses, viaticos e items parametrizados."
    },
    {
      id: "zones",
      label: "Zonas",
      detail: "Ambitos, zonas y coeficientes aplicables."
    },
    {
      id: "deductions",
      label: "Aportes y descuentos",
      detail: "Aportes generales y propios del convenio."
    },
    {
      id: "rules",
      label: "Reglas de liquidacion",
      detail: "Divisores, jornada, presentismo, antiguedad y controles."
    }
  ];
  const scaleState = {
    recent: [],
    months: [],
    selected: null,
    activeScale: null,
    activeForPayroll: null
  };
  const conventionBuilderState = {
    drafts: [],
    selected: null
  };

  function getApiBase() {
    if (typeof window.ESUELDOS_API_URL === "string") {
      return window.ESUELDOS_API_URL.replace(/\/$/, "");
    }
    if (window.location.protocol === "file:") {
      return "http://localhost:4100";
    }
    if (["localhost", "127.0.0.1"].includes(window.location.hostname) && window.location.port !== "4100") {
      return `${window.location.protocol}//${window.location.hostname}:4100`;
    }
    return "";
  }

  function apiUrl(path) {
    return `${API_BASE}${path}`;
  }

  async function fetchCatalog() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    try {
      return await fetch(apiUrl("/api/catalog"), {
        cache: "no-store",
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  function fmt(value) {
    return money.format(Number.isFinite(value) ? value : 0);
  }

  function num(id, fallback = 0) {
    const el = $(id);
    if (!el) return fallback;
    const value = Number(String(el.value).replace(",", "."));
    return Number.isFinite(value) ? value : fallback;
  }

  function str(id, fallback = "") {
    const el = $(id);
    return el ? el.value : fallback;
  }

  function on(id) {
    const el = $(id);
    return !!(el && el.checked);
  }

  function checked(id, fallback = false) {
    const el = $(id);
    return el ? !!el.checked : fallback;
  }

  function round2(value) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  function addRow(list, label, amount, detail = "") {
    if (!Number.isFinite(amount) || Math.abs(amount) < 0.005) return;
    list.push({ label, amount: round2(amount), detail });
  }

  function sumRows(rows) {
    return rows.reduce((total, row) => total + row.amount, 0);
  }

  function yearsFromEntry() {
    const raw = str("entryDate");
    if (!raw) return 0;
    const start = new Date(`${raw}T00:00:00`);
    const today = new Date();
    let years = today.getFullYear() - start.getFullYear();
    const month = today.getMonth() - start.getMonth();
    if (month < 0 || (month === 0 && today.getDate() < start.getDate())) years -= 1;
    return Math.max(0, years);
  }

  async function loadCatalog() {
    try {
      const response = await fetchCatalog();
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const catalog = await response.json();
      if (!catalog || !catalog.constants || !catalog.conventions) {
        throw new Error("Respuesta de catalogo invalida");
      }
      DATA = catalog;
      window.PAYROLL_DATA = catalog;
      dataOrigin = "mongodb";
      return true;
    } catch (error) {
      dataOrigin = "local";
      return false;
    }
  }

  function getConvention() {
    return DATA.conventions[str("convention", "camioneros")] || DATA.conventions.camioneros || DATA.conventions.uocra;
  }

  function getPeriod(conv) {
    return str("period", conv.periods[0].id);
  }

  function getZone(conv) {
    return conv.zones.find((zone) => zone.id === str("zone")) || conv.zones[0];
  }

  function getCategory(conv) {
    return conv.categories.find((cat) => cat.id === str("category")) || conv.categories[0];
  }

  function setOptions(select, options, current) {
    select.innerHTML = options
      .map((option) => `<option value="${option.id}">${escapeHtml(option.label)}</option>`)
      .join("");
    const hasCurrent = options.some((option) => option.id === current);
    select.value = hasCurrent ? current : options[0]?.id || "";
  }

  function getCurrentPeriodId() {
    const today = new Date();
    const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
    const month = months[today.getMonth()];
    const year = today.getFullYear().toString().slice(-2);
    return month + year;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function periodIdToMonth(periodId) {
    const match = String(periodId || "").toLowerCase().match(/^(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)(\d{2})$/);
    if (!match) return null;
    const months = { ene: "01", feb: "02", mar: "03", abr: "04", may: "05", jun: "06", jul: "07", ago: "08", sep: "09", oct: "10", nov: "11", dic: "12" };
    return `20${match[2]}-${months[match[1]]}`;
  }

  function currentMonthValue() {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  }

  function selectedPeriodMonth(conv = getConvention()) {
    return periodIdToMonth(getPeriod(conv)) || currentMonthValue();
  }

  function monthLabel(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})$/);
    if (!match) return value || "";
    const names = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    return `${names[Number(match[2]) - 1] || match[2]} ${match[1]}`;
  }

  function statusLabel(status) {
    const labels = {
      PENDIENTE_REVISION: "Pendiente",
      APROBADA: "Aprobada",
      RECHAZADA: "Rechazada"
    };
    return labels[status] || status || "-";
  }

  function shortDate(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  function conventionCardMeta(conv) {
    const cardCopy = {
      uocra: {
        title: "UOCRA",
        code: "CCT 76/75",
        description: "Construccion. Jornales por zona, categorias operarias, sereno mensual, presentismo, SNR, adicionales y horas extra."
      },
      farmacia: {
        title: "Farmacia Mendoza",
        code: "CCT 429/05",
        description: "Farmacias de Mendoza. Escala normalizada por categoria, no remunerativos por periodo, antiguedad, titulo, adscripcion y bloqueo."
      },
      camioneros: {
        title: "Camioneros",
        code: "CCT 40/89",
        description: "Transporte automotor de cargas. Basicos mayo 2026, coeficientes zonales, antiguedad sin tope (1%/año). Comida, viatico, pernoctada y km: NO remunerativos (Art. 4.2.11)."
      }
    };

    return cardCopy[conv.id] || {
      title: conv.shortName || conv.name,
      code: conv.name,
      description: conv.source || "Convenio disponible para liquidacion."
    };
  }

  function conventionAccent(id) {
    const accents = {
      uocra: { strong: "#2458ff", soft: "#edf4ff", ink: "#183a98" },
      farmacia: { strong: "#008762", soft: "#e9fbf4", ink: "#005f48" },
      camioneros: { strong: "#d16d00", soft: "#fff3df", ink: "#824000" }
    };
    return accents[id] || { strong: "#2458ff", soft: "#edf4ff", ink: "#183a98" };
  }

  function plural(count, singular, pluralValue) {
    return `${count} ${count === 1 ? singular : pluralValue}`;
  }

  function conventionIcon(id, className) {
    const attrs = `class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`;
    const icons = {
      uocra: `<svg ${attrs}>
        <path d="M4 15h16" />
        <path d="M6 15v-3a6 6 0 0 1 12 0v3" />
        <path d="M9 15V9" />
        <path d="M15 15V9" />
        <path d="M3 18h18" />
        <path d="M7 18l1.2 2h7.6L17 18" />
      </svg>`,
      farmacia: `<svg ${attrs}>
        <path d="M6 3v5a5 5 0 0 0 10 0V3" />
        <path d="M6 3H4" />
        <path d="M16 3h2" />
        <path d="M11 13v2a5 5 0 0 0 10 0v-2" />
        <circle cx="21" cy="10" r="2" />
      </svg>`,
      camioneros: `<svg ${attrs}>
        <path d="M3 6h11v10H3z" />
        <path d="M14 9h4l3 4v3h-7z" />
        <path d="M5 19a2 2 0 1 0 4 0a2 2 0 0 0-4 0" />
        <path d="M16 19a2 2 0 1 0 4 0a2 2 0 0 0-4 0" />
        <path d="M9 19h7" />
      </svg>`
    };
    return icons[id] || icons.uocra;
  }

  function renderConventionCards() {
    const container = $("conventionCards");
    if (!container) return;

    const activeId = str("convention", "camioneros") || "camioneros";
    container.innerHTML = Object.values(DATA.conventions)
      .map((conv) => {
        const meta = conventionCardMeta(conv);
        const active = conv.id === activeId ? " active" : "";
        const accent = conventionAccent(conv.id);
        const periodCount = conv.periods?.length || 0;
        const categoryCount = conv.categories?.length || 0;
        const zoneCount = conv.zones?.length || 0;
        return `<article class="convention-card${active}" role="button" tabindex="0" data-convention-id="${escapeHtml(conv.id)}" aria-pressed="${conv.id === activeId}" style="--card-accent:${accent.strong};--card-accent-soft:${accent.soft};--card-ink:${accent.ink};">
          <div class="convention-ghost" aria-hidden="true">${conventionIcon(conv.id, "convention-ghost-icon")}</div>
          <div class="convention-content">
            <div class="convention-visual">
              <span class="convention-mark" aria-hidden="true">${conventionIcon(conv.id, "convention-icon")}</span>
              <span class="selection-check" aria-hidden="true"></span>
            </div>
            <h3 class="convention-title">${escapeHtml(meta.title)}</h3>
            <div class="convention-code">${escapeHtml(meta.code)}</div>
            <div class="convention-copy">${escapeHtml(meta.description)}</div>
            <div class="convention-meta">
              <span>${escapeHtml(plural(periodCount, "periodo", "periodos"))}</span>
              <span>${escapeHtml(plural(categoryCount, "categoria", "categorias"))}</span>
              <span>${escapeHtml(plural(zoneCount, "zona", "zonas"))}</span>
            </div>
            <div class="convention-bars" aria-hidden="true">
              <span></span>
              <span></span>
              <span></span>
              <span></span>
            </div>
            <span class="use-btn"><span>Usar este convenio</span><span aria-hidden="true">&gt;</span></span>
            <button class="convention-delete-btn" type="button" data-delete-convention-id="${escapeHtml(conv.id)}" aria-label="Borrar convenio ${escapeHtml(meta.title)}">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 7h16" />
                <path d="M10 11v6" />
                <path d="M14 11v6" />
                <path d="M6 7l1 14h10l1-14" />
                <path d="M9 7V4h6v3" />
              </svg>
              <span>Borrar</span>
            </button>
          </div>
        </article>`;
      })
      .join("");

    // Usar delegación de eventos para evitar re-registro en cada updateConvention()
    container.onclick = (e) => {
      const deleteButton = e.target.closest("[data-delete-convention-id]");
      if (deleteButton) {
        e.preventDefault();
        e.stopPropagation();
        deleteConvention(deleteButton.dataset.deleteConventionId);
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
      const fallbackId = DATA.conventions.camioneros ? "camioneros" : Object.keys(DATA.conventions)[0];
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

    $("prevStepBtn").disabled = currentStep === 1;
    const nextBtn = $("nextStepBtn");
    nextBtn.style.display = currentStep === TOTAL_STEPS ? "none" : "inline-flex";
    // Disable Next if on step 1 and no convention has been actively chosen (maxReached still 1)
    nextBtn.disabled = (currentStep === 1 && maxReachedStep < 2);
    $("stepStatus").textContent = `Paso ${currentStep} de ${TOTAL_STEPS}`;
    renderReview();
    syncLeiaContext();
  }

  // Track the highest step the user has legitimately reached
  let maxReachedStep = 1;

  function goToStep(step) {
    const target = Math.min(TOTAL_STEPS, Math.max(1, step));
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
    $("details").className = "empty-state";
    $("scales").className = "empty-state";
    $("auditResult").className = "";
    $("receipt").innerHTML = "Completa los pasos y presiona Liquidar para generar el recibo.";
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
    const worker = str("employeeName", "Sin nombre") || "Sin nombre";
    const cuil = str("employeeCuil", "-") || "-";
    const entryDate = str("entryDate", "-") || "-";
    const years = yearsFromEntry();
    const period = periodLabel(conv);

    box.innerHTML = `<div class="review-grid">
      <div><span>Convenio</span><strong>${escapeHtml(conv.name)}</strong></div>
      <div><span>Periodo</span><strong>${escapeHtml(period)}</strong></div>
      <div><span>Categoria</span><strong>${escapeHtml(category.label)}</strong></div>
      <div><span>Zona</span><strong>${escapeHtml(zone.label)}</strong></div>
      <div><span>Trabajador</span><strong>${escapeHtml(worker)}</strong></div>
      <div><span>CUIL</span><strong>${escapeHtml(cuil)}</strong></div>
      <div><span>Fecha de ingreso</span><strong>${escapeHtml(entryDate)}</strong></div>
      <div><span>Antiguedad</span><strong>${years === 0 ? "Menos de 1 año" : years + (years === 1 ? " año" : " años")}</strong></div>
    </div>
    <div class="review-note">Revisá los datos antes de liquidar. El recibo se genera al presionar el botón.</div>`;
  }

  function rowHtml(row, negative = false) {
    return `<div class="line ${negative ? "negative" : ""}">
      <div>${escapeHtml(row.label)}${row.detail ? `<small>${escapeHtml(row.detail)}</small>` : ""}</div>
      <div class="amount">${fmt(Math.abs(row.amount))}</div>
    </div>`;
  }

  function tableRows(rows) {
    if (!rows.length) return `<div class="empty">Sin conceptos para mostrar.</div>`;
    return `<table><colgroup><col style="width:38%"><col style="width:37%"><col style="width:25%"></colgroup><thead><tr><th>Concepto</th><th>Detalle</th><th class="num">Monto</th></tr></thead><tbody>
      ${rows.map((row) => `<tr><td>${escapeHtml(row.label)}</td><td><small>${escapeHtml(row.detail || "")}</small></td><td class="num">${fmt(row.amount)}</td></tr>`).join("")}
    </tbody></table>`;
  }

  function calculateGanancias(remunerative, civilStatus) {
    if (!on("estimateGanancias")) return 0;
    const c = DATA.constants;
    const annual = remunerative * 13;
    const deductions = c.gananciasDedEspecialAnual + c.gananciasMniAnual + (civilStatus !== "soltero" ? c.conyugeDedAnual : 0);
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
    addRow(remRows, "Otros remunerativos", num("otherRem", 0), "Carga manual");
    addRow(noRemRows, "Otros no remunerativos", num("otherNoRem", 0), "Carga manual");
    addRow(deductionRows, "Descuentos varios", num("otherDeductions", 0), "Carga manual");
  }

  function applyWorkerDeductions(deductionRows, remTotal, osBase, conv) {
    const c = DATA.constants;
    // Aportes del trabajador se calculan sobre el total remunerativo bruto (sin detracción)
    const baseSS = remTotal;
    addRow(deductionRows, "Jubilacion SIPA 11%", baseSS * c.worker.jubilacion, `11% de ${fmt(baseSS)} (Base SS)`);
    addRow(deductionRows, "Ley 19.032 (PAMI) 3%", baseSS * c.worker.pami, `3% de ${fmt(baseSS)} (Base SS)`);
    addRow(deductionRows, "Obra social 3%", osBase * c.worker.obraSocial, `3% de ${fmt(osBase)} (Base OS)`);

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
        addRow(deductionRows, "Cuota sindical Camioneros 2%", remTotal * 0.02, `2% de ${fmt(remTotal)} (Afiliado)`);
      }
      if (checked("camSolidarityContribution", true)) {
        addRow(deductionRows, "Contribucion solidaria Camioneros 3%", remTotal * 0.03, `3% de ${fmt(remTotal)} (Item 8.1.1)`);
      }
      if (checked("camFuneralInsurance", true)) {
        addRow(deductionRows, "Seguro de Sepelio 1,5%", remTotal * 0.015, `1,5% de ${fmt(remTotal)} (Item 8.1.6)`);
      }
    }

    addRow(deductionRows, "Ganancias 4ta categoria", calculateGanancias(remTotal, str("civilStatus")), "Estimacion anualizada");
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
    const zoneId = normalizeMatchText(zone?.id);
    const zoneLabel = normalizeMatchText(zone?.label);
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
      const rowZone = normalizeMatchText(row.zone);
      return rowZone && ((zoneId && rowZone.includes(zoneId)) || (zoneLabel && rowZone.includes(zoneLabel)));
    });
    return zoneMatch || candidates.find((row) => !row.zone) || candidates[0];
  }

  function scaleCategoryRow(conv, category, zone) {
    const scale = activeScaleFor(conv);
    return scale ? findScaleRow(scale.parsedScale?.categories, category, zone) : null;
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
    if (source.nonRem && typeof source.nonRem === "object") return Number(source.nonRem[period] || 0) || 0;
    if (source.nonRemunerativeByPeriod && typeof source.nonRemunerativeByPeriod === "object") return Number(source.nonRemunerativeByPeriod[period] || 0) || 0;
    return Number(source.nonRemunerative || 0) || 0;
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
    const base = String(concept.base || "basic");
    if (base === "remunerative") return remTotal;
    if (base === "nonRemunerativeScale" || base === "noRemScale") return noRemScale;
    if (base === "categoryMonthly") return categoryMonthly;
    if (base === "categoryDay") return categoryDay;
    if (base === "categoryHourly") return categoryHourly;
    if (base === "seniorityBase") return seniorityBase;
    return basic;
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

  function calcGenericConceptAmount(concept, inputValue, baseValue, period) {
    if (concept.calculation === "fixed") {
      return conceptPeriodAmount(concept, period, ["amountByPeriod", "amountPorPeriodo"], concept.amount) * inputValue;
    }
    if (concept.calculation === "amountPerUnit") {
      return conceptPeriodAmount(concept, period, ["unitAmountByPeriod", "valorUnidadPorPeriodo"], concept.unitAmount || concept.amount) * inputValue;
    }
    return baseValue * ((Number(concept.percent || 0) || 0) / 100) * inputValue;
  }

  function applyGenericDeductions(deductionRows, employerRows, remTotal, noRemTotal, conv) {
    const model = conv.liquidationModel || {};
    const applyItems = (items, targetRows, fallbackDetail) => {
      (items || []).forEach((item) => {
        const baseName = String(item.base || "remunerative");
        const base = baseName === "gross" ? remTotal + noRemTotal : baseName === "nonRemunerative" ? noRemTotal : remTotal;
        const amountValue = Number(item.amount || 0) || base * ((Number(item.percent || 0) || 0) / 100);
        addRow(targetRows, item.label, amountValue, item.detail || fallbackDetail);
      });
    };
    applyItems(model.deductions, deductionRows, "Aporte propio del convenio");
    applyItems(model.employerContributions, employerRows, "Contribucion propia del convenio");
  }

  function calcGenericConvention(conv) {
    const period = getPeriod(conv);
    const cat = getCategory(conv);
    const zone = getZone(conv);
    const activeCatRow = scaleCategoryRow(conv, cat, zone);
    const model = conv.liquidationModel || {};
    const rules = { ...(conv.rules || {}), ...(model.rules || {}) };
    const salaryType = rules.salaryType || conv.type || "monthly";
    const zoneCoef = Number(zone?.coef || 1) || 1;
    const monthPct = Math.max(0, Math.min(100, num("genMonthPct", 100))) / 100;
    const monthDivisor = Number(rules.monthDivisor || 30) || 30;
    const hourDivisor = Number(rules.overtime?.divisor || rules.hourDivisor || 200) || 200;
    const workUnits = Math.max(0, num("genWorkUnits", salaryType === "hourly" ? 0 : monthDivisor));
    const absentDays = Math.max(0, num("genAbsentDays", 0));
    const years = yearsFromEntry();
    const remRows = [];
    const noRemRows = [];
    const deductionRows = [];
    const employerRows = [];
    const details = [];

    const categoryMonthlyRaw = firstFinite(
      activeCatRow?.monthly,
      periodAmountValue(activeCatRow, period, ["monthlyByPeriod", "monthlyByPeriodo", "basicoPorPeriodo"]),
      periodAmountValue(cat, period, ["monthlyByPeriod", "monthlyByPeriodo", "basicoPorPeriodo"]),
      cat.monthly
    );
    const categoryDayRaw = firstFinite(
      activeCatRow?.day,
      periodAmountValue(activeCatRow, period, ["dayByPeriod", "jornalPorPeriodo", "valorDiaPorPeriodo"]),
      periodAmountValue(cat, period, ["dayByPeriod", "jornalPorPeriodo", "valorDiaPorPeriodo"]),
      cat.day
    );
    const categoryHourlyRaw = firstFinite(
      activeCatRow?.hourly,
      periodAmountValue(activeCatRow, period, ["hourlyByPeriod", "horaPorPeriodo", "valorHoraPorPeriodo"]),
      periodAmountValue(cat, period, ["hourlyByPeriod", "horaPorPeriodo", "valorHoraPorPeriodo"]),
      cat.hourly
    );
    const categoryMonthly = (categoryMonthlyRaw || 0) * zoneCoef;
    const categoryDay = (firstFinite(categoryDayRaw, categoryMonthly ? categoryMonthly / monthDivisor : null) || 0) * (activeCatRow?.day || cat.day ? zoneCoef : 1);
    const categoryHourly = (firstFinite(categoryHourlyRaw, categoryDay ? categoryDay / 8 : null, categoryMonthly ? categoryMonthly / hourDivisor : null) || 0) * (activeCatRow?.hourly || cat.hourly ? zoneCoef : 1);
    let basic = 0;
    if (salaryType === "daily") basic = categoryDay * workUnits;
    else if (salaryType === "hourly") basic = categoryHourly * workUnits;
    else basic = categoryMonthly * monthPct;

    addRow(remRows, "Basico", basic, salaryType === "monthly" ? `${monthPct * 100}% del mes` : `${workUnits} ${salaryType === "hourly" ? "horas" : "jornales"}`);

    const absenceDiscount = salaryType === "monthly" ? (basic / monthDivisor) * absentDays : categoryDay * absentDays;
    addRow(remRows, "Inasistencia injustificada", -absenceDiscount, `${absentDays} dia${absentDays !== 1 ? "s" : ""} / divisor ${monthDivisor}`);

    const seniorityRule = rules.seniority || {};
    let seniority = 0;
    if (checked("genSeniority", seniorityRule.enabled !== false)) {
      const yearsForCalc = seniorityRule.capYears ? Math.min(years, Number(seniorityRule.capYears)) : years;
      seniority = basic * ((Number(seniorityRule.percentPerYear || 0) * yearsForCalc) / 100);
      addRow(remRows, "Antiguedad", seniority, `${Number(seniorityRule.percentPerYear || 0)}% x ${yearsForCalc} años`);
    }

    const presentismRule = rules.presentism || {};
    if (checked("genPresentism", presentismRule.enabled && Number(presentismRule.percent || 0) > 0)) {
      const allowed = !presentismRule.requiresNoUnjustifiedAbsence || absentDays === 0;
      if (allowed) addRow(remRows, "Presentismo", (basic + seniority) * ((Number(presentismRule.percent || 0) || 0) / 100), `${presentismRule.percent}%`);
      else addRow(details, "Presentismo", 0, "No corresponde por inasistencias injustificadas");
    }

    const hourValue = (sumRows(remRows) || basic) / hourDivisor;
    addRow(remRows, "Horas extra 50%", hourValue * num("genExtra50", 0) * 1.5, `Base habitual / ${hourDivisor} x 1,5`);
    addRow(remRows, "Horas extra 100%", hourValue * num("genExtra100", 0) * 2, `Base habitual / ${hourDivisor} x 2`);

    const noRemScaleRaw = firstFinite(activeCatRow?.nonRemunerative, periodNonRemValue(cat, period)) || 0;
    const noRemScaleBase = noRemScaleRaw * monthPct * zoneCoef;

    const conceptRows = Array.isArray(model.concepts) ? model.concepts : [];
    conceptRows.forEach((concept) => {
      const inputId = `gen_${concept.id}`;
      const inputValue = concept.inputType === "number" ? Math.max(0, num(inputId, 0)) : (checked(inputId, !!concept.defaultValue) ? 1 : 0);
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
      const amountValue = calcGenericConceptAmount(concept, inputValue, baseValue, period);
      const target = concept.rowType === "nonRemunerative" ? noRemRows : concept.rowType === "deduction" ? deductionRows : remRows;
      addRow(target, concept.label, amountValue, concept.detail || concept.group || "Concepto del convenio");
    });

    if (checked("genNonRemScale", rules.nonRemunerativeScale?.enabled !== false)) {
      addRow(noRemRows, "Suma no remunerativa escala", noRemScaleBase, activeScaleDetail(conv));
      const noRemRule = rules.nonRemunerativeScale || {};
      const noRemSeniorityPct = Number(noRemRule.seniorityPercentPerYear || 0) || 0;
      const noRemPresentismPct = Number(noRemRule.presentismPercent || 0) || 0;
      const noRemSeniority = checked("genSeniority", seniorityRule.enabled !== false) ? noRemScaleBase * ((noRemSeniorityPct * years) / 100) : 0;
      if (noRemSeniority) addRow(noRemRows, "Antiguedad no remunerativa", noRemSeniority, `${noRemSeniorityPct}% x ${years} años`);
      const allowNoRemPresentism = !noRemRule.presentismRequiresNoUnjustifiedAbsence || absentDays === 0;
      if (checked("genPresentism", presentismRule.enabled && noRemPresentismPct > 0) && allowNoRemPresentism) {
        addRow(noRemRows, "Presentismo no remunerativo", (noRemScaleBase + noRemSeniority) * (noRemPresentismPct / 100), `${noRemPresentismPct}%`);
      }
    }

    addCommonManualRows(remRows, noRemRows, deductionRows);
    const remTotal = sumRows(remRows);
    const noRemTotal = sumRows(noRemRows);
    const osBase = remTotal + noRemTotal;
    applyWorkerDeductions(deductionRows, remTotal, osBase, conv);
    applyGenericDeductions(deductionRows, employerRows, remTotal, noRemTotal, conv);
    applyEmployerContribs(employerRows, remTotal, osBase, conv, basic);

    addRow(details, "Basico de escala", categoryMonthly || categoryDay || categoryHourly, activeScaleDetail(conv));
    addRow(details, "Tipo de liquidacion", 0, salaryType);
    addRow(details, "Divisor horas extra", hourDivisor, "Regla del convenio JSON");
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
    addRow(remRows, "Basico", base, baseDetail);

    let seniorityBase = base;
    const includeFixedInSeniority = checked("farmSeniorityOnFixedAdditions", true);
    const addRegularRem = (label, amount, detail, includeForSeniority = true) => {
      addRow(remRows, label, amount, detail);
      if (includeForSeniority && includeFixedInSeniority) seniorityBase += amount;
    };

    ["tituloFarmaceutico", "adscripcion", "bloqueo"].forEach((key) => {
      if (!on(`farm_${key}`)) return;
      const add = conv.additionals[key];
      const scaleRow = scaleAdditionalRow(conv, key, add);
      addRegularRem(add.label, (firstFinite(scaleRow?.monthly, add.monthly) || 0) * proportion, `Escala ${periodLbl}`);
    });

    if (on("farmCajero")) addRegularRem("Adicional cajero", base * ((rules.cajeroPct || 10) / 100), `${rules.cajeroPct || 10}% de ${fmt(base)} (Basico)`);
    if (on("farmAdminTitle")) addRegularRem("Adicional tareas administrativas", base * ((rules.tareasAdministrativasPct || 5) / 100), `${rules.tareasAdministrativasPct || 5}% de ${fmt(base)} (Basico)`);
    if (on("farmAdminTenure")) {
      const pct = years > 2 ? (rules.adminTenurePctOver2Years || 10) : (rules.adminTenurePctInitial || 5);
      addRegularRem("Adicional administrativo por antiguedad", base * (pct / 100), `${pct}% de ${fmt(base)} (Basico)`);
    }
    if (on("farmPerfumeria")) addRegularRem("Adicional perfumeria", base * ((rules.perfumeriaPct || 10) / 100), `${rules.perfumeriaPct || 10}% de ${fmt(base)} (Basico)`);
    if (on("farmBike")) addRegularRem("Adicional bici/ciclomotor/moto", base * ((rules.bikePct || 10) / 100), `${rules.bikePct || 10}% de ${fmt(base)} (Basico)`);

    const initialABase = initialAMonthly * proportion;
    addRegularRem("Adicional idioma", initialABase * ((rules.languagePct || 10) / 100) * num("farmLanguages", 0), `${rules.languagePct || 10}% de ${fmt(initialABase)} x ${num("farmLanguages", 0)}`);

    const employeeFirstBase = empleadoFarmaciaMonthly * proportion;
    if (on("farmAuxTitle")) {
      addRegularRem("Titulo auxiliar de farmacia", employeeFirstBase * ((rules.auxTitlePct || 20) / 100), `${rules.auxTitlePct || 20}% de ${fmt(employeeFirstBase)}`);
    }

    let seniorityAmount = 0;
    if (on("farmSeniority")) {
      seniorityAmount = seniorityBase * (pctAnt / 100);
      addRow(remRows, "Escalafon por antiguedad", seniorityAmount, `${pctAnt}% de ${fmt(seniorityBase)} (Base Antiguedad)`);
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
    addRow(remRows, "Feriado trabajado", vacationDayValue * holidayWorkedDays, `Adicional feriado trabajado: /${vacationDivisor}`);
    addRow(remRows, "Feriado no trabajado", holidayNotWorkedPlus * holidayNotWorkedDays, `Diferencia feriado: /${vacationDivisor} - /${dayDivisor}`);
    addRow(remRows, "Dia empleado farmacia trabajado", vacationDayValue * pharmacyDayWorked, `${rules.pharmacyEmployeeDay || "6 de septiembre"} - adicional /${vacationDivisor}`);
    addRow(remRows, "Dia empleado farmacia no trabajado", holidayNotWorkedPlus * pharmacyDayNotWorked, `${rules.pharmacyEmployeeDay || "6 de septiembre"} - diferencia /${vacationDivisor} - /${dayDivisor}`);
    if (vacationDays > 0) {
      addRow(remRows, "Vacaciones", vacationDayValue * vacationDays, `Remuneracion normal / ${vacationDivisor} x ${vacationDays}`);
      if (checked("farmDiscountVacationDays", true)) {
        addRow(remRows, "Descuento dias vacaciones", -standardDayValue * vacationDays, `Remuneracion normal / ${dayDivisor} x ${vacationDays}`);
      }
    }

    const hourBase = sumRows(remRows);
    const hourValue = hourBase / hourDivisor;
    addRow(remRows, "Horas extra 50%", hourValue * num("farmExtra50", 0) * 1.5, `${num("farmExtra50", 0)} hs x ${fmt(hourValue)} x 1,5`);
    addRow(remRows, "Horas extra 100%", hourValue * num("farmExtra100", 0) * 2, `${num("farmExtra100", 0)} hs x ${fmt(hourValue)} x 2`);
    addRow(remRows, "Adicional nocturno voluntario", hourValue * num("farmNightHours", 0) * ((rules.nightPct || 100) / 100), `${num("farmNightHours", 0)} hs x ${fmt(hourValue)} x ${(rules.nightPct || 100) / 100}`);

    if (checked("farmSac", false)) {
      const sacDays = Math.max(0, Math.min(180, num("farmSacDays", 180)));
      const currentForSac = sumRows(remRows);
      const sacBase = Math.max(num("farmSacBestRem", 0), currentForSac);
      addRow(remRows, "SAC proporcional", (sacBase / 2 / 180) * sacDays, `Base ${fmt(sacBase)} / 2 / 180 x ${sacDays}`);
    }

    if (on("farmFallaCaja")) {
      addRow(noRemRows, "Fondo falla de caja", (base + seniorityAmount) * ((rules.fallaCajaPct || 10) / 100), `${rules.fallaCajaPct || 10}% de ${fmt(base + seniorityAmount)} (Basico + Ant.)`);
    }

    if (on("farmNonRem")) {
      addRow(noRemRows, "Suma no remunerativa escala", (firstFinite(activeCatRow?.nonRemunerative, cat.nonRem[period]) || 0) * noRemProportion, `${periodLbl}; dias no rem. ${noRemDays}/${workingDays}`);
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
    addRow(details, "Valor hora extra", hourValue, `Base habitual / ${hourDivisor}`);
    addRow(details, "Base obra social", osBase, checked("farmOsFullTimeBase", true) && weeklyFactor < 1 ? "Base jornada completa por jornada reducida" : "Remunerativo + no remunerativo sujeto a OS");

    return buildResult(conv, remRows, noRemRows, deductionRows, employerRows, details);
  }

  function calcCamioneros(conv) {
    const zone = getZone(conv);
    const cat = getCategory(conv);
    const coef = zone.coef || 1;
    const activeCatRow = scaleCategoryRow(conv, cat, zone);
    const rowHasSpecificZone = !!(activeCatRow && activeCatRow.zone);
    const years = yearsFromEntry();

    const periodDays = Math.max(1, num("camPeriodDays", 24));
    const paidDaysRaw = Math.max(0, num("camWorkingDays", periodDays));
    const paidDays = Math.min(paidDaysRaw, periodDays);
    const absentDaysUnjust = Math.max(0, num("camAbsentDays", 0));
    const payableDays = Math.max(0, paidDays - absentDaysUnjust);
    const noRemDaysInput = str("camNoRemDays").trim();
    const parsedNoRemDays = noRemDaysInput ? Number(noRemDaysInput.replace(",", ".")) : payableDays;
    const noRemDays = Math.max(0, Math.min(periodDays, Number.isFinite(parsedNoRemDays) ? parsedNoRemDays : payableDays));
    const remRows = [];
    const noRemRows = [];
    const deductionRows = [];
    const employerRows = [];
    const details = [];
    const activeMonthly = firstFinite(activeCatRow?.monthly);
    const activeDay = firstFinite(activeCatRow?.day, activeCatRow?.hourly ? activeCatRow.hourly * 8 : null);
    const baseMonthly = activeMonthly ? activeMonthly * (rowHasSpecificZone ? 1 : coef) : cat.monthly * coef;
    const baseDay = firstFinite(activeDay ? activeDay * (rowHasSpecificZone ? 1 : coef) : null, baseMonthly / periodDays, cat.day * coef) || 0;
    const items = conv.items;
    const driverFirst = conv.categories.find((item) => item.id === "conductor1") || conv.categories[0];
    const driverFirstRow = scaleCategoryRow(conv, driverFirst, zone);
    const driverFirstHasZone = !!(driverFirstRow && driverFirstRow.zone);
    const driverFirstMonthly = firstFinite(driverFirstRow?.monthly)
      ? firstFinite(driverFirstRow.monthly) * (driverFirstHasZone ? 1 : coef)
      : (driverFirst?.monthly || baseMonthly) * coef;
    const baseGross = baseDay * paidDays;
    const absenceDiscount = baseDay * Math.min(absentDaysUnjust, periodDays);
    const base = Math.max(0, baseGross - absenceDiscount);
    const baseDetail = absenceDiscount > 0
      ? `${paidDays} jornales - ${absentDaysUnjust} inasist. injust.`
      : `${paidDays} jornales x ${fmt(baseDay)}`;

    addRow(remRows, "Basico proporcional", base, baseDetail);

    // CCT 40/89 Art. 4.2.11: comida, viaticos y pernoctada son NO REMUNERATIVOS
    // (no requieren comprobantes, no integran remuneración ni sufren cargas sociales)
    if (on("camComida")) {
      addRow(noRemRows, "Comida", items.comida * coef * noRemDays, `Item 4.1.12 / 4.2.11 - ${fmt(items.comida * coef)}/dia x ${noRemDays} dias`);
    }
    if (on("camViaticoEspecial")) {
      addRow(noRemRows, "Viatico especial", items.viaticoEspecial * coef * noRemDays, `Item 4.1.13 / 4.2.11 - ${fmt(items.viaticoEspecial * coef)}/dia x ${noRemDays} dias`);
    }
    addRow(noRemRows, "Pernoctada", items.pernoctada * coef * num("camPernoctadaDays", 0), `${num("camPernoctadaDays", 0)} dias x ${fmt(items.pernoctada * coef)}`);
    addRow(noRemRows, "Permanencia fuera de residencia", items.permanencia * coef * num("camPermanencia", 0), `${num("camPermanencia", 0)} dias x ${fmt(items.permanencia * coef)}`);
    addRow(noRemRows, "Simple presencia", items.simplePresencia * coef * num("camSimplePresence", 0), `${num("camSimplePresence", 0)} dias x ${fmt(items.simplePresencia * coef)}`);
    addRow(noRemRows, "Cruce de frontera", items.cruceFrontera * coef * num("camCruces", 0), `${num("camCruces", 0)} cruces x ${fmt(items.cruceFrontera * coef)}`);
    addRow(noRemRows, "Ingreso/egreso Tierra del Fuego", items.ingresoIsla * coef * num("camIsla", 0), `${num("camIsla", 0)} veces x ${fmt(items.ingresoIsla * coef)}`);

    const kmNormal = Math.max(0, num("camKmExtra", 0));
    const kmWeekend = Math.max(0, num("camKmWeekend", 0));
    const kmManualViatico = Math.max(0, num("camKmViatico", 0));
    const kmTravelDays = Math.max(0, num("camKmTravelDays", 0));
    const minViaticoKm = checked("camApplyKmMin", false) ? kmTravelDays * 350 : 0;
    const viaticoKmLiquidado = Math.max(kmNormal, minViaticoKm);
    addRow(remRows, "Horas extraordinarias por km", items.kmExtra * coef * kmNormal, `Item 4.2.3 - ${fmt(items.kmExtra * coef)}/km`);
    addRow(remRows, "Km sab/dom/feriado 100%", items.kmExtra * coef * kmWeekend * 2, `Item 4.2.3 - ${fmt(items.kmExtra * coef)}/km x 2`);
    addRow(noRemRows, "Viatico por km", items.kmViatico * coef * viaticoKmLiquidado, `Item 4.2.4 / 4.2.11 - ${fmt(items.kmViatico * coef)}/km${minViaticoKm > kmNormal ? `; minimo ${minViaticoKm} km` : ""}`);
    addRow(noRemRows, "Viatico por km manual", items.kmViatico * coef * kmManualViatico, `Item 4.2.4 - adicional manual ${kmManualViatico} km`);
    addRow(remRows, "Adicional bitrenes", items.bitrenes * coef * num("camBitrenes", 0), "Valor planilla");
    addRow(remRows, "Plus vacacional", items.plusVacacionalDia * coef * num("camVacationPlusDays", 0), `Item 3.3.2 - ${fmt(items.plusVacacionalDia * coef)}/dia`);
    if (checked("camPresentism", true) && absentDaysUnjust === 0) {
      addRow(remRows, "Presentismo", base * ((items.presentismoPct || 8.33) / 100), `${items.presentismoPct || 8.33}% de ${fmt(base)} (Basico)`);
    }

    const customPct = num("camAdditionalPct", 0);
    const branchAdditions = [
      ["camLongDistanceDriver", "Adicional chofer larga distancia", items.choferLargaDistanciaPct || 10, base, "Item 4.2 - chofer"],
      ["camLactea", "Transporte materia prima lactea", items.lacteaPct || 15, base, "Item 3.1.3"],
      ["camAuxilio", "Conductor de auxilio", items.auxilioPct || 10, base, "Item 3.1.4"],
      ["camBlindado", "Unidades blindadas", items.blindadoPct || 20, base, "Item 5.1.13"],
      ["camCombustibles", "Transporte de combustibles", items.combustiblesPct || 15, driverFirstMonthly, "Item 5.5.1"],
      ["camPeligrosas", "Sustancias peligrosas", items.peligrosasPct || 20, driverFirstMonthly, "Item 5.6.2"],
      ["camPozos", "Pozos petroliferos", items.pozosPetroliferosPct || 40, base, "Item 5.7.4"],
      ["camPluralidadI", "Pluralidad taller Grupo I/III", items.pluralidadGrupoIPct || 25, base, "Item 3.1.13"],
      ["camPluralidadII", "Pluralidad taller Grupo II", items.pluralidadGrupoIIPct || 18, base, "Item 3.1.13"],
      ["camDiariosRevistas", "Distribucion diarios y revistas", items.diariosRevistasPct || 12, base, "Item 5.4.1"],
      ["camLogistica", "Logistica/almacenamiento", items.logisticaPct || 18, base, "Item 5.12"],
      ["camCamaraFrio", "Camara de frio", items.camaraFrioPct || 20, base, "Rama logistica"]
    ];
    branchAdditions.forEach(([id, label, pct, baseAmount, detail]) => {
      if (checked(id, false)) addRow(remRows, label, baseAmount * (pct / 100), `${pct}% de ${fmt(baseAmount)}`);
    });
    addRow(remRows, "Adicional de rama manual", base * (customPct / 100), `${customPct}% de ${fmt(base)}`);
    addRow(remRows, "Dia del trabajador camionero", baseDay * 2 * num("camDriverDay", 0), "15 de diciembre trabajado - jornal x 2");
    addRow(remRows, "Otros adicionales Camioneros", num("camOtherRem", 0), "Carga manual remunerativa del convenio");

    // CCT 40/89 Item 6.1.5: Antiguedad 1% por año SIN TOPE sobre rubros remuneratorios fijos
    const subtotalBeforeSeniority = sumRows(remRows);
    if (checked("camSeniority", true)) {
      addRow(remRows, "Antiguedad", subtotalBeforeSeniority * (years / 100), `${years}% de ${fmt(subtotalBeforeSeniority)} (Suma remunerativos)`);
    }

    const hourValue = baseDay / 8;

    const extra50 = hourValue * num("camExtra50", 0) * 1.5;
    const extra100 = hourValue * num("camExtra100", 0) * 2;
    const extraNight = hourValue * num("camNightHours", 0) * 2;
    if (extra50 > 0) addRow(remRows, "Horas extra 50%", extra50, `${num("camExtra50", 0)} hs x ${fmt(hourValue)} x 1,5`);
    if (extra100 > 0) addRow(remRows, "Horas extra 100%", extra100, `${num("camExtra100", 0)} hs x ${fmt(hourValue)} x 2`);
    if (extraNight > 0) addRow(remRows, "Horas nocturnas 100%", extraNight, `${num("camNightHours", 0)} hs x ${fmt(hourValue)} x 2`);

    addCommonManualRows(remRows, noRemRows, deductionRows);

    const remTotal = sumRows(remRows);
    
    const osBase = remTotal; // no rem de camioneros no integra base OS (son viáticos Art.4.2.11)
    applyWorkerDeductions(deductionRows, remTotal, osBase, conv);
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
        legajo: str("employeeLegajo", ""),
        name: str("employeeName", "Sin nombre") || "Sin nombre",
        cuil: str("employeeCuil", "-") || "-",
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

  function calculate() {
    const conv = getConvention();
    if (!conv) return;
    lastAudit = null;
    if (conv.id === "uocra") lastResult = calcUocra(conv);
    if (conv.id === "farmacia") lastResult = calcFarmaciaPlus(conv);
    if (conv.id === "camioneros") lastResult = calcCamioneros(conv);
    if (!lastResult && isGenericConvention(conv)) lastResult = calcGenericConvention(conv);
    if (!lastResult) lastResult = calcGenericConvention(conv);
    renderAll(lastResult);
    setActionButtonsEnabled(true);
  }

  function renderAll(result) {
    $("receipt").className = "";
    $("details").className = "";
    $("scales").className = "";
    renderMetrics(result.totals);
    $("receipt").innerHTML = renderReceipt(result);
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
          <div class="receipt-title">${escapeHtml(result.employee.name)}</div>
          <div class="receipt-meta">
            <span>CUIL: ${escapeHtml(result.employee.cuil)}</span>
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
      <div class="line-total"><span>Total bruto</span><span class="amount">${fmt(result.totals.gross)}</span></div>
      <div class="line-total" data-receipt-section="deductions-total"><span>Total deducciones</span><span class="amount">${fmt(result.totals.deductions)}</span></div>
      <div class="line-total net-total" data-receipt-section="net"><span>Neto a cobrar</span><span class="amount">${fmt(result.totals.net)}</span></div>
    </div>`;
  }

  function renderDetails(result) {
    return `<div class="detail-grid">
      <div class="detail-card">
        <h3>Conceptos remunerativos</h3>
        ${tableRows(result.remRows)}
      </div>
      <div class="detail-card">
        <h3>Conceptos no remunerativos</h3>
        ${tableRows(result.noRemRows)}
      </div>
      <div class="detail-card">
        <h3>Deducciones trabajador</h3>
        ${tableRows(result.deductionRows)}
      </div>
      <div class="detail-card">
        <h3>Costo empleador</h3>
        ${tableRows([
          { label: "Bruto trabajador", amount: result.totals.gross, detail: "" },
          ...result.employerRows,
          { label: "Costo total estimado", amount: result.totals.employerCost, detail: "Bruto + contribuciones" }
        ])}
      </div>
      <div class="detail-card">
        <h3>Bases y calculos</h3>
        ${tableRows(result.details)}
      </div>
    </div>`;
  }

  function renderScales(result) {
    const source = result.activeScale
      ? `<div class="scale-source-note">Liquidacion basada en escala aprobada vigente: ${escapeHtml(result.activeScale.periodLabel || monthLabel(result.activeScale.period))}.</div>`
      : `<div class="scale-source-note">Liquidacion basada en la escala base cargada en el sistema.</div>`;
    if (result.conv.id === "uocra") return source + renderUocraScale(result);
    if (result.conv.id === "farmacia") return source + renderFarmaciaScale(result);
    if (result.conv.id === "camioneros") return source + renderCamionerosScale(result);
    if (isGenericConvention(result.conv)) return source + renderGenericScale(result);
    return source + renderGenericScale(result);
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
    return String(value);
  }

  function conventionCct(conv) {
    const meta = conventionCardMeta(conv);
    const direct = conv.metadata?.cct || meta.code;
    const match = String(direct || conv.name || "").match(/CCT\s*[\d/.-]+/i);
    return match ? match[0].toUpperCase() : direct || "CCT / acta";
  }

  function currentSummaryContext(conv, result = null) {
    const period = result?.period || getPeriod(conv);
    const zone = result?.zone || getZone(conv);
    const category = result?.category || getCategory(conv);
    const activeScale = result?.activeScale || activeScaleFor(conv);
    return { period, zone, category, activeScale };
  }

  function selectedScaleAmount(conv, category, zone, period) {
    const row = scaleCategoryRow(conv, category, zone);
    if (conv.id === "uocra") {
      const staticScale = conv.scales?.[period]?.[zone?.id]?.[category?.id] || 0;
      return firstFinite(
        category?.monthly ? row?.monthly : row?.day,
        category?.monthly ? row?.monthly : row?.hourly ? row.hourly * 8 : null,
        staticScale,
        category?.monthly,
        category?.day,
        category?.hourly
      ) || 0;
    }
    if (conv.id === "camioneros") {
      const coef = zone?.coef || 1;
      const rowHasZone = !!(row && row.zone);
      const monthly = firstFinite(row?.monthly, category?.monthly) || 0;
      return monthly * (rowHasZone ? 1 : coef);
    }
    return firstFinite(row?.monthly, category?.monthly, row?.day, category?.day, row?.hourly, category?.hourly) || 0;
  }

  function renderSummaryKpis(items) {
    return `<div class="summary-kpis">
      ${items.map((item) => `<div class="summary-kpi">
        <span>${escapeHtml(item.label)}</span>
        <strong>${escapeHtml(summaryValue(item.value))}</strong>
      </div>`).join("")}
    </div>`;
  }

  function renderSummaryCards(items) {
    return `<div class="summary-rule-grid">
      ${items.map((item) => `<article class="summary-rule-card">
        <span>${escapeHtml(item.label)}</span>
        <strong>${escapeHtml(summaryValue(item.value))}</strong>
        <p>${escapeHtml(item.detail || "")}</p>
      </article>`).join("")}
    </div>`;
  }

  function renderSummarySection(title, rows) {
    const cleanRows = (rows || []).filter(Boolean);
    if (!cleanRows.length) return "";
    return `<section class="summary-section">
      <h3>${escapeHtml(title)}</h3>
      <div class="summary-definition-list">
        ${cleanRows.map((row) => `<div class="summary-definition">
          <span>${escapeHtml(row.label)}</span>
          <strong>${escapeHtml(summaryValue(row.value))}</strong>
          ${row.detail ? `<p>${escapeHtml(row.detail)}</p>` : ""}
        </div>`).join("")}
      </div>
    </section>`;
  }

  function renderSummaryBulletSection(title, items) {
    const cleanItems = summaryArray(items);
    if (!cleanItems.length) return "";
    return `<section class="summary-section">
      <h3>${escapeHtml(title)}</h3>
      <ul class="summary-bullets">
        ${cleanItems.map((item) => `<li>${escapeHtml(summaryValue(item))}</li>`).join("")}
      </ul>
    </section>`;
  }

  function renderSummaryTable(title, headers, rows) {
    const cleanRows = (rows || []).filter(Boolean);
    if (!cleanRows.length) return "";
    return `<section class="summary-section">
      <h3>${escapeHtml(title)}</h3>
      <div class="summary-table-wrap">
        <table class="summary-table">
          <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
          <tbody>
            ${cleanRows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(summaryValue(cell))}</td>`).join("")}</tr>`).join("")}
          </tbody>
        </table>
      </div>
    </section>`;
  }

  function renderCategoryGuide(conv, result = null) {
    if (!conv?.categories?.length) return "";
    if (conv.id === "uocra") return renderUocraCategoryGuide(conv);
    if (conv.id === "farmacia") return renderFarmaciaCategoryGuide(conv);
    if (conv.id === "camioneros") return renderCamionerosCategoryGuide(conv);
    return renderGenericCategoryGuide(conv, result);
  }

  function renderUocraCategoryGuide(conv) {
    const periods = conv.periods || [];
    const zones = conv.zones?.length ? conv.zones : [{ id: "A", label: "Zona A" }];
    const tables = zones.map((zone) => renderSummaryTable(`Cuadro de categorias - ${zone.label}`, [
      "Categoria",
      "Jornada",
      ...periods.map((item) => item.label),
      "SNR abril"
    ], (conv.categories || []).map((cat) => [
      cat.label,
      cat.monthly ? "Mensual" : "Jornal diario",
      ...periods.map((item) => {
        const value = Number(conv.scales?.[item.id]?.[zone.id]?.[cat.id] || 0);
        return cat.monthly ? `${fmt(value)} mensual` : fmt(value);
      }),
      fmt(Number(conv.nonRem?.abr26?.[zone.id]?.[cat.id] || 0))
    ])));
    return `<div class="category-guide">${tables.join("")}</div>`;
  }

  function renderFarmaciaCategoryGuide(conv) {
    const rules = conv.rules || {};
    const periods = conv.periods || [];
    return `<div class="category-guide">${renderSummaryTable("Cuadro de categorias y jornada", [
      "Categoria",
      "Jornada",
      "Basico mensual",
      ...periods.map((item) => `No rem. ${item.label}`)
    ], (conv.categories || []).map((cat) => [
      cat.label,
      `${rules.weeklyHours || 45} hs semanales`,
      fmt(Number(cat.monthly || 0)),
      ...periods.map((item) => fmt(Number(cat.nonRem?.[item.id] || 0)))
    ]))}</div>`;
  }

  function renderCamionerosCategoryGuide(conv) {
    const zones = conv.zones?.length ? conv.zones : [{ id: "base", label: "General", coef: 1 }];
    const tables = zones.map((zone) => {
      const coef = Number(zone.coef || 1);
      return renderSummaryTable(`Cuadro de categorias - ${zone.label}`, [
        "Categoria",
        "Jornada",
        "Basico mensual",
        "Jornal ref. 24 dias"
      ], (conv.categories || []).map((cat) => {
        const monthly = Number(cat.monthly || 0) * coef;
        return [
          cat.label,
          "Mensual / jornada convencional",
          fmt(monthly),
          fmt(monthly / 24)
        ];
      }));
    });
    return `<div class="category-guide">${tables.join("")}</div>`;
  }

  function renderGenericCategoryGuide(conv, result = null) {
    const { period, zone } = currentSummaryContext(conv, result);
    const zones = conv.zones?.length ? conv.zones : [zone || { id: "general", label: "General" }];
    const rules = conv.rules || conv.liquidationModel?.rules || {};
    const tables = zones.map((tableZone) => renderSummaryTable(`Cuadro de categorias - ${tableZone.label || "General"}`, [
      "Categoria",
      "Jornada",
      "Mensual",
      "Jornal",
      "Hora",
      "No rem. periodo"
    ], (conv.categories || []).map((cat) => {
      const row = scaleCategoryRow(conv, cat, tableZone);
      const monthly = firstFinite(row?.monthly, cat.monthly, cat.monthlyByPeriod?.[period]);
      const day = firstFinite(row?.day, cat.day, cat.dayByPeriod?.[period]);
      const hourly = firstFinite(row?.hourly, cat.hourly, cat.hourlyByPeriod?.[period]);
      const jornada = cat.normalWeeklyHours || rules.weeklyHours || cat.weeklyHours;
      return [
        cat.label,
        jornada ? `${jornada} hs semanales` : summaryValue(cat.salaryType || conv.type || "Segun convenio"),
        monthly ? fmt(monthly) : "-",
        day ? fmt(day) : "-",
        hourly ? fmt(hourly) : "-",
        periodNonRemValue(cat, period) ? fmt(periodNonRemValue(cat, period)) : "-"
      ];
    })));
    return `<div class="category-guide">${tables.join("")}</div>`;
  }

  function renderConventionSummary(result = null) {
    const conv = result?.conv || getConvention();
    const meta = conventionCardMeta(conv);
    const accent = conventionAccent(conv.id);
    const { period, zone, category, activeScale } = currentSummaryContext(conv, result);
    const periodText = conv.periods?.find((item) => item.id === period)?.label || monthLabel(periodIdToMonth(period) || period);
    const scaleText = activeScale ? `${activeScale.periodLabel || monthLabel(activeScale.period)} aprobada` : "Escala base del sistema";
    const basicAmount = selectedScaleAmount(conv, category, zone, period);
    const body = conv.id === "uocra"
      ? renderUocraSummary(conv, result)
      : conv.id === "farmacia"
        ? renderFarmaciaConventionSummary(conv, result)
        : conv.id === "camioneros"
          ? renderCamionerosConventionSummary(conv, result)
          : renderGenericConventionSummary(conv, result);

    return `<div class="convention-summary" style="--summary-accent:${accent.strong};--summary-soft:${accent.soft};--summary-ink:${accent.ink};">
      <div class="convention-summary-hero">
        <div class="summary-hero-icon" aria-hidden="true">${conventionIcon(conv.id, "summary-icon")}</div>
        <div>
          <span class="summary-eyebrow">Resumen tecnico del convenio</span>
          <h2>${escapeHtml(meta.title || conv.shortName || conv.name)}</h2>
          <p>${escapeHtml(meta.description || conv.source || "Convenio parametrizado para liquidacion.")}</p>
        </div>
        <div class="summary-cct">${escapeHtml(conventionCct(conv))}</div>
      </div>
      ${renderSummaryKpis([
        { label: "Periodo", value: periodText },
        { label: "Categoria", value: category?.label || "-" },
        { label: "Zona", value: zone?.label || "-" },
        { label: "Basico ref.", value: basicAmount ? fmt(basicAmount) : "-" },
        { label: "Escala vigente", value: scaleText },
        { label: "Categorias", value: conv.categories?.length || 0 },
        { label: "Periodos", value: conv.periods?.length || 0 },
        { label: "Origen", value: dataOrigin === "mongodb" ? "MongoDB" : "Local" }
      ])}
      ${renderCategoryGuide(conv, result)}
      ${body}
    </div>`;
  }

  function renderUocraGuideScaleTable(conv, period, options = {}) {
    const zoneId = options.zoneId || "A";
    const periodLabel = conv.periods?.find((item) => item.id === period)?.label || monthLabel(period);
    const headers = options.withSplitSnr
      ? ["Categoria", "Jornal/dia", "Valor/hora", "Quincena 88hs", "SNR mensual", "SNR 1ra Q.", "SNR 2da Q."]
      : ["Categoria", "Jornal/dia", "Valor/hora", "Quincena 88hs", "SNR mensual"];
    const rows = (conv.categories || []).map((cat) => {
      const scale = Number(conv.scales?.[period]?.[zoneId]?.[cat.id] || 0);
      const snr = Number(conv.nonRem?.[period]?.[zoneId]?.[cat.id] || 0);
      const hour = cat.monthly ? "-" : fmt(scale / 8);
      const fortnight = cat.monthly ? "-" : fmt((scale / 8) * 88);
      const base = cat.monthly ? `${fmt(scale)} mensual` : fmt(scale);
      const row = [cat.label, base, hour, fortnight, fmt(snr)];
      if (options.withSplitSnr) {
        row.push(fmt(snr / 2), fmt(period === "mar26" ? snr : snr / 2));
      }
      return row;
    });

    return renderSummaryTable(`Zona ${zoneId} - ${periodLabel}`, headers, rows);
  }

  function renderUocraLegacySummary(conv) {
    return `
      <section class="summary-section summary-highlight">
        <h3>Lectura contable</h3>
        <p>UOCRA combina jornal por categoria y zona con conceptos convencionales propios de obra. Las categorias operarias se liquidan por horas/jornales; Sereno se controla como mensual. El sistema separa remunerativos, SNR paritaria y aportes propios para que el recibo cierre contra escala vigente.</p>
      </section>
      ${renderSummaryCards([
        { label: "Base de escala", value: isMonthly ? fmt(value) : `${fmt(value)} jornal`, detail: isMonthly ? "Sereno mensual proporcional segun periodo elegido." : "El valor hora se obtiene dividiendo el jornal por 8." },
        { label: "Antiguedad", value: "1% por año", detail: "Se calcula sobre el basico proporcional del periodo cuando el check esta activo." },
        { label: "Presentismo", value: "20%", detail: "Sobre basico + antiguedad. No se paga si existen inasistencias injustificadas cargadas." },
        { label: "SNR paritaria", value: snr ? fmt(snr) : "Segun escala", detail: "Se informa por periodo, categoria y zona; integra la base de obra social cuando corresponde." }
      ])}
      ${renderSummarySection("Reglas de liquidacion", [
        { label: "Tipo de convenio", value: conv.type === "hourly" ? "Jornal / horas" : conv.type, detail: "El trabajador operario liquida horas normales, extras, franco y feriados." },
        { label: "Zonas", value: (conv.zones || []).map((item) => item.label).join(", "), detail: "La escala puede variar por zona A, B, C y C Austral." },
        { label: "Horas normales sugeridas", value: isMonthly ? "176 mensual" : "88 por quincena / 176 mensual", detail: "Puede modificarse en el paso de conceptos antes de liquidar." },
        { label: "Horas extra", value: "50% y 100%", detail: "Se calculan sobre valor hora del jornal vigente." },
        { label: "Adicionales de tarea", value: "Altura, tareas especiales, submuracion, hormigon, encargado", detail: "Cada adicional se activa desde la pantalla de conceptos y queda documentado en el recibo." }
      ])}
      ${renderSummarySection("Aportes, contribuciones y bases", [
        { label: "Aportes generales", value: "SIPA 11%, PAMI 3%, Obra social 3%", detail: "Base remunerativa y base de obra social calculadas por separado." },
        { label: "Trabajador UOCRA", value: "Cuota 2,5% o solidario 2%, aporte UOCRA 1,8%, ISTIC 0,5%", detail: "El afiliado no duplica aporte solidario." },
        { label: "Empleador UOCRA", value: "2,30% + ISTIC 0,50% + contribucion empresarial cuando aplica", detail: "Se suma al costo empleador y queda visible en Detalle." },
        { label: "Base obra social", value: "Remunerativo + SNR sujeto", detail: "El sistema suma la SNR paritaria cuando corresponde por acta/escala." }
      ])}
      ${renderSummaryBulletSection("Checklist profesional", [
        "Confirmar categoria real de obra, zona y periodo de escala.",
        "Validar si la liquidacion es primera quincena, segunda quincena o mensual.",
        "Controlar inasistencias porque afectan presentismo y base.",
        "Revisar si aplica vestimenta, altura u otros adicionales de tarea.",
        "Comparar SNR contra la escala aprobada del mes antes de cerrar."
      ])}
    `;
  }

  function renderUocraSummary(conv) {
    return `
      <section class="summary-section summary-highlight uocra-guide-head">
        <div>
          <h3>Escalas salariales - Acuerdo 31/03/2026</h3>
          <p>Jornales diarios. Valor hora = jornal / 8. Sereno: salario mensual. Vigencia hasta 31/05/2026.</p>
        </div>
        <span class="uocra-guide-badge">Vigente</span>
      </section>
      ${renderUocraGuideScaleTable(conv, "abr26", { zoneId: "A", withSplitSnr: true })}
      ${renderUocraGuideScaleTable(conv, "mar26", { zoneId: "A" })}
      ${renderUocraGuideScaleTable(conv, "may26", { zoneId: "A" })}
      <div class="uocra-guide-grid">
        ${renderSummaryTable("Aportes empleado", ["Concepto", "%", "Base"], [
          ["Jubilacion SIPA", "11%", "Base SS"],
          ["PAMI", "3%", "Base SS"],
          ["Obra social OSMICON", "3%", "Rem + SNR"],
          ["Cuota sindical UOCRA", "2,50%", "Remunerativo"],
          ["Aporte solidario (abr-may 26)", "2,00%", "Remunerativo"],
          ["Aporte UOCRA SS", "1,80%", "Remunerativo"],
          ["ISTIC", "0,50%", "Remunerativo"]
        ])}
        ${renderSummaryTable("Contribuciones empleador", ["Concepto", "%", "Base"], [
          ["Jubilacion empleador", "10,77%", "Base SS"],
          ["PAMI empleador", "1,58%", "Base SS"],
          ["Obra social empleador", "6%", "Rem + SNR"],
          ["Asignaciones familiares", "4,70%", "Base SS"],
          ["Fondo Nac. Empleo", "0,95%", "Base SS"],
          ["Contribucion UOCRA", "2,30%", "Remunerativo"],
          ["ISTIC empleador", "0,50%", "Remunerativo"],
          ["Contrib. empresarial (abr-may)", "$6.000", "Por trabajador"],
          ["ART variable", "2,50%", "Remunerativo"],
          ["ART cuota fija", "$1.450", "Por mes"],
          ["SCVO", "$424,62", "Por mes"]
        ])}
      </div>
      <section class="summary-section summary-highlight">
        <h3>Base SS</h3>
        <p>Base SS = Remunerativo - $7.003,68 (Ley 27.430). Cuota sindical absorbe aporte solidario para afiliados.</p>
      </section>
    `;
  }

  function renderFarmaciaConventionSummary(conv, result = null) {
    const { period, zone, category } = currentSummaryContext(conv, result);
    const rules = conv.rules || {};
    const catRow = scaleCategoryRow(conv, category, zone);
    const base = firstFinite(catRow?.monthly, category?.monthly) || 0;
    const noRem = firstFinite(catRow?.nonRemunerative, category?.nonRem?.[period]) || 0;
    const extraordinary = conv.extraordinaryContribution?.[period] || 0;
    const additions = Object.values(conv.additionals || {});
    return `
      <section class="summary-section summary-highlight">
        <h3>Lectura contable</h3>
        <p>Farmacia Mendoza exige controlar categoria, jornada semanal, adicionales de funcion, escalafon por antiguedad y sumas no remunerativas por periodo. La liquidacion prioriza base mensual, prorrateos por jornada/dias, divisores convencionales y aportes ADEF.</p>
      </section>
      ${renderSummaryCards([
        { label: "Basico categoria", value: base ? fmt(base) : "-", detail: "Base mensual de la categoria seleccionada." },
        { label: "No remunerativo", value: noRem ? fmt(noRem) : "-", detail: "Importe del periodo seleccionado, prorrateable por dias." },
        { label: "Antiguedad", value: "5% a 35%", detail: "1 año 5%, 2 años 10%, 5 años 20%, 10 años 25%, 15 años 30%, 20 años 35%." },
        { label: "Jornada", value: `${rules.weeklyHours || 45} hs`, detail: `Insalubre: ${rules.insalubreWeeklyHours || 33} hs reales pagadas como ${rules.insalubrePaidWeeklyHours || 45} hs.` }
      ])}
      ${renderSummarySection("Reglas de calculo", [
        { label: "Divisor sueldo / inasistencias", value: rules.dayDivisor || 30, detail: "Remuneracion habitual dividida por el divisor convencional." },
        { label: "Divisor vacaciones", value: rules.vacationDivisor || 25, detail: "Plus vacacional y dias de vacaciones." },
        { label: "Divisor horas extra", value: rules.hourDivisor || 200, detail: "Base habitual de remunerativos dividida por 200." },
        { label: "Nocturnidad voluntaria", value: `${rules.nightPct || 100}%`, detail: "Adicional sobre valor hora convencional." },
        { label: "Dia empleado de farmacia", value: rules.pharmacyEmployeeDay || "6 de septiembre", detail: "Se liquida como trabajado o no trabajado, nunca duplicado." }
      ])}
      ${renderSummaryTable("Escalafon de antiguedad", ["Tramo", "Porcentaje", "Base"], [
        ["1 año", "5%", "Basico o basico + adicionales fijos si se activa"],
        ["2 años", "10%", "Base antiguedad"],
        ["5 años", "20%", "Base antiguedad"],
        ["10 años", "25%", "Base antiguedad"],
        ["15 años", "30%", "Base antiguedad"],
        ["20 años o mas", "35%", "Base antiguedad"]
      ])}
      ${renderSummaryTable("Adicionales principales", ["Concepto", "Valor / regla", "Tratamiento"], [
        ["Cajero", `${rules.cajeroPct || 10}%`, "Remunerativo sobre basico"],
        ["Tareas administrativas", `${rules.tareasAdministrativasPct || 5}%`, "Remunerativo"],
        ["Admin por antiguedad tarea", `${rules.adminTenurePctInitial || 5}% / ${rules.adminTenurePctOver2Years || 10}%`, "Controlar antiguedad en la tarea"],
        ["Perfumeria", `${rules.perfumeriaPct || 10}%`, "Validar requisito de tarea/antiguedad"],
        ["Bici, ciclomotor o moto", `${rules.bikePct || 10}%`, "Remunerativo"],
        ["Idiomas", `${rules.languagePct || 10}% por idioma`, "Referencia categoria inicial A"],
        ["Titulo auxiliar", `${rules.auxTitlePct || 20}%`, "Referencia empleado de farmacia"],
        ...additions.map((item) => [item.label, fmt(item.monthly || 0), "Adicional de escala con no remunerativo propio"])
      ])}
      ${renderSummarySection("Aportes y contribuciones", [
        { label: "Aportes generales", value: "SIPA 11%, PAMI 3%, Obra social 3%", detail: "Obra social puede elevar base a jornada completa si se liquida jornada reducida." },
        { label: "ADEF solidario", value: `${rules.adefSolidarityPct || 2}%`, detail: "Activado por defecto en el sistema." },
        { label: "Afiliado ADEF", value: `${rules.unionPct || 2}% opcional`, detail: "Solo si el trabajador esta afiliado." },
        { label: "Caja compensadora / Pro edificio", value: `${rules.cajaCompensadoraPct || 1}% / ${rules.proEdificioPct || 1}%`, detail: "Opcionales segun legajo y criterio aplicable." },
        { label: "Contribucion extraordinaria escala", value: extraordinary ? fmt(extraordinary) : "-", detail: "Importe fijo informado por periodo." }
      ])}
      ${renderSummaryBulletSection("Checklist profesional", [
        "Validar categoria contra funcion real y escala vigente.",
        "Confirmar jornada semanal, jornada reducida e insalubridad antes de liquidar.",
        "Controlar adicionales de titulo, adscripcion, bloqueo y falla de caja con respaldo.",
        "Revisar si la suma no remunerativa integra obra social y si corresponde prorrateo.",
        "Evitar duplicar el dia del empleado de farmacia como trabajado y no trabajado."
      ])}
    `;
  }

  function renderCamionerosConventionSummary(conv, result = null) {
    const { period, zone, category } = currentSummaryContext(conv, result);
    const items = conv.items || {};
    const coef = zone?.coef || 1;
    const monthly = selectedScaleAmount(conv, category, zone, period);
    const day = monthly ? monthly / Math.max(1, num("camPeriodDays", 24)) : (category?.day || 0) * coef;
    return `
      <section class="summary-section summary-highlight">
        <h3>Lectura contable</h3>
        <p>Camioneros CCT 40/89 requiere separar con precision basico remunerativo, adicionales de rama y viaticos no remunerativos del Art. 4.2.11. El sistema calcula zona, jornal, presentismo, antiguedad sin tope, kilometraje, comida, viaticos y aportes sindicales propios.</p>
      </section>
      ${renderSummaryCards([
        { label: "Basico mensual", value: monthly ? fmt(monthly) : "-", detail: `Categoria seleccionada con coeficiente ${coef.toLocaleString("es-AR")}.` },
        { label: "Jornal diario", value: day ? fmt(day) : "-", detail: "Por defecto divide por 24 dias convencionales, editable." },
        { label: "Antiguedad", value: "1% por año", detail: "Sin tope, sobre subtotal de remunerativos antes de antiguedad." },
        { label: "Presentismo", value: `${items.presentismoPct || 8.33}%`, detail: "Sobre basico; no corresponde con inasistencias injustificadas." }
      ])}
      ${renderSummarySection("Base, zona y jornada", [
        { label: "CCT", value: "40/89", detail: "Transporte automotor de cargas y ramas alcanzadas." },
        { label: "Zona seleccionada", value: zone?.label || "-", detail: `Coeficiente aplicado: ${coef.toLocaleString("es-AR")}.` },
        { label: "Dias convencionales", value: num("camPeriodDays", 24), detail: "El sistema permite adaptar jornales a pagar y ausencias." },
        { label: "Horas extra", value: "50% / 100% / nocturnas", detail: "Valor hora estimado con jornal diario / 8." },
        { label: "Dia camionero", value: "15 de diciembre", detail: "Si se trabaja, el sistema permite liquidarlo como jornal doble." }
      ])}
      ${renderSummaryTable("Viaticos y no remunerativos Art. 4.2.11", ["Concepto", "Valor base", "Tratamiento"], [
        ["Comida", fmt((items.comida || 0) * coef), "No remunerativo por dia"],
        ["Viatico especial", fmt((items.viaticoEspecial || 0) * coef), "No remunerativo por dia"],
        ["Pernoctada", fmt((items.pernoctada || 0) * coef), "No remunerativo por evento"],
        ["Viatico por km", fmt((items.kmViatico || 0) * coef), "No remunerativo por kilometro"],
        ["Permanencia fuera de residencia", fmt((items.permanencia || 0) * coef), "No remunerativo"],
        ["Simple presencia", fmt((items.simplePresencia || 0) * coef), "No remunerativo"],
        ["Cruce de frontera", fmt((items.cruceFrontera || 0) * coef), "No remunerativo"],
        ["Ingreso/egreso Tierra del Fuego", fmt((items.ingresoIsla || 0) * coef), "No remunerativo"]
      ])}
      ${renderSummaryTable("Adicionales remunerativos de rama", ["Concepto", "Porcentaje / valor", "Base"], [
        ["Chofer larga distancia", `${items.choferLargaDistanciaPct || 10}%`, "Basico"],
        ["Materia prima lactea", `${items.lacteaPct || 15}%`, "Basico"],
        ["Conductor auxilio", `${items.auxilioPct || 10}%`, "Basico"],
        ["Unidades blindadas", `${items.blindadoPct || 20}%`, "Basico"],
        ["Combustibles", `${items.combustiblesPct || 15}%`, "Conductor 1ra"],
        ["Sustancias peligrosas", `${items.peligrosasPct || 20}%`, "Conductor 1ra"],
        ["Pozos petroliferos", `${items.pozosPetroliferosPct || 40}%`, "Basico"],
        ["Pluralidad Grupo I/III", `${items.pluralidadGrupoIPct || 25}%`, "Basico"],
        ["Pluralidad Grupo II", `${items.pluralidadGrupoIIPct || 18}%`, "Basico"],
        ["Diarios y revistas", `${items.diariosRevistasPct || 12}%`, "Basico"],
        ["Logistica / almacenamiento", `${items.logisticaPct || 18}%`, "Basico"],
        ["Camara de frio", `${items.camaraFrioPct || 20}%`, "Basico"],
        ["Bitrenes", fmt((items.bitrenes || 0) * coef), "Valor de planilla"]
      ])}
      ${renderSummarySection("Aportes, contribuciones y bases", [
        { label: "Aportes generales", value: "SIPA 11%, PAMI 3%, Obra social 3%", detail: "Sobre remunerativos; los viaticos Art. 4.2.11 no integran base OS en este motor." },
        { label: "Trabajador Camioneros", value: "Cuota sindical 2%, solidaria 3%, sepelio 1,5%", detail: "Activables desde conceptos." },
        { label: "Empleador Camioneros", value: "2% empresario, 0,5% capacitacion, 2% profesionalizacion", detail: "Se suman al costo empleador." },
        { label: "Kilometraje", value: `${fmt((items.kmExtra || 0) * coef)} / km`, detail: "Remunerativo para horas extraordinarias por kilometro; viatico por km se separa no remunerativo." }
      ])}
      ${renderSummaryBulletSection("Checklist profesional", [
        "Verificar categoria exacta, rama y zona antes de liquidar.",
        "Separar comida, viaticos, pernoctada y kilometraje no remunerativo del Art. 4.2.11.",
        "Controlar que la antiguedad se aplique despues de adicionales remunerativos configurados.",
        "No liquidar presentismo si hay inasistencias injustificadas.",
        "Validar kilometros, pernoctadas y adicionales de rama contra planilla/parte de viaje."
      ])}
    `;
  }

  function renderGenericConventionSummary(conv, result = null) {
    const { period, zone, category } = currentSummaryContext(conv, result);
    const model = conv.liquidationModel || {};
    const rules = { ...(conv.rules || {}), ...(model.rules || {}) };
    const seniority = rules.seniority || {};
    const presentism = rules.presentism || {};
    const nonRem = rules.nonRemunerativeScale || {};
    const overtime = rules.overtime || {};
    const legal = conv.legalFramework || {};
    const sources = summaryArray(legal.primarySources).map((source) => `${source.title || source.type || "Fuente"}${source.fileName ? ` - ${source.fileName}` : ""}`);
    const scope = conv.scope || {};
    const conceptRows = summaryArray(model.concepts || conv.concepts).map((item) => [
      item.label || item.id,
      item.group || item.rowType || "Concepto",
      item.calculation ? `${item.calculation}${item.percent ? ` ${item.percent}%` : ""}` : (item.amount ? fmt(Number(item.amount)) : "-"),
      item.base || "-",
      item.detail || item.notes?.[0] || ""
    ]);
    const deductionRows = summaryArray(model.deductions || conv.deductions).map((item) => [
      item.label || item.id,
      item.percent ? `${item.percent}%` : (item.amount ? fmt(Number(item.amount)) : "-"),
      item.base || "remunerative",
      item.detail || item.appliesWhen || ""
    ]);
    const employerRows = summaryArray(model.employerContributions || conv.employerContributions).map((item) => [
      item.label || item.id,
      item.percent ? `${item.percent}%` : (item.amount ? fmt(Number(item.amount)) : "-"),
      item.base || "remunerative",
      item.detail || item.appliesWhen || ""
    ]);
    const articleRows = Object.entries(legal.articleMap || {}).map(([key, value]) => [
      key,
      typeof value === "string" ? value : summaryValue(value?.title || value?.summary || value?.detail || JSON.stringify(value))
    ]);
    return `
      <section class="summary-section summary-highlight">
        <h3>Lectura contable</h3>
        <p>Este convenio fue estructurado en JSON ejecutable. El motor generico usa categoria, periodo, zona, escala vigente, reglas de proporcionalidad, antiguedad, presentismo, no remunerativos, conceptos variables, deducciones propias y contribuciones propias definidas por leIA y aprobadas por auditoria humana.</p>
      </section>
      ${renderSummaryCards([
        { label: "Tipo de sueldo", value: rules.salaryType || conv.type || "monthly", detail: "Define si la base se prorratea mensual, diaria u horaria." },
        { label: "Divisor mensual", value: rules.monthDivisor || rules.dayDivisor || 30, detail: "Usado para proporcionalidad por dias." },
        { label: "Divisor hora", value: rules.hourDivisor || overtime.divisor || 200, detail: "Base de horas extra." },
        { label: "Jornada semanal", value: `${rules.weeklyHours || category?.normalWeeklyHours || "-"} hs`, detail: "Referencia para jornada completa y proporciones." }
      ])}
      ${renderSummarySection("Identificacion y alcance", [
        { label: "Convenio", value: conv.name, detail: conv.source || "" },
        { label: "CCT / acta", value: conventionCct(conv), detail: conv.metadata?.homologation?.resolution ? `Homologacion: ${conv.metadata.homologation.resolution}` : "" },
        { label: "Actividad", value: conv.metadata?.activity || scope.activity || "-", detail: conv.metadata?.jurisdiction || "" },
        { label: "Sindicato", value: conv.metadata?.union || "-", detail: conv.metadata?.employerChamber || "" },
        { label: "Territorio", value: summaryArray(scope.territory).join(", ") || zone?.label || "-", detail: "Alcance territorial declarado en el JSON." }
      ])}
      ${renderSummarySection("Reglas automaticas", [
        { label: "Antiguedad", value: seniority.enabled === false ? "No aplica" : `${summaryValue(seniority.percentPerYear, 0)}% por año`, detail: `Base: ${summaryValue(seniority.base, "basic")}${seniority.capYears ? `; tope ${seniority.capYears} años` : "; sin tope informado"}` },
        { label: "Presentismo", value: presentism.enabled ? `${summaryValue(presentism.percent, 0)}%` : "No aplica", detail: presentism.requiresNoUnjustifiedAbsence === false ? "No exige ausencia cero" : "Exige controlar inasistencias injustificadas." },
        { label: "No remunerativo escala", value: nonRem.enabled === false ? "No aplica" : "Activo", detail: `OS: ${summaryValue(nonRem.subjectToHealthInsurance, "segun JSON")}; sindicato: ${summaryValue(nonRem.subjectToUnion, "segun JSON")}` },
        { label: "Horas extra", value: overtime.enabled === false ? "No aplica" : `50% x${summaryValue(overtime.rate50, 1.5)} / 100% x${summaryValue(overtime.rate100, 2)}`, detail: `Divisor ${summaryValue(overtime.divisor || rules.hourDivisor, 200)}` },
        { label: "Categoria actual", value: category?.label || "-", detail: `Periodo ${monthLabel(periodIdToMonth(period) || period)} - zona ${zone?.label || "-"}` }
      ])}
      ${renderSummaryBulletSection("Fuentes cargadas", sources)}
      ${renderSummaryBulletSection("Trabajadores incluidos", scope.workersIncluded)}
      ${renderSummaryBulletSection("Trabajadores excluidos", scope.workersExcluded)}
      ${renderSummaryTable("Articulos relevantes", ["Articulo", "Resumen"], articleRows)}
      ${renderSummaryTable("Conceptos del motor JSON", ["Concepto", "Grupo / tipo", "Calculo", "Base", "Detalle"], conceptRows)}
      ${renderSummaryTable("Deducciones propias", ["Concepto", "Valor", "Base", "Detalle"], deductionRows)}
      ${renderSummaryTable("Contribuciones propias empleador", ["Concepto", "Valor", "Base", "Detalle"], employerRows)}
      ${renderSummaryTable("Categorias de escala", ["Categoria", "Mensual", "Jornal", "Hora", "No rem. periodo"], (conv.categories || []).map((cat) => {
        const row = scaleCategoryRow(conv, cat, zone);
        return [
          cat.label,
          firstFinite(row?.monthly, cat.monthly, cat.monthlyByPeriod?.[period]) ? fmt(firstFinite(row?.monthly, cat.monthly, cat.monthlyByPeriod?.[period])) : "-",
          firstFinite(row?.day, cat.day, cat.dayByPeriod?.[period]) ? fmt(firstFinite(row?.day, cat.day, cat.dayByPeriod?.[period])) : "-",
          firstFinite(row?.hourly, cat.hourly, cat.hourlyByPeriod?.[period]) ? fmt(firstFinite(row?.hourly, cat.hourly, cat.hourlyByPeriod?.[period])) : "-",
          periodNonRemValue(cat, period) ? fmt(periodNonRemValue(cat, period)) : "-"
        ];
      }))}
      ${renderSummaryBulletSection("Checklist de auditoria", conv.auditChecklist || conv.validation?.warnings || [
        "Controlar CCT, escala y periodo vigente.",
        "Validar categoria, zona y jornada contra legajo.",
        "Revisar conceptos marcados con validacion humana.",
        "Controlar bases de aportes y no remunerativos."
      ])}
      ${renderSummaryBulletSection("Notas y advertencias", [...summaryArray(conv.notes), ...summaryArray(conv.warnings)])}
    `;
  }

  function renderGenericScale(result) {
    const conv = result.conv;
    const period = result.period;
    const model = conv.liquidationModel || {};
    return `<div class="tables">
      <table><thead><tr><th>Categoria</th><th class="num">Mensual</th><th class="num">Jornal</th><th class="num">Hora</th><th class="num">No rem.</th></tr></thead><tbody>
        ${(conv.categories || []).map((cat) => {
          const row = scaleCategoryRow(conv, cat, result.zone);
          return `<tr>
            <td>${escapeHtml(cat.label)}</td>
            <td class="num">${fmt(firstFinite(row?.monthly, cat.monthly) || 0)}</td>
            <td class="num">${fmt(firstFinite(row?.day, cat.day) || 0)}</td>
            <td class="num">${fmt(firstFinite(row?.hourly, cat.hourly) || 0)}</td>
            <td class="num">${fmt(firstFinite(row?.nonRemunerative, periodNonRemValue(cat, period)) || 0)}</td>
          </tr>`;
        }).join("")}
      </tbody></table>
      <table><thead><tr><th>Concepto JSON</th><th>Tipo</th><th>Calculo</th><th>Base</th></tr></thead><tbody>
        ${(model.concepts || []).map((concept) => `<tr>
          <td>${escapeHtml(concept.label)}</td>
          <td>${escapeHtml(concept.rowType || "remunerative")}</td>
          <td>${escapeHtml(concept.calculation || "")}${concept.percent ? ` ${escapeHtml(concept.percent)}%` : ""}</td>
          <td>${escapeHtml(concept.base || "basic")}</td>
        </tr>`).join("") || `<tr><td colspan="4">Sin conceptos variables cargados.</td></tr>`}
      </tbody></table>
      <div class="scale-summary">Convenio generado por leIA con motor generico JSON. Edita el convenio desde Convenios IA si necesitás ajustar reglas finas.</div>
    </div>`;
  }

  function renderUocraScale(result) {
    const period = result.period;
    const zone = result.zone.id;
    const conv = result.conv;
    return `<div class="tables"><table><thead><tr><th>Categoria</th><th class="num">Jornal / sueldo</th><th class="num">Valor hora</th><th class="num">SNR mensual</th></tr></thead><tbody>
      ${conv.categories.map((cat) => {
        const activeRow = scaleCategoryRow(conv, cat, result.zone);
        const value = firstFinite(
          cat.monthly ? activeRow?.monthly : activeRow?.day,
          cat.monthly ? activeRow?.day ? activeRow.day * 24 : null : activeRow?.hourly ? activeRow.hourly * 8 : null,
          activeRow?.monthly,
          conv.scales[period][zone][cat.id]
        ) || 0;
        const snr = firstFinite(activeRow?.nonRemunerative, conv.nonRem[period][zone][cat.id]) || 0;
        return `<tr><td>${escapeHtml(cat.label)}</td><td class="num">${fmt(value)}</td><td class="num">${cat.monthly ? "-" : fmt(value / 8)}</td><td class="num">${fmt(snr)}</td></tr>`;
      }).join("")}
    </tbody></table></div>`;
  }

  function renderFarmaciaScale(result) {
    const period = result.period;
    const conv = result.conv;
    const additions = Object.values(conv.additionals);
    const rules = conv.rules || {};
    const ruleRows = [
      ["Jornada base", `${rules.weeklyHours || 45} hs semanales`, "Proporcional por horas"],
      ["Jornada insalubre", `${rules.insalubreWeeklyHours || 33} hs pagadas como ${rules.insalubrePaidWeeklyHours || rules.weeklyHours || 45}`, "Art. 15"],
      ["Divisor inasistencias", rules.dayDivisor || 30, "Remuneracion / divisor"],
      ["Divisor vacaciones", rules.vacationDivisor || 25, "Remuneracion / divisor"],
      ["Divisor horas extra", rules.hourDivisor || 200, "Base habitual / divisor"],
      ["Nocturnidad voluntaria", `${rules.nightPct || 100}%`, "Art. 16/17"],
      ["Dia empleado farmacia", rules.pharmacyEmployeeDay || "6 de septiembre", "Feriado convencional"],
      ["Antiguedad", "5/10/20/25/30/35%", "Escala por años"],
      ["Falla de caja", `${rules.fallaCajaPct || 10}%`, "No remunerativo"],
      ["Aporte solidario ADEF", `${rules.adefSolidarityPct || 2}%`, "Configurable"]
    ];
    return `<div class="tables">
      <table><thead><tr><th>Categoria</th><th class="num">Basico abril 2026</th><th class="num">No rem. periodo</th></tr></thead><tbody>
        ${conv.categories.map((cat) => {
          const row = scaleCategoryRow(conv, cat, result.zone);
          return `<tr><td>${escapeHtml(cat.label)}</td><td class="num">${fmt(firstFinite(row?.monthly, cat.monthly) || 0)}</td><td class="num">${fmt(firstFinite(row?.nonRemunerative, cat.nonRem[period]) || 0)}</td></tr>`;
        }).join("")}
      </tbody></table>
      <table><thead><tr><th>Adicional</th><th class="num">Basico</th><th class="num">No rem. periodo</th></tr></thead><tbody>
        ${additions.map((add) => {
          const key = Object.keys(conv.additionals).find((item) => conv.additionals[item] === add);
          const row = scaleAdditionalRow(conv, key, add);
          return `<tr><td>${escapeHtml(add.label)}</td><td class="num">${fmt(firstFinite(row?.monthly, add.monthly) || 0)}</td><td class="num">${fmt(firstFinite(row?.nonRemunerative, add.nonRem[period]) || 0)}</td></tr>`;
        }).join("")}
      </tbody></table>
      <table><thead><tr><th>Regla</th><th>Valor</th><th>Uso</th></tr></thead><tbody>
        ${ruleRows.map(([label, value, use]) => `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(value)}</td><td>${escapeHtml(use)}</td></tr>`).join("")}
      </tbody></table>
    </div>`;
  }

  function renderCamionerosScale(result) {
    const zone = result.zone;
    const items = result.conv.items || {};
    const noRemItems = [
      ["Comida", items.comida, "Item 4.1.12"],
      ["Viatico especial", items.viaticoEspecial, "Item 4.1.13"],
      ["Pernoctada", items.pernoctada, "Item 4.1.14"],
      ["Viatico por km", items.kmViatico, "Item 4.2.4"],
      ["Permanencia fuera de residencia", items.permanencia, "Item 4.2.5"],
      ["Simple presencia", items.simplePresencia, "Item 4.2.5"],
      ["Cruce de frontera", items.cruceFrontera, "Item 4.2.17"],
      ["Ingreso/egreso Tierra del Fuego", items.ingresoIsla, "Item 4.2.17"]
    ];
    const remItems = [
      ["Horas extraordinarias por km", items.kmExtra, "Item 4.2.3"],
      ["Plus vacacional por dia", items.plusVacacionalDia, "Item 3.3.2"],
      ["Adicional bitrenes", items.bitrenes, "Planilla vigente"]
    ];
    return `<div class="tables"><table><thead><tr><th>Categoria</th><th class="num">Por mes</th><th class="num">Por dia</th></tr></thead><tbody>
      ${result.conv.categories.map((cat) => {
        const row = scaleCategoryRow(result.conv, cat, zone);
        const rowHasZone = !!(row && row.zone);
        const coef = rowHasZone ? 1 : zone.coef;
        const monthly = firstFinite(row?.monthly) ? firstFinite(row?.monthly) * coef : cat.monthly * zone.coef;
        const day = firstFinite(row?.day, row?.hourly ? row.hourly * 8 : null) ? firstFinite(row?.day, row?.hourly ? row.hourly * 8 : null) * coef : cat.day * zone.coef;
        return `<tr><td>${escapeHtml(cat.label)}</td><td class="num">${fmt(monthly)}</td><td class="num">${fmt(day)}</td></tr>`;
      }).join("")}
    </tbody></table>
    <table><thead><tr><th>Concepto no remunerativo</th><th>Referencia</th><th class="num">Valor zona</th></tr></thead><tbody>
      ${noRemItems.map(([label, value, ref]) => `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(ref)}</td><td class="num">${fmt((Number(value) || 0) * (zone.coef || 1))}</td></tr>`).join("")}
    </tbody></table>
    <table><thead><tr><th>Concepto remunerativo / adicional</th><th>Referencia</th><th class="num">Valor zona</th></tr></thead><tbody>
      ${remItems.map(([label, value, ref]) => `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(ref)}</td><td class="num">${fmt((Number(value) || 0) * (zone.coef || 1))}</td></tr>`).join("")}
      <tr><td>Presentismo</td><td>Parametro del sistema</td><td class="num">${Number(items.presentismoPct || 8.33).toLocaleString("es-AR")}%</td></tr>
      <tr><td>Antiguedad</td><td>Item 6.1.5</td><td class="num">1% por año</td></tr>
    </tbody></table></div>`;
  }

  function activateTab(tabName) {
    document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("active", item.dataset.tab === tabName));
    document.querySelectorAll(".tab-pane").forEach((pane) => pane.classList.toggle("active", pane.id === `${tabName}Pane`));
  }

  function buildLiquidationAuditPayload() {
    if (!lastResult) return null;
    return {
      conventionId: lastResult.conv.id,
      conventionName: lastResult.conv.name,
      period: lastResult.period,
      periodLabel: lastResult.conv.periods.find((item) => item.id === lastResult.period)?.label || lastResult.period,
      employee: lastResult.employee,
      category: {
        id: lastResult.category.id,
        label: lastResult.category.label
      },
      zone: {
        id: lastResult.zone.id,
        label: lastResult.zone.label,
        coef: lastResult.zone.coef
      },
      activeScale: lastResult.activeScale,
      totals: lastResult.totals,
      remunerative: lastResult.remRows,
      nonRemunerative: lastResult.noRemRows,
      deductions: lastResult.deductionRows,
      employer: lastResult.employerRows,
      details: lastResult.details,
      parameters: collectLeiaParameters()
    };
  }

  function auditSeverityClass(severity) {
    const value = String(severity || "").toLowerCase();
    if (value.includes("alta")) return "high";
    if (value.includes("media")) return "medium";
    return "low";
  }

  function renderAuditFinding(finding) {
    return `<article class="audit-finding ${auditSeverityClass(finding.severity)}">
      <div>
        <span>${escapeHtml(finding.severity || "baja")}</span>
        <strong>${escapeHtml(finding.title || "Control")}</strong>
      </div>
      <p>${escapeHtml(finding.detail || "")}</p>
      ${finding.action ? `<em>${escapeHtml(finding.action)}</em>` : ""}
    </article>`;
  }

  function cuilLooksValid(cuil) {
    const digits = String(cuil || "").replace(/\D/g, "");
    return digits.length === 11;
  }

  function localAutopilotAudit(result, extra = {}) {
    const totals = result?.totals || {};
    const parameters = collectLeiaParameters();
    const findings = [];
    const checklist = [];
    const nextSteps = [];
    const actions = [];
    let score = 100;

    const addFinding = (severity, title, detail, action, actionType, actionValue) => {
      findings.push({ severity, title, detail, action });
      if (severity === "alta") score -= 18;
      else if (severity === "media") score -= 10;
      else score -= 4;
      if (action) nextSteps.push(action);
      if (actionType) actions.push({ label: action, type: actionType, value: actionValue });
    };

    const addChecklist = (item, ok, note) => {
      checklist.push({ item, status: ok ? "ok" : "review", note });
    };

    const gross = Number(totals.gross || 0);
    const deductions = Number(totals.deductions || 0);
    const calculatedNet = gross - deductions;
    const selectedScale = result.activeScale || scaleState.activeForPayroll;
    const employee = result.employee || {};
    const missingName = !employee.name || employee.name === "Sin nombre";
    const missingEntry = !employee.entryDate || employee.entryDate === "-";
    const invalidCuil = !cuilLooksValid(employee.cuil);

    addChecklist("Escala vigente aprobada", !!selectedScale, selectedScale ? `${selectedScale.periodLabel || monthLabel(selectedScale.period)} aplicada.` : "La liquidacion usa la escala base del sistema.");
    addChecklist("CUIL del trabajador", !invalidCuil, invalidCuil ? "Falta un CUIL de 11 digitos para dejar el legajo auditable." : "Formato basico correcto.");
    addChecklist("Datos de ingreso", !missingEntry, missingEntry ? "Falta fecha de ingreso para antiguedad y controles." : `${employee.years || 0} años de antiguedad.`);
    addChecklist("Ecuacion neto", Math.abs(Number(totals.net || 0) - calculatedNet) < 1, "Neto = bruto - deducciones.");
    addChecklist("Conceptos remunerativos", Number(totals.remTotal || 0) > 0, Number(totals.remTotal || 0) > 0 ? "Hay base remunerativa." : "No hay haberes remunerativos.");

    if (!selectedScale) {
      addFinding(
        "alta",
        "Escala no aprobada para el periodo",
        "La liquidacion puede emitirse, pero leIA recomienda aprobar o revisar la escala vigente del mes antes de cerrar el recibo.",
        "Ir a Escalas y validar la vigente",
        "nav-scales",
        ""
      );
    }
    if (missingName) {
      addFinding("media", "Trabajador sin nombre", "El recibo quedaria dificil de auditar o guardar correctamente.", "Completar datos del trabajador", "step", "2");
    }
    if (invalidCuil) {
      addFinding("media", "CUIL incompleto o invalido", "leIA espera 11 digitos para controles de legajo y exportaciones.", "Completar CUIL", "step", "2");
    }
    if (missingEntry) {
      addFinding("baja", "Fecha de ingreso pendiente", "La antiguedad puede quedar subestimada si el convenio la usa.", "Revisar fecha de ingreso", "step", "2");
    }
    if (Number(totals.remTotal || 0) <= 0) {
      addFinding("alta", "Sin base remunerativa", "El calculo no genero haberes remunerativos. Puede faltar categoria, jornada o escala.", "Revisar conceptos", "step", "3");
    }
    if (gross > 0 && deductions / gross > 0.45) {
      addFinding("media", "Deducciones altas", `Las deducciones representan ${Math.round((deductions / gross) * 100)}% del bruto.`, "Resaltar deducciones en recibo", "receipt", "deductions");
    }
    if (Number(totals.net || 0) < 0) {
      addFinding("alta", "Neto negativo", "El trabajador queda con neto menor a cero. Revisar descuentos manuales y ausencias.", "Resaltar neto", "receipt", "net");
    }
    if (Number(totals.noRemTotal || 0) > gross * 0.65 && gross > 0) {
      addFinding("media", "No remunerativos dominantes", "Los conceptos no remunerativos son muy altos contra el bruto total.", "Resaltar no remunerativos", "receipt", "nonremunerative");
    }

    if (result.conv.id === "camioneros") {
      const periodDays = Number(parameters.camPeriodDays || 24);
      const paidDays = Number(parameters.camWorkingDays || 0);
      const absentDays = Number(parameters.camAbsentDays || 0);
      const noRemDays = parameters.camNoRemDays === "" ? Math.max(0, paidDays - absentDays) : Number(parameters.camNoRemDays || 0);
      const remLabels = (result.remRows || []).map((row) => String(row.label || "").toLowerCase()).join(" | ");
      const noRemLabels = (result.noRemRows || []).map((row) => String(row.label || "").toLowerCase()).join(" | ");
      const viaticosOk = !["comida", "viatico especial", "pernoctada", "permanencia", "simple presencia", "cruce de frontera"].some((label) => remLabels.includes(label));
      const hasSeniority = remLabels.includes("antiguedad") || !parameters.camSeniority;

      addChecklist("Camioneros: divisor 24/jornal", periodDays === 24, periodDays === 24 ? "Divisor convencional aplicado." : `Divisor modificado a ${periodDays}.`);
      addChecklist("Camioneros: viaticos fuera de remunerativos", viaticosOk, viaticosOk ? "Art. 4.2.11 separado correctamente." : "Hay viaticos dentro de haberes remunerativos.");
      addChecklist("Camioneros: antiguedad 1%", hasSeniority, hasSeniority ? "Antiguedad controlada." : "No se detecto antiguedad y esta activada.");

      if (absentDays > paidDays) {
        addFinding("alta", "Ausencias mayores a jornales pagados", "Los dias injustificados superan los jornales a liquidar.", "Corregir parametros de Camioneros", "step", "3");
      }
      if (paidDays > periodDays) {
        addFinding("media", "Jornales mayores al divisor", `Se cargaron ${paidDays} jornales con divisor ${periodDays}.`, "Revisar jornales a pagar", "step", "3");
      }
      if (noRemDays > Math.max(periodDays, paidDays)) {
        addFinding("media", "Dias no remunerativos altos", "Los dias de comida/viatico superan los jornales del periodo.", "Revisar dias no remunerativos", "step", "3");
      }
      if (Number(totals.noRemTotal || 0) <= 0 && (parameters.camComida || parameters.camViaticoEspecial || Number(parameters.camPernoctadaDays || 0) > 0 || Number(parameters.camKmExtra || 0) > 0 || Number(parameters.camKmViatico || 0) > 0)) {
        addFinding("media", "No remunerativos esperados en Camioneros", "Hay parametros de viaticos/comida/pernoctada/km pero no aparecen no remunerativos.", "Revisar no remunerativos", "receipt", "nonremunerative");
      }
      if (parameters.camPresentism && absentDays > 0 && remLabels.includes("presentismo")) {
        addFinding("alta", "Presentismo con injustificadas", "Camioneros no deberia conservar presentismo cuando hay inasistencias injustificadas.", "Revisar presentismo", "receipt", "remunerative");
      }
      if (!parameters.camFuneralInsurance) {
        addFinding("media", "Seguro de sepelio desactivado", "El 1,5% del Item 8.1.6 esta apagado. Usalo solo si corresponde por criterio expreso.", "Activar seguro de sepelio", "step", "3");
      }
      if (!parameters.camSolidarityContribution && !parameters.camUnionFee) {
        addFinding("media", "Aportes sindicales apagados", "No hay cuota sindical ni contribucion solidaria configurada para Camioneros.", "Revisar aportes sindicales", "step", "3");
      }
      if (parameters.camApplyKmMin && Number(parameters.camKmTravelDays || 0) <= 0 && Number(parameters.camKmExtra || 0) > 0) {
        addFinding("baja", "Minimo por km sin dias de viaje", "Activaste el minimo de 350 km/dia pero no cargaste dias de viaje.", "Completar dias viaje km", "step", "3");
      }
    }

    if (result.conv.id === "farmacia") {
      const weeklyHours = Number(parameters.farmWeeklyHours || 0);
      const monthPct = Number(parameters.farmMonthPct || 0);
      const workingDays = Number(parameters.farmWorkingDays || 30);
      const absentDays = Number(parameters.farmAbsentDays || 0);
      const noRemDays = parameters.farmNoRemDays === "" ? Math.max(0, workingDays - absentDays) : Number(parameters.farmNoRemDays || 0);
      const nightHours = Number(parameters.farmNightHours || 0);
      const pharmacyDayWorked = Number(parameters.farmPharmacyDayWorked || 0);
      const pharmacyDayNotWorked = Number(parameters.farmPharmacyDayNotWorked || 0);
      const detailLabels = (result.details || []).map((row) => `${row.label || ""} ${row.detail || ""}`).join(" | ").toLowerCase();
      const remLabels = (result.remRows || []).map((row) => String(row.label || "").toLowerCase()).join(" | ");
      const noRemLabels = (result.noRemRows || []).map((row) => String(row.label || "").toLowerCase()).join(" | ");
      const deductionLabels = (result.deductionRows || []).map((row) => String(row.label || "").toLowerCase()).join(" | ");
      const hasAdef = !parameters.farmAdefSolidarity || deductionLabels.includes("adef");
      const hasNight = nightHours <= 0 || remLabels.includes("nocturno");
      const hasInsalubre = !parameters.farmInsalubre || detailLabels.includes("insalubre");

      addChecklist("Farmacia: divisor horas extra 200", detailLabels.includes("/ 200"), detailLabels.includes("/ 200") ? "Horas extra calculadas con divisor 200." : "No se encontro detalle de divisor 200.");
      addChecklist("Farmacia: no remunerativo del periodo", !parameters.farmNonRem || Number(totals.noRemTotal || 0) > 0, parameters.farmNonRem ? "No remunerativo cargado en recibo." : "No remunerativo desactivado por parametro.");
      addChecklist("Farmacia: aportes ADEF", hasAdef, hasAdef ? "Aportes especificos revisados." : "No se detecto aporte ADEF con el parametro activo.");
      addChecklist("Farmacia: nocturnidad voluntaria", hasNight, hasNight ? "Recargo nocturno controlado." : "Hay horas nocturnas sin concepto de recargo.");
      addChecklist("Farmacia: jornada insalubre", hasInsalubre, hasInsalubre ? "Base insalubre controlada cuando corresponde." : "No se detecto detalle de jornada insalubre.");

      if (weeklyHours > 45) {
        addFinding("media", "Horas semanales por encima del tope habitual", "Farmacia Mendoza trabaja con base semanal de hasta 45 horas.", "Revisar horas semanales", "step", "3");
      }
      if (parameters.farmInsalubre && weeklyHours > 33) {
        addFinding("alta", "Jornada insalubre mayor a 33 horas", "El CCT reconoce jornada insalubre de 33 horas semanales pagadas como jornada completa.", "Corregir jornada insalubre", "step", "3");
      }
      if (monthPct > 100) {
        addFinding("media", "Porcentaje de mes mayor a 100%", "El proporcional mensual supera el mes completo.", "Corregir porcentaje del mes", "step", "3");
      }
      if (absentDays > workingDays) {
        addFinding("alta", "Inasistencias mayores a dias del mes", "Las ausencias injustificadas superan los dias base cargados.", "Corregir ausencias", "step", "3");
      }
      if (noRemDays > workingDays) {
        addFinding("media", "Dias no remunerativos altos", "Los dias usados para prorratear sumas no remunerativas superan los dias del periodo.", "Revisar dias no remunerativos", "step", "3");
      }
      if (parameters.farmNonRem && !noRemLabels.includes("suma no remunerativa")) {
        addFinding("media", "No remunerativo de escala no detectado", "El parametro esta activo pero no aparece la suma no remunerativa de escala.", "Revisar escala vigente", "nav-scales", "");
      }
      if (weeklyHours > 0 && weeklyHours < 45 && !parameters.farmOsFullTimeBase) {
        addFinding("media", "Obra social en jornada reducida", "La base de obra social podria requerir control a jornada completa.", "Activar control base OS", "step", "3");
      }
      if (Number(parameters.farmVacationDays || 0) > 0 && !parameters.farmDiscountVacationDays) {
        addFinding("baja", "Vacaciones sin descuento de dias normales", "Se liquidaron vacaciones pero no se desconto el sueldo normal de esos dias.", "Revisar vacaciones", "step", "3");
      }
      if (result.period === "jun26" && !parameters.farmSac) {
        addFinding("baja", "Junio sin SAC", "El periodo es junio y el SAC proporcional esta desactivado.", "Revisar SAC", "step", "3");
      }
      if (result.category?.id === "farmaceutico" && !parameters.farm_tituloFarmaceutico) {
        addFinding("media", "Farmaceutico sin adicional por titulo", "La categoria Farmaceutico normalmente debe controlar adicional por titulo y adicionales tecnicos si corresponden.", "Activar o justificar adicional por titulo", "step", "3");
      }
      if ((parameters.farm_bloqueo || parameters.farm_adscripcion) && !parameters.farm_tituloFarmaceutico) {
        addFinding("baja", "Adicional tecnico sin titulo farmaceutico", "Hay adscripcion/bloqueo sin adicional de titulo farmaceutico. Confirmar si corresponde.", "Revisar adicionales tecnicos", "step", "3");
      }
      if (parameters.farmPerfumeria && result.employee?.years < 3) {
        addFinding("baja", "Perfumeria con baja antiguedad", "El adicional de perfumeria exige controlar antiguedad minima o antecedente externo acreditado.", "Validar requisito de perfumeria", "step", "3");
      }
      if (parameters.farmAdminTenure && result.employee?.years < 3) {
        addFinding("baja", "Adicional administrativo por antiguedad", "El adicional por antiguedad en tareas administrativas exige controlar el tiempo en la tarea.", "Validar antiguedad administrativa", "step", "3");
      }
      if (pharmacyDayWorked > 1 || pharmacyDayNotWorked > 1) {
        addFinding("media", "Dia del empleado de farmacia duplicado", "El 6 de septiembre deberia liquidarse una sola vez como trabajado o no trabajado.", "Revisar dia farmacia", "step", "3");
      }
      if (pharmacyDayWorked > 0 && pharmacyDayNotWorked > 0) {
        addFinding("media", "Dia farmacia cargado en dos modalidades", "El feriado convencional aparece como trabajado y no trabajado a la vez.", "Elegir una modalidad", "step", "3");
      }
    }

    if (isGenericConvention(result.conv)) {
      const model = result.conv.liquidationModel || {};
      const enabledConcepts = (model.concepts || []).filter((concept) => {
        const input = parameters[`gen_${concept.id}`];
        return concept.inputType === "number" ? Number(input || 0) > 0 : !!input;
      });
      const remLabels = (result.remRows || []).map((row) => String(row.label || "").toLowerCase()).join(" | ");
      addChecklist("Convenio JSON: motor generico activo", true, "La liquidacion uso reglas aprobadas de Convenios IA.");
      addChecklist("Convenio JSON: categorias con importes", (result.conv.categories || []).length > 0, `${(result.conv.categories || []).length} categorias cargadas.`);
      addChecklist("Convenio JSON: conceptos variables", enabledConcepts.length >= 0, `${enabledConcepts.length} conceptos variables activados.`);
      if (!result.conv.generatedByLeia) {
        addFinding("baja", "Convenio JSON sin marca leIA", "El convenio usa motor generico pero no tiene trazabilidad de generacion IA.", "Revisar origen del convenio", "nav-conventions", "");
      }
      if (!(model.concepts || []).length) {
        addFinding("media", "Convenio sin conceptos variables", "El JSON no tiene adicionales parametrizables. Puede estar incompleto para una liquidacion real.", "Completar JSON del convenio", "nav-conventions", "");
      }
      if (parameters.genPresentism && !remLabels.includes("presentismo")) {
        addFinding("baja", "Presentismo activado sin importe", "El presentismo esta activado pero el porcentaje del JSON es 0 o no corresponde por ausencias.", "Revisar regla de presentismo", "step", "3");
      }
      if (Number(parameters.genAbsentDays || 0) > Number(result.conv.rules?.monthDivisor || 30)) {
        addFinding("alta", "Ausencias mayores al divisor mensual", "Las ausencias injustificadas superan el divisor del convenio JSON.", "Corregir ausencias", "step", "3");
      }
    }

    if (result.conv.id === "uocra") {
      const hours = Number(parameters.uocraHours || 0);
      if (hours > 220) {
        addFinding("media", "Horas normales elevadas", "La cantidad de horas normales parece alta para el periodo seleccionado.", "Revisar jornada UOCRA", "step", "3");
      }
      if (Number(parameters.uocraAbsence || 0) > hours && hours > 0) {
        addFinding("alta", "Inasistencias mayores a las horas normales", "Las horas de ausencia superan la jornada liquidada.", "Corregir ausencias", "step", "3");
      }
    }

    actions.push(
      { label: "Auditoria IA profunda", type: "audit", value: "" },
      { label: "Ver haberes", type: "receipt", value: "remunerative" },
      { label: "Ver deducciones", type: "receipt", value: "deductions" },
      { label: "Pedir explicacion a leIA", type: "leia-prompt", value: "Explicame esta liquidacion y marcame los riesgos principales con el convenio seleccionado." }
    );

    if (!findings.length) {
      nextSteps.push("Emitir o guardar el recibo con control de escala y legajo.");
    }

    score = Math.max(0, Math.min(100, score));
    const verdict = score >= 90 ? "OK" : score >= 70 ? "OBSERVAR" : "REVISAR";
    return {
      id: extra.id || "local-autopilot",
      aiStatus: extra.aiStatus || "PREAUDITORIA_AUTOMATICA",
      aiModel: extra.aiModel || "leIA Autopiloto local",
      aiError: extra.aiError || "",
      activeScale: selectedScale,
      audit: {
        verdict,
        score,
        summary: findings.length
          ? `leIA detecto ${findings.length} punto${findings.length === 1 ? "" : "s"} para revisar antes de cerrar la liquidacion.`
          : "leIA no encontro bloqueos importantes con los datos actuales.",
        findings,
        checklist,
        nextSteps,
        actions
      }
    };
  }

  function renderAuditAction(action) {
    return `<button class="autopilot-action" type="button" data-autopilot-action="${escapeHtml(action.type || "")}" data-autopilot-value="${escapeHtml(action.value || "")}">
      ${escapeHtml(action.label || "Accion")}
    </button>`;
  }

  function renderAuditResult(payload) {
    const audit = payload?.audit || {};
    const precheck = payload?.precheck || {};
    const findings = Array.isArray(audit.findings) ? audit.findings : [];
    const checklist = Array.isArray(audit.checklist) ? audit.checklist : [];
    const nextSteps = Array.isArray(audit.nextSteps) ? audit.nextSteps : [];
    const actions = Array.isArray(audit.actions) && audit.actions.length
      ? audit.actions
      : (lastResult ? localAutopilotAudit(lastResult).audit.actions : []);
    const verdict = audit.verdict || precheck.verdict || "OBSERVAR";
    const verdictClass = verdict === "OK" ? "ok" : verdict === "REVISAR" ? "bad" : "warn";
    const activeScale = payload?.activeScale;

    $("auditResult").className = "";
    $("auditResult").innerHTML = `<div class="audit-report">
      <div class="audit-hero ${verdictClass}">
        <div>
          <span>Auditoria leIA</span>
          <strong>${escapeHtml(verdict)}</strong>
          <p>${escapeHtml(audit.summary || "Auditoria generada.")}</p>
        </div>
        <div class="audit-score">
          <span>${Math.round(Number(audit.score ?? precheck.score ?? 0))}</span>
          <small>/100</small>
        </div>
      </div>

      <div class="audit-context">
        <div><span>IA</span><strong>${escapeHtml(payload.aiStatus || "-")}</strong></div>
        <div><span>Modelo</span><strong>${escapeHtml(payload.aiModel || "prechequeo local")}</strong></div>
        <div><span>Escala vigente</span><strong>${activeScale ? escapeHtml(activeScale.periodLabel || monthLabel(activeScale.period)) : "Sin aprobada"}</strong></div>
        <div><span>Auditoria</span><strong>${escapeHtml(payload.id || "-")}</strong></div>
      </div>

      ${payload.aiError ? `<div class="scale-warning">${escapeHtml(payload.aiError)}</div>` : ""}

      ${actions.length ? `<div class="autopilot-strip">
        <div>
          <span>Autopiloto leIA</span>
          <strong>Atajos para corregir y auditar</strong>
        </div>
        <div class="autopilot-actions">${actions.map(renderAuditAction).join("")}</div>
      </div>` : ""}

      <div class="audit-section">
        <h3>Hallazgos</h3>
        ${findings.length ? findings.map(renderAuditFinding).join("") : `<div class="empty-state">Sin hallazgos relevantes.</div>`}
      </div>

      <div class="audit-section">
        <h3>Checklist tecnico</h3>
        <div class="audit-checklist">
          ${checklist.map((item) => `<div class="${item.status === "ok" ? "ok" : "review"}">
            <strong>${escapeHtml(item.item || "Control")}</strong>
            <span>${escapeHtml(item.note || "")}</span>
          </div>`).join("")}
        </div>
      </div>

      <div class="audit-section">
        <h3>Acciones sugeridas</h3>
        ${nextSteps.length ? `<ol class="audit-next">${nextSteps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol>` : `<div class="empty-state">No hay acciones pendientes.</div>`}
      </div>
    </div>`;
  }

  function renderAutopilotAudit(result, extra = {}) {
    lastAudit = localAutopilotAudit(result, extra);
    renderAuditResult(lastAudit);
  }

  function handleAutopilotAction(button) {
    if (!button) return;
    const type = button.dataset.autopilotAction;
    const value = button.dataset.autopilotValue;
    if (type === "step") {
      goToStep(Number(value));
      document.querySelector("#payrollFormPanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (type === "receipt") {
      highlightReceiptSection(value);
      return;
    }
    if (type === "tab") {
      activateTab(value);
      return;
    }
    if (type === "nav-scales") {
      document.querySelector('.nav-link[href="#scalesPanel"]')?.click();
      return;
    }
    if (type === "nav-conventions") {
      document.querySelector('.nav-link[href="#conventionsPanel"]')?.click();
      return;
    }
    if (type === "audit") {
      runLiquidationAudit();
      return;
    }
    if (type === "leia-prompt") {
      toggleLeia(true);
      const input = $("leiaInput");
      if (input) {
        input.value = value || "";
        input.focus();
      }
    }
  }

  async function runLiquidationAudit() {
    if (!lastResult) return;
    const button = $("auditBtn");
    const original = button?.textContent || "Auditar con leIA";
    if (button) {
      button.disabled = true;
      button.textContent = "Auditando...";
    }
    activateTab("audit");
    $("auditResult").className = "empty-state";
    $("auditResult").innerHTML = "leIA esta revisando totales, escala vigente, bases y riesgos del convenio...";

    const controller = new AbortController();
    const auditTimeout = setTimeout(() => controller.abort(), 18000);
    try {
      await refreshActiveScaleContext();
      const response = await fetch(apiUrl("/api/leia/audit-liquidation"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          liquidation: buildLiquidationAuditPayload(),
          state: buildLeiaState()
        })
      });
      const rawPayload = await response.text();
      let payload = {};
      try {
        payload = rawPayload ? JSON.parse(rawPayload) : {};
      } catch (error) {
        payload = {
          error: rawPayload.includes("Cannot POST /api/leia/audit-liquidation")
            ? "El backend que esta corriendo no tiene cargada la auditoria. Reinicia el backend y proba de nuevo."
            : rawPayload
        };
      }
      if (!response.ok) throw new Error(payload.error || "No se pudo auditar la liquidacion.");
      lastAudit = payload;
      renderAuditResult(payload);
    } catch (error) {
      renderAutopilotAudit(lastResult, {
        aiStatus: "FALLBACK_LOCAL",
        aiModel: "leIA Autopiloto local",
        aiError: leiaErrorMessage(error)
      });
    } finally {
      clearTimeout(auditTimeout);
      if (button) {
        button.disabled = !lastResult;
        button.textContent = original;
      }
    }
  }

  function scaleDisplayName(scale) {
    if (!scale) return "Sin escala";
    const source = scale.sourceFileName ? ` - ${scale.sourceFileName}` : "";
    return `${scale.periodLabel || monthLabel(scale.period)}${source}`;
  }

  function scaleRows(scale) {
    const parsed = scale?.parsedScale || {};
    return [
      ...(parsed.categories || []).map((row) => ({ ...row, kind: "Categoria" })),
      ...(parsed.additionals || []).map((row) => ({ ...row, kind: "Adicional" })),
      ...(parsed.nonRemunerative || []).map((row) => ({ ...row, kind: "No remunerativo" }))
    ];
  }

  function scaleDetailHtml(scale) {
    if (!scale) return `<div class="empty-state">No hay escala para mostrar.</div>`;
    const parsed = scale.parsedScale || {};
    const rows = scaleRows(scale);
    const warnings = parsed.warnings || [];
    const notes = parsed.notes || [];
    return `<div class="scale-detail">
      <div class="scale-detail-head">
        <div>
          <strong>${escapeHtml(scale.conventionName || scale.shortName || scale.conventionId)}</strong>
          <span>${escapeHtml(scaleDisplayName(scale))}</span>
        </div>
        <span class="status-pill ${scale.status === "APROBADA" ? "ok" : scale.status === "RECHAZADA" ? "bad" : ""}">${escapeHtml(statusLabel(scale.status))}</span>
      </div>
      <div class="scale-mini-grid">
        <div><span>Lectura IA</span><strong>${escapeHtml(scale.aiStatus || "-")}</strong></div>
        <div><span>Confianza</span><strong>${Number(parsed.confidence || 0)}%</strong></div>
        <div><span>Aprobada</span><strong>${escapeHtml(shortDate(scale.approvedAt))}</strong></div>
        <div><span>PDF</span><strong>${scale.sourceFileUrl ? `<a href="${escapeHtml(apiUrl(scale.sourceFileUrl))}" target="_blank" rel="noreferrer">Abrir</a>` : "-"}</strong></div>
      </div>
      ${parsed.sourceSummary ? `<p class="scale-summary">${escapeHtml(parsed.sourceSummary)}</p>` : ""}
      ${warnings.length ? `<div class="scale-warning">${warnings.map(escapeHtml).join("<br>")}</div>` : ""}
      ${rows.length ? `<div class="tables scale-table"><table><thead><tr><th>Tipo</th><th>Concepto</th><th>Zona</th><th class="num">Mensual</th><th class="num">Jornal</th><th class="num">Hora</th><th class="num">No rem.</th></tr></thead><tbody>
        ${rows.map((row) => `<tr>
          <td>${escapeHtml(row.kind)}</td>
          <td>${escapeHtml(row.label || row.id || "-")}</td>
          <td>${escapeHtml(row.zone || "-")}</td>
          <td class="num">${row.monthly ? fmt(Number(row.monthly)) : "-"}</td>
          <td class="num">${row.day ? fmt(Number(row.day)) : "-"}</td>
          <td class="num">${row.hourly ? fmt(Number(row.hourly)) : "-"}</td>
          <td class="num">${row.nonRemunerative ? fmt(Number(row.nonRemunerative)) : "-"}</td>
        </tr>`).join("")}
      </tbody></table></div>` : `<div class="empty-state">leIA no detecto filas normalizadas. Podes editar el JSON antes de aprobar.</div>`}
      ${notes.length ? `<p class="scale-notes">${notes.map(escapeHtml).join(" | ")}</p>` : ""}
    </div>`;
  }

  function setScaleStatus(message, tone = "") {
    const status = $("scaleUploadStatus");
    if (!status) return;
    status.textContent = message;
    status.className = `scale-status ${tone}`.trim();
  }

  function syncScaleConvention() {
    const scaleSelect = $("scaleConvention");
    if (!scaleSelect || !DATA?.conventions) return;
    const current = scaleSelect.value || str("convention", "uocra");
    scaleSelect.innerHTML = Object.values(DATA.conventions)
      .map((conv) => `<option value="${conv.id}">${escapeHtml(conv.shortName || conv.name)}</option>`)
      .join("");
    scaleSelect.value = DATA.conventions[current] ? current : str("convention", "uocra");
    const period = $("scalePeriod");
    if (period && !period.value) period.value = selectedPeriodMonth();
  }

  async function fetchJson(path, options = {}) {
    const response = await fetch(apiUrl(path), options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    return payload;
  }

  async function refreshActiveScaleContext() {
    const conv = getConvention();
    const period = selectedPeriodMonth(conv);
    try {
      scaleState.activeForPayroll = await fetchJson(`/api/scales/active?conventionId=${encodeURIComponent(conv.id)}&period=${encodeURIComponent(period)}`);
    } catch (error) {
      scaleState.activeForPayroll = null;
    }
  }

  async function loadScaleDashboard() {
    const scaleSelect = $("scaleConvention");
    if (!scaleSelect) return;
    const conventionId = scaleSelect.value || str("convention", "uocra");
    try {
      const [recent, months] = await Promise.all([
        fetchJson(`/api/scales?conventionId=${encodeURIComponent(conventionId)}&limit=40`),
        fetchJson(`/api/scales/months?conventionId=${encodeURIComponent(conventionId)}`)
      ]);
      scaleState.recent = recent;
      scaleState.months = months;
      const period = $("scalePeriod")?.value || selectedPeriodMonth();
      scaleState.activeScale = months.find((item) => item.period === period)?.activeScale || months[0]?.activeScale || null;
      renderScaleDashboard();
      setScaleStatus("Escalas actualizadas.", "ok");
    } catch (error) {
      scaleState.recent = [];
      scaleState.months = [];
      renderScaleDashboard();
      setScaleStatus(`No pude cargar escalas: ${error.message}`, "bad");
    }
  }

  function renderScaleDashboard() {
    renderScaleAuditList();
    renderScaleMonths();
    const viewer = $("scaleActiveViewer");
    if (viewer && scaleState.activeScale) {
      viewer.className = "scale-active-viewer";
      viewer.innerHTML = scaleDetailHtml(scaleState.activeScale);
    } else if (viewer) {
      viewer.className = "scale-active-viewer empty-state";
      viewer.innerHTML = "Toca Escala vigente para ver el detalle aprobado.";
    }
  }

  function renderScaleAuditList() {
    const list = $("scaleAuditList");
    if (!list) return;
    const items = scaleState.recent.slice(0, 8);
    if (!items.length) {
      list.innerHTML = `<div class="empty-state">Todavia no hay escalas cargadas para este convenio.</div>`;
      renderScaleEditor(null);
      return;
    }
    list.innerHTML = items.map((scale) => `<button class="scale-audit-item ${scaleState.selected?.id === scale.id ? "active" : ""}" type="button" data-scale-id="${escapeHtml(scale.id)}">
      <span>
        <strong>${escapeHtml(scale.periodLabel || monthLabel(scale.period))}</strong>
        <small>${escapeHtml(scale.sourceFileName || "PDF de escala")}</small>
      </span>
      <em class="${scale.status === "APROBADA" ? "ok" : scale.status === "RECHAZADA" ? "bad" : ""}">${escapeHtml(statusLabel(scale.status))}</em>
    </button>`).join("");
    if (!scaleState.selected || !items.some((item) => item.id === scaleState.selected.id)) {
      renderScaleEditor(null);
    }
  }

  function downloadScaleJson(scale) {
    if (!scale) return;
    const jsonStr = JSON.stringify(scale.parsedScale || {}, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Escala_${scale.conventionId || 'escala'}_${scale.period || 'periodo'}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function downloadScaleExcel(scale) {
    if (!scale || !scale.parsedScale || !scale.parsedScale.categories) return;
    const data = [];
    data.push(["", "", "", "Exportar Montos Categorias"]);
    data.push([
      "convenio", "idcategoria", "denominacion", 
      "Asignación Mensual (conv10)", "Asignacion Jornal (suel10)", 
      "Adicional 1 (gara10)", "Adicional 2 (adic1)", "Adicional 3 (adic3)", 
      "Adicional 4 (adic4)", "Adicional 5 (adic5)", "Adicional 6 (adic6)", 
      "Adicional 7  (adic7)", "Adicional 8  (adic8)", "Adicional 9  (adic9)", "Adicional 10 (adic10)"
    ]);

    const convMap = { "uocra": 1, "farmacia": 2, "camioneros": 3 };
    const convIdNum = convMap[scale.conventionId] || 99;

    scale.parsedScale.categories.forEach((cat, index) => {
      const row = [
        convIdNum,
        index + 1,
        cat.label || "",
        Number(cat.monthly) || 0,
        Number(cat.day) || Number(cat.hourly) || 0,
        Number(cat.nonRemunerative) || 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0
      ];
      data.push(row);
    });
    
    if (typeof XLSX !== "undefined") {
      const ws = XLSX.utils.aoa_to_sheet(data);
      
      // Ajustar anchos de columna para que el Excel quede prolijo
      ws["!cols"] = [
        { wch: 10 }, // convenio
        { wch: 12 }, // idcategoria
        { wch: 45 }, // denominacion
        { wch: 25 }, // Asignación Mensual
        { wch: 25 }, // Asignacion Jornal
        { wch: 20 }, // Adicional 1
        { wch: 20 }, // Adicional 2
        { wch: 20 }, // Adicional 3
        { wch: 20 }, // Adicional 4
        { wch: 20 }, // Adicional 5
        { wch: 20 }, // Adicional 6
        { wch: 20 }, // Adicional 7
        { wch: 20 }, // Adicional 8
        { wch: 20 }, // Adicional 9
        { wch: 20 }  // Adicional 10
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Hoja1");
      const filename = `Escala_${scale.conventionId || 'escala'}_${scale.period || 'periodo'}.xlsx`;
      XLSX.writeFile(wb, filename);
    } else {
      console.error("XLSX library not loaded");
    }
  }

  function renderScaleEditor(scale) {
    const editor = $("scaleEditor");
    if (!editor) return;
    if (!scale) {
      editor.className = "scale-editor empty-state";
      editor.innerHTML = "Selecciona una escala pendiente para revisar.";
      return;
    }
    editor.className = "scale-editor";
    const json = JSON.stringify(scale.parsedScale || {}, null, 2);
    const isPending = scale.status === "PENDIENTE_REVISION";
    const isApproved = scale.status === "APROBADA";
    const helperText = scale.aiError || scale.parsedScale?.sourceSummary || (scale.status === "APROBADA"
      ? "Escala aprobada. Edita valores solo si detectas una correccion necesaria."
      : "Revision manual requerida");
    const editorActions = isApproved
      ? `<button class="icon-btn" id="enableScaleEditBtn" type="button">Editar valores</button>
      <button class="icon-btn" id="saveScaleDraftBtn" type="button" hidden>Guardar cambios</button>`
      : `<button class="icon-btn" id="saveScaleDraftBtn" type="button">Guardar edicion</button>`;
    const downloadActions = `<button class="icon-btn" id="downloadJsonBtn" type="button">Descargar JSON</button>
      <button class="icon-btn" id="downloadExcelBtn" type="button">Descargar Excel</button>`;
    const moderationActions = isPending
      ? `<button class="primary-action" id="approveScaleBtn" type="button">Aprobar escala</button>
      <button class="icon-btn danger" id="rejectScaleBtn" type="button">Rechazar</button>`
      : "";
    editor.innerHTML = `<div class="scale-editor-head">
      <div>
        <strong>${escapeHtml(scaleDisplayName(scale))}</strong>
        <span>${escapeHtml(helperText)}</span>
      </div>
      <span class="status-pill ${scale.status === "APROBADA" ? "ok" : scale.status === "RECHAZADA" ? "bad" : ""}">${escapeHtml(statusLabel(scale.status))}</span>
    </div>
    <textarea id="scaleJsonEditor" spellcheck="false" ${isApproved ? "readonly" : ""}>${escapeHtml(json)}</textarea>
    <div class="scale-editor-actions">
      ${downloadActions}
      ${editorActions}
      ${moderationActions}
    </div>
    <div class="scale-preview">${scaleDetailHtml(scale)}</div>`;

    $("enableScaleEditBtn")?.addEventListener("click", () => {
      const textarea = $("scaleJsonEditor");
      if (textarea) {
        textarea.readOnly = false;
        textarea.classList.add("editing");
        textarea.focus();
      }
      $("enableScaleEditBtn").hidden = true;
      const saveButton = $("saveScaleDraftBtn");
      if (saveButton) saveButton.hidden = false;
    });
    $("saveScaleDraftBtn")?.addEventListener("click", saveScaleDraft);
    $("approveScaleBtn")?.addEventListener("click", approveSelectedScale);
    $("rejectScaleBtn")?.addEventListener("click", rejectSelectedScale);
    $("downloadJsonBtn")?.addEventListener("click", () => downloadScaleJson(scale));
    $("downloadExcelBtn")?.addEventListener("click", () => downloadScaleExcel(scale));
  }

  function parseScaleEditorJson() {
    const raw = $("scaleJsonEditor")?.value || "{}";
    try {
      return JSON.parse(raw);
    } catch (error) {
      throw new Error("El JSON de la escala no es valido. Revisalo antes de guardar.");
    }
  }

  async function selectScaleForAudit(id) {
    try {
      const scale = scaleState.recent.find((item) => item.id === id) || await fetchJson(`/api/scales/${encodeURIComponent(id)}`);
      scaleState.selected = scale;
      renderScaleAuditList();
      renderScaleEditor(scale);
    } catch (error) {
      setScaleStatus(error.message, "bad");
    }
  }

  async function saveScaleDraft() {
    if (!scaleState.selected) return;
    try {
      const parsedScale = parseScaleEditorJson();
      scaleState.selected = await fetchJson(`/api/scales/${encodeURIComponent(scaleState.selected.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parsedScale })
      });
      await loadScaleDashboard();
      await selectScaleForAudit(scaleState.selected.id);
      setScaleStatus(scaleState.selected.status === "APROBADA" ? "Valores editados guardados en la escala aprobada." : "Edicion guardada para auditoria.", "ok");
    } catch (error) {
      setScaleStatus(error.message, "bad");
    }
  }

  async function approveSelectedScale() {
    if (!scaleState.selected) return;
    try {
      const parsedScale = parseScaleEditorJson();
      const approved = await fetchJson(`/api/scales/${encodeURIComponent(scaleState.selected.id)}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parsedScale })
      });
      scaleState.selected = approved;
      await refreshActiveScaleContext();
      await loadScaleDashboard();
      await selectScaleForAudit(approved.id);
      setScaleStatus("Escala aprobada. Ya es vigente para ese mes si es la ultima aprobada disponible.", "ok");
    } catch (error) {
      setScaleStatus(error.message, "bad");
    }
  }

  async function rejectSelectedScale() {
    if (!scaleState.selected) return;
    try {
      const rejected = await fetchJson(`/api/scales/${encodeURIComponent(scaleState.selected.id)}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      scaleState.selected = rejected;
      await loadScaleDashboard();
      await selectScaleForAudit(rejected.id);
      setScaleStatus("Escala rechazada y conservada como historial.", "ok");
    } catch (error) {
      setScaleStatus(error.message, "bad");
    }
  }

  function renderScaleMonths() {
    const list = $("scaleMonthList");
    if (!list) return;
    if (!scaleState.months.length) {
      list.innerHTML = `<div class="empty-state">No hay meses para mostrar.</div>`;
      return;
    }
    list.innerHTML = `<div class="scale-month-table">
      ${scaleState.months.map((item) => {
        const active = item.activeScale;
        const pending = (item.submissions || []).filter((scale) => scale.status === "PENDIENTE_REVISION").length;
        return `<div class="scale-month-row">
          <div>
            <strong>${escapeHtml(item.label || monthLabel(item.period))}</strong>
            <span>${active ? `Vigente: ${escapeHtml(active.periodLabel || monthLabel(active.period))}` : "Sin escala aprobada vigente"}</span>
          </div>
          <div>
            ${pending ? `<em>${pending} pendiente${pending === 1 ? "" : "s"}</em>` : `<em>Auditoria al dia</em>`}
            <button class="icon-btn" type="button" data-active-period="${escapeHtml(item.period)}" ${active ? "" : "disabled"}>Escala vigente</button>
          </div>
        </div>`;
      }).join("")}
    </div>`;
  }

  async function viewActiveScale(period) {
    const conventionId = $("scaleConvention")?.value || str("convention", "uocra");
    try {
      const active = await fetchJson(`/api/scales/active?conventionId=${encodeURIComponent(conventionId)}&period=${encodeURIComponent(period)}`);
      scaleState.activeScale = active;
      const viewer = $("scaleActiveViewer");
      if (viewer) {
        viewer.className = "scale-active-viewer";
        viewer.innerHTML = scaleDetailHtml(active);
      }
      setScaleStatus(`Escala vigente de ${monthLabel(period)} cargada.`, "ok");
    } catch (error) {
      const viewer = $("scaleActiveViewer");
      if (viewer) {
        viewer.className = "scale-active-viewer empty-state";
        viewer.innerHTML = error.message;
      }
      setScaleStatus(error.message, "bad");
    }
  }

  async function uploadScalePdf(event) {
    event.preventDefault();
    const file = $("scalePdf")?.files?.[0];
    const conventionId = $("scaleConvention")?.value || str("convention", "uocra");
    const period = $("scalePeriod")?.value || selectedPeriodMonth();
    if (!file) {
      setScaleStatus("Selecciona un PDF para analizar.", "bad");
      return;
    }
    const formData = new FormData();
    formData.append("pdf", file);
    formData.append("conventionId", conventionId);
    formData.append("period", period);
    formData.append("periodLabel", monthLabel(period));

    const button = $("uploadScaleBtn");
    if (button) button.disabled = true;
    setScaleStatus("Subiendo PDF y consultando a leIA...", "");
    try {
      const response = await fetch(apiUrl("/api/scales/upload"), {
        method: "POST",
        body: formData
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "No se pudo subir la escala.");
      const createdScales = Array.isArray(payload.created) && payload.created.length ? payload.created : [payload];
      const firstScale = createdScales[0];
      scaleState.selected = firstScale;
      $("scalePdf").value = "";
      await loadScaleDashboard();
      await selectScaleForAudit(firstScale.id);
      const periods = createdScales.map((scale) => scale.periodLabel || monthLabel(scale.period)).join(", ");
      const pluralMsg = createdScales.length === 1
        ? "leIA creo 1 escala pendiente."
        : `leIA creo ${createdScales.length} escalas pendientes: ${periods}.`;
      setScaleStatus(payload.aiStatus === "DETECTADA_POR_IA" ? `${pluralMsg} Revisalas y aprobalas por separado.` : `${pluralMsg} Revisar advertencia de IA.`, payload.aiStatus === "DETECTADA_POR_IA" ? "ok" : "bad");
    } catch (error) {
      setScaleStatus(error.message, "bad");
    } finally {
      if (button) button.disabled = false;
    }
  }

  function setupScaleDashboard() {
    syncScaleConvention();
    $("scaleUploadForm")?.addEventListener("submit", uploadScalePdf);
    $("refreshScalesBtn")?.addEventListener("click", loadScaleDashboard);
    $("scaleConvention")?.addEventListener("change", () => {
      scaleState.selected = null;
      loadScaleDashboard();
    });
    $("scalePeriod")?.addEventListener("change", () => {
      const period = $("scalePeriod")?.value;
      if (period) viewActiveScale(period);
    });
    $("scaleAuditList")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-scale-id]");
      if (button) selectScaleForAudit(button.dataset.scaleId);
    });
    $("scaleMonthList")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-active-period]");
      if (button) viewActiveScale(button.dataset.activePeriod);
    });
    $("auditResult")?.addEventListener("click", (event) => {
      const actionButton = event.target.closest("[data-autopilot-action]");
      if (actionButton) {
        handleAutopilotAction(actionButton);
        return;
      }
      const button = event.target.closest("[data-run-audit]");
      if (button && lastResult) runLiquidationAudit();
    });
    loadScaleDashboard();
    refreshActiveScaleContext();
  }

  function setConventionBuilderStatus(message, tone = "") {
    const status = $("conventionBuilderStatus");
    if (!status) return;
    status.textContent = message;
    status.className = `scale-status ${tone}`.trim();
  }

  async function loadConventionDrafts() {
    const list = $("conventionDraftList");
    if (!list) return;
    try {
      conventionBuilderState.drafts = await fetchJson("/api/convention-drafts?limit=60");
      renderConventionDrafts();
      setConventionBuilderStatus("Convenios IA actualizados.", "ok");
    } catch (error) {
      conventionBuilderState.drafts = [];
      renderConventionDrafts();
      setConventionBuilderStatus(`No pude cargar convenios: ${error.message}`, "bad");
    }
  }

  function conventionDraftStatusLabel(status) {
    const labels = {
      PENDIENTE_REVISION: "Pendiente",
      APROBADO: "Aprobado",
      RECHAZADO: "Rechazado"
    };
    return labels[status] || status || "-";
  }

  function renderConventionDrafts() {
    const list = $("conventionDraftList");
    if (!list) return;
    const items = conventionBuilderState.drafts.slice(0, 10);
    if (!items.length) {
      list.innerHTML = `<div class="empty-state">Todavia no hay convenios estructurados por leIA.</div>`;
      renderConventionJsonEditor(null);
      return;
    }
    list.innerHTML = items.map((draft) => {
      const conv = draft.parsedConvention || {};
      const statusClass = draft.status === "APROBADO" ? "ok" : draft.status === "RECHAZADO" ? "bad" : "";
      const canDelete = ["APROBADO", "RECHAZADO"].includes(draft.status);
      return `<div class="convention-draft-row ${conventionBuilderState.selected?.id === draft.id ? "active" : ""}">
        <button class="scale-audit-item ${conventionBuilderState.selected?.id === draft.id ? "active" : ""}" type="button" data-convention-draft-id="${escapeHtml(draft.id)}">
          <span>
            <strong>${escapeHtml(conv.shortName || conv.name || draft.name)}</strong>
            <small>${escapeHtml(conv.source || draft.files?.[0]?.originalName || "CCT + escala")}</small>
          </span>
          <em class="${statusClass}">${escapeHtml(conventionDraftStatusLabel(draft.status))}</em>
        </button>
        ${canDelete ? `<button class="convention-draft-trash" type="button" data-delete-convention-draft-id="${escapeHtml(draft.id)}" aria-label="Eliminar borrador ${escapeHtml(conv.shortName || conv.name || draft.name)}">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 6h18"></path>
            <path d="M8 6V4h8v2"></path>
            <path d="M19 6l-1 14H6L5 6"></path>
            <path d="M10 11v5"></path>
            <path d="M14 11v5"></path>
          </svg>
        </button>` : ""}
      </div>`;
    }).join("");
    if (!conventionBuilderState.selected || !items.some((item) => item.id === conventionBuilderState.selected.id)) {
      renderConventionJsonEditor(null);
    }
  }

  function conventionQualityHtml(conv = {}) {
    const warnings = conv.warnings || [];
    const checklist = conv.auditChecklist || [];
    return `<div class="scale-mini-grid">
      <div><span>Confianza</span><strong>${Number(conv.confidence || 0)}%</strong></div>
      <div><span>Categorias</span><strong>${(conv.categories || []).length}</strong></div>
      <div><span>Conceptos</span><strong>${(conv.liquidationModel?.concepts || []).length}</strong></div>
      <div><span>Alertas</span><strong>${warnings.length}</strong></div>
    </div>
    ${warnings.length ? `<div class="scale-warning">${warnings.map(escapeHtml).join("<br>")}</div>` : `<div class="scale-summary">Sin alertas criticas detectadas por leIA.</div>`}
    ${checklist.length ? `<div class="convention-checklist">${checklist.slice(0, 8).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>` : ""}`;
  }

  function renderConventionJsonEditor(draft) {
    const editor = $("conventionJsonEditor");
    if (!editor) return;
    if (!draft) {
      editor.className = "scale-editor empty-state";
      editor.innerHTML = "Seleccion&aacute; un convenio generado para revisar su JSON.";
      return;
    }
    const conv = draft.parsedConvention || {};
    const isPending = draft.status === "PENDIENTE_REVISION";
    editor.className = "scale-editor convention-json-editor";
    editor.innerHTML = `<div class="scale-editor-head">
      <div>
        <strong>${escapeHtml(conv.name || draft.name)}</strong>
        <span>${escapeHtml(draft.aiError || "JSON ejecutable generado por leIA. Revisalo antes de aprobar.")}</span>
      </div>
      <span class="status-pill ${draft.status === "APROBADO" ? "ok" : draft.status === "RECHAZADO" ? "bad" : ""}">${escapeHtml(conventionDraftStatusLabel(draft.status))}</span>
    </div>
    <textarea id="conventionJsonText" spellcheck="false" ${draft.status === "APROBADO" ? "readonly" : ""}>${escapeHtml(JSON.stringify(conv, null, 2))}</textarea>
    <div class="scale-editor-actions">
      <button class="icon-btn" id="downloadConventionJsonBtn" type="button">Descargar JSON</button>
      <button class="icon-btn" id="saveConventionJsonBtn" type="button" ${draft.status === "APROBADO" ? "disabled" : ""}>Guardar JSON</button>
      ${isPending ? `<button class="primary-action" id="approveConventionDraftBtn" type="button">Aprobar y activar convenio</button>
      <button class="icon-btn danger" id="rejectConventionDraftBtn" type="button">Rechazar</button>` : `<button class="convention-draft-trash is-inline" id="deleteConventionDraftBtn" type="button" aria-label="Eliminar borrador">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 6h18"></path>
          <path d="M8 6V4h8v2"></path>
          <path d="M19 6l-1 14H6L5 6"></path>
          <path d="M10 11v5"></path>
          <path d="M14 11v5"></path>
        </svg>
        Eliminar
      </button>`}
    </div>
    <div class="scale-preview">${conventionQualityHtml(conv)}</div>`;

    $("downloadConventionJsonBtn")?.addEventListener("click", () => downloadConventionJson(draft));
    $("saveConventionJsonBtn")?.addEventListener("click", saveConventionDraftJson);
    $("approveConventionDraftBtn")?.addEventListener("click", approveConventionDraft);
    $("rejectConventionDraftBtn")?.addEventListener("click", rejectConventionDraft);
    $("deleteConventionDraftBtn")?.addEventListener("click", () => deleteConventionDraft(draft.id));
  }

  function parseConventionJsonEditor() {
    const raw = $("conventionJsonText")?.value || "{}";
    try {
      return JSON.parse(raw);
    } catch (error) {
      throw new Error("El JSON del convenio no es valido. Revisalo antes de guardar.");
    }
  }

  function downloadConventionJson(draft) {
    const conv = draft?.parsedConvention || {};
    const blob = new Blob([JSON.stringify(conv, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Convenio_${conv.id || "leia"}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function selectConventionDraft(id) {
    try {
      const draft = conventionBuilderState.drafts.find((item) => item.id === id) || await fetchJson(`/api/convention-drafts/${encodeURIComponent(id)}`);
      conventionBuilderState.selected = draft;
      renderConventionDrafts();
      renderConventionJsonEditor(draft);
    } catch (error) {
      setConventionBuilderStatus(error.message, "bad");
    }
  }

  async function saveConventionDraftJson() {
    if (!conventionBuilderState.selected) return;
    try {
      const parsedConvention = parseConventionJsonEditor();
      conventionBuilderState.selected = await fetchJson(`/api/convention-drafts/${encodeURIComponent(conventionBuilderState.selected.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parsedConvention })
      });
      await loadConventionDrafts();
      await selectConventionDraft(conventionBuilderState.selected.id);
      setConventionBuilderStatus("JSON guardado y normalizado para liquidar.", "ok");
    } catch (error) {
      setConventionBuilderStatus(error.message, "bad");
    }
  }

  async function approveConventionDraft() {
    if (!conventionBuilderState.selected) return;
    try {
      const parsedConvention = parseConventionJsonEditor();
      const payload = await fetchJson(`/api/convention-drafts/${encodeURIComponent(conventionBuilderState.selected.id)}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parsedConvention })
      });
      conventionBuilderState.selected = payload.draft;
      await loadCatalog();
      syncScaleConvention();
      updateConventionSelectsAfterCatalogReload(payload.convention?.id);
      await loadConventionDrafts();
      await selectConventionDraft(payload.draft.id);
      setConventionBuilderStatus("Convenio aprobado. Ya esta disponible en Sueldos y Escalas.", "ok");
    } catch (error) {
      setConventionBuilderStatus(error.message, "bad");
    }
  }

  async function rejectConventionDraft() {
    if (!conventionBuilderState.selected) return;
    try {
      const rejected = await fetchJson(`/api/convention-drafts/${encodeURIComponent(conventionBuilderState.selected.id)}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      conventionBuilderState.selected = rejected;
      await loadConventionDrafts();
      await selectConventionDraft(rejected.id);
      setConventionBuilderStatus("Borrador rechazado y conservado como historial.", "ok");
    } catch (error) {
      setConventionBuilderStatus(error.message, "bad");
    }
  }

  async function deleteConventionDraft(id) {
    const draft = conventionBuilderState.drafts.find((item) => item.id === id)
      || (conventionBuilderState.selected?.id === id ? conventionBuilderState.selected : null);
    const status = conventionDraftStatusLabel(draft?.status);
    if (!draft || !["APROBADO", "RECHAZADO"].includes(draft.status)) {
      setConventionBuilderStatus("Solo se pueden eliminar borradores aprobados o rechazados.", "bad");
      return;
    }
    const name = draft.parsedConvention?.shortName || draft.parsedConvention?.name || draft.name || "este borrador";
    if (!confirm(`Eliminar ${name} (${status}) de la auditoria humana? Esta accion no se puede deshacer.`)) return;
    try {
      await fetchJson(`/api/convention-drafts/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (conventionBuilderState.selected?.id === id) {
        conventionBuilderState.selected = null;
        renderConventionJsonEditor(null);
      }
      await loadConventionDrafts();
      setConventionBuilderStatus(`Borrador ${status.toLowerCase()} eliminado.`, "ok");
    } catch (error) {
      setConventionBuilderStatus(error.message, "bad");
    }
  }

  async function deleteConventionDraftsByStatus(status) {
    const allowedStatuses = {
      APROBADO: "aprobados",
      RECHAZADO: "rechazados"
    };
    const label = allowedStatuses[status];
    if (!label) return;

    const drafts = conventionBuilderState.drafts.filter((draft) => draft.status === status);
    if (!drafts.length) {
      setConventionBuilderStatus(`No hay borradores ${label} para eliminar.`, "bad");
      return;
    }

    const question = `Eliminar ${drafts.length} borrador${drafts.length === 1 ? "" : "es"} ${label} de la auditoria humana? Esta accion no se puede deshacer.`;
    if (!confirm(question)) return;

    const approvedButton = $("deleteApprovedDraftsBtn");
    const rejectedButton = $("deleteRejectedDraftsBtn");
    [approvedButton, rejectedButton].forEach((button) => {
      if (button) button.disabled = true;
    });
    setConventionBuilderStatus(`Eliminando ${drafts.length} borrador${drafts.length === 1 ? "" : "es"} ${label}...`, "");

    const results = await Promise.allSettled(
      drafts.map((draft) => fetchJson(`/api/convention-drafts/${encodeURIComponent(draft.id)}`, { method: "DELETE" }))
    );
    const deletedIds = new Set(
      results
        .map((result, index) => result.status === "fulfilled" ? drafts[index].id : null)
        .filter(Boolean)
    );

    if (conventionBuilderState.selected && deletedIds.has(conventionBuilderState.selected.id)) {
      conventionBuilderState.selected = null;
      renderConventionJsonEditor(null);
    }

    await loadConventionDrafts();
    [approvedButton, rejectedButton].forEach((button) => {
      if (button) button.disabled = false;
    });

    const failed = results.filter((result) => result.status === "rejected");
    if (failed.length) {
      setConventionBuilderStatus(`Se eliminaron ${deletedIds.size} y fallaron ${failed.length}. Revisar conexion/backend.`, "bad");
      return;
    }
    setConventionBuilderStatus(`Se eliminaron ${deletedIds.size} borrador${deletedIds.size === 1 ? "" : "es"} ${label}.`, "ok");
  }

  function updateConventionSelectsAfterCatalogReload(preferredId = "") {
    const selectedId = preferredId || str("convention", "camioneros");
    const conventionSelect = $("convention");
    if (conventionSelect) {
      conventionSelect.innerHTML = Object.values(DATA.conventions)
        .map((conv) => `<option value="${conv.id}">${escapeHtml(conv.name)}</option>`)
        .join("");
      conventionSelect.value = DATA.conventions[selectedId] ? selectedId : (DATA.conventions.camioneros ? "camioneros" : Object.keys(DATA.conventions)[0]);
      updateConvention();
    }
    const empConvention = $("empConvention");
    if (empConvention) {
      empConvention.innerHTML = Object.values(DATA.conventions)
        .map((conv) => `<option value="${conv.id}">${escapeHtml(conv.name)}</option>`)
        .join("");
    }
  }

  async function uploadConventionDraft(event) {
    event.preventDefault();
    const cctFile = $("builderCctPdf")?.files?.[0];
    const scaleFile = $("builderScalePdf")?.files?.[0];
    if (!cctFile && !scaleFile) {
      setConventionBuilderStatus("Subi al menos un PDF de CCT o escala.", "bad");
      return;
    }
    const formData = new FormData();
    if (cctFile) formData.append("cctPdf", cctFile);
    if (scaleFile) formData.append("scalePdf", scaleFile);
    formData.append("name", $("builderConventionName")?.value || "");
    formData.append("notes", $("builderNotes")?.value || "");

    const button = $("buildConventionBtn");
    if (button) button.disabled = true;
    setConventionBuilderStatus("leIA esta estructurando el convenio en JSON ejecutable...", "");
    try {
      const response = await fetch(apiUrl("/api/convention-drafts/upload"), {
        method: "POST",
        body: formData
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "No se pudo estructurar el convenio.");
      conventionBuilderState.selected = payload;
      if ($("builderCctPdf")) $("builderCctPdf").value = "";
      if ($("builderScalePdf")) $("builderScalePdf").value = "";
      await loadConventionDrafts();
      await selectConventionDraft(payload.id);
      setConventionBuilderStatus(payload.aiStatus === "ESTRUCTURADO_POR_LEIA" ? "Convenio estructurado. Revisalo y aproba cuando este perfecto." : "Borrador creado con advertencias. Revisar JSON.", payload.aiStatus === "ESTRUCTURADO_POR_LEIA" ? "ok" : "bad");
    } catch (error) {
      setConventionBuilderStatus(error.message, "bad");
    } finally {
      if (button) button.disabled = false;
    }
  }

  function setupConventionBuilder() {
    $("conventionBuilderForm")?.addEventListener("submit", uploadConventionDraft);
    $("refreshConventionDraftsBtn")?.addEventListener("click", loadConventionDrafts);
    $("deleteApprovedDraftsBtn")?.addEventListener("click", () => deleteConventionDraftsByStatus("APROBADO"));
    $("deleteRejectedDraftsBtn")?.addEventListener("click", () => deleteConventionDraftsByStatus("RECHAZADO"));
    $("conventionDraftList")?.addEventListener("click", (event) => {
      const deleteButton = event.target.closest("[data-delete-convention-draft-id]");
      if (deleteButton) {
        event.preventDefault();
        event.stopPropagation();
        deleteConventionDraft(deleteButton.dataset.deleteConventionDraftId);
        return;
      }
      const button = event.target.closest("[data-convention-draft-id]");
      if (button) selectConventionDraft(button.dataset.conventionDraftId);
    });
    loadConventionDrafts();
  }



  function collectLeiaParameters() {
    const fields = {};
    document.querySelectorAll("#dynamicFields input, #dynamicFields select").forEach((field) => {
      fields[field.id] = field.type === "checkbox" ? field.checked : field.value;
    });
    return fields;
  }

  function buildLeiaState() {
    const conv = getConvention();
    const category = getCategory(conv);
    const zone = getZone(conv);
    const periodId = getPeriod(conv);
    const period = conv.periods.find((item) => item.id === periodId) || conv.periods[0];

    return {
      currentStep,
      convention: {
        id: conv.id,
        name: conv.name,
        shortName: conv.shortName,
        source: conv.source
      },
      period: {
        id: period?.id || periodId,
        label: period?.label || periodId
      },
      category: {
        id: category?.id,
        label: category?.label
      },
      zone: {
        id: zone?.id,
        label: zone?.label,
        coef: zone?.coef
      },
      worker: {
        seniorityYears: num("seniorityYears"),
        manualRemunerative: num("manualRem"),
        manualNonRemunerative: num("manualNoRem"),
        manualDeduction: num("manualDeduction")
      },
      parameters: collectLeiaParameters(),
      scaleAudit: {
        activeForPayroll: scaleState.activeForPayroll ? {
          id: scaleState.activeForPayroll.id,
          period: scaleState.activeForPayroll.period,
          periodLabel: scaleState.activeForPayroll.periodLabel,
          status: scaleState.activeForPayroll.status,
          approvedAt: scaleState.activeForPayroll.approvedAt,
          summary: scaleState.activeForPayroll.parsedScale?.sourceSummary || "",
          confidence: scaleState.activeForPayroll.parsedScale?.confidence || 0,
          categories: (scaleState.activeForPayroll.parsedScale?.categories || []).slice(0, 20)
        } : null
      },
      lastLiquidation: lastResult ? {
        convention: lastResult.conv.shortName || lastResult.conv.name,
        period: lastResult.conv.periods.find((item) => item.id === lastResult.period)?.label || lastResult.period,
        category: lastResult.category.label,
        zone: lastResult.zone.label,
        totals: lastResult.totals,
        remunerative: lastResult.remRows,
        nonRemunerative: lastResult.noRemRows,
        deductions: lastResult.deductionRows,
        employer: lastResult.employerRows
      } : null
    };
  }

  function syncLeiaContext() {
    const context = $("leiaContext");
    const launcherContext = $("leiaLauncherContext");
    if (!context || !DATA?.conventions) return;
    const conv = getConvention();
    const label = conv.shortName || conv.name;
    context.textContent = `Experta en ${label}`;
    if (launcherContext) launcherContext.textContent = label;
  }

  function parseInlineMarkdown(text) {
    // Bold: **text** o __text__
    text = text.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/__(.*?)__/g, "<strong>$1</strong>");
    // Italic: *text* o _text_
    text = text.replace(/\*(.*?)\*/g, "<em>$1</em>");
    text = text.replace(/_(.*?)_/g, "<em>$1</em>");
    // Inline code: `code`
    text = text.replace(/`(.*?)`/g, "<code>$1</code>");
    return text;
  }

  function parseMarkdown(text) {
    if (!text) return "";
    let html = escapeHtml(text);
    
    // Separar por párrafos (doble salto de línea)
    const paragraphs = html.split(/\n\n+/);
    
    return paragraphs.map(p => {
      p = p.trim();
      if (!p) return "";
      
      const lines = p.split(/\n/);
      
      // Detectar si el bloque completo es una lista
      const isList = lines.every(line => /^\s*([-*]|\d+\.)\s+/.test(line));
      
      if (isList) {
        const listItems = lines.map(line => {
          const content = line.replace(/^\s*([-*]|\d+\.)\s+/, "");
          return `<li>${parseInlineMarkdown(content)}</li>`;
        }).join("");
        const isNumbered = /^\s*\d+\.\s+/.test(lines[0]);
        return isNumbered ? `<ol>${listItems}</ol>` : `<ul>${listItems}</ul>`;
      } else {
        // Texto plano con saltos de línea simples
        const content = lines.map(line => parseInlineMarkdown(line)).join("<br>");
        return `<p>${content}</p>`;
      }
    }).join("");
  }

  function leiaConventionList() {
    return Object.values(DATA?.conventions || {})
      .filter((conv) => conv && conv.id && conv.name);
  }

  function appendLeiaActionPanel({ title, detail = "", buttons = [] }) {
    const messages = $("leiaMessages");
    if (!messages) return;
    const panel = document.createElement("div");
    panel.className = "leia-action-panel";
    panel.innerHTML = `
      <div class="leia-action-title">${escapeHtml(title)}</div>
      ${detail ? `<div class="leia-action-detail">${escapeHtml(detail)}</div>` : ""}
      <div class="leia-action-grid">
        ${buttons.map((button) => `
          <button class="leia-action-chip ${button.variant ? `is-${escapeHtml(button.variant)}` : ""}" type="button" ${button.attrs || ""}>
            <span>${escapeHtml(button.label)}</span>
            ${button.detail ? `<small>${escapeHtml(button.detail)}</small>` : ""}
          </button>
        `).join("")}
      </div>
    `;
    messages.appendChild(panel);
    messages.scrollTop = messages.scrollHeight;
  }

  function renderLeiaMainMenu() {
    appendLeiaActionPanel({
      title: "Consulta rapida por convenio",
      detail: "Elegi un tema y despues selecciona el convenio. La respuesta sale del catalogo cargado en el sistema.",
      buttons: leiaGuidedTopics.map((topic) => ({
        label: topic.label,
        detail: topic.detail,
        attrs: `data-leia-topic="${escapeHtml(topic.id)}"`
      }))
    });
  }

  function renderLeiaConventionPicker(topicId) {
    const topic = leiaGuidedTopics.find((item) => item.id === topicId);
    const conventions = leiaConventionList();
    if (!topic || !conventions.length) {
      renderLeiaMessage("model", "No encontre convenios cargados en el catalogo. Si estas usando MongoDB, verifica que el backend este iniciado y que `/api/catalog` responda correctamente.");
      return;
    }

    appendLeiaActionPanel({
      title: `Sobre que convenio queres ver ${topic.label.toLowerCase()}?`,
      detail: `${conventions.length} convenio${conventions.length !== 1 ? "s" : ""} disponible${conventions.length !== 1 ? "s" : ""}.`,
      buttons: [
        ...conventions.map((conv) => ({
          label: conv.shortName || conv.name,
          detail: conv.source || conv.name,
          attrs: `data-leia-topic-convention="${escapeHtml(topic.id)}" data-leia-convention-id="${escapeHtml(conv.id)}"`
        })),
        {
          label: "Volver al menu",
          detail: "Elegir otro tipo de consulta",
          variant: "secondary",
          attrs: "data-leia-menu"
        }
      ]
    });
  }

  function latestConventionPeriod(conv) {
    const periods = Array.isArray(conv?.periods) ? conv.periods : [];
    const selected = conv?.id === getConvention()?.id ? getPeriod(conv) : "";
    return periods.find((period) => period.id === selected) || periods[periods.length - 1] || null;
  }

  function firstConventionZone(conv) {
    return Array.isArray(conv?.zones) && conv.zones.length ? conv.zones[0] : null;
  }

  function moneyOrDash(value) {
    const number = Number(value);
    return Number.isFinite(number) && number !== 0 ? fmt(number) : "-";
  }

  function firstMoneyValue(...values) {
    for (const value of values) {
      if (typeof value === "boolean") continue;
      const number = Number(value);
      if (Number.isFinite(number) && number > 0) return number;
    }
    return null;
  }

  function rowAmountForSummary({ conv, category, periodId, zone, activeScale }) {
    const activeRow = activeScale ? findScaleRow(activeScale.parsedScale?.categories, category, zone) : null;
    const scaleZone = zone?.id && conv.scales?.[periodId]?.[zone.id] ? conv.scales[periodId][zone.id] : null;
    const scaleZoneAmount = scaleZone?.[category.id];
    const monthly = firstMoneyValue(
      activeRow?.monthly,
      periodAmountValue(activeRow, periodId, ["monthlyByPeriod", "monthlyByPeriodo", "basicoPorPeriodo"]),
      periodAmountValue(category, periodId, ["monthlyByPeriod", "monthlyByPeriodo", "basicoPorPeriodo"]),
      category.monthly === true ? scaleZoneAmount : null,
      category.monthly
    );
    const day = firstMoneyValue(
      activeRow?.day,
      periodAmountValue(activeRow, periodId, ["dayByPeriod", "jornalPorPeriodo", "valorDiaPorPeriodo"]),
      periodAmountValue(category, periodId, ["dayByPeriod", "jornalPorPeriodo", "valorDiaPorPeriodo"]),
      category.monthly === false ? scaleZoneAmount : null,
      category.day
    );
    const hourly = firstMoneyValue(
      activeRow?.hourly,
      periodAmountValue(activeRow, periodId, ["hourlyByPeriod", "horaPorPeriodo", "valorHoraPorPeriodo"]),
      periodAmountValue(category, periodId, ["hourlyByPeriod", "horaPorPeriodo", "valorHoraPorPeriodo"]),
      category.hourly
    );
    const nonRem = firstMoneyValue(
      activeRow?.nonRemunerative,
      periodNonRemValue(activeRow, periodId),
      periodNonRemValue(category, periodId),
      conv.nonRem?.[periodId]?.[zone?.id]?.[category.id]
    );
    const parts = [];
    if (monthly) parts.push(`mensual ${moneyOrDash(monthly)}`);
    if (day) parts.push(`jornal ${moneyOrDash(day)}`);
    if (hourly) parts.push(`hora ${moneyOrDash(hourly)}`);
    if (nonRem) parts.push(`no rem. ${moneyOrDash(nonRem)}`);
    return parts.join(" | ") || "sin importe cargado";
  }

  async function fetchActiveScaleForConvention(conv, periodId) {
    const period = periodIdToMonth(periodId) || periodId || currentMonthValue();
    if (!conv?.id || !period) return null;
    if (scaleState.activeForPayroll?.conventionId === conv.id && scaleState.activeForPayroll?.period === period) {
      return scaleState.activeForPayroll;
    }
    try {
      return await fetchJson(`/api/scales/active?conventionId=${encodeURIComponent(conv.id)}&period=${encodeURIComponent(period)}`);
    } catch (error) {
      return null;
    }
  }

  function conventionSourceLine(conv, activeScale) {
    const source = [`Catalogo: ${conv.source || conv.name}`];
    if (activeScale) {
      source.push(`Escala aprobada: ${activeScale.periodLabel || monthLabel(activeScale.period)}${activeScale.approvedAt ? `, aprobada el ${shortDate(activeScale.approvedAt)}` : ""}`);
    } else {
      source.push("Escala aprobada: no disponible para este periodo; muestro la base cargada en el catalogo.");
    }
    return source.join("\n");
  }

  function formatCategoryLines(conv, periodId, activeScale, limit = 12) {
    const zone = firstConventionZone(conv);
    const categories = Array.isArray(conv.categories) ? conv.categories : [];
    return categories.slice(0, limit).map((category) => (
      `- **${category.label || category.id}**: ${rowAmountForSummary({ conv, category, periodId, zone, activeScale })}`
    ));
  }

  function formatAdditionals(conv, periodId, activeScale) {
    const rows = [];
    Object.entries(conv.additionals || {}).forEach(([key, item]) => {
      const activeRow = activeScale ? findScaleRow(activeScale.parsedScale?.additionals, { id: key, label: item.label }, null) : null;
      const monthly = firstFinite(activeRow?.monthly, item.monthly);
      const day = firstFinite(activeRow?.day, item.day);
      const hourly = firstFinite(activeRow?.hourly, item.hourly);
      const nonRem = firstFinite(activeRow?.nonRemunerative, periodNonRemValue(item, periodId));
      const parts = [monthly && `mensual ${moneyOrDash(monthly)}`, day && `jornal ${moneyOrDash(day)}`, hourly && `hora ${moneyOrDash(hourly)}`, nonRem && `no rem. ${moneyOrDash(nonRem)}`].filter(Boolean);
      rows.push(`- **${item.label || key}**: ${parts.join(" | ") || "configurado sin importe fijo"}`);
    });
    Object.entries(conv.items || {}).forEach(([key, value]) => {
      if (typeof value === "number") rows.push(`- **${key}**: ${moneyOrDash(value)}`);
      else if (key.toLowerCase().includes("pct")) rows.push(`- **${key}**: ${value}%`);
    });
    (conv.liquidationModel?.concepts || []).forEach((concept) => {
      const value = concept.calculation === "fixed"
        ? moneyOrDash(conceptPeriodAmount(concept, periodId, ["amountByPeriod", "amountPorPeriodo"], concept.amount))
        : concept.calculation === "amountPerUnit"
          ? `${moneyOrDash(conceptPeriodAmount(concept, periodId, ["unitAmountByPeriod", "valorUnidadPorPeriodo"], concept.unitAmount || concept.amount))} por unidad`
          : `${Number(concept.percent || 0)}% sobre ${concept.base || "base"}`;
      rows.push(`- **${concept.label}**: ${value}`);
    });
    return rows.length ? rows.slice(0, 18) : ["- No hay adicionales parametrizados para este convenio."];
  }

  function formatDeductions(conv) {
    const rows = [
      `- Jubilacion: ${((DATA.constants?.worker?.jubilacion || 0.11) * 100).toLocaleString("es-AR")}%`,
      `- Ley 19032 / PAMI: ${((DATA.constants?.worker?.pami || 0.03) * 100).toLocaleString("es-AR")}%`,
      `- Obra social: ${((DATA.constants?.worker?.obraSocial || 0.03) * 100).toLocaleString("es-AR")}%`
    ];
    (conv.liquidationModel?.deductions || []).forEach((item) => {
      rows.push(`- **${item.label}**: ${item.percent ? `${item.percent}%` : moneyOrDash(item.amount)} sobre ${item.base || "remunerativo"}`);
    });
    if (conv.id === "camioneros") {
      rows.push("- Camioneros: cuota sindical, contribucion solidaria y seguro de sepelio segun parametros activos.");
    }
    if (conv.id === "farmacia") {
      rows.push("- Farmacia Mendoza: ADEF, sindicato, caja compensadora y pro edificio segun parametros del convenio.");
    }
    return rows;
  }

  function formatRules(conv) {
    const modelRules = conv.liquidationModel?.rules || {};
    const rules = { ...(conv.rules || {}), ...modelRules };
    const rows = [
      `- Tipo de liquidacion: ${conv.type || rules.salaryType || "mensual"}`,
      `- Jornada semanal: ${rules.weeklyHours || conv.rules?.weeklyHours || "no especificada"} horas`,
      `- Divisor mensual: ${rules.monthDivisor || rules.dayDivisor || "no especificado"}`,
      `- Divisor hora: ${rules.overtime?.divisor || rules.hourDivisor || "no especificado"}`
    ];
    if (modelRules.seniority?.enabled !== false) rows.push(`- Antiguedad: ${modelRules.seniority?.percentPerYear || conv.items?.antiguedadPct || "segun convenio"}% por anio cuando corresponde.`);
    if (modelRules.presentism?.enabled || conv.items?.presentismoPct || conv.rules?.presentismoPct) rows.push(`- Presentismo: ${modelRules.presentism?.percent || conv.items?.presentismoPct || conv.rules?.presentismoPct || "segun convenio"}%.`);
    (conv.auditChecklist || []).slice(0, 6).forEach((item) => rows.push(`- Control: ${item}`));
    return rows;
  }

  async function buildLeiaGuidedAnswer(topicId, conventionId) {
    const topic = leiaGuidedTopics.find((item) => item.id === topicId);
    const conv = DATA.conventions?.[conventionId];
    if (!topic || !conv) return "No pude encontrar ese tema o convenio en el catalogo actual.";
    const period = latestConventionPeriod(conv);
    const periodId = period?.id || currentMonthValue();
    const activeScale = await fetchActiveScaleForConvention(conv, periodId);
    const header = [
      `**${topic.label} - ${conv.name}**`,
      `Periodo de referencia: ${period?.label || monthLabel(periodIdToMonth(periodId) || periodId)}`,
      conventionSourceLine(conv, activeScale)
    ];

    if (topicId === "scales") {
      const lines = [
        ...header,
        "",
        `Categorias cargadas: ${(conv.categories || []).length}. Zonas: ${(conv.zones || []).map((zone) => zone.label).join(", ") || "sin zonas"}.`,
        activeScale?.parsedScale?.sourceSummary ? `Resumen de escala aprobada: ${activeScale.parsedScale.sourceSummary}` : "",
        "",
        ...formatCategoryLines(conv, periodId, activeScale, 10)
      ].filter(Boolean);
      return lines.join("\n");
    }

    if (topicId === "categories") {
      return [
        ...header,
        "",
        ...formatCategoryLines(conv, periodId, activeScale, 20),
        (conv.categories || []).length > 20 ? `\nMostre las primeras 20 de ${(conv.categories || []).length} categorias cargadas.` : ""
      ].filter(Boolean).join("\n");
    }

    if (topicId === "additionals") {
      return [...header, "", ...formatAdditionals(conv, periodId, activeScale)].join("\n");
    }

    if (topicId === "zones") {
      const zones = (conv.zones || []).map((zone) => `- **${zone.label || zone.id}**: coeficiente ${Number(zone.coef || 1).toLocaleString("es-AR")}`);
      return [...header, "", ...(zones.length ? zones : ["- Sin zonas cargadas."])].join("\n");
    }

    if (topicId === "deductions") {
      return [...header, "", ...formatDeductions(conv)].join("\n");
    }

    if (topicId === "rules") {
      return [...header, "", ...formatRules(conv)].join("\n");
    }

    return "Ese item todavia no tiene una vista guiada disponible.";
  }

  async function handleLeiaGuidedAction(event) {
    const topicButton = event.target.closest("[data-leia-topic]");
    const conventionButton = event.target.closest("[data-leia-topic-convention]");
    const menuButton = event.target.closest("[data-leia-menu]");
    if (menuButton) {
      renderLeiaMainMenu();
      return;
    }
    if (topicButton) {
      const topic = leiaGuidedTopics.find((item) => item.id === topicButton.dataset.leiaTopic);
      if (!topic) return;
      renderLeiaMessage("user", topic.label);
      renderLeiaConventionPicker(topic.id);
      return;
    }
    if (conventionButton) {
      const topic = leiaGuidedTopics.find((item) => item.id === conventionButton.dataset.leiaTopicConvention);
      const conv = DATA.conventions?.[conventionButton.dataset.leiaConventionId];
      if (!topic || !conv) return;
      renderLeiaMessage("user", `${topic.label} de ${conv.shortName || conv.name}`);
      setLeiaLoading(true);
      try {
        renderLeiaMessage("model", await buildLeiaGuidedAnswer(topic.id, conv.id));
        renderLeiaMainMenu();
      } catch (error) {
        renderLeiaMessage("model", `No pude preparar esa consulta guiada: ${leiaErrorMessage(error)}`);
      } finally {
        setLeiaLoading(false);
      }
    }
  }

  function renderLeiaMessage(role, text) {
    const messages = $("leiaMessages");
    if (!messages) return;
    const item = document.createElement("div");
    item.className = `leia-message ${role === "user" ? "is-user" : "is-leia"}`;
    item.innerHTML = role === "user" ? escapeHtml(text) : parseMarkdown(text);
    messages.appendChild(item);
    messages.scrollTop = messages.scrollHeight;
  }

  function setLeiaLoading(isLoading) {
    const form = $("leiaForm");
    const input = $("leiaInput");
    if (!form || !input) return;
    form.classList.toggle("is-loading", isLoading);
    input.disabled = isLoading;
    form.querySelector("button").disabled = isLoading;
  }

  function leiaErrorMessage(error) {
    const message = String(error.message || "");
    const lower = message.toLowerCase();
    if (error.name === "AbortError" || lower.includes("aborted") || lower.includes("abort")) {
      return "La auditoria IA tardo demasiado y leIA activo el autopiloto local para no dejarte esperando.";
    }
    if (lower.includes("gemini_api_key")) {
      return "Falta configurar la API key de Gemini en el backend. Revisá backend-esueldos-calculadoras/.env y reiniciá el servidor.";
    }
    if (lower.includes("alta demanda") || lower.includes("high demand") || lower.includes("saturad") || lower.includes("try again later")) {
      return "Gemini está con alta demanda en este momento. leIA ya intentó usar modelos alternativos; probá de nuevo en unos minutos.";
    }
    if (lower.includes("not found") || lower.includes("not supported") || lower.includes("generatecontent") || lower.includes("listmodels")) {
      return "leIA detecto un modelo de Gemini viejo o no disponible. Ya ajuste la configuracion; reinicia el backend y volve a preguntarme.";
    }
    if (lower.includes("backend") || lower.includes("failed to fetch") || lower.includes("fetch")) {
      return "No pude conectar con el backend de leIA. Verificá que esté iniciado en http://localhost:4100.";
    }
    return message || "No se pudo consultar a leIA en este momento.";
  }

  function toggleLeia(open) {
    const widget = $("leiaWidget");
    const panel = $("leiaPanel");
    const toggle = $("leiaToggle");
    if (!widget || !panel || !toggle) return;
    widget.classList.toggle("open", open);
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    if (open) $("leiaInput").focus();
  }

  async function sendLeiaMessage(event) {
    event.preventDefault();
    const input = $("leiaInput");
    const message = input.value.trim();
    if (!message) return;

    input.value = "";
    renderLeiaMessage("user", message);
    setLeiaLoading(true);

    try {
      const response = await fetch(apiUrl("/api/leia/chat"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          history: leiaHistory,
          state: buildLeiaState()
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "No se pudo consultar a leIA.");

      leiaHistory.push({ role: "user", text: message });
      leiaHistory.push({ role: "model", text: payload.answer });
      while (leiaHistory.length > 10) leiaHistory.shift();
      renderLeiaMessage("model", payload.answer);
    } catch (error) {
      renderLeiaMessage("model", leiaErrorMessage(error));
    } finally {
      setLeiaLoading(false);
    }
  }

  function setupLeia() {
    const toggle = $("leiaToggle");
    const close = $("leiaClose");
    const form = $("leiaForm");
    const messages = $("leiaMessages");
    if (!toggle || !close || !form) return;

    toggle.addEventListener("click", () => toggleLeia(!$("leiaWidget").classList.contains("open")));
    close.addEventListener("click", () => toggleLeia(false));
    form.addEventListener("submit", sendLeiaMessage);
    messages?.addEventListener("click", handleLeiaGuidedAction);
    renderLeiaMessage("model", "Hola, soy leIA. Podes escribirme libremente o usar estas consultas guiadas para ver informacion confiable del catalogo.");
    renderLeiaMainMenu();
    syncLeiaContext();
  }

  function renderDynamicFields(conv) {
    if (isGenericConvention(conv)) {
      const model = conv.liquidationModel || {};
      const rules = model.rules || {};
      const salaryType = rules.salaryType || conv.type || "monthly";
      const grouped = (model.concepts || []).reduce((acc, concept) => {
        const key = concept.group || "Adicionales";
        if (!acc[key]) acc[key] = [];
        acc[key].push(concept);
        return acc;
      }, {});
      const conceptHtml = Object.entries(grouped).map(([group, concepts]) => `
        <div class="generic-section-title">${escapeHtml(group)}</div>
        <div class="check-grid generic-checks">
          ${concepts.map((concept) => concept.inputType === "number"
            ? `<label class="field"><span>${escapeHtml(concept.label)}</span><input id="gen_${escapeHtml(concept.id)}" type="number" min="0" step="0.01" value="${escapeHtml(concept.defaultValue || 0)}"></label>`
            : `<label class="check-row"><input id="gen_${escapeHtml(concept.id)}" type="checkbox" ${concept.defaultValue ? "checked" : ""}><span>${escapeHtml(concept.label)}</span></label>`
          ).join("")}
        </div>`).join("");

      $("dynamicFields").innerHTML = `<div class="dynamic-card generic-convention-card">
        <h2 class="dynamic-title">${escapeHtml(conv.shortName || conv.name)}</h2>
        <div class="generic-section-title">Base del convenio JSON</div>
        <div class="grid three">
          <label class="field"><span>% del mes</span><input id="genMonthPct" type="number" min="0" max="100" step="0.01" value="100"></label>
          <label class="field"><span>${salaryType === "hourly" ? "Horas" : salaryType === "daily" ? "Jornales" : "Unidades"}</span><input id="genWorkUnits" type="number" min="0" step="0.01" value="${salaryType === "hourly" ? 0 : (rules.monthDivisor || 30)}"></label>
          <label class="field"><span>Dias ausentes injust.</span><input id="genAbsentDays" type="number" min="0" step="1" value="0"></label>
          <label class="field"><span>Hs extra 50%</span><input id="genExtra50" type="number" min="0" step="0.01" value="0"></label>
          <label class="field"><span>Hs extra 100%</span><input id="genExtra100" type="number" min="0" step="0.01" value="0"></label>
        </div>
        <div class="check-grid generic-checks">
          <label class="check-row"><input id="genSeniority" type="checkbox" ${rules.seniority?.enabled === false ? "" : "checked"}><span>Antiguedad segun JSON</span></label>
          <label class="check-row"><input id="genPresentism" type="checkbox" ${rules.presentism?.enabled ? "checked" : ""}><span>Presentismo segun JSON</span></label>
          <label class="check-row"><input id="genNonRemScale" type="checkbox" ${rules.nonRemunerativeScale?.enabled === false ? "" : "checked"}><span>No remunerativo de escala</span></label>
        </div>
        ${conceptHtml || `<p class="generic-note">Este convenio no tiene conceptos variables adicionales. Pod&eacute;s editarlos desde Convenios IA.</p>`}
        <p class="generic-note">
          <strong>Motor JSON leIA:</strong> usa reglas aprobadas del convenio, escala vigente si existe, conceptos variables y auditoria automatica del recibo.
        </p>
      </div>`;
      return;
    }

    if (conv.id === "uocra") {
      // Detectar si la categoría seleccionada es mensual (Sereno)
      const currentCat = getCategory(conv);
      const isSereno = currentCat?.monthly === true;
      const defaultMode = isSereno ? "mensual" : "1";
      const defaultHours = isSereno ? 176 : 88;

      $("dynamicFields").innerHTML = `<div class="dynamic-card">
        <h2 class="dynamic-title">Parametros UOCRA</h2>
        <div class="grid three">
          <label class="field"><span>Liquidacion</span><select id="uocraPeriodMode">
            <option value="1"${defaultMode === "1" ? " selected" : ""}>1ra quincena</option>
            <option value="2"${defaultMode === "2" ? " selected" : ""}>2da quincena</option>
            <option value="mensual"${defaultMode === "mensual" ? " selected" : ""}>Mensual</option>
          </select></label>
          <label class="field"><span>Horas normales</span><input id="uocraHours" type="number" min="0" step="0.01" value="${defaultHours}"></label>
          <label class="field"><span>Hs inasist. injust.</span><input id="uocraAbsence" type="number" min="0" step="0.01" value="0"></label>
          <label class="field"><span>Franco trabajado hs</span><input id="uocraFrancoTrab" type="number" min="0" step="0.01" value="0"></label>
          <label class="field"><span>Feriado no trab. hs</span><input id="uocraFeriadoNoTrab" type="number" min="0" step="0.01" value="0"></label>
          <label class="field"><span>Altura %</span><select id="uocraAltitude"><option value="0">No aplica</option><option value="15">15%</option><option value="20">20%</option><option value="25">25%</option></select></label>
          <label class="field"><span>Hs extra 50%</span><input id="uocraExtra50" type="number" min="0" step="0.01" value="0"></label>
          <label class="field"><span>Hs extra 100%</span><input id="uocraExtra100" type="number" min="0" step="0.01" value="0"></label>
        </div>
        <div class="check-grid" style="margin-top:12px">
          <label class="check-row"><input id="uocraAfiliado" type="checkbox" checked><span>Afiliado UOCRA (cuota sindical 2,5%)</span></label>
          <label class="check-row"><input id="uocraSNR" type="checkbox" checked><span>SNR paritaria</span></label>
          <label class="check-row"><input id="uocraSeniority" type="checkbox" checked><span>Antiguedad</span></label>
          <label class="check-row"><input id="uocraPresentism" type="checkbox" checked><span>Presentismo 20%</span></label>
          <label class="check-row"><input id="uocraVestimenta" type="checkbox"><span>Asignacion vestimenta (Art.35)</span></label>
          <label class="check-row"><input id="uocraSpecialTask" type="checkbox"><span>Tareas especiales 20%</span></label>
          <label class="check-row"><input id="uocraSubmuracion" type="checkbox"><span>Submuracion 10%</span></label>
          <label class="check-row"><input id="uocraHormigon" type="checkbox"><span>Hormigon armado 15%</span></label>
          <label class="check-row"><input id="uocraEncargado" type="checkbox"><span>Encargado 10%</span></label>
        </div>
      </div>`;

      // Listener para auto-actualizar horas al cambiar tipo de liquidación
      const periodModeEl = $("uocraPeriodMode");
      const hoursEl = $("uocraHours");
      if (periodModeEl && hoursEl) {
        periodModeEl.addEventListener("change", () => {
          const mode = periodModeEl.value;
          const cat2 = getCategory(conv);
          if (!cat2?.monthly) {
            hoursEl.value = mode === "mensual" ? 176 : 88;
          }
          markDirty();
        });
      }
    }

    if (conv.id === "farmacia") {
      $("dynamicFields").innerHTML = `<div class="dynamic-card">
        <h2 class="dynamic-title">Parametros Farmacia Mendoza</h2>
        <div class="farmacia-section-title">Base, jornada y ausencias</div>
        <div class="grid three">
          <label class="field"><span>Horas semanales</span><input id="farmWeeklyHours" type="number" min="0" max="45" step="0.01" value="45"></label>
          <label class="field"><span>% del mes</span><input id="farmMonthPct" type="number" min="0" max="100" step="0.01" value="100"></label>
          <label class="field"><span>Dias del mes</span><input id="farmWorkingDays" type="number" min="1" step="1" value="30"></label>
          <label class="field"><span>Dias ausentes injust.</span><input id="farmAbsentDays" type="number" min="0" step="1" value="0"></label>
          <label class="field"><span>Dias ausentes just.</span><input id="farmAbsentDaysJust" type="number" min="0" step="1" value="0"></label>
          <label class="field"><span>Dias no rem. <small>(auto si vacio)</small></span><input id="farmNoRemDays" type="number" min="0" step="1" placeholder="Auto"></label>
        </div>

        <div class="farmacia-section-title">Adicionales de convenio</div>
        <div class="grid three">
          <label class="field"><span>Idiomas</span><input id="farmLanguages" type="number" min="0" step="1" value="0"></label>
          <label class="field"><span>Hs extra 50%</span><input id="farmExtra50" type="number" min="0" step="0.01" value="0"></label>
          <label class="field"><span>Hs extra 100%</span><input id="farmExtra100" type="number" min="0" step="0.01" value="0"></label>
          <label class="field"><span>Hs nocturnas volunt.</span><input id="farmNightHours" type="number" min="0" step="0.01" value="0"></label>
          <label class="field"><span>Feriados trabajados</span><input id="farmHolidayWorkedDays" type="number" min="0" step="1" value="0"></label>
          <label class="field"><span>Feriados no trab.</span><input id="farmHolidayNotWorkedDays" type="number" min="0" step="1" value="0"></label>
          <label class="field"><span>Dia farmacia trab.</span><input id="farmPharmacyDayWorked" type="number" min="0" max="1" step="1" value="0"></label>
          <label class="field"><span>Dia farmacia no trab.</span><input id="farmPharmacyDayNotWorked" type="number" min="0" max="1" step="1" value="0"></label>
          <label class="field"><span>Dias vacaciones</span><input id="farmVacationDays" type="number" min="0" step="1" value="0"></label>
          <label class="field"><span>Dias SAC</span><input id="farmSacDays" type="number" min="0" max="180" step="1" value="180"></label>
          <label class="field"><span>Mejor rem. SAC</span><input id="farmSacBestRem" type="number" min="0" step="0.01" value="0"></label>
        </div>
        <div class="check-grid farmacia-checks">
          <label class="check-row"><input id="farmSeniority" type="checkbox" checked><span>Escalafon antiguedad</span></label>
          <label class="check-row"><input id="farmSeniorityOnFixedAdditions" type="checkbox" checked><span>Antiguedad sobre basico + adicionales fijos</span></label>
          <label class="check-row"><input id="farmInsalubre" type="checkbox"><span>Jornada insalubre 33 hs pagadas como 45 hs</span></label>
          <label class="check-row"><input id="farmNonRem" type="checkbox" checked><span>No remunerativo escala</span></label>
          <label class="check-row"><input id="farmProrateNonRem" type="checkbox" checked><span>Prorratear no rem. por dias</span></label>
          <label class="check-row"><input id="farmCajero" type="checkbox"><span>Adicional cajero 10%</span></label>
          <label class="check-row"><input id="farmFallaCaja" type="checkbox"><span>Fondo falla caja 10%</span></label>
          <label class="check-row"><input id="farmAdminTitle" type="checkbox"><span>Admin titulo 5%</span></label>
          <label class="check-row"><input id="farmAdminTenure" type="checkbox"><span>Admin antig. tarea 5/10%</span></label>
          <label class="check-row"><input id="farmPerfumeria" type="checkbox"><span>Perfumeria 10%</span></label>
          <label class="check-row"><input id="farmBike" type="checkbox"><span>Bici/moto 10%</span></label>
          <label class="check-row"><input id="farmAuxTitle" type="checkbox"><span>Titulo auxiliar 20%</span></label>
          <label class="check-row"><input id="farm_tituloFarmaceutico" type="checkbox"><span>Titulo farmaceutico</span></label>
          <label class="check-row"><input id="farm_adscripcion" type="checkbox"><span>Adscripcion</span></label>
          <label class="check-row"><input id="farm_bloqueo" type="checkbox"><span>Bloqueo direccion tecnica</span></label>
          <label class="check-row"><input id="farmDiscountVacationDays" type="checkbox" checked><span>Descontar dias normales por vacaciones</span></label>
          <label class="check-row"><input id="farmSac" type="checkbox"><span>Liquidar SAC proporcional</span></label>
        </div>

        <div class="farmacia-section-title">Aportes y bases</div>
        <div class="check-grid farmacia-checks">
          <label class="check-row"><input id="farmAdefSolidarity" type="checkbox" checked><span>Aporte solidario ADEF 2%</span></label>
          <label class="check-row"><input id="farmContribution" type="checkbox" checked><span>Contrib. extraordinaria escala</span></label>
          <label class="check-row"><input id="farmSocialJuneDec" type="checkbox" checked><span>Aporte asistencia social 1% jun/dic</span></label>
          <label class="check-row"><input id="farmOsFullTimeBase" type="checkbox" checked><span>Obra social base jornada completa si reducida</span></label>
          <label class="check-row"><input id="farmUnionContribution" type="checkbox"><span>Cuota sindical afiliado</span></label>
          <label class="check-row"><input id="farmCajaCompensadora" type="checkbox"><span>Caja compensadora 1%</span></label>
          <label class="check-row"><input id="farmProEdificio" type="checkbox"><span>Pro edificio 1%</span></label>
        </div>
        <p class="farmacia-note">
          <strong>CCT 429/2005 Mendoza:</strong> horas extra por divisor 200, vacaciones por divisor 25, inasistencias por divisor 30, no remunerativos por periodo y base de obra social controlada para jornada reducida.
        </p>
      </div>`;
    }

    if (conv.id === "camioneros") {
      $("dynamicFields").innerHTML = `<div class="dynamic-card">
        <h2 class="dynamic-title">Parametros Camioneros</h2>
        <div class="camioneros-section-title">Base mensual y dias</div>
        <div class="grid three">
          <label class="field"><span>Divisor jornales</span><input id="camPeriodDays" type="number" min="1" step="1" value="24"></label>
          <label class="field"><span>Jornales a pagar</span><input id="camWorkingDays" type="number" min="0" step="1" value="24"></label>
          <label class="field"><span>Inasist. injust.</span><input id="camAbsentDays" type="number" min="0" step="1" value="0"></label>
          <label class="field"><span>Dias no rem. <small>(auto si vacio)</small></span><input id="camNoRemDays" type="number" min="0" step="1" placeholder="Auto"></label>
          <label class="field"><span>Plus vacacional dias</span><input id="camVacationPlusDays" type="number" min="0" step="1" value="0"></label>
          <label class="field"><span>Dia camionero trab.</span><input id="camDriverDay" type="number" min="0" max="1" step="1" value="0"></label>
        </div>

        <div class="camioneros-section-title">Viaticos Art. 4.2.11 y kilometraje</div>
        <div class="grid three">
          <label class="field"><span>Pernoctadas <small>(no rem.)</small></span><input id="camPernoctadaDays" type="number" min="0" step="1" value="0"></label>
          <label class="field"><span>Km larga distancia</span><input id="camKmExtra" type="number" min="0" step="0.01" value="0"></label>
          <label class="field"><span>Km sab/dom/feriado</span><input id="camKmWeekend" type="number" min="0" step="0.01" value="0"></label>
          <label class="field"><span>Dias viaje km</span><input id="camKmTravelDays" type="number" min="0" step="1" value="0"></label>
          <label class="field"><span>Km viatico manual</span><input id="camKmViatico" type="number" min="0" step="0.01" value="0"></label>
          <label class="field"><span>Permanencias <small>(no rem.)</small></span><input id="camPermanencia" type="number" min="0" step="1" value="0"></label>
          <label class="field"><span>Simple presencia <small>(no rem.)</small></span><input id="camSimplePresence" type="number" min="0" step="1" value="0"></label>
          <label class="field"><span>Cruces frontera <small>(no rem.)</small></span><input id="camCruces" type="number" min="0" step="1" value="0"></label>
          <label class="field"><span>Ingresos isla <small>(no rem.)</small></span><input id="camIsla" type="number" min="0" step="1" value="0"></label>
        </div>
        <div class="check-grid camioneros-checks">
          <label class="check-row"><input id="camComida" type="checkbox" checked><span>Comida</span></label>
          <label class="check-row"><input id="camViaticoEspecial" type="checkbox" checked><span>Viatico especial</span></label>
          <label class="check-row"><input id="camApplyKmMin" type="checkbox"><span>Aplicar minimo 350 km/dia al viatico</span></label>
          <label class="check-row"><input id="camPresentism" type="checkbox" checked><span>Presentismo 8,33% si no hay injustificadas</span></label>
        </div>

        <div class="camioneros-section-title">Adicionales remunerativos</div>
        <div class="grid three">
          <label class="field"><span>Bitrenes</span><input id="camBitrenes" type="number" min="0" step="1" value="0"></label>
          <label class="field"><span>Adicional rama %</span><input id="camAdditionalPct" type="number" min="0" step="0.01" value="0"></label>
          <label class="field"><span>Otros rem. convenio</span><input id="camOtherRem" type="number" min="0" step="0.01" value="0"></label>
          <label class="field"><span>Hs extra 50%</span><input id="camExtra50" type="number" min="0" step="0.01" value="0"></label>
          <label class="field"><span>Hs extra 100%</span><input id="camExtra100" type="number" min="0" step="0.01" value="0"></label>
          <label class="field"><span>Hs nocturnas 100%</span><input id="camNightHours" type="number" min="0" step="0.01" value="0"></label>
        </div>
        <div class="check-grid camioneros-checks">
          <label class="check-row"><input id="camSeniority" type="checkbox" checked><span>Antiguedad 1% por año</span></label>
          <label class="check-row"><input id="camLongDistanceDriver" type="checkbox"><span>Chofer larga distancia 10%</span></label>
          <label class="check-row"><input id="camLactea" type="checkbox"><span>Materia prima lactea 15%</span></label>
          <label class="check-row"><input id="camAuxilio" type="checkbox"><span>Conductor auxilio 10%</span></label>
          <label class="check-row"><input id="camBlindado" type="checkbox"><span>Unidades blindadas 20%</span></label>
          <label class="check-row"><input id="camCombustibles" type="checkbox"><span>Combustibles 15%</span></label>
          <label class="check-row"><input id="camPeligrosas" type="checkbox"><span>Sustancias peligrosas 20%</span></label>
          <label class="check-row"><input id="camPozos" type="checkbox"><span>Pozos petroliferos 40%</span></label>
          <label class="check-row"><input id="camPluralidadI" type="checkbox"><span>Pluralidad taller I/III 25%</span></label>
          <label class="check-row"><input id="camPluralidadII" type="checkbox"><span>Pluralidad taller II 18%</span></label>
          <label class="check-row"><input id="camDiariosRevistas" type="checkbox"><span>Diarios y revistas 12%</span></label>
          <label class="check-row"><input id="camLogistica" type="checkbox"><span>Logistica 18%</span></label>
          <label class="check-row"><input id="camCamaraFrio" type="checkbox"><span>Camara frio 20%</span></label>
        </div>

        <div class="camioneros-section-title">Aportes del trabajador</div>
        <div class="check-grid camioneros-checks">
          <label class="check-row"><input id="camUnionFee" type="checkbox" checked><span>Cuota sindical 2%</span></label>
          <label class="check-row"><input id="camSolidarityContribution" type="checkbox" checked><span>Contribucion solidaria 3%</span></label>
          <label class="check-row"><input id="camFuneralInsurance" type="checkbox" checked><span>Seguro sepelio 1,5%</span></label>
        </div>
        <p class="camioneros-note">
          <strong>CCT 40/89:</strong> usa divisor 24 para jornal, antiguedad 1% por año sobre remunerativos, y separa los viaticos del Art. 4.2.11 fuera de las bases de aportes.
        </p>
      </div>`;
    }
  }

  function updateConvention() {
    const conv = getConvention();
    renderConventionCards();
    const currentPeriod = str("period") || getCurrentPeriodId();
    setOptions($("period"), conv.periods, currentPeriod);
    setOptions($("zone"), conv.zones, str("zone"));
    setOptions($("category"), conv.categories, str("category"));
    renderDynamicFields(conv);
    syncScaleConvention();
    if ($("scaleConvention")) {
      $("scaleConvention").value = conv.id;
      $("scalePeriod").value = selectedPeriodMonth(conv);
      loadScaleDashboard();
      refreshActiveScaleContext();
    }
    syncLeiaContext();
    markDirty();
  }

  async function init() {
    await loadCatalog();

    const conventionSelect = $("convention");
    conventionSelect.innerHTML = Object.values(DATA.conventions)
      .map((conv) => `<option value="${conv.id}">${escapeHtml(conv.name)}</option>`)
      .join("");
    if (DATA.conventions.camioneros) conventionSelect.value = "camioneros";

    $("payrollForm").addEventListener("input", () => {
      markDirty();
    });
    $("payrollForm").addEventListener("change", (event) => {
      if (event.target.id === "convention") updateConvention();
      else {
        if (event.target.id === "period") {
          const period = $("scalePeriod");
          if (period) period.value = selectedPeriodMonth();
          refreshActiveScaleContext();
        }
        markDirty();
      }
    });

    // Navigation
    document.querySelectorAll(".nav-link").forEach(link => {
      link.addEventListener("click", (e) => {
        const target = link.getAttribute("href").substring(1);
        if (target === "employeesPanel" || target === "payrollForm" || target === "scalesPanel" || target === "conventionsPanel") {
          e.preventDefault();
          document.querySelectorAll(".nav-link").forEach(l => l.classList.remove("active"));
          link.classList.add("active");

          $("employeesPanel").style.display = target === "employeesPanel" ? "block" : "none";
          $("scalesPanel").style.display = target === "scalesPanel" ? "block" : "none";
          $("conventionsPanel").style.display = target === "conventionsPanel" ? "block" : "none";
          $("payrollFormPanel").style.display = target === "payrollForm" ? "block" : "none";

          if (target === "employeesPanel" || target === "scalesPanel" || target === "conventionsPanel") {
            document.querySelector(".app-shell").classList.add("full-view");
            if (target === "employeesPanel") fetchEmployees();
            if (target === "scalesPanel") loadScaleDashboard();
            if (target === "conventionsPanel") loadConventionDrafts();
          } else {
            document.querySelector(".app-shell").classList.remove("full-view");
          }
        }
      });
    });

    $("addEmployeeBtn").addEventListener("click", () => {
      $("editEmployeeId").value = "";
      $("employeeDataForm").reset();
      $("employeeModalTitle").textContent = "Nuevo empleado";
      updateEmpConvention();
      setNextLegajo();
      $("employeeFormModal").style.display = "flex";
    });

    $("closeEmployeeModal").addEventListener("click", () => {
      $("employeeFormModal").style.display = "none";
    });

    $("employeeDataForm").addEventListener("submit", saveEmployee);
    $("empConvention").addEventListener("change", updateEmpConvention);
    $("searchEmployeeBtn").addEventListener("click", searchEmployee);
    $("employeeLegajo").addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        searchEmployee();
      }
    });

    $("employeeName").addEventListener("input", () => {
      clearTimeout(autocompleteTimeout);
      autocompleteTimeout = setTimeout(searchEmployeesAutocomplete, 300);
    });

    document.addEventListener("click", (e) => {
      if (!e.target.closest("#employeeName") && !e.target.closest("#employeeSuggestions")) {
        $("employeeSuggestions").style.display = "none";
      }
    });

    // Fill convention select in employee form
    $("empConvention").innerHTML = Object.values(DATA.conventions)
      .map((conv) => `<option value="${conv.id}">${escapeHtml(conv.name)}</option>`)
      .join("");
    
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
    $("liquidateBtn").addEventListener("click", () => {
      const btn = $("liquidateBtn");
      const originalText = btn.textContent;
      btn.textContent = "Calculando...";
      btn.disabled = true;
      setTimeout(async () => {
        await refreshActiveScaleContext();
        calculate();
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
    activateTab("audit");
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
    
    const existing = liquidationsList.find(l => 
      l.period === lastResult.period && 
      (l.employee?.legajo === lastResult.employee.legajo || l.employee?.name === lastResult.employee.name)
    );
    if (existing) {
      alert("Ya guardaste un recibo para este empleado en este mes. Si necesitas corregirlo, eliminalo primero desde la vista de Empleados > Recibos.");
      return;
    }

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
      fetchEmployees(); // Refrescar lista en background
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

  // --- Employee Management ---
  let employees = [];
  let liquidationsList = [];

  async function fetchEmployees() {
    try {
      const [resEmp, resLiq] = await Promise.all([
        fetch(apiUrl("/api/employees")),
        fetch(apiUrl("/api/liquidations?limit=1000"))
      ]);
      if (resEmp.ok) employees = await resEmp.json();
      if (resLiq.ok) liquidationsList = await resLiq.json();
      renderEmployeeTable();
    } catch (error) {
      console.error("Error fetching employees/liquidations:", error);
    }
  }

  function renderEmployeeTable() {
    const body = $("employeeTableBody");
    if (!body) return;
    const currentPeriodId = getCurrentPeriodId();

    body.innerHTML = employees.map(emp => {
      const conv = DATA.conventions[emp.conventionId];
      const catLabel = conv?.categories?.find(c => c.id === emp.category)?.label || emp.category || "-";
      const zoneLabel = conv?.zones?.find(z => z.id === emp.zone)?.label || emp.zone || "-";
      
      const empLiqs = liquidationsList.filter(l => (l.employee?.legajo === emp.legajo || l.employee?.name === emp.name));
      const hasCurrent = empLiqs.some(l => l.period === currentPeriodId);
      const statusBadge = hasCurrent 
        ? `<span class="status-pill ok">Liquidacion mes actual</span>`
        : `<span class="status-pill bad">Pendiente mes actual</span>`;

      return `
      <tr>
        <td>${escapeHtml(emp.legajo)}</td>
        <td>${escapeHtml(emp.name)}<br><small style="color:var(--muted)">${statusBadge}</small></td>
        <td>${escapeHtml(emp.cuil || "-")}</td>
        <td>${escapeHtml(conv?.shortName || emp.conventionId || "-")}</td>
        <td>${escapeHtml(catLabel)}</td>
        <td>${escapeHtml(zoneLabel)}</td>
        <td>
          <div class="action-btns" style="flex-wrap:wrap; gap:4px;">
            <button class="btn-small" onclick="window.viewLiquidations('${emp.legajo}', '${escapeHtml(emp.name)}')">Recibos</button>
            <button class="btn-small" onclick="window.editEmployee('${emp.id}')">Editar</button>
            <button class="btn-small btn-delete" onclick="window.deleteEmployee('${emp.id}')">Eliminar</button>
          </div>
        </td>
      </tr>`;
    }).join("");
  }

  window.currentViewLiquidationsLegajo = null;
  window.currentViewLiquidationsName = null;

  window.renderLiquidationsList = () => {
    const legajo = window.currentViewLiquidationsLegajo;
    const name = window.currentViewLiquidationsName;
    let empLiqs = liquidationsList.filter(l => l.employee?.legajo === legajo || l.employee?.name === name);
    
    const filterEl = $("liqMonthFilter");
    if (filterEl && filterEl.value) {
      empLiqs = empLiqs.filter(l => l.period === filterEl.value);
    }
    
    const listHtml = empLiqs.length === 0 
      ? `<div class="empty-state" style="padding:40px;text-align:center">No hay liquidaciones.</div>`
      : `<div class="tables"><table><thead><tr><th>Periodo</th><th>Convenio</th><th class="num">Neto</th><th class="num">Fecha</th><th></th></tr></thead><tbody>
          ${empLiqs.map(l => `<tr>
            <td>${escapeHtml(monthLabel(periodIdToMonth(l.period) || l.period))}</td>
            <td>${escapeHtml(l.conventionName || l.convention)}</td>
            <td class="num">${fmt(l.totals?.net || 0)}</td>
            <td class="num">${shortDate(l.createdAt)}</td>
            <td>
              <div class="action-btns" style="flex-wrap:nowrap">
                <button class="btn-small" onclick="window.viewSavedLiquidation('${l.id}')">Ver</button>
                <button class="btn-small btn-delete" onclick="window.deleteLiquidation('${l.id}')">X</button>
              </div>
            </td>
          </tr>`).join("")}
        </tbody></table></div>`;
    
    const container = $("liqModalListContainer");
    if (container) container.innerHTML = listHtml;
  };

  window.deleteLiquidation = async (id) => {
    if (!confirm("¿Eliminar este recibo guardado? Esta accion no se puede deshacer.")) return;
    try {
      const response = await fetch(apiUrl(`/api/liquidations/${id}`), { method: "DELETE" });
      if (response.ok) {
        await fetchEmployees();
        window.renderLiquidationsList();
      } else {
        alert("No se pudo eliminar el recibo.");
      }
    } catch (e) {
      alert("Error de red al intentar eliminar.");
    }
  };

  window.viewLiquidations = (legajo, name) => {
    window.currentViewLiquidationsLegajo = legajo;
    window.currentViewLiquidationsName = name;
    
    const empLiqs = liquidationsList.filter(l => l.employee?.legajo === legajo || l.employee?.name === name);
    const periods = [...new Set(empLiqs.map(l => l.period))].sort().reverse();
    
    const filterHtml = `
      <div style="margin-bottom:16px; display:flex; gap:10px; align-items:center;">
        <label for="liqMonthFilter" style="font-size:12px; font-weight:600; color:var(--muted)">Filtrar por mes:</label>
        <select id="liqMonthFilter" onchange="window.renderLiquidationsList()" style="padding:4px 8px; border:1px solid #ccc; border-radius:4px; font-size:13px">
          <option value="">Todos los meses</option>
          ${periods.map(p => `<option value="${p}">${escapeHtml(monthLabel(periodIdToMonth(p) || p))}</option>`).join("")}
        </select>
      </div>
      <div id="liqModalListContainer"></div>
    `;

    const modal = $("employeeLiquidationsModal");
    if (modal) {
      $("liqModalTitle").textContent = `Recibos de ${name}`;
      $("liqModalContent").innerHTML = filterHtml;
      window.renderLiquidationsList();
      modal.style.display = "flex";
    }
  };

  window.viewSavedLiquidation = (id) => {
    const saved = liquidationsList.find(l => l.id === id);
    if (!saved) return;
    
    const conv = DATA.conventions[saved.convention];
    lastResult = {
      conv: conv || { id: saved.convention, name: saved.conventionName, periods: [] },
      employee: saved.employee,
      period: saved.period,
      category: { label: saved.category },
      zone: { label: saved.zone },
      remRows: saved.remunerative,
      noRemRows: saved.nonRemunerative,
      deductionRows: saved.deductions,
      employerRows: saved.employer,
      details: saved.details || [],
      totals: saved.totals
    };
    lastAudit = saved.audit || null;
    
    $("employeeLiquidationsModal").style.display = "none";
    
    // Simular clic en el nav para ir a Sueldos
    const navLink = document.querySelector('.nav-link[href="#payrollForm"]');
    if (navLink) navLink.click();
    
    // Renderizar recibo
    goToStep(4);
    renderAll(lastResult);
    if (lastAudit) renderAuditResult(lastAudit);
    setActionButtonsEnabled(true);
    activateTab("receipt");
  };

  window.editEmployee = (id) => {
    const emp = employees.find(e => e.id === id);
    if (!emp) return;
    $("editEmployeeId").value = emp.id;
    $("empLegajo").value = emp.legajo;
    $("empName").value = emp.name;
    $("empCuil").value = emp.cuil || "";
    $("empEntryDate").value = emp.entryDate || "";
    $("empCivilStatus").value = emp.civilStatus || "soltero";
    $("empConvention").value = emp.conventionId || "uocra";
    updateEmpConvention();
    $("empCategory").value = emp.category || "";
    $("empZone").value = emp.zone || "";
    
    $("employeeModalTitle").textContent = "Editar empleado";
    $("employeeFormModal").style.display = "flex";
  };

  window.deleteEmployee = async (id) => {
    if (!confirm("¿Estás seguro de eliminar este empleado?")) return;
    try {
      const response = await fetch(apiUrl(`/api/employees/${id}`), { method: "DELETE" });
      if (response.ok) fetchEmployees();
    } catch (error) {
      alert("Error al eliminar");
    }
  };

  function updateEmpConvention() {
    const empConvEl = $("empConvention");
    const empCatEl = $("empCategory");
    const empZoneEl = $("empZone");
    if (!empConvEl || !empCatEl || !empZoneEl) return;
    const conv = DATA.conventions[empConvEl.value];
    if (!conv) return;
    setOptions(empCatEl, conv.categories);
    setOptions(empZoneEl, conv.zones);
  }

  async function saveEmployee(event) {
    event.preventDefault();
    const id = $("editEmployeeId").value;
    const payload = {
      legajo: $("empLegajo").value,
      name: $("empName").value,
      cuil: $("empCuil").value,
      entryDate: $("empEntryDate").value,
      civilStatus: $("empCivilStatus").value,
      conventionId: $("empConvention").value,
      category: $("empCategory").value,
      zone: $("empZone").value
    };

    try {
      const url = id ? apiUrl(`/api/employees/${id}`) : apiUrl("/api/employees");
      const method = id ? "PUT" : "POST";
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (response.ok) {
        $("employeeFormModal").style.display = "none";
        fetchEmployees();
      } else {
        const err = await response.json();
        alert(err.error || "Error al guardar");
      }
    } catch (error) {
      alert("Error al conectar con el servidor");
    }
  }

  async function searchEmployee() {
    const legajoEl = $("employeeLegajo");
    const legajo = legajoEl?.value.trim();
    if (!legajo) return;

    // Feedback visual en el input
    legajoEl.style.borderColor = "";
    const errorMsg = legajoEl.parentNode.querySelector(".legajo-error");
    if (errorMsg) errorMsg.remove();
    
    try {
      const response = await fetch(apiUrl(`/api/employees/${legajo}`));
      if (response.ok) {
        const emp = await response.json();
        fillEmployeeData(emp);
        legajoEl.style.borderColor = "var(--green)";
        setTimeout(() => { legajoEl.style.borderColor = ""; }, 2000);
      } else {
        // Mensaje inline en lugar de alert()
        legajoEl.style.borderColor = "var(--red)";
        const msg = document.createElement("small");
        msg.className = "legajo-error";
        msg.style.cssText = "color:var(--red);font-size:11px;margin-top:4px;display:block";
        msg.textContent = `Legajo ${legajo} no encontrado`;
        legajoEl.parentNode.appendChild(msg);
        setTimeout(() => { legajoEl.style.borderColor = ""; msg.remove(); }, 3000);
      }
    } catch (error) {
      console.error("Error searching employee:", error);
    }
  }

  let autocompleteTimeout = null;

  async function searchEmployeesAutocomplete() {
    const q = $("employeeName").value.trim();
    const suggestions = $("employeeSuggestions");
    if (q.length < 2) {
      suggestions.style.display = "none";
      return;
    }

    try {
      // Filter by currently selected convention so only relevant employees appear
      const convId = str("convention", "uocra");
      const url = apiUrl(`/api/employees/search?q=${encodeURIComponent(q)}&conventionId=${encodeURIComponent(convId)}`);
      const response = await fetch(url);
      if (response.ok) {
        const results = await response.json();
        renderSuggestions(results);
      }
    } catch (error) {
      console.error("Autocomplete error:", error);
    }
  }

  function renderSuggestions(results) {
    const suggestions = $("employeeSuggestions");
    if (!results.length) {
      suggestions.style.display = "none";
      return;
    }

    suggestions.innerHTML = results.map(emp => `
      <div class="suggestion-item" data-id="${emp.id}">
        <strong>${escapeHtml(emp.name)}</strong>
        <small>Legajo: ${escapeHtml(emp.legajo)}</small>
      </div>
    `).join("");
    suggestions.style.display = "block";

    suggestions.querySelectorAll(".suggestion-item").forEach(item => {
      item.addEventListener("click", () => {
        const emp = results.find(e => e.id === item.dataset.id);
        if (emp) {
          $("employeeLegajo").value = emp.legajo;
          fillEmployeeData(emp);
          suggestions.style.display = "none";
        }
      });
    });
  }

  async function setNextLegajo() {
    try {
      const response = await fetch(apiUrl("/api/employees/next-legajo"));
      if (response.ok) {
        const { nextLegajo } = await response.json();
        $("empLegajo").value = nextLegajo;
      }
    } catch (error) {
      console.error("Error fetching next legajo:", error);
    }
  }

  function fillEmployeeData(emp) {
    $("employeeName").value = emp.name;
    $("employeeCuil").value = emp.cuil || "";
    $("entryDate").value = emp.entryDate || "";
    $("civilStatus").value = emp.civilStatus || "soltero";
    
    if (emp.conventionId) {
      $("convention").value = emp.conventionId;
      updateConvention();
      if (emp.category) $("category").value = emp.category;
      if (emp.zone) $("zone").value = emp.zone;
    }
    
    markDirty();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
