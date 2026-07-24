const { loadCalculatorModule } = require("../services/calculator-loader");

function buildSpecificContext(ctx, helpers) {
  const activeCatRow = helpers.scaleCategoryRow?.(ctx.activeScale, ctx.category, ctx.zone, ctx.modality) || {
    valor: helpers.periodAmountValue?.(ctx.category, ctx.payloadPeriod, ["basic", "amount", "salary", "monthly", "monthlyByPeriod", "basicByPeriod"]),
    valor_diario: helpers.periodAmountValue?.(ctx.category, ctx.payloadPeriod, ["daily", "dailyByPeriod"]),
    valor_hora: helpers.periodAmountValue?.(ctx.category, ctx.payloadPeriod, ["hourly", "hourlyByPeriod"])
  };

  return {
    inputs: ctx.inputs || {},
    employee: ctx.employee || {},
    activeCatRow,
    rules: ctx.convention.rules || {}
  };
}

function runGeneratedCalculator(ctx, helpers = {}) {
  try {
    const loaded = loadCalculatorModule(ctx.convention.id);
    const calcModule = loaded?.module;
    if (!calcModule) return null;
    const specificCtx = buildSpecificContext(ctx, helpers);
    return calcModule.calculate(specificCtx);
  } catch (err) {
    console.error("Failed to execute generated calculator:", err);
    return null;
  }
}

module.exports = {
  runGeneratedCalculator
};
