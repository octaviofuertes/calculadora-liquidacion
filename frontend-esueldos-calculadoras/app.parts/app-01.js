(function () {
  let DATA = window.PAYROLL_DATA;
  let dataOrigin = "local";
  const API_BASE = getApiBase();
  const $ = (id) => document.getElementById(id);
  const ui = window.eSueldosUi || {};

  let lastResult = null;
  let lastAudit = null;
  let currentStep = 1;
  const TOTAL_STEPS = 4;
  const CONVENTIONS_PER_PAGE = 9;
  let conventionPage = 0;
  let conventionSearch = "";
  const leiaHistory = [];
  const leiaGuidedTopics = [
    {
      id: "scales",
      label: "Escalas salariales",
      detail: "Basicos, jornales, no remunerativos y escala aprobada vigente."
    },
    {
      id: "categories",
      label: "Categorias",
      detail: "Listado de categorias del convenio con sus valores de referencia."
    },
    {
      id: "additionals",
      label: "Adicionales",
      detail: "Conceptos, pluses, viaticos e items parametrizados."
    },
    {
      id: "zones",
      label: "Zonas",
      detail: "Ambitos, zonas y coeficientes aplicables."
    },
    {
      id: "deductions",
      label: "Aportes y descuentos",
      detail: "Aportes generales y propios del convenio."
    },
    {
      id: "rules",
      label: "Reglas de liquidacion",
      detail: "Divisores, jornada, presentismo, antiguedad y controles."
    }
  ];
  const fieldHelpTexts = {
    "periodo": "Mes que se va a liquidar. Define que escala salarial y reglas vigentes se toman como referencia.",
    "categoria": "Categoria laboral del trabajador dentro del convenio. Determina el basico o jornal de partida.",
    "zona": "Zona de prestacion de tareas. Puede aplicar coeficientes o adicionales regionales.",
    "legajo": "Identificador interno del empleado para buscarlo y asociar sus liquidaciones guardadas.",
    "trabajador": "Nombre y apellido que se mostrara en el recibo y en el historial del empleado.",
    "cuil": "Clave unica laboral del trabajador. Se usa para identificarlo correctamente en la documentacion.",
    "fecha de ingreso": "Fecha desde la que se calcula antiguedad y otros beneficios ligados al tiempo trabajado.",
    "estado civil": "Dato usado para estimaciones fiscales o deducciones cuando corresponda.",
    "otros remunerativos": "Importe adicional sujeto a aportes y contribuciones que no esta parametrizado en el convenio.",
    "otros no remunerativos": "Importe adicional que integra el bruto no remunerativo segun respaldo legal o acuerdo aplicable.",
    "descuentos varios": "Descuentos manuales extra que reducen el neto a cobrar.",
    "estimar ganancias 4ta categoria": "Activa una estimacion orientativa de Ganancias sobre la liquidacion.",
    "% del mes": "Porcentaje del periodo trabajado o pagadero. Usalo para liquidaciones proporcionales.",
    "unidades": "Cantidad de unidades base del convenio para liquidar cuando no aplica mes completo.",
    "horas": "Cantidad de horas trabajadas o pagaderas segun el convenio.",
    "jornales": "Cantidad de jornales trabajados o pagaderos en el periodo.",
    "dias ausentes injust.": "Dias de ausencia sin justificar que descuentan salario segun las reglas del convenio.",
    "dias ausentes just.": "Ausencias justificadas informativas que normalmente no descuentan salario.",
    "hs extra 50%": "Horas extra con recargo del 50%.",
    "hs extra 100%": "Horas extra con recargo del 100%.",
    "antiguedad segun convenio": "Aplica la regla de antiguedad aprobada en el convenio generado por leIA.",
    "presentismo segun convenio": "Aplica presentismo si el convenio aprobado lo define y se cumplen sus condiciones.",
    "no remunerativo de escala": "Incluye sumas no remunerativas cargadas en la escala vigente.",
    "liquidacion": "Tipo de periodo a liquidar para el convenio seleccionado.",
    "horas normales": "Horas ordinarias trabajadas o pagaderas antes de adicionales y descuentos.",
    "hs inasist. injust.": "Horas de ausencia injustificada que descuentan el jornal.",
    "franco trabajado hs": "Horas trabajadas en franco que deben liquidarse con el tratamiento convencional.",
    "feriado no trab. hs": "Horas de feriado no trabajado que corresponde abonar segun convenio.",
    "altura %": "Porcentaje adicional por tareas en altura cuando corresponda.",
    "horas semanales": "Jornada semanal pactada. Se usa para proporcionalidad y controles de jornada.",
    "dias del mes": "Divisor de dias del periodo para prorrateos, ausencias y bases diarias.",
    "dias no rem.": "Dias sobre los que se prorratea la suma no remunerativa. Si queda vacio, el sistema lo calcula.",
    "idiomas": "Cantidad de idiomas o adicional equivalente cuando el convenio lo reconoce.",
    "hs nocturnas volunt.": "Horas nocturnas voluntarias a liquidar con el recargo correspondiente.",
    "feriados trabajados": "Cantidad de feriados efectivamente trabajados.",
    "feriados no trab.": "Cantidad de feriados no trabajados que se abonan segun regla legal o convencional.",
    "dia farmacia trab.": "Indica si se trabajo el Dia del Empleado de Farmacia.",
    "dia farmacia no trab.": "Indica si corresponde abonar el Dia del Empleado de Farmacia sin prestacion.",
    "dias vacaciones": "Dias de vacaciones a liquidar o descontar del periodo normal.",
    "dias sac": "Dias computables para calcular SAC proporcional.",
    "mejor rem. sac": "Mejor remuneracion mensual usada como base del SAC cuando se informa manualmente.",
    "divisor jornales": "Cantidad de jornales base que usa el convenio para convertir mes a valor diario.",
    "jornales a pagar": "Jornales efectivamente pagaderos en el periodo.",
    "plus vacacional dias": "Dias usados para calcular plus vacacional cuando corresponde.",
    "dia camionero trab.": "Marca el dia del trabajador camionero trabajado para liquidar su adicional.",
    "pernoctadas": "Cantidad de pernoctadas con viatico no remunerativo.",
    "km larga distancia": "Kilometros de larga distancia remunerativos a liquidar.",
    "km sab/dom/feriado": "Kilometros realizados en sabados, domingos o feriados.",
    "dias viaje km": "Dias de viaje usados para controlar minimos de kilometraje o viaticos.",
    "km viatico manual": "Kilometros de viatico cargados manualmente cuando no surgen del calculo automatico.",
    "permanencias": "Cantidad de permanencias no remunerativas del convenio.",
    "simple presencia": "Cantidad de eventos de simple presencia a liquidar como viatico.",
    "cruces frontera": "Cruces de frontera que generan viatico o adicional convencional.",
    "ingresos isla": "Ingresos a isla que generan el adicional correspondiente.",
    "bitrenes": "Cantidad o unidades vinculadas al adicional por bitrenes.",
    "adicional rama %": "Porcentaje manual de adicional por rama o tarea especifica.",
    "otros rem. convenio": "Importe remunerativo manual propio del convenio.",
    "hs nocturnas 100%": "Horas nocturnas con recargo al 100%."
  };
  const scaleState = {
    recent: [],
    months: [],
    selected: null,
    activeScale: null,
    activeForPayroll: null
  };
  const conventionBuilderState = {
    drafts: [],
    selected: null
  };

  function getApiBase() {
    if (window.eSueldosApiClient?.baseUrl !== undefined) {
      return window.eSueldosApiClient.baseUrl;
    }
    if (typeof window.ESUELDOS_API_URL === "string") {
      return window.ESUELDOS_API_URL.replace(/\/$/, "");
    }
    if (window.location.protocol === "file:") {
      return "http://localhost:4100";
    }
    if (["localhost", "127.0.0.1"].includes(window.location.hostname) && window.location.port !== "4100") {
      return `${window.location.protocol}//${window.location.hostname}:4100`;
    }
    return "";
  }

  function apiUrl(path) {
    if (window.eSueldosApiClient?.url) return window.eSueldosApiClient.url(path);
    return `${API_BASE}${path}`;
  }

  async function fetchCatalog() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      return await fetch(apiUrl("/api/catalog"), {
        cache: "no-store",
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  function fmt(value) {
    return ui.fmt ? ui.fmt(value) : `$ ${Number(value || 0).toFixed(2)}`;
  }

  function calcNum(value) {
    const number = Number(value || 0);
    if (!Number.isFinite(number)) return "0";
    return String(round2(number)).replace(".", ",");
  }

  function num(id, fallback = 0) {
    const el = $(id);
    if (!el) return fallback;
    const value = Number(String(el.value).replace(",", "."));
    return Number.isFinite(value) ? value : fallback;
  }

  function str(id, fallback = "") {
    const el = $(id);
    return el ? el.value : fallback;
  }

  function readDateInput(id) {
    const el = $(id);
    if (!el) return "";
    const value = String(el.value || "").trim();
    if (value) return value;
    const shown = String(el.getAttribute("value") || "").trim();
    const match = shown.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!match) return shown;
    return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  }

  function on(id) {
    const el = $(id);
    return !!(el && el.checked);
  }

  function checked(id, fallback = false) {
    const el = $(id);
    return el ? !!el.checked : fallback;
  }

  function round2(value) {
    return ui.round2 ? ui.round2(value) : Math.round((value + Number.EPSILON) * 100) / 100;
  }

  function addRow(list, label, amount, detail = "", formula = "") {
    if (!Number.isFinite(amount) || Math.abs(amount) < 0.005) return;
    list.push({ label, amount: round2(amount), detail, formula });
  }

  function sumRows(rows) {
    return ui.sumRows ? ui.sumRows(rows) : rows.reduce((total, row) => total + row.amount, 0);
  }

  function normalizeHelpKey(value) {
    return String(value || "")
      .replace(/\?/g, "")
      .replace(/\([^)]*\)/g, "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function fieldHelpText(label) {
    const key = normalizeHelpKey(label);
    return fieldHelpTexts[key] || "Campo del convenio usado por el motor de liquidacion. Revisalo contra la escala, legajo y documentacion respaldatoria.";
  }

  function addHelpTooltip(labelEl, helpText) {
    if (!labelEl || labelEl.querySelector(".field-help")) return;
    const button = document.createElement("button");
    button.className = "field-help";
    button.type = "button";
    button.setAttribute("aria-label", `Ayuda: ${labelEl.textContent.trim()}`);
    button.setAttribute("data-tooltip", helpText);
    button.textContent = "?";
    labelEl.appendChild(button);
  }

  function enhanceFieldHelp(root = document) {
    const scope = root.querySelectorAll ? root : document;
    scope.querySelectorAll('.form-step[data-step="2"] .field > span, .form-step[data-step="3"] .field > span, .form-step[data-step="2"] .check-row > span, .form-step[data-step="3"] .check-row > span')
      .forEach((labelEl) => addHelpTooltip(labelEl, fieldHelpText(labelEl.textContent)));
  }

  function yearsFromEntry() {
    const raw = readDateInput("entryDate");
    if (!raw) return 0;
    const start = new Date(`${raw}T00:00:00`);
    const today = new Date();
    let years = today.getFullYear() - start.getFullYear();
    const month = today.getMonth() - start.getMonth();
    if (month < 0 || (month === 0 && today.getDate() < start.getDate())) years -= 1;
    return Math.max(0, years);
  }

  async function loadCatalog() {
    try {
      const response = await fetchCatalog();
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const catalog = await response.json();
      if (!catalog || !catalog.constants || !catalog.conventions) {
        throw new Error("Respuesta de catalogo invalida");
      }
      DATA = catalog;
      window.PAYROLL_DATA = catalog;
      dataOrigin = "mongodb";
      return true;
    } catch (error) {
      dataOrigin = "local";
      return false;
    }
  }

  function getConvention() {
    const fallbackId = firstConventionId();
    return DATA.conventions[str("convention", fallbackId)] || DATA.conventions[fallbackId] || null;
  }

  function firstConventionId() {
    return DATA.conventions.camioneros ? "camioneros" : Object.keys(DATA.conventions || {})[0] || "";
  }

  function getPeriod(conv) {
    const firstPeriod = Array.isArray(conv?.periods) && conv.periods.length ? conv.periods[0].id : currentMonthValue();
    return str("period", firstPeriod || currentMonthValue());
  }

  function getZone(conv) {
    return conv.zones.find((zone) => zone.id === str("zone")) || conv.zones[0];
  }

  function getCategory(conv) {
    return conv.categories.find((cat) => cat.id === str("category")) || conv.categories[0];
  }

  function normalizeOptionKey(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function categoryLikeRowMatches(row, category) {
    const categoryId = normalizeOptionKey(category?.id);
    const categoryLabel = normalizeOptionKey(category?.label);
    const rowId = normalizeOptionKey(row?.id || row?.categoria_id);
    const rowLabel = normalizeOptionKey(row?.label || row?.categoria_nombre || row?.nombre);
    return (categoryId && rowId === categoryId)
      || (categoryLabel && rowLabel === categoryLabel)
      || (categoryLabel && rowLabel && rowLabel.includes(categoryLabel))
      || (categoryLabel && rowLabel && categoryLabel.includes(rowLabel));
  }

  function payrollModalityOptions(conv = getConvention()) {
    const category = getCategory(conv);
    const parsedScale = scaleState.activeForPayroll?.parsedScale || {};
    const rows = [
      ...(parsedScale.categories || []),
      ...(parsedScale.nonRemunerative || []),
      ...(conv.categories || [])
    ];
    (conv.escalas || []).forEach((scale) => {
      (scale.valores || []).forEach((value) => rows.push({
        id: value.categoria_id,
        label: value.categoria_nombre,
        modalidad: value.modalidad || value.modalidad_aplicable || value.jornada || value.alcance
      }));
    });
    const options = new Map();
    rows.forEach((row) => {
      if (!categoryLikeRowMatches(row, category)) return;
      const label = row.modalidad || row.modality || row.modalidad_aplicable || row.jornada || row.alcance || "";
      const id = normalizeOptionKey(label);
      if (!id || ["general", "base", "sin adicional"].includes(id)) return;
      options.set(id, { id, label: String(label).replace(/_/g, " ") });
    });
    return Array.from(options.values());
  }

  function refreshPayrollModalityOptions() {
    const field = $("modalityField");
    const select = $("modality");
    if (!field || !select) return;
    const options = payrollModalityOptions();
    field.hidden = options.length < 2;
    setOptions(select, options.length ? options : [{ id: "", label: "General" }], str("modality"));
    if (field.hidden) select.value = "";
  }

  function setOptions(select, options, current) {
    select.innerHTML = options
      .map((option) => `<option value="${option.id}">${escapeHtml(option.label)}</option>`)
      .join("");
    const hasCurrent = options.some((option) => option.id === current);
    select.value = hasCurrent ? current : options[0]?.id || "";
  }

  function getCurrentPeriodId() {
    const today = new Date();
    const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
    const month = months[today.getMonth()];
    const year = today.getFullYear().toString().slice(-2);
    return month + year;
  }

  function escapeHtml(value) {
    if (ui.escapeHtml) return ui.escapeHtml(value);
    return String(value).replace(/[&<>"']/g, "");
  }

  function periodIdToMonth(periodId) {
    const match = String(periodId || "").toLowerCase().match(/^(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)(\d{2})$/);
    if (!match) return null;
    const months = { ene: "01", feb: "02", mar: "03", abr: "04", may: "05", jun: "06", jul: "07", ago: "08", sep: "09", oct: "10", nov: "11", dic: "12" };
    return `20${match[2]}-${months[match[1]]}`;
  }

  function currentMonthValue() {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  }

  function selectedPeriodMonth(conv = getConvention()) {
    return periodIdToMonth(getPeriod(conv)) || currentMonthValue();
  }

  function monthLabel(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})$/);
    if (!match) return value || "";
    const names = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    return `${names[Number(match[2]) - 1] || match[2]} ${match[1]}`;
  }

  function statusLabel(status) {
    const labels = {
      PENDIENTE_REVISION: "Pendiente",
      APROBADA: "Aprobada",
      RECHAZADA: "Rechazada"
    };
    return labels[status] || status || "-";
  }

  function shortDate(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  function conventionCardMeta(conv) {
    const cardCopy = {
      uocra: {
        title: "UOCRA",
        code: "CCT 76/75",
        description: "Construccion. Jornales por zona, categorias operarias, sereno mensual, presentismo, SNR, adicionales y horas extra."
      },
      farmacia: {
        title: "Farmacia Mendoza",
        code: "CCT 429/05",
        description: "Farmacias de Mendoza. Escala normalizada por categoria, no remunerativos por periodo, antiguedad, titulo, adscripcion y bloqueo."
      },
      camioneros: {
        title: "Camioneros",
        code: "CCT 40/89",
        description: "Transporte automotor de cargas. Basicos mayo 2026, coeficientes zonales, antiguedad sin tope (1%/año). Comida, viatico, pernoctada y km: NO remunerativos (Art. 4.2.11)."
      }
    };

    return cardCopy[conv.id] || {
      title: conv.shortName || conv.name,
      code: conv.name,
      description: conv.source || "Convenio disponible para liquidacion."
    };
  }

  function conventionAccent(id) {
    const accents = {
      uocra: { strong: "#2458ff", soft: "#edf4ff", ink: "#183a98" },
      farmacia: { strong: "#008762", soft: "#e9fbf4", ink: "#005f48" },
      camioneros: { strong: "#d16d00", soft: "#fff3df", ink: "#824000" }
    };
    return accents[id] || { strong: "#2458ff", soft: "#edf4ff", ink: "#183a98" };
  }

  function plural(count, singular, pluralValue) {
    return `${count} ${count === 1 ? singular : pluralValue}`;
  }

  function conventionIcon(id, className) {
    const attrs = `class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`;
    const icons = {
      uocra: `<svg ${attrs}>
        <path d="M4 15h16" />
        <path d="M6 15v-3a6 6 0 0 1 12 0v3" />
        <path d="M9 15V9" />
        <path d="M15 15V9" />
        <path d="M3 18h18" />
        <path d="M7 18l1.2 2h7.6L17 18" />
      </svg>`,
      farmacia: `<svg ${attrs}>
        <path d="M6 3v5a5 5 0 0 0 10 0V3" />
        <path d="M6 3H4" />
        <path d="M16 3h2" />
        <path d="M11 13v2a5 5 0 0 0 10 0v-2" />
        <circle cx="21" cy="10" r="2" />
      </svg>`,
      camioneros: `<svg ${attrs}>
        <path d="M3 6h11v10H3z" />
        <path d="M14 9h4l3 4v3h-7z" />
        <path d="M5 19a2 2 0 1 0 4 0a2 2 0 0 0-4 0" />
        <path d="M16 19a2 2 0 1 0 4 0a2 2 0 0 0-4 0" />
        <path d="M9 19h7" />
      </svg>`
    };
    return icons[id] || icons.uocra;
  }

  function renderConventionCards() {
    const container = $("conventionCards");
    if (!container) return;

    const activeId = str("convention", firstConventionId()) || firstConventionId();
    let search = $("conventionSearch");
    if (!search) {
      search = document.createElement("input");
      search.id = "conventionSearch";
      search.className = "convention-search";
      search.type = "search";
      search.placeholder = "Buscar convenio";
      container.insertAdjacentElement("beforebegin", search);
      search.oninput = () => {
        conventionSearch = search.value.trim().toLowerCase();
        conventionPage = 0;
        renderConventionCards();
      };
    }
    search.value = conventionSearch;

    const conventions = Object.values(DATA.conventions).filter((conv) => {
      const meta = conventionCardMeta(conv);
      return `${meta.title} ${meta.code}`.toLowerCase().includes(conventionSearch);
    });
    const totalPages = Math.max(1, Math.ceil(conventions.length / CONVENTIONS_PER_PAGE));
    conventionPage = Math.min(conventionPage, totalPages - 1);
    const visibleConventions = conventions.slice(
      conventionPage * CONVENTIONS_PER_PAGE,
      (conventionPage + 1) * CONVENTIONS_PER_PAGE
