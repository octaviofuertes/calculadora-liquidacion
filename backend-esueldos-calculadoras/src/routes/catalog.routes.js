const { createContainer } = require("../shared/di/container");
const { createCatalogRouter: createPresentationCatalogRouter } = require("../presentation/http/routes/catalog.routes");

function createCatalogRouter(dependencies) {
  const container = createContainer(dependencies);
  return createPresentationCatalogRouter({ controller: container.catalogController });
}

module.exports = {
  createCatalogRouter
};
