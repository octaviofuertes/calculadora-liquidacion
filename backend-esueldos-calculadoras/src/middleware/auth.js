const { ObjectId } = require("mongodb");
const { publicUser, verifyUserToken } = require("../services/auth-service");

function authMiddleware(getDb) {
  return async (req, res, next) => {
    try {
      const header = req.get("authorization") || "";
      const token = header.startsWith("Bearer ") ? header.slice(7) : "";
      if (!token) return next();
      const decoded = verifyUserToken(token);
      const db = getDb();
      const user = ObjectId.isValid(decoded.sub)
        ? await db.collection("users").findOne({ _id: new ObjectId(decoded.sub), active: true })
        : null;
      if (user) req.user = publicUser(user);
      next();
    } catch (error) {
      res.status(401).json({ error: "Sesion invalida o vencida" });
    }
  };
}

function requireAuth(req, res, next) {
  if (req.user) return next();
  return res.status(401).json({ error: "Inicia sesion para continuar" });
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Inicia sesion para continuar" });
    if (roles.includes(req.user.role)) return next();
    return res.status(403).json({ error: "No tenes permisos para esta accion" });
  };
}

function requireAuthWhenEnabled(req, res, next) {
  if (process.env.AUTH_REQUIRED !== "true") return next();
  return requireAuth(req, res, next);
}

module.exports = {
  authMiddleware,
  requireAuth,
  requireAuthWhenEnabled,
  requireRole
};
