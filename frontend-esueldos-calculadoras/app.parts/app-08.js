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
    const missingEntry = !employee.entryDate || employee.entryDate === "-";

    addChecklist("Escala vigente aprobada", !!selectedScale, selectedScale ? `${selectedScale.periodLabel || monthLabel(selectedScale.period)} aplicada.` : "La liquidacion usa la escala base del sistema.");
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
        return conceptUsesNumberInput(concept) ? Number(input || 0) > 0 : !!input;
      });
      const remLabels = (result.remRows || []).map((row) => String(row.label || "").toLowerCase()).join(" | ");
      addChecklist("Convenio IA: motor generico activo", true, "La liquidacion uso reglas aprobadas de Convenios IA.");
      addChecklist("Convenio IA: categorias con importes", (result.conv.categories || []).length > 0, `${(result.conv.categories || []).length} categorias cargadas.`);
      addChecklist("Convenio IA: conceptos variables", enabledConcepts.length >= 0, `${enabledConcepts.length} conceptos variables activados.`);
      if (!result.conv.generatedByLeia) {
        addFinding("baja", "Convenio IA sin marca leIA", "El convenio usa motor generico pero no tiene trazabilidad de generacion IA.", "Revisar origen del convenio", "nav-conventions", "");
      }
      if (!(model.concepts || []).length) {
        addFinding("media", "Convenio sin conceptos variables", "No tiene adicionales parametrizables. Puede estar incompleto para una liquidacion real.", "Completar datos del convenio", "nav-conventions", "");
      }
      if (parameters.genPresentism && !remLabels.includes("presentismo")) {
        addFinding("baja", "Presentismo activado sin importe", "El presentismo esta activado pero el porcentaje del JSON es 0 o no corresponde por ausencias.", "Revisar regla de presentismo", "step", "3");
      }
      if (Number(parameters.genAbsentDays || 0) > Number(result.conv.rules?.monthDivisor || 30)) {
        addFinding("alta", "Ausencias mayores al divisor mensual", "Las ausencias injustificadas superan el divisor del convenio aprobado.", "Corregir ausencias", "step", "3");
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
