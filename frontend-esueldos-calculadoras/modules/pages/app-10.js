    const errors = Array.isArray(payload.errores) ? payload.errores : [];
    if (errors.length) {
      return errors.slice(0, 5).map((item) => [item.path, item.message].filter(Boolean).join(": ") || String(item)).join(" | ");
    }
    return payload.error || payload.message || fallback;
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
      const convName = conv.convenio?.denominacion || conv.shortName || conv.name || draft.name;
      const convSource = conv.convenio?.fuente_documento || conv.source || draft.files?.[0]?.originalName || "CCT + escala";
      const statusClass = draft.status === "APROBADO" ? "ok" : draft.status === "RECHAZADO" ? "bad" : "";
      return `<div class="convention-draft-row ${conventionBuilderState.selected?.id === draft.id ? "active" : ""}">
        <button class="scale-audit-item ${conventionBuilderState.selected?.id === draft.id ? "active" : ""}" type="button" data-convention-draft-id="${escapeHtml(draft.id)}">
          <span>
            <strong>${escapeHtml(convName)}</strong>
            <small>${escapeHtml(convSource)}</small>
          </span>
          <em class="${statusClass}">${escapeHtml(conventionDraftStatusLabel(draft.status))}</em>
        </button>
        <button class="convention-draft-trash" type="button" data-delete-convention-draft-id="${escapeHtml(draft.id)}" aria-label="Eliminar borrador ${escapeHtml(convName)}">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 6h18"></path>
            <path d="M8 6V4h8v2"></path>
            <path d="M19 6l-1 14H6L5 6"></path>
            <path d="M10 11v5"></path>
            <path d="M14 11v5"></path>
          </svg>
        </button>
      </div>`;
    }).join("");
    if (!conventionBuilderState.selected || !items.some((item) => item.id === conventionBuilderState.selected.id)) {
      renderConventionJsonEditor(null);
    }
  }

  function conventionAiAuditHtml(conv = {}) {
    const audit = conv.auditoriaIA || {};
    const blockers = Array.isArray(audit.bloqueantes) ? audit.bloqueantes : [];
    const auditWarnings = Array.isArray(audit.advertencias) ? audit.advertencias : [];
    const advice = Array.isArray(audit.consejos) ? audit.consejos : [];
    const hasAudit = !!audit.resumen;
    const verdict = !hasAudit ? { label: "Auditoría pendiente", tone: "pending", detail: "Todavía no hay un resultado de auditoría automática para este convenio." }
      : blockers.length ? { label: "Aprobación bloqueada", tone: "blocking", detail: "Corregí los errores críticos antes de aprobar el convenio." }
        : auditWarnings.length ? { label: "Requiere revisión", tone: "warning", detail: "El convenio puede continuar cuando confirmes las advertencias." }
          : { label: "Auditoría correcta", tone: "clear", detail: "No se detectaron errores críticos ni advertencias pendientes." };
    const findingsHtml = (title, items, severity) => items.length ? `<section class="ai-audit-group is-${severity}">
      <h4>${escapeHtml(title)} <span>${items.length}</span></h4>
      <div class="ai-audit-findings">${items.map((item) => `<article class="ai-audit-finding">
        <div><strong>${escapeHtml(item.mensaje || item.codigo || title)}</strong>
        <p>${escapeHtml(item.recomendacion || "Revisar el dato contra su fuente.")}</p>
        <small>${escapeHtml([item.fuente, item.campo].filter(Boolean).join(" · ") || "Control de consistencia")}</small></div>
        <button class="icon-btn ai-audit-go" type="button" data-ai-audit-go="${escapeHtml(item.seccion || "general")}" data-ai-audit-row="${escapeHtml(item.rowId || "")}" data-ai-audit-field="${escapeHtml(item.campo || "")}">Ir</button>
      </article>`).join("")}</div>
    </section>` : "";
    return `<section class="ai-audit-verdict is-${verdict.tone}">
      <div class="ai-audit-verdict-icon" aria-hidden="true">${verdict.tone === "clear" ? "✓" : verdict.tone === "blocking" ? "!" : "i"}</div>
      <div><span>Resultado de la auditor&iacute;a de leIA</span><strong>${escapeHtml(verdict.label)}</strong><p>${escapeHtml(verdict.detail)}</p></div>
      <em>Riesgo ${escapeHtml(audit.nivelRiesgo || "-")}</em>
    </section>
    <div class="ai-audit-counters">
      <div class="is-blocking"><span>Errores bloqueantes</span><strong>${blockers.length}</strong></div>
      <div class="is-warning"><span>Advertencias</span><strong>${auditWarnings.length}</strong></div>
      <div class="is-advice"><span>Consejos</span><strong>${advice.length}</strong></div>
    </div>
    <section class="ai-audit-panel is-risk-${escapeHtml(String(audit.nivelRiesgo || "medio").toLowerCase())}">
      <header><div><span>Resumen de Gemini</span><strong>${escapeHtml(audit.resumen || "Auditoría pendiente de ejecución.")}</strong></div><em>${escapeHtml(audit.auditadoPor || "leIA")}</em></header>
      ${findingsHtml("Errores bloqueantes", blockers, "blocking")}
      ${findingsHtml("Advertencias", auditWarnings, "warning")}
      ${findingsHtml("Consejos", advice, "advice")}
      ${hasAudit && !blockers.length && !auditWarnings.length && !advice.length ? `<div class="ai-audit-clear">No se detectaron observaciones pendientes.</div>` : ""}
    </section>`;
  }

  function conventionQualityHtml(conv = {}) {
    const warnings = conv.warnings || [];
    const checklist = conv.auditChecklist || [];
    const categoryCount = (conv.categorias || conv.categories || []).length;
    const conceptCount = (conv.conceptos || conv.liquidationModel?.concepts || []).length;
    const scaleValueCount = (conv.escalas || []).reduce((total, scale) => total + (scale.valores || []).length, 0);
    return `<div class="scale-mini-grid">
      <div><span>Categorias</span><strong>${categoryCount}</strong></div>
      <div><span>Conceptos</span><strong>${conceptCount}</strong></div>
      <div><span>Valores escala</span><strong>${scaleValueCount}</strong></div>
    </div>
    ${warnings.length ? `<div class="scale-warning">${warnings.map(escapeHtml).join("<br>")}</div>` : `<div class="scale-summary">Sin alertas criticas detectadas por leIA.</div>`}
    ${checklist.length ? `<div class="convention-checklist">${checklist.slice(0, 8).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>` : ""}`;
  }

  function auditFieldValue(value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "object") return summaryValue(value, "");
    return String(value);
  }

  function auditOriginLabel(row = {}, defaultOrigin = "CCT") {
    const sourceText = [
      row.documento_tipo,
      row.documento_rol,
      row.fuente_documento,
      row.source,
      ...(Array.isArray(row.sourceFiles) ? row.sourceFiles : [])
    ].filter(Boolean).join(" ");
    const evidenceText = [
      row.evidencia,
      row.detalle_fuente,
      row.condicion,
      row.formula_base,
      row.base_calculo,
      row.articulo_anexo,
      row.legalReference,
      ...(Array.isArray(row.legalReferences) ? row.legalReferences : [])
    ].filter(Boolean).join(" ");
    const explicit = summaryKey(sourceText);
    const contextual = summaryKey(`${sourceText} ${evidenceText}`);
    if (/(ley_trabajo|ley_de_trabajo|ley_de_trabajo_aplicable|ley_trabajo_base|lct|contrato_de_trabajo|ley_20744|ley_20_744|ley_20744)/.test(contextual)) return "Ley de Trabajo";
    if (/(ley_trabajo|ley_de_trabajo|ley_de_trabajo_aplicable|ley_trabajo_base)/.test(explicit)) return "Ley de Trabajo";
    if (/(escala|anexo_escala|salarial)/.test(explicit)) return "CCT / Escala";
    if (/(cct|convenio|acta|homologacion|resolucion)/.test(explicit)) return "CCT";
    if (sourceText) return "Revisar fuente";
    return defaultOrigin;
  }

  function auditRowIdentity(row = {}) {
    return row.categoria_id || row.concepto_id || row.escala_id || row.adicional_id || row.ambito_id || row.valor_id || "";
  }

  function auditInput(field, value, options = {}) {
    const disabled = options.locked ? "disabled" : "";
    let rawValue = auditFieldValue(value);
    if (field === "formula_base") {
      rawValue = rawValue.replace(/_/g, " ");
    }
    const safeValue = escapeHtml(rawValue);
    const placeholder = options.placeholder ? ` placeholder="${escapeHtml(options.placeholder)}"` : "";
    if (options.type === "textarea") {
      return `<textarea data-field="${escapeHtml(field)}" rows="1" ${disabled}${placeholder}>${safeValue}</textarea>`;
    }
    if (options.type === "readonly") {
      return `<span class="audit-readonly-cell">${safeValue || "-"}</span>`;
    }
    if (options.type === "select") {
      const baseChoices = options.choices || [];
      const hasCurrentChoice = baseChoices.some((choice) => String(choice.value) === String(value));
      const choices = !value || hasCurrentChoice ? baseChoices : [{ value, label: humanizeTechnicalText(value) }, ...baseChoices];
      return `<select data-field="${escapeHtml(field)}" ${disabled}>
        ${choices.map((choice) => {
          const selected = String(choice.value) === String(value) ? "selected" : "";
          return `<option value="${escapeHtml(choice.value)}" ${selected}>${escapeHtml(choice.label)}</option>`;
        }).join("")}
      </select>`;
    }
    return `<input data-field="${escapeHtml(field)}" type="${escapeHtml(options.type || "text")}" value="${safeValue}" ${disabled}${placeholder}>`;
  }

  function auditTable(title, section, description, columns, rows, options = {}) {
    const locked = !!options.locked;
    const defaultOrigin = options.defaultOrigin || "CCT";
    const cleanRows = (Array.isArray(rows) ? rows : []).map((row) => ({ ...row, origen_dato: auditOriginLabel(row, defaultOrigin) }));
    const displayColumns = options.hideOrigin ? columns : [...columns, { field: "origen_dato", label: "Origen", type: "readonly" }];
    const expanded = options.expanded ? "open" : "";
    return `<details class="convention-audit-table" data-audit-section="${escapeHtml(section)}" ${expanded}>
      <summary class="convention-audit-table-summary">
        <span>${escapeHtml(title)}</span>
        <em>${cleanRows.length} fila${cleanRows.length === 1 ? "" : "s"}</em>
      </summary>
      <div class="convention-audit-table-head">
        <div>
          <p>${escapeHtml(description || "")}</p>
        </div>
        <div class="convention-audit-actions">
          <button class="icon-btn" type="button" data-audit-add="${escapeHtml(section)}" ${locked ? "disabled" : ""}>Agregar</button>
          <button class="icon-btn danger" type="button" data-audit-delete="${escapeHtml(section)}" ${locked ? "disabled" : ""}>Eliminar seleccionados</button>
        </div>
      </div>
      <div class="convention-audit-table-wrap">
        <table>
          <thead>
            <tr>
              <th class="audit-check-cell">
                <label class="audit-check">
                  <input type="checkbox" data-audit-select-all="${escapeHtml(section)}" ${locked ? "disabled" : ""}>
                  <span>Sel.</span>
                </label>
              </th>
              ${displayColumns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${cleanRows.length ? cleanRows.map((row, index) => `<tr data-row-index="${index}" data-audit-row-id="${escapeHtml(auditRowIdentity(row))}">
              <td class="audit-check-cell">
                <input type="checkbox" data-audit-row-check="${escapeHtml(section)}" ${locked ? "disabled" : ""}>
                ${options.hiddenFields ? options.hiddenFields.map(hf => `<input type="hidden" data-field="${escapeHtml(hf)}" value="${escapeHtml(row?.[hf] || "")}">`).join("") : ""}
              </td>
              ${displayColumns.map((column) => `<td>${auditInput(column.field, row?.[column.field], { ...column, locked })}</td>`).join("")}
            </tr>`).join("") : `<tr class="audit-empty-row"><td colspan="${displayColumns.length + 1}">Sin datos extraidos. Podés agregar filas manualmente.</td></tr>`}
          </tbody>
        </table>
      </div>
    </details>`;
  }

  function conventionGeneralEditor(conv = {}, locked = false) {
    const data = conv.convenio || {};
    const fields = [
      ["convenio_id", "ID convenio"],
      ["denominacion", "Denominación"],
      ["actividad", "Actividad"],
      ["rama", "Rama"],
      ["jurisdiccion", "Jurisdicción"],
      ["ambito_territorial", "Ámbito territorial"],
      ["ambito_personal", "Ámbito personal"],
      ["vigencia_desde", "Vigencia desde"],
      ["vigencia_hasta", "Vigencia hasta"],
      ["fuente_documento", "Fuente"]
    ];
    return `<section class="convention-audit-general">
      <div class="convention-audit-table-head">
        <div>
          <h3>Información general</h3>
          <p>Datos identificatorios extraídos del convenio y sus actas.</p>
        </div>
      </div>
      <div class="convention-audit-general-grid">
        ${fields.map(([field, label]) => `<label>
          <span>${escapeHtml(label)}</span>
          ${auditInput(field, data[field], { locked, placeholder: label })}
        </label>`).join("")}
      </div>
    </section>`;
  }

  function flatScaleValues(conv = {}) {
    return (conv.escalas || []).flatMap((scale) => (scale.valores || []).map((value) => ({
      escala_id: value.escala_id || scale.escala_id,
      mes: isPeriodLikeValue(value.periodicidad) ? value.periodicidad : (scale.periodo_desde || scale.nombre_escala || value.periodicidad || ""),
      categoria_id: value.categoria_id,
      categoria_nombre: value.categoria_nombre || scale.categoria_nombre || "",
      concepto_id: value.concepto_id,
      unidad_pago: value.unidad_pago,
      periodicidad: value.periodicidad,
      valor: value.valor,
      moneda: value.moneda || scale.moneda,
      zona: value.zona || scale.zona,
      grupo_nombre: value.grupo_nombre || scale.grupo_nombre || "",
      rama: value.rama || scale.rama || scale.grupo_nombre || "",
      modalidad: value.modalidad || "",
      fuente_documento: value.fuente_documento || scale.fuente_documento || value.source || scale.source || "",
      documento_tipo: value.documento_tipo || scale.documento_tipo || "",
      sourceFiles: value.sourceFiles || scale.sourceFiles || []
    })));
  }

  function isPeriodLikeValue(value) {
    const raw = String(value || "").trim();
    return /\b20\d{2}[-/](0?[1-9]|1[0-2])(?:[-/]\d{1,2})?\b/.test(raw)
      || /\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|ene|feb|mar|abr|may|jun|jul|ago|sep|set|oct|nov|dic)\b/i.test(raw);
  }

  function salaryAuditRows(conv = {}) {
    const categoryById = new Map((conv.categorias || []).map((category) => [String(category.categoria_id || ""), category]));
    return flatScaleValues(conv)
      .filter(isBasicScaleValue)
      .map((value) => {
        const category = categoryById.get(String(value.categoria_id || "")) || {};
        let unit = value.unidad_pago || "mensual";
        if (unit === "daily") unit = "jornal";
        if (unit === "hourly") unit = "hora";
        if (unit === "monthly") unit = "mensual";
        return {
          mes: value.mes,
          categoria_id: value.categoria_id || category.categoria_id || "",
          categoria_nombre: category.categoria_nombre || value.categoria_nombre || "",
          rama: value.rama || value.grupo_nombre || category.grupo_nombre || category.rama || "",
          sueldo_base: value.valor,
          unidad_pago: unit,
          concepto_id: value.concepto_id || "SUELDO_BASICO",
          modalidad: value.modalidad || "",
          moneda: value.moneda || "ARS",
          zona: value.zona || "",
          fuente_documento: value.fuente_documento || category.fuente_documento || "",
          documento_tipo: value.documento_tipo || category.documento_tipo || "",
          sourceFiles: value.sourceFiles || category.sourceFiles || []
        };
      })
      .sort((a, b) => String(a.mes || "").localeCompare(String(b.mes || "")) || String(a.categoria_nombre || a.categoria_id || "").localeCompare(String(b.categoria_nombre || b.categoria_id || "")));
  }

  function formatScaleMonthLabel(value = "") {
    const raw = String(value || "").trim();
    const iso = raw.match(/^(\d{4})[-/](\d{1,2})(?:[-/]\d{1,2})?$/);
    if (!iso) return raw || "Sin mes";
    const monthNames = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
    const monthName = monthNames[Number(iso[2]) - 1];
    return monthName ? `${monthName} ${iso[1]}` : raw;
  }

  function normalizeScaleMonthKey(value = "") {
    const raw = String(value || "").trim().toLowerCase();
    const iso = raw.match(/^(\d{4})[-/](\d{1,2})(?:[-/]\d{1,2})?$/);
    if (iso) return `${iso[1]}-${String(Number(iso[2])).padStart(2, "0")}`;
    return raw || "sin_mes";
  }

  function scaleRowsByMonth(rows = []) {
    const groups = new Map();
    rows.forEach((row) => {
      const key = normalizeScaleMonthKey(row?.mes);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });
    return Array.from(groups.entries()).map(([mes, groupedRows]) => ({
      mes,
      label: formatScaleMonthLabel(groupedRows[0]?.mes || mes),
      rows: groupedRows
    }));
  }

  function isBasicScaleValue(value = {}) {
    const key = summaryKey(`${value.concepto_id || ""} ${value.concepto || ""} ${value.nombre_concepto || ""}`);
    return (
      key === "basico" ||
      key.includes("basico") ||
      key.includes("sueldo_basico") ||
      key.includes("salario_basico") ||
      key.includes("jornal") ||
      key.includes("hora") ||
      key.includes("changa") ||
      key.includes("valor_dia") ||
      key === "dia"
    ) && !/(no_rem|no_remunerativo|total|adicional|presentismo|antiguedad|viatico|deduccion|retencion|cuota|aporte)/.test(key);
  }

  function categoryBaseSalaryInfo(conv = {}, category = {}) {
    const categoryId = String(category.categoria_id || "").trim();
    if (!categoryId) return { escala_id: (conv.escalas || [])[0]?.escala_id || "", sueldo_base: "" };
    for (const scale of conv.escalas || []) {
      const value = (scale.valores || []).find((item) => String(item.categoria_id || "").trim() === categoryId && isBasicScaleValue(item));
      if (value) {
        return {
          escala_id: value.escala_id || scale.escala_id || "",
          sueldo_base: value.valor ?? "",
          unidad_pago: value.unidad_pago || "mensual",
          periodicidad: value.periodicidad || scale.periodo_desde || "",
          moneda: value.moneda || scale.moneda || "ARS",
          zona: value.zona || scale.zona || ""
        };
      }
    }
    return { escala_id: (conv.escalas || [])[0]?.escala_id || "", sueldo_base: "" };
  }

  function categoryAuditRows(conv = {}) {
    return (conv.categorias || []).map((category) => {
      const variant = category.modalidad_aplicable || categoryVariantFromId(category.categoria_id);
      const name = String(category.categoria_nombre || category.nombre || "");
      const group = category.grupo_nombre || category.rama || category.group || category.grupo || category.agrupamiento || category.sector || category.seccion || category.convenio_rama || conv.convenio?.rama || "";
      return {
        ...category,
        categoria_nombre: name,
        modalidad_aplicable: category.modalidad_aplicable || variant,
        grupo_nombre: group,
        rama: category.rama || group
      };
    });
  }

  function categoryVariantFromId(id) {
    const key = summaryKey(id || "");
    if (key.endsWith("sin_retiro")) return "Sin retiro";
    if (key.endsWith("con_retiro")) return "Con retiro";
    return "";
  }

  function conceptAuditGroup(concept = {}) {
    const raw = summaryKey(`${concept.tipo_concepto || ""} ${concept.naturaleza || ""} ${concept.concepto_id || ""} ${concept.nombre || ""}`);
    if (raw.includes("no_remunerativo") || raw.includes("no_rem")) return "no_remunerativos";
    if (/(descuento|retencion|deduccion|cuota|sindical|obra_social|jubilacion|aporte|fondo)/.test(raw)
      && !/(haber|bono|premio|asignacion|sueldo|salario|adicional)/.test(raw)) return "deducciones";
    return "remunerativos";
  }

  function conceptAuditRows(conv = {}, group = "remunerativos") {
    return (conv.conceptos || [])
      .filter((concept) => conceptAuditGroup(concept) === group)
      .map((item) => ({ ...item, es_liquidable: item.es_liquidable === false ? "false" : "true" }));
  }

  function conventionAuditTablesHtml(conv = {}, locked = false, options = {}) {
    const typeChoices = [
      { value: "haber", label: "Haber" },
      { value: "descuento", label: "Descuento" },
      { value: "retencion", label: "Retención" },
      { value: "aporte_patronal", label: "Aporte patronal" },
      { value: "referencia", label: "Referencia" },
      { value: "requiere_revision_manual", label: "Requiere revisión" }
    ];
    const natureChoices = [
      { value: "remunerativo", label: "Remunerativo" },
      { value: "no_remunerativo", label: "No remunerativo" },
      { value: "retencion", label: "Retención" },
      { value: "contribucion_patronal", label: "Contribución patronal" },
      { value: "referencial", label: "Referencial" },
      { value: "requiere_revision_manual", label: "Requiere revisión" }
    ];
    const liquidableChoices = [
      { value: "true", label: "Sí" },
      { value: "false", label: "No" }
    ];
    const unitChoices = [
      { value: "mensual", label: "Mensual" },
      { value: "jornal", label: "Jornal" },
      { value: "hora", label: "Hora" }
    ];
    const basicConceptChoices = [
      { value: "SUELDO_BASICO", label: "Sueldo Básico" },
      { value: "VALOR_JORNAL", label: "Valor Jornal" },
      { value: "VALOR_HORA", label: "Valor Hora" },
      { value: "VALOR_CHANGA", label: "Valor Changa" },
      { value: "TOTAL_7H", label: "Total 7 Horas" },
      { value: "TOTAL_8H", label: "Total 8 Horas" }
    ];
    const salaryRowsData = salaryAuditRows(conv);
    const hasJornal = salaryRowsData.some((row) => row.unidad_pago === "jornal");
    const hasHourly = salaryRowsData.some((row) => row.unidad_pago === "hora");
    const salaryLabel = hasJornal ? "Jornal" : (hasHourly ? "Valor hora" : "Sueldo base");
    const scaleGroups = scaleRowsByMonth(salaryRowsData);
    const scaleSections = scaleGroups.length
      ? scaleGroups.map((group, index) => auditTable(
        group.label,
        `escalas_${index + 1}`,
        "Valores extraídos de la escala para este período.",
        [
          { field: "categoria_id", label: "Categoría" },
          { field: "categoria_nombre", label: "Nombre" },
          { field: "rama", label: "Rama / grupo" },
          { field: "concepto_id", label: "Concepto", type: "select", choices: basicConceptChoices },
          { field: "unidad_pago", label: "Unidad", type: "select", choices: unitChoices },
          { field: "modalidad", label: "Jornada / Modalidad" },
          { field: "zona", label: "Zona" },
          { field: "sueldo_base", label: salaryLabel }
        ],
        group.rows,
        { locked, defaultOrigin: "CCT / Escala", expanded: index === 0, hiddenFields: ["mes"] }
      )).join("")
      : `<div class="audit-empty-row">Sin datos de escalas extraídos.</div>`;

    return `
      ${options.includeGeneral === false ? "" : conventionGeneralEditor(conv, locked)}
      ${auditTable("Ámbitos", "ambitos", "Alcance territorial, personal o de actividad detectado.", [
        { field: "ambito_id", label: "ID" },
        { field: "nombre", label: "Nombre" },
        { field: "tipo", label: "Tipo" },
        { field: "descripcion", label: "Descripción", type: "textarea" }
      ], conv.ambitos || [], { locked, expanded: true })}
      ${auditTable("Categorías laborales", "categorias", "Categorías con sueldo base editable desde la escala.", [
        { field: "categoria_id", label: "ID categoría" },
        { field: "categoria_nombre", label: "Nombre" },
        { field: "grupo_nombre", label: "Rama / grupo" },
        { field: "descripcion", label: "Descripción", type: "textarea" },
        { field: "modalidad_aplicable", label: "Modalidad" }
      ], categoryAuditRows(conv), { locked })}
      ${auditTable("Haberes remunerativos", "conceptos_remunerativos", "Conceptos que integran la base remunerativa.", [
        { field: "concepto_id", label: "ID concepto" },
        { field: "nombre", label: "Concepto" },
        { field: "tipo_concepto", label: "Tipo", type: "select", choices: typeChoices },
        { field: "naturaleza", label: "Naturaleza", type: "select", choices: natureChoices },
        { field: "unidad_calculo", label: "Unidad" },
        { field: "formula_base", label: "Cómo se calcula", type: "textarea" },
        { field: "base_calculo", label: "Base" },
        { field: "porcentaje", label: "%" },
        { field: "importe_fijo", label: "Importe" },
        { field: "condicion", label: "Condición", type: "textarea" },
        { field: "es_liquidable", label: "Liquidable", type: "select", choices: liquidableChoices }
      ], conceptAuditRows(conv, "remunerativos"), { locked })}
      ${auditTable("Haberes no remunerativos", "conceptos_no_remunerativos", "Conceptos no remunerativos extraídos de convenio o escala.", [
        { field: "concepto_id", label: "ID concepto" },
        { field: "nombre", label: "Concepto" },
        { field: "tipo_concepto", label: "Tipo", type: "select", choices: typeChoices },
        { field: "naturaleza", label: "Naturaleza", type: "select", choices: natureChoices },
        { field: "unidad_calculo", label: "Unidad" },
        { field: "formula_base", label: "Cómo se calcula", type: "textarea" },
        { field: "base_calculo", label: "Base" },
        { field: "porcentaje", label: "%" },
        { field: "importe_fijo", label: "Importe" },
        { field: "condicion", label: "Condición", type: "textarea" },
        { field: "es_liquidable", label: "Liquidable", type: "select", choices: liquidableChoices }
      ], conceptAuditRows(conv, "no_remunerativos"), { locked })}
      ${auditTable("Deducciones", "conceptos_deducciones", "Descuentos, retenciones y aportes del trabajador.", [
        { field: "concepto_id", label: "ID concepto" },
        { field: "nombre", label: "Concepto" },
        { field: "tipo_concepto", label: "Tipo", type: "select", choices: typeChoices },
        { field: "naturaleza", label: "Naturaleza", type: "select", choices: natureChoices },
        { field: "unidad_calculo", label: "Unidad" },
        { field: "formula_base", label: "Cómo se calcula", type: "textarea" },
        { field: "base_calculo", label: "Base" },
        { field: "porcentaje", label: "%" },
        { field: "importe_fijo", label: "Importe" },
        { field: "condicion", label: "Condición", type: "textarea" },
        { field: "es_liquidable", label: "Liquidable", type: "select", choices: liquidableChoices }
      ], conceptAuditRows(conv, "deducciones"), { locked })}
      <details class="convention-audit-table" data-audit-section="escalas" open>
        <summary class="convention-audit-table-summary">
          <span>Escalas salariales</span>
          <em>${salaryRowsData.length} fila${salaryRowsData.length === 1 ? "" : "s"}</em>
        </summary>
        <div class="convention-audit-table-head">
          <div>
            <p>Escalas separadas por mes. Tocá cada período para desplegar sus filas.</p>
          </div>
        </div>
        <div class="convention-audit-table-wrap">
          ${scaleSections}
        </div>
      </details>
      ${auditTable("Adicionales y reglas particulares", "adicionales", "Adicionales detectados que pueden alimentar conceptos o controles humanos.", [
        { field: "adicional_id", label: "ID adicional" },
        { field: "concepto_id", label: "Concepto vinculado" },
        { field: "nombre", label: "Nombre" },
        { field: "formula", label: "Fórmula" },
        { field: "base_calculo", label: "Base" },
        { field: "porcentaje", label: "%" },
        { field: "importe_fijo", label: "Importe" },
        { field: "condicion", label: "Condición", type: "textarea" }
      ], conv.adicionales || [], { locked })}
    `;
  }

  function renderConventionJsonEditor(draft) {
    const editor = $("conventionJsonEditor");
    const tablesArea = $("conventionAuditTablesArea");
    const auditSummary = $("conventionAiAuditSummary");
    if (!editor) return;
    if (!draft) {
      editor.className = "scale-editor empty-state";
      editor.innerHTML = "Seleccion&aacute; un convenio generado para revisar los datos extra&iacute;dos.";
      if (tablesArea) tablesArea.innerHTML = "";
      if (auditSummary) {
        auditSummary.className = "convention-ai-audit-summary empty-state";
        auditSummary.innerHTML = "Seleccion&aacute; un convenio para ver el resultado de la auditoría automática.";
      }
      updateTokenUsageUI(null);
      return;
    }
    const conv = draft.parsedConvention || {};
    const convName = conv.convenio?.denominacion || conv.name || draft.name;
    const isPending = draft.status === "PENDIENTE_REVISION";
    const isApproved = draft.status === "APROBADO";
    if (auditSummary) {
      auditSummary.className = "convention-ai-audit-summary";
      auditSummary.innerHTML = conventionAiAuditHtml(conv);
    }
    editor.className = "scale-editor convention-json-editor";
    editor.innerHTML = `<div class="scale-editor-head">
      <div>
        <strong>${escapeHtml(convName)}</strong>
        <span>${escapeHtml(draft.aiError || "Datos estructurados por leIA. Revisalos, corregilos y aprobá cuando estén listos.")}</span>
      </div>
      <span class="status-pill ${draft.status === "APROBADO" ? "ok" : draft.status === "RECHAZADO" ? "bad" : ""}">${escapeHtml(conventionDraftStatusLabel(draft.status))}</span>
    </div>
    <div class="convention-audit-editor">
      ${conventionGeneralEditor(conv, false)}
    </div>
    <div class="scale-preview">${conventionQualityHtml(conv)}</div>`;
    const auditActions = `<div class="scale-editor-actions convention-audit-bottom-actions">
      <button class="icon-btn" id="downloadConventionJsonBtn" type="button">Descargar respaldo</button>
      <button class="icon-btn" id="saveConventionJsonBtn" type="button">Guardar revisión</button>
      ${isPending ? `<button class="primary-action" id="approveConventionDraftBtn" type="button">Aprobar y activar convenio</button>
      <button class="icon-btn danger" id="rejectConventionDraftBtn" type="button">Rechazar</button>` : ""}
      <button class="convention-draft-trash is-inline" id="deleteConventionDraftBtn" type="button" aria-label="Eliminar borrador">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 6h18"></path>
