const { ObjectId } = require("mongodb");

function serializeLiquidation(doc) {
  if (!doc) return null;
  const { _id, ...payload } = doc;
  return { id: _id.toString(), ...payload };
}

function createLiquidationRepository({ getDb }) {
  function collection() {
    return getDb().collection("liquidations");
  }

  return {
    async list(limit) {
      const docs = await collection().find({}).sort({ createdAt: -1 }).limit(limit).toArray();
      return docs.map(serializeLiquidation);
    },

    async findById(id) {
      if (!ObjectId.isValid(id)) return null;
      return serializeLiquidation(await collection().findOne({ _id: new ObjectId(id) }));
    },

    async insert(doc) {
      const result = await collection().insertOne(doc);
      return { id: result.insertedId.toString(), ...doc };
    },

    async deleteById(id) {
      if (!ObjectId.isValid(id)) return null;
      return collection().deleteOne({ _id: new ObjectId(id) });
    }
  };
}

module.exports = {
  createLiquidationRepository
};
