const fs = require("fs");
const path = require("path");

const MONTHS = {
  enero: ["ene", "Enero"],
  febrero: ["feb", "Febrero"],
  marzo: ["mar", "Marzo"],
  abril: ["abr", "Abril"],
  mayo: ["may", "Mayo"],
  junio: ["jun", "Junio"],
  julio: ["jul", "Julio"],
  agosto: ["ago", "Agosto"],
  septiembre: ["sep", "Septiembre"],
  octubre: ["oct", "Octubre"],
  noviembre: ["nov", "Noviembre"],
  diciembre: ["dic", "Diciembre"]
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function money(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  if (number > 0 && number < 1000 && !Number.isInteger(number)) return Math.round(number * 1000);
  return Math.round(number);
}

function periodFromScaleKey(key) {
  const [monthName, year] = key.split("_");
  const month = MONTHS[monthName];
  if (!month) throw new Error(`Mes no soportado: ${key}`);
  return {
    id: `${month[0]}${String(year).slice(-2)}`,
    label: `${month[1]} ${year}`,
    validFrom: `${year}-${String(Object.keys(MONTHS).indexOf(monthName) + 1).padStart(2, "0")}-01`
  };
}

function uniquePeriods(rows) {
  const periods = new Map();
  rows.forEach((row) => {
    Object.keys(row.escalas || {}).forEach((key) => {
      const period = periodFromScaleKey(key);
      periods.set(period.id, period);
    });
  });
  return Array.from(periods.values()).sort((a, b) => a.validFrom.localeCompare(b.validFrom));
}

function normative(source, extra = {}) {
  return {
    validFrom: source.acuerdo_paritarias_2026.vigencia_tramo.desde,
    validTo: source.acuerdo_paritarias_2026.vigencia_tramo.hasta,
    source: "Acuerdo paritario AFA-UTEDYC CCT 553/09 firmado el 2026-03-30",
    approvedBy: "pendiente",
    approvedAt: null,
    ...extra
  };
}

function buildCategory(row) {
  const isHourly = row.tipo_liquidacion === "por_hora_modulo";
  const monthlyByPeriod = {};
  const hourlyByPeriod = {};
  const nonRemunerativeByPeriod = {};
  Object.entries(row.escalas || {}).forEach(([key, scale]) => {
    const period = periodFromScaleKey(key);
    if (isHourly) hourlyByPeriod[period.id] = money(scale.remunerativo);
    else monthlyByPeriod[period.id] = money(scale.remunerativo);
    nonRemunerativeByPeriod[period.id] = money(scale.no_remunerativo);
  });

  return {
    id: row.id_categoria,
    label: row.categoria,
    branch: row.rama,
    salaryType: isHourly ? "hourly" : "monthly",
    monthly: isHourly ? undefined : (monthlyByPeriod.jun26 || monthlyByPeriod.may26 || monthlyByPeriod.abr26 || monthlyByPeriod.mar26 || 0),
    hourly: isHourly ? (hourlyByPeriod.jun26 || hourlyByPeriod.may26 || hourlyByPeriod.abr26 || hourlyByPeriod.mar26 || 0) : undefined,
    monthlyByPeriod: isHourly ? undefined : monthlyByPeriod,
    hourlyByPeriod: isHourly ? hourlyByPeriod : undefined,
    nonRemunerativeByPeriod,
    roles: row.roles || []
  };
}

function compactRules(source) {
  const add = source.adicionales_y_beneficios;
  const lic = source.regimen_licencias;
  return {
    monthDivisor: 30,
    hourDivisor: add.horas_extras.tope_divisor_mensual,
    weeklyHours: lic.jornada_estandar_maxima_semanal_horas,
    reducedScheduleDivisor: lic.divisor_proporcional_jornada_reducida,
    nonRemunerativeScale: {
      enabled: true,
      detail: "Suma no remunerativa del mes de aplicación, incorporada al básico como remunerativa al mes siguiente."
    },
    seniority: {
      enabled: true,
      percentPerYear: add.antiguedad.porcentaje_por_anio,
      base: "basic",
      detail: add.antiguedad.base_calculo
    },
    presentism: {
      enabled: true,
      percent: add.presentismo_asistencia.porcentaje,
      base: "basic",
      requiresNoUnjustifiedAbsence: true,
      toleratedAbsences: add.presentismo_asistencia.excepciones_toleradas
    },
    punctuality: {
      enabled: true,
      percent: add.puntualidad.porcentaje,
      base: "basic",
      monthlyToleranceMinutes: add.puntualidad.tolerancia_mensual_minutos,
      toleratedAbsences: add.puntualidad.excepciones_toleradas
    },
    cashShortage: {
      mainCashierPercent: add.falla_de_caja.caja_principal_pct,
      auxiliaryCashierPercent: add.falla_de_caja.caja_auxiliar_o_cobradores_pct,
      base: "basic"
    },
    overtime: {
      divisor: add.horas_extras.tope_divisor_mensual,
      weekdayPercent: add.horas_extras.recargo_habil_pct,
      weekendHolidayPercent: add.horas_extras.recargo_fin_de_semana_feriado_pct,
      weekendCondition: add.horas_extras.condicion_fin_de_semana,
      minimumFractionMinutes: add.horas_extras.fraccionamiento_minimo
    }
  };
}

function buildConvention(sourcePath, targetPath) {
  const source = readJson(sourcePath);
  const periods = uniquePeriods(source.matriz_salarial_2026);
  const categories = source.matriz_salarial_2026.map(buildCategory);
  const rules = compactRules(source);

  const convention = {
    id: "afa_553_09",
    name: "AFA - UTEDYC CCT 553/09",
    shortName: "AFA/UTEDYC",
    source: "gemini-code-1780061723601.json normalizado",
    type: "monthly",
    calculationMode: "generic-v1",
    parties: source.convenio.partes_signatarias,
    scope: source.convenio.ambito_territorial,
    cct: {
      id: source.convenio.id,
      label: source.convenio.nombre
    },
    metadata: {
      originalFile: sourcePath,
      generatedBy: "scripts/build-afa-convention.js",
      generatedAt: new Date().toISOString(),
      reviewStatus: "pending-human-review",
      dataQualityNotes: [
        "Se normalizó el valor admin_2da no remunerativo marzo_2026 de 52.779 a 52779 por formato decimal probable.",
        "Las reglas quedan declarativas; la aprobación normativa sigue pendiente antes de usar en liquidaciones reales."
      ]
    },
    normative: normative(source),
    periods,
    zones: [
      {
        id: "general",
        label: "General",
        coef: 1
      }
    ],
    categories,
    rules,
    liquidationModel: {
      rules,
      concepts: [
        {
          id: "punctuality",
          label: "Puntualidad",
          rowType: "remunerative",
          calculation: "percent",
          percent: rules.punctuality.percent,
          base: "basic",
          defaultValue: true,
          detail: `Tolerancia mensual ${rules.punctuality.monthlyToleranceMinutes} minutos`
        },
        {
          id: "cash_shortage_main",
          label: "Falla de caja principal",
          rowType: "remunerative",
          calculation: "percent",
          percent: rules.cashShortage.mainCashierPercent,
          base: "basic",
          defaultValue: false,
          detail: "Caja principal"
        },
        {
          id: "cash_shortage_aux",
          label: "Falla de caja auxiliar / cobradores",
          rowType: "remunerative",
          calculation: "percent",
          percent: rules.cashShortage.auxiliaryCashierPercent,
          base: "basic",
          defaultValue: false,
          detail: "Caja auxiliar o cobradores"
        },
        {
          id: "scholarship_subsidy",
          label: "Subsidio becas",
          rowType: "remunerative",
          calculation: "amountPerUnit",
          inputType: "number",
          unitAmountByPeriod: categories.find((category) => category.id === "admin_4ta_aux_1ra")?.monthlyByPeriod || {},
          percent: source.adicionales_y_beneficios.subsidio_becas.porcentaje_por_beca,
          detail: "10% por beca sobre Administrativo 4ta Auxiliar de Primera. Requiere validación manual del requisito de entidad."
        }
      ]
    },
    agreement2026: {
      ...source.acuerdo_paritarias_2026,
      normative: normative(source)
    },
    licenses: {
      ordinaryVacation: source.regimen_licencias.ordinarias_dias_por_antiguedad,
      paidSpecialLeaves: source.regimen_licencias.especiales_pagas_dias,
      normative: normative(source)
    }
  };

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, `${JSON.stringify(convention, null, 2)}\n`, "utf8");
  return convention;
}

if (require.main === module) {
  const sourcePath = process.argv[2];
  const targetPath = process.argv[3] || path.resolve(__dirname, "../src/catalog/conventions/afa-553-09.json");
  if (!sourcePath) {
    console.error("Uso: node scripts/build-afa-convention.js <source-json> [target-json]");
    process.exit(1);
  }
  const convention = buildConvention(path.resolve(sourcePath), path.resolve(targetPath));
  console.log(`Convenio generado: ${targetPath}`);
  console.log(`Categorias: ${convention.categories.length}`);
  console.log(`Periodos: ${convention.periods.map((period) => period.id).join(", ")}`);
}

module.exports = { buildConvention };
