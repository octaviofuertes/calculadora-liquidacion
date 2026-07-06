const { calculatePayroll } = require("../domain/payroll-engine");
const { calculationInputSchema, liquidationResultSchema, parseOrThrow } = require("../domain/schemas");
const catalogService = require("./catalog-service");
const convenioService = require("./convenio-service");
const scaleRepository = require("../repositories/scale-repository");

function scaleRowKey(row = {}) {
  return [row.id || "", row.zone || "", row.modality || row.modalidad || ""].join(":");
}

function mergeActiveScaleList(scales = []) {
  if (!scales.length) return null;
  const first = scales[0];
  const categories = Array.from(new Map(
    scales.flatMap((scale) => (scale.parsedScale?.categories || [])).map((row) => [scaleRowKey(row), row])
  ).values());
  return {
    ...first,
    parsedScale: {
      ...(first.parsedScale || {}),
      categories
    },
    availableScales: scales
  };
}

async function calculateLiquidation(db, body, serializeScale) {
  const payload = parseOrThrow(calculationInputSchema, body, "Datos de liquidacion invalidos");
  const catalog = await catalogService.getCatalog(db);
  let runtimeCatalog = catalog;
  const activeScales = (await scaleRepository.findActiveScales(db, payload.conventionId, payload.period)).map(serializeScale);
  let activeScale = mergeActiveScaleList(activeScales);
  const catalogConvention = catalog.conventions?.[payload.conventionId];
  if (!catalogConvention || catalogConvention.excelConvention || catalogConvention.structuredFromConvention) {
    const runtime = await convenioService.buildPayrollDataForConvenio(db, payload.conventionId, payload.period, catalog);
    runtimeCatalog = runtime.catalog;
    activeScale = runtime.activeScale || mergeActiveScaleList(runtime.activeScales || []);
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
