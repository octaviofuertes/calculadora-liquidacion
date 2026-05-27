(function () {
  const UOCRA_CATEGORIES = [
    { id: "ofEsp", label: "Oficial especializado", monthly: false },
    { id: "oficial", label: "Oficial", monthly: false },
    { id: "mofc", label: "Medio oficial", monthly: false },
    { id: "ayud", label: "Ayudante", monthly: false },
    { id: "sereno", label: "Sereno", monthly: true }
  ];

  const CAMIONEROS_CATEGORIES = [
    ["conductor1", "Conductor de primera categoria", 1001071.98],
    ["conductor2", "Conductor de segunda categoria", 983232.49],
    ["conductor3", "Conductor de tercera categoria - fletes al instante", 965374.95],
    ["grua10", "Conductor de gruas hasta 10 tn / autoelevadores", 1018918.96],
    ["grua20", "Conductor de gruas mas de 10 y hasta 20 tn", 1120810.86],
    ["grua35", "Conductor de gruas mas de 20 y hasta 35 tn", 1165643.29],
    ["grua45", "Conductor de gruas mas de 35 y hasta 45 tn", 1212269.02],
    ["grua55", "Conductor de gruas mas de 45 y hasta 55 tn", 1260759.78],
    ["grua70", "Conductor de gruas mas de 55 y hasta 70 tn", 1323797.77],
    ["grua90", "Conductor de gruas mas de 70 y hasta 90 tn", 1389987.66],
    ["grua110", "Conductor de gruas mas de 90 y hasta 110 tn", 1459487.04],
    ["grua140", "Conductor de gruas mas de 110 y hasta 140 tn", 1532461.39],
    ["grua170", "Conductor de gruas mas de 140 y hasta 170 tn", 1609084.46],
    ["grua300", "Conductor de gruas mas de 170 y hasta 300 tn", 1689538.68],
    ["gruaMas300", "Conductor de gruas mas de 300 tn", 1824701.77],
    ["encargado", "Encargado", 940866.38],
    ["recibidor", "Recibidor y/o clasificador de guias", 931891.94],
    ["operarioEsp", "Operarios especializados", 923101.01],
    ["recolector", "Recolectores de residuo y limpieza", 923101.01],
    ["peon", "Peones", 914291.07],
    ["peonBarrido", "Peones generales de barrido y limpieza", 914291.07],
    ["operadorServicios", "Operador de servicios", 1065180.22],
    ["distribuidor", "Distribuidor domiciliario", 969519.98],
    ["ayudante18", "Ayudantes mayores de 18 años", 896768.85],
    ["choferBlindado", "Chofer de camion blindado", 1076279.39],
    ["choferFirma", "Chofer con firma", 1155899.20],
    ["custodia", "Custodia de camion de caudales", 933124.69],
    ["auxOp1", "Auxiliar operativo de primera", 1375644.41],
    ["auxOp2", "Auxiliar operativo de segunda", 958260.84],
    ["oficialPrimera", "Oficial de primera", 1114923.70],
    ["oficialCompleto", "Oficial completo de taller", 1057158.76],
    ["oficial", "Oficial", 1005085.13],
    ["medioOficial", "Medio oficial", 949464.23],
    ["oficialGomero", "Oficial gomero", 1005085.13],
    ["medioOficialGomero", "Medio oficial gomero", 949464.23],
    ["lavador", "Lavadores, engrasadores y ayudantes de taller", 949464.23],
    ["admin1", "Personal administrativo - primera categoria", 996199.21],
    ["admin2", "Personal administrativo - segunda categoria", 958260.84],
    ["admin3", "Personal administrativo - tercera categoria", 923101.01],
    ["admin4", "Personal administrativo - cuarta categoria", 905538.31],
    ["maestranza", "Maestranza y/o serenos", 905538.31],
    ["clearing1", "Auxiliar operativo de primera de clearing y correo privado", 998029.39],
    ["clearing2", "Auxiliar operativo de segunda de clearing y correo privado", 949869.30]
  ].map(([id, label, monthly]) => ({ id, label, monthly, day: monthly / 24 }));

  window.PAYROLL_DATA = {
    constants: {
      detss: 7003.68,
      artVariablePct: 2.5,
      artFixed: 1450,
      scvo: 424.62,
      gananciasMniAnual: 3091035,
      gananciasDedEspecialAnual: 7539834,
      conyugeDedAnual: 1026455,
      worker: {
        jubilacion: 0.11,
        pami: 0.03,
        obraSocial: 0.03
      },
      employerBase: {
        jubilacion: 0.1077,
        pami: 0.0158,
        obraSocial: 0.06,
        asignaciones: 0.047,
        fondoEmpleo: 0.0095
      },
      gananciasScale: [
        { from: 0, to: 419630, pct: 0.05, fixed: 0 },
        { from: 419630, to: 839260, pct: 0.09, fixed: 20982 },
        { from: 839260, to: 1258880, pct: 0.12, fixed: 58745 },
        { from: 1258880, to: 1678510, pct: 0.15, fixed: 109098 },
        { from: 1678510, to: 2517760, pct: 0.19, fixed: 172029 },
        { from: 2517760, to: 3357010, pct: 0.23, fixed: 331500 },
        { from: 3357010, to: 5035515, pct: 0.27, fixed: 524495 },
        { from: 5035515, to: 6714020, pct: 0.31, fixed: 977795 },
        { from: 6714020, to: Infinity, pct: 0.35, fixed: 1498044 }
      ]
    },
    conventions: {
      uocra: {
        id: "uocra",
        name: "UOCRA - CCT 76/75",
        shortName: "UOCRA",
        source: "Calculadora eSueldos_UOCRA_v5_2026",
        type: "hourly",
        periods: [
          { id: "mar26", label: "Marzo 2026" },
          { id: "abr26", label: "Abril 2026" },
          { id: "may26", label: "Mayo 2026" }
        ],
        zones: [
          { id: "A", label: "Zona A", coef: 1 },
          { id: "B", label: "Zona B", coef: 1 },
          { id: "C", label: "Zona C", coef: 1 },
          { id: "CAustral", label: "Zona C Austral", coef: 1 }
        ],
        categories: UOCRA_CATEGORIES,
        scaleKind: "Jornal diario; sereno mensual",
        scales: {
          mar26: {
            A: { ofEsp: 5579, oficial: 4773, mofc: 4411, ayud: 4060, sereno: 737493 },
            B: { ofEsp: 6193, oficial: 5300, mofc: 4889, ayud: 4527, sereno: 821599 },
            C: { ofEsp: 8565, oficial: 8030, mofc: 7749, ayud: 7524, sereno: 1232928 },
            CAustral: { ofEsp: 11158, oficial: 9545, mofc: 8821, ayud: 8119, sereno: 1474985 }
          },
          abr26: {
            A: { ofEsp: 6011, oficial: 5142, mofc: 4752, ayud: 4374, sereno: 794575 },
            B: { ofEsp: 6672, oficial: 5711, mofc: 5267, ayud: 4877, sereno: 885191 },
            C: { ofEsp: 9228, oficial: 8652, mofc: 8349, ayud: 8107, sereno: 1328356 },
            CAustral: { ofEsp: 12022, oficial: 10284, mofc: 9504, ayud: 8747, sereno: 1589149 }
          },
          may26: {
            A: { ofEsp: 6119, oficial: 5235, mofc: 4837, ayud: 4452, sereno: 808877 },
            B: { ofEsp: 6792, oficial: 5813, mofc: 5362, ayud: 4965, sereno: 901124 },
            C: { ofEsp: 9394, oficial: 8808, mofc: 8499, ayud: 8252, sereno: 1352267 },
            CAustral: { ofEsp: 12238, oficial: 10469, mofc: 9675, ayud: 8905, sereno: 1617754 }
          }
        },
        nonRem: {
          mar26: {
            A: { ofEsp: 147000, oficial: 134100, mofc: 123000, ayud: 115500, sereno: 115500 },
            B: { ofEsp: 163200, oficial: 148900, mofc: 136500, ayud: 128300, sereno: 128300 },
            C: { ofEsp: 225700, oficial: 206000, mofc: 188800, ayud: 177300, sereno: 177300 },
            CAustral: { ofEsp: 294000, oficial: 268200, mofc: 246000, ayud: 231000, sereno: 231000 }
          },
          abr26: {
            A: { ofEsp: 99800, oficial: 91000, mofc: 83500, ayud: 78400, sereno: 78400 },
            B: { ofEsp: 110800, oficial: 101100, mofc: 92700, ayud: 87100, sereno: 87100 },
            C: { ofEsp: 153200, oficial: 140000, mofc: 128200, ayud: 120400, sereno: 120400 },
            CAustral: { ofEsp: 199600, oficial: 182000, mofc: 167000, ayud: 156800, sereno: 156800 }
          },
          may26: {
            A: { ofEsp: 125400, oficial: 114400, mofc: 104900, ayud: 98500, sereno: 98500 },
            B: { ofEsp: 139200, oficial: 127000, mofc: 116400, ayud: 109400, sereno: 109400 },
            C: { ofEsp: 192500, oficial: 175600, mofc: 161000, ayud: 151200, sereno: 151200 },
            CAustral: { ofEsp: 250700, oficial: 228700, mofc: 209800, ayud: 197000, sereno: 197000 }
          }
        }
      },
      farmacia: {
        id: "farmacia",
        name: "Farmacia Mendoza - CCT 429/2005",
        shortName: "Farmacia Mendoza",
        source: "CON-CCT-429-2005-A y Escala Abril 2026",
        type: "monthly",
        periods: [
          { id: "abr26", label: "Abril 2026" },
          { id: "may26", label: "Mayo 2026" },
          { id: "jun26", label: "Junio 2026" }
        ],
        zones: [{ id: "mendoza", label: "Ambito Mendoza", coef: 1 }],
        categories: [
          { id: "inicialA", label: "Categoria inicial A", monthly: 1235927.54, nonRem: { abr26: 18538.91, may26: 43257.46, jun26: 67976.01 } },
          { id: "inicialB", label: "Categoria inicial B", monthly: 1235927.54, nonRem: { abr26: 18538.91, may26: 43257.46, jun26: 67976.01 } },
          { id: "cajeroPerfAdmin", label: "Cajero, perfumeria y administrativo", monthly: 1295795.44, nonRem: { abr26: 19436.93, may26: 45352.84, jun26: 71268.75 } },
          { id: "empleadoFarmacia", label: "Empleado de farmacia", monthly: 1377859.74, nonRem: { abr26: 20667.90, may26: 48225.09, jun26: 75782.29 } },
          { id: "empleadoEspFarmacia", label: "Empleado especializado de farmacia", monthly: 1685798.71, nonRem: { abr26: 25286.98, may26: 59002.95, jun26: 92718.93 } },
          { id: "farmaceutico", label: "Farmaceutico", monthly: 1880921.45, nonRem: { abr26: 28213.82, may26: 65832.25, jun26: 103450.68 } }
        ],
        additionals: {
          tituloFarmaceutico: { label: "Adicional titulo farmaceutico", monthly: 556167.39, nonRem: { abr26: 8342.51, may26: 19465.86, jun26: 30589.21 } },
          adscripcion: { label: "Adicional adscripcion", monthly: 383137.54, nonRem: { abr26: 5747.06, may26: 13409.81, jun26: 21072.56 } },
          bloqueo: { label: "Adicional bloqueo direccion tecnica", monthly: 988742.04, nonRem: { abr26: 14831.13, may26: 34605.97, jun26: 54380.81 } }
        },
        rules: {
          weeklyHours: 45,
          insalubreWeeklyHours: 33,
          insalubrePaidWeeklyHours: 45,
          dayDivisor: 30,
          vacationDivisor: 25,
          hourDivisor: 200,
          nightPct: 100,
          cajeroPct: 10,
          tareasAdministrativasPct: 5,
          adminTenurePctInitial: 5,
          adminTenurePctOver2Years: 10,
          perfumeriaPct: 10,
          bikePct: 10,
          languagePct: 10,
          auxTitlePct: 20,
          fallaCajaPct: 10,
          adefSolidarityPct: 2,
          unionPct: 2,
          cajaCompensadoraPct: 1,
          proEdificioPct: 1,
          pharmacyEmployeeDay: "6 de septiembre"
        },
        extraordinaryContribution: { abr26: 7479.52, may26: 7626.90, jun26: 7774.28 }
      },
      camioneros: {
        id: "camioneros",
        name: "Camioneros - CCT 40/89",
        shortName: "Camioneros",
        source: "CCT-40-89 y planilla mayo 2026",
        type: "monthly",
        periods: [{ id: "may26", label: "Mayo 2026" }],
        zones: [
          { id: "base", label: "General", coef: 1 },
          { id: "surColorado", label: "Sur Rio Colorado / coef. 1,20", coef: 1.2 },
          { id: "surSantaCruz", label: "Sur Santa Cruz / coef. 1,40", coef: 1.4 }
        ],
        categories: CAMIONEROS_CATEGORIES,
        items: {
          comida: 15318,
          viaticoEspecial: 7686.55,
          pernoctada: 17841.22,
          kmExtra: 80.08748,
          kmViatico: 80.08748,
          permanencia: 54059.44,
          simplePresencia: 28336.23,
          cruceFrontera: 37228.67,
          ingresoIsla: 42450.58,
          plusVacacionalDia: 23384.27,
          bitrenes: 646892.71,
          presentismoPct: 8.33,
          choferLargaDistanciaPct: 10,
          lacteaPct: 15,
          auxilioPct: 10,
          blindadoPct: 20,
          combustiblesPct: 15,
          peligrosasPct: 20,
          pozosPetroliferosPct: 40,
          pluralidadGrupoIPct: 25,
          pluralidadGrupoIIPct: 18,
          diariosRevistasPct: 12,
          logisticaPct: 18,
          camaraFrioPct: 20
        }
      }
    },
    legalReferences: [
      {
        label: "Aportes trabajador 11/3/3 - RG 712/1999",
        url: "https://www.argentina.gob.ar/normativa/nacional/resoluci%C3%B3n-712-1999-60834/texto"
      },
      {
        label: "LCT art. 201 - horas suplementarias 50% y 100%",
        url: "https://servicios.infoleg.gob.ar/infolegInternet/anexos/25000-29999/25552/texact.htm"
      },
      {
        label: "Aportes y contribuciones a la seguridad social",
        url: "https://www.argentina.gob.ar/economia/ingresospublicos/sistematributario/aportesycontribuciones"
      }
    ]
  };
})();
