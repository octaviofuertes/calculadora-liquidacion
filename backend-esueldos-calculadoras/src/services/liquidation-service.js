const { calculatePayroll } = require("../domain/payroll-engine");
const { calculationInputSchema, liquidationResultSchema, parseOrThrow } = require("../domain/schemas");
const catalogService = require("./catalog-service");
const convenioService = require("./convenio-service");
const scaleRepository = require("../repositories/scale-repository");

async function calculateLiquidation(db, body, serializeScale) {
  const payload = parseOrThrow(calculationInputSchema, body, "Datos de liquidacion invalidos");
  const catalog = await catalogService.getCatalog(db);
  let runtimeCatalog = catalog;
  let activeScale = serializeScale(await scaleRepository.findActiveScale(db, payload.conventionId, payload.period));
  if (!catalog.conventions?.[payload.conventionId]) {
    const runtime = await convenioService.buildPayrollDataForConvenio(db, payload.conventionId, payload.period, catalog);
    runtimeCatalog = runtime.catalog;
    activeScale = runtime.activeScale;
  }
  const result = calculatePayroll({
    catalog: runtimeCatalog,
    payload,
    activeScale
  });
  return parseOrThrow(liquidationResultSchema, result, "Resultado de liquidacion invalido");
}

module.exports = {
  calculateLiquidation
};
