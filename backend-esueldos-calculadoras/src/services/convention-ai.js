const { GeminiConventionError, extractConventionFromPdfs } = require("./convention-rag");
const { normalizeConvention } = require("./convention-normalizers");
const { buildConventionPrompt, buildConventionCorePrompt, buildScalePrompt, buildScaleCompactPrompt, universalConventionTemplateForPrompt, conventionExtractionContractForPrompt } = require("./convention-prompts");
const { sanitizeGenericConventionCategories } = require("./convention-generic");
const UNIVERSAL_CONVENTION_TEMPLATE = require("../../convenio-universal-template.json");

module.exports = {
  GeminiConventionError,
  extractConventionFromPdfs,
  normalizeConvention,
  buildConventionPrompt,
  buildConventionCorePrompt,
  buildScalePrompt,
  buildScaleCompactPrompt,
  universalConventionTemplateForPrompt,
  conventionExtractionContractForPrompt,
  sanitizeGenericConventionCategories,
  UNIVERSAL_CONVENTION_TEMPLATE
};
