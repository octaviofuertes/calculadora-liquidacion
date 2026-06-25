const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const DEFAULT_GEMINI_FALLBACK_MODELS = ["gemini-2.5-flash-lite"];

function splitModels(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueModels(models) {
  return models
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index);
}

function geminiPrimaryModel() {
  return String(process.env.GEMINI_MODEL || "").trim() || DEFAULT_GEMINI_MODEL;
}

function geminiScaleModel() {
  return String(process.env.GEMINI_SCALE_MODEL || "").trim() || geminiPrimaryModel();
}

function geminiConventionModel() {
  return String(process.env.GEMINI_CONVENTION_MODEL || "").trim() || geminiScaleModel();
}

function geminiBaseApiKey() {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
}

function geminiConventionApiKey() {
  return process.env.GEMINI_CONVENTION_API_KEY || geminiBaseApiKey();
}

function geminiScaleApiKey() {
  return process.env.GEMINI_SCALE_API_KEY || geminiBaseApiKey();
}

function geminiAuditorApiKey() {
  return String(process.env.GEMINI_AUDITOR_API_KEY || "").trim();
}

function geminiAuditorModels() {
  const configuredModels = splitModels(process.env.GEMINI_AUDITOR_MODEL);
  return uniqueModels(configuredModels.length ? configuredModels : [geminiConventionModel()]);
}

function geminiFallbackModels() {
  const configuredModels = splitModels(process.env.GEMINI_FALLBACK_MODELS);
  return uniqueModels(configuredModels.length ? configuredModels : DEFAULT_GEMINI_FALLBACK_MODELS);
}

function geminiModelList(primaryModel, fallbackModels = []) {
  return uniqueModels([primaryModel || DEFAULT_GEMINI_MODEL, ...fallbackModels]);
}

module.exports = {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GEMINI_FALLBACK_MODELS,
  geminiPrimaryModel,
  geminiScaleModel,
  geminiConventionModel,
  geminiBaseApiKey,
  geminiConventionApiKey,
  geminiScaleApiKey,
  geminiAuditorApiKey,
  geminiAuditorModels,
  geminiFallbackModels,
  geminiModelList
};
