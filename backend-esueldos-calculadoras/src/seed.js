require("dotenv").config();

const { getDb, closeDb } = require("./db");
const { loadCatalogFromFrontend, normalizeCatalog } = require("./catalog-loader");

async function seedCatalog(db = null) {
  const ownsConnection = !db;
  const database = db || await getDb();
  const catalog = normalizeCatalog(loadCatalogFromFrontend());
  const now = new Date();

  await database.collection("constants").replaceOne(
    { _id: "global" },
    { _id: "global", ...catalog.constants, updatedAt: now },
    { upsert: true }
  );

  for (const [index, convention] of catalog.conventions.entries()) {
    await database.collection("conventions").replaceOne(
      { _id: convention.id },
      { _id: convention.id, order: index + 1, ...convention, updatedAt: now },
      { upsert: true }
    );
  }

  await database.collection("legalReferences").deleteMany({});
  if (catalog.legalReferences.length) {
    await database.collection("legalReferences").insertMany(
      catalog.legalReferences.map((item, index) => ({ ...item, order: index + 1, updatedAt: now }))
    );
  }

  await database.collection("conventions").createIndex({ id: 1 }, { unique: true });
  await database.collection("conventions").createIndex({ order: 1 });
  await database.collection("liquidations").createIndex({ createdAt: -1 });
  await database.collection("liquidations").createIndex({ "employee.cuil": 1 });

  if (ownsConnection) {
    console.log(`Seed OK: ${catalog.conventions.length} convenios cargados.`);
    await closeDb();
  }

  return catalog;
}

if (require.main === module) {
  seedCatalog().catch(async (error) => {
    console.error(error);
    await closeDb();
    process.exit(1);
  });
}

module.exports = {
  seedCatalog
};
