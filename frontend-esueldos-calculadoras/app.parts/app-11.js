          <path d="M8 6V4h8v2"></path>
          <path d="M19 6l-1 14H6L5 6"></path>
          <path d="M10 11v5"></path>
          <path d="M14 11v5"></path>
        </svg>
        Eliminar
      </button>
    </div>`;
    if (tablesArea) {
      tablesArea.innerHTML = `<div class="convention-audit-table-stack">${conventionAuditTablesHtml(conv, false, { includeGeneral: false })}${auditActions}</div>`;
    }

    tablesArea?.querySelector("#downloadConventionJsonBtn")?.addEventListener("click", () => downloadConventionJson(draft));
    tablesArea?.querySelector("#saveConventionJsonBtn")?.addEventListener("click", saveConventionDraftJson);
    tablesArea?.querySelector("#approveConventionDraftBtn")?.addEventListener("click", approveConventionDraft);
    tablesArea?.querySelector("#rejectConventionDraftBtn")?.addEventListener("click", rejectConventionDraft);
    tablesArea?.querySelector("#deleteConventionDraftBtn")?.addEventListener("click", () => deleteConventionDraft(draft.id));
    [editor, $("conventionAiAuditSummary")].filter(Boolean).forEach((root) => {
      root.querySelectorAll("[data-ai-audit-go]").forEach((button) => {
        button.addEventListener("click", () => goToConventionAuditFinding(button));
      });
    });
    [editor, tablesArea].filter(Boolean).forEach((root) => {
      root.querySelectorAll("[data-audit-select-all]").forEach((checkbox) => {
        checkbox.addEventListener("change", () => {
          const section = checkbox.dataset.auditSelectAll;
          root.querySelectorAll(`[data-audit-row-check="${section}"]`).forEach((rowCheck) => {
            rowCheck.checked = checkbox.checked;
          });
        });
      });
      root.querySelectorAll("[data-audit-add]").forEach((button) => {
        button.addEventListener("click", () => addConventionAuditRow(button.dataset.auditAdd));
      });
      root.querySelectorAll("[data-audit-delete]").forEach((button) => {
        button.addEventListener("click", () => deleteConventionAuditRows(button.dataset.auditDelete));
      });
    });
  }

  function goToConventionAuditFinding(button) {
    const section = button.dataset.aiAuditGo || "general";
    const rowId = button.dataset.aiAuditRow || "";
    const fieldName = button.dataset.aiAuditField || "";
    const editor = $("conventionJsonEditor");
    const tablesArea = $("conventionAuditTablesArea");
    let target;
    if (section === "general") {
      target = editor?.querySelector(".convention-audit-general");
    } else {
      const details = tablesArea?.querySelector(`[data-audit-section="${section}"]`);
      if (details) details.open = true;
      const rows = Array.from(details?.querySelectorAll("tbody tr:not(.audit-empty-row)") || []);
      target = rowId ? rows.find((row) => row.dataset.auditRowId === rowId
        || Array.from(row.querySelectorAll("[data-field]")).some((input) => String(input.value || "") === rowId)) : details;
      target ||= details;
    }
    if (!target) {
      setConventionBuilderStatus("No pude ubicar la fila indicada por la auditoría. Revisá la sección manualmente.", "bad");
      return;
    }
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("ai-audit-target");
    const field = fieldName ? Array.from(target.querySelectorAll("[data-field]")).find((item) => item.dataset.field === fieldName) : null;
    window.setTimeout(() => field?.focus({ preventScroll: true }), 450);
    window.setTimeout(() => target.classList.remove("ai-audit-target"), 2400);
  }

  function parseConventionJsonEditor() {
    const base = JSON.parse(JSON.stringify(conventionBuilderState.selected?.parsedConvention || {}));
    const editor = $("conventionJsonEditor");
    const tablesArea = $("conventionAuditTablesArea");
    if (!editor || !editor.querySelector(".convention-audit-editor")) return base;
    const convenio = { ...(base.convenio || {}) };
    editor.querySelectorAll("[data-audit-convenio-field], .convention-audit-general [data-field]").forEach((field) => {
      convenio[field.dataset.auditConvenioField || field.dataset.field] = field.value;
    });
    const collectRows = (section) => Array.from((tablesArea || document).querySelectorAll(`[data-audit-section="${section}"] tbody tr:not(.audit-empty-row)`))
      .map((row) => {
        const item = {};
        row.querySelectorAll("[data-field]").forEach((field) => {
          item[field.dataset.field] = field.value;
        });
        return item;
      })
      .filter((item) => Object.values(item).some((value) => String(value || "").trim() !== ""));
    const rawCategoryRows = collectRows("categorias");
    const categoryIds = new Set(rawCategoryRows.map((item) => item.categoria_id).filter(Boolean));
    const salaryRows = collectRows("escalas");
    const scaleByMonth = new Map();
    const escalas = [];
    const findBaseScale = (month) => (base.escalas || []).find((scale) => String(scale.periodo_desde || scale.nombre_escala || scale.escala_id || "") === String(month || ""));
    const ensureScale = (month, index = 0) => {
      const key = String(month || "").trim() || "sin-mes";
      if (scaleByMonth.has(key)) return scaleByMonth.get(key);
      const baseScale = findBaseScale(key) || {};
      const scale = {
        ...baseScale,
        escala_id: baseScale.escala_id || `escala-${escalas.length + 1}`,
        nombre_escala: baseScale.nombre_escala || key,
        periodo_desde: baseScale.periodo_desde || key,
        valores: []
      };
      escalas.push(scale);
      scaleByMonth.set(key, scale);
      return scale;
    };
    if (!salaryRows.length) {
      (base.escalas || []).forEach((scale) => {
        const copy = { ...scale, valores: [] };
        escalas.push(copy);
        scaleByMonth.set(String(scale.periodo_desde || scale.nombre_escala || scale.escala_id || escalas.length), copy);
      });
    }
    const scaleById = new Map(escalas.map((scale) => [scale.escala_id, scale]));
    (base.escalas || []).forEach((scale) => {
      (scale.valores || []).forEach((value, index) => {
        if (isBasicScaleValue(value)) return;
        if (value.categoria_id && !categoryIds.has(value.categoria_id)) return;
        const targetScale = scaleById.get(value.escala_id || scale.escala_id) || ensureScale(value.periodicidad || scale.periodo_desde || scale.nombre_escala);
        const escalaId = targetScale.escala_id;
        if (!scaleById.has(escalaId)) scaleById.set(escalaId, targetScale);
        scaleById.get(escalaId).valores.push({ ...value, valor_id: value.valor_id || `valor-extra-${index + 1}`, escala_id: escalaId });
      });
    });
    salaryRows.forEach((salary, index) => {
      if (!String(salary.sueldo_base || "").trim()) return;
      const scale = ensureScale(salary.mes, index);
      scaleById.set(scale.escala_id, scale);
      const conceptId = salary.concepto_id || "SUELDO_BASICO";
      scale.valores.push({
        valor_id: `basico-${index + 1}-${salary.categoria_id || "sin-categoria"}-${salary.mes || "sin-mes"}-${conceptId}`,
        escala_id: scale.escala_id,
        categoria_id: salary.categoria_id,
        concepto_id: conceptId,
        unidad_pago: salary.unidad_pago || "mensual",
        modalidad: salary.modalidad || "",
        periodicidad: salary.mes || scale.periodo_desde || "",
        valor: salary.sueldo_base,
        moneda: salary.moneda || scale.moneda || "ARS",
        zona: salary.zona || scale.zona || ""
      });
    });
    const categorias = rawCategoryRows.map((category) => {
      const { sueldo_base, escala_id, unidad_pago, periodicidad, moneda, zona, ...cleanCategory } = category;
      return cleanCategory;
    });
    const conceptos = [
      ...collectRows("conceptos_remunerativos"),
      ...collectRows("conceptos_no_remunerativos"),
      ...collectRows("conceptos_deducciones")
    ].map((item) => ({ ...item, es_liquidable: item.es_liquidable !== "false" }));
    return {
      ...base,
      schemaVersion: base.schemaVersion || "esueldos-cct-estructura-excel-v1",
      convenio,
      ambitos: collectRows("ambitos"),
      categorias,
      conceptos,
      escalas,
      adicionales: collectRows("adicionales")
    };
  }

  function addConventionAuditRow(section) {
    if (!conventionBuilderState.selected) return;
    const parsed = parseConventionJsonEditor();
    const nextIndex = (items) => (Array.isArray(items) ? items.length + 1 : 1);
    if (section === "ambitos") parsed.ambitos = [...(parsed.ambitos || []), { ambito_id: `ambito-${nextIndex(parsed.ambitos)}`, nombre: "", tipo: "", descripcion: "" }];
    if (section === "categorias") parsed.categorias = [...(parsed.categorias || []), { categoria_id: "", categoria_nombre: "", grupo_nombre: "", descripcion: "", modalidad_aplicable: "" }];
    if (section === "conceptos_remunerativos") parsed.conceptos = [...(parsed.conceptos || []), { concepto_id: "", nombre: "", tipo_concepto: "haber", naturaleza: "remunerativo", unidad_calculo: "mensual", formula_base: "requiere_revision_manual", base_calculo: "requiere_revision_manual", porcentaje: "", importe_fijo: "", condicion: "", es_liquidable: true }];
    if (section === "conceptos_no_remunerativos") parsed.conceptos = [...(parsed.conceptos || []), { concepto_id: "", nombre: "", tipo_concepto: "haber", naturaleza: "no_remunerativo", unidad_calculo: "mensual", formula_base: "requiere_revision_manual", base_calculo: "requiere_revision_manual", porcentaje: "", importe_fijo: "", condicion: "", es_liquidable: true }];
    if (section === "conceptos_deducciones") parsed.conceptos = [...(parsed.conceptos || []), { concepto_id: "", nombre: "", tipo_concepto: "descuento", naturaleza: "retencion", unidad_calculo: "mensual", formula_base: "requiere_revision_manual", base_calculo: "requiere_revision_manual", porcentaje: "", importe_fijo: "", condicion: "", es_liquidable: true }];
    if (section === "escalas") parsed.escalas = [...(parsed.escalas || []), { escala_id: `escala-${nextIndex(parsed.escalas)}`, nombre_escala: "", periodo_desde: "", moneda: "ARS", valores: [{ concepto_id: "SUELDO_BASICO", categoria_id: "", valor: "", periodicidad: "" }] }];
    if (section === "adicionales") parsed.adicionales = [...(parsed.adicionales || []), { adicional_id: `adicional-${nextIndex(parsed.adicionales)}`, concepto_id: "", nombre: "", formula: "", base_calculo: "", porcentaje: "", importe_fijo: "", condicion: "" }];
    conventionBuilderState.selected.parsedConvention = parsed;
    renderConventionJsonEditor(conventionBuilderState.selected);
  }

  function deleteConventionAuditRows(section) {
    if (!conventionBuilderState.selected) return;
    const tablesArea = $("conventionAuditTablesArea");
    const checkedRows = Array.from(tablesArea?.querySelectorAll(`[data-audit-row-check="${section}"]:checked`) || []);
    if (!checkedRows.length) {
      setConventionBuilderStatus("Seleccioná al menos una fila para eliminar.", "bad");
      return;
    }
    const removedScaleIds = [];
    checkedRows.forEach((checkbox) => {
      const row = checkbox.closest("tr");
      if (section === "escalas") {
        const scaleId = row?.querySelector('[data-field="escala_id"]')?.value;
        if (scaleId) removedScaleIds.push(scaleId);
      }
      row?.remove();
    });
    if (removedScaleIds.length) {
      tablesArea?.querySelectorAll('[data-audit-section="categorias"] tbody tr').forEach((row) => {
        const scaleField = row.querySelector('[data-field="escala_id"]');
        if (!scaleField || !removedScaleIds.includes(scaleField.value)) return;
        scaleField.value = "";
        const salaryField = row.querySelector('[data-field="sueldo_base"]');
        if (salaryField) salaryField.value = "";
      });
    }
    conventionBuilderState.selected.parsedConvention = parseConventionJsonEditor();
    renderConventionJsonEditor(conventionBuilderState.selected);
    setConventionBuilderStatus("Filas eliminadas de la revisión. Guardá los cambios para persistirlos.", "ok");
  }

  function downloadConventionJson(draft) {
    const conv = conventionBuilderState.selected?.id === draft?.id ? parseConventionJsonEditor() : (draft?.parsedConvention || {});
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

  function updateTokenUsageUI(usage) {
    const card = $("conventionTokenUsageCard");
    if (!card) return;
    if (!usage) {
      card.style.display = "none";
      return;
    }
    const model = $("conventionTokenModel");
    const prompt = $("conventionTokenPrompt");
    const output = $("conventionTokenOutput");
    const total = $("conventionTokenTotal");
    if (model) model.textContent = usage.model;
    if (prompt) prompt.textContent = usage.promptTokenCount ? usage.promptTokenCount.toLocaleString("es-AR") : "0";
    const outTokens = usage.candidatesTokenCount || usage.outputTokenCount || 0;
    if (output) output.textContent = outTokens ? outTokens.toLocaleString("es-AR") : "0";
    const totalTokens = usage.totalTokenCount || 0;
    if (total) total.textContent = totalTokens ? totalTokens.toLocaleString("es-AR") : "0";
    card.style.display = "block";
  }

  function updateScaleTokenUsageUI(usage) {
    const card = $("scaleTokenUsageCard");
    if (!card) return;
    if (!usage) {
      card.style.display = "none";
      return;
    }
    const model = $("scaleTokenModel");
    const prompt = $("scaleTokenPrompt");
    const output = $("scaleTokenOutput");
    const total = $("scaleTokenTotal");
    if (model) model.textContent = usage.model;
    if (prompt) prompt.textContent = usage.promptTokenCount ? usage.promptTokenCount.toLocaleString("es-AR") : "0";
    const outTokens = usage.outputTokenCount || 0;
    if (output) output.textContent = outTokens ? outTokens.toLocaleString("es-AR") : "0";
    const totalTokens = usage.totalTokenCount || 0;
    if (total) total.textContent = totalTokens ? totalTokens.toLocaleString("es-AR") : "0";
    card.style.display = "block";
  }

  function formatAiNumber(value) {
    const number = Number(value || 0);
    return Number.isFinite(number) ? number.toLocaleString("es-AR") : "0";
  }

  function renderAiUsageList(id, items) {
    const target = $(id);
    if (!target) return;
    const list = Array.isArray(items) ? items : [];
    target.innerHTML = list.length
      ? list.map((item) => `
        <div class="ai-usage-row">
          <span>${escapeHtml(item.period || item.provider || item.operation || "-")}</span>
          <strong>${formatAiNumber(item.totalTokens)} tokens</strong>
        </div>
      `).join("")
      : `<div class="ai-usage-row"><span>Sin datos</span><strong>0 tokens</strong></div>`;
  }

  async function loadAiUsageDashboard() {
    try {
      const [all, gemini, openai] = await Promise.all([
        fetchJson("/api/ai/usage"),
        fetchJson("/api/ai/usage/gemini"),
        fetchJson("/api/ai/usage/openai")
      ]);

      const setText = (id, value) => {
        const target = $(id);
        if (target) target.textContent = value;
      };
      const remainingText = (usage) => usage.remainingTokens == null
        ? "Restante: sin presupuesto"
        : `Restante: ${formatAiNumber(usage.remainingTokens)} tokens`;

      setText("aiGeminiRequests", formatAiNumber(gemini.requests));
      setText("aiOpenaiRequests", formatAiNumber(openai.requests));
      setText("aiPromptTokens", formatAiNumber(all.promptTokens));
      setText("aiCompletionTokens", formatAiNumber(all.completionTokens));
      setText("aiTotalTokens", formatAiNumber(all.totalTokens));
      setText("aiGeminiRemaining", remainingText(gemini));
      setText("aiOpenaiRemaining", remainingText(openai));
      setText("aiTotalRemaining", remainingText(all));
      renderAiUsageList("aiDailyUsage", all.daily);
      renderAiUsageList("aiMonthlyUsage", all.monthly);
      renderAiUsageList("aiRecentUsage", all.recentExecutions);
    } catch (error) {
      renderAiUsageList("aiRecentUsage", [{ operation: error.message, totalTokens: 0 }]);
    }
  }

  async function selectConventionDraft(id) {
    try {
      const draft = conventionBuilderState.drafts.find((item) => item.id === id) || await fetchJson(`/api/convention-drafts/${encodeURIComponent(id)}`);
      conventionBuilderState.selected = draft;
      renderConventionDrafts();
      renderConventionJsonEditor(draft);
      updateTokenUsageUI(draft.tokenUsage);
      showConventionWorkspaceView("audit");
    } catch (error) {
      setConventionBuilderStatus(error.message, "bad");
    }
  }

  function showConventionWorkspaceView(view) {
    const auditActive = view === "audit";
    const uploadView = $("conventionUploadView");
    const auditView = $("conventionAuditView");
    const uploadTab = $("conventionUploadTab");
    const auditTab = $("conventionAuditTab");
    if (!uploadView || !auditView) return;
    uploadView.hidden = auditActive;
    auditView.hidden = !auditActive;
    uploadTab?.classList.toggle("is-active", !auditActive);
    auditTab?.classList.toggle("is-active", auditActive);
    uploadTab?.setAttribute("aria-selected", auditActive ? "false" : "true");
    auditTab?.setAttribute("aria-selected", auditActive ? "true" : "false");
    requestAnimationFrame(() => $("conventionsPanel")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  async function openConventionEditorFromCard(id) {
    try {
      document.querySelector('.nav-link[href="#conventionsPanel"]')?.click();
      setConventionBuilderStatus("Abriendo convenio para edición...", "");
      const draft = await fetchJson(`/api/conventions/${encodeURIComponent(id)}/edit-draft`, { method: "POST" });
      await loadConventionDrafts();
      await selectConventionDraft(draft.id);
      setConventionBuilderStatus("Convenio listo para editar.", "ok");
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
      if (conventionBuilderState.selected.status === "APROBADO") {
        await loadCatalog();
        syncScaleConvention();
        updateConventionSelectsAfterCatalogReload(conventionBuilderState.selected.approvedConventionId);
      }
      await loadConventionDrafts();
      await selectConventionDraft(conventionBuilderState.selected.id);
      setConventionBuilderStatus("Revisión guardada y normalizada para liquidar.", "ok");
    } catch (error) {
      setConventionBuilderStatus(error.message, "bad");
    }
  }

  async function approveConventionDraft() {
    if (!conventionBuilderState.selected) return;
    const blockers = conventionBuilderState.selected.parsedConvention?.auditoriaIA?.bloqueantes || [];
    if (blockers.length) {
      setConventionBuilderStatus(`Hay ${blockers.length} errores bloqueantes. Corregilos antes de aprobar.`, "bad");
      $("conventionAiAuditSummary")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
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
    if (!draft) {
      setConventionBuilderStatus("Borrador no encontrado.", "bad");
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
      TODOS: "borradores",
      APROBADO: "aprobados",
      RECHAZADO: "rechazados"
    };
    const label = allowedStatuses[status];
    if (!label) return;

    const drafts = status === "TODOS"
      ? conventionBuilderState.drafts
      : conventionBuilderState.drafts.filter((draft) => draft.status === status);
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
    const fallbackId = firstConventionId();
    const selectedId = preferredId || str("convention", fallbackId);
    const conventionSelect = $("convention");
    if (conventionSelect) {
      conventionSelect.innerHTML = Object.values(DATA.conventions)
        .map((conv) => `<option value="${conv.id}">${escapeHtml(conv.name)}</option>`)
        .join("");
      conventionSelect.value = DATA.conventions[selectedId] ? selectedId : fallbackId;
      updateConvention();
