const { parseOrThrow, conventionSchema } = require("../domain/schemas");
const catalogRepository = require("../repositories/catalog-repository");

async function getCatalog(db) {
  return catalogRepository.getCatalogPayload(db);
}

async function listConventions(db) {
  return catalogRepository.listConventions(db);
}

async function getConventionOrThrow(db, conventionId) {
  const convention = await catalogRepository.getConventionById(db, conventionId);
  if (!convention) {
    const error = new Error("Convenio no encontrado");
    error.status = 404;
    throw error;
  }
  return convention;
}

function validateConvention(convention) {
  return parseOrThrow(conventionSchema, convention, "Convenio invalido");
}

async function replaceValidatedConvention(db, convention, extra = {}) {
  const validated = validateConvention(convention);
  return catalogRepository.replaceConvention(db, validated, extra);
}

module.exports = {
  getCatalog,
  getConventionOrThrow,
  listConventions,
  replaceValidatedConvention,
  validateConvention
};
