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

  async function renderDynamicFields(conv) {
    if (isGenericConvention(conv)) {
      let metadata = [];
      if (!["camioneros", "farmacia", "uocra"].includes(conv.id)) {
        try {
          const res = await fetch(apiUrl(`/api/calculators/${encodeURIComponent(conv.id)}/metadata`));
          if (res.ok) {
            metadata = await res.json();
          }
        } catch (e) {
          console.warn("No se pudo cargar la metadata de la calculadora generada:", e);
        }
      }
      
      const category = getCategory(conv);
      const model = conv.liquidationModel || {};
      const rules = model.rules || {};
      
      const availableSalaryTypes = [
        (category?.monthly || Object.keys(category?.monthlyByPeriod || {}).length) && "monthly",
        (category?.day || Object.keys(category?.dayByPeriod || {}).length) && "daily",
        (category?.hourly || Object.keys(category?.hourlyByPeriod || {}).length) && "hourly"
      ].filter(Boolean);
      const salaryType = genericSalaryTypeForCategory(conv, category);
      const salaryTypeField = availableSalaryTypes.length > 1 ? `
          <label class="field"><span>Forma de liquidacion</span><select id="genSalaryType">
            ${availableSalaryTypes.map((type) => `<option value="${type}"${type === salaryType ? " selected" : ""}>${type === "monthly" ? "Sueldo mensual" : type === "daily" ? "Por jornal" : "Por hora"}</option>`).join("")}
          </select></label>` : "";
      const defaultWorkUnits = salaryType === "hourly"
        ? (rules.hourDivisor || rules.overtime?.divisor || 200)
        : (rules.monthDivisor || rules.dayDivisor || 30);
      const workUnitsField = salaryType === "monthly" ? "" : `
          <label class="field"><span>${salaryType === "hourly" ? "Horas trabajadas" : "Jornales trabajados"}</span><input id="genWorkUnits" type="number" min="0" step="0.01" value="${escapeHtml(defaultWorkUnits)}"></label>`;
          
      function formatConceptFormulaDetail(field) {
        let text = field.description || field.detail || "";
        const label = field.label || field.id || "";
        const norm = (label).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");

        if (norm.includes("zonadesfavorable20") || (norm.includes("zonadesfavorable") && norm.includes("20"))) {
          return text.replace(/<b>Calculo:.*<\/b>/gi, "").replace(/Calculo:.*$/gi, "").trim() + "<br><br><b>Calculo: Sueldo Básico x 20%</b>";
        }
        if (norm.includes("zonadesfavorable5") || (norm.includes("zonadesfavorable") && norm.includes("5"))) {
          return text.replace(/<b>Calculo:.*<\/b>/gi, "").replace(/Calculo:.*$/gi, "").trim() + "<br><br><b>Calculo: Sueldo Básico x 5%</b>";
        }
        if (norm.includes("manejodevalores") || norm.includes("fallacaja")) {
          return text.replace(/<b>Calculo:.*<\/b>/gi, "").replace(/Calculo:.*$/gi, "").trim() + "<br><br><b>Calculo: Monto de escala o Fijo anual en cuotas (Art. 30)</b>";
        }
        if (norm.includes("noremunerativo") || norm.includes("incrementonoremunerativo")) {
          return text.replace(/<b>Calculo:.*<\/b>/gi, "").replace(/Calculo:.*$/gi, "").trim() + "<br><br><b>Calculo: Suma fija de escala salarial vigente</b>";
        }
        if (norm.includes("kilometraje") || norm.includes("largadistancia")) {
          return text.replace(/<b>Calculo:.*<\/b>/gi, "").replace(/Calculo:.*$/gi, "").trim() + "<br><br><b>Calculo: Valor por km x Cantidad (Art. 36)</b>";
        }
        if (norm.includes("presentis")) {
          return text.replace(/<b>Calculo:.*<\/b>/gi, "").replace(/Calculo:.*$/gi, "").trim() + "<br><br><b>Calculo: (Sueldo Básico + Antigüedad) x 8.33%</b>";
        }
        if (norm.includes("antiguedad")) {
          return text.replace(/<b>Calculo:.*<\/b>/gi, "").replace(/Calculo:.*$/gi, "").trim() + "<br><br><b>Calculo: Sueldo Básico x 1% x Años de servicio</b>";
        }
        
        const pctMatch = label.match(/(\d+(?:[.,]\d+)?)\s*%/);
        if (pctMatch && (text.includes("x 0%") || text.includes("Monto de escala"))) {
          return text.replace(/<b>Calculo:.*<\/b>/gi, "").replace(/Calculo:.*$/gi, "").trim() + `<br><br><b>Calculo: Sueldo Básico x ${pctMatch[1]}%</b>`;
        }

        return text.replace(/Calculo:\s*[^<]*?\bx\s*0%/gi, "Calculo: Monto según escala salarial vigente").replace(/x\s*0%/gi, "");
      }

      const groups = { remunerative: { checks: [], numbers: [] }, non_remunerative: { checks: [], numbers: [] }, deduction: { checks: [], numbers: [] } };
      metadata.forEach(field => {
        const targetGroup = field.group === 'non_remunerative' ? groups.non_remunerative : field.group === 'deduction' ? groups.deduction : groups.remunerative;
        if (field.type === "checkbox") {
          let descText = formatConceptFormulaDetail(field);
          let infoBtn = descText ? `
            <button type="button" class="concept-info-toggle" aria-label="Ver detalles" onclick="event.preventDefault(); let desc = this.parentElement.parentElement.querySelector('.check-desc'); let isHidden = desc.style.display === 'none'; desc.style.display = isHidden ? 'block' : 'none'; this.querySelector('svg').style.transform = isHidden ? 'rotate(90deg)' : 'rotate(0deg)';" style="background:none; border:none; color:var(--muted); cursor:pointer; padding:4px; border-radius:4px; display:flex; align-items:center; justify-content:center;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transition: transform 0.2s; transform: rotate(0deg);">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </button>
          ` : "";
          let descHtml = descText ? `<div class="check-desc" style="display: none; padding-top: 8px; margin-top: 8px; border-top: 1px solid var(--line); width: 100%; color: var(--muted); font-size: 0.9em;">${descText}</div>` : "";
          targetGroup.checks.push(`
            <label class="check-row ${descHtml ? 'has-desc' : ''}" style="flex-wrap: wrap; align-self: flex-start;">
              <div style="display: flex; align-items: center; width: 100%; gap: 9px;">
                <input id="${field.id}" type="checkbox" ${field.defaultValue ? "checked" : ""}>
                <div class="check-label-wrap" style="flex: 1;">
                  <span>${escapeHtml(field.label)}</span>
                </div>
                ${infoBtn}
              </div>
              ${descHtml}
            </label>
          `);
        } else {
          let label = escapeHtml(field.label);
          let badge = "";
          const match = label.match(/(\d+)\s*%/);
          if (match) {
             badge = `<span class="concept-badge">+${match[1]}%</span>`;
             label = label.replace(match[0], "").replace(/\(\s*\)/g, "").trim();
          }
          let descText = formatConceptFormulaDetail(field);
          let infoBtn = descText ? `
            <button type="button" class="concept-info-toggle" aria-label="Ver detalles" onclick="event.preventDefault(); let desc = this.parentElement.parentElement.querySelector('.check-desc') || this.parentElement.parentElement.parentElement.querySelector('.check-desc'); let isHidden = desc.style.display === 'none'; desc.style.display = isHidden ? 'block' : 'none'; this.querySelector('svg').style.transform = isHidden ? 'rotate(90deg)' : 'rotate(0deg)';" style="background:none; border:none; color:var(--muted); cursor:pointer; padding:4px; border-radius:4px; display:flex; align-items:center; justify-content:center;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transition: transform 0.2s; transform: rotate(0deg);">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </button>
          ` : "";
          let descHtml = descText ? `<div class="check-desc" style="display: none; margin-top: 2px; color: var(--muted); font-size: 0.9em;">${descText}</div>` : "";
          targetGroup.numbers.push(`
            <div class="concept-table-row">
              <div class="concept-table-label">
                <div style="display: flex; align-items: center; gap: 4px;">
                  <strong>${label}</strong>
                  ${infoBtn}
                </div>
                ${descHtml}
              </div>
              <div class="concept-table-badge">${badge}</div>
              <div class="concept-table-input">
                <input id="${field.id}" type="number" min="0" step="0.01" value="${escapeHtml(field.defaultValue || 0)}" placeholder="0">
              </div>
            </div>
          `);
        }
      });

      const buildSection = (title, data) => {
        if (data.checks.length === 0 && data.numbers.length === 0) return "";
        const tableHtml = data.numbers.length > 0 ? `
          <div class="concept-table">
            <div class="concept-table-head">
              <div class="concept-table-th-label">CONCEPTO</div>
              <div class="concept-table-th-badge"></div>
              <div class="concept-table-th-input">CANTIDAD</div>
            </div>
            ${data.numbers.join("")}
          </div>
        ` : "";
        return `
          <div class="step-copy" style="margin-top: 32px;">
            <h3>${title}</h3>
          </div>
          ${tableHtml}
          <div class="check-grid generic-checks" style="margin-top: 16px;">
            ${data.checks.join("")}
          </div>
        `;
      };

      const remHtml = buildSection("Haberes Remunerativos", groups.remunerative);
      const noRemHtml = buildSection("Haberes No Remunerativos", groups.non_remunerative);
      const dedHtml = buildSection("Retenciones y Descuentos del CCT", groups.deduction);
      const allSections = remHtml + noRemHtml + dedHtml;

      $("dynamicFields").innerHTML = `<div class="dynamic-card generic-convention-card" style="background: transparent; border: none; padding: 0; box-shadow: none; margin-top: 0;">
        <div class="grid three" style="margin-bottom: 24px;">
          ${salaryTypeField}
          ${workUnitsField}
          <label class="field"><span>Dias ausentes injust.</span><input id="genAbsentDays" type="number" min="0" step="1" value="0"></label>
        </div>
        
        ${allSections || '<div class="empty" style="margin-top: 24px;">No hay conceptos variables definidos para este convenio.</div>'}
        
        <p class="generic-note" style="display: none;">
          <strong>Calculadora Específica Activa:</strong> Esta pantalla usa el script de calculo generado especificamente para este convenio.
        </p>
      </div>`;
      enhanceFieldHelp($("payrollFormPanel"));
      $("genSalaryType")?.addEventListener("change", () => {
        markDirty();
        renderDynamicFields(conv);
      });
      return;
    }

    if (conv.id === "uocra") {
      // Detectar si la categoría seleccionada es mensual (Sereno)
      const currentCat = getCategory(conv);
      const isSereno = currentCat?.monthly === true;
      const defaultMode = isSereno ? "mensual" : "1";
      const defaultHours = isSereno ? 176 : 88;

      const infoBtn = (desc) => desc ? `
        <button type="button" class="concept-info-toggle" aria-label="Ver detalles" onclick="event.preventDefault(); let desc = this.parentElement.parentElement.querySelector('.check-desc') || this.parentElement.parentElement.parentElement.querySelector('.check-desc'); let isHidden = desc.style.display === 'none'; desc.style.display = isHidden ? 'block' : 'none'; this.querySelector('svg').style.transform = isHidden ? 'rotate(90deg)' : 'rotate(0deg)';" style="background:none; border:none; color:var(--muted); cursor:pointer; padding:4px; border-radius:4px; display:flex; align-items:center; justify-content:center;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transition: transform 0.2s; transform: rotate(0deg);"><polyline points="9 18 15 12 9 6"></polyline></svg>
        </button>
      ` : "";
      const descHtml = (desc) => desc ? `<div class="check-desc" style="display: none; margin-top: 2px; color: var(--muted); font-size: 0.9em;">${desc}</div>` : "";
      const numRow = (id, label, badge, desc) => `
          <div class="concept-table-row">
            <div class="concept-table-label">
              <div style="display: flex; align-items: center; gap: 4px;"><strong>${label}</strong>${infoBtn(desc)}</div>
              ${descHtml(desc)}
            </div>
            <div class="concept-table-badge">${badge}</div>
            <div class="concept-table-input"><input id="${id}" type="number" min="0" step="0.01" value="0" placeholder="0"></div>
          </div>`;
      const selRow = (id, label, badge, desc, options) => `
          <div class="concept-table-row">
            <div class="concept-table-label">
              <div style="display: flex; align-items: center; gap: 4px;"><strong>${label}</strong>${infoBtn(desc)}</div>
              ${descHtml(desc)}
            </div>
            <div class="concept-table-badge">${badge}</div>
            <div class="concept-table-input" style="justify-content: flex-end;">
              <select id="${id}" style="width: auto; padding: 4px; border: 1px solid var(--border); border-radius: 4px;">${options}</select>
            </div>
          </div>`;
      const chkRow = (id, label, desc, checked) => `
          <label class="check-row ${desc ? 'has-desc' : ''}" style="flex-wrap: wrap; align-self: flex-start;">
            <div style="display: flex; align-items: center; width: 100%; gap: 9px;">
              <input id="${id}" type="checkbox" ${checked ? "checked" : ""}>
              <div class="check-label-wrap" style="flex: 1;"><span>${label}</span></div>
              ${infoBtn(desc)}
            </div>
            ${descHtml(desc)}
          </label>`;

      $("dynamicFields").innerHTML = `<div class="dynamic-card generic-convention-card" style="background: transparent; border: none; padding: 0; box-shadow: none; margin-top: 0;">
        <div class="grid three" style="margin-bottom: 24px;">
          <label class="field"><span>Liquidacion</span><select id="uocraPeriodMode">
            <option value="1"${defaultMode === "1" ? " selected" : ""}>1ra quincena</option>
            <option value="2"${defaultMode === "2" ? " selected" : ""}>2da quincena</option>
            <option value="mensual"${defaultMode === "mensual" ? " selected" : ""}>Mensual</option>
          </select></label>
          <label class="field"><span>Horas normales</span><input id="uocraHours" type="number" min="0" step="0.01" value="${defaultHours}"></label>
          <label class="field"><span>Hs inasist. injust.</span><input id="uocraAbsence" type="number" min="0" step="0.01" value="0"></label>
        </div>

        <div class="step-copy" style="margin-top: 32px;">
          <h3>Haberes Remunerativos</h3>
        </div>
        <div class="concept-table">
          <div class="concept-table-head">
            <div class="concept-table-th-label">CONCEPTO</div>
            <div class="concept-table-th-badge"></div>
            <div class="concept-table-th-input">CANTIDAD</div>
          </div>
          ${numRow("uocraFrancoTrab", "Franco trabajado hs", "x2", "Horas trabajadas durante el descanso semanal, se liquidan al 100% de recargo.")}
          ${numRow("uocraFeriadoNoTrab", "Feriado no trab. hs", "Jornal", "Horas correspondientes a feriados nacionales no trabajados.")}
          ${selRow("uocraAltitude", "Altura %", "Adicional", "Porcentaje adicional por trabajos en altura o profundidad.", '<option value="0">No aplica</option><option value="15">15%</option><option value="20">20%</option><option value="25">25%</option>')}
          ${numRow("uocraExtra50", "Hs extra 50%", "x1,5", "Horas extraordinarias realizadas en días hábiles.")}
          ${numRow("uocraExtra100", "Hs extra 100%", "x2", "Horas extraordinarias realizadas en fines de semana o feriados.")}
        </div>
        <div class="check-grid generic-checks" style="margin-top: 16px;">
          ${chkRow("uocraSeniority", "Antiguedad", "Se calcula aplicando un porcentaje (dependiendo la zona y categoría) por cada año de antigüedad sobre el salario básico.", true)}
          ${chkRow("uocraPresentism", "Presentismo 20%", "Premio a la asistencia perfecta, calculado como el 20% del salario básico y algunos adicionales.", true)}
          ${chkRow("uocraSpecialTask", "Tareas especiales 20%", "Adicional por la realización de tareas riesgosas o insalubres estipuladas en convenio.", false)}
          ${chkRow("uocraSubmuracion", "Submuracion 10%", "Adicional por tareas de submuración, excavaciones o trabajos afines.", false)}
          ${chkRow("uocraHormigon", "Hormigon armado 15%", "Adicional por manipulación y trabajos específicos con hormigón armado.", false)}
          ${chkRow("uocraEncargado", "Encargado 10%", "Adicional por cumplir funciones de encargado, capataz o liderazgo de grupo.", false)}
        </div>

        <div class="step-copy" style="margin-top: 32px;">
          <h3>Haberes No Remunerativos</h3>
        </div>
        <div class="check-grid generic-checks" style="margin-top: 16px;">
          ${chkRow("uocraSNR", "SNR paritaria", "Suma No Remunerativa vigente pactada en la última revisión paritaria de UOCRA.", true)}
          ${chkRow("uocraVestimenta", "Asignacion vestimenta (Art.35)", "Asignación especial por falta de provisión de ropa de trabajo (Art. 35).", false)}
        </div>

        <div class="step-copy" style="margin-top: 32px;">
          <h3>Deducciones / Aportes</h3>
        </div>
        <div class="check-grid generic-checks" style="margin-top: 16px;">
          ${chkRow("uocraAfiliado", "Afiliado UOCRA (cuota sindical 2,5%)", "Retención de la cuota sindical para trabajadores afiliados a la Unión Obrera de la Construcción.", true)}
        </div>
      </div>`;
      enhanceFieldHelp($("payrollFormPanel"));

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
      const r = conv.rules || {};
      const infoBtn = (desc) => desc ? `
        <button type="button" class="concept-info-toggle" aria-label="Ver detalles" onclick="event.preventDefault(); let desc = this.parentElement.parentElement.querySelector('.check-desc') || this.parentElement.parentElement.parentElement.querySelector('.check-desc'); let isHidden = desc.style.display === 'none'; desc.style.display = isHidden ? 'block' : 'none'; this.querySelector('svg').style.transform = isHidden ? 'rotate(90deg)' : 'rotate(0deg)';" style="background:none; border:none; color:var(--muted); cursor:pointer; padding:4px; border-radius:4px; display:flex; align-items:center; justify-content:center;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transition: transform 0.2s; transform: rotate(0deg);"><polyline points="9 18 15 12 9 6"></polyline></svg>
        </button>
      ` : "";
      const descHtml = (desc) => desc ? `<div class="check-desc" style="display: none; padding-top: 6px; margin-top: 6px; border-top: 1px solid var(--line); width: 100%; color: var(--muted); font-size: 0.88em; line-height: 1.4;">${desc}</div>` : "";
      const chk = (id, label, desc, checked) => `
        <label class="check-row ${desc ? 'has-desc' : ''}" style="flex-wrap: wrap; align-self: flex-start;">
          <div style="display: flex; align-items: center; width: 100%; gap: 9px;">
            <input id="${id}" type="checkbox" ${checked ? "checked" : ""}>
            <div class="check-label-wrap" style="flex: 1;"><span>${label}</span></div>
            ${infoBtn(desc)}
          </div>
          ${descHtml(desc)}
        </label>`;
      const numRow = (id, label, badge, desc, defaultVal = "0") => `
        <div class="concept-table-row">
          <div class="concept-table-label">
            <div style="display: flex; align-items: center; gap: 4px;"><strong>${label}</strong>${infoBtn(desc)}</div>
            ${descHtml(desc)}
          </div>
          <div class="concept-table-badge">${badge ? `<span class="concept-badge">${badge}</span>` : ""}</div>
          <div class="concept-table-input"><input id="${id}" type="number" min="0" step="0.01" value="${defaultVal}" placeholder="0"></div>
        </div>`;

      const wkHrs  = r.weeklyHours  || 45;
      const insHrs = r.insalubreWeeklyHours || 33;
      const cajPct  = r.cajeroPct  || 10;
      const admPct  = r.tareasAdministrativasPct || 5;
      const admTen  = r.adminTenurePctOver2Years || 10;
      const perfPct = r.perfumeriaPct || 10;
      const bikePct = r.bikePct || 10;
      const langPct = r.languagePct || 10;
      const auxPct  = r.auxTitlePct || 20;
      const titPct  = r.tituloFarmaceuticoPct || 35;
      const adsPct  = r.adscripcionPct || 23;
      const bloqPct = r.bloqueoTituloPct || 54;
      const cajFnd  = r.fallaCajaPct || 10;
      const adefPct = r.adefSolidarityPct || 2;
      const unionPct = r.unionPct || 2;
      const cajaCompPct = r.cajaCompensadoraPct || 1;
      const proEdifPct  = r.proEdificioPct || 1;
      const nightPct = r.nightPct || 100;

      $("dynamicFields").innerHTML = `<div class="dynamic-card generic-convention-card" style="background: transparent; border: none; padding: 0; box-shadow: none; margin-top: 0;">
        <div class="grid three" style="margin-bottom: 24px;">
          <label class="field"><span>Horas semanales</span><input id="farmWeeklyHours" type="number" min="0" max="${wkHrs}" step="0.01" value="${wkHrs}"></label>
          <label class="field"><span>% del mes</span><input id="farmMonthPct" type="number" min="0" max="100" step="0.01" value="100"></label>
          <label class="field"><span>Dias del mes</span><input id="farmWorkingDays" type="number" min="1" step="1" value="30"></label>
          <label class="field"><span>Dias ausentes injust.</span><input id="farmAbsentDays" type="number" min="0" step="1" value="0"></label>
          <label class="field"><span>Dias ausentes just.</span><input id="farmAbsentDaysJust" type="number" min="0" step="1" value="0"></label>
          <label class="field"><span>Dias no rem. <small>(auto si vacio)</small></span><input id="farmNoRemDays" type="number" min="0" step="1" placeholder="Auto"></label>
          <label class="field"><span>Idiomas extranjeros</span><input id="farmLanguages" type="number" min="0" step="1" value="0"></label>
        </div>

        <div class="step-copy" style="margin-top: 32px;"><h3>Haberes Remunerativos</h3></div>
        <div class="concept-table">
          <div class="concept-table-head">
            <div class="concept-table-th-label">CONCEPTO</div>
            <div class="concept-table-th-badge"></div>
            <div class="concept-table-th-input">CANTIDAD</div>
          </div>
          ${numRow("farmExtra50",  "Horas extra 50%",  "x1,5", "Horas extraordinarias en días hábiles. Cálculo: Valor hora x 1.5 x Horas (Art. 14)")}
          ${numRow("farmExtra100", "Horas extra 100%", "x2",   "Horas extraordinarias en fines de semana o feriados. Cálculo: Valor hora x 2 x Horas (Art. 14)")}
          ${numRow("farmNightHours", "Hs nocturnas voluntarias", "+${nightPct}%", "Recargo ${nightPct}% por jornada nocturna voluntaria (Art. 16-17)")}
          ${numRow("farmHolidayWorkedDays",    "Feriados trabajados",    "Doble rem.", "Feriados trabajados — se liquidan como doble remuneración")}
          ${numRow("farmHolidayNotWorkedDays", "Feriados no trabajados", "Diferencia", "Feriados no trabajados — diferencia vacacional/30")}
          ${numRow("farmPharmacyDayWorked",    "Dia farmacia trabajado (6 sep.)", "Doble rem.", "Día del Empleado de Farmacia trabajado (6 de septiembre) — Art. 41 inc. b")}
          ${numRow("farmPharmacyDayNotWorked", "Dia farmacia no trab.",  "Diferencia", "Día del Empleado de Farmacia no trabajado — Art. 41 inc. b")}
          ${numRow("farmVacationDays", "Dias vacaciones", "÷25", "Licencia anual paga — Cálculo: Sueldo / 25 x Días (Art. 155 LCT)")}
          ${numRow("farmSacDays", "Dias SAC", "÷180", "SAC proporcional — Cálculo: Mejor rem. / 2 / 180 x Días", "180")}
          <div class="concept-table-row">
            <div class="concept-table-label"><div style="display:flex;align-items:center;gap:4px;"><strong>Mejor rem. SAC</strong></div></div>
            <div class="concept-table-badge"></div>
            <div class="concept-table-input"><input id="farmSacBestRem" type="number" min="0" step="0.01" value="0" placeholder="0"></div>
          </div>
        </div>
        <div class="check-grid generic-checks" style="margin-top: 16px;">
          ${chk("farmSeniority",              `Escalafon por antiguedad`,                  "Art. 13 CCT 429/2005: tramos 5%-10%-20%-25%-30%-35% según años de servicio", true)}
          ${chk("farmSeniorityOnFixedAdditions", "Antiguedad sobre basico + adicionales fijos", "Incluye adicionales fijos (título, cajero, etc.) en la base de cálculo de antigüedad", true)}
          ${chk("farmInsalubre",              `Jornada insalubre ${insHrs} hs pagadas como ${wkHrs} hs`, `Jornada insalubre Art. 15: ${insHrs} hs se abonan como ${wkHrs} hs semanales`, false)}
          ${chk("farmSac",                    "Liquidar SAC proporcional",                 "Agrega SAC proporcional al recibo del período. Ley 23.041", false)}
          ${chk("farmDiscountVacationDays",   "Descontar dias normales por vacaciones",    "Descuenta días a valor normal cuando hay vacaciones en el período", true)}
        </div>

        <div class="step-copy" style="margin-top: 32px;"><h3>Adicionales CCT 429/2005 (Art. 18)</h3></div>
        <div class="check-grid generic-checks" style="margin-top: 16px;">
          ${chk("farmCajero",      `Adicional cajero ${cajPct}%`,                       `${cajPct}% sobre básico + antigüedad. Cumplir tareas de cajero (Art. 18 inc. c)`, false)}
          ${chk("farmAdminTitle",  `Tareas administrativas ${admPct}%`,                 `${admPct}% sobre básico + antigüedad. Requiere título habilitante (Art. 18 inc. d)`, false)}
          ${chk("farmAdminTenure", `Adicional administrativo por antiguedad (${admPct}-${admTen}%)`, `${admPct}% inicial, ${admTen}% con 2+ años en la tarea. Art. 18 inc. d`, false)}
          ${chk("farmPerfumeria",  `Adicional perfumeria ${perfPct}%`,                  `${perfPct}% sobre básico + antigüedad. Requiere 3 años empresa + título terciario (Art. 18 inc. e)`, false)}
          ${chk("farmBike",        `Uso bici/ciclomotor/moto ${bikePct}%`,              `${bikePct}% sobre básico + antigüedad. Uso de vehículo propio para tareas (Art. 18 inc. g)`, false)}
          ${chk("farmAuxTitle",    `Titulo auxiliar de farmacia ${auxPct}%`,            `${auxPct}% sobre Empleado de Farmacia + antigüedad. Requiere título de auxiliar (Art. 18 inc. h)`, false)}
          ${chk("farm_tituloFarmaceutico", `Titulo farmaceutico ${titPct}% (escala)`,   `${titPct}% sobre Cat. Inicial A + antigüedad. Requiere título universitario de Farmacéutico (Art. 18 inc. a)`, false)}
          ${chk("farm_adscripcion",        `Adscripcion ${adsPct}% (escala)`,           `${adsPct}% adicional sobre Cat. Inicial A + antigüedad. Para farmacéuticos con adscripción (Art. 18 inc. a)`, false)}
          ${chk("farm_bloqueo",            `Bloqueo direccion tecnica ${bloqPct}% (escala)`, `${bloqPct}% sobre Cat. Inicial A + antigüedad. Para quien ejerce Dirección Técnica con bloqueo de título (Art. 18 inc. b)`, false)}
          ${chk("farmFallaCaja",   `Fondo compensador falla de caja ${cajFnd}%`,        `${cajFnd}% sobre básico. Para cajeros — no remunerativo (Art. 19)`, false)}
        </div>

        <div class="step-copy" style="margin-top: 32px;"><h3>No Remunerativos</h3></div>
        <div class="check-grid generic-checks" style="margin-top: 16px;">
          ${chk("farmNonRem",       "Suma no remunerativa escala",  "Agrega el no remunerativo de escala vigente del período", true)}
          ${chk("farmProrateNonRem","Prorratear no rem. por dias",  "Prorratear el no remunerativo en función de los días no remunerativos del período", true)}
        </div>

        <div class="step-copy" style="margin-top: 32px;"><h3>Aportes del Trabajador</h3></div>
        <div class="check-grid generic-checks" style="margin-top: 16px;">
          ${chk("farmAdefSolidarity",  `Aporte solidario ADEF ${adefPct}%`,          `Aporte solidario convencional ADEF: ${adefPct}% sobre total remunerativo (Art. 46 CCT)`, true)}
          ${chk("farmSocialJuneDec",   `Aporte asistencia social ${cajaCompPct}% (jun/dic)`, `${cajaCompPct}% adicional en junio y diciembre sobre total remunerativo (Art. 46 CCT)`, true)}
          ${chk("farmContribution",    "Contribucion extraordinaria escala",          "Contribución extraordinaria según escala vigente del período", true)}
          ${chk("farmOsFullTimeBase",  "OS base jornada completa si jornada reducida","Garantiza base mínima de obra social equivalente a jornada completa", true)}
          ${chk("farmUnionContribution", `Cuota sindical afiliado ADEF ${unionPct}%`, `Retención cuota sindical: ${unionPct}% sobre total remunerativo — solo afiliados`, false)}
          ${chk("farmCajaCompensadora",  `Caja compensadora ${cajaCompPct}%`,         `${cajaCompPct}% sobre remunerativo. Aporte a caja compensadora CCT 429/2005`, false)}
          ${chk("farmProEdificio",       `Pro edificio ${proEdifPct}%`,               `${proEdifPct}% sobre remunerativo. Aporte pro edificio CCT 429/2005`, false)}
        </div>
      </div>`;
      enhanceFieldHelp($("payrollFormPanel"));
    }


    if (conv.id === "camioneros") {
      const infoBtn = (desc) => desc ? `
        <button type="button" class="concept-info-toggle" aria-label="Ver detalles" onclick="event.preventDefault(); let desc = this.parentElement.parentElement.querySelector('.check-desc') || this.parentElement.parentElement.parentElement.querySelector('.check-desc'); let isHidden = desc.style.display === 'none'; desc.style.display = isHidden ? 'block' : 'none'; this.querySelector('svg').style.transform = isHidden ? 'rotate(90deg)' : 'rotate(0deg)';" style="background:none; border:none; color:var(--muted); cursor:pointer; padding:4px; border-radius:4px; display:flex; align-items:center; justify-content:center;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transition: transform 0.2s; transform: rotate(0deg);"><polyline points="9 18 15 12 9 6"></polyline></svg>
        </button>
      ` : "";
      const descHtml = (desc) => desc ? `<div class="check-desc" style="display: none; padding-top: 6px; margin-top: 6px; border-top: 1px solid var(--line); width: 100%; color: var(--muted); font-size: 0.88em; line-height: 1.4;">${desc}</div>` : "";
      const numRow = (id, label, badge, desc, defaultVal = "0") => `
        <div class="concept-table-row" style="flex-wrap: wrap;">
          <div class="concept-table-label" style="flex: 1; min-width: 180px;">
            <div style="display: flex; align-items: center; gap: 6px;"><strong>${label}</strong>${infoBtn(desc)}</div>
          </div>
          <div class="concept-table-badge">${badge ? `<span class="concept-badge">${badge}</span>` : ""}</div>
          <div class="concept-table-input"><input id="${id}" type="number" min="0" step="0.01" value="${defaultVal}" placeholder="0"></div>
          ${descHtml(desc)}
        </div>`;
      const chkRow = (id, label, desc, checked) => `
        <label class="check-row ${desc ? 'has-desc' : ''}" style="flex-wrap: wrap; align-self: flex-start;">
          <div style="display: flex; align-items: center; width: 100%; gap: 9px;">
            <input id="${id}" type="checkbox" ${checked ? "checked" : ""}>
            <div class="check-label-wrap" style="flex: 1;"><span>${label}</span></div>
            ${infoBtn(desc)}
          </div>
          ${descHtml(desc)}
        </label>`;

      $("dynamicFields").innerHTML = `<div class="dynamic-card">
        <h2 class="dynamic-title">Parametros Camioneros - CCT 40/89</h2>
        <div class="camioneros-section-title">Base mensual y dias</div>
        <div class="grid three">
          <label class="field"><span>Divisor jornales</span><input id="camPeriodDays" type="number" min="1" step="1" value="24"></label>
          <label class="field"><span>Jornales a pagar</span><input id="camWorkingDays" type="number" min="0" step="1" value="24"></label>
          <label class="field"><span>Inasist. injust.</span><input id="camAbsentDays" type="number" min="0" step="1" value="0"></label>
          <label class="field"><span>Dias no rem. <small>(auto si vacio)</small></span><input id="camNoRemDays" type="number" min="0" step="1" placeholder="Auto"></label>
          <label class="field"><span>Plus vacacional dias</span><input id="camVacationPlusDays" type="number" min="0" step="1" value="0"></label>
          <label class="field"><span>Dia camionero trab.</span><input id="camDriverDay" type="number" min="0" max="1" step="1" value="0"></label>
        </div>

        <div class="step-copy" style="margin-top: 24px;">
          <h3>Viaticos Art. 4.2.11 y Kilometraje</h3>
        </div>
        <div class="concept-table">
          <div class="concept-table-head">
            <div class="concept-table-th-label">CONCEPTO VIATICO</div>
            <div class="concept-table-th-badge">VALOR</div>
            <div class="concept-table-th-input">CANTIDAD</div>
          </div>
          ${numRow("camPernoctadaDays", "Pernoctadas (no rem.)", "$17.841,22", "Pernoctadas fuera de residencia Art. 4.1.14 / 4.2.11 ($17.841,22 por día). Cálculo: $17.841,22 x Días x Coeficiente de zona")}
          ${numRow("camKmExtra", "Km larga distancia", "$80,09/km", "Horas extraordinarias por kilometraje Art. 4.2.3 ($80,09 por km). Cálculo: $80,09 x Km x Coeficiente de zona")}
          ${numRow("camKmWeekend", "Km sab/dom/feriado", "$160,17/km", "Kilometraje en fines de semana o feriados con recargo 100% Art. 4.2.3. Cálculo: $80,09 x 2 x Km x Coeficiente de zona")}
          ${numRow("camKmTravelDays", "Dias viaje km", "350 km/dia", "Días de viaje para cómputo de mínimo de viático por kilometraje (garantiza 350 km/día)")}
          ${numRow("camKmViatico", "Km viatico manual", "$80,09/km", "Viático por kilometraje adicional manual Art. 4.2.4 ($80,09 por km)")}
          ${numRow("camPermanencia", "Permanencias (no rem.)", "$54.059,44", "Permanencia fuera de residencia Art. 4.2.11 ($54.059,44 por día no remunerativo)")}
          ${numRow("camSimplePresence", "Simple presencia (no rem.)", "$28.336,23", "Simple presencia Art. 4.2.11 ($28.336,23 por día no remunerativo)")}
          ${numRow("camCruces", "Cruces frontera (no rem.)", "$37.228,67", "Cruce de frontera Art. 4.2.11 ($37.228,67 por cruce no remunerativo)")}
          ${numRow("camIsla", "Ingresos isla (no rem.)", "$42.450,58", "Ingreso/egreso Tierra del Fuego Art. 4.2.11 ($42.450,58 por viaje no remunerativo)")}
        </div>
        <div class="check-grid camioneros-checks" style="margin-top: 16px;">
          ${chkRow("camComida", "Comida ($15.318/día)", "Viático de comida Art. 4.1.12 ($15.318 por día no remunerativo). Cálculo: $15.318 x Días x Coeficiente", true)}
          ${chkRow("camViaticoEspecial", "Viatico especial ($7.686,55/día)", "Viático especial Art. 4.1.13 ($7.686,55 por día no remunerativo). Cálculo: $7.686,55 x Días x Coeficiente", true)}
          ${chkRow("camApplyKmMin", "Aplicar minimo 350 km/dia al viatico", "Garantiza un mínimo de 350 km/día de viático por cada día de viaje informado", false)}
          ${chkRow("camPresentism", "Presentismo 8,33% si no hay injustificadas", "Premio presentismo Art. 4.1.7: 8.33% del sueldo básico si no registra inasistencias injustificadas", true)}
        </div>

        <div class="step-copy" style="margin-top: 24px;">
          <h3>Adicionales Remunerativos</h3>
        </div>
        <div class="concept-table">
          <div class="concept-table-head">
            <div class="concept-table-th-label">ADICIONAL</div>
            <div class="concept-table-th-badge">MONTO/RECARGO</div>
            <div class="concept-table-th-input">CANTIDAD</div>
          </div>
          ${numRow("camBitrenes", "Bitrenes", "$646.892,71", "Adicional especial por transporte en unidades bitrenes ($646.892,71)")}
          ${numRow("camAdditionalPct", "Adicional rama %", "% manual", "Porcentaje manual de adicional por rama o tarea específica sobre básico")}
          ${numRow("camOtherRem", "Otros rem. convenio", "Monto $", "Importe remunerativo manual propio del convenio")}
          ${numRow("camExtra50", "Hs extra 50%", "x1,5", "Horas extras en días hábiles. Cálculo: Valor hora x 1.5 x Horas")}
          ${numRow("camExtra100", "Hs extra 100%", "x2", "Horas extras en fines de semana o feriados. Cálculo: Valor hora x 2 x Horas")}
          ${numRow("camNightHours", "Hs nocturnas 100%", "x2", "Horas nocturnas con recargo 100%. Cálculo: Valor hora x 2 x Horas")}
        </div>
        <div class="check-grid camioneros-checks" style="margin-top: 16px;">
          ${chkRow("camSeniority", "Antiguedad 1% por año", "Antigüedad Art. 6.1.5: 1% por año de servicio sobre la suma de remunerativos fijos sin tope", true)}
          ${chkRow("camLongDistanceDriver", "Chofer larga distancia 10%", "Adicional chofer larga distancia Art. 4.2: 10% del sueldo básico", false)}
          ${chkRow("camLactea", "Materia prima lactea 15%", "Adicional transporte materia prima láctea Art. 3.1.3: 15% del sueldo básico", false)}
          ${chkRow("camAuxilio", "Conductor auxilio 10%", "Adicional conductor de auxilio Art. 3.1.4: 10% del sueldo básico", false)}
          ${chkRow("camBlindado", "Unidades blindadas 20%", "Adicional transporte caudales unidades blindadas Art. 5.1.13: 20% del sueldo básico", false)}
          ${chkRow("camCombustibles", "Combustibles 15%", "Adicional transporte de combustibles Art. 5.5.1: 15% del básico Chofer 1ra categoría", false)}
          ${chkRow("camPeligrosas", "Sustancias peligrosas 20%", "Adicional transporte sustancias peligrosas Art. 5.6.2: 20% del básico Chofer 1ra categoría", false)}
          ${chkRow("camPozos", "Pozos petroliferos 40%", "Adicional operaciones en pozos petrolíferos Art. 5.7.4: 40% del sueldo básico", false)}
          ${chkRow("camPluralidadI", "Pluralidad taller I/III 25%", "Adicional pluralidad de tareas en taller Grupo I y III Art. 3.1.13: 25% del sueldo básico", false)}
          ${chkRow("camPluralidadII", "Pluralidad taller II 18%", "Adicional pluralidad de tareas en taller Grupo II Art. 3.1.13: 18% del sueldo básico", false)}
          ${chkRow("camDiariosRevistas", "Diarios y revistas 12%", "Adicional distribución de diarios y revistas Art. 5.4.1: 12% del sueldo básico", false)}
          ${chkRow("camLogistica", "Logistica 18%", "Adicional rama logística y almacenamiento Art. 5.12: 18% del sueldo básico", false)}
          ${chkRow("camCamaraFrio", "Camara frio 20%", "Adicional trabajo en cámara de frío: 20% del sueldo básico", false)}
        </div>

        <div class="step-copy" style="margin-top: 24px;">
          <h3>Aportes del Trabajador</h3>
        </div>
        <div class="check-grid camioneros-checks" style="margin-top: 16px;">
          ${chkRow("camUnionFee", "Cuota sindical 2%", "Aporte retención cuota sindical FATAP/SICHOCA: 2% de total haberes remunerativos", true)}
          ${chkRow("camSolidarityContribution", "Contribucion solidaria 3%", "Contribución solidaria convencional: 3% de total haberes remunerativos", true)}
          ${chkRow("camFuneralInsurance", "Seguro sepelio 1,5%", "Seguro de sepelio convencional obligatorio: 1,5% de total haberes remunerativos", true)}
        </div>
        <p class="camioneros-note" style="margin-top: 20px;">
          <strong>CCT 40/89:</strong> usa divisor 24 para jornal, antigüedad 1% por año sobre remunerativos, y separa los viáticos del Art. 4.2.11 fuera de las bases de aportes.
        </p>
      </div>`;
      enhanceFieldHelp($("payrollFormPanel"));
    }
  }

  function updateConvention() {
    const conv = getConvention();
    if (!conv) return;
    renderConventionCards();
    const currentPeriod = str("period") || getCurrentPeriodId();
    setOptions($("period"), conv.periods, currentPeriod);
    setOptions($("zone"), conv.zones, str("zone"));
    setOptions($("category"), conv.categories, str("category"));
    refreshPayrollModalityOptions();
    renderDynamicFields(conv).then(() => {
      enhanceFieldHelp($("payrollFormPanel"));
      syncScaleConvention();
      if ($("scaleConvention")) {
        $("scaleConvention").value = conv.id;
        $("scalePeriod").value = selectedPeriodMonth(conv);
        loadScaleDashboard();
        refreshActiveScaleContext();
      }
      syncLeiaContext();
      markDirty();
    });
  }

  function bindNavigation() {
    document.querySelectorAll(".nav-link").forEach(link => {
      link.addEventListener("click", (e) => {
        const target = link.getAttribute("href").substring(1);
        if (target === "payrollForm" || target === "scalesPanel" || target === "conventionsPanel") {
          e.preventDefault();
          document.querySelectorAll(".nav-link").forEach(l => l.classList.remove("active"));
          link.classList.add("active");

          if ($("scalesPanel")) $("scalesPanel").style.display = target === "scalesPanel" ? "block" : "none";
          if ($("conventionsPanel")) $("conventionsPanel").style.display = target === "conventionsPanel" ? "block" : "none";
          const aiUsagePanel = $("aiUsagePanel");
          if (aiUsagePanel) aiUsagePanel.style.display = target === "aiUsagePanel" ? "block" : "none";
          if ($("payrollFormPanel")) $("payrollFormPanel").style.display = target === "payrollForm" ? "block" : "none";

          if (target === "scalesPanel" || target === "conventionsPanel") {
            document.querySelector(".app-shell")?.classList.add("full-view");
            if (target === "scalesPanel") loadScaleDashboard();
            if (target === "conventionsPanel") loadConventionDrafts();
            if (target === "aiUsagePanel") loadAiUsageDashboard();
          } else {
            document.querySelector(".app-shell")?.classList.remove("full-view");
          }
        }
      });
