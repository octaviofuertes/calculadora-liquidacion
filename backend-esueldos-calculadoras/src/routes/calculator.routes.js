const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const convenioService = require('../services/convenio-service');

function createCalculatorRoutes({ getDb }) {
  const router = express.Router();
  const db = () => getDb();

  const getCalculatorPath = (id) => path.join(__dirname, '..', 'calculators', `${id}.js`);

  router.get('/:id/metadata', async (req, res, next) => {
    try {
      const calcPath = getCalculatorPath(req.params.id);
      
      try {
        await fs.access(calcPath);
      } catch (err) {
        // If calculator doesn't exist, try to build it from DB or local catalog
        let doc = null;
        try {
          doc = await convenioService.getConvenio(db(), req.params.id);
        } catch (dbErr) {
          // Not in DB - try local catalog fallback
          const catalogPath = path.join(__dirname, '..', 'catalog', 'conventions', `${req.params.id}.json`);
          try {
            const raw = await fs.readFile(catalogPath, 'utf8');
            doc = JSON.parse(raw);
          } catch (catErr) {
            return res.status(404).json({ error: 'Convenio no encontrado' });
          }
        }
        if (!doc) return res.status(404).json({ error: 'Convenio no encontrado' });
        
        const { buildCalculator } = require('../services/calculator-builder');
        await buildCalculator(doc);
        delete require.cache[require.resolve(calcPath)];
      }
      
      const calcModule = require(calcPath);
      res.json(calcModule.getMetadata());
    } catch (error) {
      next(error);
    }
  });

  router.post('/:id/calculate', async (req, res, next) => {
    try {
      const calcPath = getCalculatorPath(req.params.id);
      
      try {
        await fs.access(calcPath);
      } catch (err) {
        // If calculator doesn't exist, try to build it
        const doc = await convenioService.getConvenio(db(), req.params.id);
        if (!doc) return res.status(404).json({ error: 'Convenio no encontrado' });
        
        const { buildCalculator } = require('../services/calculator-builder');
        await buildCalculator(doc);
      }
      
      // Clear require cache for this module just in case it was updated
      delete require.cache[require.resolve(calcPath)];
      const calcModule = require(calcPath);
      
      const result = calcModule.calculate(req.body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = createCalculatorRoutes;
