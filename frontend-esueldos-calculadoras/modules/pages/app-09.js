        <span class="status-pill ${scale.status === "APROBADA" ? "ok" : scale.status === "RECHAZADA" ? "bad" : ""}">${escapeHtml(statusLabel(scale.status))}</span>
      </div>
      <div class="scale-mini-grid">
        <div><span>Lectura IA</span><strong>${escapeHtml(scale.aiStatus || "-")}</strong></div>
        <div><span>Aprobada</span><strong>${escapeHtml(shortDate(scale.approvedAt))}</strong></div>
  
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
    const fallbackId = firstConventionId();
    const current = scaleSelect.value || str("convention", fallbackId);
    scaleSelect.innerHTML = Object.values(DATA.conventions)
      .map((conv) => `<option value="${conv.id}">${escapeHtml(conv.shortName || conv.name)}</option>`)
      .join("");
    scaleSelect.value = DATA.conventions[current] ? current : fallbackId;
    const period = $("scalePeriod");
    if (period && !period.value) period.value = selectedPeriodMonth();
  }

  async function fetchJson(path, options = {}) {
    if (window.eSueldosApiClient?.json) return window.eSueldosApiClient.json(path, options);
    const headers = new Headers(options.headers || {});
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(apiUrl(path), { ...options, headers, signal: options.signal || controller.signal });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const details = Array.isArray(payload.errores) && payload.errores.length
          ? payload.errores.slice(0, 3).map((item) => `${item.path ? `${item.path}: ` : ""}${item.message || item}`).join(" | ")
          : "";
        throw new Error(payload.error || details || `HTTP ${response.status}`);
      }
      return payload;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function refreshActiveScaleContext() {
    const conv = getConvention();
    const period = selectedPeriodMonth(conv);
    try {
      scaleState.activeForPayroll = await fetchJson(`/api/scales/active?conventionId=${encodeURIComponent(conv.id)}&period=${encodeURIComponent(period)}`);
    } catch (error) {
      scaleState.activeForPayroll = null;
    }
    refreshPayrollModalityOptions();
  }

  async function loadScaleDashboard() {
    const scaleSelect = $("scaleConvention");
    if (!scaleSelect) return;
    const conventionId = scaleSelect.value || str("convention", firstConventionId());
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
      updateScaleTokenUsageUI(null);
      return;
    }
    list.innerHTML = items.map((scale) => `<button class="scale-audit-item ${scaleState.selected?.id === scale.id ? "active" : ""}" type="button" data-scale-id="${escapeHtml(scale.id)}">
      <span>
        <strong>${escapeHtml(scale.periodLabel || monthLabel(scale.period))}</strong>
        <small>${escapeHtml(scale.sourceFileName || "Archivo de escala")}</small>
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

  function csvCell(value) {
    const text = String(value ?? "");
    return /[",\n;]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }

  function downloadScaleCsv(scale) {
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

    const csv = data.map((row) => row.map(csvCell).join(";")).join("\n");
    const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Escala_${scale.conventionId || "escala"}_${scale.period || "periodo"}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
          <button class="icon-btn" id="downloadExcelBtn" type="button">Descargar CSV</button>`;
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
    $("downloadExcelBtn")?.addEventListener("click", () => downloadScaleCsv(scale));
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
      updateScaleTokenUsageUI(scale.tokenUsage);
    } catch (error) {
      setScaleStatus(error.message, "bad");
      updateScaleTokenUsageUI(null);
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
    const conventionId = $("scaleConvention")?.value || str("convention", firstConventionId());
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
    const files = Array.from($("scalePdf")?.files || []);
    const conventionId = $("scaleConvention")?.value || str("convention", firstConventionId());
    const period = $("scalePeriod")?.value || selectedPeriodMonth();
    if (!files.length) {
      setScaleStatus("Selecciona un documento o imagen para analizar.", "bad");
      return;
    }
    const formData = new FormData();
    files.forEach((file) => formData.append("pdf", file));
    formData.append("conventionId", conventionId);
    formData.append("period", period);
    formData.append("periodLabel", monthLabel(period));

    const button = $("uploadScaleBtn");
    if (button) button.disabled = true;
    setScaleStatus("Subiendo documento y consultando a leIA...", "");
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
      updateScaleTokenUsageUI(payload.tokenUsage || firstScale.tokenUsage || null);
      const periods = createdScales.map((scale) => scale.periodLabel || monthLabel(scale.period)).join(", ");
      const pluralMsg = createdScales.length === 1
        ? "leIA creo 1 escala pendiente."
        : `leIA creo ${createdScales.length} escalas pendientes: ${periods}.`;
      setScaleStatus(payload.aiStatus === "DETECTADA_POR_IA" ? `${pluralMsg} Revisalas y aprobalas por separado.` : `${pluralMsg} Revisar advertencia de IA.`, payload.aiStatus === "DETECTADA_POR_IA" ? "ok" : "bad");
    } catch (error) {
      setScaleStatus(error.message, "bad");
      updateScaleTokenUsageUI(null);
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

  function conventionErrorMessage(payload = {}, fallback = "No se pudo estructurar el convenio.") {
