const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const TOKEN_TTL = process.env.AUTH_TOKEN_TTL || "8h";

function jwtSecret() {
  const secret = process.env.AUTH_JWT_SECRET || process.env.API_AUTH_TOKEN;
  if (!secret && process.env.NODE_ENV === "production") {
    const error = new Error("Falta AUTH_JWT_SECRET para autenticacion.");
    error.status = 500;
    throw error;
  }
  return secret || "esueldos-dev-auth-secret-change-me";
}

async function hashPassword(password) {
  return bcrypt.hash(String(password), 12);
}

async function verifyPassword(password, hash) {
  return bcrypt.compare(String(password), String(hash || ""));
}

function signUserToken(user) {
  return jwt.sign(
    {
      sub: user._id.toString(),
      role: user.role,
      name: user.name,
      email: user.email
    },
    jwtSecret(),
    { expiresIn: TOKEN_TTL }
  );
}

function verifyUserToken(token) {
  return jwt.verify(token, jwtSecret());
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
    passwordHash: await hashPassword(password),
    active: true,
    createdAt: now,
    updatedAt: now
  };
  const result = await db.collection("users").insertOne(doc);
  return { _id: result.insertedId, ...doc };
}

async function authenticateUser(db, { email, password }) {
  const user = await db.collection("users").findOne({ email: String(email || "").trim().toLowerCase(), active: true });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    const error = new Error("Credenciales invalidas");
    error.status = 401;
    throw error;
  }
  return {
    user: publicUser(user),
    token: signUserToken(user)
  };
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
