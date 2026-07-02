const { geminiModelList, geminiAuditorModels } = require("../gemini-config");
const { callGeminiJson, GeminiConventionError, buildPdfPartsForGemini } = require("./convention-gemini");

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function monthHits(text = "") {
  const raw = String(text || "");
  const pattern = /\b(ene|feb|mar|abr|may|jun|jul|ago|sep|set|oct|nov|dic|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b(?:\s*[-/]\s*(?:19|20)?\d{2})?/gi;
  return unique((raw.match(pattern) || []).map((item) => item.replace(/\s+/g, " ").trim().toLowerCase()));
}

function zoneHits(text = "") {
  const raw = String(text || "");
  const matches = raw.match(/\bzona\s*"?[a-z0-9\-áéíóúü]+\"?/gi) || [];
  return unique(matches.map((item) => item.replace(/\s+/g, " ").trim().toLowerCase()));
}

function branchHits(text = "") {
  return unique(
    String(text || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => {
        const normalized = normalizeText(line);
        return normalized.length >= 5
          && normalized.length <= 60
          && !/[0-9]/.test(normalized)
          && line === line.toUpperCase()
          && !/(zona|salario|basico|total|anexo|categoria|mes|vigencia|cuadro|tabla)/.test(normalized);
      })
      .map((line) => line.replace(/\s+/g, " ").trim())
  );
}

function summarizeParsedConvention(parsed = {}) {
  const scales = Array.isArray(parsed.escalas) ? parsed.escalas : [];
  const categories = Array.isArray(parsed.categorias) ? parsed.categorias : [];
  const scaleMonths = unique(scales.flatMap((scale) => [
    scale.nombre_escala,
    scale.periodo_desde,
    scale.periodo_hasta,
    ...(Array.isArray(scale.valores) ? scale.valores.flatMap((value) => [value.periodicidad, value.vigencia_desde, value.vigencia_hasta]) : [])
  ]));
  const scaleZones = unique(scales.flatMap((scale) => [
    scale.zona,
    ...(Array.isArray(scale.valores) ? scale.valores.map((value) => value.zona) : [])
  ]));
  const branchNames = unique([
    ...categories.map((category) => category.grupo_nombre || category.rama || category.convenio_rama),
    ...scales.map((scale) => scale.grupo_nombre || scale.rama),
    ...scales.flatMap((scale) => (Array.isArray(scale.valores) ? scale.valores.map((value) => value.grupo_nombre || value.rama) : []))
  ].filter(Boolean));
  return {
    categories: categories.length,
    concepts: Array.isArray(parsed.conceptos) ? parsed.conceptos.length : 0,
    scales: scales.length,
    scaleValues: scales.reduce((total, scale) => total + (Array.isArray(scale.valores) ? scale.valores.length : 0), 0),
    months: scaleMonths,
    zones: scaleZones,
    branches: branchNames
  };
}

function deterministicConventionStructureAudit({ sourceText = "", parsedConvention = {} }) {
  const findings = [];
  const checklist = [];
  const detectedMonths = monthHits(sourceText);
  const detectedZones = zoneHits(sourceText);
  const detectedBranches = branchHits(sourceText);
  const summary = summarizeParsedConvention(parsedConvention);
  const scaleCount = summary.scales;
  const zoneCount = summary.zones.length;
  const branchCount = summary.branches.length;

  const monthComplete = !detectedMonths.length || scaleCount >= detectedMonths.length;
  checklist.push({
    item: "Meses visibles",
    status: monthComplete ? "ok" : "revisar",
    note: monthComplete
      ? "La estructura detectada cubre los meses visibles del documento."
      : `El texto sugiere ${detectedMonths.length} mes(es) y la estructura trae ${scaleCount} escala(s).`
  });
  if (!monthComplete) {
    findings.push({
      severity: "alta",
      title: "Meses faltantes o colapsados",
      detail: `El documento menciona ${detectedMonths.join(", ")} y la estructura final no conserva todos los tramos como escalas separadas.`,
      action: "Separar cada vigencia/mes en una escala distinta.",
      code: "MISSING_MONTHS"
    });
  }

  const zoneComplete = !detectedZones.length || zoneCount >= detectedZones.length;
  checklist.push({
    item: "Zonas visibles",
    status: zoneComplete ? "ok" : "revisar",
    note: zoneComplete
      ? "Las zonas visibles aparecen en la estructura."
      : `El texto sugiere ${detectedZones.length} zona(s) y la estructura trae ${zoneCount}.`
  });
  if (!zoneComplete) {
    findings.push({
      severity: "alta",
      title: "Zonas colapsadas",
      detail: `El documento menciona ${detectedZones.join(", ")} y la estructura final no conserva todas las zonas.`,
      action: "Mantener una fila por zona con el mismo mes y rama.",
      code: "MISSING_ZONES"
    });
  }

  const branchComplete = !detectedBranches.length || branchCount >= detectedBranches.length;
  checklist.push({
    item: "Ramas visibles",
    status: branchComplete ? "ok" : "revisar",
    note: branchComplete
      ? "Las ramas o bloques visibles están representados."
      : `El texto sugiere ${detectedBranches.length} bloque(s) y la estructura trae ${branchCount} rama(s).`
  });
  if (!branchComplete) {
    findings.push({
      severity: "media",
      title: "Bloques por rama posiblemente fusionados",
      detail: "El texto muestra ramas o bloques separados y la estructura parece haberlos unificado.",
      action: "Crear una escala por rama/bloque dentro de cada mes.",
      code: "MERGED_BRANCHES"
    });
  }

  const suspiciousZoneDefaults = summary.zones.length === 1 && detectedZones.length > 1;
  if (suspiciousZoneDefaults) {
    findings.push({
      severity: "alta",
      title: "Zona por defecto sospechosa",
      detail: "El documento contiene varias zonas, pero la estructura final conserva una sola.",
      action: "Releer encabezados zonales y emitir una fila por cada zona.",
      code: "ZONE_DEFAULT_COLLAPSE"
    });
  }

  const severityRank = { alta: 3, media: 2, baja: 1 };
  const maxSeverity = findings.reduce((max, finding) => Math.max(max, severityRank[finding.severity] || 0), 0);
  const verdict = maxSeverity >= 3 ? "REVISAR" : maxSeverity === 2 ? "OBSERVAR" : "OK";
  const score = Math.max(0, 100 - findings.reduce((total, finding) => total + ({ alta: 22, media: 12, baja: 5 }[finding.severity] || 8), 0));

  return {
    verdict,
    score,
    summary: findings.length
      ? "La estructura todavía requiere validación porque podrían faltar meses, zonas o bloques por rama."
      : "La estructura del convenio luce consistente con los patrones detectados en el documento.",
    findings,
    checklist,
    nextSteps: findings.length
      ? findings.slice(0, 5).map((finding) => finding.action)
      : ["Guardar el convenio estructurado y usarlo como base de liquidación."],
    detectedMonths,
    detectedZones,
    detectedBranches,
    sourceSummary: summary
  };
}

function buildConventionStructureAuditPrompt({ sourceText = "", parsedConvention = {}, draftName = "", notes = "" }) {
  const compact = {
    draftName,
    notes,
    sourceText: String(sourceText || "").slice(0, 18000),
    parsedConvention: {
      convenio: parsedConvention.convenio || {},
      categorias: (parsedConvention.categorias || []).slice(0, 20).map((item) => ({
        categoria_id: item.categoria_id,
        categoria_nombre: item.categoria_nombre,
        grupo_nombre: item.grupo_nombre,
        rama: item.rama,
        modalidad_aplicable: item.modalidad_aplicable
      })),
      conceptos: (parsedConvention.conceptos || []).slice(0, 20).map((item) => ({
        concepto_id: item.concepto_id,
        nombre: item.nombre,
        naturaleza: item.naturaleza,
        tipo_concepto: item.tipo_concepto
      })),
      escalas: (parsedConvention.escalas || []).slice(0, 20).map((scale) => ({
        escala_id: scale.escala_id,
        nombre_escala: scale.nombre_escala,
        periodo_desde: scale.periodo_desde,
        periodo_hasta: scale.periodo_hasta,
        zona: scale.zona,
        grupo_nombre: scale.grupo_nombre,
        rama: scale.rama,
        valores: (scale.valores || []).slice(0, 12).map((value) => ({
          categoria_id: value.categoria_id,
          concepto_id: value.concepto_id,
          periodicidad: value.periodicidad,
          zona: value.zona,
          valor: value.valor
        }))
      }))
    },
    sourceSummary: summarizeParsedConvention(parsedConvention)
  };

  return [
    "Sos el auditor estructural de un convenio laboral argentino.",
    "Tu tarea es revisar si la estructura generada por Gemini coincide con el documento fuente y detectar omisiones, fusiones indebidas o colapsos de meses, zonas o ramas.",
    "Leé los PDFs adjuntos como fuente principal y compará contra el JSON estructurado.",
    "Buscá conceptos, haberes, deducciones, categorías, zonas, ramas y vigencias que aparezcan en el PDF pero no en la estructura final.",
    "No rehagas la extracción completa. Solo auditá la calidad estructural del JSON producido.",
    "Reglas clave:",
    "- Si el documento tiene varios meses, deben existir varias escalas o periodos diferenciados.",
    "- Si el documento tiene varias zonas, deben existir valores separados por zona.",
    "- Si el documento tiene ramas, sectores o bloques separados, no deben fusionarse.",
    "- Si una categoría se repite por rama o modalidad, debe quedar separada con IDs distintos.",
    "- Si ves una zona, mes o rama que la estructura no conserva, marcá el problema de forma explícita.",
    "- Si el PDF muestra un concepto/haber/deducción y no aparece en el JSON, marcá el faltante.",
    "Devolvé solo JSON válido con esta forma:",
    JSON.stringify({
      verdict: "OK | OBSERVAR | REVISAR",
      score: 0,
      summary: "resumen breve",
      findings: [
        { severity: "alta | media | baja", title: "hallazgo", detail: "detalle", action: "accion", code: "CODE" }
      ],
      checklist: [
        { item: "control", status: "ok | revisar", note: "nota" }
      ],
      nextSteps: ["accion concreta"]
    }, null, 2),
    `Contexto:\n${JSON.stringify(compact, null, 2)}`
  ].join("\n\n");
}

async function runConventionStructureAudit({
  apiKey,
  model,
  fallbackModels = [],
  sourceText = "",
  parsedConvention = {},
  draftName = "",
  notes = "",
  files = []
}) {
  console.log(`[CCT audit] inicio draft=${draftName || "sin_nombre"} files=${Array.isArray(files) ? files.length : 0}`);
  const precheck = deterministicConventionStructureAudit({ sourceText, parsedConvention });
  console.log(`[CCT audit] precheck verdict=${precheck.verdict} score=${precheck.score} meses=${precheck.detectedMonths.length} zonas=${precheck.detectedZones.length} ramas=${precheck.detectedBranches.length}`);
  console.log(`[Codex audit] fuente detectada meses=${precheck.detectedMonths.join(", ") || "ninguno"} zonas=${precheck.detectedZones.join(", ") || "ninguna"} ramas=${precheck.detectedBranches.length}`);
  console.log(`[Codex audit] estructura meses=${precheck.sourceSummary.months.length} zonas=${precheck.sourceSummary.zones.length} ramas=${precheck.sourceSummary.branches.length} escalas=${precheck.sourceSummary.scales} valores=${precheck.sourceSummary.scaleValues}`);
  const models = apiKey ? (geminiModelList(model || geminiAuditorModels()[0], fallbackModels)) : [];
  if (!apiKey || !models.length) {
    console.log("[CCT audit] sin API o sin modelos; usando auditoria deterministica");
    return { ...precheck, auditMode: "deterministic", tokenUsage: null, modelsTried: [] };
  }

  const fileParts = Array.isArray(files) && files.length
    ? await buildPdfPartsForGemini({ apiKey, files, role: "PDF DEL CONVENIO A AUDITAR" })
    : { parts: [] };
  console.log(`[CCT audit] pdf_parts=${fileParts.parts ? fileParts.parts.length : 0}`);
  const parts = [
    { text: buildConventionStructureAuditPrompt({ sourceText, parsedConvention, draftName, notes }) },
    ...(fileParts.parts || [])
  ];
  let lastError = null;
  for (const currentModel of models) {
    try {
      console.log(`[CCT audit] modelo=${currentModel}`);
      const result = await callGeminiJson({
        apiKey,
        model: currentModel,
        label: "convention-structure-audit",
        parts
      });
      const parsed = result.parsed && typeof result.parsed === "object" ? result.parsed : {};
      console.log(`[CCT audit] ok modelo=${currentModel} verdict=${parsed.verdict || precheck.verdict} score=${parsed.score || precheck.score} hallazgos=${Array.isArray(parsed.findings) ? parsed.findings.length : 0}`);
      console.log(`[Codex audit] checklist=${(Array.isArray(parsed.checklist) ? parsed.checklist : precheck.checklist).map((item) => `${item.item}:${item.status}`).join(" | ")}`);
      console.log(`[Codex audit] hallazgos=${(Array.isArray(parsed.findings) ? parsed.findings : precheck.findings).map((item) => `${item.code}:${item.title}`).join(" | ") || "ninguno"}`);
      return {
        verdict: ["OK", "OBSERVAR", "REVISAR"].includes(parsed.verdict) ? parsed.verdict : precheck.verdict,
        score: Number.isFinite(Number(parsed.score)) ? Number(parsed.score) : precheck.score,
        summary: String(parsed.summary || precheck.summary),
        findings: Array.isArray(parsed.findings) && parsed.findings.length ? parsed.findings : precheck.findings,
        checklist: Array.isArray(parsed.checklist) && parsed.checklist.length ? parsed.checklist : precheck.checklist,
        nextSteps: Array.isArray(parsed.nextSteps) && parsed.nextSteps.length ? parsed.nextSteps : precheck.nextSteps,
        detectedMonths: precheck.detectedMonths,
        detectedZones: precheck.detectedZones,
        detectedBranches: precheck.detectedBranches,
        sourceSummary: precheck.sourceSummary,
        auditMode: "gemini",
        model: currentModel,
        tokenUsage: result.tokenUsage || null,
        modelsTried: models
      };
    } catch (error) {
      lastError = error;
      console.log(`[CCT audit] error modelo=${currentModel} msg=${error.message}`);
      if (!/high demand|unavailable|overloaded|try again later|503/i.test(String(error.message || ""))) break;
    }
  }

  if (lastError) {
    console.log(`[CCT audit] fallback por error: ${lastError.message}`);
    console.log(`[Codex audit] fallback checklist=${precheck.checklist.map((item) => `${item.item}:${item.status}`).join(" | ")}`);
    console.log(`[Codex audit] fallback hallazgos=${precheck.findings.map((item) => `${item.code}:${item.title}`).join(" | ") || "ninguno"}`);
    return {
      ...precheck,
      summary: `${precheck.summary} Gemini no pudo completar la auditoria: ${lastError.message}`,
      auditMode: "fallback",
      tokenUsage: null,
      modelsTried: models,
      auditError: lastError.message
    };
  }

  return { ...precheck, auditMode: "deterministic", tokenUsage: null, modelsTried: models };
}

module.exports = {
  buildConventionStructureAuditPrompt,
  deterministicConventionStructureAudit,
  runConventionStructureAudit
};
