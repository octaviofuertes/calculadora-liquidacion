require("dotenv").config();

const { getDb, closeDb } = require("./db");
const { loadCatalogFromBackend, loadCatalogFromFrontend, normalizeCatalog } = require("./catalog-loader");
const { versionConstants, withConventionMetadata } = require("./domain/normative-versioning");

function loadSeedCatalog() {
  try {
    return normalizeCatalog(loadCatalogFromBackend());
  } catch (error) {
    if (process.env.ALLOW_FRONTEND_CATALOG_FALLBACK === "true") {
      return normalizeCatalog(loadCatalogFromFrontend());
    }
    throw error;
  }
}

async function seedCatalog(db = null) {
  const ownsConnection = !db;
  const database = db || await getDb();
  const catalog = loadSeedCatalog();
  const now = new Date();

  await database.collection("constants").replaceOne(
    { _id: "global" },
    {
      _id: "global",
      ...catalog.constants,
      normativeVersions: versionConstants(catalog.constants),
      updatedAt: now
    },
    { upsert: true }
  );

  for (const [index, convention] of catalog.conventions.entries()) {
    const versionedConvention = withConventionMetadata(convention);
    await database.collection("conventions").replaceOne(
      { _id: convention.id },
      { _id: convention.id, order: index + 1, ...versionedConvention, updatedAt: now },
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
