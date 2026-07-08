/**
 * Diagnostic script: reads all conventions from MongoDB,
 * attempts toRuntimeConvention on each, and reports failures.
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const { MongoClient } = require("mongodb");
const { EXCEL_SCHEMA_VERSION, toRuntimeConvention } = require("./models/convenio.model");

async function main() {
  const uri = process.env.MONGODB_URI || "mongodb://localhost:27017";
  const dbName = process.env.MONGODB_DB || "esueldos";
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  const docs = await db.collection("conventions").find({}).sort({ order: 1 }).toArray();
  console.log(`\n=== Found ${docs.length} conventions in DB ===\n`);

  for (const doc of docs) {
    const label = `${doc.id || doc._id} (${doc.convenio?.denominacion || doc.name || "?"})`;
    const hasSchema = doc.schemaVersion === EXCEL_SCHEMA_VERSION;
    console.log(`--- ${label} ---`);
    console.log(`  schemaVersion: ${doc.schemaVersion || "NONE"} (needs conversion: ${hasSchema})`);
    console.log(`  categorias: ${(doc.categorias || []).length}`);
    console.log(`  escalas: ${(doc.escalas || []).length}`);
    if (doc.escalas) {
      doc.escalas.forEach((s, i) => {
        const vals = (s.valores || []).length;
        const withAmount = (s.valores || []).filter(v => v.valor !== null && v.valor !== undefined && v.valor !== "").length;
        console.log(`    escala[${i}] id=${s.escala_id} periodo_desde="${s.periodo_desde}" nombre="${s.nombre_escala}" valores=${vals} conImporte=${withAmount}`);
      });
    }

    if (hasSchema) {
      try {
        const runtime = toRuntimeConvention(doc);
        console.log(`  ✅ toRuntimeConvention OK → id="${runtime.id}" name="${runtime.name}" periods=${runtime.periods?.length} categories=${runtime.categories?.length}`);
      } catch (err) {
        console.log(`  ❌ toRuntimeConvention FAILED: ${err.message}`);
        console.log(`     Stack: ${err.stack?.split("\n").slice(0, 3).join(" | ")}`);
      }
    } else {
      console.log(`  ⏩ No conversion needed (legacy format), id="${doc.id}"`);
    }
    console.log();
  }

  await client.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
