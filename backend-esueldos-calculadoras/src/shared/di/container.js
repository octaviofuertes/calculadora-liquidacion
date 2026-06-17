const { createCatalogUseCases } = require("../../application/catalog/catalog-use-cases");
const { createEmployeeUseCases } = require("../../application/employees/employee-use-cases");
const { createLiquidationUseCases } = require("../../application/liquidations/liquidation-use-cases");
const { createCatalogRepository } = require("../../infrastructure/repositories/catalog-repository");
const { createEmployeeRepository } = require("../../infrastructure/repositories/employee-repository");
const { createLiquidationRepository } = require("../../infrastructure/repositories/liquidation-repository");
const { createCatalogController } = require("../../presentation/http/controllers/catalog-controller");
const { createEmployeeController } = require("../../presentation/http/controllers/employee-controller");
const { createLiquidationController } = require("../../presentation/http/controllers/liquidation-controller");

function createContainer(dependencies) {
  const catalogRepository = createCatalogRepository(dependencies);
  const employeeRepository = createEmployeeRepository(dependencies);
  const liquidationRepository = createLiquidationRepository(dependencies);

  const catalogUseCases = createCatalogUseCases({ catalogRepository });
  const employeeUseCases = createEmployeeUseCases({ employeeRepository });
  const liquidationUseCases = createLiquidationUseCases({
    liquidationRepository,
    calculateLiquidation: dependencies.calculateLiquidation,
    getDb: dependencies.getDb,
    serializeScale: dependencies.serializeScale
  });

  return {
    catalogController: createCatalogController({ catalogUseCases }),
    employeeController: createEmployeeController({ employeeUseCases }),
    liquidationController: createLiquidationController({ liquidationUseCases })
  };
}

module.exports = {
  createContainer
};
