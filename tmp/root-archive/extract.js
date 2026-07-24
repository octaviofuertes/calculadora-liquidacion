const fs = require('fs');
const lines = fs.readFileSync('C:/Users/joniv/.gemini/antigravity/brain/bffcdf94-3be3-4207-a2dd-8693e9719ef0/.system_generated/logs/transcript_full.jsonl', 'utf8').split('\n');
const inputs = lines.filter(l => l.includes('"type":"USER_INPUT"'));
// El último input es el de "lo mas importante son las tablas"
// El penúltimo es el código de referencia.
const lastInput = JSON.parse(inputs[inputs.length - 2]);
fs.writeFileSync('reference.html', lastInput.content);
