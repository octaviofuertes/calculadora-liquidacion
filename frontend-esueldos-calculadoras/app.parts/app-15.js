(function () {
  const $ = (id) => document.getElementById(id);
  const getApiBase = () => {
    if (window.eSueldosApi?.baseUrl !== undefined) return window.eSueldosApi.baseUrl;
    const stored = localStorage.getItem("apiBase");
    if (stored) return stored;
    return location.hostname === "localhost" || location.hostname === "127.0.0.1" ? "http://localhost:4100" : location.origin;
  };
  const apiUrl = (path) => getApiBase() + path;

  const escapeHtml = (value) => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

  function renderLaborLawPreview(rows = [], sourceFileName = "", fullText = "") {
    const preview = $("globalLaborLawPreview");
    if (!preview) return;
    if (!rows.length) {
      preview.innerHTML = `<div style="font-size: 13px; color: var(--text-muted);">No hay extracción disponible.</div>`;
      preview.style.display = "block";
      return;
    }
    preview.innerHTML = `
      <div style="font-size: 12px; margin-bottom: 8px; color: var(--text-muted);">${escapeHtml(sourceFileName)}</div>
      <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
        <thead>
          <tr>
            <th style="text-align:left; padding:6px; border-bottom:1px solid var(--line);">Concepto</th>
            <th style="text-align:left; padding:6px; border-bottom:1px solid var(--line);">Regla</th>
            <th style="text-align:left; padding:6px; border-bottom:1px solid var(--line);">Origen</th>
            <th style="text-align:left; padding:6px; border-bottom:1px solid var(--line);">P&aacute;gina</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td style="padding:6px; border-bottom:1px solid var(--line); vertical-align:top;">${escapeHtml(row.concepto)}</td>
              <td style="padding:6px; border-bottom:1px solid var(--line); vertical-align:top;">${escapeHtml(row.regla)}</td>
              <td style="padding:6px; border-bottom:1px solid var(--line); vertical-align:top;">${escapeHtml(row.origin)}</td>
              <td style="padding:6px; border-bottom:1px solid var(--line); vertical-align:top;">${escapeHtml(row.pagina)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>`;
    if (fullText) {
      preview.innerHTML += `
        <div style="margin-top: 12px; font-size: 12px; font-weight: 600; color: var(--text-muted);">Texto completo</div>
        <pre style="white-space: pre-wrap; font-size: 12px; line-height: 1.45; margin: 6px 0 0; padding: 10px; border: 1px solid var(--line); border-radius: 6px; background: #fff;">${escapeHtml(fullText)}</pre>`;
    }
    preview.style.display = "block";
  }

  let laborLawOriginalText = "";
  let laborLawSearchOffset = 0;

  function renderLaborLawEditorRows(rows = []) {
    const tbody = $("laborLawRowsTable");
    const count = $("laborLawRowsCount");
    if (count) count.textContent = `${rows.length.toLocaleString("es-AR")} bloques`;
    if (!tbody) return;
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="labor-law-empty-row">No hay contenido estructurado disponible.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map((row) => `
      <tr>
        <td><strong>${escapeHtml(row.concepto || "Sin concepto")}</strong></td>
        <td>${escapeHtml(row.regla || "")}</td>
        <td><span class="labor-law-source-chip">${escapeHtml(row.origin || "LCT")}</span></td>
        <td>${escapeHtml(row.pagina || "-")}</td>
      </tr>
    `).join("");
  }

  function setLaborLawEditorView(view) {
    const selected = view === "text" ? "text" : "table";
    document.querySelectorAll("[data-labor-law-view]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.laborLawView === selected);
    });
    $("laborLawTablePanel")?.classList.toggle("is-active", selected === "table");
    $("laborLawTextPanel")?.classList.toggle("is-active", selected === "text");
    if (selected === "text") $("laborLawEditorText")?.focus();
  }

  function updateLaborLawEditorCount() {
    const text = $("laborLawEditorText")?.value || "";
    if ($("laborLawEditorCount")) $("laborLawEditorCount").textContent = `${text.length.toLocaleString("es-AR")} caracteres`;
  }

  function openLaborLawEditor(data = {}) {
    const modal = $("laborLawEditorModal");
    const editor = $("laborLawEditorText");
    if (!modal || !editor) return;
    laborLawOriginalText = String(data.fullText || "");
    laborLawSearchOffset = 0;
    editor.value = laborLawOriginalText;
    renderLaborLawEditorRows(data.rows || []);
    setLaborLawEditorView("table");
    $("laborLawEditorSource").textContent = data.sourceFileName || "Ley de Trabajo Aplicable";
    $("laborLawEditorMode").textContent = data.isEdited ? "Versión editada" : "Texto original";
    $("laborLawEditorMode").classList.toggle("is-edited", !!data.isEdited);
    $("laborLawEditorSearch").value = "";
    $("laborLawSearchStatus").textContent = "";
    updateLaborLawEditorCount();
    modal.showModal();
    editor.focus();
  }

  function closeLaborLawEditor() {
    const modal = $("laborLawEditorModal");
    const changed = ($("laborLawEditorText")?.value || "") !== laborLawOriginalText;
    if (changed && !confirm("Hay cambios sin guardar. ¿Querés descartarlos?")) return;
    modal?.close();
  }

  function findNextLaborLawMatch() {
    const editor = $("laborLawEditorText");
    const query = ($("laborLawEditorSearch")?.value || "").trim();
    if (!editor || !query) return;
    const haystack = editor.value.toLocaleLowerCase("es");
    const needle = query.toLocaleLowerCase("es");
    let index = haystack.indexOf(needle, laborLawSearchOffset);
    if (index < 0 && laborLawSearchOffset > 0) index = haystack.indexOf(needle);
    if (index < 0) {
      $("laborLawSearchStatus").textContent = "Sin coincidencias";
      return;
    }
    editor.focus();
    editor.setSelectionRange(index, index + query.length);
    laborLawSearchOffset = index + query.length;
    $("laborLawSearchStatus").textContent = `Coincidencia en posición ${index + 1}`;
  }

  async function loadGlobalLaborLawStatus() {
    const label = $("globalLaborLawLabel");
    const deleteBtn = $("deleteGlobalLaborLawBtn");
    const previewBtn = $("previewGlobalLaborLawBtn");
    if (!label) return;
    try {
      const res = await fetch(apiUrl("/api/settings"));
      const data = await res.json().catch(() => ({}));
      if (data.hasGlobalLaborLaw) {
        label.textContent = data.hasEditedLaborLaw ? "Ley de Trabajo (versión corregida activa)" : "Ley de Trabajo (PDF) cargada globalmente";
        label.style.color = "var(--ok, green)";
        if (deleteBtn) deleteBtn.style.display = "block";
        if (previewBtn) previewBtn.style.display = "inline-flex";
      } else {
        label.textContent = "No hay Ley de Trabajo cargada";
        label.style.color = "var(--text-muted, gray)";
        if (deleteBtn) deleteBtn.style.display = "none";
        if (previewBtn) previewBtn.style.display = "none";
        const preview = $("globalLaborLawPreview");
        if (preview) preview.style.display = "none";
      }
    } catch {
      label.textContent = "Error al verificar estado";
      if (deleteBtn) deleteBtn.style.display = "none";
      if (previewBtn) previewBtn.style.display = "none";
    }
  }

  function initGlobalSettings() {
    const btn = $("globalSettingsBtn");
    const modal = $("globalSettingsModal");
    if (!btn || !modal) return;

    btn.addEventListener("click", () => {
      $("globalSettingsFeedback").textContent = "";
      loadGlobalLaborLawStatus();
      modal.showModal();
    });

    modal.querySelector(".modal-close-btn")?.addEventListener("click", () => modal.close());

    $("previewGlobalLaborLawBtn")?.addEventListener("click", async () => {
      const button = $("previewGlobalLaborLawBtn");
      if (button) button.disabled = true;
      try {
        const res = await fetch(apiUrl("/api/settings/labor-law/preview"));
        if (!res.ok) throw new Error("No se pudo generar la vista previa.");
        const data = await res.json();
        openLaborLawEditor(data);
      } catch (err) {
        $("globalSettingsFeedback").textContent = err.message;
      } finally {
        if (button) button.disabled = false;
      }
    });

    $("laborLawEditorText")?.addEventListener("input", updateLaborLawEditorCount);
    document.querySelectorAll("[data-labor-law-view]").forEach((button) => {
      button.addEventListener("click", () => setLaborLawEditorView(button.dataset.laborLawView));
    });
    $("findNextLaborLawBtn")?.addEventListener("click", findNextLaborLawMatch);
    $("laborLawEditorSearch")?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); findNextLaborLawMatch(); }
    });
    $("closeLaborLawEditorBtn")?.addEventListener("click", closeLaborLawEditor);
    $("cancelLaborLawEditorBtn")?.addEventListener("click", closeLaborLawEditor);
    $("laborLawEditorModal")?.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeLaborLawEditor();
    });
    $("saveLaborLawEditorBtn")?.addEventListener("click", async () => {
      const text = ($("laborLawEditorText")?.value || "").trim();
      if (text.length < 100) { alert("El contenido es demasiado corto para utilizarse como contexto legal."); return; }
      if (!confirm("¿Guardar esta versión corregida para futuras estructuraciones?")) return;
      const button = $("saveLaborLawEditorBtn");
      button.disabled = true;
      try {
        const res = await fetch(apiUrl("/api/settings/labor-law/text"), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text })
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload.error || "No se pudo guardar la versión corregida.");
        laborLawOriginalText = text;
        $("laborLawEditorMode").textContent = "Versión editada";
        $("laborLawEditorMode").classList.add("is-edited");
        await loadGlobalLaborLawStatus();
        $("globalSettingsFeedback").textContent = "Versión corregida guardada y activa para leIA.";
      } catch (error) {
        alert(error.message);
      } finally {
        button.disabled = false;
      }
    });

    $("globalSettingsForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fileInput = $("globalLaborLawUpload");
      const file = fileInput?.files?.[0];
      const feedback = $("globalSettingsFeedback");
      if (!file) { feedback.textContent = "Por favor seleccioná un PDF."; return; }

      feedback.textContent = "Subiendo archivo...";
      const formData = new FormData();
      formData.append("laborLawPdf", file);
      try {
        const res = await fetch(apiUrl("/api/settings/labor-law"), { method: "POST", body: formData });
        if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || "Error al subir"); }
        feedback.textContent = "¡Ley de trabajo cargada correctamente!";
        feedback.style.color = "var(--ok, green)";
        fileInput.value = "";
        const preview = $("globalLaborLawPreview");
        if (preview) preview.style.display = "none";
        await loadGlobalLaborLawStatus();
        setTimeout(() => { modal.close(); feedback.textContent = ""; }, 1500);
      } catch (err) {
        feedback.textContent = err.message;
        feedback.style.color = "var(--red, red)";
      }
    });

    $("deleteGlobalLaborLawBtn")?.addEventListener("click", async () => {
      if (!confirm("¿Seguro que deseas eliminar la ley de trabajo global?")) return;
      const feedback = $("globalSettingsFeedback");
      try {
        const res = await fetch(apiUrl("/api/settings/labor-law"), { method: "DELETE" });
        if (!res.ok) throw new Error("Error al eliminar");
        feedback.textContent = "Documento eliminado.";
        const preview = $("globalLaborLawPreview");
        if (preview) preview.style.display = "none";
        await loadGlobalLaborLawStatus();
      } catch (e) {
        feedback.textContent = e.message;
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initGlobalSettings, { once: true });
  } else {
    initGlobalSettings();
  }
})();
