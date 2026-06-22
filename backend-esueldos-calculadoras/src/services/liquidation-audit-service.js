function amount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function sumAmounts(rows = []) {
  return rows.reduce((total, row) => total + amount(row?.amount), 0);
}

function moneyDiff(left, right) {
  return Math.abs(amount(left) - amount(right));
}

function auditFinding(severity, title, detail, action, code) {
  return { severity, title, detail, action, code };
}

function parseJsonObject(text) {
  const raw = String(text || "").trim();
  const unfenced = raw
    .replace(/^`{3,}\s*(?:json)?\s*/i, "")
    .replace(/\s*`{3,}\s*$/i, "")
    .trim();
  const fenced = unfenced.match(/`{3,}\s*(?:json)?\s*([\s\S]*?)`{3,}/i);
  const source = fenced ? fenced[1].trim() : unfenced;
  const first = source.indexOf("{");
  const last = source.lastIndexOf("}");
  const candidate = first >= 0 && last > first ? source.slice(first, last + 1) : source;
  return JSON.parse(candidate);
}

function deterministicLiquidationAudit({ liquidation, activeScale }) {
  const findings = [];
  const checklist = [];
  const totals = liquidation?.totals || {};
  const remRows = liquidation?.remunerative || liquidation?.remRows || [];
  const noRemRows = liquidation?.nonRemunerative || liquidation?.noRemRows || [];
  const deductionRows = liquidation?.deductions || liquidation?.deductionRows || [];
  const employerRows = liquidation?.employer || liquidation?.employerRows || [];
  const details = liquidation?.details || [];
  const employee = liquidation?.employee || {};
  const conventionId = liquidation?.conventionId || liquidation?.convention || "";
  const tolerance = 1.5;

  const remTotal = sumAmounts(remRows);
  const noRemTotal = sumAmounts(noRemRows);
  const deductions = sumAmounts(deductionRows);
  const employerContribs = sumAmounts(employerRows);
  const gross = remTotal + noRemTotal;
  const net = gross - deductions;
  const employerCost = gross + employerContribs;

  const checks = [
    ["Total remunerativo", remTotal, totals.remTotal],
    ["Total no remunerativo", noRemTotal, totals.noRemTotal],
    ["Bruto", gross, totals.gross],
    ["Deducciones", deductions, totals.deductions],
    ["Neto", net, totals.net],
    ["Costo empleador", employerCost, totals.employerCost]
  ];

  checks.forEach(([label, calculated, declared]) => {
    const ok = moneyDiff(calculated, declared) <= tolerance;
    checklist.push({
      item: label,
      status: ok ? "ok" : "revisar",
      note: ok ? "Coincide con la suma de conceptos." : `Calculado ${calculated.toFixed(2)} vs informado ${amount(declared).toFixed(2)}.`
    });
    if (!ok) {
      findings.push(auditFinding(
        "alta",
        `${label} no coincide`,
        `La suma interna da ${calculated.toFixed(2)} y el recibo informa ${amount(declared).toFixed(2)}.`,
        "Revisar conceptos manuales, redondeos o una modificacion posterior al calculo.",
        "TOTAL_MISMATCH"
      ));
    }
  });

  if (!employee.name || employee.name === "Sin nombre") {
    findings.push(auditFinding("media", "Falta nombre del trabajador", "El recibo quedo sin identificacion completa.", "Completar trabajador antes de emitir o guardar.", "MISSING_EMPLOYEE_NAME"));
  }
  if (!employee.cuil || employee.cuil === "-") {
    findings.push(auditFinding("media", "Falta CUIL", "El CUIL es necesario para una liquidacion trazable.", "Completar CUIL del trabajador.", "MISSING_CUIL"));
  }
  if (!employee.entryDate || employee.entryDate === "-") {
    findings.push(auditFinding("media", "Falta fecha de ingreso", "La antiguedad puede quedar mal calculada si no hay fecha de ingreso.", "Completar fecha de ingreso y recalcular.", "MISSING_ENTRY_DATE"));
  }

  if (activeScale) {
    checklist.push({
      item: "Escala vigente aprobada",
      status: "ok",
      note: `${activeScale.periodLabel || activeScale.period} aprobada${activeScale.approvedAt ? ` el ${new Date(activeScale.approvedAt).toLocaleDateString("es-AR")}` : ""}.`
    });
  } else {
    checklist.push({
      item: "Escala vigente aprobada",
      status: "revisar",
      note: "No se encontro una escala aprobada para ese mes/convenio."
    });
    findings.push(auditFinding(
      "alta",
      "Sin escala aprobada vigente",
      "La liquidacion uso la escala base del sistema o datos estaticos porque no hay una escala aprobada para ese mes.",
      "Subir y aprobar la escala del mes antes de cerrar la liquidacion.",
      "NO_APPROVED_SCALE"
    ));
  }

  if (amount(totals.net) < 0) {
    findings.push(auditFinding("alta", "Neto negativo", "Las deducciones superan el bruto.", "Revisar descuentos varios y bases imponibles.", "NEGATIVE_NET"));
  }
  if (amount(totals.deductions) > amount(totals.gross)) {
    findings.push(auditFinding("alta", "Deducciones mayores al bruto", "El recibo queda inconsistente para pago normal.", "Revisar descuentos y embargos/correcciones manuales.", "DEDUCTIONS_GT_GROSS"));
  }

  const hasRem = remRows.length && amount(totals.remTotal) > 0;
  const deductionText = deductionRows.map((row) => String(row.label || "").toLowerCase()).join(" | ");
  if (hasRem && (!deductionText.includes("jubil") || !deductionText.includes("pami") || !deductionText.includes("obra social"))) {
    findings.push(auditFinding(
      "alta",
      "Faltan aportes obligatorios",
      "Hay remunerativos, pero no aparecen todos los aportes basicos de trabajador.",
      "Verificar SIPA, PAMI y obra social antes de emitir.",
      "MISSING_STATUTORY_DEDUCTIONS"
    ));
  }

  const noRemLabels = ["comida", "viatico", "viÃ¡tico", "pernoctada", "kilometraje"];
  const misplacedCamioneros = conventionId === "camioneros" && remRows.some((row) => noRemLabels.some((label) => String(row.label || "").toLowerCase().includes(label)));
  if (misplacedCamioneros) {
    findings.push(auditFinding(
      "alta",
      "Conceptos de Camioneros ubicados como remunerativos",
      "Comida, viaticos, pernoctada o kilometraje deberian revisarse como no remunerativos segun el CCT cargado.",
      "Mover el concepto o revisar la regla aplicada.",
      "CAMIONEROS_NONREM_MISPLACED"
    ));
  }

  const hasAbsenceDiscount = details.some((row) => String(row.label || "").toLowerCase().includes("inasistencia"));
  const hasPresentism = remRows.some((row) => String(row.label || "").toLowerCase().includes("presentismo"));
  if (conventionId === "uocra" && hasAbsenceDiscount && hasPresentism) {
    findings.push(auditFinding(
      "media",
      "Presentismo con inasistencias",
      "La liquidacion tiene descuento por inasistencias y tambien presentismo.",
      "Confirmar si corresponde conservar presentismo o recalcular sin ese adicional.",
      "UOCRA_PRESENTISM_ABSENCE"
    ));
  }

  const manualRows = [...remRows, ...noRemRows, ...deductionRows].filter((row) => String(row.label || "").toLowerCase().includes("manual") || String(row.label || "").toLowerCase().includes("varios"));
  if (manualRows.length) {
    findings.push(auditFinding(
      "baja",
      "Hay conceptos manuales",
      `Se detectaron ${manualRows.length} concepto(s) manual(es) o varios.`,
      "Documentar el motivo y controlar si integran bases de aportes correctamente.",
      "MANUAL_CONCEPTS"
    ));
  }

  const severityRank = { alta: 3, media: 2, baja: 1 };
  const maxSeverity = findings.reduce((max, finding) => Math.max(max, severityRank[finding.severity] || 0), 0);
  const verdict = maxSeverity >= 3 ? "REVISAR" : maxSeverity === 2 ? "OBSERVAR" : "OK";
  const score = Math.max(0, 100 - findings.reduce((total, finding) => total + ({ alta: 22, media: 12, baja: 5 }[finding.severity] || 8), 0));

  return {
    verdict,
    score,
    findings,
    checklist,
    recalculation: {
      remTotal,
      noRemTotal,
      gross,
      deductions,
      employerContribs,
      net,
      employerCost
    }
  };
}

function buildLiquidationAuditPrompt({ liquidation, precheck, activeScale, catalog }) {
  const convention = catalog.conventions?.[liquidation.conventionId || liquidation.convention] || null;
  const compact = {
    liquidation,
    activeScale: activeScale ? {
      id: activeScale.id,
      period: activeScale.period,
      periodLabel: activeScale.periodLabel,
      approvedAt: activeScale.approvedAt,
      confidence: activeScale.parsedScale?.confidence,
      sourceSummary: activeScale.parsedScale?.sourceSummary,
      categories: (activeScale.parsedScale?.categories || []).slice(0, 12),
      additionals: (activeScale.parsedScale?.additionals || []).slice(0, 8),
      warnings: activeScale.parsedScale?.warnings || []
    } : null,
    precheck,
    convention: convention ? {
      id: convention.id,
      name: convention.name,
      source: convention.source,
      type: convention.type,
      periods: convention.periods,
      categories: convention.categories?.map((item) => ({ id: item.id, label: item.label })),
      zones: convention.zones
    } : null,
      legalReferences: catalog.legalReferences || []
  };

  return [
    "Sos leIA auditora senior de liquidaciones de sueldos argentinas.",
    "Revisa la liquidacion con criterio practico y accionable. No digas que esta todo bien si hay datos faltantes, escala no aprobada, bases raras o conceptos mal ubicados.",
    "Usa los prechequeos deterministico como fuente fuerte: si marcan error de suma, escala faltante o dato faltante, incluilo.",
    "No inventes normas ni importes. Si algo no esta en contexto, marcÃ¡ 'requiere validacion humana'.",
    "Se conciso: maximo 5 hallazgos, maximo 8 items de checklist y maximo 5 acciones.",
    "Devolve SOLO JSON valido con esta forma:",
    JSON.stringify({
      verdict: "OK | OBSERVAR | REVISAR",
      score: 0,
      summary: "resumen de 1 o 2 frases",
      findings: [
        { severity: "alta | media | baja", title: "hallazgo", detail: "por que importa", action: "que hacer" }
      ],
      checklist: [
        { item: "item controlado", status: "ok | revisar", note: "nota corta" }
      ],
      nextSteps: ["accion concreta"]
    }, null, 2),
    `Contexto:\n${JSON.stringify(compact, null, 2)}`
  ].join("\n\n");
}

function fallbackAuditFromPrecheck(precheck, aiError = null) {
  return {
    verdict: precheck.verdict,
    score: precheck.score,
    summary: aiError
      ? `Auditoria automatica disponible, pero leIA no pudo completar la revision narrativa: ${aiError}`
      : precheck.findings.length
        ? "La auditoria automatica encontro puntos para revisar antes de cerrar la liquidacion."
        : "La auditoria automatica no encontro inconsistencias aritmeticas ni bloqueos evidentes.",
    findings: precheck.findings,
    checklist: precheck.checklist,
    nextSteps: precheck.findings.length
      ? precheck.findings.slice(0, 4).map((finding) => finding.action)
      : ["Guardar respaldo de la liquidacion y conservar la escala aprobada utilizada."]
  };
}


module.exports = {
  deterministicLiquidationAudit,
  buildLiquidationAuditPrompt,
  fallbackAuditFromPrecheck,
  parseJsonObject
};
