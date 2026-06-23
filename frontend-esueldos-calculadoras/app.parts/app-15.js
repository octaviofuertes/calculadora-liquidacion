(function () {
  const $ = (id) => document.getElementById(id);
  const getApiBase = () => {
    if (window.eSueldosApi?.baseUrl !== undefined) {
      return window.eSueldosApi.baseUrl;
    }
    const stored = localStorage.getItem("apiBase");
    if (stored) return stored;
    const host = location.hostname === "localhost" || location.hostname === "127.0.0.1"
      ? "http://localhost:4100"
      : location.origin;
    return host;
  };
  const apiUrl = (path) => getApiBase() + path;

  async function loadGlobalLaborLawStatus() {
    const label = $("globalLaborLawLabel");
    const deleteBtn = $("deleteGlobalLaborLawBtn");
    if (!label) return;
    try {
      const res = await fetch(apiUrl("/api/settings"));
      const data = await res.json().catch(() => ({}));
      if (data.hasGlobalLaborLaw) {
        label.textContent = "Ley de Trabajo (PDF) cargada globalmente";
        label.style.color = "var(--ok, green)";
        if (deleteBtn) deleteBtn.style.display = "block";
      } else {
        label.textContent = "No hay Ley de Trabajo cargada";
        label.style.color = "var(--text-muted, gray)";
        if (deleteBtn) deleteBtn.style.display = "none";
      }
    } catch {
      label.textContent = "Error al verificar estado";
      if (deleteBtn) deleteBtn.style.display = "none";
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
