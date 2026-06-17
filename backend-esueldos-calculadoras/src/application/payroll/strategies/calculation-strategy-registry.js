const { createStrategyRegistry } = require("../../shared/strategy-registry");

function createCalculationStrategyRegistry() {
  return createStrategyRegistry();
}

module.exports = {
  createCalculationStrategyRegistry
};
