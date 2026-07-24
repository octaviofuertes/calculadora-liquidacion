const fs = require('fs');

let code = fs.readFileSync('d:/pasantias/calculadora-liquidacion/frontend-esueldos-calculadoras/app.bundle.js', 'utf8');

// Mock DOM functions
const mockEnv = `
const document = {
  getElementById: (id) => {
    if (id === 'camWorkingDays') return { value: '24' };
    if (id === 'camPeriodDays') return { value: '24' };
    if (id === 'category') return { value: 'conductor1' };
    if (id === 'camSeniority') return { checked: true };
    if (id === 'camPresentism') return { checked: true };
    if (id === 'entryDate') return { value: '2015-05-01' };
    if (id === 'period') return { value: 'may26' };
    if (id === 'zone') return { value: 'base' };
    if (id === 'scaleConvention') return { value: '' };
    return { value: '', checked: false };
  },
  createElement: () => ({}),
  querySelectorAll: () => []
};
const window = {
  location: { protocol: 'http:', host: 'localhost' },
  DATA: {
    conventions: {
      camioneros: ${fs.readFileSync('d:/pasantias/calculadora-liquidacion/backend-esueldos-calculadoras/src/catalog/conventions/camioneros.json', 'utf8')}
    }
  }
};
const $ = document.getElementById;
`;

code = code.replace(/const ui = /g, 'var ui = '); // just in case

try {
  eval(mockEnv + "\n" + code);
  
  const conv = window.DATA.conventions.camioneros;
  const result = calcCamioneros(conv);
  console.log(JSON.stringify(result, null, 2));
} catch(e) {
  console.log("Eval error:", e);
}
