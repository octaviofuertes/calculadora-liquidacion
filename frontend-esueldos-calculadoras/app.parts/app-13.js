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
      const visibleConcepts = userFacingConcepts(model.concepts || []);
      const visibleDeductions = userFacingConcepts(model.deductions || []);
      const visibleRetentions = userFacingConcepts(model.retentions || []);
      const category = getCategory(conv);
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
      const period = getPeriod(conv);
      const conceptInputHtml = (concept) => {
        if (conceptUsesQuantity(concept)) {
          const unitAmount = genericConceptUnitAmount(concept, period);
          const quantityField = `<label class="field"><span>${escapeHtml(concept.label)} (${escapeHtml(conceptQuantityUnit(concept))})</span><input id="gen_${escapeHtml(concept.id)}" data-concept-id="${escapeHtml(concept.id)}" data-concept-suffix="" type="number" min="0" step="0.01" value="${escapeHtml(concept.defaultValue || 0)}" placeholder="0"></label>`;
          const unitField = unitAmount ? "" : `<label class="field"><span>${escapeHtml(concept.label)} - importe unitario</span><input id="gen_${escapeHtml(concept.id)}_unit" data-concept-id="${escapeHtml(concept.id)}" data-concept-suffix="_unit" type="number" min="0" step="0.01" value="0" placeholder="0"></label>`;
          return `${quantityField}${unitField}`;
        }
        if (concept.inputType === "number") {
          return `<label class="field"><span>${escapeHtml(concept.label)}</span><input id="gen_${escapeHtml(concept.id)}" data-concept-id="${escapeHtml(concept.id)}" data-concept-suffix="" type="number" min="0" step="0.01" value="${escapeHtml(concept.defaultValue || 0)}" placeholder="0"></label>`;
        }
        return `<label class="check-row"><input id="gen_${escapeHtml(concept.id)}" type="checkbox" ${concept.defaultValue ? "checked" : ""}><span>${escapeHtml(concept.label)}</span></label>`;
      };
      const grouped = visibleConcepts.reduce((acc, concept) => {
        const key = concept.group || "Adicionales";
        if (!acc[key]) acc[key] = [];
        acc[key].push(concept);
        return acc;
      }, {});
      const conceptHtml = Object.entries(grouped).map(([group, concepts]) => `
        <div class="generic-section-title">${escapeHtml(userFacingGroupName(group))}</div>
        <div class="check-grid generic-checks">
          ${concepts.map(conceptInputHtml).join("")}
        </div>`).join("");
      const deductionHtml = visibleDeductions.length ? `
        <div class="generic-section-title">Descuentos del convenio</div>
        <div class="check-grid generic-checks">
          ${visibleDeductions.map((item) => `
            <label class="check-row"><input id="gen_deduction_${escapeHtml(item.id)}" type="checkbox" ${item.defaultValue === false ? "" : "checked"}><span>${escapeHtml(item.label)}</span></label>
          `).join("")}
        </div>` : "";
      const retentionHtml = visibleRetentions.length ? `
        <div class="generic-section-title">Retenciones del convenio</div>
        <div class="check-grid generic-checks">
          ${visibleRetentions.map((item) => `
            <label class="check-row"><input id="gen_retention_${escapeHtml(item.id)}" type="checkbox" ${item.defaultValue === false ? "" : "checked"}><span>${escapeHtml(item.label)}</span></label>
          `).join("")}
        </div>` : "";

      $("dynamicFields").innerHTML = `<div class="dynamic-card generic-convention-card">
        <h2 class="dynamic-title">${escapeHtml(conv.shortName || conv.name)}</h2>
        <div class="generic-section-title">Base del convenio IA</div>
        <div class="grid three">
          ${salaryTypeField}
          ${workUnitsField}
          <label class="field"><span>Dias ausentes injust.</span><input id="genAbsentDays" type="number" min="0" step="1" value="0"></label>
          <label class="field"><span>Hs extra 50%</span><input id="genExtra50" type="number" min="0" step="0.01" value="0"></label>
          <label class="field"><span>Hs extra 100%</span><input id="genExtra100" type="number" min="0" step="0.01" value="0"></label>
        </div>
        <div class="check-grid generic-checks">
          <label class="check-row"><input id="genSeniority" type="checkbox" ${rules.seniority?.enabled !== false || (rules.nonRemunerativeScale?.seniorityEnabled !== false && Number(rules.nonRemunerativeScale?.seniorityPercentPerYear || 0) > 0) ? "checked" : ""}><span>Antiguedad segun convenio</span></label>
          <label class="check-row"><input id="genPresentism" type="checkbox" ${rules.presentism?.enabled || (rules.nonRemunerativeScale?.presentismEnabled !== false && Number(rules.nonRemunerativeScale?.presentismPercent || 0) > 0) ? "checked" : ""}><span>Presentismo segun convenio</span></label>
        </div>
        ${conceptHtml || `<p class="generic-note">Este convenio no tiene conceptos variables adicionales. Pod&eacute;s editarlos desde Convenios IA.</p>`}
        ${deductionHtml}
        ${retentionHtml}
        <p class="generic-note">
          <strong>Motor leIA:</strong> usa reglas aprobadas del convenio, escala vigente si existe, conceptos variables y auditoria automatica del recibo.
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
      enhanceFieldHelp($("payrollFormPanel"));
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
    renderDynamicFields(conv);
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
