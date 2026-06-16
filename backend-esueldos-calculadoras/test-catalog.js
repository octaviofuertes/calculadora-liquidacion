const { MongoClient } = require("mongodb");
const catalogRepository = require("./src/repositories/catalog-repository.js");

async function run() {
  const client = new MongoClient("mongodb://127.0.0.1:27017");
  try {
    await client.connect();
    const db = client.db("esueldos_calculadoras");
    const payload = await catalogRepository.getCatalogPayload(db);
    console.log("Conventions keys:", Object.keys(payload.conventions));
    console.log("Sample convention:", Object.values(payload.conventions)[0]);
  } catch (err) {
    console.error(err);
  } finally {
    await client.close();
  }
}
run();
