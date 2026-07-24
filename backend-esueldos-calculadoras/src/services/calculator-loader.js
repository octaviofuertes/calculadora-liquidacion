const path = require('path');
const { resolveCalculatorPath } = require('./calculator-registry');

function assertCalculatorContract(calcModule, id, filePath) {
  if (!calcModule || typeof calcModule !== 'object') {
    throw new Error(`Calculadora invalida para ${id}: exportacion vacia`);
  }
  if (typeof calcModule.getMetadata !== 'function') {
    throw new Error(`Calculadora invalida para ${id}: falta getMetadata()`);
  }
  if (typeof calcModule.calculate !== 'function') {
    throw new Error(`Calculadora invalida para ${id}: falta calculate()`);
  }
  return calcModule;
}

function loadCalculatorModule(id) {
  const calcPath = resolveCalculatorPath(id);
  if (!calcPath) return null;
  delete require.cache[require.resolve(calcPath)];
  const calcModule = require(calcPath);
  return {
    path: calcPath,
    name: path.basename(calcPath),
    module: assertCalculatorContract(calcModule, id, calcPath)
  };
}

module.exports = {
  assertCalculatorContract,
  loadCalculatorModule
};
