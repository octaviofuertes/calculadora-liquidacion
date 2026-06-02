const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

function buildCors() {
  const rawOrigins = String(process.env.CORS_ORIGIN || "").trim();
  if (!rawOrigins || rawOrigins === "*") {
    return cors();
  }
  const allowed = rawOrigins.split(",").map((item) => item.trim()).filter(Boolean);
  return cors({
    origin(origin, callback) {
      if (!origin || allowed.includes(origin)) return callback(null, true);
      return callback(new Error("Origen no permitido por CORS"));
    }
  });
}

function configureSecurity(app) {
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
  }));
  app.use(buildCors());
  app.use(rateLimit({
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
    limit: Number(process.env.RATE_LIMIT_MAX || 600),
    standardHeaders: true,
    legacyHeaders: false
  }));
}

module.exports = {
  configureSecurity
};
