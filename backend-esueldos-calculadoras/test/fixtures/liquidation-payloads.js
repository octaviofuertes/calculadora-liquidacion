module.exports = {
  uocraBasic: {
    conventionId: "uocra",
    period: "may26",
    categoryId: "oficial",
    zoneId: "A",
    employee: {
      legajo: "001",
      name: "Trabajador UOCRA",
      cuil: "20-00000000-0",
      entryDate: "2020-01-01",
      civilStatus: "soltero"
    },
    inputs: {
      uocraPeriodMode: "1",
      uocraHours: 88,
      uocraSeniority: true,
      uocraPresentism: true,
      uocraSNR: true
    }
  },
  farmaciaBasic: {
    conventionId: "farmacia",
    period: "abr26",
    categoryId: "empleadoFarmacia",
    zoneId: "mendoza",
    employee: {
      legajo: "002",
      name: "Trabajadora Farmacia",
      cuil: "27-00000000-0",
      entryDate: "2018-04-01",
      civilStatus: "soltero"
    },
    inputs: {
      farmWeeklyHours: 45,
      farmMonthPct: 100,
      farmSeniority: true,
      farmNonRem: true,
      farmAdefSolidarity: true
    }
  },
  camionerosBasic: {
    conventionId: "camioneros",
    period: "may26",
    categoryId: "conductor1",
    zoneId: "base",
    employee: {
      legajo: "003",
      name: "Trabajador Camioneros",
      cuil: "20-11111111-0",
      entryDate: "2016-01-01",
      civilStatus: "soltero"
    },
    inputs: {
      camPeriodDays: 24,
      camWorkingDays: 24,
      camComida: true,
      camViaticoEspecial: true,
      camSeniority: true,
      camPresentism: true
    }
  },
  afaMensualBasic: {
    conventionId: "afa_553_09",
    period: "jun26",
    categoryId: "admin_4ta_aux_1ra",
    zoneId: "general",
    employee: {
      legajo: "004",
      name: "Trabajadora AFA mensual",
      cuil: "27-22222222-0",
      entryDate: "2019-03-01",
      civilStatus: "soltero"
    },
    inputs: {
      genMonthPct: 100,
      genSeniority: true,
      genPresentism: true,
      gen_punctuality: true,
      genNonRemScale: true
    }
  },
  afaModuloBasic: {
    conventionId: "afa_553_09",
    period: "jun26",
    categoryId: "otros_cat_a_prof",
    zoneId: "general",
    employee: {
      legajo: "005",
      name: "Profesor AFA modulo",
      cuil: "20-33333333-0",
      entryDate: "2021-07-01",
      civilStatus: "soltero"
    },
    inputs: {
      genWorkUnits: 80,
      genSeniority: true,
      genPresentism: false,
      genNonRemScale: true
    }
  }
};
