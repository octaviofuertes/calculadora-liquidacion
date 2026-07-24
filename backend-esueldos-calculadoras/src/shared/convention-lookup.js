function conventionIdVariants(convenioId) {
  return [...new Set([
    convenioId,
    String(convenioId || "").replace(/_/g, "-"),
    String(convenioId || "").replace(/-/g, "_")
  ].filter(Boolean))];
}

async function findConventionDoc(collection, convenioId) {
  for (const variant of conventionIdVariants(convenioId)) {
    const doc = await collection.findOne({ "convenio.convenio_id": variant })
      || await collection.findOne({ convenio_id: variant })
      || await collection.findOne({ id: variant });
    if (doc) return doc;
  }
  return null;
}

module.exports = {
  conventionIdVariants,
  findConventionDoc
};
