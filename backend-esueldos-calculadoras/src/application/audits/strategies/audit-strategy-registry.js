const { createStrategyRegistry } = require("../../shared/strategy-registry");

function createAuditStrategyRegistry() {
  return createStrategyRegistry();
}

module.exports = {
  createAuditStrategyRegistry
};
