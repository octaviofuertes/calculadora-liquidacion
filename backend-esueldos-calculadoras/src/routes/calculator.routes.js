const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const convenioService = require('../services/convenio-service');
const { resolveCalculatorPath } = require('../services/calculator-registry');
const { loadCalculatorModule } = require('../services/calculator-loader');

async function ensureCalculatorPath(id, db) {
  const existing = resolveCalculatorPath(id);
  if (existing) return existing;

  let doc = null;
  try {
    doc = await convenioService.getConvenio(db(), id);
  } catch (dbErr) {
    const catalogPath = path.join(__dirname, '..', 'catalog', 'conventions', `${id}.json`);
    try {
      const raw = await fs.readFile(catalogPath, 'utf8');
      doc = JSON.parse(raw);
    } catch (catErr) {
      return null;
    }
  }

  if (!doc) return null;
  const { buildCalculator } = require('../services/calculator-builder');
  await buildCalculator(doc);
  return resolveCalculatorPath(id);
}

function createCalculatorRoutes({ getDb }) {
  const router = express.Router();
  const db = () => getDb();

  router.get('/:id/metadata', async (req, res, next) => {
    try {
      const calcPath = await ensureCalculatorPath(req.params.id, db);
      if (!calcPath) return res.status(404).json({ error: 'Convenio no encontrado' });
      const loaded = loadCalculatorModule(req.params.id);
      if (!loaded) return res.status(404).json({ error: 'Convenio no encontrado' });
      res.json(loaded.module.getMetadata());
    } catch (error) {
      next(error);
    }
  });

  router.post('/:id/calculate', async (req, res, next) => {
    try {
      const calcPath = await ensureCalculatorPath(req.params.id, db);
      if (!calcPath) return res.status(404).json({ error: 'Convenio no encontrado' });
      const loaded = loadCalculatorModule(req.params.id);
      if (!loaded) return res.status(404).json({ error: 'Convenio no encontrado' });
      const result = loaded.module.calculate(req.body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = createCalculatorRoutes;
