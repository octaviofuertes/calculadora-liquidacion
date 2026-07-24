document.addEventListener('DOMContentLoaded', async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const convId = urlParams.get('id');

  const localData = window.PAYROLL_DATA || window.DATA;
  let data = localData;
  try {
    if (window.eSueldosApi) {
      const apiClient = window.eSueldosApi.createApiClient();
      const res = await fetch(apiClient.url("/api/catalog"));
      if (res.ok) {
        const apiData = await res.json();
        if (apiData && apiData.conventions) {
          const merged = window.eSueldosCatalogSync
            ? window.eSueldosCatalogSync.mergeCatalogData(localData, apiData)
            : apiData;
          data = merged;
          window.PAYROLL_DATA = merged;
          window.DATA = merged;
        }
      }
    }
  } catch (e) {
    console.warn("Usando datos estáticos locales (API no disponible).", e);
  }

  if (!data || !data.conventions) {
    document.getElementById('articleBody').innerHTML = '<p style="color:red">Error: No se pudo cargar la base de datos de convenios.</p>';
    return;
  }

  const conv = window.eSueldosCatalogSync
    ? window.eSueldosCatalogSync.resolveConvention(data.conventions, convId)
    : data.conventions[convId];
  if (!conv) {
    document.getElementById('articleTitle').textContent = 'Convenio no encontrado';
    document.getElementById('articleBody').innerHTML = '<p>Lo sentimos, el convenio colectivo solicitado no existe o no está disponible en este momento.</p>';
    document.getElementById('calculatorSection').style.display = 'none';
    return;
  }

  // Set Title
  const title = conv.metadata?.title || conv.name || conv.id;
  document.getElementById('articleTitle').textContent = `Guía para la Liquidación del ${title}`;

  // Set Meta
  function shortDate(dateStr) {
    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr;
    const options = { year: 'numeric', month: 'long', day: 'numeric' };
    return d.toLocaleDateString('es-AR', options);
  }
  const dateStr = shortDate(conv.updatedAt || conv.createdAt || new Date());
  const readTime = Math.max(3, Math.floor(Math.random() * 8));
  document.getElementById('articleMeta').innerHTML = `${dateStr} | <span aria-hidden="true">👁</span> ${readTime} min`;

  // Set Body
  const union = conv.metadata?.union || "-";
  // Clean up the description from the backend to remove AI references and TOC
  let desc = conv.metadata?.description || `El presente artículo detalla las condiciones laborales y escalas salariales correspondientes al <strong>${title}</strong>. Estos parámetros normativos establecen los sueldos básicos, adicionales, retenciones y reglas de liquidación obligatorias aplicables a los trabajadores del sector.`;
  
  // Remove "A continuación, presentamos los datos extraídos automáticamente..."
  desc = desc.replace(/A continuación, presentamos los datos extraídos automáticamente por nuestro agente de inteligencia artificial.*?actualizada\./gi, '');
  // Remove Table of Contents if present in the description (Markdown or HTML lists)
  desc = desc.replace(/### Índice de Contenido[\s\S]*?(?=###|$)/i, '');
  desc = desc.replace(/<ul[^>]*>.*?<\/ul>/gi, ''); // Simple strip of lists that might be the TOC

  if (!desc.trim()) {
    desc = `Condiciones laborales y salariales del convenio ${title}. Información clave para la liquidación de sueldos.`;
  }

  const escapeHtml = (str) => String(str).replace(/[&<>'"]/g, match => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[match]));

  let categoriesHtml = '<p>No hay categorías registradas.</p>';
  if (conv.categories && conv.categories.length > 0) {
    let zonesToRender = conv.zones && conv.zones.length > 0 ? conv.zones : [{ id: 'general', label: 'General / Todo el país' }];
    let hasPeriods = conv.periods && conv.periods.length > 0;
    
    categoriesHtml = '';

    zonesToRender.forEach(zone => {
      let periodHeaders = '';
      if (hasPeriods) {
        periodHeaders = conv.periods.map(p => `<th style="text-align: right; padding: 14px 16px; font-weight: 600; color: #495057; font-size: 14px; white-space: nowrap;">Básico ${p.label}</th>`).join('');
      } else {
        periodHeaders = `<th style="text-align: right; padding: 14px 16px; font-weight: 600; color: #495057; font-size: 14px; white-space: nowrap;">Básico Vigente</th>`;
      }

      let titleSuffix = (conv.zones && conv.zones.length > 0) ? ` - ${escapeHtml(zone.label)}` : '';
      categoriesHtml += `
        <h4 style="margin-top: 24px; color: var(--blue-primary); font-size: 18px;">Escala Salarial${titleSuffix}</h4>
        <div style="overflow-x: auto; margin-top: 12px; margin-bottom: 24px; border-radius: 8px; border: 1px solid var(--border-color);">
          <table style="width: 100%; border-collapse: collapse; min-width: 600px;">
            <thead>
              <tr style="background-color: var(--bg-light); border-bottom: 2px solid var(--border-color);">
                <th style="text-align: left; padding: 14px 16px; font-weight: 600; color: #495057; font-size: 14px;">Descripción de la Categoría</th>
                <th style="text-align: left; padding: 14px 16px; font-weight: 600; color: #495057; font-size: 14px;">Modalidad / Tipo</th>
                ${periodHeaders}
              </tr>
            </thead>
            <tbody>
              ${conv.categories.map(c => {
                const id = c.id || c[0];
                const label = c.label || c[1] || '-';
                
                let type = 'General';
                if (c.monthly === true) type = 'Mensualizado';
                else if (c.monthly === false) type = 'Jornalizado / Hora';
                else if (c.length > 2 && typeof c[2] === 'number') type = 'Mensualizado';
                
                let periodCells = '';
                if (hasPeriods) {
                  periodCells = conv.periods.map(p => {
                    let salary = "S/D";
                    if (typeof c.monthly === 'number') {
                      salary = "$" + c.monthly.toLocaleString('es-AR', {minimumFractionDigits: 2});
                    } else if (c.length > 2 && typeof c[2] === 'number') {
                      salary = "$" + c[2].toLocaleString('es-AR', {minimumFractionDigits: 2});
                    } else if (conv.scales) {
                      try {
                        // Normalize zone.id: "Zona A" → "A", "Zona C Austral" → "CAustral"
                        const zoneNorm = (z) => z
                          .replace(/^zona\s+/i, '')
                          .replace(/\s+/g, '')
                          .replace('Austral', 'Austral');
                        const zoneKey = Object.keys(conv.scales[p.id] || {}).find(k =>
                          k === zone.id || zoneNorm(k) === zoneNorm(zone.id) ||
                          k.toLowerCase() === zone.id.toLowerCase() ||
                          zoneNorm(zone.id).toLowerCase() === k.toLowerCase()
                        );
                        const periodScale = zoneKey ? conv.scales[p.id]?.[zoneKey] : null;
                        // Normalize category id: "OFESP" → "ofEsp"
                        const idLower = id.toLowerCase();
                        const idMap = { ofesp: 'ofEsp', oficial: 'oficial', mofc: 'mofc', ayud: 'ayud', sereno: 'sereno' };
                        const catKey = Object.keys(periodScale || {}).find(k =>
                          k === id || k.toLowerCase() === idLower || idMap[idLower] === k
                        );
                        const val = catKey ? periodScale[catKey] : undefined;
                        if (val !== undefined && val !== 0) {
                          salary = "$" + Number(val).toLocaleString('es-AR', {minimumFractionDigits: 2});
                          if (conv.type === 'hourly' && catKey !== 'sereno') salary += " / día";
                        }
                      } catch (e) {}
                    } else if (c.hourlyByPeriod || c.dayByPeriod || c.monthlyByPeriod) {
                      // Backend normalized format
                      const periodValue = c.hourlyByPeriod?.[p.id] ?? c.dayByPeriod?.[p.id] ?? c.monthlyByPeriod?.[p.id];
                      if (typeof periodValue === 'number') {
                        salary = "$" + Number(periodValue).toLocaleString('es-AR', {minimumFractionDigits: 2});
                      } else if (periodValue && typeof periodValue === 'object') {
                        const zoneKey = Object.keys(periodValue).find(k => k.toLowerCase() === (zone.id || '').toLowerCase()) || Object.keys(periodValue)[0];
                        const val = zoneKey ? periodValue[zoneKey] : undefined;
                        if (val !== undefined && val !== 0) {
                          salary = "$" + Number(val).toLocaleString('es-AR', {minimumFractionDigits: 2});
                        }
                      }
                    }
                    return `<td style="padding: 14px 16px; color: var(--blue-primary); font-size: 15px; font-weight: 600; text-align: right; white-space: nowrap;">${salary}</td>`;
                  }).join('');
                } else {
                  let salary = "S/D";
                  if (typeof c.monthly === 'number') {
                    salary = "$" + c.monthly.toLocaleString('es-AR', {minimumFractionDigits: 2});
                  } else if (c.length > 2 && typeof c[2] === 'number') {
                    salary = "$" + c[2].toLocaleString('es-AR', {minimumFractionDigits: 2});
                  }
                  periodCells = `<td style="padding: 14px 16px; color: var(--blue-primary); font-size: 15px; font-weight: 600; text-align: right; white-space: nowrap;">${salary}</td>`;
                }

                return `
                  <tr style="border-bottom: 1px solid var(--border-color);">
                    <td style="padding: 14px 16px; color: #343a40; font-size: 15px; font-weight: 500;">${label}</td>
                    <td style="padding: 14px 16px; color: var(--text-muted); font-size: 14px; white-space: nowrap;">${type}</td>
                    ${periodCells}
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;
    });
  }

  // COMPREHENSIVE CONVENTION GUIDE
  const renderGuideSection = (title, content) => {
    if (!content) return "";
    return `
      <div class="gsec">
        <h3><span aria-hidden="true" style="color:var(--blue-primary)">◈</span> ${escapeHtml(title)}</h3>
        ${content}
      </div>
    `;
  };

  const renderGuideTable = (headers, rows) => {
    if (!rows || !rows.length) return "";
    return `
      <div class="tbox" style="margin-bottom:12px">
        <table class="dt">
          <thead><tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
          <tbody>
            ${rows.map(row => `<tr>${row.map(cell => `<td>${escapeHtml(String(cell))}</td>`).join('')}</tr>`).join('')}
          </tbody>
        </table>
      </div>
    `;
  };

  const renderGuideList = (items) => {
    if (!items || !items.length) return "";
    return `<ul>${items.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;
  };

  const r = conv.rules || {};
  const guideZones = Array.isArray(conv.zones) && conv.zones.length > 0 ? conv.zones : [];
  const zoneContent = guideZones.length
    ? renderGuideTable(['Zona', 'Descripción / Detalle'], guideZones.map((z) => [z.label || z.id, z.detail || 'Aplica según catálogo']))
    : renderGuideTable(['Aviso'], [['Sin zonas específicas informadas por el catálogo']]);

  const jornadaRows = [];
  if (r.weeklyHours || r.horasSemanales) jornadaRows.push(['Jornada legal', `${r.weeklyHours || r.horasSemanales} hs semanales`]);
  if (r.dailyHoursMax || r.horasDiariasMax) jornadaRows.push(['Jornada diaria máxima', `${r.dailyHoursMax || r.horasDiariasMax} hs`]);
  if (r.nightHours || r.horasNocturnas) jornadaRows.push(['Jornada nocturna', `${r.nightHours || r.horasNocturnas} hs`]);
  if (r.lunchBreakMin || r.pausaComidaMin) jornadaRows.push(['Pausa paga', `${r.lunchBreakMin || r.pausaComidaMin} min`]);
  if (!jornadaRows.length) jornadaRows.push(['Jornada', 'Según el convenio publicado por backend / catálogo']);
  const jornadaContent = renderGuideTable(['Concepto', 'Detalle'], jornadaRows);

  const descansoRows = [];
  if (r.extra50Multiplier != null) descansoRows.push(['Horas extra 50%', `${((Number(r.extra50Multiplier) - 1) * 100).toFixed(0)}%`]);
  if (r.extra100Multiplier != null) descansoRows.push(['Horas extra 100%', `${((Number(r.extra100Multiplier) - 1) * 100).toFixed(0)}%`]);
  if (r.holidayWorked) descansoRows.push(['Trabajo en descanso/feriado', String(r.holidayWorked)]);
  const descansoContent = renderGuideTable(['Concepto', 'Detalle'], descansoRows);

  const dayDiv = r.dayDivisor || (conv.type === 'monthly' ? 30 : 24);
  const vacDiv2 = r.vacationDivisor || 25;
  const modalidadContent = renderGuideTable(['Concepto', 'Fórmula / Detalle'], [
    ['Modalidad', conv.type === 'monthly' ? 'Mensualizada' : 'Jornalizada'],
    ['Valor día', `Sueldo / ${dayDiv}`],
    ['Valor hora', `Valor día / ${r.hourDivisor || 8}`],
    ['Vacaciones', `Remuneración total / ${vacDiv2}`]
  ]);

  const adicRows = [];
  const addedAdicKeys = new Set();
  const cleanNorm = (str) => String(str || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, '');

  const pushAdic = (label, tipo, calc, fuente, id) => {
    const keyLabel = cleanNorm(label);
    const keyId = cleanNorm(id);
    if ((keyLabel && addedAdicKeys.has(keyLabel)) || (keyId && addedAdicKeys.has(keyId))) return;
    if (keyLabel) addedAdicKeys.add(keyLabel);
    if (keyId) addedAdicKeys.add(keyId);
    adicRows.push([label, tipo, calc, fuente]);
  };

  const fmtAmt = (v) => v != null && v !== '' ? `$${Number(v).toLocaleString('es-AR', {minimumFractionDigits:2})}` : 'Según CCT';

  if (r.seniority?.enabled !== false && Array.isArray(r.seniority?.brackets) && r.seniority.brackets.length > 0) {
    const bracketDesc = r.seniority.brackets.map((b) => `${b.fromYears}+ años: ${b.percent}%`).join(' | ');
    pushAdic('Escalafón por antigüedad', 'Remunerativo', bracketDesc, 'Catálogo', 'seniority');
  } else if (r.seniorityPct || r.percentPerYear) {
    pushAdic('Antigüedad', 'Remunerativo', `Básico x ${r.seniorityPct || r.percentPerYear || 1}% x años de servicio`, 'Catálogo', 'seniority');
  }

  if (r.presentism?.enabled !== false || r.presentismPct || r.presentismPercent) {
    const presPct = r.presentism?.percent || r.presentismPct || r.presentismPercent || 8.33;
    pushAdic('Presentismo', 'Remunerativo', `(Básico + Antigüedad) x ${presPct}%`, 'Catálogo', 'presentism');
  }

  const senRule = conv.rules?.seniority;
  const senPct = senRule?.percentPerYear || senRule?.percent || conv.rules?.seniorityPct || 1;
  if (senRule?.enabled !== false && Array.isArray(senRule?.brackets) && senRule.brackets.length > 0) {
    // Bracket-style seniority (ej. Farmacia CCT 429/2005 Art. 13)
    const bracketDesc = senRule.brackets.map(b => `${b.fromYears}+ años: ${b.percent}%`).join(' | ');
    pushAdic('Escalafón por antigüedad', 'Remunerativo', bracketDesc, 'CCT', 'seniority');
    addedAdicKeys.add('antiguedad');
    addedAdicKeys.add('escalafon');
  } else if (senRule?.enabled !== false) {
    pushAdic('Antigüedad', 'Remunerativo', `Básico x ${senPct}% x Años de servicio (Art. 24 y 25)`, 'CCT 130/75', 'seniority');
    addedAdicKeys.add('antiguedad');
  }

  // Conceptos del liquidationModel (genéricos)
  const lmConcepts = [...(conv.liquidationModel?.concepts || []), ...(conv.liquidationModel?.nonRemunerative || [])];
  lmConcepts.forEach(concept => {
    if (!concept) return;
    const label = concept.label || concept.id || '';
    const norm = cleanNorm(label);
    if (norm === 'sueldobasico' || norm === 'basico' || norm === 'total' || norm === 'totalremunerativo' || norm === 'remunerativo') {
      return; // Omitir títulos estructurales base
    }

    let tipo = 'Remunerativo';
    if (concept.rowType === 'nonRemunerative' || concept.rowType === 'non_remunerative' || String(concept.naturaleza).toLowerCase().includes('no rem')) {
      tipo = 'No Remunerativo';
    }
    if (concept.rowType === 'deduction') return; // va en deducciones

    let calc = '';
    if (concept.percent && Number(concept.percent) > 0) {
      calc = `Básico x ${concept.percent}%`;
    } else if (concept.amount && Number(concept.amount) > 0) {
      calc = fmtAmt(concept.amount);
    } else if (concept.calculation === 'amountPerUnit') {
      calc = 'Valor por unidad x Cantidad';
    } else {
      const match = label.match(/(\d+(?:[.,]\d+)?)\s*%/);
      if (match) {
        calc = `Básico x ${match[1]}%`;
      } else {
        calc = 'Según escala publicada';
      }
    }
    pushAdic(label, tipo, calc, 'Catálogo', concept.id);
  });

  if (conv.additionals) {
    const adds = Array.isArray(conv.additionals) ? conv.additionals : Object.values(conv.additionals);
    adds.forEach(add => {
      let tipo = 'Remunerativo';
      if (add.type === 'non_remunerative' || add.nonRemunerative) tipo = 'No Remunerativo';
      pushAdic(add.label || add.id, tipo, add.detail || (add.monthly ? fmtAmt(add.monthly) : 'Según escala'), 'Catálogo', add.id);
    });
  }

  if (conv.items) {
    Object.entries(conv.items).forEach(([key, value]) => {
      if (value == null) return;
      pushAdic(key, 'Configuración', fmtAmt(value), 'Catálogo', key);
    });
  }

  const plusContent = adicRows.length > 0
    ? renderGuideTable(['Adicional / Concepto', 'Tipo', 'Cálculo', 'Fuente'], adicRows)
    : renderGuideTable(['Aviso'], [['No hay adicionales específicos del CCT', '-']]);

  const licenciasRows = Array.isArray(r.licencias) && r.licencias.length > 0
    ? r.licencias.map((l) => [l.motivo || l.label || '-', `${l.dias || '-'} día${Number(l.dias) === 1 ? '' : 's'}${l.articulo ? ` (${l.articulo})` : ''}`])
    : [];
  const licenciasContent = licenciasRows.length
    ? renderGuideTable(['Motivo de Licencia', 'Plazo / Duración'], licenciasRows)
    : renderGuideTable(['Aviso'], [['El catálogo no publica licencias específicas']]);

  const aportesRows = [];
  const pushDed = (label, cargo, alicuota, fuente, id) => {
    const key = cleanNorm(id || label);
    if (key && addedAdicKeys.has(`ded:${key}`)) return;
    if (key) addedAdicKeys.add(`ded:${key}`);
    aportesRows.push([label, cargo, alicuota, fuente]);
  };
  const fmtDedVal = (d) => d?.percent != null ? `${d.percent}%` : (d?.amount != null ? fmtAmt(d.amount) : 'Según catálogo');
  if (Array.isArray(r.workerDeductions)) {
    r.workerDeductions.forEach((ded) => pushDed(ded.label || ded.id, ded.type || 'Aporte Trabajador', fmtDedVal(ded), 'Catálogo', ded.id));
  } else if (r.workerDeductions && typeof r.workerDeductions === 'object') {
    Object.values(r.workerDeductions).forEach((ded) => pushDed(ded.label || ded.id, 'Aporte Trabajador', fmtDedVal(ded), 'Catálogo', ded.id));
  }
  if (conv.deductions) {
    const dedList = Array.isArray(conv.deductions) ? conv.deductions : Object.values(conv.deductions);
    dedList.forEach((ded) => pushDed(ded.label || ded.id, 'Retención / Contribución', fmtDedVal(ded), 'Catálogo', ded.id));
  }
  if (r.employerContributions) {
    const empList = Array.isArray(r.employerContributions) ? r.employerContributions : Object.values(r.employerContributions);
    empList.forEach((ec) => pushDed(ec.label || ec.id, 'Contribución Empleador', fmtDedVal(ec), 'Catálogo', ec.id));
  }
  if (conv.liquidationModel?.deductions) conv.liquidationModel.deductions.forEach((ded) => pushDed(ded.label || ded.id, 'Aporte Trabajador', fmtDedVal(ded), 'Catálogo', ded.id));
  if (conv.liquidationModel?.retentions) conv.liquidationModel.retentions.forEach((ret) => pushDed(ret.label || ret.id, 'Retención / Contribución', fmtDedVal(ret), 'Catálogo', ret.id));
  if (conv.liquidationModel?.employerContributions) conv.liquidationModel.employerContributions.forEach((ec) => pushDed(ec.label || ec.id, 'Contribución Empleador', fmtDedVal(ec), 'Catálogo', ec.id));
  const aportesContent = renderGuideTable(['Concepto', 'A cargo de', 'Alícuota', 'Fuente'], aportesRows);

  const ceseSource = r.ceseLaboral || r.fondoCese || conv.cese;
  const ceseRows = Array.isArray(ceseSource)
    ? ceseSource.map((c) => [c.concepto || c.label || c.motivo || '-', c.detalle || c.alicuota || c.plazo || '-'])
    : ceseSource ? [['Régimen de cese', String(ceseSource)]] : [['Sin régimen específico publicado', 'Se aplica la referencia legal general']];
  const ceseContent = renderGuideTable(['Régimen de Cese', 'Detalle'], ceseRows);

  const vacDays = r.vacationDays || {};
  const vacRows = [['Divisor vacacional', `${r.vacationDivisor || 25}`]];
  Object.entries(vacDays).forEach(([k, v]) => vacRows.push([k, `${v} días hábiles`]));
  const vacacionesContent = renderGuideTable(['Concepto', 'Detalle'], vacRows);

  const preavisoSource = r.preaviso || conv.preaviso;
  const preavisoRows = Array.isArray(preavisoSource)
    ? preavisoSource.map((p) => [p.concepto || p.motivo || p.label || '-', p.plazo || p.detalle || p.dias || '-'])
    : preavisoSource && typeof preavisoSource === 'object' ? Object.entries(preavisoSource).map(([k, v]) => [k, String(v)]) : [['Sin preaviso específico publicado', 'Se aplica referencia legal general']];
  const preavisoContent = renderGuideTable(['Concepto', 'Plazo / Detalle'], preavisoRows);

  const sacContent = renderGuideTable(['Concepto', 'Cálculo'], [['Sueldo Anual Complementario', r.sacFormula || 'Mejor remuneración semestral / 2']]);
  const insalubreContent = renderGuideTable(['Reglamentación', 'Detalle'], [['Jornada Reducida', r.insalubreWeeklyHours ? `Máximo ${r.insalubreWeeklyHours} hs semanales` : 'Según convenio / LCT']]);

  const extraItemsHtml = `
    <h3 style="margin-top: 40px; margin-bottom: 24px; font-size: 24px; color: var(--blue-primary);">Guía de Convenio</h3>
    <div class="gcol2">
      <div class="gcol-left">
        ${renderGuideSection('Zona', zoneContent)}
        ${renderGuideSection('Jornadas', jornadaContent)}
        ${renderGuideSection('Descansos', descansoContent)}
        ${renderGuideSection('Modalidad de Liquidación', modalidadContent)}
        ${renderGuideSection('Licencias Especiales', licenciasContent)}
      </div>
      <div class="gcol-right">
        ${renderGuideSection('Plus y Adicionales', plusContent)}
        ${renderGuideSection('Aportes y Contribuciones', aportesContent)}
        ${renderGuideSection('Fondo de Cese', ceseContent)}
        ${renderGuideSection('Vacaciones', vacacionesContent)}
        ${renderGuideSection('SAC / Aguinaldo', sacContent)}
        ${renderGuideSection('Preaviso', preavisoContent)}
        ${renderGuideSection('Régimen Insalubre', insalubreContent)}
      </div>
    </div>
  `;

  document.getElementById('articleBody').innerHTML = `
    <p style="font-size: 18px; color: #495057; margin-bottom: 24px; line-height: 1.6;">${desc}</p>
    
    <h3>Tablas de Categorías</h3>
    <p>El sistema comprende al personal detallado en la siguiente tabla. Podés probar todos los escenarios posibles seleccionando estas categorías en la herramienta interactiva debajo.</p>
    ${categoriesHtml}
    ${extraItemsHtml}
  `;

  // Inyectar Calculadora Widget
  const iframe = document.getElementById('calcIframe');
  iframe.src = `admin.html?widget=true&conventionId=${encodeURIComponent(convId)}`;

  iframe.onload = () => {
    try {
      const iframeDoc = iframe.contentWindow.document;
      const iframeBody = iframeDoc.body;
      const updateHeight = () => {
        const h = iframeBody.scrollHeight;
        if (h > 100) {
          iframe.style.height = h + 40 + 'px';
        }
      };
      // Forzar ajuste inicial
      setTimeout(updateHeight, 300);
      setTimeout(updateHeight, 1000);
      
      const ro = new ResizeObserver(() => {
        requestAnimationFrame(updateHeight);
      });
      ro.observe(iframeBody);
    } catch (e) {
      console.warn("No se pudo inicializar el auto-ajuste del iframe.", e);
    }
  };
});
