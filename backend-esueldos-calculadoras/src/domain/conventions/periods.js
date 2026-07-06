const PERIOD_MONTHS = {
  enero: 1,
  ene: 1,
  january: 1,
  jan: 1,
  febrero: 2,
  feb: 2,
  february: 2,
  marzo: 3,
  mar: 3,
  march: 3,
  abril: 4,
  abr: 4,
  april: 4,
  apr: 4,
  mayo: 5,
  may: 5,
  junio: 6,
  jun: 6,
  june: 6,
  julio: 7,
  jul: 7,
  july: 7,
  agosto: 8,
  ago: 8,
  august: 8,
  aug: 8,
  septiembre: 9,
  setiembre: 9,
  sep: 9,
  set: 9,
  september: 9,
  octubre: 10,
  oct: 10,
  october: 10,
  noviembre: 11,
  nov: 11,
  november: 11,
  diciembre: 12,
  dic: 12,
  december: 12,
  dec: 12
};

function text(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.filter(Boolean).map((item) => text(item)).filter(Boolean).join(", ");
  if (typeof value === "object") {
    const useful = value.nombre || value.name || value.label || value.descripcion || value.description || value.id || value.codigo || value.code;
    console.warn("[CCT normalize] Se reemplazo [object Object] por campo util o vacio.");
    return useful === undefined || useful === null ? "" : String(useful);
  }
  return String(value);
}

function array(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function formatPeriod(year, month) {
  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || !Number.isInteger(m) || y < 2000 || m < 1 || m > 12) return "";
  return `${y}-${String(m).padStart(2, "0")}`;
}

function normalizedPeriodText(value) {
  return text(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function periodIds(...values) {
  const raw = values.map(text).filter(Boolean).join(" ");
  const normalized = normalizedPeriodText(raw);
  const periods = [];
  const fullYear = (year) => {
    const value = Number(year);
    if (!Number.isInteger(value)) return "";
    return value < 100 ? String(2000 + value) : String(value);
  };
  const add = (year, month) => {
    const period = formatPeriod(fullYear(year), month);
    if (period && !periods.includes(period)) periods.push(period);
  };
  const addRange = (year, fromMonth, toMonth) => {
    const from = Number(fromMonth);
    const to = Number(toMonth);
    const y = Number(year);
    if (!Number.isInteger(y) || !Number.isInteger(from) || !Number.isInteger(to)) return;
    if (from < 1 || from > 12 || to < 1 || to > 12 || to < from) return;
    for (let month = from; month <= to; month += 1) add(y, month);
  };

  raw.replace(/\b(20\d{2})[-/.](0?[1-9]|1[0-2])(?:[-/.]\d{1,2})?\b/g, (_, year, month) => add(year, month));
  raw.replace(/\b(0?[1-9]|[12]\d|3[01])[-/.](0?[1-9]|1[0-2])[-/.](20\d{2})\b/g, (_, _day, month, year) => add(year, month));
  raw.replace(/\b(0?[1-9]|1[0-2])[-/.](20\d{2}|\d{2})\b/g, (_, month, year) => add(year, month));
  const monthPattern = Object.keys(PERIOD_MONTHS).sort((a, b) => b.length - a.length).join("|");
  const shortMonthYearPattern = new RegExp(`\\b(${monthPattern})\\b\\s*[-/.]?\\s*(\\d{2})\\b`, "g");
  normalized.replace(shortMonthYearPattern, (_, month, year) => add(year, PERIOD_MONTHS[month]));
  const rangePattern = new RegExp(`\\b(${monthPattern})\\b\\s*(?:a|al|hasta|to|through|-|/)\\s*\\b(${monthPattern})\\b\\s*(?:de\\s*)?(20\\d{2})\\b`, "g");
  normalized.replace(rangePattern, (_, fromMonth, toMonth, year) => addRange(year, PERIOD_MONTHS[fromMonth], PERIOD_MONTHS[toMonth]));

  const tokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  let pendingMonths = [];
  let currentYear = "";
  tokens.forEach((token) => {
    if (PERIOD_MONTHS[token]) {
      pendingMonths.push(PERIOD_MONTHS[token]);
      if (currentYear) add(currentYear, PERIOD_MONTHS[token]);
      return;
    }
    if (/^20\d{2}$/.test(token)) {
      currentYear = token;
      pendingMonths.forEach((month) => add(token, month));
      pendingMonths = [];
      return;
    }
    if (!["a", "al", "de", "del", "hasta", "y", "e", "to", "from", "through"].includes(token)) {
      pendingMonths = [];
    }
  });

  return periods;
}

function periodId(value) {
  return periodIds(value)[0] || "";
}

function periodRangeIds(fromValue, toValue) {
  const from = periodId(fromValue);
  const to = periodId(toValue);
  if (!from || !to) return [];
  const [fromYear, fromMonth] = from.split("-").map(Number);
  const [toYear, toMonth] = to.split("-").map(Number);
  const fromIndex = fromYear * 12 + fromMonth;
  const toIndex = toYear * 12 + toMonth;
  if (toIndex < fromIndex || toIndex - fromIndex > 36) return [from];
  const periods = [];
  for (let index = fromIndex; index <= toIndex; index += 1) {
    const year = Math.floor((index - 1) / 12);
    const month = ((index - 1) % 12) + 1;
    periods.push(formatPeriod(year, month));
  }
  return periods.filter(Boolean);
}

function scalePeriodIds(scale = {}) {
  const range = periodRangeIds(scale.periodo_desde, scale.periodo_hasta);
  return Array.from(new Set([
    ...range,
    ...periodIds(
      scale.periodo_desde,
      scale.periodo_hasta,
      scale.nombre_escala,
      scale.periodicidad,
      scale.mes,
      scale.fuente_documento,
      scale.evidencia,
      scale.contexto,
      scale.escala_id
    ),
    ...array(scale.valores).flatMap((value) => periodIds(
      value.periodicidad,
      value.periodo,
      value.mes,
      value.fecha,
      value.periodo_desde,
      value.periodo_hasta,
      value.vigencia_desde,
      value.vigencia_hasta,
      value.fuente_documento,
      value.evidencia,
      value.contexto
    ))
  ].filter(Boolean)));
}

module.exports = {
  formatPeriod,
  normalizedPeriodText,
  periodIds,
  periodId,
  periodRangeIds,
  scalePeriodIds
};
