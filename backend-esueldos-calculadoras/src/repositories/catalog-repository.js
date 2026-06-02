function stripCatalogConvention(doc) {
  if (!doc) return null;
  const { _id, order, updatedAt, ...convention } = doc;
  return convention;
}

function stripLegalReference(doc) {
  const { _id, order, updatedAt, ...reference } = doc;
  return reference;
}

function toCatalogPayload(constantsDoc, conventionDocs, legalReferenceDocs) {
  const { _id, updatedAt, ...constants } = constantsDoc || {};
  const conventions = {};

  conventionDocs.forEach((doc) => {
    const convention = stripCatalogConvention(doc);
    conventions[convention.id] = convention;
  });

  return {
    constants,
    conventions,
    legalReferences: legalReferenceDocs.map(stripLegalReference)
  };
}

async function getCatalogPayload(db) {
  const [constantsDoc, conventionDocs, legalReferenceDocs] = await Promise.all([
    db.collection("constants").findOne({ _id: "global" }),
    db.collection("conventions").find({}).sort({ order: 1, name: 1 }).toArray(),
    db.collection("legalReferences").find({}).sort({ order: 1 }).toArray()
  ]);

  return toCatalogPayload(constantsDoc, conventionDocs, legalReferenceDocs);
}

async function listConventions(db) {
  const docs = await db.collection("conventions").find({}).sort({ order: 1, name: 1 }).toArray();
  return docs.map(stripCatalogConvention);
}

async function getConventionById(db, conventionId) {
  const doc = await db.collection("conventions").findOne({ id: conventionId });
  return stripCatalogConvention(doc);
}

async function replaceConvention(db, convention, extra = {}) {
  const existing = await db.collection("conventions").findOne({ id: convention.id });
  const maxOrderDoc = await db.collection("conventions").find({}).sort({ order: -1 }).limit(1).next();
  const now = extra.updatedAt || new Date();
  const order = existing?.order || ((maxOrderDoc?.order || 0) + 1);
  const doc = {
    _id: existing?._id || convention.id,
    order,
    ...convention,
    ...extra,
    updatedAt: now
  };

  await db.collection("conventions").replaceOne(
    { id: convention.id },
    doc,
    { upsert: true }
  );
  return stripCatalogConvention(doc);
}

module.exports = {
  getCatalogPayload,
  getConventionById,
  listConventions,
  replaceConvention,
  toCatalogPayload
};
