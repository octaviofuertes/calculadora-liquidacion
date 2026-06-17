const { createContainer } = require("../shared/di/container");
const { createLiquidationsRouter: createPresentationLiquidationsRouter } = require("../presentation/http/routes/liquidations.routes");

function createLiquidationsRouter(dependencies) {
  const container = createContainer(dependencies);
  return createPresentationLiquidationsRouter({ controller: container.liquidationController });
}

module.exports = {
  createLiquidationsRouter
};
