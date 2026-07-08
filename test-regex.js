const ts = '.';
const s = `\\${ts}`;
console.log('s:', s, 'length:', s.length, 'char0:', s.charCodeAt(0));
const r = new RegExp(s, 'g');
console.log('regex:', r);
const str = '576.213,21';
console.log('replaced:', str.replace(r, ''));
