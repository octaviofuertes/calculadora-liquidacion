const fs = require('fs');
const engine = require('./backend-esueldos-calculadoras/src/domain/payroll-engine.js');
const camionerosConv = JSON.parse(fs.readFileSync('./backend-esueldos-calculadoras/src/catalog/conventions/camioneros.json', 'utf8'));

const ctx = {
  convention: camionerosConv,
  inputs: {
    zone: "base",
    category: "conductor1",
    period: "may26"
  }
};

const result = engine.calculatePayroll(ctx);
console.log(JSON.stringify(result, null, 2));
