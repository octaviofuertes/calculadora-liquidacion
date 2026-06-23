    }
  }

  async function uploadConventionDraft(event) {
    event.preventDefault();
    const cctFile = $("builderCctPdf")?.files?.[0];
    const scaleFiles = Array.from($("builderScalePdf")?.files || []);
    if (!cctFile && !scaleFiles.length) {
      setConventionBuilderStatus("Subi al menos un documento o imagen de CCT o escala.", "bad");
      return;
    }
    const formData = new FormData();
    if (cctFile) formData.append("cctPdf", cctFile);
    scaleFiles.forEach((file) => formData.append("scalePdf", file));
    formData.append("name", $("builderConventionName")?.value || "");
    formData.append("notes", $("builderNotes")?.value || "");

    const button = $("buildConventionBtn");
    if (button) button.disabled = true;
    setConventionBuilderStatus("leIA está estructurando el convenio para auditoría humana...", "");
    try {
      const response = await fetch(apiUrl("/api/convention-drafts/upload"), {
        method: "POST",
        body: formData
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(conventionErrorMessage(payload));
      conventionBuilderState.selected = payload;
      if ($("builderCctPdf")) $("builderCctPdf").value = "";
      if ($("builderScalePdf")) $("builderScalePdf").value = "";
      await loadConventionDrafts();
      await selectConventionDraft(payload.id);
      const lawStatus = payload.laborLawStatus || {};
      const lawNotice = lawStatus.available && lawStatus.readable ? "" : ` Aviso: ${lawStatus.message || "no hay síntesis de ley de trabajo cargada para completar faltantes generales."}`;
      const structuredOk = payload.aiStatus === "ESTRUCTURADO_POR_LEIA";
      setConventionBuilderStatus(structuredOk ? `Convenio estructurado. Revisalo y aprobá cuando esté perfecto.${lawNotice}` : `Convenio estructurado con advertencias. Confirmá el período de las escalas antes de aprobar.${lawNotice}`, structuredOk && !lawNotice ? "ok" : "");
    } catch (error) {
      setConventionBuilderStatus(error.message, "bad");
    } finally {
      if (button) button.disabled = false;
    }
  }

  function setupConventionBuilder() {

    $("conventionBuilderForm")?.addEventListener("submit", uploadConventionDraft);
    $("refreshConventionDraftsBtn")?.addEventListener("click", loadConventionDrafts);
    $("deleteApprovedDraftsBtn")?.addEventListener("click", () => deleteConventionDraftsByStatus("TODOS"));
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
    (conv.liquidationModel?.retentions || []).forEach((item) => {
      rows.push(`- **Retencion ${item.label}**: ${item.percent ? `${item.percent}%` : moneyOrDash(item.amount)} sobre ${item.base || "remunerativo"}`);
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

