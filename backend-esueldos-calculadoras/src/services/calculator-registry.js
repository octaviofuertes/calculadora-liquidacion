const fs = require('fs');
const path = require('path');

const CALCULATORS_DIR = path.join(__dirname, '..', 'calculators');
const MANUAL_CALCULATORS_DIR = path.join(CALCULATORS_DIR, 'manual');
const GENERATED_CALCULATORS_DIR = path.join(CALCULATORS_DIR, 'generated');

const REGISTRY = {
  'afa-553-09': {
    manualFile: 'afa-553-09.js',
    aliases: ['Personal Mensualizado AFA - UTEDYC.js']
  },
  'afa_553_09': {
    manualFile: 'afa-553-09.js',
    aliases: ['Personal Mensualizado AFA - UTEDYC.js']
  }
};

const SKIP_GENERATION_IDS = new Set(['camioneros', 'uocra', 'comercio', 'EMPLEADOS_DE_COMERCIO', 'afa-553-09', 'afa_553_09']);

function normalizeId(id) {
  return String(id || '').trim();
}

function idVariants(id) {
  const key = normalizeId(id);
  return [...new Set([key, key.replace(/_/g, '-'), key.replace(/-/g, '_')].filter(Boolean))];
}

function uniquePaths(paths) {
  return [...new Set(paths.filter(Boolean))];
}

function getCalculatorCandidates(id) {
  const key = normalizeId(id);
  const entry = idVariants(key).map((variant) => REGISTRY[variant]).find(Boolean) || {};
  return uniquePaths([
    entry.manualFile && path.join(MANUAL_CALCULATORS_DIR, entry.manualFile),
    entry.generatedFile && path.join(GENERATED_CALCULATORS_DIR, entry.generatedFile),
    entry.file && path.join(CALCULATORS_DIR, entry.file),
    ...(entry.aliases || []).map((file) => path.join(CALCULATORS_DIR, file)),
    ...idVariants(key).flatMap((variant) => [
      path.join(MANUAL_CALCULATORS_DIR, `${variant}.js`),
      path.join(GENERATED_CALCULATORS_DIR, `${variant}.js`),
      path.join(CALCULATORS_DIR, `${variant}.js`),
      path.join(CALCULATORS_DIR, `${variant.toUpperCase()}.js`)
    ]),
    path.join(CALCULATORS_DIR, 'EMPLEADOS_DE_COMERCIO.js')
  ]);
}

function resolveCalculatorPath(id) {
  return getCalculatorCandidates(id).find((candidate) => fs.existsSync(candidate)) || null;
}

module.exports = {
  CALCULATORS_DIR,
  MANUAL_CALCULATORS_DIR,
  GENERATED_CALCULATORS_DIR,
  SKIP_GENERATION_IDS,
  getCalculatorCandidates,
  resolveCalculatorPath
};
