const { createContainer } = require("../shared/di/container");
const { createEmployeesRouter: createPresentationEmployeesRouter } = require("../presentation/http/routes/employees.routes");

function createEmployeesRouter(dependencies) {
  const container = createContainer(dependencies);
  return createPresentationEmployeesRouter({ controller: container.employeeController });
}

module.exports = {
  createEmployeesRouter
};
