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
        // Merge: use backend conventions list but preserve local fields (scales, additionals, rules)
        // that the backend normalization discards
        if (apiData && apiData.conventions) {
          const merged = { ...apiData };
          merged.conventions = { ...apiData.conventions };
          Object.keys(merged.conventions).forEach(id => {
            const local = localData?.conventions?.[id];
            if (local) {
              const backendConv = merged.conventions[id];
              // Detect if backend categories have empty period data (no actual salary values)
              const backendCatsEmpty = (backendConv.categories || []).every(c =>
                !c.monthly && !c.day && !c.hourly &&
                Object.keys(c.monthlyByPeriod || {}).length === 0 &&
                Object.keys(c.dayByPeriod || {}).length === 0 &&
                Object.keys(c.hourlyByPeriod || {}).length === 0
              );
              // Use local categories when: local has scales (UOCRA-style) OR backend cats are empty
              const useLocalCats = local.scales || (backendCatsEmpty && local.categories);
              merged.conventions[id] = {
                ...backendConv,
                scales: local.scales ?? backendConv.scales,
                nonRem: local.nonRem ?? backendConv.nonRem,
                additionals: local.additionals ?? backendConv.additionals,
                rules: local.rules ?? backendConv.rules,
                deductions: local.deductions ?? backendConv.deductions,
                categories: useLocalCats ? local.categories : backendConv.categories,
                zones: local.scales ? (local.zones ?? backendConv.zones) : backendConv.zones,
                periods: local.scales ? (local.periods ?? backendConv.periods) : backendConv.periods,
              };
            }
          });
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

  const conv = data.conventions[convId];
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
                      const byPeriod = c.hourlyByPeriod?.[p.id] || c.dayByPeriod?.[p.id] || c.monthlyByPeriod?.[p.id] || {};
                      const zoneKey = Object.keys(byPeriod).find(k => k.toLowerCase() === (zone.id || '').toLowerCase()) || Object.keys(byPeriod)[0];
                      const val = zoneKey ? byPeriod[zoneKey] : undefined;
                      if (val !== undefined && val !== 0) {
                        salary = "$" + Number(val).toLocaleString('es-AR', {minimumFractionDigits: 2});
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
  const isUocra = conv.id === 'uocra' || conv.id === 'uocraBasic';
  const isMensual = conv.type === 'monthly';

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

  // 1. Zona
  const guideZones = conv.zones && conv.zones.length > 0 ? conv.zones : [{ id: 'general', label: 'General / Todo el país' }];
  const zoneContent = renderGuideTable(['Zona', 'Descripción / Detalle'], guideZones.map(z => [z.label || z.id, z.detail || 'Aplica a todo el territorio especificado.']));

  // 2. Jornadas
  const hours = conv.rules?.weeklyHours || 48;
  const jornadaContent = renderGuideTable(['Concepto', 'Detalle'], [['Jornada Legal', `${hours} hs semanales`], ['Límites LCT', 'Máx. 9 hs diarias o 48 hs semanales, con 12 hs mínimas de descanso entre jornadas']]);

  // 3. Descansos
  const descansoContent = renderGuideTable(['Concepto', 'Detalle'], [['Descanso Semanal', 'Desde el sábado a las 13:00 hs hasta el domingo a las 24:00 hs (mínimo 35 hs continuas)'], ['Trabajo en Descanso', 'Se abona con recargo del 100% y genera descanso compensatorio']]);

  // 4. Modalidad de Liquidación
  const modalidadContent = renderGuideTable(['Modalidad Principal', 'Divisor / Cálculo'], [
    [isMensual ? 'Mensualizada' : 'Jornalizada/Horaria', isMensual ? 'Valor mensual según escala' : 'Valor hora = Remuneración / Divisor de horas']
  ]);

  // 5. Liquidación por Hora y Extras
  const extrasContent = renderGuideTable(['Tipo de Día', 'Recargo legal'], [
    ['Días hábiles (excedentes)', '50%'],
    ['Descansos o feriados', '100%']
  ]);

  // 6. Plus y Adicionales - extrae desde todas las fuentes del CCT
  const adicRows = [];
  const addedConceptIds = new Set();
  const fmtPct = (v) => v != null && v !== '' ? `${v}% s/básico` : 'Según CCT';
  const fmtAmt = (v) => v != null && v !== '' ? `$${Number(v).toLocaleString('es-AR', {minimumFractionDigits:2})}` : 'Según CCT';

  // 6a. Antigüedad (ambos formatos de reglas)
  const senRule = conv.rules?.seniority;
  const senPct = senRule?.percentPerYear || senRule?.percent || conv.rules?.seniorityPct;
  if (senRule?.enabled !== false && senPct) {
    adicRows.push(['Antigüedad', 'Remunerativo', `${senPct}% por año de servicio`, 'CCT']);
    addedConceptIds.add('seniority'); addedConceptIds.add('antiguedad');
  }

  // 6b. Presentismo
  const presRule = conv.rules?.presentism;
  const presPct = presRule?.percent || conv.rules?.presentismPct;
  if (presRule?.enabled !== false && presPct) {
    const presDetail = presRule?.requiresNoUnjustifiedAbsence !== false ? 'Sin ausencias injustificadas' : 'Condicional';
    adicRows.push(['Presentismo', 'Remunerativo', `${presPct}% — ${presDetail}`, 'CCT']);
    addedConceptIds.add('presentism'); addedConceptIds.add('presentismo');
  }

  // 6c. Conceptos del liquidationModel (genéricos y AFA-like)
  const lmConcepts = [...(conv.liquidationModel?.concepts || []), ...(conv.liquidationModel?.nonRemunerative || [])];
  lmConcepts.forEach(concept => {
    const idStr = (concept.id || '').toLowerCase();
    if (addedConceptIds.has(idStr)) return;
    let tipo = 'Remunerativo';
    if (concept.rowType === 'nonRemunerative' || concept.rowType === 'non_remunerative') tipo = 'No Remunerativo';
    if (concept.rowType === 'deduction') return; // va en deducciones
    let calc = '';
    if (concept.calculation === 'percent' || concept.percent) calc = fmtPct(concept.percent);
    else if (concept.calculation === 'fixed' || concept.amount) calc = fmtAmt(concept.amount);
    else if (concept.calculation === 'amountPerUnit') calc = 'Por unidad (ver escala)';
    else calc = 'Según fórmula CCT';
    adicRows.push([concept.label || concept.id, tipo, calc, 'CCT']);
    addedConceptIds.add(idStr);
  });

  // 6d. additionals (uocra-farmacia style)
  if (conv.additionals) {
    Object.values(conv.additionals).forEach(add => {
      const idStr = (add.id || add.label || '').toLowerCase();
      if (addedConceptIds.has(idStr)) return;
      let tipo = 'Remunerativo';
      if (add.type === 'non_remunerative' || add.nonRemunerative) tipo = 'No Remunerativo';
      adicRows.push([add.label || add.id, tipo, add.monthly ? fmtAmt(add.monthly) : 'Según escala', 'CCT']);
      addedConceptIds.add(idStr);
    });
  }

  // 6e. items de camioneros - no remunerativos (viáticos/adicionales específicos)
  if (conv.items) {
    const camNoRem = {
      comida: 'Comida (Art. 4.1.12)', viaticoEspecial: 'Viático especial (Art. 4.1.13)',
      pernoctada: 'Pernoctada (Art. 4.1.14)', permanencia: 'Permanencia fuera de residencia',
      simplePresencia: 'Simple presencia', cruceFrontera: 'Cruce de frontera',
      ingresoIsla: 'Ingreso/egreso Tierra del Fuego', kmViatico: 'Km viático por km'
    };
    const camRem = {
      kmExtra: 'Horas extraordinarias por km (Art. 4.2.3)',
      plusVacacionalDia: 'Plus vacacional por día (Art. 3.3.2)',
      bitrenes: 'Adicional bitrenes'
    };
    const camRemPct = {
      choferLargaDistanciaPct: ['Chofer larga distancia', 10],
      lacteaPct: ['Materia prima láctea', 15],
      auxilioPct: ['Conductor auxilio', 10],
      blindadoPct: ['Unidades blindadas', 20],
      combustiblesPct: ['Combustibles', 15],
      peligrosasPct: ['Sustancias peligrosas', 20],
      pozosPetroliferosPct: ['Pozos petrolíferos', 40],
      pluralidadGrupoIPct: ['Pluralidad taller I/III', 25],
      pluralidadGrupoIIPct: ['Pluralidad taller II', 18],
      diariosRevistasPct: ['Diarios y revistas', 12],
      logisticaPct: ['Logística', 18],
      camaraFrioPct: ['Cámara frío', 20]
    };
    Object.entries(camNoRem).forEach(([key, label]) => {
      if (conv.items[key] != null) adicRows.push([label, 'No Remunerativo', fmtAmt(conv.items[key]), 'CCT 40/89']);
    });
    Object.entries(camRem).forEach(([key, label]) => {
      if (conv.items[key] != null) adicRows.push([label, 'Remunerativo', fmtAmt(conv.items[key]), 'CCT 40/89']);
    });
    Object.entries(camRemPct).forEach(([key, [label, pct]]) => {
      if (conv.items[key] != null) adicRows.push([label, 'Remunerativo', `${conv.items[key] ?? pct}% s/básico`, 'CCT 40/89']);
    });
  }

  const plusContent = adicRows.length > 0
    ? renderGuideTable(['Adicional / Concepto', 'Tipo', 'Cálculo', 'Fuente'], adicRows)
    : renderGuideTable(['Aviso'], [['No hay adicionales específicos del CCT', '-']]);

  // 7. Licencias Especiales
  const licenciasRows = [
    ['Nacimiento de hijo', '2 días corridos'],
    ['Matrimonio', '10 días corridos'],
    ['Fallecimiento de cónyuge, concubino, hijos o padres', '3 días corridos'],
    ['Fallecimiento de hermano', '1 día'],
    ['Para rendir examen (enseñanza media/universitaria)', '2 días corridos por examen (máx. 10 días/año)'],
    ['Cálculo del Pago', 'Se abonan dividiendo el sueldo mensual por 25 (Art. 155 LCT)']
  ];
  const licenciasContent = renderGuideTable(['Motivo de Licencia (LCT Art. 158)', 'Plazo / Duración'], licenciasRows);

  // 8. Aportes y Contribuciones - extrae desde todas las fuentes
  const aportesRows = [
    ['Jubilación (SIPA)', 'Aporte Trabajador', '11%', 'Ley 24.241'],
    ['PAMI (Ley 19.032)', 'Aporte Trabajador', '3%', 'Ley 19.032'],
    ['Obra Social', 'Aporte Trabajador', '3%', 'Ley 23.660']
  ];
  const addedDedIds = new Set(['jubilacion', 'sipa', 'pami', 'obrasocial', 'obra_social', 'os', 'obra social']);

  const pushDed = (label, cargo, alicuota, fuente, id) => {
    const key = (id || label || '').toLowerCase().replace(/\s+/g,'_');
    if (addedDedIds.has(key)) return;
    addedDedIds.add(key);
    aportesRows.push([label, cargo, alicuota, fuente]);
  };

  // deductions del formato simple (camioneros data.js / local)
  if (conv.deductions && !Array.isArray(conv.deductions)) {
    Object.values(conv.deductions).forEach(ded => {
      const val = ded.percent != null ? `${ded.percent}%` : (ded.amount ? fmtAmt(ded.amount) : 'Variable');
      pushDed(ded.label || ded.id, 'Aporte Sindical / Retención', val, 'CCT', ded.id);
    });
  } else if (Array.isArray(conv.deductions)) {
    conv.deductions.forEach(ded => {
      const val = ded.percent != null ? `${ded.percent}%` : 'Variable';
      pushDed(ded.label || ded.id, 'Aporte Sindical / Retención', val, 'CCT', ded.id);
    });
  }

  // deductions del liquidationModel (AFA / genérico)
  (conv.liquidationModel?.deductions || []).forEach(ded => {
    const val = ded.percent != null ? `${ded.percent}%` : (ded.amount ? fmtAmt(ded.amount) : 'Variable');
    pushDed(ded.label || ded.id, 'Aporte Sindical / Retención', val, 'CCT', ded.id);
  });
  (conv.liquidationModel?.retentions || []).forEach(ret => {
    const val = ret.percent != null ? `${ret.percent}%` : 'Variable';
    pushDed(ret.label || ret.id, 'Retención / Contribución', val, 'CCT', ret.id);
  });
  (conv.liquidationModel?.employerContributions || []).forEach(ec => {
    const val = ec.percent != null ? `${ec.percent}%` : 'Variable';
    pushDed(ec.label || ec.id, 'Contribución Empleador', val, 'CCT', ec.id);
  });

  // Aportes sindicales específicos de camioneros desde items
  if (conv.id === 'camioneros') {
    pushDed('Cuota sindical (Camioneros)', 'Aporte Trabajador', '2%', 'CCT 40/89', 'cuota_sindical');
    pushDed('Contribución solidaria', 'Aporte Trabajador', '3%', 'CCT 40/89', 'solidaria');
    pushDed('Seguro sepelio', 'Aporte Trabajador', '1,5%', 'CCT 40/89', 'sepelio');
  }

  const aportesContent = renderGuideTable(['Concepto', 'A cargo de', 'Alícuota', 'Fuente'], aportesRows);

  // 9. Régimen de Cese
  const ceseContent = renderGuideTable(['Régimen General', 'Detalle'], [['Indemnización por Despido', '1 mes de sueldo (mejor remuneración normal y habitual) por cada año de servicio o fracción mayor a 3 meses']]);

  // 10. Vacaciones
  const vacDiv = conv.rules?.vacationDivisor || 25;
  const vacacionesContent = renderGuideTable(['Concepto', 'Cálculo'], [['Licencia Anual Ordinaria', `Plus vacacional calculado con divisor ${vacDiv}`]]);

  // 10. Preaviso
  const preavisoContent = renderGuideTable(['Concepto', 'Plazo / Detalle'], [['Período de Prueba', '15 días de preaviso'], ['Antigüedad menor a 5 años', '1 mes (30 días) de preaviso'], ['Antigüedad mayor a 5 años', '2 meses (60 días) de preaviso']]);

  // 11. SAC o Aguinaldo
  const sacContent = renderGuideTable(['Concepto', 'Cálculo'], [['Sueldo Anual Complementario', 'Mejor remuneración devengada del semestre / 2 o proporcional']]);

  // 13. Tareas Insalubres o Régimen Especial
  const insalLimit = conv.rules?.insalubreWeeklyHours || 36;
  const insalubreContent = renderGuideTable(['Reglamentación', 'Detalle'], [['Jornada Reducida', `Máximo 6hs diarias (${insalLimit} semanales) en caso de declararse insalubre`]]);

  let extraItemsHtml = `
    <h3 style="margin-top: 40px; margin-bottom: 24px; font-size: 24px; color: var(--blue-primary);">Guía Paramétrica de Convenio</h3>
    <div class="gcol2">
      <div class="gcol-left">
        ${renderGuideSection('Zona', zoneContent)}
        ${renderGuideSection('Jornadas', jornadaContent)}
        ${renderGuideSection('Descansos', descansoContent)}
        ${renderGuideSection('Modalidad de Liquidación', modalidadContent)}
        ${renderGuideSection('Liquidación por Hora', extrasContent)}
        ${renderGuideSection('Licencias Especiales', licenciasContent)}
      </div>
      <div class="gcol-right">
        ${renderGuideSection('Plus y Adicionales', plusContent)}
        ${renderGuideSection('Aportes y Contribuciones', aportesContent)}
        ${renderGuideSection('Fondo de Desempleo / Cese', ceseContent)}
        ${renderGuideSection('Vacaciones', vacacionesContent)}
        ${renderGuideSection('SAC / Aguinaldo', sacContent)}
        ${renderGuideSection('Preaviso e Indemnización', preavisoContent)}
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
