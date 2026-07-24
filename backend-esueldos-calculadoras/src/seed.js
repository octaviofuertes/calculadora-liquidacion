require("dotenv").config();

const { getDb, closeDb } = require("./db");
const { loadCatalogFromBackend, loadCatalogFromFrontend, normalizeCatalog } = require("./catalog-loader");
const { versionConstants, withConventionMetadata } = require("./domain/normative-versioning");
const { validateConvention } = require("./services/catalog-service");
const { ensureVersionIndexes, saveConventionVersion } = require("./repositories/version-repository");

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
    const originalId = convention.id;
    if (!originalId) {
      console.warn(`[seed] Skipping convention without id at index ${index}`);
      continue;
    }
    const versionedConvention = withConventionMetadata(convention);
    // Ensure id is preserved regardless of what schema validation does
    const docToSave = { ...versionedConvention, id: originalId };
    await database.collection("conventions").replaceOne(
      { _id: originalId },
      { _id: originalId, order: index + 1, ...docToSave, updatedAt: now },
      { upsert: true }
    );
    try {
      await saveConventionVersion(database, docToSave, {
        approvedAt: docToSave.normative?.approvedAt ? new Date(docToSave.normative.approvedAt) : now,
        approvedBy: docToSave.normative?.approvedBy || "seed",
        source: docToSave.normative?.source || docToSave.source || "catalog seed",
        status: "SEED"
      });
    } catch (e) {
      console.warn(`[seed] Could not save version for ${originalId}: ${e.message}`);
    }
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
  await ensureVersionIndexes(database);

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
