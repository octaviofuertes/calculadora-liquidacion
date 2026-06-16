const { MongoClient } = require("mongodb");
const dns = require("dns");

const uri = process.env.MONGODB_URI;
const fallbackUri = process.env.MONGODB_FALLBACK_URI;
const dbName = process.env.MONGODB_DB || "esueldos_calculadoras";
const dnsServers = String(process.env.MONGODB_DNS_SERVERS || "")
  .split(",")
  .map((server) => server.trim())
  .filter(Boolean);

let clientPromise;

if (String(uri || "").startsWith("mongodb+srv://") && dnsServers.length) {
  dns.setServers(dnsServers);
}

function mongoOptions(connectionUri) {
  const isSrv = String(connectionUri || "").startsWith("mongodb+srv://");
  return {
    serverSelectionTimeoutMS: Number(process.env.MONGODB_TIMEOUT_MS || 8000),
    ...(isSrv ? { tls: true, tlsInsecure: true } : {})
  };
}

function shouldTryFallback(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  return Boolean(fallbackUri)
    && (code.includes("ECONNREFUSED")
      || code.includes("ENOTFOUND")
      || code.includes("ETIMEOUT")
      || message.includes("querySrv"));
}

async function connect(uriToUse) {
  const client = new MongoClient(uriToUse, mongoOptions(uriToUse));
  await client.connect();
  return client;
}

async function getClient() {
  if (!clientPromise) {
    clientPromise = connect(uri).catch((error) => {
      if (!shouldTryFallback(error)) throw error;
      console.warn(`MongoDB principal no disponible (${error.code || error.message}). Usando MONGODB_FALLBACK_URI.`);
      return connect(fallbackUri);
    });
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
