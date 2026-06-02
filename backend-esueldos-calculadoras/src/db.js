const { MongoClient } = require("mongodb");


const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || "esueldos_calculadoras";


let clientPromise;


async function getClient() {
  if (!clientPromise) {
    const client = new MongoClient(uri, {
      tls: true,
      tlsInsecure: true,
    });


    clientPromise = client.connect();
  }


  return clientPromise;
}


async function getDb() {
    const client = await getClient();
  return client.db(dbName);
}


async function closeDb() {
  if (!clientPromise) return;


  const client = await clientPromise;


  await client.close();


  clientPromise = null;
}


module.exports = {
  getDb,
  closeDb,
};
