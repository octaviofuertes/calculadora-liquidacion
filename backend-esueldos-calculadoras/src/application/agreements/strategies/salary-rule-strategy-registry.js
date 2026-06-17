const { createStrategyRegistry } = require("../../shared/strategy-registry");

function createSalaryRuleStrategyRegistry() {
  return createStrategyRegistry();
}

module.exports = {
  createSalaryRuleStrategyRegistry
};
