const { ObjectId } = require("mongodb");

function serializeEmployee(doc) {
  if (!doc) return null;
  const { _id, ...payload } = doc;
  return { id: _id.toString(), ...payload };
}

function createEmployeeRepository({ getDb }) {
  function collection() {
    return getDb().collection("employees");
  }

  return {
    async nextLegajo() {
      const docs = await collection().find({}, { projection: { legajo: 1 } }).toArray();
      const max = docs.reduce((current, emp) => {
        const num = parseInt(emp.legajo, 10);
        return !Number.isNaN(num) && num > current ? num : current;
      }, 0);
      return String(max + 1).padStart(3, "0");
    },

    async search(filter) {
      const docs = await collection().find(filter).limit(10).toArray();
      return docs.map(serializeEmployee);
    },

    async list() {
      const docs = await collection().find({}).sort({ legajo: 1 }).toArray();
      return docs.map(serializeEmployee);
    },

    async findByLegajo(legajo) {
      return serializeEmployee(await collection().findOne({ legajo }));
    },

    async findById(id) {
      if (!ObjectId.isValid(id)) return null;
      return serializeEmployee(await collection().findOne({ _id: new ObjectId(id) }));
    },

    async findByLegajoRaw(legajo) {
      return collection().findOne({ legajo });
    },

    async insert(doc) {
      const result = await collection().insertOne(doc);
      return { id: result.insertedId.toString(), ...doc };
    },

    async updateById(id, update) {
      if (!ObjectId.isValid(id)) return null;
      const result = await collection().findOneAndUpdate(
        { _id: new ObjectId(id) },
        { $set: update },
        { returnDocument: "after" }
      );
      return serializeEmployee(result);
    },

    async deleteById(id) {
      if (!ObjectId.isValid(id)) return null;
      return collection().deleteOne({ _id: new ObjectId(id) });
    }
  };
}

module.exports = {
  createEmployeeRepository
};
