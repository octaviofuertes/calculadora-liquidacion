require('dotenv').config();
const { getDb } = require('../src/db.js');
const { buildCalculator } = require('../src/services/calculator-builder');

async function run() {
  try {
    const db = await getDb();
    const conventions = await db.collection('conventions').find().toArray();
    for (const c of conventions) {
      await buildCalculator(c);
      console.log('Rebuilt calculator for', c.id);
    }
    console.log('All calculators rebuilt successfully.');
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

run();
