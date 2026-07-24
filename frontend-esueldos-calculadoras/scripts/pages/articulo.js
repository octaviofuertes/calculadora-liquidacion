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
  const r = conv.rules || {};
  const weeklyHours = r.weeklyHours || r.horasSemanales || 48;
  const dailyHoursMax = r.dailyHoursMax || r.horasDiariasMax || null;
  const nightHours = r.nightHours || r.horasNocturnas || null;
  const lunchBreakMin = r.lunchBreakMin || r.pausaComidaMin || null;
  const jornadaRows = [['Jornada Legal', `${weeklyHours} hs semanales`]];
  if (dailyHoursMax) jornadaRows.push(['Jornada diaria máxima', `${dailyHoursMax} hs`]);
  if (nightHours) jornadaRows.push(['Jornada nocturna (21:00 a 06:00)', `${nightHours} hs`]);
  if (lunchBreakMin) jornadaRows.push(['Pausa paga (jornada continua)', `${lunchBreakMin} min a la quinta hora`]);
  if (!dailyHoursMax && !nightHours) jornadaRows.push(['Límites LCT', 'Máx. 9 hs diarias o 48 hs semanales, con 12 hs mínimas de descanso entre jornadas']);
  const jornadaContent = renderGuideTable(['Concepto', 'Detalle'], jornadaRows);

  // 3. Descansos
  const extra50Mult = r.extra50Multiplier ? `${((r.extra50Multiplier - 1) * 100).toFixed(0)}%` : '50%';
  const extra100Mult = r.extra100Multiplier ? `${((r.extra100Multiplier - 1) * 100).toFixed(0)}%` : '100%';
  const holidayWorkedDetail = r.holidayWorked || 'valorDia * 2';
  const descansoContent = renderGuideTable(['Concepto', 'Detalle'], [
    ['Descanso Semanal', 'Desde el sábado a las 13:00 hs hasta el domingo a las 24:00 hs (mínimo 35 hs continuas)'],
    ['Trabajo en Descanso', 'Se abona con recargo del 100% y genera descanso compensatorio']
  ]);

  // 4. Modalidad de Liquidación
  const dayDiv = r.dayDivisor || (isMensual ? 30 : 24);
  const vacDiv2 = r.vacationDivisor || 25;
  const modalidadContent = renderGuideTable(['Concepto', 'Fórmula / Detalle'], [
    ['Modalidad', isMensual ? 'Mensualizada' : 'Jornalizada'],
    ['Valor día', `Sueldo mensual / ${dayDiv}`],
    ['Valor hora', `Valor día / ${r.hourDivisor || 8}`],
    ['Vacaciones', `Remuneración total / ${vacDiv2} por día de licencia`]
  ]);

  // 5. Liquidación por Hora y Extras
  const extrasContent = renderGuideTable(['Tipo', 'Recargo'], [
    ['Horas extra (días hábiles)', extra50Mult],
    ['Horas extra (descanso/feriado)', extra100Mult]
  ]);

  // 6. Plus y Adicionales - extrae desde todas las fuentes del CCT sin duplicados
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

  const fmtPct = (v) => v != null && v !== '' ? `${v}% s/básico` : 'Según CCT';
  const fmtAmt = (v) => v != null && v !== '' ? `$${Number(v).toLocaleString('es-AR', {minimumFractionDigits:2})}` : 'Según CCT';

  // 6a. Antigüedad (ambos formatos de reglas)
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

  // 6b. Presentismo
  const presRule = conv.rules?.presentism;
  const presPct = presRule?.percent || conv.rules?.presentismPct || 8.33;
  if (presRule?.enabled !== false) {
    const presDetail = presRule?.requiresNoUnjustifiedAbsence !== false ? 'sin ausencias injustificadas' : 'condicional';
    pushAdic('Presentismo (Asistencia y Puntualidad)', 'Remunerativo', `(Básico + Antigüedad) x ${presPct}% (${presDetail} — Art. 40)`, 'CCT 130/75', 'presentism');
    addedAdicKeys.add('presentismo');
  }

  // 6c. Conceptos del liquidationModel (genéricos y AFA-like)
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
      } else if (norm.includes('zonadesfavorable') || norm.includes('zonasur')) {
        calc = norm.includes('5') ? 'Básico x 5% — Art. 20' : 'Básico x 20% — Art. 20';
      } else if (norm.includes('manejodevalores') || norm.includes('fallacaja')) {
        calc = 'Monto de escala o Fijo anual en cuotas — Art. 30';
      } else if (norm.includes('noremunerativo') || norm.includes('incremento')) {
        calc = 'Suma fija de escala salarial vigente';
      } else if (norm.includes('kilometraje') || norm.includes('largadistancia')) {
        calc = 'Valor por km x Cantidad — Art. 36';
      } else if (norm.includes('vidriera')) {
        calc = 'Monto fijo asignado — Art. 23';
      } else if (norm.includes('reemplazo')) {
        calc = 'Diferencia remuneración cat. superior — Art. 46';
      } else {
        calc = 'Según escala salarial vigente';
      }
    }
    pushAdic(label, tipo, calc, 'CCT 130/75', concept.id);
  });

  // 6d. additionals (uocra-farmacia style)
  if (conv.additionals) {
    const adds = Array.isArray(conv.additionals) ? conv.additionals : Object.values(conv.additionals);
    adds.forEach(add => {
      let tipo = 'Remunerativo';
      if (add.type === 'non_remunerative' || add.nonRemunerative) tipo = 'No Remunerativo';
      pushAdic(add.label || add.id, tipo, add.monthly ? fmtAmt(add.monthly) : 'Según escala', 'CCT', add.id);
    });
  }

  // 6e. items de camioneros - todos los viáticos y adicionales paramétricos del CCT 40/89
  if (conv.items && conv.id === 'camioneros') {
    const items = conv.items;
    
    // Viáticos no remunerativos Art. 4.2.11 / 4.1
    if (items.comida != null) pushAdic('Comida (Art. 4.1.12)', 'No Remunerativo', `${fmtAmt(items.comida)} por día`, 'CCT 40/89', 'comida');
    if (items.viaticoEspecial != null) pushAdic('Viático especial (Art. 4.1.13)', 'No Remunerativo', `${fmtAmt(items.viaticoEspecial)} por día`, 'CCT 40/89', 'viaticoEspecial');
    if (items.pernoctada != null) pushAdic('Pernoctadas fuera de residencia (Art. 4.1.14)', 'No Remunerativo', `${fmtAmt(items.pernoctada)} por día`, 'CCT 40/89', 'pernoctada');
    if (items.permanencia != null) pushAdic('Permanencia fuera de residencia', 'No Remunerativo', `${fmtAmt(items.permanencia)} por día`, 'CCT 40/89', 'permanencia');
    if (items.simplePresencia != null) pushAdic('Simple presencia (Art. 4.2.11)', 'No Remunerativo', `${fmtAmt(items.simplePresencia)} por día`, 'CCT 40/89', 'simplePresencia');
    if (items.cruceFrontera != null) pushAdic('Cruce de frontera (Art. 4.2.11)', 'No Remunerativo', `${fmtAmt(items.cruceFrontera)} por cruce`, 'CCT 40/89', 'cruceFrontera');
    if (items.ingresoIsla != null) pushAdic('Ingreso / egreso Tierra del Fuego (Art. 4.2.11)', 'No Remunerativo', `${fmtAmt(items.ingresoIsla)} por viaje`, 'CCT 40/89', 'ingresoIsla');
    if (items.kmViatico != null) {
      pushAdic('Viático por km (Art. 4.2.4 / 4.2.11)', 'No Remunerativo', `${fmtAmt(items.kmViatico)} por km`, 'CCT 40/89', 'kmViatico');
      pushAdic('Viático por km manual (Art. 4.2.4)', 'No Remunerativo', `${fmtAmt(items.kmViatico)} por km`, 'CCT 40/89', 'kmViaticoManual');
    }

    // Adicionales remunerativos por km, día y fijos
    if (items.kmExtra != null) {
      pushAdic('Horas extraordinarias por km (Art. 4.2.3)', 'Remunerativo', `${fmtAmt(items.kmExtra)} por km`, 'CCT 40/89', 'kmExtra');
      pushAdic('Km sab / dom / feriado 100% (Art. 4.2.3)', 'Remunerativo', `${fmtAmt(items.kmExtra * 2)} por km (recargo 100%)`, 'CCT 40/89', 'kmWeekend');
    }
    if (items.plusVacacionalDia != null) pushAdic('Plus vacacional por día (Art. 3.3.2)', 'Remunerativo', `${fmtAmt(items.plusVacacionalDia)} por día`, 'CCT 40/89', 'plusVacacionalDia');
    if (items.bitrenes != null) pushAdic('Adicional bitrenes', 'Remunerativo', fmtAmt(items.bitrenes), 'CCT 40/89', 'bitrenes');
    pushAdic('Día del trabajador camionero (15 de diciembre)', 'Remunerativo', `${fmtAmt(items.plusVacacionalDia || 0)} x 2 jornales`, 'CCT 40/89', 'camDriverDay');

    // Adicionales por rama y especialidad (% desde items del CCT)
    const camRemPct = {
      choferLargaDistanciaPct: 'Chofer larga distancia',
      lacteaPct: 'Transporte materia prima láctea',
      auxilioPct: 'Conductor de auxilio',
      blindadoPct: 'Unidades blindadas',
      combustiblesPct: 'Transporte de combustibles',
      peligrosasPct: 'Sustancias peligrosas',
      pozosPetroliferosPct: 'Pozos petrolíferos',
      pluralidadGrupoIPct: 'Pluralidad taller Grupo I/III',
      pluralidadGrupoIIPct: 'Pluralidad taller Grupo II',
      diariosRevistasPct: 'Distribución diarios y revistas',
      logisticaPct: 'Logística / almacenamiento',
      camaraFrioPct: 'Cámara de frío'
    };
    Object.entries(camRemPct).forEach(([key, label]) => {
      if (items[key] != null) pushAdic(label, 'Remunerativo', `${items[key]}% s/básico`, 'CCT 40/89', key);
    });
  }
  // 6e. Adicionales especiales de farmacia leidos desde rules (CCT 429/2005 Art. 18)
  if (conv.id === 'farmacia' && r) {
    const farmAdics = [
      { key: 'cajeroPct',              label: 'Adicional cajero',                      art: 'Art. 18 inc. c', base: 'Básico + Antigüedad' },
      { key: 'tareasAdministrativasPct', label: 'Adicional tareas administrativas',     art: 'Art. 18 inc. d', base: 'Básico + Antigüedad' },
      { key: 'adminTenurePctOver2Years', label: 'Adicional administrativo (≥2 años)',   art: 'Art. 18 inc. d', base: 'Básico + Antigüedad' },
      { key: 'perfumeriaPct',          label: 'Adicional perfumería',                  art: 'Art. 18 inc. e', base: 'Básico + Antigüedad' },
      { key: 'languagePct',            label: 'Adicional idioma extranjero',           art: 'Art. 18 inc. f', base: 'Cat. Inicial A + Antigüedad' },
      { key: 'bikePct',                label: 'Uso bicicleta / ciclomotor / moto',     art: 'Art. 18 inc. g', base: 'Básico + Antigüedad' },
      { key: 'auxTitlePct',            label: 'Título auxiliar de farmacia',           art: 'Art. 18 inc. h', base: 'Empleado 1ra + Antigüedad' },
      { key: 'tituloFarmaceuticoPct',  label: 'Adicional título farmacéutico',        art: 'Art. 18 inc. a', base: 'Cat. Inicial A + Antigüedad' },
      { key: 'adscripcionPct',         label: 'Adicional adscripción',                art: 'Art. 18 inc. a', base: 'Cat. Inicial A + Antigüedad' },
      { key: 'bloqueoTituloPct',       label: 'Dirección técnica con bloqueo',        art: 'Art. 18 inc. b', base: 'Cat. Inicial A + Antigüedad' },
      { key: 'fallaCajaPct',           label: 'Fondo compensador falla de caja',      art: 'Art. 19',        base: 'Básico' }
    ];
    farmAdics.forEach(({ key, label, art, base }) => {
      const pct = r[key];
      if (pct != null) pushAdic(label, 'Remunerativo', `${pct}% s/${base} — ${art}`, 'CCT 429/2005', key);
    });
    if (r.nightPct != null) pushAdic('Jornada laboral nocturna', 'Remunerativo', `${r.nightPct}% de recargo`, 'CCT 429/2005 Art. 16-17', 'nightPct');
  }

  // 6f. Adicionales de Comercio (CCT 130/75) leidos desde rules
  if ((conv.id === 'comercio' || conv.id === 'EMPLEADOS_DE_COMERCIO') && r) {
    if (r.zonaSurChubutSantaCruzTdfPct != null) pushAdic('Zona Desfavorable 20%', 'Remunerativo', `Básico x 20% (Art. 20)`, 'CCT 130/75', 'zonaSurChubut');
    if (r.zonaSurRioNegroNeuquenPct != null)    pushAdic('Zona Desfavorable 5%', 'Remunerativo', `Básico x 5% (Art. 20)`, 'CCT 130/75', 'zonaSurRioNegro');
    pushAdic('Horas extra 50%', 'Remunerativo', '(Sueldo / 200) x 1,5 x Horas (Art. 48)', 'CCT 130/75', 'extra50');
    pushAdic('Horas extra 100%', 'Remunerativo', '(Sueldo / 200) x 2 x Horas (Art. 48)', 'CCT 130/75', 'extra100');
    pushAdic('Adicional por manejo de valores', 'Remunerativo', 'Monto de escala o Fijo anual en cuotas (Art. 30)', 'CCT 130/75', 'manejoValores');
    pushAdic('Adicional por kilometraje (larga distancia)', 'Remunerativo', 'Valor por km x Cantidad (Art. 36)', 'CCT 130/75', 'choferesLargaDistancia');
    pushAdic('Armado de vidrieras', 'Remunerativo', 'Monto fijo asignado por vidriera (Art. 23)', 'CCT 130/75', 'armadoVidrieras');
    pushAdic('Reemplazo categoría superior', 'Remunerativo', 'Diferencia remuneración cat. superior (Art. 46)', 'CCT 130/75', 'reemplazoCatSuperior');
  }


  const plusContent = adicRows.length > 0
    ? renderGuideTable(['Adicional / Concepto', 'Tipo', 'Cálculo', 'Fuente'], adicRows)
    : renderGuideTable(['Aviso'], [['No hay adicionales específicos del CCT', '-']]);

  // 7. Licencias Especiales — se leen del CCT; si no hay, se usa la LCT como fallback
  let licenciasRows;
  const cctLics = r.licencias || conv.licencias || [];
  if (cctLics.length > 0) {
    licenciasRows = cctLics.map(l => [l.motivo, `${l.dias} día${l.dias !== 1 ? 's' : ''}${l.articulo ? ' (' + l.articulo + ')' : ''}`]);
    const licDiv = r.vacationDivisor || 25;
    licenciasRows.push(['Cálculo del Pago', `Se abonan dividiendo el sueldo mensual por ${licDiv}`]);
  } else {
    licenciasRows = [
      ['Nacimiento de hijo', '2 días corridos (LCT Art. 158)'],
      ['Matrimonio', '10 días corridos (LCT Art. 158)'],
      ['Fallecimiento de cónyuge, concubino, hijos o padres', '3 días corridos (LCT Art. 158)'],
      ['Fallecimiento de hermano', '1 día (LCT Art. 158)'],
      ['Para rendir examen', '2 días corridos por examen — máx. 10 días/año (LCT Art. 158)'],
      ['Cálculo del Pago', 'Se abonan dividiendo el sueldo mensual por 25 (LCT Art. 155)']
    ];
  }
  const licenciasContent = renderGuideTable(['Motivo de Licencia', 'Plazo / Duración'], licenciasRows);

  // 8. Aportes y Contribuciones - extrae desde todas las fuentes sin duplicados
  const aportesRows = [
    ['Jubilación (SIPA)', 'Aporte Trabajador', '11%', 'Ley 24.241'],
    ['PAMI (Ley 19.032)', 'Aporte Trabajador', '3%', 'Ley 19.032'],
    ['Obra Social', 'Aporte Trabajador', '3%', 'Ley 23.660']
  ];
  const addedDedKeys = new Set([
    'jubilacionsipa', 'jubilacion', 'sipa',
    'pamiley19032', 'pami', 'ley19032',
    'obrasocial', 'os'
  ]);

  const pushDed = (label, cargo, alicuota, fuente, id) => {
    const keyLabel = cleanNorm(label);
    const keyId = cleanNorm(id);
    if ((keyLabel && addedDedKeys.has(keyLabel)) || (keyId && addedDedKeys.has(keyId))) return;
    if (keyLabel) addedDedKeys.add(keyLabel);
    if (keyId) addedDedKeys.add(keyId);
    aportesRows.push([label, cargo, alicuota, fuente]);
  };

  const fmtDedVal = (d) => {
    if (d.percent != null && Number(d.percent) > 0) return `${d.percent}%`;
    if (d.amount != null && Number(d.amount) > 0) return fmtAmt(d.amount);

    const match = String(d.label || d.id || '').match(/(\d+(?:[.,]\d+)?)\s*%/);
    if (match) return `${match[1]}%`;

    const norm = cleanNorm(d.label || d.id || '');
    if (norm.includes('solidaria') || norm.includes('solidario') || norm.includes('sindicat') || norm.includes('sec')) {
      return `${r.secSolidarioPct || r.adefSolidarityPct || r.unionPct || 2}%`;
    }
    if (norm.includes('obrasocial') || norm.includes('os') || norm.includes('osecac')) {
      return `${r.osecacAdicionalPct || 0.5}%`;
    }
    if (norm.includes('faecys')) return `${r.faecysPct || 0.5}%`;
    if (norm.includes('estrella')) return `${r.laEstrellaPct || 3.5}%`;
    if (norm.includes('pami') || norm.includes('19032')) return '3%';
    if (norm.includes('jubilacion') || norm.includes('sipa')) return '11%';

    return '2%';
  };

  // deductions de rules.workerDeductions (farmacia / comercio / convenios estructurados)
  if (r.workerDeductions) {
    const deds = Array.isArray(r.workerDeductions) ? r.workerDeductions : Object.values(r.workerDeductions);
    deds.forEach(ded => {
      pushDed(ded.label || ded.id, 'Aporte Trabajador', fmtDedVal(ded), 'CCT', ded.id);
    });
  }

  // Deducciones específicas de reglas de Farmacia (CCT 429/2005)
  if (conv.id === 'farmacia' && r) {
    if (r.adefSolidarityPct != null) pushDed('Aporte solidario ADEF', 'Aporte Trabajador', `${r.adefSolidarityPct}%`, 'CCT 429/2005 Art. 46', 'adefSolidarity');
    if (r.unionPct != null)          pushDed('Cuota sindical ADEF (afiliados)', 'Aporte Trabajador', `${r.unionPct}%`, 'CCT 429/2005', 'unionPct');
    if (r.cajaCompensadoraPct != null) pushDed('Aporte asistencia social ADEF (Jun/Dic)', 'Aporte Trabajador', `${r.cajaCompensadoraPct}%`, 'CCT 429/2005 Art. 46', 'cajaCompensadora');
    if (r.cajaCompensadoraPct != null) pushDed('Caja compensadora', 'Aporte Trabajador', `${r.cajaCompensadoraPct}%`, 'CCT 429/2005', 'cajaCompensadoraReg');
    if (r.proEdificioPct != null)     pushDed('Pro edificio ADEF', 'Aporte Trabajador', `${r.proEdificioPct}%`, 'CCT 429/2005', 'proEdificio');
    if (conv.extraordinaryContribution) pushDed('Contribución extraordinaria', 'Aporte Trabajador / Empleador', 'Según escala', 'CCT 429/2005', 'extraordinaryContribution');
  }

  // Deducciones específicas de reglas de Comercio (CCT 130/75)
  if ((conv.id === 'comercio' || conv.id === 'EMPLEADOS_DE_COMERCIO') && r) {
    if (r.secSolidarioPct != null)    pushDed('Aporte Solidario Sindical (SEC)', 'Aporte Trabajador', `${r.secSolidarioPct}%`, 'CCT 130/75', 'secSolidario');
    if (r.faecysPct != null)          pushDed('Aporte FAECYS', 'Aporte Trabajador', `${r.faecysPct}%`, 'CCT 130/75', 'faecys');
    if (r.osecacAdicionalPct != null) pushDed('Aporte Adicional OSECAC', 'Contribución Empleador', `${r.osecacAdicionalPct}%`, 'CCT 130/75', 'osecacAdicional');
    if (r.laEstrellaPct != null)      pushDed('Seguro Retiro La Estrella', 'Contribución Empleador', `${r.laEstrellaPct}%`, 'CCT 130/75', 'laEstrella');
  }

  // deductions del formato simple (camioneros data.js / local)
  if (conv.deductions && !Array.isArray(conv.deductions)) {
    Object.values(conv.deductions).forEach(ded => {
      pushDed(ded.label || ded.id, 'Aporte Sindical / Retención', fmtDedVal(ded), 'CCT', ded.id);
    });
  } else if (Array.isArray(conv.deductions)) {
    conv.deductions.forEach(ded => {
      pushDed(ded.label || ded.id, 'Aporte Sindical / Retención', fmtDedVal(ded), 'CCT', ded.id);
    });
  }

  // deductions del liquidationModel (AFA / genérico)
  (conv.liquidationModel?.deductions || []).forEach(ded => {
    pushDed(ded.label || ded.id, 'Aporte Sindical / Retención', fmtDedVal(ded), 'CCT', ded.id);
  });
  (conv.liquidationModel?.retentions || []).forEach(ret => {
    pushDed(ret.label || ret.id, 'Retención / Contribución', fmtDedVal(ret), 'CCT', ret.id);
  });
  (conv.liquidationModel?.employerContributions || []).forEach(ec => {
    pushDed(ec.label || ec.id, 'Contribución Empleador', fmtDedVal(ec), 'CCT', ec.id);
  });

  const aportesContent = renderGuideTable(['Concepto', 'A cargo de', 'Alícuota', 'Fuente'], aportesRows);

  // 9. Régimen de Cese / Indemnización
  const cctCese = r.ceseLaboral || r.fondoCese || conv.cese;
  let ceseRows;
  if (cctCese && Array.isArray(cctCese)) {
    ceseRows = cctCese.map(c => [c.concepto || c.label || c.motivo, c.detalle || c.alicuota || c.plazo]);
  } else if (cctCese && typeof cctCese === 'string') {
    ceseRows = [['Fondo / Régimen de Cese', cctCese]];
  } else {
    ceseRows = [['Indemnización por Despido (LCT Art. 245)', '1 mes de sueldo por cada año de servicio o fracción mayor a 3 meses']];
  }
  const ceseContent = renderGuideTable(['Régimen de Cese', 'Detalle'], ceseRows);

  // 10. Vacaciones
  const vacDiv = r.vacationDivisor || 25;
  const vacDays = r.vacationDays || {};
  const vacRows = [['Divisor vacacional', `${vacDiv} (valor día = rem. total / ${vacDiv})`]];
  if (vacDays.hasta5)  vacRows.push(['Hasta 5 años antigüedad', `${vacDays.hasta5} días hábiles`]);
  if (vacDays.hasta10) vacRows.push(['5 a 10 años', `${vacDays.hasta10} días hábiles`]);
  if (vacDays.hasta20) vacRows.push(['10 a 20 años', `${vacDays.hasta20} días hábiles`]);
  if (vacDays.mas20)   vacRows.push(['Más de 20 años', `${vacDays.mas20} días hábiles`]);
  if (vacRows.length === 1) vacRows.push(['Licencia Anual Ordinaria', 'Según antigüedad (LCT Art. 150)']);
  const vacacionesContent = renderGuideTable(['Concepto', 'Detalle'], vacRows);

  // Preaviso — leer del CCT si existe, sino LCT
  const cctPreaviso = r.preaviso || conv.preaviso;
  let preavisoRows;
  if (cctPreaviso && Array.isArray(cctPreaviso)) {
    preavisoRows = cctPreaviso.map(p => [p.concepto || p.motivo || p.label, p.plazo || p.detalle || p.dias]);
  } else if (cctPreaviso && typeof cctPreaviso === 'object') {
    preavisoRows = Object.entries(cctPreaviso).map(([k, v]) => [k, v]);
  } else {
    preavisoRows = [
      ['Período de Prueba', '15 días de preaviso (LCT Art. 92 bis)'],
      ['Antigüedad menor a 5 años', '1 mes (30 días) de preaviso (LCT Art. 231)'],
      ['Antigüedad mayor a 5 años', '2 meses (60 días) de preaviso (LCT Art. 231)']
    ];
  }
  const preavisoContent = renderGuideTable(['Concepto', 'Plazo / Detalle'], preavisoRows);

  // 11. SAC
  const sacFormula = r.sacFormula || 'Mejor remuneración semestral / 2';
  const sacContent = renderGuideTable(['Concepto', 'Cálculo'], [['Sueldo Anual Complementario', sacFormula.includes('/') ? sacFormula : 'Mejor remuneración devengada del semestre / 2 o proporcional']]);

  // Tareas Insalubres
  const insalLimit = r.insalubreWeeklyHours || r.insalubreHours || 36;
  const insalubreContent = renderGuideTable(['Reglamentación', 'Detalle'], [['Jornada Reducida', `Máximo 6 hs diarias (${insalLimit} hs semanales) cuando se declara insalubre (LCT Art. 200)`]]);

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
