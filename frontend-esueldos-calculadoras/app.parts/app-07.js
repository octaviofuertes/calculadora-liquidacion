          ["Cuota sindical UOCRA", "2,50%", "Remunerativo"],
          ["Aporte solidario (abr-may 26)", "2,00%", "Remunerativo"],
          ["Aporte UOCRA SS", "1,80%", "Remunerativo"],
          ["ISTIC", "0,50%", "Remunerativo"]
        ])}
        ${renderSummaryTable("Contribuciones empleador", ["Concepto", "%", "Base"], [
          ["Jubilacion empleador", "10,77%", "Base SS"],
          ["PAMI empleador", "1,58%", "Base SS"],
          ["Obra social empleador", "6%", "Rem + SNR"],
          ["Asignaciones familiares", "4,70%", "Base SS"],
          ["Fondo Nac. Empleo", "0,95%", "Base SS"],
          ["Contribucion UOCRA", "2,30%", "Remunerativo"],
          ["ISTIC empleador", "0,50%", "Remunerativo"],
          ["Contrib. empresarial (abr-may)", "$6.000", "Por trabajador"],
          ["ART variable", "2,50%", "Remunerativo"],
          ["ART cuota fija", "$1.450", "Por mes"],
          ["SCVO", "$424,62", "Por mes"]
        ])}
      </div>
      <section class="summary-section summary-highlight">
        <h3>Base SS</h3>
        <p>Base SS = Remunerativo - $7.003,68 (Ley 27.430). Cuota sindical absorbe aporte solidario para afiliados.</p>
      </section>
    `;
  }

  function renderFarmaciaConventionSummary(conv, result = null) {
    const { period, zone, category } = currentSummaryContext(conv, result);
    const rules = conv.rules || {};
    const catRow = scaleCategoryRow(conv, category, zone);
    const base = firstFinite(catRow?.monthly, category?.monthly) || 0;
    const noRem = firstFinite(catRow?.nonRemunerative, category?.nonRem?.[period]) || 0;
    const extraordinary = conv.extraordinaryContribution?.[period] || 0;
    const additions = Object.values(conv.additionals || {});
    return `
      <section class="summary-section summary-highlight">
        <h3>Lectura contable</h3>
        <p>Farmacia Mendoza exige controlar categoria, jornada semanal, adicionales de funcion, escalafon por antiguedad y sumas no remunerativas por periodo. La liquidacion prioriza base mensual, prorrateos por jornada/dias, divisores convencionales y aportes ADEF.</p>
      </section>
      ${renderSummaryCards([
        { label: "Basico categoria", value: base ? fmt(base) : "-", detail: "Base mensual de la categoria seleccionada." },
        { label: "No remunerativo", value: noRem ? fmt(noRem) : "-", detail: "Importe del periodo seleccionado, prorrateable por dias." },
        { label: "Antiguedad", value: "5% a 35%", detail: "1 año 5%, 2 años 10%, 5 años 20%, 10 años 25%, 15 años 30%, 20 años 35%." },
        { label: "Jornada", value: `${rules.weeklyHours || 45} hs`, detail: `Insalubre: ${rules.insalubreWeeklyHours || 33} hs reales pagadas como ${rules.insalubrePaidWeeklyHours || 45} hs.` }
      ])}
      ${renderSummarySection("Reglas de calculo", [
        { label: "Divisor sueldo / inasistencias", value: rules.dayDivisor || 30, detail: "Remuneracion habitual dividida por el divisor convencional." },
        { label: "Divisor vacaciones", value: rules.vacationDivisor || 25, detail: "Plus vacacional y dias de vacaciones." },
        { label: "Divisor horas extra", value: rules.hourDivisor || 200, detail: "Base habitual de remunerativos dividida por 200." },
        { label: "Nocturnidad voluntaria", value: `${rules.nightPct || 100}%`, detail: "Adicional sobre valor hora convencional." },
        { label: "Dia empleado de farmacia", value: rules.pharmacyEmployeeDay || "6 de septiembre", detail: "Se liquida como trabajado o no trabajado, nunca duplicado." }
      ])}
      ${renderSummaryTable("Escalafon de antiguedad", ["Tramo", "Porcentaje", "Base"], [
        ["1 año", "5%", "Basico o basico + adicionales fijos si se activa"],
        ["2 años", "10%", "Base antiguedad"],
        ["5 años", "20%", "Base antiguedad"],
        ["10 años", "25%", "Base antiguedad"],
        ["15 años", "30%", "Base antiguedad"],
        ["20 años o mas", "35%", "Base antiguedad"]
      ])}
      ${renderSummaryTable("Adicionales principales", ["Concepto", "Valor / regla", "Tratamiento"], [
        ["Cajero", `${rules.cajeroPct || 10}%`, "Remunerativo sobre basico"],
        ["Tareas administrativas", `${rules.tareasAdministrativasPct || 5}%`, "Remunerativo"],
        ["Admin por antiguedad tarea", `${rules.adminTenurePctInitial || 5}% / ${rules.adminTenurePctOver2Years || 10}%`, "Controlar antiguedad en la tarea"],
        ["Perfumeria", `${rules.perfumeriaPct || 10}%`, "Validar requisito de tarea/antiguedad"],
        ["Bici, ciclomotor o moto", `${rules.bikePct || 10}%`, "Remunerativo"],
        ["Idiomas", `${rules.languagePct || 10}% por idioma`, "Referencia categoria inicial A"],
        ["Titulo auxiliar", `${rules.auxTitlePct || 20}%`, "Referencia empleado de farmacia"],
        ...additions.map((item) => [item.label, fmt(item.monthly || 0), "Adicional de escala con no remunerativo propio"])
      ])}
      ${renderSummarySection("Aportes y contribuciones", [
        { label: "Aportes generales", value: "SIPA 11%, PAMI 3%, Obra social 3%", detail: "Obra social puede elevar base a jornada completa si se liquida jornada reducida." },
        { label: "ADEF solidario", value: `${rules.adefSolidarityPct || 2}%`, detail: "Activado por defecto en el sistema." },
        { label: "Afiliado ADEF", value: `${rules.unionPct || 2}% opcional`, detail: "Solo si el trabajador esta afiliado." },
        { label: "Caja compensadora / Pro edificio", value: `${rules.cajaCompensadoraPct || 1}% / ${rules.proEdificioPct || 1}%`, detail: "Opcionales segun legajo y criterio aplicable." },
        { label: "Contribucion extraordinaria escala", value: extraordinary ? fmt(extraordinary) : "-", detail: "Importe fijo informado por periodo." }
      ])}
      ${renderSummaryBulletSection("Checklist profesional", [
        "Validar categoria contra funcion real y escala vigente.",
        "Confirmar jornada semanal, jornada reducida e insalubridad antes de liquidar.",
        "Controlar adicionales de titulo, adscripcion, bloqueo y falla de caja con respaldo.",
        "Revisar si la suma no remunerativa integra obra social y si corresponde prorrateo.",
        "Evitar duplicar el dia del empleado de farmacia como trabajado y no trabajado."
      ])}
    `;
  }

  function renderCamionerosConventionSummary(conv, result = null) {
    const { period, zone, category } = currentSummaryContext(conv, result);
    const items = conv.items || {};
    const coef = zone?.coef || 1;
    const monthly = selectedScaleAmount(conv, category, zone, period);
    const day = monthly ? monthly / Math.max(1, num("camPeriodDays", 24)) : (category?.day || 0) * coef;
    return `
      <section class="summary-section summary-highlight">
        <h3>Lectura contable</h3>
        <p>Camioneros CCT 40/89 requiere separar con precision basico remunerativo, adicionales de rama y viaticos no remunerativos del Art. 4.2.11. El sistema calcula zona, jornal, presentismo, antiguedad sin tope, kilometraje, comida, viaticos y aportes sindicales propios.</p>
      </section>
      ${renderSummaryCards([
        { label: "Basico mensual", value: monthly ? fmt(monthly) : "-", detail: `Categoria seleccionada con coeficiente ${coef.toLocaleString("es-AR")}.` },
        { label: "Jornal diario", value: day ? fmt(day) : "-", detail: "Por defecto divide por 24 dias convencionales, editable." },
        { label: "Antiguedad", value: "1% por año", detail: "Sin tope, sobre subtotal de remunerativos antes de antiguedad." },
        { label: "Presentismo", value: `${items.presentismoPct || 8.33}%`, detail: "Sobre basico; no corresponde con inasistencias injustificadas." }
      ])}
      ${renderSummarySection("Base, zona y jornada", [
        { label: "CCT", value: "40/89", detail: "Transporte automotor de cargas y ramas alcanzadas." },
        { label: "Zona seleccionada", value: zone?.label || "-", detail: `Coeficiente aplicado: ${coef.toLocaleString("es-AR")}.` },
        { label: "Dias convencionales", value: num("camPeriodDays", 24), detail: "El sistema permite adaptar jornales a pagar y ausencias." },
        { label: "Horas extra", value: "50% / 100% / nocturnas", detail: "Valor hora estimado con jornal diario / 8." },
        { label: "Dia camionero", value: "15 de diciembre", detail: "Si se trabaja, el sistema permite liquidarlo como jornal doble." }
      ])}
      ${renderSummaryTable("Viaticos y no remunerativos Art. 4.2.11", ["Concepto", "Valor base", "Tratamiento"], [
        ["Comida", fmt((items.comida || 0) * coef), "No remunerativo por dia"],
        ["Viatico especial", fmt((items.viaticoEspecial || 0) * coef), "No remunerativo por dia"],
        ["Pernoctada", fmt((items.pernoctada || 0) * coef), "No remunerativo por evento"],
        ["Viatico por km", fmt((items.kmViatico || 0) * coef), "No remunerativo por kilometro"],
        ["Permanencia fuera de residencia", fmt((items.permanencia || 0) * coef), "No remunerativo"],
        ["Simple presencia", fmt((items.simplePresencia || 0) * coef), "No remunerativo"],
        ["Cruce de frontera", fmt((items.cruceFrontera || 0) * coef), "No remunerativo"],
        ["Ingreso/egreso Tierra del Fuego", fmt((items.ingresoIsla || 0) * coef), "No remunerativo"]
      ])}
      ${renderSummaryTable("Adicionales remunerativos de rama", ["Concepto", "Porcentaje / valor", "Base"], [
        ["Chofer larga distancia", `${items.choferLargaDistanciaPct || 10}%`, "Basico"],
        ["Materia prima lactea", `${items.lacteaPct || 15}%`, "Basico"],
        ["Conductor auxilio", `${items.auxilioPct || 10}%`, "Basico"],
        ["Unidades blindadas", `${items.blindadoPct || 20}%`, "Basico"],
        ["Combustibles", `${items.combustiblesPct || 15}%`, "Conductor 1ra"],
        ["Sustancias peligrosas", `${items.peligrosasPct || 20}%`, "Conductor 1ra"],
        ["Pozos petroliferos", `${items.pozosPetroliferosPct || 40}%`, "Basico"],
        ["Pluralidad Grupo I/III", `${items.pluralidadGrupoIPct || 25}%`, "Basico"],
        ["Pluralidad Grupo II", `${items.pluralidadGrupoIIPct || 18}%`, "Basico"],
        ["Diarios y revistas", `${items.diariosRevistasPct || 12}%`, "Basico"],
        ["Logistica / almacenamiento", `${items.logisticaPct || 18}%`, "Basico"],
        ["Camara de frio", `${items.camaraFrioPct || 20}%`, "Basico"],
        ["Bitrenes", fmt((items.bitrenes || 0) * coef), "Valor de planilla"]
      ])}
      ${renderSummarySection("Aportes, contribuciones y bases", [
        { label: "Aportes generales", value: "SIPA 11%, PAMI 3%, Obra social 3%", detail: "Sobre remunerativos; los viaticos Art. 4.2.11 no integran base OS en este motor." },
        { label: "Trabajador Camioneros", value: "Cuota sindical 2%, solidaria 3%, sepelio 1,5%", detail: "Activables desde conceptos." },
        { label: "Empleador Camioneros", value: "2% empresario, 0,5% capacitacion, 2% profesionalizacion", detail: "Se suman al costo empleador." },
        { label: "Kilometraje", value: `${fmt((items.kmExtra || 0) * coef)} / km`, detail: "Remunerativo para horas extraordinarias por kilometro; viatico por km se separa no remunerativo." }
      ])}
      ${renderSummaryBulletSection("Checklist profesional", [
        "Verificar categoria exacta, rama y zona antes de liquidar.",
        "Separar comida, viaticos, pernoctada y kilometraje no remunerativo del Art. 4.2.11.",
        "Controlar que la antiguedad se aplique despues de adicionales remunerativos configurados.",
        "No liquidar presentismo si hay inasistencias injustificadas.",
        "Validar kilometros, pernoctadas y adicionales de rama contra planilla/parte de viaje."
      ])}
    `;
  }

  function renderGenericConventionSummary(conv, result = null) {
    const { period, zone, category } = currentSummaryContext(conv, result);
    const model = conv.liquidationModel || {};
    const rules = { ...(conv.rules || {}), ...(model.rules || {}) };
    const seniority = rules.seniority || {};
    const presentism = rules.presentism || {};
    const nonRem = rules.nonRemunerativeScale || {};
    const nonRemDetail = [
      `OS: ${summaryValue(nonRem.subjectToHealthInsurance, "segun datos aprobados")}`,
      `sindicato: ${summaryValue(nonRem.subjectToUnion, "segun datos aprobados")}`,
      Number(nonRem.seniorityPercentPerYear || 0) ? `antiguedad NR ${nonRem.seniorityPercentPerYear}% por año` : "",
      Number(nonRem.presentismPercent || 0) ? `presentismo NR ${nonRem.presentismPercent}%` : ""
    ].filter(Boolean).join("; ");
    const overtime = rules.overtime || {};
    const legal = conv.legalFramework || {};
    const sources = summaryArray(legal.primarySources).map((source) => `${source.title || source.type || "Fuente"}${source.fileName ? ` - ${source.fileName}` : ""}`);
    const scope = conv.scope || {};
    const concepts = summaryArray(model.concepts || conv.concepts);
    const conceptSummaryRow = (item) => [
      humanizeTechnicalText(item.label || item.id),
      humanConceptType(item),
      humanConceptCalculation(item),
      humanConceptBase(item.base),
      humanConceptDetail(item)
    ];
    const conceptType = (item) => String(item.rowType || "remunerative").toLowerCase().replace(/[^a-z]/g, "");
    const remunerativeConceptRows = concepts
      .filter((item) => conceptType(item) === "remunerative")
      .map(conceptSummaryRow);
    const nonRemunerativeConceptRows = concepts
      .filter((item) => conceptType(item) === "nonremunerative")
      .map(conceptSummaryRow);
    const deductionConceptRows = concepts
      .filter((item) => conceptType(item) === "deduction")
      .map(conceptSummaryRow);
    const otherConceptRows = concepts
      .filter((item) => !["remunerative", "nonremunerative", "deduction"].includes(conceptType(item)))
      .map(conceptSummaryRow);
    const deductionRows = summaryArray(model.deductions || conv.deductions).map((item) => [
      humanizeTechnicalText(item.label || item.id),
      item.percent ? `${item.percent}%` : (item.amount ? fmt(Number(item.amount)) : "-"),
      humanConceptBase(item.base || "remunerative"),
      humanConceptDetail(item)
    ]);
    const retentionRows = summaryArray(model.retentions || conv.retentions).map((item) => [
      humanizeTechnicalText(item.label || item.id),
      item.percent ? `${item.percent}%` : (item.amount ? fmt(Number(item.amount)) : "-"),
      humanConceptBase(item.base || "remunerative"),
      humanConceptDetail(item)
    ]);
    const extractedRuleRows = summaryArray(conv.extractedRules).map((item) => [
      item.label || item.id,
      summaryValue(item.value),
      item.evidence || "-",
      item.sourceFileName || item.source || "-"
    ]);
    const employerRows = summaryArray(model.employerContributions || conv.employerContributions).map((item) => [
      humanizeTechnicalText(item.label || item.id),
      item.percent ? `${item.percent}%` : (item.amount ? fmt(Number(item.amount)) : "-"),
      humanConceptBase(item.base || "remunerative"),
      humanConceptDetail(item)
    ]);
    const articleRows = Object.entries(legal.articleMap || {}).map(([key, value]) => [
      key,
      typeof value === "string" ? value : summaryValue(value?.title || value?.summary || value?.detail || JSON.stringify(value))
    ]);
    const scaleZones = conv.zones?.length ? conv.zones : [zone || { id: "general", label: "General" }];
    const scaleTables = scaleZones.flatMap((tableZone) => categoryGuideGroups(conv.categories || []).map((group) => renderSummaryTable(categoryGuideTitle(`Escala salarial - ${tableZone.label || "General"}`, group.label), ["Categoria", "Mensual", "Jornal", "Hora", "No rem. periodo"], group.categories.map((cat) => {
      const row = scaleCategoryRow(conv, cat, tableZone);
      return [
        cat.label,
        firstFinite(row?.monthly, cat.monthly, cat.monthlyByPeriod?.[period]) ? fmt(firstFinite(row?.monthly, cat.monthly, cat.monthlyByPeriod?.[period])) : "-",
        firstFinite(row?.day, cat.day, cat.dayByPeriod?.[period]) ? fmt(firstFinite(row?.day, cat.day, cat.dayByPeriod?.[period])) : "-",
        firstFinite(row?.hourly, cat.hourly, cat.hourlyByPeriod?.[period]) ? fmt(firstFinite(row?.hourly, cat.hourly, cat.hourlyByPeriod?.[period])) : "-",
        periodNonRemValue(cat, period) ? fmt(periodNonRemValue(cat, period)) : "-"
      ];
    })))).join("");
    return `
      <section class="summary-section summary-highlight">
        <h3>Lectura contable</h3>
        <p>Este convenio fue estructurado por leIA para liquidación. El motor genérico usa categoría, período, zona, escala vigente, reglas de proporcionalidad, antigüedad, presentismo, no remunerativos, conceptos variables, deducciones, retenciones y contribuciones aprobadas por auditoría humana.</p>
      </section>
      ${renderSummaryCards([
        { label: "Tipo de sueldo", value: rules.salaryType || conv.type || "monthly", detail: "Define si la base se prorratea mensual, diaria u horaria." },
        { label: "Divisor mensual", value: rules.monthDivisor || rules.dayDivisor || 30, detail: "Usado para proporcionalidad por dias." },
        { label: "Divisor hora", value: rules.hourDivisor || overtime.divisor || 200, detail: "Base de horas extra." },
        { label: "Jornada semanal", value: `${rules.weeklyHours || category?.normalWeeklyHours || "-"} hs`, detail: "Referencia para jornada completa y proporciones." }
      ])}
      ${renderSummarySection("Identificacion y alcance", [
        { label: "Convenio", value: conv.name, detail: conv.source || "" },
        { label: "CCT / acta", value: conventionCct(conv), detail: conv.metadata?.homologation?.resolution ? `Homologacion: ${conv.metadata.homologation.resolution}` : "" },
        { label: "Actividad", value: conv.metadata?.activity || scope.activity || "-", detail: conv.metadata?.jurisdiction || "" },
        { label: "Sindicato", value: conv.metadata?.union || "-", detail: conv.metadata?.employerChamber || "" },
        { label: "Territorio", value: summaryArray(scope.territory).join(", ") || zone?.label || "-", detail: "Alcance territorial declarado en el JSON." }
      ])}
      ${renderSummarySection("Reglas automaticas", [
        { label: "Antiguedad", value: seniority.enabled === false ? "No aplica" : `${summaryValue(seniority.percentPerYear, 0)}% por año`, detail: `Base: ${summaryValue(seniority.base, "basic")}${seniority.capYears ? `; tope ${seniority.capYears} años` : "; sin tope informado"}` },
        { label: "Presentismo", value: presentism.enabled ? `${summaryValue(presentism.percent, 0)}%` : "No aplica", detail: presentism.requiresNoUnjustifiedAbsence === false ? "No exige ausencia cero" : "Exige controlar inasistencias injustificadas." },
        { label: "No remunerativo escala", value: nonRem.enabled === false ? "No aplica" : "Activo", detail: nonRemDetail },
        { label: "Horas extra", value: overtime.enabled === false ? "No aplica" : `50% x${summaryValue(overtime.rate50, 1.5)} / 100% x${summaryValue(overtime.rate100, 2)}`, detail: `Divisor ${summaryValue(overtime.divisor || rules.hourDivisor, 200)}` },
        { label: "Categoria actual", value: category?.label || "-", detail: `Periodo ${monthLabel(periodIdToMonth(period) || period)} - zona ${zone?.label || "-"}` }
      ])}
      ${renderSummaryBulletSection("Fuentes cargadas", sources)}
      ${renderSummaryBulletSection("Trabajadores incluidos", scope.workersIncluded)}
      ${renderSummaryBulletSection("Trabajadores excluidos", scope.workersExcluded)}
      ${renderSummaryTable("Articulos relevantes", ["Articulo", "Resumen"], articleRows)}
      ${renderSummaryTable("Haberes remunerativos", ["Concepto", "Tipo", "Cómo se calcula", "Base de cálculo", "Condición / detalle"], remunerativeConceptRows)}
      ${renderSummaryTable("Haberes no remunerativos", ["Concepto", "Tipo", "Cómo se calcula", "Base de cálculo", "Condición / detalle"], nonRemunerativeConceptRows)}
      ${renderSummaryTable("Descuentos convencionales variables", ["Concepto", "Tipo", "Cómo se calcula", "Base de cálculo", "Condición / detalle"], deductionConceptRows)}
      ${renderSummaryTable("Otros conceptos del motor", ["Concepto", "Tipo", "Cómo se calcula", "Base de cálculo", "Condición / detalle"], otherConceptRows)}
      ${renderSummaryTable("Deducciones propias", ["Concepto", "Valor", "Base de cálculo", "Condición / detalle"], deductionRows)}
      ${renderSummaryTable("Retenciones propias", ["Concepto", "Valor", "Base de cálculo", "Condición / detalle"], retentionRows)}
      ${renderSummaryTable("Contribuciones propias empleador", ["Concepto", "Valor", "Base de cálculo", "Condición / detalle"], employerRows)}
      ${renderSummaryTable("Reglas extraidas de documentos", ["Regla", "Valor", "Evidencia", "Fuente"], extractedRuleRows)}
      ${scaleTables}
      ${renderSummaryBulletSection("Checklist de auditoria", conv.auditChecklist || conv.validation?.warnings || [
        "Controlar CCT, escala y periodo vigente.",
        "Validar categoria, zona y jornada contra legajo.",
        "Revisar conceptos marcados con validacion humana.",
        "Controlar bases de aportes y no remunerativos."
      ])}
      ${renderSummaryBulletSection("Notas y advertencias", [...summaryArray(conv.notes), ...summaryArray(conv.warnings)])}
    `;
  }

  function renderGenericScale(result) {
    const conv = result.conv;
    const period = result.period;
    const model = conv.liquidationModel || {};
    return `<div class="tables">
      <section class="scale-table-card">
        <h3>Categorias</h3>
        <div class="scale-table-scroll">
          <table><thead><tr><th>Categoria</th><th class="num">Mensual</th><th class="num">Jornal</th><th class="num">Hora</th><th class="num">No rem.</th></tr></thead><tbody>
            ${(conv.categories || []).map((cat) => {
              const row = scaleCategoryRow(conv, cat, result.zone);
              return `<tr>
                <td>${escapeHtml(cat.label)}</td>
                <td class="num">${fmt(firstFinite(row?.monthly, cat.monthly) || 0)}</td>
                <td class="num">${fmt(firstFinite(row?.day, cat.day) || 0)}</td>
                <td class="num">${fmt(firstFinite(row?.hourly, cat.hourly) || 0)}</td>
                <td class="num">${fmt(firstFinite(row?.nonRemunerative, periodNonRemValue(cat, period)) || 0)}</td>
              </tr>`;
            }).join("")}
          </tbody></table>
        </div>
      </section>
      <section class="scale-table-card">
        <h3>Conceptos</h3>
        <div class="scale-table-scroll">
          <table><thead><tr><th>Concepto</th><th>Tipo</th><th>Cómo se calcula</th><th>Base de cálculo</th></tr></thead><tbody>
            ${(model.concepts || []).map((concept) => `<tr>
              <td>${escapeHtml(humanizeTechnicalText(concept.label || concept.id))}</td>
              <td>${escapeHtml(humanConceptType(concept))}</td>
              <td>${escapeHtml(humanConceptCalculation(concept))}</td>
              <td>${escapeHtml(humanConceptBase(concept.base || "basic"))}</td>
            </tr>`).join("") || `<tr><td colspan="4">Sin conceptos variables cargados.</td></tr>`}
          </tbody></table>
        </div>
      </section>
      <div class="scale-summary">Convenio generado por leIA con motor generico JSON. Edita el convenio desde Convenios IA si necesitás ajustar reglas finas.</div>
    </div>`;
  }

  function renderUocraScale(result) {
    const period = result.period;
    const zone = result.zone.id;
    const conv = result.conv;
    return `<div class="tables"><table><thead><tr><th>Categoria</th><th class="num">Jornal / sueldo</th><th class="num">Valor hora</th><th class="num">SNR mensual</th></tr></thead><tbody>
      ${conv.categories.map((cat) => {
        const activeRow = scaleCategoryRow(conv, cat, result.zone);
        const value = firstFinite(
          cat.monthly ? activeRow?.monthly : activeRow?.day,
          cat.monthly ? activeRow?.day ? activeRow.day * 24 : null : activeRow?.hourly ? activeRow.hourly * 8 : null,
          activeRow?.monthly,
          conv.scales[period][zone][cat.id]
        ) || 0;
        const snr = firstFinite(activeRow?.nonRemunerative, conv.nonRem[period][zone][cat.id]) || 0;
        return `<tr><td>${escapeHtml(cat.label)}</td><td class="num">${fmt(value)}</td><td class="num">${cat.monthly ? "-" : fmt(value / 8)}</td><td class="num">${fmt(snr)}</td></tr>`;
      }).join("")}
    </tbody></table></div>`;
  }

  function renderFarmaciaScale(result) {
    const period = result.period;
    const conv = result.conv;
    const additions = Object.values(conv.additionals);
    const rules = conv.rules || {};
    const ruleRows = [
      ["Jornada base", `${rules.weeklyHours || 45} hs semanales`, "Proporcional por horas"],
      ["Jornada insalubre", `${rules.insalubreWeeklyHours || 33} hs pagadas como ${rules.insalubrePaidWeeklyHours || rules.weeklyHours || 45}`, "Art. 15"],
      ["Divisor inasistencias", rules.dayDivisor || 30, "Remuneracion / divisor"],
      ["Divisor vacaciones", rules.vacationDivisor || 25, "Remuneracion / divisor"],
      ["Divisor horas extra", rules.hourDivisor || 200, "Base habitual / divisor"],
      ["Nocturnidad voluntaria", `${rules.nightPct || 100}%`, "Art. 16/17"],
      ["Dia empleado farmacia", rules.pharmacyEmployeeDay || "6 de septiembre", "Feriado convencional"],
      ["Antiguedad", "5/10/20/25/30/35%", "Escala por años"],
      ["Falla de caja", `${rules.fallaCajaPct || 10}%`, "No remunerativo"],
      ["Aporte solidario ADEF", `${rules.adefSolidarityPct || 2}%`, "Configurable"]
    ];
    return `<div class="tables">
      <table><thead><tr><th>Categoria</th><th class="num">Basico abril 2026</th><th class="num">No rem. periodo</th></tr></thead><tbody>
        ${conv.categories.map((cat) => {
          const row = scaleCategoryRow(conv, cat, result.zone);
          return `<tr><td>${escapeHtml(cat.label)}</td><td class="num">${fmt(firstFinite(row?.monthly, cat.monthly) || 0)}</td><td class="num">${fmt(firstFinite(row?.nonRemunerative, cat.nonRem[period]) || 0)}</td></tr>`;
        }).join("")}
      </tbody></table>
      <table><thead><tr><th>Adicional</th><th class="num">Basico</th><th class="num">No rem. periodo</th></tr></thead><tbody>
        ${additions.map((add) => {
          const key = Object.keys(conv.additionals).find((item) => conv.additionals[item] === add);
          const row = scaleAdditionalRow(conv, key, add);
          return `<tr><td>${escapeHtml(add.label)}</td><td class="num">${fmt(firstFinite(row?.monthly, add.monthly) || 0)}</td><td class="num">${fmt(firstFinite(row?.nonRemunerative, add.nonRem[period]) || 0)}</td></tr>`;
        }).join("")}
      </tbody></table>
      <table><thead><tr><th>Regla</th><th>Valor</th><th>Uso</th></tr></thead><tbody>
        ${ruleRows.map(([label, value, use]) => `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(value)}</td><td>${escapeHtml(use)}</td></tr>`).join("")}
      </tbody></table>
    </div>`;
  }

  function renderCamionerosScale(result) {
    const zone = result.zone;
    const items = result.conv.items || {};
    const noRemItems = [
      ["Comida", items.comida, "Item 4.1.12"],
      ["Viatico especial", items.viaticoEspecial, "Item 4.1.13"],
      ["Pernoctada", items.pernoctada, "Item 4.1.14"],
      ["Viatico por km", items.kmViatico, "Item 4.2.4"],
      ["Permanencia fuera de residencia", items.permanencia, "Item 4.2.5"],
      ["Simple presencia", items.simplePresencia, "Item 4.2.5"],
      ["Cruce de frontera", items.cruceFrontera, "Item 4.2.17"],
      ["Ingreso/egreso Tierra del Fuego", items.ingresoIsla, "Item 4.2.17"]
    ];
    const remItems = [
      ["Horas extraordinarias por km", items.kmExtra, "Item 4.2.3"],
      ["Plus vacacional por dia", items.plusVacacionalDia, "Item 3.3.2"],
      ["Adicional bitrenes", items.bitrenes, "Planilla vigente"]
    ];
    return `<div class="tables"><table><thead><tr><th>Categoria</th><th class="num">Por mes</th><th class="num">Por dia</th></tr></thead><tbody>
      ${result.conv.categories.map((cat) => {
        const row = scaleCategoryRow(result.conv, cat, zone);
        const rowHasZone = !!(row && row.zone);
        const coef = rowHasZone ? 1 : zone.coef;
        const monthly = firstFinite(row?.monthly) ? firstFinite(row?.monthly) * coef : cat.monthly * zone.coef;
        const day = firstFinite(row?.day, row?.hourly ? row.hourly * 8 : null) ? firstFinite(row?.day, row?.hourly ? row.hourly * 8 : null) * coef : cat.day * zone.coef;
        return `<tr><td>${escapeHtml(cat.label)}</td><td class="num">${fmt(monthly)}</td><td class="num">${fmt(day)}</td></tr>`;
      }).join("")}
    </tbody></table>
    <table><thead><tr><th>Concepto no remunerativo</th><th>Referencia</th><th class="num">Valor zona</th></tr></thead><tbody>
      ${noRemItems.map(([label, value, ref]) => `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(ref)}</td><td class="num">${fmt((Number(value) || 0) * (zone.coef || 1))}</td></tr>`).join("")}
    </tbody></table>
    <table><thead><tr><th>Concepto remunerativo / adicional</th><th>Referencia</th><th class="num">Valor zona</th></tr></thead><tbody>
      ${remItems.map(([label, value, ref]) => `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(ref)}</td><td class="num">${fmt((Number(value) || 0) * (zone.coef || 1))}</td></tr>`).join("")}
      <tr><td>Presentismo</td><td>Parametro del sistema</td><td class="num">${Number(items.presentismoPct || 8.33).toLocaleString("es-AR")}%</td></tr>
      <tr><td>Antiguedad</td><td>Item 6.1.5</td><td class="num">1% por año</td></tr>
    </tbody></table></div>`;
  }

  function activateTab(tabName) {
    document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("active", item.dataset.tab === tabName));
    document.querySelectorAll(".tab-pane").forEach((pane) => pane.classList.toggle("active", pane.id === `${tabName}Pane`));
  }

  function buildLiquidationAuditPayload() {
    if (!lastResult) return null;
    return {
      conventionId: lastResult.conv.id,
      conventionName: lastResult.conv.name,
      period: lastResult.period,
      periodLabel: lastResult.conv.periods.find((item) => item.id === lastResult.period)?.label || lastResult.period,
      employee: lastResult.employee,
      category: {
        id: lastResult.category.id,
        label: lastResult.category.label
      },
      zone: {
        id: lastResult.zone.id,
        label: lastResult.zone.label,
        coef: lastResult.zone.coef
      },
      activeScale: lastResult.activeScale,
      totals: lastResult.totals,
      remunerative: lastResult.remRows,
      nonRemunerative: lastResult.noRemRows,
      deductions: lastResult.deductionRows,
      employer: lastResult.employerRows,
      details: lastResult.details,
      parameters: collectLeiaParameters()
    };
  }

  function auditSeverityClass(severity) {
    const value = String(severity || "").toLowerCase();
    if (value.includes("alta")) return "high";
    if (value.includes("media")) return "medium";
    return "low";
  }

