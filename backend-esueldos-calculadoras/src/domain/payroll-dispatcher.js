const { runGeneratedCalculator } = require("./manual-calculator-adapter");

function dispatchPayrollCalculation(ctx, options) {
  const { strategies = {}, genericCalculator, helpers = {} } = options || {};
  const generatedRows = runGeneratedCalculator(ctx, helpers);
  if (generatedRows) {
    return generatedRows;
  }
  const calculate = strategies[ctx.convention.id] || genericCalculator;
  return calculate(ctx);
}

module.exports = {
  dispatchPayrollCalculation
};
