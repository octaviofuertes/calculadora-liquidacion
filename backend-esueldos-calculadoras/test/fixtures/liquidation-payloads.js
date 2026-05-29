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
  }
};
