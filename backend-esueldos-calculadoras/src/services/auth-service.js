const crypto = require("crypto");

const TOKEN_TTL_MS = Number(process.env.AUTH_TOKEN_TTL_MS || 8 * 60 * 60 * 1000);

function authSecret() {
  return process.env.AUTH_JWT_SECRET || process.env.API_AUTH_TOKEN || "esueldos-dev-auth-secret-change-me";
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function signPayload(payload) {
  return crypto.createHmac("sha256", authSecret()).update(payload).digest("base64url");
}

function signUserToken(user) {
  const payload = base64url(JSON.stringify({
    sub: user._id.toString(),
    role: user.role,
    name: user.name,
    email: user.email,
    exp: Date.now() + TOKEN_TTL_MS
  }));
  return `${payload}.${signPayload(payload)}`;
}

function verifyUserToken(token) {
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature || signPayload(payload) !== signature) return null;
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (decoded.exp && decoded.exp < Date.now()) return null;
  return decoded;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 32, "sha256").toString("hex");
  return `pbkdf2$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const [, salt, hash] = String(stored || "").split("$");
  if (!salt || !hash) return false;
  return hashPassword(password, salt) === stored;
}

async function ensureUserIndexes(db) {
  await db.collection("users").createIndex({ email: 1 }, { unique: true });
  await db.collection("users").createIndex({ role: 1, active: 1 });
}

async function createUser(db, { email, password, name, role = "operator" }) {
  const now = new Date();
  const doc = {
    email: String(email).trim().toLowerCase(),
    name: name || email,
    role,
    passwordHash: hashPassword(password),
    active: true,
    createdAt: now,
    updatedAt: now
  };
  const result = await db.collection("users").insertOne(doc);
  return { _id: result.insertedId, ...doc };
}

async function authenticateUser(db, { email, password }) {
  const user = await db.collection("users").findOne({ email: String(email || "").trim().toLowerCase(), active: true });
  if (!user || !verifyPassword(password, user.passwordHash)) {
    const error = new Error("Credenciales invalidas");
    error.status = 401;
    throw error;
  }
  return { user: publicUser(user), token: signUserToken(user) };
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user._id?.toString?.() || user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    active: user.active !== false
  };
}

module.exports = {
  authenticateUser,
  createUser,
  ensureUserIndexes,
  publicUser,
  verifyUserToken
};
