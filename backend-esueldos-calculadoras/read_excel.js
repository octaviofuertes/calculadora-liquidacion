const xlsx = require('xlsx');
const workbook = xlsx.readFile('../ejemplo-excel.xlsx');
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const rows = xlsx.utils.sheet_to_json(sheet, {header: 1});
console.log("First 5 rows:");
for (let i = 0; i < 5 && i < rows.length; i++) {
  console.log(rows[i]);
}
