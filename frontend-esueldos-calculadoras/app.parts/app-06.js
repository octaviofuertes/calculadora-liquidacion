    }
    return String(value);
  }

  function summaryKey(value) {
    return summaryValue(value, "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  function humanizeTechnicalText(value, fallback = "-") {
    const raw = summaryValue(value, "");
    if (!raw) return fallback;
    const exact = {
      requiere_revision_manual: "Requiere revisión manual",
      requires_review: "Requiere revisión manual",
      requiresreview: "Requiere revisión manual",
      valor_escala_categoria: "valor de escala de la categoría",
      escala_salarial: "escala salarial",
      sueldo_basico: "sueldo básico",
      total_remunerativo: "total remunerativo",
      no_remunerativo: "no remunerativo"
    }[summaryKey(raw)];
    if (exact) return exact;
    return raw
      .replace(/_/g, " ")
      .replace(/\bsegun\b/gi, "segun")
      .replace(/\bcategoria\b/gi, "categoria")
      .replace(/\bperiodo\b/gi, "periodo")
      .replace(/\bjornada\b/gi, "jornada")
      .replace(/\brequiere revision manual\b/gi, "Requiere revisión manual")
      .trim();
  }

  function humanConceptType(item = {}) {
    const key = summaryKey(item.rowType || item.group || item.tipo_concepto || item.naturaleza);
    const labels = {
      remunerative: "Haber remunerativo",
      remunerativo: "Haber remunerativo",
      haber_remunerativo: "Haber remunerativo",
      nonremunerative: "Haber no remunerativo",
      non_remunerative: "Haber no remunerativo",
      no_remunerativo: "Haber no remunerativo",
      haber_no_remunerativo: "Haber no remunerativo",
      deduction: "Deducción / retención",
      descuento: "Deducción / retención",
      retencion: "Deducción / retención",
      reference: "Valor de referencia",
      referencia: "Valor de referencia",
      referencial: "Valor de referencia",
      employercontribution: "Contribución empleador",
      employer_contribution: "Contribución empleador",
      aporte_patronal: "Contribución empleador",
      contribucion_patronal: "Contribución empleador"
    };
    return labels[key] || humanizeTechnicalText(item.group || item.rowType || "Concepto");
  }

  function humanConceptCalculation(item = {}) {
    const key = summaryKey(item.calculation || item.formula_base);
    const labels = {
      fixed: "Importe fijo",
      monto_fijo: "Importe fijo",
      importe_fijo: "Importe fijo",
      percentofbase: "Porcentaje sobre base",
      percent_of_base: "Porcentaje sobre base",
      porcentaje_sobre_base: "Porcentaje sobre base",
      percentaje_sobre_base: "Porcentaje sobre base",
      scalevalue: "Valor de escala",
      scale_value: "Valor de escala",
      valor_escala_categoria: "Valor de escala",
      amountperunit: "Cantidad por valor unitario",
      amount_per_unit: "Cantidad por valor unitario",
      cantidad_por_valor_unitario: "Cantidad por valor unitario",
      porcentaje_sobre_valor_hora: "Porcentaje sobre valor hora",
      reference: "Valor informativo",
      valor_referencia_escala: "Valor informativo",
      requiresreview: "Requiere revisión manual",
      requiere_revision_manual: "Requiere revisión manual"
    };
    let label = labels[key] || humanizeTechnicalText(item.calculation || item.formula_base, "-");
    if (item.percent) label += ` (${summaryValue(item.percent)}%)`;
    else if (item.amount && key === "fixed") label += ` (${fmt(Number(item.amount))})`;
    return label;
  }

  function humanConceptBase(value) {
    const labels = {
      basic: "Sueldo básico",
      basico: "Sueldo básico",
      sueldo_basico: "Sueldo básico",
      escala_salarial: "Escala salarial de la categoría",
      total_remunerativo: "Total remunerativo",
      haberes_remunerativos: "Haberes remunerativos",
      remuneracion_sujeta_a_aporte: "Remuneración sujeta a aportes",
      valor_hora: "Valor hora",
      valor_dia: "Valor día",
      monto_fijo: "Monto fijo",
      requiresreview: "Requiere revisión manual",
      requiere_revision_manual: "Requiere revisión manual"
    };
    const key = summaryKey(value);
    return labels[key] || humanizeTechnicalText(value);
  }

  function humanConceptDetail(item = {}) {
    const raw = item.detail || item.notes?.[0] || item.condicion || item.appliesWhen || item.formula_base || "";
    const detail = humanizeTechnicalText(raw, "");
    return detail || "Sin condición especial informada.";
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
    return `<details class="summary-section summary-collapsible">
      <summary><span>${escapeHtml(title)}</span><em>${cleanRows.length} items</em></summary>
      <div class="summary-collapsible-body">
        <div class="summary-definition-list">
          ${cleanRows.map((row) => `<div class="summary-definition">
            <span>${escapeHtml(row.label)}</span>
            <strong>${escapeHtml(summaryValue(row.value))}</strong>
            ${row.detail ? `<p>${escapeHtml(row.detail)}</p>` : ""}
          </div>`).join("")}
        </div>
      </div>
    </details>`;
  }

  function renderSummaryBulletSection(title, items) {
    const cleanItems = summaryArray(items);
    if (!cleanItems.length) return "";
    return `<details class="summary-section summary-collapsible">
      <summary><span>${escapeHtml(title)}</span><em>${cleanItems.length} items</em></summary>
      <div class="summary-collapsible-body">
        <ul class="summary-bullets">
          ${cleanItems.map((item) => `<li>${escapeHtml(summaryValue(item))}</li>`).join("")}
        </ul>
      </div>
    </details>`;
  }

  function renderSummaryTable(title, headers, rows) {
    const cleanRows = (rows || []).filter(Boolean);
    if (!cleanRows.length) return "";
    return `<details class="summary-section summary-collapsible">
      <summary><span>${escapeHtml(title)}</span><em>${cleanRows.length} filas</em></summary>
      <div class="summary-collapsible-body">
        <div class="summary-table-wrap">
          <table class="summary-table">
            <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
            <tbody>
              ${cleanRows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(summaryValue(cell))}</td>`).join("")}</tr>`).join("")}
            </tbody>
          </table>
        </div>
      </div>
    </details>`;
  }

  function renderCategoryGuide(conv, result = null) {
    if (!conv?.categories?.length) return "";
    if (conv.id === "uocra") return renderUocraCategoryGuide(conv);
    if (conv.id === "farmacia") return renderFarmaciaCategoryGuide(conv);
    if (conv.id === "camioneros") return renderCamionerosCategoryGuide(conv);
    return renderGenericCategoryGuide(conv, result);
  }

  function categoryGuideGroups(categories) {
    const rows = Array.isArray(categories) ? categories : [];
    const hasGroups = rows.some((cat) => cat.group || cat.grupo || cat.categoryGroup || cat.category_group || cat.rama || cat.branch || cat.section || cat.seccion || cat.jornada);
    if (!hasGroups) return [{ label: "", categories: rows }];
    const groups = new Map();
    rows.forEach((cat) => {
      const label = cat.group || cat.grupo || cat.categoryGroup || cat.category_group || cat.rama || cat.branch || cat.section || cat.seccion || cat.jornada || "Sin grupo";
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(cat);
    });
    return Array.from(groups, ([label, groupCategories]) => ({ label, categories: groupCategories }));
  }

  function categoryGuideTitle(base, group) {
    return group ? `${base} - ${group}` : base;
  }

  function renderUocraCategoryGuide(conv) {
    const periods = conv.periods || [];
    const zones = conv.zones?.length ? conv.zones : [{ id: "A", label: "Zona A" }];
    const groups = categoryGuideGroups(conv.categories);
    const tables = zones.flatMap((zone) => groups.map((group) => renderSummaryTable(categoryGuideTitle(`Cuadro de categorias - ${zone.label}`, group.label), [
        "Categoria",
        "Jornada",
        ...periods.map((item) => item.label),
        "SNR abril"
      ], group.categories.map((cat) => [
        cat.label,
        cat.monthly ? "Mensual" : "Jornal diario",
        ...periods.map((item) => {
          const value = Number(conv.scales?.[item.id]?.[zone.id]?.[cat.id] || 0);
          return cat.monthly ? `${fmt(value)} mensual` : fmt(value);
        }),
        fmt(Number(conv.nonRem?.abr26?.[zone.id]?.[cat.id] || 0))
      ]))));
    return `<div class="category-guide">${tables.join("")}</div>`;
  }

  function renderFarmaciaCategoryGuide(conv) {
    const rules = conv.rules || {};
    const periods = conv.periods || [];
    const tables = categoryGuideGroups(conv.categories).map((group) => renderSummaryTable(categoryGuideTitle("Cuadro de categorias y jornada", group.label), [
        "Categoria",
        "Jornada",
        "Basico mensual",
        ...periods.map((item) => `No rem. ${item.label}`)
      ], group.categories.map((cat) => [
        cat.label,
        `${rules.weeklyHours || 45} hs semanales`,
        fmt(Number(cat.monthly || 0)),
        ...periods.map((item) => fmt(Number(cat.nonRem?.[item.id] || 0)))
      ])));
    return `<div class="category-guide">${tables.join("")}</div>`;
  }

  function renderCamionerosCategoryGuide(conv) {
    const zones = conv.zones?.length ? conv.zones : [{ id: "base", label: "General", coef: 1 }];
    const groups = categoryGuideGroups(conv.categories);
    const tables = zones.flatMap((zone) => groups.map((group) => {
      const coef = Number(zone.coef || 1);
      return renderSummaryTable(categoryGuideTitle(`Cuadro de categorias - ${zone.label}`, group.label), [
        "Categoria",
        "Jornada",
        "Basico mensual",
        "Jornal ref. 24 dias"
      ], group.categories.map((cat) => {
        const monthly = Number(cat.monthly || 0) * coef;
        return [
          cat.label,
          "Mensual / jornada convencional",
          fmt(monthly),
          fmt(monthly / 24)
        ];
      }));
    }));
    return `<div class="category-guide">${tables.join("")}</div>`;
  }

  function renderGenericCategoryGuide(conv, result = null) {
    const { period, zone } = currentSummaryContext(conv, result);
    const zones = conv.zones?.length ? conv.zones : [zone || { id: "general", label: "General" }];
    const rules = conv.rules || conv.liquidationModel?.rules || {};
    const groups = categoryGuideGroups(conv.categories);
    const tables = zones.flatMap((tableZone) => groups.map((group) => renderSummaryTable(categoryGuideTitle(`Cuadro de categorias - ${tableZone.label || "General"}`, group.label), [
      "Categoria",
      "Jornada",
      "Mensual",
      "Jornal",
      "Hora",
      "No rem. periodo"
    ], group.categories.map((cat) => {
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
    }))));
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
